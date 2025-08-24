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
  /** Operating cost per hour (optional) */
  costPerHour?: number;
  /** Description of the machinery */
  description?: string;
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
    light: number;
    moderate: number;
    heavy: number;
    extreme: number;
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