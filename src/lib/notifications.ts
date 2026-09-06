/**
 * notifications.ts — user-facing notification SSE bridge.
 *
 * Subscribes to GET /api/v1/notifications/events (the backend's
 * NotificationEvent projection, see the FlowState notifications feature:
 * EventBus NotificationEvent → SSE endpoint in internal/api). Each event
 * is mapped onto the existing useToast composable respecting severity:
 *
 *   turn_complete → info (variant "default")
 *   task_failed   → error
 *   cooldown      → warning
 *   failover      → warning
 *
 * Transport mirrors swarmStore's SSE-via-fetch pattern (generation token,
 * exponential-backoff reconnect, credentials: "include" for the auth
 * cookie). Unlike swarmStore this stream is session-independent — it
 * carries operator-level notifications, so it connects once at app
 * bootstrap next to the swarm-events subscription and survives session
 * changes.
 *
 * Dedupe: the backend may replay events after a reconnect (Last-Event-ID
 * semantics are not guaranteed), so each seen event id is recorded and
 * duplicate deliveries are dropped. The seen-id set is capped so a
 * long-lived tab doesn't grow memory unboundedly.
 */
import { joinBaseURL } from "@/api";
import { showToast, type ToastVariant } from "@/composables/useToast";

const NOTIFICATIONS_ENDPOINT = "/v1/notifications/events";
const RECONNECT_BASE_DELAY_MS = 2_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const RECONNECT_MAX_ATTEMPTS = 5;
const STALL_TIMEOUT_MS = 60_000;
const MAX_SEEN_IDS = 1_000;

export type NotificationType =
  | "turn_complete"
  | "task_failed"
  | "cooldown"
  | "failover";

export type NotificationSeverity = "info" | "warning" | "error";

export interface NotificationEvent {
  /** Server-assigned unique id — the dedupe key. */
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  message: string;
  provider?: string;
  model?: string;
}

/**
 * Type→severity defaults per the feature contract. The event's own
 * `severity` field wins when present (the backend is the source of
 * truth); this table is the fallback for degraded payloads so the
 * toast still respects the agreed mapping.
 */
export const DEFAULT_SEVERITY_BY_TYPE: Record<
  NotificationType,
  NotificationSeverity
> = {
  turn_complete: "info",
  task_failed: "error",
  cooldown: "warning",
  failover: "warning",
};

/** severity → useToast variant (the composable has no "warning"). */
export const SEVERITY_TO_VARIANT: Record<NotificationSeverity, ToastVariant> =
  {
    info: "default",
    warning: "default",
    error: "error",
  };

export const TITLE_BY_TYPE: Record<NotificationType, string> = {
  turn_complete: "Turn complete",
  task_failed: "Task failed",
  cooldown: "Cooldown",
  failover: "Provider failover",
};

export function severityToDuration(severity: NotificationSeverity): number {
  // Errors and warnings stay on screen longer than info toasts.
  if (severity === "error") return 8000;
  if (severity === "warning") return 6000;
  return 3000;
}

/** Parse a raw SSE data line into a NotificationEvent, or null. */
export function parseNotificationEvent(data: string): NotificationEvent | null {
  if (data === "[DONE]") return null;
  let parsed: Partial<NotificationEvent>;
  try {
    parsed = JSON.parse(data) as Partial<NotificationEvent>;
  } catch {
    return null;
  }
  if (typeof parsed.id !== "string" || parsed.id === "") return null;
  if (typeof parsed.type !== "string") return null;
  if (typeof parsed.message !== "string") return null;
  const type = parsed.type as NotificationType;
  if (!(type in DEFAULT_SEVERITY_BY_TYPE)) return null;
  const severity =
    parsed.severity && parsed.severity in SEVERITY_TO_VARIANT
      ? (parsed.severity as NotificationSeverity)
      : DEFAULT_SEVERITY_BY_TYPE[type];
  return {
    id: parsed.id,
    type,
    severity,
    message: parsed.message,
    provider: typeof parsed.provider === "string" ? parsed.provider : undefined,
    model: typeof parsed.model === "string" ? parsed.model : undefined,
  };
}

/**
 * Pure mapping: NotificationEvent → showToast options. Provider/model are
 * appended to the message when present so failover/cooldown toasts carry
 * the affected model context.
 */
