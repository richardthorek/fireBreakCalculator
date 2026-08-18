/**
 * Configuration types for Fire Break Calculator resources and capabilities.
 * Defines the structure for machinery, aircraft, and hand crew specifications.
 */

import { TerrainLevel, VegetationType } from '@firebreak/terrain';

export interface MachinerySpec {
  id: string;
  name: string;
  type: 'dozer' | 'grader' | 'other';
  /** Meters per hour clearing rate */
  clearingRate: number;
  /** Breakdown of performance by slope/density conditions */
  performances?: MachineryPerformance[];
  /**
   * Minimum diameter (meters) of individual large objects that the machine
   * is expected to be able to clear or path around. Drivers will path-find
   * between individual large objects; this value is used as a heuristic to
   * determine whether a machine can reasonably operate in a vegetation class.
   */
  minClearDiameter?: number;
  /** Operating cost per hour (optional) */
  costPerHour?: number;
  /** Description of the machinery */
  description?: string;
  /** True for a built-in platform-default catalogue item (see api's
   *  standardEquipment.ts) — threaded through so the AI assistant/reality
   *  check can quote its own sourcing caveat when tasked. */
  standard?: boolean;
  /** One-line sourcing/rationale citation, only set on standard items. */
  sourceNote?: string;
  /** Terrain types this machinery can operate in */
  allowedTerrain: TerrainLevel[];
  /** Vegetation types this machinery can handle (new taxonomy)
   *  Use 'grassland', 'lightshrub', 'mediumscrub', 'heavyforest'
   */
  allowedVegetation: VegetationType[];
  /** Maximum slope this machinery can handle (in degrees) */
  maxSlope?: number;
}

export interface AircraftSpec {
  id: string;
  name: string;
  type: string;
  /** Drop length in meters */
  dropLength: number;
  /** Operating speed in km/h (optional) */
  speed?: number;
  /** Time between drops in minutes */
  turnaroundMinutes?: number;
  /** Operating cost per hour (optional) */
  costPerHour?: number;
  /** Description of the aircraft */
  description?: string;
  /** True for a built-in platform-default catalogue item (see api's
   *  standardEquipment.ts) — threaded through so the AI assistant/reality
   *  check can quote its own sourcing caveat when tasked. */
  standard?: boolean;
  /** One-line sourcing/rationale citation, only set on standard items. */
  sourceNote?: string;
  /** Terrain types this aircraft can operate over */
  allowedTerrain: TerrainLevel[];
  /** Vegetation types this aircraft can effectively treat */
  allowedVegetation: VegetationType[];
}

export interface HandCrewSpec {
  id: string;
  name: string;
  /** Number of crew members */
  crewSize: number;
  /** Meters per hour clearing rate per crew member */
  clearingRatePerPerson: number;
  /** Tool types used by this crew */
  tools: string[];
  /** Operating cost per hour for the entire crew (optional) */
  costPerHour?: number;
  /** Description of the crew type */
  description?: string;
  /** True for a built-in platform-default catalogue item (see api's
   *  standardEquipment.ts) — threaded through so the AI assistant/reality
   *  check can quote its own sourcing caveat when tasked. */
  standard?: boolean;
  /** One-line sourcing/rationale citation, only set on standard items. */
  sourceNote?: string;
  /** Terrain types this crew can work in */
  allowedTerrain: TerrainLevel[];
  /** Vegetation types this crew can handle */
  allowedVegetation: VegetationType[];
}

export interface CalculationRules {
  /** Factor to apply to base clearing rates based on terrain difficulty */
  terrainFactors: Record<TerrainLevel, number>;
  /** Factor to apply based on vegetation density */
  vegetationFactors: Record<VegetationType, number>;
  /** Additional time factor for slopes (per degree) */
  slopeTimeFactor: number;
}

export interface FireBreakConfig {
  machinery: MachinerySpec[];
  aircraft: AircraftSpec[];
  handCrews: HandCrewSpec[];
  calculationRules: CalculationRules;
}

