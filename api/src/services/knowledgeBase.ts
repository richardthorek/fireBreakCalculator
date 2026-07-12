/**
 * Curated doctrine knowledge base for the AI assistant.
 *
 * A small, hand-written corpus of facts this codebase already relies on and
 * cites — the production model's design comments (`productionModel.ts`), the
 * vegetation data strategy (`docs/NVIS_INTEGRATION.md`), the route optimizer
 * (`docs/ROUTE_INTELLIGENCE.md`). Every chunk's `source` is a real, checkable
 * reference; nothing here is generated or inferred.
 *
 * Retrieval is a simple keyword-overlap score — no embeddings, no vector
 * store, no network call. This is intentionally a placeholder for the
 * Azure AI Search vector-RAG upgrade documented in docs/AI_ASSISTANT.md: the
 * `retrieveDoctrine` signature is the swap point — a future implementation
 * can replace the body with a real similarity search without touching any
 * caller, because callers only depend on `DoctrineChunk[]` in, ranked out.
 */

export interface DoctrineChunk {
  /** Stable ID — cited by the model as `[[doc:ID]]` and validated against this set. */
  id: string;
  title: string;
  /** The real, checkable source (report, dataset, or this codebase's own model). */
  source: string;
  text: string;
  /** Keywords used for retrieval matching (vegetation types, equipment kinds, topics). */
  tags: string[];
}

