/**
 * Vegetation STRUCTURE lookup — docs/ROUTE_INTELLIGENCE.md §10.4/§10.7 (M3a–M3c),
 * §11.6. Replaces the Tier-0 placeholder `estimateStructureFromVegetation` in
 * `../mobilityCost.ts` with a smaller, honestly-sourced table. This module does
 * NOT wire itself in — someone else swaps the call site once this is reviewed.
 *
 * ---------------------------------------------------------------------------
 * KEYING SCHEME: VegetationType (4-class), not NVIS MVG code — and why
 * ---------------------------------------------------------------------------
 * Docs §10.3(a) envisages a full NVIS-MVG-keyed structural table ("a *second*
 * curated lookup — NVIS MVS → { canopy cover class, dominant growth form,
 * expected understorey type, multiStem/thicket flag, expected stem density
 * range, expected DBH distribution }"). That is NOT what this file builds, for
 * three concrete reasons rather than convenience:
 *
 * 1. Neither citable source found this session resolves to a single MVG code.
 *    Wood et al. 2015's 48 AusPlots Forest Monitoring Network plots span
 *    several eucalypt forest MVGs (tall open / open forest — MVG 2/3), not one;
 *    the NSW stem-retention figure below is defined against a NSW vegetation
 *    *formation* (SVTM lineage), not an MVG code. Inventing a per-MVG split of
 *    either figure would be exactly the "precise-looking number with no basis"
 *    this task explicitly forbids.
 * 2. The DCCEEW/agriculture.gov.au NVIS MVG fact sheets (mvg5, mvg11, mvg14,
 *    mvg18 …) that would let a per-MVG table be built defensibly returned
 *    HTTP 503 from every host tried in this sandbox this session (both
 *    dcceew.gov.au and the agriculture.gov.au mirror) — a network limitation
 *    of this sandbox, not evidence the sources don't exist. Building a 33-row
 *    MVG table without being able to read a single MVG's own structural
 *    description would be worse than not building it.
 * 3. `estimateStructureFromVegetation` (the function this replaces) is already
 *    keyed by `VegetationType`, and so is every call site in `mobilityCost.ts`
 *    / `accumulatedCost.ts`. Keeping the same key means this table is a
 *    drop-in replacement with no new MVG→VegetationType bridging layer to
 *    validate in the same pass.
 *
 * The existing MVG→VegetationType bridge already lives in
 * `../../utils/nvisVegetationService.ts` (`MVG_CLASSES`, `mapMVGCode`) — a
 * future MVG-keyed version of this table is a straightforward extension: key
 * by MVG code, resolve to `VegetationType` via that existing map for any
 * caller that only has the 4-class taxonomy, exactly mirroring the
 * NVIS-spine + overlay pattern the rest of the repo already commits to.
 *
 * ---------------------------------------------------------------------------
 * WHAT'S REAL, WHAT'S DERIVED, WHAT'S UNCHANGED — per row, see the JSDoc above
 * each entry in STRUCTURE_TABLE. Summary:
 *  - heavyforest: stemsPerHectare / basalAreaM2PerHa are DIRECTLY REPORTED
 *    figures from a peer-reviewed, continental permanent-plot network
 *    (confidence 'published'). stemDiameterMedianMm is DERIVED from those two
 *    published numbers via the standard forestry quadratic-mean-diameter
 *    back-calculation (shown below) — a real computation over real inputs,
 *    not a guess, but not itself a number the source states, so it is called
 *    out as derived rather than silently presented as equally primary.
 *    gapWidthEstimateM is UNCHANGED from the Tier-0 placeholder: docs §10.4 is
 *    explicit that deriving gap-width analytically from density + diameter
 *    (a spatial point-process / percolation problem) is its own bounded
 *    research task, not solved by this pass.
 *  - mediumscrub: stemsPerHectare is a REAL, government-published number, but
 *    a regulatory minimum-retention *floor* for an adjacent vegetation
 *    formation used here as an order-of-magnitude anchor, not a direct field
 *    measurement of this class — confidence 'estimated', with the mismatch
 *    stated plainly.
 *  - lightshrub / grassland: no citable field-plot or government structural
 *    figure was found in the time available (see per-row notes). Values are
 *    UNCHANGED from the Tier-0 placeholder and marked 'generic-fallback' —
 *    explicitly no better than what exists today, per this task's own
 *    instruction that an honest "couldn't improve this" beats a padded guess.
 */

