/**
 * Shared timing constants for the "reveal" moment — segment colours on the
 * map and the hero-readout numbers in AnalysisPanel arrive together rather
 * than snapping to a finished state, per the 2026-07-26 UI design review
 * (master_plan.md Step 11, "the reveal is the demo"). One constant so the
 * map and the panel can't drift out of sync with each other.
 */

/** Total duration (ms) of the reveal sweep, independent of segment count. */
export const REVEAL_DURATION_MS = 1100;

/** Per-segment stagger floor (ms) — keeps a very short line's reveal from
 *  feeling instant while a very long line's per-segment delay is capped by
 *  REVEAL_DURATION_MS below, not by this floor. */
export const REVEAL_MIN_STAGGER_MS = 40;

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
