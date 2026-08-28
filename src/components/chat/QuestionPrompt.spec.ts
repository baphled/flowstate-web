import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import QuestionPrompt from "./QuestionPrompt.vue";
import { useChatStore } from "@/stores/chatStore";

/**
 * QuestionPrompt component specs — Question Tool (Aug 2026).
 * Mirrors PermissionPrompt.spec.ts (Permission Mode ModeAskUser
 * Extension plan, Slice 3, §3).
 *
 * Focal assertions:
 *
 *   - Renders the pending question text from the request prop.
 *   - Option buttons render when options are present; single-select
 *     when allow_multiple is falsy (second click replaces the choice),
 *     multi-select when allow_multiple is true.
 *   - Free-text input replaces the options block when options are
 *     absent/empty.
 *   - Submit routes through chatStore.answerQuestion with the
 *     selected options (or the trimmed free text) as answers.
 *   - "Submitting…" state surfaces and disables controls while the
 *     POST is in flight.
 *   - POST failure surfaces a local inline error.
 *
 * Memory gotchas honoured:
 *   - `feedback_response_ok_mock_gotcha` — stub the store action, not
 *     fetch, so no wire shape matters here.
 *   - `feedback_pinia_onmounted_clobbers_seed` — the component has no
 *     onMounted async work; pre-mount seeding is safe. Tests still
 *     flushPromises post-mount for future resilience.
 */

function installLocalStorageStub(): void {
  const store = new Map<string, string>();
  const stub = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: stub,
    configurable: true,
  });
}

const baseRequest = {
  request_id: "qreq-1",
  tool_name: "question",
  agent_name: "coordinator",
  question: "Which database should I target?",
  options: ["postgres", "sqlite"],
  status: "pending" as const,
};

function findOption(wrapper: ReturnType<typeof mount>, option: string) {
  return wrapper.findAll('[data-testid="question-prompt-option"]').find((b) =>
    b.attributes("data-option") === option,
  )!;
}

describe("QuestionPrompt", () => {
  beforeEach(() => {
    installLocalStorageStub();
    vi.clearAllMocks();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the pending question text", async () => {
    const wrapper = mount(QuestionPrompt, {
      props: { request: baseRequest },
    });
    await flushPromises();

    expect(
      wrapper.get('[data-testid="question-prompt-question"]').text(),
    ).toBe("Which database should I target?");
    expect(wrapper.get('[data-testid="question-prompt"]').attributes("data-request-id")).toBe(
      "qreq-1",
    );
  });

  it("single-select: clicking a second option replaces the first", async () => {
    const wrapper = mount(QuestionPrompt, {
      props: { request: baseRequest },
    });
    await flushPromises();

    await findOption(wrapper, "postgres").trigger("click");
    expect(
      findOption(wrapper, "postgres").attributes("aria-pressed"),
    ).toBe("true");

    await findOption(wrapper, "sqlite").trigger("click");
    expect(
      findOption(wrapper, "postgres").attributes("aria-pressed"),
    ).toBe("false");
    expect(
      findOption(wrapper, "sqlite").attributes("aria-pressed"),
    ).toBe("true");
  });

  it("multi-select: allow_multiple keeps both selections", async () => {
    const wrapper = mount(QuestionPrompt, {
      props: { request: { ...baseRequest, allow_multiple: true } },
    });
    await flushPromises();

    await findOption(wrapper, "postgres").trigger("click");
    await findOption(wrapper, "sqlite").trigger("click");

    expect(
      findOption(wrapper, "postgres").attributes("aria-pressed"),
    ).toBe("true");
    expect(
      findOption(wrapper, "sqlite").attributes("aria-pressed"),
    ).toBe("true");
  });

  it("falls back to free-text input when options are absent", async () => {
    const wrapper = mount(QuestionPrompt, {
      props: { request: { ...baseRequest, options: [] } },
    });
    await flushPromises();

    expect(
      wrapper.find('[data-testid="question-prompt-options"]').exists(),
    ).toBe(false);
    expect(
      wrapper.find('[data-testid="question-prompt-input"]').exists(),
    ).toBe(true);
  });

  it("submit calls chatStore.answerQuestion with selected options", async () => {
    const store = useChatStore();
    const answerSpy = vi
      .spyOn(store, "answerQuestion")
      .mockResolvedValueOnce(undefined);

    const wrapper = mount(QuestionPrompt, {
      props: { request: { ...baseRequest, allow_multiple: true } },
    });
    await flushPromises();

    await findOption(wrapper, "postgres").trigger("click");
    await findOption(wrapper, "sqlite").trigger("click");
    await wrapper.get('[data-testid="question-prompt-submit"]').trigger("click");
    await flushPromises();

    expect(answerSpy).toHaveBeenCalledTimes(1);
    expect(answerSpy).toHaveBeenCalledWith("qreq-1", ["postgres", "sqlite"]);
  });

  it("submit sends trimmed free text when no options exist", async () => {
    const store = useChatStore();
    const answerSpy = vi
      .spyOn(store, "answerQuestion")
      .mockResolvedValueOnce(undefined);

    const wrapper = mount(QuestionPrompt, {
      props: { request: { ...baseRequest, options: [] } },
    });
    await flushPromises();

    await wrapper
      .get('[data-testid="question-prompt-input"]')
      .setValue("  use redis  ");
    await wrapper.get('[data-testid="question-prompt-submit"]').trigger("click");
    await flushPromises();

    expect(answerSpy).toHaveBeenCalledWith("qreq-1", ["use redis"]);
  });

  it("shows 'Submitting…' and disables controls while in flight", async () => {
    const store = useChatStore();
    // Pre-seed the optimistic flag — the component reads the store's
    // answeringQuestionRequests set reactively.
    store.answeringQuestionRequests.add("qreq-1");

    const wrapper = mount(QuestionPrompt, {
      props: { request: baseRequest },
    });
    await flushPromises();

    expect(
      wrapper.get('[data-testid="question-prompt-submit"]').text(),
    ).toBe("Submitting…");
    expect(
      wrapper
        .get('[data-testid="question-prompt-submit"]')
        .attributes("disabled"),
    ).toBeDefined();
    expect(
      findOption(wrapper, "postgres").attributes("disabled"),
    ).toBeDefined();
  });

  it("surfaces the POST failure inline", async () => {
    const store = useChatStore();
    const answerSpy = vi
      .spyOn(store, "answerQuestion")
      .mockRejectedValueOnce(new Error("question request not found"));

    const wrapper = mount(QuestionPrompt, {
      props: { request: baseRequest },
    });
    await flushPromises();

    await findOption(wrapper, "postgres").trigger("click");
    await wrapper.get('[data-testid="question-prompt-submit"]').trigger("click");
    await flushPromises();

    expect(answerSpy).toHaveBeenCalledTimes(1);
    expect(
      wrapper.get('[data-testid="question-prompt-error"]').text(),
    ).toContain("question request not found");
    expect(
      wrapper.get('[data-testid="question-prompt-submit"]').text(),
    ).toBe("Submit");
  });

  it("blocks submit with a local error when nothing is selected", async () => {
    const store = useChatStore();
    const answerSpy = vi.spyOn(store, "answerQuestion");

    const wrapper = mount(QuestionPrompt, {
      props: { request: baseRequest },
    });
    await flushPromises();

    await wrapper.get('[data-testid="question-prompt-submit"]').trigger("click");
    await flushPromises();

    expect(answerSpy).not.toHaveBeenCalled();
    expect(
      wrapper.get('[data-testid="question-prompt-error"]').text(),
    ).toContain("Select an option or type an answer first.");
  });
});
