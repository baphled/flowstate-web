import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import HighlightedCode from "./HighlightedCode.vue";

/**
 * Unit spec for HighlightedCode. The markdownHighlighter module is mocked
 * so the Shiki lazy-load state is fully deterministic: `highlightCode`
 * returns whatever the test wants and the onHighlighterReady callback is
 * captured and fired manually to simulate the async load completing.
 */
const markdownHighlighter = vi.hoisted(() => ({
  highlightCode: vi.fn<(code: string, lang: string) => string | null>(),
  onHighlighterReady: vi.fn<(cb: () => void) => () => void>(
    () => () => undefined,
  ),
  ensureHighlighterLoaded: vi.fn<() => Promise<void>>(() => Promise.resolve()),
}));

vi.mock("@/lib/markdownHighlighter", () => markdownHighlighter);

const CopyButtonStub = {
  props: { text: { type: String, required: true } },
  template: '<span data-testid="copy-btn">{{ text }}</span>',
};

function mountCode(
  code: string,
  options: { lang?: string; maxHeight?: string } = {},
) {
  return mount(HighlightedCode, {
    props: { code, ...options },
    global: { stubs: { CopyButton: CopyButtonStub } },
  });
}

beforeEach(() => {
  markdownHighlighter.highlightCode.mockReset();
  markdownHighlighter.highlightCode.mockReturnValue(null);
  markdownHighlighter.onHighlighterReady.mockClear();
  markdownHighlighter.ensureHighlighterLoaded.mockClear();
});

describe("HighlightedCode", () => {
  it("renders plain text when code is a simple string", () => {
    const wrapper = mountCode("hello world");

    expect(wrapper.find('[data-testid="highlighted-code"]').exists()).toBe(
      true,
    );
    expect(wrapper.get('[data-testid="highlighted-code"]').text()).toContain(
      "hello world",
    );
  });

  it("detects and pretty-prints JSON objects", () => {
    const wrapper = mountCode('{"b":1,"a":2}');

    const text = wrapper.get('[data-testid="highlighted-code"]').text();
    expect(text).toContain('"a": 2');
    expect(text).toContain('"b": 1');
    expect(text).toContain("\n  ");

    // The highlighter receives the pretty-printed form with lang=json.
    const [highlighted, lang] =
      markdownHighlighter.highlightCode.mock.calls[0] as [string, string];
    expect(highlighted).toBe('{\n  "b": 1,\n  "a": 2\n}');
    expect(lang).toBe("json");
  });

  it("detects and pretty-prints JSON arrays", () => {
    const wrapper = mountCode("[1,2,3]");

    const text = wrapper.get('[data-testid="highlighted-code"]').text();
    expect(text).toContain("1");
    expect(text).toContain("2");
    expect(text).toContain("3");

    const [highlighted, lang] =
      markdownHighlighter.highlightCode.mock.calls[0] as [string, string];
    expect(highlighted).toBe("[\n  1,\n  2,\n  3\n]");
    expect(lang).toBe("json");
  });

  it("does NOT re-format already-pretty-printed JSON", () => {
    const pretty = '{\n  "a": 1\n}';
    const wrapper = mountCode(pretty);

    expect(wrapper.find("pre code").text()).toBe(pretty);
    const [highlighted, lang] =
      markdownHighlighter.highlightCode.mock.calls[0] as [string, string];
    expect(highlighted).toBe(pretty);
    expect(lang).toBe("json");
  });

  it("does not pretty-print non-JSON plain text", () => {
    const wrapper = mountCode("plain output line");

    expect(wrapper.find("pre code").text()).toContain("plain output line");
    const [highlighted, lang] =
      markdownHighlighter.highlightCode.mock.calls[0] as [string, string];
    expect(highlighted).toBe("plain output line");
    // "text" is not a supported grammar — highlightCode returns null and the
    // component falls back to the plain <pre><code> render.
    expect(lang).toBe("text");
  });

  it("passes an explicit language through to the highlighter", () => {
    mountCode("echo hi", { lang: "bash" });

    const [, lang] = markdownHighlighter.highlightCode.mock.calls[0] as [
      string,
      string,
    ];
    expect(lang).toBe("bash");
  });

  it("keeps explicit json lang even when the content is not parseable", () => {
    mountCode("definitely not json", { lang: "json" });

    const [, lang] = markdownHighlighter.highlightCode.mock.calls[0] as [
      string,
      string,
    ];
    expect(lang).toBe("json");
  });

  it("falls back to <pre><code> when the highlighter is not loaded", () => {
    markdownHighlighter.highlightCode.mockReturnValue(null);
    const wrapper = mountCode("const x = 1;", { lang: "typescript" });

    expect(wrapper.find('[data-testid="highlighted-code-plain"]').exists()).toBe(
      true,
    );
    expect(wrapper.find("pre code").text()).toContain("const x = 1;");
  });

  it("re-renders with Shiki HTML when the highlighter finishes loading", async () => {
    markdownHighlighter.highlightCode.mockReturnValue(null);
    const wrapper = mountCode("const x = 1;", { lang: "typescript" });
    expect(wrapper.find('[data-testid="highlighted-code-plain"]').exists()).toBe(
      true,
    );

    const readyCallback = markdownHighlighter.onHighlighterReady.mock.calls[0][0];
    markdownHighlighter.highlightCode.mockReturnValue(
      '<pre class="shiki"><code><span class="line"><span style="--shiki-dark:#CB7676">const</span> x = 1;</span></code></pre>',
    );
    readyCallback();
    await nextTick();
    await nextTick();

    expect(wrapper.find('[data-testid="highlighted-code-plain"]').exists()).toBe(
      false,
    );
    expect(wrapper.html()).toContain("shiki");
    expect(wrapper.text()).toContain("const x = 1;");
  });

  it("kicks off the highlighter load on mount", () => {
    mountCode("hello");

    expect(markdownHighlighter.ensureHighlighterLoaded).toHaveBeenCalledTimes(1);
  });

  it("shows a CopyButton carrying the ORIGINAL code", () => {
    const wrapper = mountCode('{"a":1}');

    // The copy button must receive the raw prop, not the pretty-printed
    // processing result.
    expect(wrapper.get('[data-testid="copy-btn"]').text()).toBe('{"a":1}');
  });

  it("truncates long code with a Show all toggle", async () => {
    const long = "x".repeat(6000);
    const wrapper = mountCode(long);

    const toggle = wrapper.get('[data-testid="highlighted-code-toggle"]');
    expect(toggle.text()).toContain("Show all");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find("pre code").text().length).toBe(5000);

    await toggle.trigger("click");

    expect(wrapper.find("pre code").text().length).toBe(6000);
    expect(
      wrapper.get('[data-testid="highlighted-code-toggle"]').text(),
    ).toContain("Show less");
    expect(
      wrapper
        .get('[data-testid="highlighted-code-toggle"]')
        .attributes("aria-expanded"),
    ).toBe("true");
  });

  it("does not truncate when an explicit maxHeight is set", () => {
    const long = "x".repeat(6000);
    const wrapper = mountCode(long, { maxHeight: "200px" });

    expect(
      wrapper.find('[data-testid="highlighted-code-toggle"]').exists(),
    ).toBe(false);
    expect(wrapper.find("pre code").text().length).toBe(6000);
  });

  it("renders empty and whitespace bodies without crashing", () => {
    const empty = mountCode("");
    expect(empty.find("pre code").exists()).toBe(true);

    const whitespace = mountCode("   ");
    expect(whitespace.find("pre code").exists()).toBe(true);
  });
});