import { VegetationType } from '../../config/classification';
import { ConfidenceTier } from '../../components/DataConfidenceBadge';

export interface StructureEstimate {
  /** Representative stem diameter, mm. */
  stemDiameterMedianMm: number;
  /** Widest available cross-country gap along a short (~50 m) straight
   *  crossing, metres. */
  gapWidthEstimateM: number;
  /** Stems per hectare — present only where a real figure (measured or a
   *  named regulatory benchmark) backs it; absent rather than guessed. */
  stemsPerHectare?: number;
  /** Basal area, m²/ha — present only where a real figure backs it. */
  basalAreaM2PerHa?: number;
  confidence: ConfidenceTier;
  /** Full citation (or, for a fallback row, an explicit statement that none
   *  was found and why) — this table's only real credibility rests here. */
  source: string;
}

// ---------------------------------------------------------------------------
// heavyforest — Wood, Prior, Stephens & Bowman (2015), PLOS ONE
// ---------------------------------------------------------------------------
//
// "Macroecology of Australian Tall Eucalypt Forests: Baseline Data from a
// Continental-Scale Permanent Plot Network", PLOS ONE 10(9): e0137811.
// AusPlots Forest Monitoring Network — 48 one-hectare permanent plots in
// mature-growth tall eucalypt forest across cool temperate, Mediterranean,
// subtropical and tropical Australian climates, censused 2012–2015 (20,931
// individually tagged stems network-wide). This is the exact source
// docs/ROUTE_INTELLIGENCE.md §11.6 names as one of the two promising
// AusPlots networks, and the one that yielded usable network-level figures
// from its published narrative (the 442-plot general AusPlots network's
// per-vegetation-type basal area lives in the underlying `ausplotsR` data
// package, which needs an R environment this sandbox does not have — see
// docs §10.4's own prediction that this would be the limiting factor).
//
// DIRECTLY REPORTED (confidence 'published'):
//   stand-level total stem density: 172 stems/ha (network mean; per-plot
//     range 47–381)
//   stand-level total basal area:   50 m²/ha (network mean; per-plot range
//     17–85)
// These are the network's own summary statistics for ALL tagged stems (not
// eucalypts alone) at whatever minimum-DBH threshold the plot protocol tags
// at — the paper does not restate that threshold in the passages retrieved
// this session, so treat "stemsPerHectare" here as the paper's own
// stand-level census figure, not independently re-derived.
//
// DERIVED (not a number the paper states directly): stemDiameterMedianMm.
// Basal area of a stand relates to stem count and diameter by
//   BA (m²/ha) = N (stems/ha) × (π/4) × d² (d = quadratic mean diameter, m)
// which rearranges to d = sqrt(4·BA / (π·N)) — a standard forestry
// back-calculation (quadratic mean diameter, QMD), not a guess:
//   d = sqrt(4 × 50 / (π × 172)) = sqrt(0.370) ≈ 0.608 m ≈ 610 mm.
// Cross-check: the paper separately (independently) describes dominant/
// co-dominant eucalypts as forming "distinctive cohorts of mature trees with
// DBH of 50–100 cm" (500–1000 mm) — 610 mm QMD sits inside that band, which
// is reassuring given QMD is basal-area-weighted and therefore dominated by
// the largest stems, exactly the eucalypt overstorey the paper describes.
// It is NOT a median across the whole stem population including the
// non-eucalypt understorey (60% of stems network-wide per the same paper,
// typically much finer than the overstorey) — that finer distribution is
// exactly what docs §10.4's planned analytic gap-width derivation needs, and
// is not attempted here.
//
// UNCHANGED: gapWidthEstimateM carries the Tier-0 placeholder forward. See
// file header — deriving this properly is its own research task per docs
// §10.4, out of scope for this pass.
const HEAVYFOREST: StructureEstimate = {
  stemDiameterMedianMm: 610,
  gapWidthEstimateM: 2,
  stemsPerHectare: 172,
  basalAreaM2PerHa: 50,
  confidence: 'published',
  source:
    'Wood, Prior, Stephens & Bowman (2015), "Macroecology of Australian Tall Eucalypt Forests", ' +
    'PLOS ONE 10(9):e0137811 — AusPlots Forest Monitoring Network, 48 one-ha plots. ' +
    'stemsPerHectare/basalAreaM2PerHa are the paper’s own reported network mean (per-plot ranges ' +
    '47–381 stems/ha, 17–85 m²/ha). stemDiameterMedianMm is DERIVED (quadratic mean diameter, ' +
    'd = sqrt(4·BA/(π·N)) ≈ 610 mm) from those two figures, not independently reported; ' +
    'gapWidthEstimateM is the unchanged Tier-0 placeholder (see module header).',
};

