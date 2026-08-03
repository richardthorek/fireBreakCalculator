/**
 * How much a displayed number can be trusted: measured > published >
 * estimated > generic-fallback. Lives here (not in the React badge
 * component that renders it) so pure terrain modules — which only need the
 * type, never the component — don't pull a `.tsx` file into a package with
 * no React/DOM dependency. `components/DataConfidenceBadge.tsx` re-exports
 * this for its own webapp consumers.
 */
export type ConfidenceTier = 'measured' | 'published' | 'estimated' | 'generic-fallback';
