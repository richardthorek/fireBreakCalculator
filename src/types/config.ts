/**
 * Configuration types for Fire Break Calculator resources and capabilities.
 * Defines the structure for machinery, aircraft, and hand crew specifications.
 */

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
  allowedTerrain: ('easy' | 'moderate' | 'difficult' | 'extreme')[];
  /** Vegetation types this machinery can handle (new taxonomy) */
  allowedVegetation: ('grassland' | 'lightshrub' | 'mediumscrub' | 'heavyforest')[];
}

export interface AircraftSpec {
  id: string;
  name: string;
  type: 'helicopter' | 'fixed_wing' | 'other';
  /** Drop length in meters */
  dropLength: number;
  /** Operating speed in km/h */
  speed: number;
  /** Time between drops in minutes */
  turnaroundTime: number;
  /** Operating cost per hour (optional) */
  costPerHour?: number;
  /** Description of the aircraft */
  description?: string;
  /** Terrain types this aircraft can operate over */
  allowedTerrain: ('easy' | 'moderate' | 'difficult' | 'extreme')[];
  /** Vegetation types this aircraft can effectively treat */
  allowedVegetation: ('grassland' | 'lightshrub' | 'mediumscrub' | 'heavyforest')[];
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
  allowedTerrain: ('easy' | 'moderate' | 'difficult' | 'extreme')[];
  /** Vegetation types this crew can handle */
  allowedVegetation: ('grassland' | 'lightshrub' | 'mediumscrub' | 'heavyforest')[];
}

export interface CalculationRules {
  /** Factor to apply to base clearing rates based on terrain difficulty */
  terrainFactors: {
    easy: number;
    moderate: number;
    difficult: number;
    extreme: number;
  };
  /** Factor to apply based on vegetation density */
  vegetationFactors: {
    grassland: number;
    lightshrub: number;
    mediumscrub: number;
    heavyforest: number;
  };
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
  density: 'grassland' | 'lightshrub' | 'mediumscrub' | 'heavyforest';
  /** Meters per hour achieved under these conditions */
  metersPerHour: number;
  /** Cost per hour under these conditions (optional) */
  costPerHour?: number;
}