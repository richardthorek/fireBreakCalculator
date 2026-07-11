/**
 * Configuration types for Fire Break Calculator resources and capabilities.
 * Defines the structure for machinery, aircraft, and hand crew specifications.
 */

import { TerrainLevel, VegetationType } from '../config/classification';

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
}