import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ReadTool from "./ReadTool.vue";

const CopyButton = {
  template: '<span data-testid="copy-btn" />',
};

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

const HighlightedCode = {
  props: ["code", "lang", "maxHeight"],
  template: '<pre data-component="highlighted-code" :data-lang="lang"><code>{{ code }}</code></pre>',
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
        stubs: { ToolBubble, CopyButton, HighlightedCode },
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
        stubs: { ToolBubble, CopyButton, HighlightedCode },
      },
    });

    expect(wrapper.get('[data-testid="tool-subtitle"]').text()).toBe(
      "/tmp/example.txt",
    );
  });

  it("opens the card by default (file contents are the value)", () => {
    const wrapper = mount(ReadTool, {
      props: {
        toolName: "read",
        heading: "/tmp/example.txt",
        body: "hello",
        status: "completed",
      },
      global: {
        stubs: { ToolBubble, CopyButton, HighlightedCode },
      },
    });

    expect(
      wrapper
        .get('[data-testid="tool-bubble"]')
        .attributes("data-default-open"),
    ).toBe("true");
  });

  it("renders file contents with line numbers", () => {
    const wrapper = mount(ReadTool, {
      props: {
        toolName: "read",
        heading: "/tmp/example.txt",
        body: "hello world",
        status: "completed",
      },
      global: {
        stubs: { ToolBubble, CopyButton, HighlightedCode },
      },
    });

    const content = wrapper.get('[data-component="read-content"]');
    expect(content.text()).toContain("hello world");
    expect(
      wrapper.get('[data-testid="read-line"]').attributes("data-line-number"),
    ).toBe("1");
  });

  it("strips opencode XML wrapper tags and renders only the file content", () => {
    const body =
      "<path>/tmp/x.txt</path>\n<type>file</type>\n<content>\nline-1\nline-2\nline-3\n</content>";
    const wrapper = mount(ReadTool, {
      props: {
        toolName: "read",
        heading: "/tmp/x.txt",
        body,
        status: "completed",
      },
      global: {
        stubs: { ToolBubble, CopyButton, HighlightedCode },
      },
    });

    const content = wrapper.get('[data-component="read-content"]');
    expect(content.text()).toContain("line-1");
    expect(content.text()).toContain("line-3");
    expect(content.text()).not.toContain("<content>");
    expect(content.text()).not.toContain("<path>");
    expect(content.text()).not.toContain("<type>");
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
        stubs: { ToolBubble, CopyButton, HighlightedCode },
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
        stubs: { ToolBubble, CopyButton, HighlightedCode },
      },
    });

    const lineRange = wrapper.find('[data-testid="line-range"]');
    expect(lineRange.exists()).toBe(true);
    expect(lineRange.text()).toBe("[lines 100–199]");
  });

  it("numbers lines from the toolInput offset when present", () => {
    const wrapper = mount(ReadTool, {
      props: {
        toolName: "read",
        heading: "/tmp/x.txt",
        body: "first\nsecond",
        status: "completed",
        toolInput: JSON.stringify({ file_path: "/tmp/x.txt", offset: 9 }),
      },
      global: {
        stubs: { ToolBubble, CopyButton, HighlightedCode },
      },
    });

    const lines = wrapper.findAll('[data-testid="read-line"]');
    expect(lines[0].attributes("data-line-number")).toBe("10");
    expect(lines[1].attributes("data-line-number")).toBe("11");
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
        stubs: { ToolBubble, CopyButton, HighlightedCode },
      },
    });

    expect(wrapper.find('[data-testid="line-range"]').exists()).toBe(false);
  });

  it("truncates very long content to head + tail with a show-full toggle", async () => {
    const lines: string[] = [];
    for (let i = 1; i <= 600; i += 1) {
      lines.push(`line-${i}`);
    }
    const wrapper = mount(ReadTool, {
      props: {
        toolName: "read",
        heading: "/tmp/long.txt",
        body: lines.join("\n"),
        status: "completed",
      },
      global: {
        stubs: { ToolBubble, CopyButton, HighlightedCode },
      },
    });

    const content = wrapper.get('[data-component="read-content"]');
    expect(content.text()).toContain("line-1");
    expect(content.text()).toContain("line-200");
    expect(content.text()).not.toContain("line-201");
    expect(content.text()).toContain("line-551");
    expect(content.text()).toContain("line-600");
    expect(content.text()).toContain("350 lines hidden");

    const toggle = wrapper.get('[data-component="read-toggle"]');
    expect(toggle.text()).toContain("Show full output");

    await toggle.trigger("click");
    const expanded = wrapper.get('[data-component="read-content"]');
    expect(expanded.text()).toContain("line-201");
    expect(expanded.text()).toContain("line-500");
    expect(wrapper.get('[data-component="read-toggle"]').text()).toContain(
      "Show less",
    );
  });
});