// ---------------------------------------------------------------------------
// mediumscrub — NSW Government minimum stem-retention benchmark (real number,
// imperfect fit — used as an order-of-magnitude anchor only)
// ---------------------------------------------------------------------------
//
// NSW Government, "Pasture Expansion technical guide" (Local Land Services,
// under the Native Vegetation Regulatory framework, Local Land Services Act
// 2013), updated September 2025: for a worked uniform-thinning example over
// dry sclerophyll vegetation (neither an Endangered nor Vulnerable Ecological
// Community), "the minimum stem density of trees to retain is 150 stems per
// hectare", with trees over 90 cm DBHOB required to be retained regardless.
//
// This is a REAL, government-published figure, but it is a regulatory FLOOR
// (the minimum a landholder must leave after lawful thinning), not a mean
// natural stand density — an unmodified stand ordinarily carries more stems
// than its own legal minimum. It is also defined against "dry sclerophyll"
// vegetation, which this app's own NSW classifier
// (`nswVegetationService.ts`'s `mapNSWToInternal`) maps to `heavyforest`
// alongside wet sclerophyll and rainforest, not to `mediumscrub` — so using
// it here is a genuine cross-class approximation, not a clean match. It is
// used for mediumscrub anyway, as the closest real, citable stem-density
// figure to a "moderate stocking" woodland/scrub class found this session,
// and is explicitly marked 'estimated' rather than 'published' for both
// reasons (regulatory floor, not a mean; adjacent class, not an exact match).
//
// No basal area figure for this class was found — left absent (per the
// interface contract) rather than invented. stemDiameterMedianMm and
// gapWidthEstimateM are UNCHANGED from the Tier-0 placeholder: no citable
// diameter-distribution or gap source for this class was found in the time
// available.
const MEDIUMSCRUB: StructureEstimate = {
  stemDiameterMedianMm: 150,
  gapWidthEstimateM: 4,
  stemsPerHectare: 150,
  confidence: 'estimated',
  source:
    'NSW Government, "Pasture Expansion technical guide" (Local Land Services, Native Vegetation ' +
    'Regulatory framework under the Local Land Services Act 2013), updated September 2025: minimum ' +
    'stem retention of 150 stems/ha for dry sclerophyll formations under lawful thinning. Real, ' +
    'government-published figure, but a REGULATORY MINIMUM-RETENTION FLOOR (not a natural mean ' +
    'density) applied here to an adjacent vegetation class as an order-of-magnitude anchor only — ' +
    'this app’s own NSW classifier maps "dry sclerophyll" to heavyforest, not mediumscrub. ' +
    'stemDiameterMedianMm and gapWidthEstimateM are the unchanged Tier-0 placeholder; no basal-area ' +
    'figure was found so it is omitted rather than guessed.',
};

