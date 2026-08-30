import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import QuestionTool from "./QuestionTool.vue";
import { useChatStore } from "@/stores/chatStore";

describe("QuestionTool", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function seedPending(toolName = "question") {
    const store = useChatStore();
    store.pendingQuestions["req-1"] = {
      request_id: "req-1",
      tool_name: toolName,
      question: "Which database?",
      status: "pending",
    };
  }

  it("renders the question text as the heading", () => {
    const wrapper = mount(QuestionTool, {
      props: {
        toolName: "question",
        heading: "question Which database?",
        body: "",
        status: "pending",
        toolInput: JSON.stringify({ question: "Which database?" }),
      },
    });
    expect(wrapper.find('[data-testid="question-tool"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Which database?");
    expect(wrapper.find('[data-testid="question-tool-label"]').text()).toBe(
      "Waiting for answer",
    );
  });

  it("shows the answered label on completed status", () => {
    const wrapper = mount(QuestionTool, {
      props: {
        toolName: "question",
        heading: "question Which database?",
        body: "",
        status: "completed",
      },
    });
    expect(wrapper.find('[data-testid="question-tool-label"]').text()).toBe(
      "Answered",
    );
  });

  it("shows the failed label on error status", () => {
    const wrapper = mount(QuestionTool, {
      props: {
        toolName: "question",
        heading: "question Which database?",
        body: "",
        status: "error",
      },
    });
    expect(wrapper.find('[data-testid="question-tool-label"]').text()).toBe(
      "Question failed",
    );
  });

  it("shows 'Waiting for your answer…' while a matching entry is still pending, even with completed tool_call status", () => {
    seedPending();
    const wrapper = mount(QuestionTool, {
      props: {
        toolName: "question",
        heading: "question Which database?",
        body: "",
        status: "completed",
      },
    });
    expect(wrapper.find('[data-testid="question-tool-label"]').text()).toBe(
      "Waiting for your answer…",
    );
  });

  it("shows 'Answered' after the pending entry is resolved", () => {
    const store = useChatStore();
    store.pendingQuestions["req-1"] = {
      request_id: "req-1",
      tool_name: "question",
      question: "Which database?",
      status: "answered",
    };
    const wrapper = mount(QuestionTool, {
      props: {
        toolName: "question",
        heading: "question Which database?",
        body: "",
        status: "completed",
      },
    });
    expect(wrapper.find('[data-testid="question-tool-label"]').text()).toBe(
      "Answered",
    );
  });

  it("matches pending entries via toolNameBasename against namespaced tool names", () => {
    seedPending("mcp__fs__question");
    const wrapper = mount(QuestionTool, {
      props: {
        toolName: "question",
        heading: "question Which database?",
        body: "",
        status: "completed",
      },
    });
    expect(wrapper.find('[data-testid="question-tool-label"]').text()).toBe(
      "Waiting for your answer…",
    );
  });

  it("renders the question text from args as the heading, not a raw JSON blob", () => {
    const wrapper = mount(QuestionTool, {
      props: {
        toolName: "question",
        heading: 'question {"options":["a","b"]}',
        body: "",
        status: "pending",
        toolInput: JSON.stringify({
          question: "Which database?",
          options: ["a", "b"],
        }),
      },
    });
    const heading = wrapper.find('[data-testid="question-tool-question"]');
    expect(heading.text()).toBe("Which database?");
    expect(wrapper.text()).not.toContain('{"options"');
  });

  it("falls back to the tool name when args carry no question text", () => {
    const wrapper = mount(QuestionTool, {
      props: {
        toolName: "question",
        heading: 'question {"options":["a"]}',
        body: "",
        status: "pending",
        toolInput: JSON.stringify({ options: ["a"] }),
      },
    });
    expect(wrapper.find('[data-testid="question-tool-question"]').text()).toBe(
      "question",
    );
  });
});
