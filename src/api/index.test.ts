import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sendSessionMessage,
  fetchTurn,
  cancelQueuedPrompt,
  QueueFullError,
  QueuedPromptNotFoundError,
} from "./index";

describe("sendSessionMessage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects immediately if signal is already aborted (does not call fetch)", async () => {
    const controller = new AbortController();
    controller.abort();
    let error: unknown;
    try {
      await sendSessionMessage("sess-1", "hello", {
        signal: controller.signal,
      });
    } catch (e) {
      error = e;
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(error).toBeDefined();
    expect(
      error instanceof DOMException ? error.name : (error as Error).message,
    ).toMatch(/abort/i);
  });

  // Phase 3 of "Turn-Based Post-Then-Poll Architecture (May 2026)".
  // Phase 2 (server, commit 9e398807) made POST /api/v1/sessions/{id}/messages
  // return the Session shape (legacy flat fields) PLUS two new keys:
  //   - turn_id    — the freshly-minted Turn UUID
  //   - snapshot   — a nested copy of the same Session
  // Phase 3 (FE) requires sendSessionMessage to surface both turn_id and
  // a Session snapshot so the chat-store can drive GET /turns/{turn_id}.
  it("returns {turnId, snapshot} when the server response carries turn_id (Phase 3)", async () => {
    const sessionPayload = {
      id: "sess-1",
      agentId: "agent-1",
      messages: [
        { id: "msg-x", role: "user", content: "hello", timestamp: "" },
      ],
      messageCount: 1,
      status: "active",
      depth: 0,
      isStreaming: false,
      createdAt: "",
      updatedAt: "",
    };
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...sessionPayload,
          turn_id: "turn-abc",
          snapshot: sessionPayload,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await sendSessionMessage("sess-1", "hello");

    if (result.queued) throw new Error("expected non-queued result");
    expect(result.turnId).toBe("turn-abc");
    expect(result.snapshot.id).toBe("sess-1");
    expect(result.snapshot.messages.length).toBe(1);
  });

  it("returns {turnId: null, snapshot} when the server response lacks turn_id (legacy rollback)", async () => {
    // Defence-in-depth: if the server is older than Phase 2 (or operators
    // roll the server back), turn_id is absent. The FE falls back to the
    // SSE path. sendSessionMessage must surface turnId=null so the caller
    // can branch deterministically.
    const sessionPayload = {
      id: "sess-1",
      agentId: "agent-1",
      messages: [
        { id: "msg-x", role: "user", content: "hello", timestamp: "" },
      ],
      messageCount: 1,
      status: "active",
      depth: 0,
      isStreaming: false,
      createdAt: "",
      updatedAt: "",
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(sessionPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await sendSessionMessage("sess-1", "hello");

    if (result.queued) throw new Error("expected non-queued result");
    expect(result.turnId).toBeNull();
    expect(result.snapshot.id).toBe("sess-1");
  });

  it("treats an empty string turn_id as null (defensive)", async () => {
    const sessionPayload = {
      id: "sess-1",
      agentId: "agent-1",
      messages: [],
      messageCount: 0,
      status: "active",
      depth: 0,
      isStreaming: false,
      createdAt: "",
      updatedAt: "",
    };
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...sessionPayload,
          turn_id: "",
          snapshot: sessionPayload,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await sendSessionMessage("sess-1", "hello");

    if (result.queued) throw new Error("expected non-queued result");
    expect(result.turnId).toBeNull();
  });

  // Backend-owned prompt queue (May 2026) — HTTP 202 queued response.
  // When the session's turn slot is busy the backend accepts the prompt
  // into its per-session queue with a 202 + status "queued". The FE
  // mirrors the entry locally (promptId + queuePosition) instead of
  // keeping a client-side copy, so the response must be discriminated
  // from the normal turn_id/snapshot shape.
  it("returns a queued result with promptId + queuePosition on 202 status queued", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "queued",
          session_id: "sess-1",
          queuePosition: 2,
          promptId: "prompt-abc",
        }),
        { status: 202, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await sendSessionMessage("sess-1", "hello");

    expect(result.queued).toBe(true);
    if (result.queued) {
      expect(result.sessionId).toBe("sess-1");
      expect(result.promptId).toBe("prompt-abc");
      expect(result.queuePosition).toBe(2);
    }
  });

  // 429 "queue full" is the loud rejection path. The store pauses
  // submissions for a window and restores the draft; the API layer's job
  // is to throw a typed error so the store can branch without string
  // matching on the body.
  it("throws QueueFullError on HTTP 429", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "queue full" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }),
    );

    let error: unknown;
    try {
      await sendSessionMessage("sess-1", "hello");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(QueueFullError);
    expect((error as Error).message).toMatch(/queue.*full/i);
  });

  // Defence-in-depth: a non-queue 202 (some intermediate proxy or a
  // future backend shape) must fall through to the normal turn_id/snapshot
  // normalisation instead of crashing or being misread as a queued result.
  it("normalises a 202 without status queued to the turn shape", async () => {
    const sessionPayload = {
      id: "sess-1",
      agentId: "agent-1",
      messages: [],
      messageCount: 0,
      status: "active",
      depth: 0,
      isStreaming: false,
      createdAt: "",
      updatedAt: "",
    };
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...sessionPayload,
          turn_id: "turn-202",
          snapshot: sessionPayload,
        }),
        { status: 202, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await sendSessionMessage("sess-1", "hello");

    expect(result.queued).toBe(false);
    if (result.queued) throw new Error("expected non-queued result");
    expect(result.turnId).toBe("turn-202");
  });
});

