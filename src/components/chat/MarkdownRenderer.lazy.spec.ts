import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureLangLoaded } from "@/lib/markdownHighlighter";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import MarkdownRenderer from "@/components/chat/MarkdownRenderer.vue";

/**
 * Perf contract (Sep 2026 headless audit): Shiki grammars must be
 * fetched ONLY when a fence of that language is first encountered —
 * mounting the chat surface must pull zero grammar chunks. The
 * typescript grammar factory is mocked with a spy so the spec can
 * observe whether the dynamic import fired at all.
 */
const tsGrammarSpy = vi.hoisted(() => vi.fn());
vi.mock("@shikijs/langs/typescript", () => {
  tsGrammarSpy();
  // Minimal VALID grammar registration — textmate's Resolver walks
  // scopeName/injection patterns, so {name:"typescript"} alone crashes
  // getInjections with "Cannot read properties of undefined (reading
  // 'split')".
  return {
    default: { name: "typescript", scopeName: "source.ts", patterns: [] },
  };
});

describe("markdownHighlighter lazy grammar loading", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    tsGrammarSpy.mockClear();
  });

  it("does not import any grammar on mount when the message has no code fences", async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: "just prose, no fences here" },
    });
    // Flush the core highlighter + active-theme loads (they are
    // legitimately eager-ish on first mount) plus any stray microtasks.
    await flushPromises();

    expect(wrapper.find(".markdown-body").exists()).toBe(true);
    expect(tsGrammarSpy).not.toHaveBeenCalled();
  });

  it("does not import the typescript grammar when only a bash fence is rendered", async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: "```bash\necho hi\n```" },
    });
    // Cover the core→grammar→ready-pulse→re-render chain.
    await flushPromises();
    await nextTick();
    await flushPromises();

    // Bash tokenised (grammar loaded on demand) — but the typescript
    // grammar chunk must never have been requested.
    expect(wrapper.html()).toContain("shiki");
    expect(tsGrammarSpy).not.toHaveBeenCalled();
  });

  it("imports the typescript grammar only when a typescript fence is first rendered", async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: "```typescript\nconst x: number = 1;\n```" },
    });
    // First paint: plain fallback while the grammar chunk loads.
    await flushPromises();
    expect(tsGrammarSpy).toHaveBeenCalledTimes(1);
    await ensureLangLoaded("typescript");
    await flushPromises();
    await nextTick();
    await flushPromises();

    // Ready pulse fired → re-render tokenised the block.
    expect(wrapper.html()).toContain("shiki");
    expect(tsGrammarSpy).toHaveBeenCalledTimes(1);
  });
});
