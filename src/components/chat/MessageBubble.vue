<script setup lang="ts">
import { computed } from "vue";
import type { Message } from "@/types";
import { useChatStore } from "@/stores/chatStore";
import { useNow } from "@/composables/useNow";
import MarkdownRenderer from "./MarkdownRenderer.vue";
import ThinkingPanel from "./ThinkingPanel.vue";
import PermissionPrompt from "./PermissionPrompt.vue";
import CopyButton from "@/components/tools/CopyButton.vue";
import ToolErrorCard from "@/components/tools/ToolErrorCard.vue";
import GenericTool from "@/components/tools/GenericTool.vue";
import { getToolComponent } from "@/tools/toolRegistry";
import { buildToolRenderSpec } from "@/views/toolRenderSpec";
import { sanitiseMessageContent } from "@/lib/messageContentBackstop";

defineOptions({ name: "MessageBubble" });

// UI Parity bug-fix bundle (May 2026). P2-9: precedingUserPrompt is now
// an optional prop, hoisted to the parent's groupedMessages builder so
// each bubble's lookup is O(1). The internal computed remains as a
// fallback for callers that mount MessageBubble directly without
// pre-resolving the predecessor (existing tests, ad-hoc renders).
const props = defineProps<{
  message: Message;
  agentName?: string;
  precedingUserPrompt?: { id: string; content: string } | null;
  // Runtime-gate denial surfacing (May 2026 — PR7 follow-up). Optional
  // attribution label for the agent that produced THIS tool-invocation
  // row, surfaced as a chip on the tool card chrome. Resolved by the
  // parent (ChatView) from the agents registry so the bubble doesn't
  // re-scan on every chunk. When undefined, no chip is rendered —
  // existing callers (and the tool_result/tool_call paths that didn't
  // carry attribution pre-fix) keep their pre-fix appearance.
  agentLabel?: string;
  // Runtime-gate denial surfacing (May 2026 — PR7 follow-up). Optional
  // sibling-resolved adjacent tool_error message. When present and the
  // content matches the runtime-gate rejection signature (engine.go:4462
  // sprintf "Error: '%s' is not in this agent's allowed toolset…"), the
  // tool card surfaces a "denied by runtime gate" affordance + data-denied
  // attribute. Mirrors the P2-9 precedingUserPrompt prop hoist pattern:
  // an explicit value (including null) wins over the chatStore.messages
  // fallback. The parent's groupedMessages builder is the intended
  // caller; the fallback exists so isolated mounts (specs, ad-hoc
  // renders) still get the affordance.
  adjacentToolError?: { content: string } | null;
}>();

const chatStore = useChatStore();

// Inline delegation cards — rendered in the chat thread like tool messages.
// Clickable agent link to navigate to the child session. The live-ticking
// duration chip on in-flight cards reads from a shared clock (useNow) that
// ticks every second — a single module-level interval shared by all
// MessageBubble instances, so in-flight cards don't create N timers.

const { now } = useNow();

async function loadDelegatedSession(): Promise<void> {
  if (!props.message.targetAgent) return;
  await chatStore.loadSessionForDelegation({
    chainId: props.message.chainId,
    agentId: props.message.targetAgent,
    childSessionId: props.message.childSessionId,
  });
}

const elapsedLabel = computed(() => {
  const startedAt = Date.parse(props.message.timestamp);
  if (Number.isNaN(startedAt)) return "0s";
  const seconds = Math.max(0, Math.floor((now.value - startedAt) / 1000));
  return formatElapsed(seconds);
});

// Shared formatter: converts a duration in seconds to a human-readable label
// like "3s", "2m 30s", "1h 15m". Used by both the live timer on in-flight
// delegations and the static elapsed display on completed delegation
// attachments.
function formatElapsed(totalSeconds: number): string {
  if (totalSeconds < 0) return "0s";
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const rem = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${rem}s`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes}m`;
}

const hasProgress = computed(
  () =>
    typeof props.message.toolCalls === "number" ||
    typeof props.message.lastTool === "string",
);

const isDelegationStarted = computed(
  () => props.message.role === "delegation_started",
);
const isDelegation = computed(() => props.message.role === "delegation");

// Elapsed time for a completed delegation message, computed by finding
// the paired delegation_started message (matched via chainId) and using
// the delta between their timestamps. Returns undefined when there is no
// matching started message (edge case: orphaned delegation on reload).
const elapsedForDelegation = computed(() => {
  const chainId = props.message.chainId;
  if (!chainId) return undefined;
  const started = chatStore.messages.find(
    (m) => m.role === "delegation_started" && m.chainId === chainId,
  );
  if (!started?.timestamp || !props.message.timestamp) return undefined;
  const startTs = Date.parse(started.timestamp);
  const endTs = Date.parse(props.message.timestamp);
  if (Number.isNaN(startTs) || Number.isNaN(endTs)) return undefined;
  return Math.max(0, Math.floor((endTs - startTs) / 1000));
});

// B2 (May 2026). isThinking gates the new ThinkingPanel render path
// only when there is something to show — either thinkingBlocks with
// at least one non-empty thinking field, or non-empty content. A
// thinking-role message with neither falls through to the wrapper
// gate and is suppressed (matches the May 2026 blank-bubble gate
// from commit 4c0cee54).
const isThinking = computed(() => {
  if (props.message.role !== "thinking") return false;
  const blocks = props.message.thinkingBlocks ?? [];
  if (blocks.some((b) => (b.thinking ?? "").trim().length > 0)) return true;
  return (props.message.content ?? "").trim().length > 0;
});

// B2 (Vue UI Parity vs OpenCode, May 2026). Thinking content sections.
//
// Per the brief, `thinkingBlocks[]` is the better data source —
// the engine persists per-block thinking with optional signatures
// (Anthropic extended-thinking signed blocks, etc). One ThinkingPanel
// per block lets the user disclose them independently.
//
// Legacy thinking-role messages on disk carry `content` populated
// but no `thinkingBlocks` array. The fallback path uses the joined
// content string so older sessions keep rendering.
//
// Each section's text is filtered to non-empty — a thinking block
// with both `thinking` and (e.g.) `redacted` fields is rare on the
// wire but the filter keeps the panel array stable.
const thinkingSections = computed<string[]>(() => {
  if (!isThinking.value) return [];
  const blocks = props.message.thinkingBlocks ?? [];
  if (blocks.length > 0) {
    return blocks
      .map((b) => (b.thinking ?? "").trim())
      .filter((t) => t.length > 0);
  }
  const content = (props.message.content ?? "").trim();
  return content.length > 0 ? [content] : [];
});

