import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ReadTool from "./ReadTool.vue";

const ToolBubble = {
  props: ["toolName", "title", "subtitle", "status", "defaultOpen"],
  template: `
    <div data-testid="tool-bubble" data-component="tool" :data-tool="toolName" :data-status="status" :data-default-open="defaultOpen ? 'true' : 'false'">
      <span data-testid="tool-title">{{ title }}</span>
      <span v-if="subtitle" data-testid="tool-subtitle">{{ subtitle }}</span>
      <slot />
    </div>
  `,
};

describe("ReadTool", () => {
  it("uses the tool name as the card title", () => {
    const wrapper = mount(ReadTool, {
      props: {
        toolName: "read",
        heading: "/tmp/example.txt",
        body: "hello",
        status: "completed",
      },
      global: {
        stubs: { ToolBubble },
      },
    });

    expect(wrapper.get('[data-testid="tool-title"]').text()).toBe("read");
  });

  it("shows the full file path as the subtitle", () => {
    const wrapper = mount(ReadTool, {
      props: {
        toolName: "read",
        heading: "/tmp/example.txt",
        body: "hello",
        status: "completed",
      },
      global: {
        stubs: { ToolBubble },
      },
    });

    expect(wrapper.get('[data-testid="tool-subtitle"]').text()).toBe(
      "/tmp/example.txt",
    );
  });

  it("collapses the card by default", () => {
    const wrapper = mount(ReadTool, {
      props: {
        toolName: "read",
        heading: "/tmp/example.txt",
        body: "hello",
        status: "completed",
      },
      global: {
        stubs: { ToolBubble },
      },
    });

    expect(
      wrapper
        .get('[data-testid="tool-bubble"]')
        .attributes("data-default-open"),
    ).toBe("false");
  });

  it("does not render file contents", () => {
    const wrapper = mount(ReadTool, {
      props: {
        toolName: "read",
        heading: "/tmp/example.txt",
        body: "hello world",
        status: "completed",
      },
      global: {
        stubs: { ToolBubble },
      },
    });

    // The body/content is intentionally absent from the card
    expect(wrapper.find('[data-component="read-content"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-component="read-tool"]').text()).not.toContain(
      "hello world",
    );
  });

  it("shows the full path in the card body", () => {
    const wrapper = mount(ReadTool, {
      props: {
        toolName: "read",
        heading: "src/stores/chatStore.ts",
        body: "some content",
        status: "completed",
      },
      global: {
        stubs: { ToolBubble },
      },
    });

    expect(wrapper.get('[data-testid="read-file-path"]').text()).toBe(
      "src/stores/chatStore.ts",
    );
  });

  it("shows line range label when limit and offset are present in toolInput", () => {
    const wrapper = mount(ReadTool, {
      props: {
        toolName: "read",
        heading: "src/stores/chatStore.ts",
        body: "some content",
        status: "completed",
        toolInput: JSON.stringify({
          file_path: "src/stores/chatStore.ts",
          limit: 100,
          offset: 99,
        }),
      },
      global: {
        stubs: { ToolBubble },
      },
    });

    const lineRange = wrapper.find('[data-testid="line-range"]');
    expect(lineRange.exists()).toBe(true);
    expect(lineRange.text()).toBe("[lines 100–199]");
  });

  it("does not show line range label when neither limit nor offset is set", () => {
    const wrapper = mount(ReadTool, {
      props: {
        toolName: "read",
        heading: "/tmp/full.txt",
        body: "full file content",
        status: "completed",
        toolInput: JSON.stringify({ file_path: "/tmp/full.txt" }),
      },
      global: {
        stubs: { ToolBubble },
      },
    });

    expect(wrapper.find('[data-testid="line-range"]').exists()).toBe(false);
  });
});
