/**
 * notifications.spec.ts — behavioural tests for the notification SSE
 * bridge: event parsing, type→severity mapping, toast mapping, and
 * reconnect dedupe (same event id delivered twice fires ONE toast).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showToast, useToast } from "@/composables/useToast";
import {
  DEFAULT_SEVERITY_BY_TYPE,
  SEVERITY_TO_VARIANT,
  TITLE_BY_TYPE,
  createNotificationDeduper,
  notificationToToast,
  parseNotificationEvent,
} from "./notifications";

function wireEvent(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "evt-1",
    type: "turn_complete",
    severity: "info",
    message: "Turn finished",
    ...overrides,
  });
}

describe("parseNotificationEvent", () => {
  it("parses a well-formed event", () => {
    const event = parseNotificationEvent(wireEvent());
    expect(event).not.toBeNull();
    expect(event!.id).toBe("evt-1");
    expect(event!.type).toBe("turn_complete");
    expect(event!.severity).toBe("info");
    expect(event!.message).toBe("Turn finished");
  });

  it("carries provider and model when present", () => {
    const event = parseNotificationEvent(
      wireEvent({ provider: "zai", model: "glm-4.6" }),
    );
    expect(event!.provider).toBe("zai");
    expect(event!.model).toBe("glm-4.6");
  });

  it("rejects [DONE], malformed JSON, missing id/message, unknown type", () => {
    expect(parseNotificationEvent("[DONE]")).toBeNull();
    expect(parseNotificationEvent("not json")).toBeNull();
    expect(parseNotificationEvent(wireEvent({ id: undefined }))).toBeNull();
    expect(parseNotificationEvent(wireEvent({ message: undefined }))).toBeNull();
    expect(parseNotificationEvent(wireEvent({ type: "mystery" }))).toBeNull();
  });

  it("falls back to the default severity when the wire omits it", () => {
    const event = parseNotificationEvent(
      wireEvent({ type: "task_failed", severity: undefined }),
    );
    expect(event!.severity).toBe("error");
  });
});

describe("severity mapping contract (4 event types)", () => {
  it("maps turn_complete → info, task_failed → error, cooldown/failover → warning", () => {
    expect(DEFAULT_SEVERITY_BY_TYPE).toEqual({
      turn_complete: "info",
      task_failed: "error",
      cooldown: "warning",
      failover: "warning",
    });
  });

  it("maps severity onto a useToast variant that exists", () => {
    // useToast has no "warning" variant — warning degrades to default
    // styling with an extended duration instead.
    expect(SEVERITY_TO_VARIANT.info).toBe("default");
    expect(SEVERITY_TO_VARIANT.warning).toBe("default");
    expect(SEVERITY_TO_VARIANT.error).toBe("error");
  });

  it("titles every known type", () => {
    for (const type of Object.keys(TITLE_BY_TYPE) as (keyof typeof TITLE_BY_TYPE)[]) {
      expect(TITLE_BY_TYPE[type].length).toBeGreaterThan(0);
    }
  });
});

describe("notificationToToast", () => {
  it("maps an error event to an error-variant toast with long duration", () => {
    const toast = notificationToToast({
      id: "e1",
      type: "task_failed",
      severity: "error",
      message: "Boom",
    });
    expect(toast.title).toBe("Task failed");
    expect(toast.message).toBe("Boom");
    expect(toast.variant).toBe("error");
    expect(toast.duration).toBeGreaterThanOrEqual(6000);
  });

  it("maps a warning event with shorter-than-error duration", () => {
    const warn = notificationToToast({
      id: "e2",
      type: "cooldown",
      severity: "warning",
      message: "Backing off",
    });
    const error = notificationToToast({
      id: "e3",
      type: "task_failed",
      severity: "error",
      message: "Boom",
    });
    expect(warn.variant).toBe("default");
    expect(warn.duration).toBeLessThan(error.duration);
    expect(warn.duration).toBeGreaterThan(3000);
  });

  it("maps an info event to the default duration", () => {
    const toast = notificationToToast({
      id: "e4",
      type: "turn_complete",
      severity: "info",
      message: "Done",
    });
    expect(toast.duration).toBe(3000);
  });

  it("appends provider/model context to the message when present", () => {
    const toast = notificationToToast({
      id: "e5",
      type: "failover",
      severity: "warning",
      message: "Switched provider",
      provider: "zai",
      model: "glm-4.6",
    });
    expect(toast.message).toBe("Switched provider (zai / glm-4.6)");
  });
});

describe("createNotificationDeduper", () => {
  it("fires once per unique event id", () => {
    const dedupe = createNotificationDeduper();
    const event = {
      id: "evt-1",
      type: "cooldown" as const,
      severity: "warning" as const,
      message: "Backing off",
    };
    expect(dedupe(event)).toBe(true);
    expect(dedupe({ ...event })).toBe(false);
    expect(dedupe({ ...event, id: "evt-2" })).toBe(true);
    expect(dedupe(event)).toBe(false);
  });

  it("caps the seen-id set (memory bounded)", () => {
    const dedupe = createNotificationDeduper();
    const base = {
      type: "turn_complete" as const,
      severity: "info" as const,
      message: "done",
    };
    // Push well past the cap so evt-0 is evicted; it should be accepted
    // again (re-notification after eviction is the documented trade-off).
    for (let i = 0; i < 1001; i++) {
      dedupe({ ...base, id: `evt-${i}` });
    }
    expect(dedupe({ ...base, id: "evt-1000" })).toBe(false);
    expect(dedupe({ ...base, id: "evt-0" })).toBe(true);
  });
});

describe("end-to-end: parsed duplicate wire lines produce one toast", () => {
  beforeEach(() => {
    const { dismissAll } = useToast();
    dismissAll();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    const { dismissAll } = useToast();
    dismissAll();
  });

  it("dedupes replayed lines after reconnect", () => {
    const dedupe = createNotificationDeduper();
    const lines = [
      wireEvent({ type: "failover", severity: "warning", id: "f1" }),
      // Replay of the same id (server replay after reconnect):
      wireEvent({ type: "failover", severity: "warning", id: "f1" }),
      wireEvent({ type: "task_failed", severity: "error", id: "f2" }),
    ];
    for (const line of lines) {
      const event = parseNotificationEvent(line);
      if (!event) continue;
      if (!dedupe(event)) continue;
      showToast(notificationToToast(event));
    }
    const { toasts } = useToast();
    expect(toasts.value).toHaveLength(2);
    expect(toasts.value[0].variant).toBe("default");
    expect(toasts.value[1].variant).toBe("error");
  });
});