// Thinking-only degraded turn — closes the UI follow-up flagged by
// `Empty-Content Thinking-Only Assistant Turn (May 2026)` in the
// FlowState vault. The session accumulator synthesises a placeholder
// assistant Message (commit fbecedfe and siblings) when an OpenAI-
// compat reasoning provider produces reasoning tokens but never emits
// visible content. The placeholder shape on the wire is:
//
//   { role: "assistant", content: "", thinkingBlocks: [...], stopReason: "..." }
//
// Without a UI render branch the user sees a blank bubble — visually
// indistinguishable from a stalled stream. The soft-error affordance
// surfaces "the agent thought but produced no response", a third UX
// class alongside (a) a stalled stream (no bubble at all) and (b) a
// critical stream error (CriticalErrorBanner, role="alert"). This
// affordance uses role="status" (informational) — the turn already
// finished, the user is being told *after the fact* that it produced
// no visible reply.
//
// The predicate is intentionally narrow: ALL three signals must be
// present. That matches the synthesis predicate on the Go side
// (`contentBuf.Len() == 0 && len(thinkingBlocks) > 0` plus a non-empty
// stop_reason from the upstream) and means a non-placeholder empty
// assistant — e.g. a true stall, or a placeholder synthesised by some
// future error path that doesn't carry thinking blocks — does not
// collide with this rendering.
const isThinkingOnlyDegraded = computed(() => {
  if (props.message.role !== "assistant") return false;
  if ((props.message.content ?? "") !== "") return false;
  const thinkingBlocks = props.message.thinkingBlocks ?? [];
  if (thinkingBlocks.length === 0) return false;
  if (!props.message.stopReason) return false;
  return true;
});

// Empty-turn placeholder render branch — bug fix #27 (May 11 2026).
//
// Slice C (commit a3486538) added `handleStreamDone` logic that pushes an
// empty_turn placeholder into chatStore.messages when [DONE] arrives with
// no running assistant — the engine's synthesizePlaceholderAssistant did
// not emit one and the user prompt would otherwise sit there with no
// follow-up artefact at all. The store-side push shipped but no
// MessageBubble v-else-if consumed the new shape, so true empty turns
// (no content, no thinking, no tool_calls — Anthropic / OpenAI return
// this occasionally) were silently swallowed. The agent-block-render-gate
// follow-up (commit 4c0cee54) added hasRenderableContent which then
// suppressed the wrapper entirely for this shape — making the silent
// swallow load-bearing.
//
// The fix: a dedicated v-else-if branch that surfaces the SAME soft-error
// affordance copy the thinking-only-degraded branch uses ("Reply didn't
// come through" — commit 87c114c8 wording). The user-facing UX is the
// same: the model stopped before replying, try again. The two cases
// stay logically distinct (thinking-only carries reasoning tokens, empty
// turn carries nothing) but the user doesn't need to disambiguate.
//
// The predicate is narrow: assistant role + empty content + empty
// thinkingBlocks + stopReason === 'empty_turn'. The empty-thinkingBlocks
// guard prevents collision with isThinkingOnlyDegraded — if both
// branches matched, the v-else-if order would silently decide which
// fires, masking future state-machine bugs.
const isEmptyTurn = computed(() => {
  if (props.message.role !== "assistant") return false;
  if ((props.message.content ?? "") !== "") return false;
  const thinkingBlocks = props.message.thinkingBlocks ?? [];
  if (thinkingBlocks.length > 0) return false;
  return props.message.stopReason === "empty_turn";
});

// Fabricated-completion annotation — Bug 1 (backend commit b23455b8
// stamped `StopReason = "fabricated_completion"` on assistant turns
// where the content matches a completion-claim signature ("written
// to", "persisted to", "saved to", "created the file", "✅") AND the
// turn produced no tool_call and no delegation; see
// `internal/session/accumulator.go:826-828` for the stamp predicate).
//
// The UI surfaces this as a NON-BLOCKING warning banner layered above
// the existing plain-render path: the message body may still contain
// useful planning/analysis, so we annotate rather than replace. The
// banner uses `role="status"` (mirrors the thinking-only-affordance
// pattern) — informational, not assertive; CriticalErrorBanner owns
// the `role="alert"` surface.
//
// Predicate is intentionally narrow: assistant role + exact sentinel
// match. Other stopReasons (`empty_turn`, `thinking_only`,
// `end_turn`, `tool_use`) flow through their existing branches
// untouched.
const isFabricatedCompletion = computed(
  () =>
    props.message.role === "assistant" &&
    props.message.stopReason === "fabricated_completion",
);

// Both tool_result and an unmatched tool_call (one without a paired
// tool_result — collapseToolPairs leaves it intact) render through the
// same per-tool component. The collapsable card chrome already signals
// "this is a tool invocation", so a separate "TOOL_CALL" role label
// would be redundant.
const isToolInvocation = computed(
  () =>
    props.message.role === "tool_result" || props.message.role === "tool_call",
);
const isToolError = computed(() => props.message.role === "tool_error");

const toolSpec = computed(() => buildToolRenderSpec(props.message));

const toolStatus = computed<"pending" | "running" | "completed" | "error">(
  () => {
    if (props.message.status === "error") return "error";
    if (props.message.status === "running") return "running";
    if (props.message.status === "pending") return "pending";
    return "completed";
  },
);

const toolComponent = computed(() => {
  return getToolComponent(toolSpec.value.toolName) ?? GenericTool;
});

// Empty-content assistant suppression — May 10 2026 follow-up to user
// feedback: "Are we outputting an agent response, along with a tool call?
// If so, this seems broken. We should just return the tool calls. Agent
// blocks are for when an agent *actually* has a response."
//
// Two store paths leave a sealed assistant message with empty content:
//
//   1. handleToolCallEvent (chatStore.ts:2509-2511) seals any in-flight
//      assistant placeholder when a tool_call SSE event arrives. If the
//      turn went straight to tool use without first emitting any content
//      chunks, the sealed placeholder carries content === '' and tool_call /
//      tool_result rows in the message list ARE the response.
//   2. The Streaming Coherence Slice C empty_turn placeholder pushed by
//      handleStreamDone carries content === '' + stopReason === 'empty_turn'
//      and no thinkingBlocks. This shape is now consumed by the
//      isEmptyTurn render branch above (bug fix #27, May 11 2026) — the
//      v-else-if ordering routes it there before this suppression matters.
//
// Without this gate `isPlain` rendered the assistant chrome (role label,
// empty MarkdownRenderer, copy-button-with-empty-text) for case 1,
// producing a phantom agent block alongside the tool cards. The gate is
// narrow: assistant role + content (after trim) is empty. The
// thinking-only-degraded and empty-turn branches match their own
// predicates first (`v-else-if` runs in order) so their affordances
// surface correctly.
const hasVisibleAssistantContent = computed(
  () =>
    props.message.role !== "assistant" ||
    (props.message.content ?? "").trim().length > 0,
);

