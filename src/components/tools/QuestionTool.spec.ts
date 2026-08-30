import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import QuestionTool from "./QuestionTool.vue";

describe("QuestionTool", () => {
  it("renders the question text as the heading", () => {
    const wrapper = mount(QuestionTool, {
      props: {
        toolName: "question",
        heading: "question Which database?",
        body: "",
        status: "pending",
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
});