// ---------------------------------------------------------------------------
// lightshrub — no citable source found this session
// ---------------------------------------------------------------------------
//
// Candidates checked and why they didn't pan out in the time available:
//  - NVIS MVG 11 (Eucalypt Open Woodlands) and MVG 22 (Chenopod/Samphire
//    Shrublands) fact sheets (docs' own recommended structural source,
//    §10.3a) — every dcceew.gov.au and agriculture.gov.au fetch attempted
//    this session returned HTTP 503. This is a sandbox network limitation
//    (this repo's own environment notes call out exactly this failure mode
//    for .gov.au hosts), not evidence the sources don't exist or don't help.
//  - General literature search (TERN AusPlots rangelands narrative papers —
//    Guerin et al. 2017, Baruch et al. 2018) confirmed basal area IS
//    measured for these formations by the AusPlots protocol, but the actual
//    per-vegetation-type values live in the underlying `ausplotsR` data
//    package (needs an R environment this sandbox doesn't have), not in the
//    papers' own narrative text or tables retrieved this session.
// Values unchanged from the Tier-0 placeholder.
const LIGHTSHRUB: StructureEstimate = {
  stemDiameterMedianMm: 60,
  gapWidthEstimateM: 8,
  confidence: 'generic-fallback',
  source:
    'No citable field-plot or government structural figure found this session for open woodland / ' +
    'sparse shrubland (NVIS MVG 11/22 fact sheets returned HTTP 503 from this sandbox; the relevant ' +
    'AusPlots rangelands figures live in the ausplotsR data package, not accessible without an R ' +
    'environment). Values are the unchanged mobilityCost.ts Tier-0 placeholder — explicitly no ' +
    'better than what exists today, not a fabricated improvement.',
};

// ---------------------------------------------------------------------------
// grassland — no numeric source found or, arguably, needed
// ---------------------------------------------------------------------------
//
// Grassland/tussock/hummock-grassland formations lack a tree or shrub
// structural layer by definition in the Specht (1970) structural
// classification NVIS's own growth-form/cover attributes are built on — so
// "stem diameter" and "gap width" are not meaningfully binding constraints
// for vehicle passability here in the way they are for the other three
// classes, which is exactly why docs §10 frames the whole fidelity problem
// as being about scrub/woodland, not grassland. That qualitative point is
// well-established and did not need a fresh fetch to state, but no
// independent NUMERIC source for grass-tussock spacing/diameter was sought
// or found (and the current placeholder numbers already reflect "wide open,
// no real stem obstruction" correctly in direction, if not by citation) —
// so this row is marked 'generic-fallback' rather than upgraded on the
// strength of a qualitative-only argument.
const GRASSLAND: StructureEstimate = {
  stemDiameterMedianMm: 20,
  gapWidthEstimateM: 50,
  confidence: 'generic-fallback',
  source:
    'No numeric field source sought/found this session. Qualitatively defensible as-is: grassland/' +
    'tussock/hummock-grassland formations carry no tree or shrub layer by definition (Specht 1970 ' +
    'structural classification, which NVIS’s own growth-form/cover attributes are built on), so ' +
    'stem diameter/gap width are not meaningfully binding for this class — but that is a ' +
    'qualitative argument, not a citation for these specific numbers, which are the unchanged ' +
    'mobilityCost.ts Tier-0 placeholder.',
};

const STRUCTURE_TABLE: Record<VegetationType, StructureEstimate> = {
  grassland: GRASSLAND,
  lightshrub: LIGHTSHRUB,
  mediumscrub: MEDIUMSCRUB,
  heavyforest: HEAVYFOREST,
};

/**
 * Look up the best-available structure estimate for a vegetation class. Pure,
 * synchronous, no network — every row is a static, cited constant (see above
 * for exactly what is real vs derived vs unimproved per row). Replacement
 * candidate for `estimateStructureFromVegetation` in `../mobilityCost.ts`
 * (not wired in by this module — see file header).
 */
export function lookupStructure(vegetation: VegetationType): StructureEstimate {
  return STRUCTURE_TABLE[vegetation] ?? MEDIUMSCRUB;
}

// =============================================================================
// SCREENING_HEIGHT_M — OCOKA 6 (docs/ROUTE_INTELLIGENCE.md §47, master_plan.md
// "Next up"), for `terrain/viewshed.ts`'s line-of-sight occlusion test: how
// tall a stand of this vegetation class typically stands, i.e. how much of an
// observer's or target's height it can hide.
//
// PROVENANCE, STATED PLAINLY. Unlike every row above (each anchored to a
// field-plot or regulatory figure specific to ONE vegetation class), these
// four values are derived from a single shared standard: Specht (1970)'s tree
// height classes (>30 m tall / 10–30 m mid / 5–10 m low forest) and Muir
// (1977)'s shrub height classes (>2 m tall shrubland / <2 m low shrubland) —
// the two structural standards NVIS itself is built on (confirmed via
// websearch this session; the primary source, DCCEEW's own "Australian
// Vegetation Attribute Manual" chapter 2, returned HTTP 503 from this
// sandbox on every attempt, the SAME sandbox network limitation already
// recorded against dcceew.gov.au in this file's LIGHTSHRUB row — so this is
// citing a well-established, government-adopted classification standard
// confirmed via secondary description, not a number read off the primary
// PDF table). Each row below is a REPRESENTATIVE POINT within the relevant
// band for this app's own `VegetationType`↔MVG mapping
// (`nvisVegetationService.ts`'s `MVG_CLASSES`), not a directly-measured
// canopy height for this exact class — hence 'estimated', never 'published',
// for every row except grassland (see its own note).
export interface ScreeningHeight {
  /** Representative screening height, metres. What a line of sight must
   *  clear to see past (or through) a stand of this class. */
  heightM: number;
  confidence: ConfidenceTier;
  source: string;
}