const isPlain = computed(
  () =>
    !isToolInvocation.value &&
    !isToolError.value &&
    !isDelegationStarted.value &&
    !isDelegation.value &&
    !isThinking.value &&
    !isThinkingOnlyDegraded.value &&
    !isEmptyTurn.value &&
    hasVisibleAssistantContent.value,
);

// Outer wrapper gate — May 11 2026 follow-up. User: "We should not see
// `<div class="message-bubble assistant" ...><!--v-if--></div>` if there
// is no data." Pre-fix the `<div class="message-bubble">` rendered
// unconditionally; when every inner `v-if`/`v-else-if` branch was false
// the result was an empty styled box (padding + border + border-radius)
// visible as a blank card. The wrapper itself must now gate on at least
// one render branch matching.
const hasRenderableContent = computed(
  () =>
    isToolInvocation.value ||
    isToolError.value ||
    isDelegationStarted.value ||
    isDelegation.value ||
    isThinking.value ||
    isThinkingOnlyDegraded.value ||
    isEmptyTurn.value ||
    isPlain.value,
);

// Defensive backstop for the May 2026 chat-UI leak class (session
// 2d8dc0ac). The backend is the primary fix surface — see
// internal/streaming.IsControlEvent, internal/engine.UnwrapTaskResult,
// internal/engine.sanitiseTaskError. This computed catches anything
// that slips through (e.g. session loaded from disk persisted before
// the fix shipped) so non-technical users never see raw harness JSON,
// `<task_result>` markers, or provider stack traces in the chat bubble.
// The friendly fallback string is rendered verbatim — no markdown
// processing — to avoid re-introducing exotic content via the same
// surface the backstop is protecting.
const sanitisedAssistantContent = computed(() =>
  sanitiseMessageContent(props.message.content ?? ""),
);
const sanitisedPlainContent = computed(() =>
  sanitiseMessageContent(props.message.content ?? ""),
);

const displayRole = computed(() =>
  props.message.role === "assistant" && props.agentName
    ? props.agentName
    : props.message.role,
);

// Copy affordance: surface a clipboard button on the user's own messages
// and on assistant replies, mirroring the convention already used inside
// tool-call cards. Tool/delegation/thinking branches each have their own
// chrome (or are non-content), so they intentionally opt out.
const showCopyButton = computed(
  () =>
    isPlain.value &&
    (props.message.role === "assistant" || props.message.role === "user"),
);

// Revert affordance: only user messages can be reverted. Clicking revert
// truncates the session at this message and pre-fills the composer so the
// user can edit and re-send without re-typing.
const showRevertButton = computed(
  () => isPlain.value && props.message.role === "user",
);

// UI Parity I7 (May 2026) — Regenerate affordance on assistant messages.
// Mirrors OpenCode's "regenerate this reply" gesture. Resolves the
// preceding user message in chatStore.messages (the prompt that produced
// this reply), then calls revertToMessage(userId) to truncate +
// sendMessage(prompt) to re-send. Keeps current agent/model untouched —
// the chatStore action targets the active session+agent.
//
// Defensive: if no preceding user message can be found (orphan reply,
// truncated history, malformed thread), the button is hidden rather
// than surfacing a no-op click. Less surprising for the user.
//
// P2-9 (May 2026 bug-fix bundle): prefer the `precedingUserPrompt`
// prop when supplied — the parent's groupedMessages builder resolves
// the predecessor once, so the bubble doesn't re-scan chatStore.messages
// on every chunk (O(N²) cost on long sessions during streaming). When
// the prop is undefined we fall back to the legacy local computed so
// existing callers (and unit tests that don't pass the prop) keep
// working. An EXPLICIT null prop is respected: the parent has told us
// there is no preceding prompt, hide the affordance.
const precedingUserPrompt = computed<{ id: string; content: string } | null>(
  () => {
    // Explicit prop wins (including explicit null).
    if (props.precedingUserPrompt !== undefined) {
      return props.precedingUserPrompt;
    }
    if (props.message.role !== "assistant") return null;
    // Defensive: chatStore.messages may be undefined in test mocks that
    // don't seed the array. Treat that as "no preceding prompt" so the
    // Regenerate affordance hides cleanly.
    const messages = chatStore.messages;
    if (!Array.isArray(messages)) return null;
    const idx = messages.findIndex((m) => m.id === props.message.id);
    if (idx <= 0) return null;
    for (let i = idx - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.role === "user") {
        return { id: m.id, content: m.content };
      }
    }
    return null;
  },
);

// UI Parity bug-fix bundle (May 2026). P1-7: Regenerate clicked
// mid-stream calls revertToMessage which disconnects whatever session
// is currently streaming, silently killing a different in-flight turn.
// Gate the button on "no stream in flight anywhere" so the user
// physically cannot trigger the cascade. We check the per-session map
// AND the legacy flat flags (some test mounts set the flats directly
// without seeding the map).
const anyStreamInFlight = computed<boolean>(() => {
  // streamingFor is the canonical per-session getter; consult it via
  // the active session and any other slot. The flat fields back up the
  // null-session fast path.
  const sessionMap = chatStore.sessionStreaming ?? {};
  for (const slot of Object.values(sessionMap)) {
    if (slot.isStreaming || slot.isLoading) return true;
  }
  return Boolean(chatStore.isStreaming) || Boolean(chatStore.isLoading);
});

const showRegenerateButton = computed(
  () =>
    isPlain.value &&
    props.message.role === "assistant" &&
    precedingUserPrompt.value !== null &&
    !anyStreamInFlight.value,
);

// Failure marker: when a user-message send rejects (network error, backend
// rejection), chatStore marks the optimistic bubble status='failed'. We
// surface that with a small visible affordance so the user can see at a
// glance which message didn't go through. Toast is the loud surfacing;
// this is the persistent indicator on the bubble itself.
const isFailedSend = computed(
  () => props.message.role === "user" && props.message.status === "failed",
);

// Backend-owned prompt queue (May 2026) — transient status indicators on
// user bubbles. 'queued' means the backend accepted the prompt into its
// per-session queue (202) and it is waiting for a turn slot; 'cancelled'
// means the user retracted it via DELETE /queue/{prompt_id}; 'session-ended'
// is the terminal state when a queued prompt never starts (session deleted
// or the watch budget elapsed). Each surfaces as a small role="status"
// chip mirroring the failed-marker affordance.
const isQueuedPrompt = computed(
  () => props.message.role === "user" && props.message.status === "queued",
);
const isCancelledPrompt = computed(
  () => props.message.role === "user" && props.message.status === "cancelled",
);
const isSessionEndedPrompt = computed(
  () => props.message.role === "user" && props.message.status === "session-ended",
);
const queuedPositionLabel = computed(() =>
  typeof props.message.queuePosition === "number"
    ? `Queued · position ${props.message.queuePosition}`
    : "Queued",
);