export interface MachineryPerformance {
  /** Maximum slope (degrees) that this performance row applies to */
  slopeMax: number;
  /** Vegetation density key (new taxonomy) */
  density: VegetationType;
  /** Meters per hour achieved under these conditions */
  metersPerHour: number;
  /** Cost per hour under these conditions (optional) */
  costPerHour?: number;
}

/** Slope categories for visualization and analysis */
export type SlopeCategory = 'flat' | 'medium' | 'steep' | 'very_steep';

/** Slope segment data for visualization */
export interface SlopeSegment {
  /** Start point coordinates [lat, lng] */
  start: [number, number];
  /** End point coordinates [lat, lng] */
  end: [number, number];
  /** Full ordered coordinate path for this segment (includes all intermediate interpolated/user points) */
  coords?: [number, number][];
  /** Slope angle in degrees */
  slope: number;
  /** Slope category */
  category: SlopeCategory;
  /** Elevation at start point (meters) */
  startElevation: number;
  /** Elevation at end point (meters) */
  endElevation: number;
  /** Distance of this segment (meters) */
  distance: number;
  /** Cross-slope (side-slope) in degrees — terrain gradient PERPENDICULAR to
   *  the line's own bearing, distinct from `slope` (which is measured ALONG
   *  the line). This is the rollover-risk figure for machinery operating
   *  along a hillside contour; a line can have a gentle along-line slope
   *  while sitting on a steep sidehill. Sampled from DEM points offset either
   *  side of the line, so it is unset when that sampling didn't run. */
  crossSlopeDeg?: number;
}

/** Track analysis data including slope information */
export interface TrackAnalysis {
  /** Total distance of the track */
  totalDistance: number;
  /** Array of slope segments */
  segments: SlopeSegment[];
  /** Maximum slope encountered */
  maxSlope: number;
  /** Average slope across the track */
  averageSlope: number;
  /** Maximum cross-slope (side-slope, perpendicular to the line) encountered —
   *  see `SlopeSegment.crossSlopeDeg`. */
  maxCrossSlope?: number;
  /** Distribution of slope categories */
  slopeDistribution: {
    flat: number;
    medium: number;
    steep: number;
    very_steep: number;
  };
  /** Fine-grained elevation samples along the line (chainage in metres from
   *  the start, elevation in metres, local slope in degrees). Powers the
   *  elevation-profile chart; downsampled to a bounded size. */
  elevationProfile?: ElevationProfileSample[];
  /** True when any elevation sample fell back to the mock service — the
   *  analysis then contains ESTIMATED terrain and must be flagged to the user. */
  usedMockElevation?: boolean;
}

/** One sample of the along-line elevation profile. */
export interface ElevationProfileSample {
  /** Chainage: distance from the start of the line, metres. */
  distanceM: number;
  /** Elevation in metres. */
  elevation: number;
  /** Local slope (degrees) of the sub-step ending at this sample. */
  slope: number;
}

