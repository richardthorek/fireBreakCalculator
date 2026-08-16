/**
 * `yieldToMain()` — hand control back to the browser's main-thread event
 * loop for one tick, so a pending frame can paint / input can be handled,
 * without the arbitrary extra delay a bare `setTimeout(fn, 0)` risks
 * (browsers clamp/throttle timeouts, especially in a background tab).
 *
 * WHY THIS EXISTS (WP3 performance programme — docs/ROUTE_INTELLIGENCE.md):
 * profiling found `mobilityAppreciation.ts` running its post-search phases
 * (ensemble summary, corridor fields, chokepoints, min-cut barriers, key
 * terrain, observation, concealment) as one unbroken synchronous block with
 * no `await` anywhere in it — the browser tab hangs and nothing paints until
 * the whole thing finishes. The real fix for the CPU-bound phases is moving
 * them into the Web Worker (`mobilityWorker.ts`), which yields for free
 * because `await`ing a worker response is itself a yield point. This helper
 * is for the genuinely cheap phases that legitimately stay on the main
 * thread (`generateKeyTerrainCandidates`'s own header: "cheap, no search
 * runs, safe to call on the main thread") but still sit between two other
 * phases in the same run — calling this between them lets the browser paint
 * whatever the last worker call already delivered before starting the next
 * chunk of work, rather than bundling everything into one paint-starved tick.
 *
 * Prefers the standard `scheduler.yield()` API (Chrome 129+) when available
 * — a real, prioritised yield the browser's own scheduler understands — and
 * falls back to the classic zero-delay `MessageChannel` trick (posts a real
 * macrotask, unlike `setTimeout` which is throttled) for every other
 * browser. Both fall back to `setTimeout` as a last resort for a
 * non-browser/test environment with neither available.
 */

interface SchedulerLike {
  yield?: () => Promise<void>;
}

export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: SchedulerLike }).scheduler;
  if (scheduler && typeof scheduler.yield === 'function') return scheduler.yield();

  return new Promise(resolve => {
    if (typeof MessageChannel !== 'undefined') {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(null);
      return;
    }
    setTimeout(resolve, 0);
  });
}