// Per-message cancel affordance (inline queued bubbles — May 2026 refactor).
// The queue is no longer a separate strip below the thread; the queued user
// bubble itself carries the cancel control. Wired to the SAME store action
// the strip used (cancelQueuedPrompt → DELETE /sessions/{id}/queue/{prompt_id})
// so the queue state machine and API contract are untouched. Only present
// while the prompt is still queued and carries a backend promptId; once the
// turn starts (status flips to 'streaming') the bubble drops the queued
// chrome and this control disappears with it.
async function handleCancelQueued(): Promise<void> {
  const promptId = props.message.promptId
  const sessionId = chatStore.currentSessionId
  if (!promptId || !sessionId) return
  await chatStore.cancelQueuedPrompt(sessionId, promptId)
}

// Runtime-gate denial detector (May 2026 — PR7 follow-up to commit 4b25f026).
//
// The engine's runtime tool gate at engine.go:4459-4475 rejects a tool
// dispatch when the requested name is not in the agent's effective
// toolset and writes a synthetic tool_error row carrying the message:
//
//   "Error: '<tool>' is not in this agent's allowed toolset. Available
//    tools: [<list>]. Delegate to a specialist whose toolset includes
//    '<tool>' if the work requires it."
//
// (engine.go:4462 sprintf — same wording as the user-facing copy.) The
// accumulator stamps both the rejected tool_call and the resulting
// tool_error with the same AgentID (accumulator.go:605, 633) and writes
// them adjacently.
//
// The detector keys off the stable substring "not in this agent's
// allowed toolset" rather than the full template — the [tool] name and
// available-tools list vary, the rejection clause is invariant. This
// distinguishes a real tool failure (bash exit 1, ENOENT, etc) from a
// gate rejection so the affordance is narrow.
//
// Source resolution mirrors precedingUserPrompt (P2-9, May 2026):
//   1. Explicit `adjacentToolError` prop wins. An explicit `null` means
//      "the parent resolved there is no adjacent error" and suppresses
//      the fallback — same explicit-null contract precedingUserPrompt
//      uses.
//   2. Undefined prop falls back to chatStore.messages: locate this
//      bubble's message by id, peek at the next index, treat it as the
//      adjacent message when its role is `tool_error`.
//
// The detector only fires on a tool-invocation render branch
// (isToolInvocation). A tool_error row itself does not surface the
// affordance — the ToolErrorCard already renders the rejection content;
// the affordance is the LINK back to the attempt and belongs on the
// tool-call card upstream.
const GATE_REJECTION_SIGNATURE = "not in this agent's allowed toolset";

const adjacentToolErrorContent = computed<string | null>(() => {
  // Explicit prop (including null) takes precedence.
  if (props.adjacentToolError !== undefined) {
    return props.adjacentToolError === null
      ? null
      : props.adjacentToolError.content;
  }
  // Fallback: scan chatStore.messages for adjacency. Defensive against
  // test mocks that don't seed the array.
  const messages = chatStore.messages;
  if (!Array.isArray(messages)) return null;
  const idx = messages.findIndex((m) => m.id === props.message.id);
  if (idx < 0 || idx >= messages.length - 1) return null;
  const next = messages[idx + 1];
  if (!next || next.role !== "tool_error") return null;
  return next.content ?? "";
});

const isDeniedByGate = computed<boolean>(() => {
  if (!isToolInvocation.value) return false;
  const content = adjacentToolErrorContent.value;
  if (typeof content !== "string" || content.length === 0) return false;
  return content.includes(GATE_REJECTION_SIGNATURE);
});

// Agent attribution chip — surfaces the agent that produced THIS tool
// invocation. Opt-in via the agentLabel prop so legacy callers keep
// their pre-fix appearance. The chip applies only to tool-invocation
// rows (tool_call / tool_result); plain assistant content already
// renders the agent display name via .message-role.
const showAgentChip = computed<boolean>(
  () => isToolInvocation.value && typeof props.agentLabel === "string" && props.agentLabel.length > 0,
);

// Permission Mode ModeAskUser Extension plan (May 2026), Slice 3 — the
// inline PermissionPrompt anchors to the suspended tool_call bubble.
// Match by tool_name (the bubble's owning tool's name vs the
// permission request's tool_name) — the engine publishes the
// permission_required event with exactly the tool_name the gate
// rejected. Concurrent prompts on different tools (plan §5) anchor
// independently because each tool_call bubble matches its own
// pending entry.
//
// First-match wins on the same-tool-name concurrency edge (R2): two
// in-flight prompts for "read" with different resources both surface,
// the older one first by insertion order of the pendingPermissionRequests
// record. v1 acceptable — the prompts render in stack order; once one
// resolves the next becomes the lookup hit.
const pendingPermissionForBubble = computed(() => {
  if (!isToolInvocation.value) return null;
  const targetTool = props.message.toolName;
  if (!targetTool) return null;
  // Defensive: card-chrome / fixture tests mount this component with a
  // stub chatStore that omits the Slice 3 fields. `Object.values` on an
  // undefined value throws — guarding here keeps existing specs that
  // pre-date this surface from regressing.
  const pending = chatStore.pendingPermissionRequests;
  if (!pending) return null;
  for (const entry of Object.values(pending)) {
    if (entry?.tool_name === targetTool && entry.status === "pending") {
      return entry;
    }
  }
  return null;
});

async function handleRevert(): Promise<void> {
  await chatStore.revertToMessage(props.message.id);
}

// I7 — Regenerate: truncate back to the preceding user prompt then
// re-send it as a new turn. The revertToMessage call kills any in-flight
// stream + truncates the session; sendMessage then re-issues the prompt
// against the current agent/model. We capture the prompt content BEFORE
// the revert because revertToMessage may invalidate `precedingUserPrompt`
// once messages get sliced.
async function handleRegenerate(): Promise<void> {
  const target = precedingUserPrompt.value;
  if (!target) return;
  await chatStore.revertToMessage(target.id);
  await chatStore.sendMessage(target.content);
}
</script>