export function notificationToToast(event: NotificationEvent): {
  title: string;
  message: string;
  variant: ToastVariant;
  duration: number;
} {
  let message = event.message;
  if (event.provider || event.model) {
    const pair = [event.provider, event.model].filter(Boolean).join(" / ");
    if (pair) message = `${message} (${pair})`;
  }
  return {
    title: TITLE_BY_TYPE[event.type],
    message,
    variant: SEVERITY_TO_VARIANT[event.severity],
    duration: severityToDuration(event.severity),
  };
}

/**
 * Dedupe filter — returns true when the event id has NOT been seen yet
 * (and records it). Exported for testing; the stream loop uses it via a
 * closure over the seen set.
 */
export function createNotificationDeduper(): (
  event: NotificationEvent,
) => boolean {
  const seen = new Set<string>();
  const order: string[] = [];
  return (event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    order.push(event.id);
    if (order.length > MAX_SEEN_IDS) {
      const evict = order.shift();
      if (evict !== undefined) seen.delete(evict);
    }
    return true;
  };
}

interface NotificationStreamHandle {
  disconnect(): void;
}

let activeHandle: NotificationStreamHandle | null = null;

/**
 * Connect the notification SSE stream. Idempotent at the module level —
 * repeated calls disconnect the previous stream first (matches the
 * bootstrap wiring where connect may run once per app mount).
 */
export function connectNotificationStream(): NotificationStreamHandle {
  activeHandle?.disconnect();

  let generation = 0;
  let aborted = false;
  let reconnectAttempt = 0;
  let stallTimerId: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimerId: ReturnType<typeof setTimeout> | null = null;
  const dedupe = createNotificationDeduper();
  const handle: NotificationStreamHandle = { disconnect };

  function clearTimers(): void {
    if (stallTimerId !== null) {
      clearTimeout(stallTimerId);
      stallTimerId = null;
    }
    if (reconnectTimerId !== null) {
      clearTimeout(reconnectTimerId);
      reconnectTimerId = null;
    }
  }

  function armStallTimer(myGeneration: number): void {
    if (stallTimerId !== null) clearTimeout(stallTimerId);
    stallTimerId = setTimeout(() => {
      if (myGeneration === generation) attemptReconnect(myGeneration);
    }, STALL_TIMEOUT_MS);
  }

  function attemptReconnect(myGeneration: number): void {
    if (myGeneration !== generation || aborted) return;
    if (reconnectTimerId !== null) clearTimeout(reconnectTimerId);
    if (reconnectAttempt >= RECONNECT_MAX_ATTEMPTS) return;
    reconnectAttempt += 1;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempt - 1),
      RECONNECT_MAX_DELAY_MS,
    );
    reconnectTimerId = setTimeout(() => {
      if (myGeneration === generation && !aborted) {
        void readLoop(myGeneration);
      }
    }, delay);
  }

  async function readLoop(myGeneration: number): Promise<void> {
    try {
      const response = await fetch(joinBaseURL(NOTIFICATIONS_ENDPOINT), {
        credentials: "include",
      });
      if (myGeneration !== generation) return;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Response body is not readable");

      const decoder = new TextDecoder();
      let buffer = "";
      reconnectAttempt = 0;
      armStallTimer(myGeneration);

      while (true) {
        const { done, value } = await reader.read();
        if (myGeneration !== generation) {
          reader.cancel().catch(() => undefined);
          return;
        }
        if (done) {
          // Clean server close — reconnect immediately-ish via backoff.
          if (stallTimerId !== null) clearTimeout(stallTimerId);
          buffer += decoder.decode();
          if (buffer) ingestLine(buffer);
          attemptReconnect(myGeneration);
          return;
        }
        armStallTimer(myGeneration);
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) ingestLine(line);
      }
    } catch {
      if (myGeneration === generation && !aborted) {
        attemptReconnect(myGeneration);
      }
    }
  }

  function ingestLine(line: string): void {
    if (!line.startsWith("data: ")) return;
    const event = parseNotificationEvent(line.slice(6));
    if (!event) return;
    if (!dedupe(event)) return;
    showToast(notificationToToast(event));
  }

  function disconnect(): void {
    aborted = true;
    generation += 1;
    clearTimers();
    if (activeHandle === handle) activeHandle = null;
  }

  generation += 1;
  void readLoop(generation);
  activeHandle = handle;
  return handle;
}

/** Disconnect the module-level stream if one is active. */
export function disconnectNotificationStream(): void {
  activeHandle?.disconnect();
}