/** Vegetation segment data from Mapbox Terrain v2 analysis */
export interface VegetationSegment {
  /** Start point coordinates [lat, lng] */
  start: [number, number];
  /** End point coordinates [lat, lng] */
  end: [number, number];
  /** Full ordered coordinate path for this segment */
  coords?: [number, number][];
  /** Detected vegetation type */
  vegetationType: VegetationType;
  /** Confidence level (0-1) of the detection */
  confidence: number;
  /** Original landcover class from Mapbox */
  landcoverClass: string;
  /** NSW attributes when authoritative dataset used */
  nswVegClass?: string | null;
  nswVegForm?: string | null;
  nswPCTName?: string | null;
  /** Preferred label for display (e.g., formation/PCTName) */
  displayLabel?: string;
  /** Distance of this segment (meters) */
  distance: number;
  /** True when the class came from a mock/fallback rather than real data. */
  estimated?: boolean;
  /** True for NVIS classes 24/25/26/27/28/99 (aquatic, cleared, unclassified, bare, sea, unknown) —
   *  indicates modified or low-fidelity land; confidence is lower and local verification is advised. */
  isModifiedOrLowFidelity?: boolean;
  /** True when this segment is within snap distance of a mapped waterway or
   *  water body (real OSM geometry, not the vegetation classifier — NVIS/
   *  Mapbox landcover both mislabel open water as low-confidence 'grassland').
   *  Damp ground doesn't carry fire, so this length already functions as a
   *  natural fire break — downstream analysis must exclude it from every
   *  resource's build time/cost (there is nothing to construct) rather than
   *  cost it as ordinary ground to be cleared. */
  isWater?: boolean;
  /** True when this segment is within snap distance of a mapped, reusable
   *  trail/track/road (docs/CALCULATION_REVIEW.md, 2026-07-28) — the SAME
   *  reusable-ground set `routeOptimizer.ts` already uses to prefer
   *  trail-following routes during pathfinding. INFORMATIONAL ONLY: unlike
   *  `isWater` (a structural fact — damp ground genuinely carries no fire, so
   *  it needs zero construction), there is no sourced figure for how much
   *  faster an existing track is to turn into a fire break than clearing
   *  virgin ground, so this does NOT reduce the time/cost estimate — it is
   *  surfaced for the user to weigh, the same treatment already given to
   *  `yearsSinceFire` below and for the identical reason (do not invent a
   *  coefficient). Before this field existed, a route that reused an
   *  existing formed track was costed identically to virgin bush of the same
   *  vegetation class, with nothing in the final estimate to say otherwise. */
  onExistingTrail?: boolean;
  /** Years since NAFI last detected a fire at this segment (northern
   *  Australia/rangelands coverage only — unset almost everywhere else, e.g.
   *  most of NSW/VIC/southern SA). Informational context only: there is no
   *  sourced fuel-age→clearing-rate curve to fold into the time/cost model
   *  (unlike the NWCG/Report 56-grounded fuel-class factors), so this is
   *  surfaced as a fact for the user to weigh, not baked into any number. */
  yearsSinceFire?: number;
  /** 'published' inside NAFI's ground-validated coverage band, 'estimated'
   *  outside it but still within the layer's technical extent. */
  fireHistoryConfidence?: 'published' | 'estimated';
}

/** Vegetation analysis data from Mapbox Terrain v2 */
export interface VegetationAnalysis {
  /** Total distance analyzed */
  totalDistance: number;
  /** Array of vegetation segments */
  segments: VegetationSegment[];
  /** Predominant vegetation type across the track */
  predominantVegetation: VegetationType;
  /** Distribution of vegetation types (distance in meters) */
  vegetationDistribution: Record<VegetationType, number>;
  /** Overall confidence of the analysis */
  overallConfidence: number;
  /** True when any segment's class came from mock/fallback data — results are
   *  then indicative only and must be flagged to the user. */
  usedFallbackData?: boolean;
  /** Real mapped watercourse/water-body geometry fetched once for the whole
   *  line (the same corridor-wide fetch each segment's `isWater` flag is
   *  derived from) — carried through so the map can draw it as a visible
   *  reference layer, same shape/purpose as Terrain Mobility's own hydrology
   *  reference layer (docs §34). `kind === 'water'` (closed ring, `natural=
   *  water`) renders as a filled polygon; anything else (river/stream/canal
   *  `waterway=*`) renders as a line. */
  waterFeatures?: { kind: string; coords: { lat: number; lng: number }[] }[];
  /** Real mapped track/trail/minor-road geometry fetched once for the whole
   *  line — the same reusable-trail set each segment's `onExistingTrail`
   *  flag is derived from (docs/CALCULATION_REVIEW.md, 2026-07-28). Carried
   *  through purely so the map can show WHERE the reused ground is; the
   *  flag itself already covers the cost-model side (informational only,
   *  no discount applied). */
  trailFeatures?: { kind: string; coords: { lat: number; lng: number }[] }[];
}