<template>
  <div
    v-if="hasRenderableContent"
    class="message-bubble"
    :class="[
      props.message.role,
      {
        'message-bubble--failed': isFailedSend,
        'message-bubble--queued': isQueuedPrompt,
      },
    ]"
    :data-testid="`message-${props.message.role}`"
    :data-role="props.message.role"
    :data-status="props.message.status ?? ''"
  >
    <!--
      Fabricated-completion warning (Bug 1, backend commit b23455b8).
      Layered ABOVE the v-if/v-else-if render chain — both this banner
      AND the matching content branch (typically `isPlain`) fire on
      the same bubble. The banner annotates the unverified claim
      without suppressing the prose underneath, since the message body
      may still hold useful planning or analysis text. Distinct
      data-testid from the soft-error affordances so probes can target
      this specific signal.
    -->
    <div
      v-if="isFabricatedCompletion"
      class="fabricated-completion-warning"
      role="status"
      data-testid="fabricated-completion-warning"
    >
      <span class="fabricated-completion-icon" aria-hidden="true">!</span>
      <div class="fabricated-completion-content">
        <span class="fabricated-completion-title"
          >Unverified completion claim</span
        >
        <span class="fabricated-completion-message">
          The model reported finishing work, but no tool action was recorded
          for this turn. Treat the claim as unsubstantiated until you've
          confirmed it.
        </span>
      </div>
    </div>

    <!--
      Tool-invocation chrome — May 2026 PR7 follow-up wraps the per-tool
      component in a container that carries the agent-attribution chip
      and the runtime-gate denial affordance. The per-tool component
      itself stays untouched (one tool invocation = one card chrome);
      the chip + affordance layer in this wrapper without changing the
      registered tool renderer's contract.

      `data-denied` is the e2e probe + future styling hook — when the
      detector matches (isToolInvocation + adjacent tool_error content
      contains the gate-rejection signature) the attribute flips to
      "true" and the affordance is announced via role="status".
    -->
    <div
      v-if="isToolInvocation"
      class="tool-invocation"
      :class="{ 'tool-invocation--denied': isDeniedByGate }"
      :data-denied="isDeniedByGate ? 'true' : undefined"
    >
      <div
        v-if="showAgentChip || isDeniedByGate || props.message.elapsedMs !== undefined"
        class="tool-invocation-header"
      >
        <span
          v-if="showAgentChip"
          class="tool-card-agent-chip"
          data-testid="tool-card-agent-chip"
          :data-agent-id="props.message.agentId || undefined"
          :aria-label="`Attempted by agent ${props.agentLabel}`"
        >
          <span class="tool-card-agent-chip__icon" aria-hidden="true">@</span>
          <span class="tool-card-agent-chip__label">{{ props.agentLabel }}</span>
        </span>
        <span
          v-if="isDeniedByGate"
          class="tool-card-denied-affordance"
          data-testid="tool-card-denied-affordance"
          role="status"
          :aria-label="`Tool call denied by runtime gate — not in this agent's allowed toolset`"
        >
          <span class="tool-card-denied-affordance__icon" aria-hidden="true"
            >&#x26D4;</span
          >
          <span class="tool-card-denied-affordance__label">
            Denied by runtime gate — tool not in this agent's allowed toolset
          </span>
        </span>
        <span
          v-if="props.message.elapsedMs !== undefined"
          class="tool-card-elapsed"
          data-testid="tool-card-elapsed"
        >{{ formatElapsed(Math.round(props.message.elapsedMs / 1000)) }}</span>
      </div>
      <component
        :is="toolComponent"
        :tool-name="toolSpec.toolName"
        :heading="toolSpec.heading"
        :body="toolSpec.body"
        :status="toolStatus"
        :tool-input="props.message.toolInput"
        data-testid="tool-renderer"
      />
      <!--
        Permission Mode ModeAskUser Extension plan (May 2026), Slice 3.
        Inline PermissionPrompt anchored beneath the suspended
        tool_call's render. Visible only when a pending permission
        request exists for this bubble's tool — see
        pendingPermissionForBubble for the match rule. Granted /
        denied / timeout transitions remove the entry from
        chatStore.pendingPermissionRequests via pollTurnUntilTerminal's
        diff so the prompt unmounts cleanly across both tabs (R5).
      -->
      <PermissionPrompt
        v-if="pendingPermissionForBubble"
        :request="pendingPermissionForBubble"
      />
    </div>

    <ToolErrorCard
      v-else-if="isToolError"
      :tool-name="props.message.toolName || 'error'"
      :heading="props.message.toolName || 'Error'"
      :body="props.message.content"
      data-testid="tool-error-renderer"
    />

    <!--
      Delegation cards — rendered inline in the chat thread like tool
      messages. The started variant shows a live timer and progress;
      the completed variant shows a summary. Clicking the agent name
      navigates to the child session. Both use the same card chrome
      (left accent border, elevated background) as tool invocations.
    -->
    <div
      v-else-if="isDelegationStarted"
      class="delegation-card delegation-card--inflight"
      data-testid="delegation-started-card"
    >
      <span
        class="delegation-spinner"
        aria-hidden="true"
        data-testid="delegation-spinner"
      />
      <div class="delegation-body">
        <div class="delegation-header">
          <button
            type="button"
            class="delegation-agent-link"
            data-testid="delegation-agent-link"
            @click="loadDelegatedSession"
          >
            {{ props.message.targetAgent || "Agent" }}
          </button>
        </div>
        <p
          v-if="props.message.description || props.message.content"
          class="delegation-content"
          data-testid="delegation-content"
        >{{ props.message.description || props.message.content }}</p>
        <div class="delegation-footer">
          <div
            v-if="hasProgress"
            class="delegation-progress"
            data-testid="delegation-progress"
          >
            <span class="delegation-progress-count">
              {{ props.message.toolCalls ?? 0 }} tool calls
            </span>
            <span
              v-if="props.message.lastTool"
              class="delegation-progress-tool"
            >· {{ props.message.lastTool }}</span>
          </div>
          <div class="delegation-footer-end">
            <span
              v-if="props.message.modelName"
              class="delegation-chip"
              data-testid="delegation-model-chip"
            >{{ props.message.modelName }}</span>
            <span
              v-if="props.message.providerName"
              class="delegation-chip delegation-chip--provider"
              data-testid="delegation-provider-chip"
            >{{ props.message.providerName }}</span>
            <div class="delegation-status-group">
              <span
                class="delegation-live-badge"
                data-testid="delegation-live-badge"
              >Live</span>
              <span
                class="delegation-elapsed"
                data-testid="delegation-elapsed"
              >{{ elapsedLabel }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!--
      Completed delegation card — rendered inline in the chat thread like
      the in-flight variant, but with a checkmark and static elapsed time
      instead of a spinner and live timer. Clicking the agent name
      navigates to the child session.
    -->
    <div
      v-else-if="isDelegation"
      class="delegation-card delegation-card--done"
      data-testid="delegation-completed-card"
    >
      <span class="delegation-done-marker" aria-hidden="true">&#x2713;</span>
      <div class="delegation-body">
        <div class="delegation-header">
          <button
            type="button"
            class="delegation-agent-link"
            data-testid="delegation-completed-agent-link"
            @click="loadDelegatedSession"
          >
            {{ props.message.targetAgent || "Agent" }}
          </button>
        </div>
        <p
          v-if="props.message.description || props.message.content"
          class="delegation-content"
          data-testid="delegation-content"
        >{{ props.message.description || props.message.content }}</p>
        <div class="delegation-footer">
          <div
            v-if="hasProgress"
            class="delegation-progress"
            data-testid="delegation-progress"
          >
            <span class="delegation-progress-count">
              {{ props.message.toolCalls ?? 0 }} tool calls
            </span>
            <span
              v-if="props.message.lastTool"
              class="delegation-progress-tool"
            >· {{ props.message.lastTool }}</span>
          </div>
          <div class="delegation-footer-end">
            <span
              v-if="props.message.modelName"
              class="delegation-chip"
              data-testid="delegation-model-chip"
            >{{ props.message.modelName }}</span>
            <span
              v-if="props.message.providerName"
              class="delegation-chip delegation-chip--provider"
              data-testid="delegation-provider-chip"
            >{{ props.message.providerName }}</span>
            <span
              v-if="elapsedForDelegation !== undefined"
              class="delegation-elapsed"
              data-testid="delegation-elapsed"
            >{{ formatElapsed(elapsedForDelegation) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!--
      B2 (Vue UI Parity vs OpenCode, May 2026). Replace the flat
      `<p class="thinking">` with one ThinkingPanel per reasoning
      block. Collapsible by default, content routed through
      MarkdownRenderer so embedded code highlights via Shiki (B1).
    -->
    <template v-else-if="isThinking">
      <ThinkingPanel
        v-for="(section, idx) in thinkingSections"
        :key="idx"
        :content="section"
      />
    </template>

    <!--
      Soft-error affordance copy reword (May 7 2026, follow-up to commit
      0f27ac98). User feedback: "Why do we have a message about the agent
      not having a response. That seems pretty weird." The previous
      "No response produced / agent thought through this turn but
      produced no response" wording read as a system bug report and gave
      the user nothing actionable. The reword aims for the same register
      as the amber `role="status"` palette: less alarming than an error,
      conversational, and bearing a clear next step (re-prompt). The
      trigger predicate, palette, and role are unchanged — copy only.
    -->
    <div
      v-else-if="isThinkingOnlyDegraded"
      class="thinking-only-affordance"
      role="status"
      data-testid="thinking-only-affordance"
    >
      <span class="thinking-only-icon" aria-hidden="true">!</span>
      <div class="thinking-only-content">
        <span class="thinking-only-title">Reply didn't come through</span>
        <span class="thinking-only-message">
          The model worked through this turn but stopped before replying. Try
          sending the prompt again.
        </span>
      </div>
    </div>

    <!--
      Empty-turn placeholder affordance — bug fix #27 (May 11 2026).
      Pre-fix the empty_turn placeholder pushed by handleStreamDone
      (chatStore.ts) reached this template with no matching v-else-if
      and was silently swallowed by the hasRenderableContent gate (commit
      4c0cee54). Reuses the same UX vocabulary as the thinking-only
      branch above ("Reply didn't come through" — commit 87c114c8) since
      from the user's perspective both states are "the model didn't
      reply, try again". The two paths stay separate at the predicate
      level so future divergence (e.g. distinct retry affordance) is a
      narrow edit, not an unwind.
    -->
    <div
      v-else-if="isEmptyTurn"
      class="thinking-only-affordance"
      role="status"
      data-testid="empty-turn-affordance"
    >
      <span class="thinking-only-icon" aria-hidden="true">!</span>
      <div class="thinking-only-content">
        <span class="thinking-only-title">Reply didn't come through</span>
        <span class="thinking-only-message">
          The model finished without producing a reply. Try sending the prompt
          again.
        </span>
      </div>
    </div>

    <template v-else-if="isPlain">
      <span class="message-role">{{ displayRole }}</span>
      <!--
        User-message markdown rendering (May 2026 — UI Parity follow-up to
        PR1 commit c07132a7). Pre-fix, user messages rendered as a bare
        `<p class="message-content">` text node, so a fenced code block
        typed by the user looked like plain text where the same block in
        an assistant reply looked like an IDE. We now route user AND
        assistant content through MarkdownRenderer — same Shiki-powered
        path, same html:false posture, same M6 link allowlist. System
        messages keep the legacy `<p>` rendering: their content is
        engine-synthesised (banners, timestamps) and shouldn't be
        markdown-interpreted. The sanitiseMessageContent backstop runs
        on both branches.
      -->
      <MarkdownRenderer
        v-if="
          props.message.role === 'assistant' || props.message.role === 'user'
        "
        :content="
          props.message.role === 'assistant'
            ? sanitisedAssistantContent.content
            : sanitisedPlainContent.content
        "
        :data-leak-backstop="
          (props.message.role === 'assistant'
            ? sanitisedAssistantContent.appliedFilter
            : sanitisedPlainContent.appliedFilter) || undefined
        "
      />
      <p
        v-else
        class="message-content"
        :data-leak-backstop="sanitisedPlainContent.appliedFilter || undefined"
      >
        {{ sanitisedPlainContent.content }}
      </p>
      <div v-if="showCopyButton" class="message-actions">
        <span
          v-if="isFailedSend"
          class="failed-marker"
          data-testid="message-failed-marker"
          role="status"
          title="Message failed to send"
          >&#x26A0; Failed to send</span
        >
        <span
          v-else-if="isQueuedPrompt"
          class="queued-badge"
          data-testid="message-queued-marker"
          role="status"
          :title="queuedPositionLabel"
        >
          <span class="queued-badge-icon" aria-hidden="true">&#x23F3;</span>
          <span class="queued-badge-label">{{ queuedPositionLabel }}</span>
        </span>
        <span
          v-else-if="isCancelledPrompt"
          class="failed-marker"
          data-testid="message-cancelled-marker"
          role="status"
          title="Queued prompt cancelled"
          >&#x2715; Cancelled</span
        >
        <span
          v-else-if="isSessionEndedPrompt"
          class="failed-marker"
          data-testid="message-session-ended-marker"
          role="status"
          title="The session ended before this queued prompt started"
          >&#x26A0; Session ended</span
        >
        <button
          v-if="isQueuedPrompt && props.message.promptId"
          type="button"
          class="queued-cancel-button"
          data-testid="message-queued-cancel-btn"
          title="Cancel queued prompt"
          @click="handleCancelQueued"
        >
          <span aria-hidden="true">&#x2715;</span>
          <span class="queued-cancel-text">Cancel</span>
        </button>
        <button
          v-if="showRevertButton"
          type="button"
          class="revert-button"
          data-testid="message-revert-btn"
          title="Revert to this message"
          @click="handleRevert"
        >
          &#x21A9; Revert
        </button>
        <button
          v-if="showRegenerateButton"
          type="button"
          class="revert-button"
          data-testid="message-regenerate-btn"
          title="Regenerate this reply"
          @click="handleRegenerate"
        >
          &#x21BB; Regenerate
        </button>
        <CopyButton
          data-testid="message-copy-btn"
          :text="props.message.content"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.message-bubble {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.75rem 1rem;
  border-radius: var(--radius);
  max-width: 85%;
  /*
   * UI Parity I6 (May 2026): swap word-break: break-word →
   * overflow-wrap: anywhere. break-word splits on character boundaries
   * mid-word ONLY when the existing soft-break opportunities don't fit,
   * which makes URLs and IDs disappear off the right edge in some
   * browsers before the engine attempts a hard split. `anywhere` is
   * the more aggressive sibling: it considers EVERY position a valid
   * break opportunity, so long unbreakable runs always wrap inside the
   * card. Pair with min-width: 0 on the flex parent so the bubble
   * shrinks to its container rather than forcing a horizontal
   * scrollbar on the chat pane. Matches OpenCode's overflow handling.
   */
  overflow-wrap: anywhere;
  min-width: 0;
  font-family: var(--font-mono);
}

.message-bubble.user {
  align-self: flex-end;
  background: var(--user-bubble);
  border: 1px solid var(--border);
}

.message-bubble.assistant {
  align-self: flex-start;
  background: var(--assistant-bubble);
  border: 1px solid var(--border);
}

.message-bubble.system {
  align-self: center;
  background: transparent;
  border: 1px dashed var(--border);
  opacity: 0.7;
  font-style: italic;
}

.message-role {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.message-bubble.user .message-role {
  color: var(--accent);
}
.message-bubble.assistant .message-role {
  color: var(--text-secondary);
}

.message-content {
  color: var(--text-primary);
  line-height: 1.6;
  white-space: pre-wrap;
  font-family: inherit;
}

/* Copy affordance row, anchored under the message body. Right-aligned to
 * keep the bubble's reading column clean. Matches the small-toolbar vibe
 * of the per-tool-card layout. */
.message-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
  margin-top: 0.35rem;
}

.revert-button {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.72rem;
  color: var(--text-muted);
  padding: 0.15rem 0.3rem;
  border-radius: var(--radius);
  font-family: inherit;
  transition:
    color 0.15s,
    background 0.15s;
}

.revert-button:hover {
  color: var(--accent);
  background: var(--bg-elevated);
}

/* Failed-send marker: shown when chatStore marks the optimistic user
 * message status='failed'. Persistent inline indicator paired with the
 * existing toast — minimum viable surfacing per PR-2 brief. Uses a danger
 * tint so it's visually distinct from the muted action buttons next to it. */
.failed-marker {
  font-size: 0.72rem;
  color: var(--danger, #f87171);
  padding: 0.15rem 0.3rem;
  user-select: none;
  letter-spacing: 0.02em;
}

/* Subtle red border on a failed user bubble so the failure is clear even
 * before the user reads the marker text. Doesn't replace the marker —
 * complements it. */
.message-bubble--failed.message-bubble.user {
  border-color: var(--danger, #f87171);
}

/* Inline queued prompt bubble (May 2026 refactor). Distinct from a normal
 * user bubble and from a failed send: the prompt has been accepted into the
 * backend queue (202) and is waiting for a turn slot. An amber/warning tint
 * on the border + a subtle elevated background set it apart from the plain
 * user bubble so the user can see at a glance which prompts are pending. */
.message-bubble--queued.message-bubble.user {
  border-color: var(--warning, #e0af68);
  background: var(--bg-elevated, var(--user-bubble));
}

/* Queued badge — the "Queued · position N" chip on an inline queued bubble.
 * Uses the warning palette (same register as the thinking-only affordance)
 * so it reads as "pending, not failed". role="status" is set in the markup. */
.queued-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
  background: var(--bg-secondary, transparent);
  border: 1px solid var(--warning, #e0af68);
  color: var(--warning, #e0af68);
  font-size: 0.72rem;
  user-select: none;
  letter-spacing: 0.02em;
}

.queued-badge-icon {
  line-height: 1;
}

.queued-badge-label {
  font-variant-numeric: tabular-nums;
}

/* Per-message cancel control on an inline queued bubble. Mirrors the
 * revert-button affordance (muted text button) but uses the danger tint on
 * hover so the destructive action is discoverable without shouting. */
.queued-cancel-button {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.72rem;
  color: var(--text-muted);
  padding: 0.15rem 0.3rem;
  border-radius: var(--radius);
  font-family: inherit;
  transition:
    color 0.15s,
    background 0.15s;
}

.queued-cancel-button:hover {
  color: var(--danger, #f87171);
  background: var(--bg-elevated);
}

.queued-cancel-text {
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: 0.7rem;
}

/* Tool blocks: collapsed by default, expand on click. opencode TUI vibe. */
.message-bubble.tool_result,
.message-bubble.tool_error {
  align-self: stretch;
  max-width: 100%;
  padding: 0;
  background: transparent;
  border: none;
}



.thinking {
  font-style: italic;
  color: var(--text-muted);
  opacity: 0.8;
  font-size: 0.85rem;
  line-height: 1.5;
  margin: 0;
}

/* Thinking-only degraded-turn affordance.
 *
 * Visual language mirrors CriticalErrorBanner's layout (icon + title +
 * message stacked) but uses the warning (--warning) palette instead of
 * the red --error palette so the user can tell the two surfaces apart
 * at a glance. CriticalErrorBanner = fatal stream failure (red,
 * role="alert", anchored at top of chat). This = degraded turn
 * (amber, role="status", inline in the conversation flow). */
.thinking-only-affordance {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.65rem 0.85rem;
  border: 1px solid var(--warning, #e0af68);
  border-left-width: 3px;
  border-radius: var(--radius);
  background: var(--bg-elevated, transparent);
  color: var(--text-primary);
  font-size: 0.85rem;
}

.thinking-only-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--warning, #e0af68);
  color: var(--bg-primary, #1a1b26);
  font-weight: 700;
  font-size: 0.85rem;
  line-height: 1;
}

.thinking-only-content {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  flex: 1;
  min-width: 0;
}

.thinking-only-title {
  font-weight: 600;
  color: var(--warning, #e0af68);
  font-size: 0.9rem;
}

.thinking-only-message {
  color: var(--text-secondary, var(--text-primary));
  word-wrap: break-word;
  line-height: 1.4;
}

/* Fabricated-completion warning banner — Bug 1.
 *
 * Visual language mirrors the thinking-only-affordance (--warning
 * palette, role="status", inline) because both surfaces communicate a
 * post-hoc, informational annotation about a degraded turn. The
 * fabricated case differs from thinking-only in semantics — the model
 * produced visible prose claiming a completion, but the recorded
 * tool history doesn't back the claim — so the banner sits ABOVE the
 * preserved content rather than replacing it. A subtle margin
 * separates it from the assistant content beneath.
 *
 * Colour comes from the theme's --warning token (see
 * web/src/assets/themes.css). The fallback hex matches the
 * thinking-only-affordance fallback so the visual register is
 * consistent across both warning surfaces.
 */
.fabricated-completion-warning {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.55rem 0.75rem;
  margin-bottom: 0.4rem;
  border: 1px solid var(--warning, #e0af68);
  border-left-width: 3px;
  border-radius: var(--radius);
  background: var(--bg-elevated, transparent);
  color: var(--text-primary);
  font-size: 0.82rem;
}

.fabricated-completion-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.15rem;
  height: 1.15rem;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--warning, #e0af68);
  color: var(--bg-primary, #1a1b26);
  font-weight: 700;
  font-size: 0.8rem;
  line-height: 1;
}

.fabricated-completion-content {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  flex: 1;
  min-width: 0;
}

.fabricated-completion-title {
  font-weight: 600;
  color: var(--warning, #e0af68);
  font-size: 0.85rem;
}

.fabricated-completion-message {
  color: var(--text-secondary, var(--text-primary));
  word-wrap: break-word;
  line-height: 1.4;
}

/*
 * Tool-invocation wrapper — May 2026 PR7 follow-up. Hosts the agent-
 * attribution chip + runtime-gate denial affordance above the per-tool
 * renderer. Layout-only: no background / border of its own so the
 * existing tool-card chrome remains the visual unit. The header row
 * uses a small gap to separate chip from affordance.
 */
.tool-invocation {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.tool-invocation-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.72rem;
}

/* Agent-attribution chip. Uses theme tokens for colour (no hard-coded
 * hex) so theme switches carry through. The chip sits to the left of
 * the affordance and is independent of denial state — it appears on
 * every tool card that supplies agentLabel. */
.tool-card-agent-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.1rem 0.45rem;
  border-radius: var(--radius);
  background: var(--bg-elevated, transparent);
  border: 1px solid var(--border);
  color: var(--text-secondary, var(--text-primary));
  font-family: var(--font-mono);
  letter-spacing: 0.02em;
  user-select: none;
}

.tool-card-agent-chip__icon {
  color: var(--accent, var(--text-secondary));
  font-weight: 600;
}

.tool-card-agent-chip__label {
  color: var(--text-primary);
}

/* Denial affordance — surfaces "this tool call was rejected by the
 * runtime gate". Visual register matches CriticalErrorBanner-ish
 * (--error palette) but inline rather than top-of-chat. Distinct from
 * the warning-palette thinking-only/fabricated affordances: a denied
 * tool call is closer to an error than a warning — the call literally
 * did not execute. Still uses role="status" (informational), not
 * role="alert", because the engine already produced a recoverable
 * artifact (the adjacent tool_error row shows the rejection text); the
 * affordance is post-hoc attribution, not an immediate failure prompt.
 */
.tool-card-denied-affordance {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.15rem 0.5rem;
  border-radius: var(--radius);
  border: 1px solid var(--error, var(--danger, #f87171));
  background: var(--bg-elevated, transparent);
  color: var(--error, var(--danger, #f87171));
  font-weight: 600;
  user-select: none;
}

.tool-card-denied-affordance__icon {
  font-size: 0.85rem;
  line-height: 1;
}

.tool-card-denied-affordance__label {
  letter-spacing: 0.01em;
}

/* When denied, the tool card wrapper picks up a subtle left border to
 * mirror the delegation-card chevron pattern — same visual hint as
 * "this is a special-status invocation". */
.tool-invocation--denied {
  border-left: 2px solid var(--error, var(--danger, #f87171));
  padding-left: 0.5rem;
}

/* Delegation cards — rendered inline in the chat thread like tool
 * messages. Same elevated card chrome as tool invocations: left accent
 * border, subtle background, compact font. The in-flight variant uses
 * a green left border + live badge; the done variant uses the default
 * accent colour and omits the timer. */
.message-bubble.delegation,
.message-bubble.delegation_started {
  align-self: stretch;
  max-width: 100%;
  padding: 0;
  background: transparent;
  border: none;
}

.delegation-card {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border);
  border-left: 2px solid var(--event-delegation, var(--accent));
  border-radius: var(--radius);
  background: var(--bg-elevated, transparent);
  font-size: 0.8rem;
}

.delegation-card--inflight {
  border-left-color: var(--accent-success, #4ade80);
}

.delegation-card--done {
  border-left-color: var(--accent);
}

.delegation-spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-top: 3px;
  border: 2px solid var(--accent-success, #4ade80);
  border-top-color: transparent;
  border-radius: 50%;
  animation: delegation-spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes delegation-spin {
  to { transform: rotate(360deg); }
}

.delegation-done-marker {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
  color: var(--accent-success, #4ade80);
  font-weight: 700;
  font-size: 0.75rem;
}

.delegation-body {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  flex: 1;
  min-width: 0;
}

.delegation-header {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 0.75rem;
  flex-wrap: wrap;
}

.delegation-meta-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.68rem;
}

.delegation-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.08rem 0.4rem;
  border-radius: var(--radius);
  background: var(--bg-secondary, transparent);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 0.65rem;
  letter-spacing: 0.02em;
}

/* Provider variant — same chip chrome, dimmer color so the pair reads as
 * "model [primary] | provider [secondary]" without a new visual register. */
.delegation-chip--provider {
  color: var(--text-muted);
}

/* Tool-card elapsed chip — compact duration display for a single tool
 * invocation. Same visual register as the agent chip in the same header,
 * so they sit side by side without competing. */
.tool-card-elapsed {
  display: inline-flex;
  align-items: center;
  padding: 0.08rem 0.4rem;
  border-radius: var(--radius);
  background: var(--bg-secondary, transparent);
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 0.65rem;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

.delegation-agent-link {
  color: var(--accent);
  font-weight: 600;
  text-decoration: none;
  border-bottom: 1px dotted var(--accent);
  cursor: pointer;
  background: none;
  padding: 0;
  font: inherit;
}

.delegation-agent-link:hover {
  border-bottom-style: solid;
}

.delegation-elapsed {
  color: var(--text-muted);
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
}

.delegation-live-badge {
  font-size: 0.6rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--accent-success, #4ade80);
  border: 1px solid var(--accent-success, #4ade80);
  padding: 0 0.3rem;
  border-radius: 3px;
}

.delegation-content {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
  white-space: pre-wrap;
  font-family: inherit;
  line-height: 1.4;
}

.delegation-progress {
  display: flex;
  gap: 0.4rem;
  font-size: 0.7rem;
  color: var(--text-muted);
}

/*
 * OMO-format delegation card footer: left-aligns the tool progress,
 * right-aligns the status group (Live badge + elapsed timer) using
 * flexbox space-between. Keeps the two groups on one visual row.
 */
.delegation-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.15rem;
}

.delegation-status-group {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
}

/*
 * Footer-end groups the model chip + status group on the right side of the
 * footer, while progress stays left. Flexbox with gap between the two.
 */
.delegation-footer-end {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.delegation-progress-count {
  font-variant-numeric: tabular-nums;
}

.delegation-progress-tool {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

</style>
