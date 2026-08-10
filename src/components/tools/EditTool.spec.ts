import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import EditTool from "./EditTool.vue";

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

describe("EditTool", () => {
  // I4: Edit diffs ARE the value of the card — the diff is what the user
  // needs to see to verify the change. Open by default.
  it("starts open by default (diff is the value)", () => {
    const wrapper = mount(EditTool, {
      props: {
        toolName: "edit",
        heading: "/a",
        body: "-x\n+y",
        status: "completed",
      },
      global: { stubs: { CopyButton, ToolBubble } },
    });
    expect(
      wrapper
        .get('[data-testid="tool-bubble"]')
        .attributes("data-default-open"),
    ).toBe("true");
  });
  it("renders diff lines with added and removed styling", () => {
    const wrapper = mount(EditTool, {
      props: {
        toolName: "edit",
        heading: "/tmp/edit.txt",
        body: "-before\n+after",
        status: "completed",
      },
      global: {
        stubs: {
          CopyButton,
          ToolBubble,
        },
      },
    });

    expect(
      wrapper.get('[data-testid="tool-bubble"]').attributes("data-component"),
    ).toBe("tool");
    expect(
      wrapper.get('[data-testid="tool-bubble"]').attributes("data-tool"),
    ).toBe("edit");
    expect(wrapper.get('[data-testid="tool-subtitle"]').text()).toBe(
      "/tmp/edit.txt",
    );
    expect(wrapper.find('[data-component="edit-tool"]').exists()).toBe(true);
    expect(wrapper.find('[data-line-kind="removed"]').text()).toContain(
      "-before",
    );
    expect(wrapper.find('[data-line-kind="added"]').text()).toContain("+after");
    expect(wrapper.find('[data-testid="copy-btn"]').exists()).toBe(true);
  });

  it("falls back to plain content when no diff markers exist", () => {
    const wrapper = mount(EditTool, {
      props: {
        toolName: "edit",
        heading: "/tmp/plain.txt",
        body: "plain replacement text",
      },
      global: {
        stubs: {
          CopyButton,
          ToolBubble,
        },
      },
    });

    expect(wrapper.find('[data-line-kind="plain"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("plain replacement text");
  });

  // UI Parity PR6 N5 (May 2026) — diff line numbers + hunk headers.
  //
  // Pre-fix the renderer emitted a flat coloured-line list with no left/right
  // line numbers and no @@ hunk separation, so a multi-hunk diff read as
  // soup. Parse unified-diff hunks (`@@ -A,B +C,D @@ <ctx>`) and render each
  // hunk as a labelled sub-block with left + right gutters tracking line
  // numbers.
  describe("N5 — hunk headers + line numbers", () => {
    it("parses multi-hunk unified diffs into separate labelled sub-blocks", () => {
      const body = [
        "@@ -1,3 +1,3 @@",
        " context-a",
        "-old-1",
        "+new-1",
        "@@ -10,3 +10,4 @@ funcName",
        " context-b",
        "+added-2",
        " context-c",
      ].join("\n");

      const wrapper = mount(EditTool, {
        props: {
          toolName: "edit",
          heading: "/tmp/multi.txt",
          body,
          status: "completed",
        },
        global: { stubs: { CopyButton, ToolBubble } },
      });

      const hunks = wrapper.findAll('[data-testid="edit-hunk"]');
      expect(hunks).toHaveLength(2);

      const headers = wrapper.findAll('[data-testid="edit-hunk-header"]');
      expect(headers).toHaveLength(2);
      expect(headers[0].text()).toContain("@@ -1,3 +1,3 @@");
      expect(headers[1].text()).toContain("@@ -10,3 +10,4 @@");
      // The optional context label survives.
      expect(headers[1].text()).toContain("funcName");
    });

    it("numbers context lines on both gutters and tracks added/removed correctly", () => {
      // One hunk starting at old=10, new=20:
      //   context        -> old=10, new=20
      //   removed        -> old=11, new=—
      //   added          -> old=—,  new=21
      //   added          -> old=—,  new=22
      //   context        -> old=12, new=23
      const body = [
        "@@ -10,3 +20,4 @@",
        " ctx-start",
        "-removed-row",
        "+added-row-1",
        "+added-row-2",
        " ctx-end",
      ].join("\n");

      const wrapper = mount(EditTool, {
        props: {
          toolName: "edit",
          heading: "/tmp/x.txt",
          body,
          status: "completed",
        },
        global: { stubs: { CopyButton, ToolBubble } },
      });

      const lines = wrapper.findAll('[data-testid="edit-line"]');
      expect(lines).toHaveLength(5);

      // Row 1 — context, both gutters numbered.
      expect(lines[0].attributes("data-line-kind")).toBe("plain");
      expect(lines[0].attributes("data-old-line")).toBe("10");
      expect(lines[0].attributes("data-new-line")).toBe("20");

      // Row 2 — removed, only the old gutter has a number.
      expect(lines[1].attributes("data-line-kind")).toBe("removed");
      expect(lines[1].attributes("data-old-line")).toBe("11");
      expect(lines[1].attributes("data-new-line")).toBe("");

      // Row 3 — added, only the new gutter has a number.
      expect(lines[2].attributes("data-line-kind")).toBe("added");
      expect(lines[2].attributes("data-old-line")).toBe("");
      expect(lines[2].attributes("data-new-line")).toBe("21");

      // Row 4 — added, new=22.
      expect(lines[3].attributes("data-new-line")).toBe("22");

      // Row 5 — context, both gutters advance.
      expect(lines[4].attributes("data-old-line")).toBe("12");
      expect(lines[4].attributes("data-new-line")).toBe("23");
    });

    it("still renders a non-hunk diff (legacy format) without hunk wrappers", () => {
      // No @@ markers — the existing path that just colours +/− stays
      // working.
      const wrapper = mount(EditTool, {
        props: {
          toolName: "edit",
          heading: "/tmp/legacy.txt",
          body: "-old\n+new",
          status: "completed",
        },
        global: { stubs: { CopyButton, ToolBubble } },
      });
      // No hunk headers for legacy diffs.
      expect(wrapper.findAll('[data-testid="edit-hunk-header"]')).toHaveLength(
        0,
      );
      // The legacy `tool-line` rendering survives.
      expect(wrapper.find('[data-line-kind="removed"]').text()).toContain(
        "-old",
      );
      expect(wrapper.find('[data-line-kind="added"]').text()).toContain("+new");
    });
  });

  describe("N5 — opencode-style add/remove summary", () => {
    it("shows +N -M counts above the diff, counted from the parsed hunks", () => {
      const wrapper = mount(EditTool, {
        props: {
          toolName: "edit",
          heading: "/tmp/summary.txt",
          body: "@@ -1,3 +1,3 @@\n context\n-old-1\n+new-1\n+new-2",
          status: "completed",
        },
        global: { stubs: { CopyButton, ToolBubble } },
      });

      const summary = wrapper.get('[data-testid="diff-summary"]');
      expect(
        summary.get('[data-testid="diff-summary-added"]').text(),
      ).toBe("+2");
      expect(
        summary.get('[data-testid="diff-summary-removed"]').text(),
      ).toBe("-1");
    });

    it("counts added/removed lines in the legacy flat format when there are no hunks", () => {
      const wrapper = mount(EditTool, {
        props: {
          toolName: "edit",
          heading: "/tmp/legacy.txt",
          body: "-a\n-b\n+c\n+d\n+e",
          status: "completed",
        },
        global: { stubs: { CopyButton, ToolBubble } },
      });

      const summary = wrapper.get('[data-testid="diff-summary"]');
      expect(summary.text()).toContain("+3");
      expect(summary.text()).toContain("-2");
    });

    it("hides the summary when the body carries no diff markers", () => {
      const wrapper = mount(EditTool, {
        props: {
          toolName: "edit",
          heading: "/tmp/plain.txt",
          body: "plain replacement text",
          status: "completed",
        },
        global: { stubs: { CopyButton, ToolBubble } },
      });

      expect(wrapper.find('[data-testid="diff-summary"]').exists()).toBe(false);
    });
  });

  describe("multiedit — multi-hunk rendering through EditTool", () => {
    it("renders the multiedit tool name, summary, hunk headers, and line styling", () => {
      const body = [
        "@@ -10,3 +10,4 @@",
        " unchanged",
        "-old line",
        "+new line",
        " unchanged",
        "@@ -20,2 +21,3 @@",
        " context",
        "+added line",
        " context",
      ].join("\n");

      const wrapper = mount(EditTool, {
        props: {
          toolName: "multiedit",
          heading: "/tmp/multi-edit.txt",
          body,
          status: "completed",
        },
        global: { stubs: { CopyButton, ToolBubble } },
      });

      expect(
        wrapper.get('[data-testid="tool-bubble"]').attributes("data-tool"),
      ).toBe("multiedit");
      expect(wrapper.get('[data-testid="tool-title"]').text()).toBe("multiedit");
      expect(wrapper.get('[data-testid="tool-subtitle"]').text()).toBe(
        "/tmp/multi-edit.txt",
      );

      const summary = wrapper.get('[data-testid="diff-summary"]');
      expect(
        summary.get('[data-testid="diff-summary-added"]').text(),
      ).toBe("+2");
      expect(
        summary.get('[data-testid="diff-summary-removed"]').text(),
      ).toBe("-1");

      const hunks = wrapper.findAll('[data-testid="edit-hunk"]');
      expect(hunks).toHaveLength(2);

      const headers = wrapper.findAll('[data-testid="edit-hunk-header"]');
      expect(headers).toHaveLength(2);
      expect(headers[0].text()).toContain("@@ -10,3 +10,4 @@");
      expect(headers[1].text()).toContain("@@ -20,2 +21,3 @@");

      const removed = wrapper.findAll('[data-line-kind="removed"]');
      expect(removed).toHaveLength(1);
      expect(removed[0].text()).toContain("-old line");

      const added = wrapper.findAll('[data-line-kind="added"]');
      expect(added).toHaveLength(2);
      expect(added[0].text()).toContain("+new line");
      expect(added[1].text()).toContain("+added line");
    });
  });

  describe("replace-statement diffs (backend sentence format)", () => {
    it('renders a "replaced X with Y in Z" body as a proper diff', () => {
      const body =
        'replaced "line one\\nline two" with "line one\\nline two\\nline three" in /tmp/test.go';
      const wrapper = mount(EditTool, {
        props: {
          toolName: "edit",
          heading: "/tmp/test.go",
          body,
          status: "completed",
        },
        global: { stubs: { CopyButton, ToolBubble } },
      });

      const summary = wrapper.get('[data-testid="diff-summary"]');
      expect(summary.get('[data-testid="diff-summary-added"]').text()).toBe(
        "+1",
      );
      expect(summary.get('[data-testid="diff-summary-removed"]').text()).toBe(
        "-0",
      );

      expect(wrapper.find('[data-testid="edit-hunk"]').exists()).toBe(true);
      expect(wrapper.get('[data-testid="edit-hunk-header"]').text()).toContain(
        "@@ -1,2 +1,3 @@",
      );

      const added = wrapper.find('[data-line-kind="added"]');
      expect(added.text()).toContain("+line three");
      expect(wrapper.findAll('[data-line-kind="plain"]')).toHaveLength(2);
    });

    it("prefers structured toolInput oldString/newString over the body statement", () => {
      const body =
        'replaced "line one\\nline two" with "line one\\nline two\\nline three" in /tmp/test.go';
      const toolInput = JSON.stringify({
        filePath: "/tmp/test.go",
        oldString: "a\nb\nc",
        newString: "a\nb\nc\nd\ne",
      });
      const wrapper = mount(EditTool, {
        props: {
          toolName: "edit",
          heading: "/tmp/test.go",
          body,
          toolInput,
          status: "completed",
        },
        global: { stubs: { CopyButton, ToolBubble } },
      });

      // The body alone would produce +1; toolInput produces +2, proving
      // the structured source wins the priority.
      const summary = wrapper.get('[data-testid="diff-summary"]');
      expect(summary.get('[data-testid="diff-summary-added"]').text()).toBe(
        "+2",
      );
      expect(wrapper.get('[data-testid="edit-hunk-header"]').text()).toContain(
        "@@ -1,3 +1,5 @@",
      );
    });

    it("unescapes \\n and \\t escapes inside the quoted strings", () => {
      const body =
        'replaced "line one\\n\\tline two" with "line one\\n\\tline two\\nline three" in /tmp/test.go';
      const wrapper = mount(EditTool, {
        props: {
          toolName: "edit",
          heading: "/tmp/test.go",
          body,
          status: "completed",
        },
        global: { stubs: { CopyButton, ToolBubble } },
      });

      const lines = wrapper.findAll('[data-testid="edit-line"]');
      expect(lines).toHaveLength(3);
      // The second context line carries the unescaped tab.
      expect(lines[1].text()).toContain("\tline two");
      expect(wrapper.find('[data-line-kind="added"]').text()).toContain(
        "+line three",
      );
    });

    it("falls back to flat rendering when the body matches neither format", () => {
      const wrapper = mount(EditTool, {
        props: {
          toolName: "edit",
          heading: "/tmp/plain.txt",
          body: "just some plain text\nno diff markers",
          status: "completed",
        },
        global: { stubs: { CopyButton, ToolBubble } },
      });

      expect(wrapper.find('[data-testid="edit-hunk"]').exists()).toBe(false);
      expect(wrapper.find('[data-line-kind="plain"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("just some plain text");
    });

    it("renders no hunk when oldString and newString are identical", () => {
      const wrapper = mount(EditTool, {
        props: {
          toolName: "edit",
          heading: "/tmp/noop.txt",
          toolInput: JSON.stringify({
            oldString: "same\ncontent",
            newString: "same\ncontent",
          }),
          body: "anything",
          status: "completed",
        },
        global: { stubs: { CopyButton, ToolBubble } },
      });

      expect(wrapper.find('[data-testid="edit-hunk"]').exists()).toBe(false);
    });

    it("treats an empty oldString as a pure addition", () => {
      const wrapper = mount(EditTool, {
        props: {
          toolName: "edit",
          heading: "/tmp/new.txt",
          toolInput: JSON.stringify({ oldString: "", newString: "a\nb" }),
          body: "anything",
          status: "completed",
        },
        global: { stubs: { CopyButton, ToolBubble } },
      });

      const summary = wrapper.get('[data-testid="diff-summary"]');
      expect(summary.get('[data-testid="diff-summary-added"]').text()).toBe(
        "+2",
      );
      expect(wrapper.findAll('[data-line-kind="added"]')).toHaveLength(2);
      expect(wrapper.get('[data-testid="edit-hunk-header"]').text()).toContain(
        "@@ -1,0 +1,2 @@",
      );
    });
  });
});
