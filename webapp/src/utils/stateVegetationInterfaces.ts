/**
 * Unified interface for state-based vegetation services.
 * Each state service (NSW, VIC, QLD, etc.) implements this interface
 * to provide consistent vegetation data to the analysis layer.
 */

import { VegetationType } from '../config/classification';

/**
 * Result from a state vegetation service query.
 * Standardized format used by all state services.
 */
export interface StateVegetationResult {
  /** Mapped fuel type (4-class taxonomy) */
  vegetationType: VegetationType;

  /** Confidence score (0-1), higher = more reliable */
  confidence: number;

  /** Display label (formation name, PCT name, etc.) for UI/debug */
  displayLabel: string;

  /** Source layer/code (e.g., "NSW SVTM PCT", "VIC VVQA", for tracking) */
  source: string;

  /** State code (e.g., 'NSW', 'VIC') */
  state: string;

  /** True for NVIS classes 24/25/26/27/28/99 (aquatic, cleared, unclassified, bare, sea, unknown) —
   *  indicates modified or low-fidelity land; confidence is lower and local verification is advised. */
  isModifiedOrLowFidelity?: boolean;

  /** Optional: raw attributes from state service for debugging/rollup */
  rawAttributes?: Record<string, unknown>;
}

/**
 * Interface that all state vegetation services should implement.
 * Allows standardized error handling and fallback chain.
 */
export interface StateVegetationService {
  /**
   * Fetch vegetation data for a point.
   * Returns StateVegetationResult on success, null if outside coverage or query fails.
   */
  fetch(lat: number, lng: number): Promise<StateVegetationResult | null>;

  /**
   * Optional: Check service health/availability.
   * Useful for monitoring or early fallback detection.
   */
  isAvailable?(): Promise<boolean>;

  /**
   * Service name (for logging, monitoring, telemetry).
   */
  readonly name: string;
}
