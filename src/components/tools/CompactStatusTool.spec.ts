import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import CompactStatusTool from "./CompactStatusTool.vue";
import { showToast } from "@/composables/useToast";

vi.mock("@/composables/useToast", () => ({
  showToast: vi.fn(),
}));

describe("CompactStatusTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the heading text", () => {
    const wrapper = mount(CompactStatusTool, {
      props: {
        toolName: "webfetch",
        heading: "webfetch https://example.com",
        body: "",
        status: "completed",
      },
    });

    expect(
      wrapper.find('[data-testid="compact-status-tool"]').exists(),
    ).toBe(true);
    expect(wrapper.text()).toContain("webfetch https://example.com");
  });

  it("shows spinner glyph for pending status", () => {
    const wrapper = mount(CompactStatusTool, {
      props: {
        toolName: "websearch",
        heading: "websearch query",
        body: "",
        status: "pending",
      },
    });

    expect(wrapper.get('[data-testid="compact-status-glyph"]').text()).toBe(
      "⟳",
    );
  });

  it("shows spinner glyph for running status", () => {
    const wrapper = mount(CompactStatusTool, {
      props: {
        toolName: "websearch",
        heading: "websearch query",
        body: "",
        status: "running",
      },
    });

    expect(wrapper.get('[data-testid="compact-status-glyph"]').text()).toBe(
      "⟳",
    );
  });

  it("shows checkmark glyph for completed status", () => {
    const wrapper = mount(CompactStatusTool, {
      props: {
        toolName: "webfetch",
        heading: "webfetch https://example.com",
        body: "Fetched body",
        status: "completed",
      },
    });

    expect(wrapper.get('[data-testid="compact-status-glyph"]').text()).toBe(
      "✓",
    );
  });

  it("does not render inline card when status is error", () => {
    const wrapper = mount(CompactStatusTool, {
      props: {
        toolName: "webfetch",
        heading: "webfetch https://example.com",
        body: "Error: request failed",
        status: "error",
      },
    });

    // Inline compact-status-tool element must NOT be rendered for error.
    expect(
      wrapper.find('[data-testid="compact-status-tool"]').exists(),
    ).toBe(false);

    // No toast on direct mount (watch is not immediate — only transitions
    // from another status trigger the toast; that is covered by the
    // transition test below).
    expect(showToast).not.toHaveBeenCalled();
  });

  it("does not emit toast for non-error statuses (pending, running, completed)", () => {
    for (const status of ["pending", "running", "completed"] as const) {
      mount(CompactStatusTool, {
        props: {
          toolName: "webfetch",
          heading: "webfetch url",
          body: "",
          status,
        },
      });
      expect(showToast).not.toHaveBeenCalled();
    }
  });

  it("applies spinning class for pending status", () => {
    const wrapper = mount(CompactStatusTool, {
      props: {
        toolName: "websearch",
        heading: "websearch query",
        body: "",
        status: "pending",
      },
    });

    expect(
      wrapper
        .get('[data-testid="compact-status-glyph"]')
        .classes("compact-status-tool__glyph--spinning"),
    ).toBe(true);
  });

  it("applies spinning class for running status", () => {
    const wrapper = mount(CompactStatusTool, {
      props: {
        toolName: "websearch",
        heading: "websearch query",
        body: "",
        status: "running",
      },
    });

    expect(
      wrapper
        .get('[data-testid="compact-status-glyph"]')
        .classes("compact-status-tool__glyph--spinning"),
    ).toBe(true);
  });

  it("does not apply spinning class for completed status", () => {
    const wrapper = mount(CompactStatusTool, {
      props: {
        toolName: "webfetch",
        heading: "webfetch url",
        body: "",
        status: "completed",
      },
    });

    expect(
      wrapper
        .get('[data-testid="compact-status-glyph"]')
        .classes("compact-status-tool__glyph--spinning"),
    ).toBe(false);
  });

  it("transitions from running to error — hides inline render and emits toast", async () => {
    const wrapper = mount(CompactStatusTool, {
      props: {
        toolName: "websearch",
        heading: "websearch query",
        body: "",
        status: "running",
      },
    });

    // Initially renders inline while running.
    expect(
      wrapper.find('[data-testid="compact-status-tool"]').exists(),
    ).toBe(true);
    expect(showToast).not.toHaveBeenCalled();

    // Transition to error simulates tool_error SSE event.
    await wrapper.setProps({ status: "error", body: "Error: timeout" });

    // Inline render disappears.
    expect(
      wrapper.find('[data-testid="compact-status-tool"]').exists(),
    ).toBe(false);

    // Error toast emitted on transition.
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "error",
      }),
    );
  });

  it("defaults status to completed", () => {
    const wrapper = mount(CompactStatusTool, {
      props: {
        toolName: "webfetch",
        heading: "webfetch url",
        body: "",
      },
    });

    expect(wrapper.get('[data-testid="compact-status-glyph"]').text()).toBe(
      "✓",
    );
  });
});