const SPECHT_MUIR_CITATION =
  'Specht (1970) tree-strata height classes (>30 m tall / 10–30 m mid / 5–10 m low forest) and ' +
  'Muir (1977) shrub-strata height classes (>2 m tall shrubland / <2 m low shrubland) — the ' +
  'structural standards NVIS height classes are built on, confirmed via websearch this session ' +
  '(DCCEEW\'s own primary PDF, the Australian Vegetation Attribute Manual ch.2, returned HTTP 503 ' +
  'from this sandbox, same limitation already recorded in this file\'s LIGHTSHRUB row).';

const GRASSLAND_HEIGHT: ScreeningHeight = {
  heightM: 0.5,
  confidence: 'estimated',
  source:
    'Grassland/tussock/hummock-grassland formations carry no tree or shrub stratum by definition ' +
    '(Specht 1970 structural classification — same citation this file\'s own GRASSLAND row already ' +
    'uses for the equivalent qualitative point). 0.5 m is a representative tussock/hummock height, ' +
    'not a measured figure for this app\'s AOIs.',
};

const LIGHTSHRUB_HEIGHT: ScreeningHeight = {
  heightM: 1.0,
  confidence: 'estimated',
  source:
    `${SPECHT_MUIR_CITATION} This app's lightshrub class maps mostly to open woodland / sparse ` +
    'shrubland MVGs (11, 13, 22, 31 — see nvisVegetationService.ts) — the lower Muir "low shrubland" ' +
    'band (<2 m); 1.0 m is a representative point within it, not this specific class measured.',
};

const MEDIUMSCRUB_HEIGHT: ScreeningHeight = {
  heightM: 3.0,
  confidence: 'estimated',
  source:
    `${SPECHT_MUIR_CITATION} This app's mediumscrub class maps to woodland/shrubland/heath/mallee ` +
    'MVGs (5, 6, 8, 14–18, 29, 32) — spanning Muir\'s "tall shrubland" band (>2 m) and the lower edge ' +
    'of Specht\'s low-forest band; 3.0 m is a representative point above the 2 m tall-shrub threshold, ' +
    'not this specific class measured.',
};

const HEAVYFOREST_HEIGHT: ScreeningHeight = {
  heightM: 20.0,
  confidence: 'estimated',
  source:
    `${SPECHT_MUIR_CITATION} This app's heavyforest class maps mostly to open/tall-open forest MVGs ` +
    '(1–4, 7, 9, 10, 30 — the SAME MVG range Wood et al. 2015\'s tall-eucalypt-forest plots this ' +
    'file\'s own HEAVYFOREST row is anchored to), i.e. Specht\'s 10–30 m mid/open-forest band; 20 m is ' +
    'a representative point within it, not a canopy height this app has directly measured.',
};

const SCREENING_HEIGHT_M: Record<VegetationType, ScreeningHeight> = {
  grassland: GRASSLAND_HEIGHT,
  lightshrub: LIGHTSHRUB_HEIGHT,
  mediumscrub: MEDIUMSCRUB_HEIGHT,
  heavyforest: HEAVYFOREST_HEIGHT,
};

/** Look up the representative screening height for a vegetation class —
 *  `terrain/viewshed.ts`'s only use of this file. Same fallback discipline
 *  as `lookupStructure`. */
export function lookupScreeningHeight(vegetation: VegetationType): ScreeningHeight {
  return SCREENING_HEIGHT_M[vegetation] ?? MEDIUMSCRUB_HEIGHT;
}
