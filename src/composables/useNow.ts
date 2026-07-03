/**
 * Shared reactive clock that ticks every second.
 *
 * Single `setInterval` at module scope, reference-counted across all
 * subscribers. The interval runs while at least one component has
 * called `useNow()` and is still mounted; it stops when the last
 * subscriber unmounts.
 *
 * This avoids one interval per MessageBubble instance — every in-flight
 * delegation card reads from the same `now` ref and computes its own
 * elapsed offset locally.
 */

import { ref, onUnmounted } from "vue";

const now = ref(Date.now());
let timerId: ReturnType<typeof setInterval> | null = null;
let subscriberCount = 0;

export function useNow(): { now: typeof now } {
  subscriberCount++;
  if (timerId === null) {
    timerId = setInterval(() => {
      now.value = Date.now();
    }, 1000);
  }

  onUnmounted(() => {
    subscriberCount--;
    if (subscriberCount <= 0 && timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  });

  return { now };
}

/**
 * Reset the shared timer state. Exported for test isolation — call in
 * `beforeEach` of any spec file that mounts a component consuming
 * `useNow()` so the subscriber count and interval are clean for each
 * test.
 */
export function _resetNowSharedState(): void {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
  subscriberCount = 0;
  now.value = Date.now();
}