describe("cancelQueuedPrompt", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a DELETE to the queue endpoint and returns status cancelled on 200", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "cancelled" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await cancelQueuedPrompt("sess-1", "prompt-abc");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/sessions/sess-1/queue/prompt-abc");
    expect(init?.method).toBe("DELETE");
    expect(result).toMatchObject({ status: "cancelled" });
  });

  it("treats a 204 No Content as a successful cancel", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 204 }),
    );

    const result = await cancelQueuedPrompt("sess-1", "prompt-abc");

    expect(result).toMatchObject({ status: "cancelled" });
  });

  it("throws QueuedPromptNotFoundError on 404", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "queued prompt not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );

    let error: unknown;
    try {
      await cancelQueuedPrompt("sess-1", "prompt-ghost");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(QueuedPromptNotFoundError);
  });
});

describe("fetchTurn", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /api/v1/sessions/{sid}/turns/{tid} with credentials and returns the parsed TurnState", async () => {
    const body = {
      turn_id: "turn-abc",
      session_id: "sess-1",
      status: "running",
      started_at: "2026-05-19T10:00:00Z",
      completed_at: null,
      model: { provider: "anthropic", model: "claude-opus" },
      error: "",
      messages: [
        { id: "asst-1", role: "assistant", content: "hi", timestamp: "" },
      ],
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await fetchTurn("sess-1", "turn-abc");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/v1\/sessions\/sess-1\/turns\/turn-abc$/);
    expect((init as RequestInit | undefined)?.credentials).toBe("include");
    expect(result.turn_id).toBe("turn-abc");
    expect(result.status).toBe("running");
    expect(result.messages.length).toBe(1);
  });

  it("throws on 404 so the caller can fall back to the SSE path (defence-in-depth)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("turn not found", { status: 404 }),
    );

    let err: unknown;
    try {
      await fetchTurn("sess-1", "unknown-turn");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).toMatch(/404|not found/i);
  });

  it("throws on non-OK non-404 status (e.g. 500)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("internal error", { status: 500 }),
    );

    let err: unknown;
    try {
      await fetchTurn("sess-1", "turn-abc");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
  });

  // Phase-4-Commit-1b long-poll surface. fetchTurn accepts
  // `{ wait, since, signal }` so the chat store can drive the
  // server-side hold endpoint with a session-switch-capable
  // AbortController.
  it("appends ?wait=true&since=N when opts.wait is true", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          turn_id: "turn-lp",
          session_id: "sess-1",
          status: "running",
          started_at: "",
          completed_at: null,
          model: { provider: "", model: "" },
          error: "",
          messages: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await fetchTurn("sess-1", "turn-lp", { wait: true, since: 5 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toMatch(
      /\/v1\/sessions\/sess-1\/turns\/turn-lp\?wait=true&since=5$/,
    );
  });

  it("defaults since to 0 when omitted (first long-poll of a turn)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          turn_id: "turn-zero",
          session_id: "sess-1",
          status: "running",
          started_at: "",
          completed_at: null,
          model: { provider: "", model: "" },
          error: "",
          messages: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await fetchTurn("sess-1", "turn-zero", { wait: true });

    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\?wait=true&since=0$/);
  });

  it("does NOT append wait/since when opts.wait is false (legacy snapshot path)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          turn_id: "turn-legacy",
          session_id: "sess-1",
          status: "completed",
          started_at: "",
          completed_at: "",
          model: { provider: "", model: "" },
          error: "",
          messages: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await fetchTurn("sess-1", "turn-legacy", { wait: false });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).not.toMatch(/wait=/);
    expect(url).not.toMatch(/since=/);
  });

  it("threads the AbortSignal through to fetch so a session-switch can cancel an in-flight long-poll", async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          turn_id: "turn-signal",
          session_id: "sess-1",
          status: "running",
          started_at: "",
          completed_at: null,
          model: { provider: "", model: "" },
          error: "",
          messages: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await fetchTurn("sess-1", "turn-signal", {
      wait: true,
      since: 0,
      signal: controller.signal,
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    expect(init?.signal).toBe(controller.signal);
  });
});