export const DOCTRINE_CHUNKS: DoctrineChunk[] = [
  {
    id: 'nwcg-production-tables',
    title: 'Fire line production rates by fuel and slope',
    source: 'NWCG 2021 Fire Line Production Rate Tables',
    text: 'Published production rates for hand crews and machinery are tabulated by resource class, fuel/vegetation type, and slope class — not a single flat rate. Rates drop sharply as fuel density and slope increase; hand crews are far more fuel-sensitive than machinery.',
    tags: ['production', 'rate', 'fuel', 'slope', 'handcrew', 'machinery', 'nwcg'],
  },
  {
    id: 'delwp-report-56',
    title: 'Prediction of firefighting resources for suppression operations',
    source: 'Victorian DELWP Report 56',
    text: 'A production study underpinning per-resource, per-condition fireline construction rates used to calibrate this tool\'s machinery and hand-crew speed factors.',
    tags: ['production', 'rate', 'delwp', 'victoria', 'calibration'],
  },
  {
    id: 'machinery-fuel-factors',
    title: 'Machinery clearing rate vs. fuel type',
    source: 'productionModel.ts (this application\'s calibrated defaults)',
    text: 'Machinery (dozer/grader) clearing rate relative to flat grassland: light shrub ~80%, medium scrub ~55%, heavy forest ~35%. Dozers push through heavier fuel but slow substantially in closed forest with large stems and understorey.',
    tags: ['machinery', 'dozer', 'fuel', 'heavyforest', 'mediumscrub', 'lightshrub', 'grassland', 'rate'],
  },
  {
    id: 'handcrew-fuel-factors',
    title: 'Hand crew clearing rate vs. fuel type',
    source: 'productionModel.ts (this application\'s calibrated defaults)',
    text: 'Hand-tool line construction is far more fuel-sensitive than machinery: relative to flat grassland, light shrub ~62%, medium scrub ~38%, heavy forest ~22%. Heavy forest with understorey can be several times slower than grass for hand crews.',
    tags: ['handcrew', 'fuel', 'heavyforest', 'mediumscrub', 'lightshrub', 'grassland', 'rate'],
  },
  {
    id: 'machinery-slope-limits',
    title: 'Machinery slope safety limits',
    source: 'productionModel.ts, consistent with NWCG dozer guidance',
    text: 'Default maximum workable slope for machinery is 25 degrees, a conservative planning limit consistent with NWCG dozer guidance to avoid sidehill operation beyond roughly 45% grade. Production falls off well before the hard limit: roughly 72% of flat-ground rate at 20 degrees, 48% at 30 degrees.',
    tags: ['machinery', 'dozer', 'slope', 'safety', 'limit', 'steep'],
  },
  {
    id: 'handcrew-slope-tolerance',
    title: 'Hand crew slope tolerance',
    source: 'productionModel.ts (this application\'s calibrated defaults)',
    text: 'Hand crews can work considerably steeper ground than machinery — a default limit of 45 degrees versus 25 for machinery — but still slow with slope: roughly 70% of flat-ground rate at 25 degrees, 55% at 35 degrees.',
    tags: ['handcrew', 'slope', 'steep', 'safety', 'limit'],
  },
  {
    id: 'aircraft-coverage-model',
    title: 'Aircraft retardant/water coverage vs. fuel',
    source: 'productionModel.ts (this application\'s calibrated defaults)',
    text: 'Aircraft are not slowed by slope (they overfly terrain) but heavier fuel needs a higher retardant/water coverage level, so a single load treats proportionally less line: full drop length in grassland, roughly half in heavy forest.',
    tags: ['aircraft', 'fuel', 'coverage', 'drop', 'heavyforest'],
  },
  {
    id: 'break-width-model',
    title: 'Break width and multi-pass construction',
    source: 'productionModel.ts (this application\'s calibrated defaults)',
    text: 'Published production rates are for a single-pass line. Wider breaks need multiple machinery passes at a typical blade cut width around 3.4 m, with widening passes faster than the first (no pioneering resistance). Hand-crew effort grows roughly linearly with break width beyond the standard 3 m hand-line reference.',
    tags: ['breakwidth', 'multipass', 'machinery', 'handcrew', 'construction'],
  },
  {
    id: 'nvis-vegetation-spine',
    title: 'NVIS national vegetation classification',
    source: 'docs/NVIS_INTEGRATION.md — NVIS national (Major Vegetation Group raster)',
    text: 'This application uses NVIS national as the vegetation/fuel data spine across Australia, with the NSW SVTM overlay as a higher-fidelity supplement in NSW. NVIS classifies by Major Vegetation Group (MVG); NoData or out-of-Australia queries are explicitly flagged as estimated, never silently defaulted.',
    tags: ['vegetation', 'nvis', 'fuel', 'classification', 'data', 'confidence'],
  },
  {
    id: 'route-optimizer-corridor',
    title: 'Corridor route optimization',
    source: 'docs/ROUTE_INTELLIGENCE.md — hexagonal multi-pass search',
    text: 'The route optimizer searches a hexagonal grid around the drawn line for a lower-effort path, costing distance by traversal slope and fuel type, discounted where an existing OSM-mapped trail can be reused. It runs three passes (wide scan, refine, polish) and keeps whichever pass scores lowest — it never trades away a gain found in the wide pass.',
    tags: ['optimizer', 'route', 'pathfinding', 'trail', 'corridor'],
  },
  {
    id: 'data-honesty-principle',
    title: 'Estimated vs. authoritative data',
    source: 'CLAUDE.md — project data-honesty principle',
    text: 'Any estimated, fallback, or mock value in this application must stay flagged end to end (usedMockElevation, usedFallbackData, per-segment estimated) so results can be marked as indicative rather than authoritative. This is a safety property: fabricated data must never present as real analysis.',
    tags: ['honesty', 'estimated', 'fallback', 'confidence', 'data'],
  },
];

const CHUNKS_BY_ID = new Map(DOCTRINE_CHUNKS.map((c) => [c.id, c]));

/** Look up a chunk by its citation ID (used to validate model citations). */
export function getDoctrineChunk(id: string): DoctrineChunk | undefined {
  return CHUNKS_BY_ID.get(id);
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'for', 'to', 'is', 'are', 'this', 'that',
  'with', 'it', 'be', 'was', 'at', 'by', 'as', 'from', 'has', 'have', 'will', 'what', 'how',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Rank doctrine chunks by keyword overlap with `query` (title + text + tags,
 * tags weighted higher since they're curated topic labels). Deterministic,
 * synchronous, no network — see module doc for the planned vector-search
 * upgrade path this signature is designed to support without callers changing.
 */
export function retrieveDoctrine(query: string, topK = 3): DoctrineChunk[] {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return [];

  const scored = DOCTRINE_CHUNKS.map((chunk) => {
    const textTokens = tokenize(`${chunk.title} ${chunk.text}`);
    const tagTokens = chunk.tags.map((t) => t.toLowerCase());
    let score = 0;
    for (const t of textTokens) if (queryTokens.has(t)) score += 1;
    for (const t of tagTokens) if (queryTokens.has(t)) score += 3;
    return { chunk, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => s.chunk);
}
