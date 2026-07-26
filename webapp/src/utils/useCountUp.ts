import { useEffect, useRef, useState } from 'react';
import { REVEAL_DURATION_MS, prefersReducedMotion } from './revealTiming';

/** Ease-out cubic — decelerating, so the number settles rather than
 *  overshooting or arriving at a constant rate. Exported as a pure function
 *  so its shape can be checked without a React render tree. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Pure tween step: value at `elapsedMs` into a `durationMs` move from
 *  `from` to `target`. Clamped at both ends. Split out from the hook below
 *  so the actual interpolation math is independently testable. */
export function tweenCountUp(from: number, target: number, elapsedMs: number, durationMs: number): number {
  const t = Math.min(1, Math.max(0, elapsedMs / durationMs));
  return from + (target - from) * easeOutCubic(t);
}

/**
 * Animates a displayed number tweening toward `target` whenever it changes,
 * instead of snapping — part of the "the reveal is the demo" UI direction
 * (master_plan.md Step 11). Ease-out cubic; respects prefers-reduced-motion
 * (snaps immediately). Returns null while `target` is null so callers can
 * keep their existing "no data yet" rendering unchanged.
 */
export function useCountUp(target: number | null, durationMs: number = REVEAL_DURATION_MS): number | null {
  const [display, setDisplay] = useState<number | null>(target);
  const displayRef = useRef<number | null>(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

    if (target === null) {
      displayRef.current = null;
      setDisplay(null);
      return;
    }

    const from = displayRef.current;
    if (from === null || from === target || prefersReducedMotion()) {
      displayRef.current = target;
      setDisplay(target);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const next = tweenCountUp(from, target, now - start, durationMs);
      const t = Math.min(1, (now - start) / durationMs);
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        displayRef.current = target;
        setDisplay(target);
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [target, durationMs]);

  return display;
}
