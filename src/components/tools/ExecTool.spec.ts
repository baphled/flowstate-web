import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ExecTool from "./ExecTool.vue";
import { getToolComponent } from "@/tools/toolRegistry";
import { registerTools } from "@/tools/registerTools";

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

const CopyButton = {
  props: { text: { type: String, required: true } },
  template: '<span data-testid="copy-btn">{{ text }}</span>',
};

const stubs = { ToolBubble, CopyButton };

function mountExec(props: Partial<Parameters<typeof mount>[1]> & Record<string, unknown> = {}) {
  const { global, ...rest } = props as Record<string, any>;
  return mount(ExecTool, {
    ...rest,
    global: { stubs, ...(global ?? {}) },
  } as any);
}

describe("ExecTool", () => {
  // Silent-success parity with BashTool (I4): collapsed on success so a
  // chain of exec cards doesn't bury the reply; force-open on error so the
  // failure is visible without an extra click.
  it("starts collapsed on success and forces open on error", () => {
    const ok = mountExec({ props: { toolName: "exec", heading: "go test ./...", body: "ok", status: "completed" } });
    expect(ok.get('[data-testid="tool-bubble"]').attributes("data-default-open")).toBe("false");

    const err = mountExec({ props: { toolName: "exec", heading: "go test ./...", body: "FAIL", status: "error" } });
    expect(err.get('[data-testid="tool-bubble"]').attributes("data-default-open")).toBe("true");
  });

  it("shows the command preview as subtitle", () => {
    const w = mountExec({ props: { toolName: "exec", heading: "make build", body: "", status: "completed" } });
    expect(w.get('[data-testid="tool-subtitle"]').text()).toBe("make build");
  });

  it("renders the allowed command and a no-network sandbox hint", () => {
    const w = mountExec({ props: { toolName: "exec", heading: "go vet ./...", body: "no issues", status: "completed" } });
    expect(w.find('[data-component="exec-command"]').exists()).toBe(true);
    expect(w.get('[data-component="exec-sandbox-hint"]').text()).toMatch(/no network/i);
  });

  it("renders stdout body when present", () => {
    const w = mountExec({ props: { toolName: "exec", heading: "ls", body: "a\nb", status: "completed" } });
    expect(w.get('[data-component="exec-output"]').text()).toContain("a\nb");
  });

  it("omits the output section when body is empty", () => {
    const w = mountExec({ props: { toolName: "exec", heading: "true", body: "", status: "completed" } });
    expect(w.find('[data-component="exec-output"]').exists()).toBe(false);
  });

  it("truncates oversized output with a hidden-lines hint and a toggle", async () => {
    const body = Array.from({ length: 2500 }, (_, i) => `line ${i}`).join("\n");
    const w = mountExec({ props: { toolName: "exec", heading: "big", body, status: "completed" } });
    // Starts in full-output mode (parity with BashTool): collapse first.
    await w.get('[data-component="exec-output-toggle"]').trigger("click");
    expect(w.get('[data-component="exec-output-truncation-hint"]').text()).toMatch(/lines hidden/);
    await w.get('[data-component="exec-output-toggle"]').trigger("click");
    expect(w.find('[data-component="exec-output-truncation-hint"]').exists()).toBe(false);
  });

  it("shows a permission-denied note when the command was blocked by the allow-list", () => {
    const w = mountExec({ props: { toolName: "exec", heading: "curl https://example.com", body: "command not in allow-list", status: "error" } });
    expect(w.get('[data-component="exec-denied"]').text()).toMatch(/allow-list/i);
  });
});

describe("exec tool registration", () => {
  it("registers the exec renderer", () => {
    registerTools();
    expect(getToolComponent("exec")).toBeDefined();
  });
});
