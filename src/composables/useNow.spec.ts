import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { useNow, _resetNowSharedState } from "./useNow";

/**
 * Mounts a minimal component that calls useNow() so lifecycle hooks
 * (onUnmounted) run in the correct setup context.
 */
function mountUseNow() {
  const TestComp = defineComponent({
    setup() {
      return useNow();
    },
    template: "<div />",
  });
  return mount(TestComp);
}

describe("useNow", () => {
  beforeEach(() => {
    _resetNowSharedState();
  });

  afterEach(() => {
    _resetNowSharedState();
    vi.useRealTimers();
  });

  it("returns a now ref with the current timestamp", () => {
    const wrapper = mountUseNow();
    const val: number = (wrapper.vm as any).now;
    expect(typeof val).toBe("number");
    expect(val).toBeGreaterThan(0);
  });

  it("ticks forward after 1 second", () => {
    vi.useFakeTimers();
    const wrapper = mountUseNow();
    const before: number = (wrapper.vm as any).now;

    vi.advanceTimersByTime(1000);

    expect((wrapper.vm as any).now).toBeGreaterThanOrEqual(before + 1000);
  });

  it("stops the interval when the last subscriber unmounts", () => {
    vi.useFakeTimers();

    const wrapper = mountUseNow();
    // Unmount — onUnmounted fires, refCount drops to 0, interval clears
    wrapper.unmount();

    // Mount a fresh subscriber — the interval restarts
    const wrapper2 = mountUseNow();
    const before2: number = (wrapper2.vm as any).now;

    vi.advanceTimersByTime(1000);

    expect((wrapper2.vm as any).now).toBeGreaterThanOrEqual(before2 + 1000);
  });

  it("creates a single interval even with multiple subscribers", () => {
    vi.useFakeTimers();
    const origSetInterval = globalThis.setInterval.bind(globalThis);
    const setIntervalSpy = vi.fn(origSetInterval);
    globalThis.setInterval = setIntervalSpy as unknown as typeof globalThis.setInterval;

    mountUseNow();
    mountUseNow();
    mountUseNow();

    // Only the first subscriber starts the interval
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    globalThis.setInterval = origSetInterval;
  });

  it("_resetNowSharedState clears the interval and subscriber count", () => {
    vi.useFakeTimers();
    mountUseNow(); // subscriber 1
    mountUseNow(); // subscriber 2

    _resetNowSharedState();

    // After reset a fresh subscriber starts a new interval
    const wrapper = mountUseNow();
    const before: number = (wrapper.vm as any).now;
    vi.advanceTimersByTime(1000);
    expect((wrapper.vm as any).now).toBeGreaterThanOrEqual(before + 1000);
  });
});
