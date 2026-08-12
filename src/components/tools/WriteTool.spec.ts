import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import WriteTool from "./WriteTool.vue";

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

describe("WriteTool", () => {
  // I4: Write content IS the value of the card — the user needs to see
  // what was written to verify the change. Open by default.
  it("starts open by default (new file content is the value)", () => {
    const wrapper = mount(WriteTool, {
      props: {
        toolName: "write",
        heading: "/a",
        body: "hi",
        status: "completed",
      },
      global: { stubs: { CopyButton, HighlightedCode, ToolBubble } },
    });
    expect(
      wrapper
        .get('[data-testid="tool-bubble"]')
        .attributes("data-default-open"),
    ).toBe("true");
  });
  it("renders written content inside the tool bubble", () => {
    const wrapper = mount(WriteTool, {
      props: {
        toolName: "write",
        heading: "/tmp/output.txt",
        body: "saved content",
        status: "completed",
      },
      global: {
        stubs: {
          CopyButton,
          HighlightedCode,
          ToolBubble,
        },
      },
    });

    expect(
      wrapper.get('[data-testid="tool-bubble"]').attributes("data-component"),
    ).toBe("tool");
    expect(
      wrapper.get('[data-testid="tool-bubble"]').attributes("data-tool"),
    ).toBe("write");
    expect(wrapper.get('[data-testid="tool-subtitle"]').text()).toBe(
      "/tmp/output.txt",
    );
    expect(wrapper.get('[data-component="write-tool"]').text()).toContain(
      "saved content",
    );
    expect(wrapper.find('[data-testid="copy-btn"]').exists()).toBe(true);
  });

  it("renders written content through HighlightedCode with the language resolved from the file path", () => {
    const wrapper = mount(WriteTool, {
      props: {
        toolName: "write",
        heading: "/tmp/new.ts",
        body: "line one\nline two\nline three",
        status: "completed",
      },
      global: {
        stubs: {
          CopyButton,
          HighlightedCode,
          ToolBubble,
        },
      },
    });

    const code = wrapper.get('[data-component="highlighted-code"]');
    expect(code.attributes("data-lang")).toBe("typescript");
    expect(code.text()).toContain("line one");
    expect(code.text()).toContain("line two");
    expect(code.text()).toContain("line three");
    expect(wrapper.find('[data-component="write-content"]').exists()).toBe(true);
  });

  it("shows a summary with the written line count and file path", () => {
    const wrapper = mount(WriteTool, {
      props: {
        toolName: "write",
        heading: "/tmp/new.ts",
        body: "a\nb\nc\nd",
        status: "completed",
      },
      global: {
        stubs: {
          CopyButton,
          HighlightedCode,
          ToolBubble,
        },
      },
    });

    const summary = wrapper.get('[data-testid="write-summary"]');
    expect(summary.text()).toContain("+4 lines written to /tmp/new.ts");
  });

  it("shows a new file badge and resolves the path from toolInput when present", () => {
    const wrapper = mount(WriteTool, {
      props: {
        toolName: "write",
        heading: "write /tmp/new.ts",
        body: "a\nb\nc\nd",
        status: "completed",
        toolInput: JSON.stringify({ filePath: "/tmp/new.ts", exists: false }),
      },
      global: {
        stubs: {
          CopyButton,
          HighlightedCode,
          ToolBubble,
        },
      },
    });

    const summary = wrapper.get('[data-testid="write-summary"]');
    expect(summary.text()).toContain("/tmp/new.ts");
    expect(summary.text()).toContain("new file");
  });

  it("renders tiny bodies through HighlightedCode with the resolved language", () => {
    const wrapper = mount(WriteTool, {
      props: {
        toolName: "write",
        heading: "/tmp/tiny.ts",
        body: "hi",
        status: "completed",
      },
      global: {
        stubs: {
          CopyButton,
          HighlightedCode,
          ToolBubble,
        },
      },
    });

    const code = wrapper.get('[data-component="highlighted-code"]');
    expect(code.attributes("data-lang")).toBe("typescript");
    expect(code.text()).toContain("hi");
    expect(wrapper.find('[data-component="write-content"]').exists()).toBe(true);
  });

  it("does not resolve a grammar for paths without a supported extension", () => {
    const wrapper = mount(WriteTool, {
      props: {
        toolName: "write",
        heading: "/tmp/output.txt",
        body: "hi",
        status: "completed",
      },
      global: {
        stubs: {
          CopyButton,
          HighlightedCode,
          ToolBubble,
        },
      },
    });

    const code = wrapper.get('[data-component="highlighted-code"]');
    expect(code.attributes("data-lang")).toBeUndefined();
    expect(code.text()).toContain("hi");
  });
});
