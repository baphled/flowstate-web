import { defineComponent } from "vue";
import { describe, expect, it } from "vitest";
import {
  CONTEXT_TOOLS,
  getToolComponent,
  isContextTool,
  registerTool,
} from "./toolRegistry";

describe("toolRegistry", () => {
  it("registers a tool and retrieves the matching component", () => {
    const ReadTool = defineComponent({ name: "ReadTool" });

    registerTool({ name: "read", component: ReadTool });

    expect(getToolComponent("read")).toBe(ReadTool);
  });

  it("registers multiple tools and retrieves the correct component for each", () => {
    const GlobTool = defineComponent({ name: "GlobTool" });
    const GrepTool = defineComponent({ name: "GrepTool" });

    registerTool({ name: "glob", component: GlobTool });
    registerTool({ name: "grep", component: GrepTool });

    expect(getToolComponent("glob")).toBe(GlobTool);
    expect(getToolComponent("grep")).toBe(GrepTool);
  });

  it("returns undefined for an unregistered tool", () => {
    expect(getToolComponent("unregistered")).toBeUndefined();
  });

  it("exposes the expected context tool names", () => {
    expect(CONTEXT_TOOLS).toEqual(["read", "glob", "grep", "list"]);
  });

  it("freezes the context tool list", () => {
    expect(Object.isFrozen(CONTEXT_TOOLS)).toBe(true);
  });

  it("identifies read as a context tool", () => {
    expect(isContextTool("read")).toBe(true);
  });

  it("does not identify bash as a context tool", () => {
    expect(isContextTool("bash")).toBe(false);
  });
});

describe("toolNameBasename / toolNamesMatch / namespaced lookup", () => {
  it("strips MCP-style namespace prefixes down to the basename", async () => {
    const { toolNameBasename } = await import("./toolRegistry");
    expect(toolNameBasename("mcp__fs__question")).toBe("question");
    expect(toolNameBasename("plugin::question")).toBe("question");
    expect(toolNameBasename("ns/question")).toBe("question");
    expect(toolNameBasename("question")).toBe("question");
  });

  it("matches wire names to message names modulo namespacing", async () => {
    const { toolNamesMatch } = await import("./toolRegistry");
    expect(toolNamesMatch("question", "question")).toBe(true);
    expect(toolNamesMatch("mcp__fs__question", "question")).toBe(true);
    expect(toolNamesMatch("question", "mcp__fs__question")).toBe(true);
    expect(toolNamesMatch("question", "read")).toBe(false);
  });

  it("resolves a namespaced tool name to its bare-name renderer", async () => {
    const { registerTool, getToolComponent } = await import("./toolRegistry");
    const QuestionTool = defineComponent({ name: "QuestionTool" });
    registerTool({ name: "question", component: QuestionTool });
    expect(getToolComponent("mcp__fs__question")).toBe(QuestionTool);
  });
});
