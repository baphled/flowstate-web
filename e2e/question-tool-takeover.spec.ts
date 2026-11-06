import { test, expect, Page } from "@playwright/test";

/**
 * Question Tool (Aug 2026) — composer takeover e2e.
 *
 * Pins the user-observable contract of the question tool's blocking
 * takeover (mirrors permission-ask-flow.spec.ts bootstrap):
 *
 *   - The session summary's `activeTurnId` starts the reattach
 *     long-poll loop on page load; GET /turns/{id} returns
 *     status "running" with one pending question_requests entry.
 *   - While pending, the QuestionSelector REPLACES the composer —
 *     the [data-testid="message-input"] textarea is unmounted (not
 *     just disabled) and the selector's rows are visible.
 *   - Clicking an option then Submit POSTs to
 *     /api/v1/sessions/{id}/question-answer with
 *     {request_id, answers:[...]}.
 *   - After the answer POST, the poll sequence flips the question to
 *     "answered" and the turn completes — the selector unmounts and
 *     the composer textarea returns.
 */

const TURN_ID = "turn-q-1";
const SESSION_ID = "session-q-1";
const REQUEST_ID = "req-q-1";

interface RecordedPost {
  sessionId: string;
  body: string;
}

async function bootstrapMocks(page: Page, recordedPosts: RecordedPost[]): Promise<void> {
  await page.route("**/api/health", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"status":"ok"}' }),
  );
  await page.route("**/api/agents", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: "coordinator", name: "Coordinator", description: "x", model: "claude-sonnet-4-6" },
      ]),
    }),
  );
  await page.route("**/api/v1/models", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        providers: [
          { id: "anthropic", name: "Anthropic", models: [{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" }] },
        ],
      }),
    }),
  );
  await page.route("**/api/v1/sessions", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: SESSION_ID,
          agentId: "coordinator",
          currentAgentId: "coordinator",
          currentProviderId: "anthropic",
          currentModelId: "claude-sonnet-4-6",
          title: "Question takeover",
          createdAt: "2026-08-30T00:00:00Z",
          updatedAt: "2026-08-30T00:00:01Z",
          messageCount: 0,
          activeTurnId: TURN_ID,
        },
      ]),
    });
  });
  await page.route("**/api/v1/sessions/*/messages", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: "user-1", role: "user", content: "pick one", timestamp: "2026-08-30T00:00:00Z" },
      ]),
    });
  });

  // Answer endpoint — record POST bodies.
  await page.route("**/api/v1/sessions/*/question-answer", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fulfill({ status: 405 });
      return;
    }
    const body = route.request().postData() ?? "";
    const match = route.request().url().match(/\/sessions\/([^/]+)\/question-answer/);
    recordedPosts.push({ sessionId: match ? decodeURIComponent(match[1]) : "", body });
    const parsed = JSON.parse(body) as { request_id: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ request_id: parsed.request_id, status: "answered" }),
    });
  });

  // Long-poll turn endpoint — running + pending question until the
  // answer POST is seen, then completed + answered question.
  let answered = false;
  await page.route("**/api/v1/sessions/*/turns/*", async (route) => {
    const status = answered ? "completed" : "running";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        turn_id: TURN_ID,
        session_id: SESSION_ID,
        status,
        started_at: "2026-08-30T00:00:00Z",
        completed_at: answered ? "2026-08-30T00:00:05Z" : null,
        model: { provider: "anthropic", model: "claude-sonnet-4-6" },
        error: "",
        messages: [],
        phase: answered ? "finalising" : "tool_executing",
        token_count: 0,
        question_requests: [
          {
            request_id: REQUEST_ID,
            tool_name: "question",
            question: "Which option do you want?",
            options: ["A", "B"],
            allow_multiple: false,
            status: answered ? "answered" : "pending",
            answers: answered ? ["A"] : undefined,
          },
        ],
      }),
    });
  });
  await page.route("**/api/swarm/events", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );

  // Flip the poll mock to "answered" once the answer POST lands.
  page.on("request", (req) => {
    if (req.method() === "POST" && /\/question-answer$/.test(req.url())) {
      answered = true;
    }
  });

  await page.addInitScript(
    ({ sessionId, turnId }) => {
      window.localStorage.setItem("chat.currentSessionId", sessionId);
    },
    { sessionId: SESSION_ID, turnId: TURN_ID },
  );
}

const DEV_BASE_URL = process.env["QUESTION_TAKEOVER_BASE_URL"] ?? "http://localhost:5173";
test.use({ baseURL: DEV_BASE_URL });

test.describe("Question Tool — composer takeover", () => {
  test("pending question replaces the composer; answering POSTs and restores the composer", async ({
    page,
  }) => {
    const recordedPosts: RecordedPost[] = [];
    await bootstrapMocks(page, recordedPosts);

    await page.goto("/chat");

    // Composer visible first, then the first poll diff swaps it out.
    await expect(page.getByTestId("message-input")).toBeVisible({ timeout: 10000 });
    const selector = page.locator('[data-testid="question-selector"]').first();
    await expect(selector).toBeVisible({ timeout: 10000 });
    await expect(selector.locator('[data-testid="question-selector-question"]')).toContainText(
      "Which option do you want?",
    );
    await expect(selector.locator('[data-testid="question-selector-row-0"]')).toContainText("A");
    await expect(selector.locator('[data-testid="question-selector-row-1"]')).toContainText("B");

    // (a) composer textarea is unmounted while the question is pending.
    await expect(page.getByTestId("message-input")).toBeHidden();

    // (c) click option A, then Submit — POST must carry {request_id, answers:["A"]}.
    const postPromise = page.waitForRequest(
      (req) =>
        req.method() === "POST" && /\/api\/v1\/sessions\/[^/]+\/question-answer$/.test(req.url()),
    );
    await selector.locator('[data-testid="question-selector-row-0"]').click();
    await selector.locator('[data-testid="question-selector-submit"]').click();
    const post = await postPromise;
    expect(post.postDataJSON()).toEqual({ request_id: REQUEST_ID, answers: ["A"] });
    expect(recordedPosts).toHaveLength(1);

    // (d) poll observes answered + turn completes → selector unmounts,
    // composer returns.
    await expect(selector).toBeHidden({ timeout: 10000 });
    await expect(page.getByTestId("message-input")).toBeVisible({ timeout: 10000 });
  });
});
