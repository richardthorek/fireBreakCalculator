/**
 * Vegetation override system for user-provided local knowledge.
 *
 * Allows users to override auto-detected vegetation with their own assessment
 * of a specific area. Overrides can be applied at:
 * - Route level: uniform vegetation type for entire route
 * - Segment level: different vegetation type for specific segments
 *
 * Segment-level overrides take precedence over route-level overrides.
 */

import { VegetationType } from '../config/classification';

/**
 * Vegetation override for a specific segment of the route.
 * Segments are identified by their distance along the route (in meters).
 */
export interface SegmentVegetationOverride {
  /** Start distance along route (meters from origin) */
  startDistance: number;
  /** End distance along route (meters from origin) */
  endDistance: number;
  /** Override vegetation type */
  vegetation: VegetationType;
  /** Optional reason/note from user (e.g., "Local knowledge: recent fire regrowth") */
  note?: string;
  /** When this override was created (ISO 8601 timestamp) */
  createdAt?: string;
}

/**
 * Complete vegetation override configuration for a route.
 * Can include both route-level and segment-level overrides.
 */
export interface VegetationOverridesConfig {
  /** Route-level override: if set, applies to entire route */
  routeOverride?: VegetationType;
  /** Optional reason for route-level override */
  routeOverrideNote?: string;
  /** Segment-level overrides: take precedence over route-level */
  segmentOverrides?: SegmentVegetationOverride[];
  /** Whether overrides are currently enabled/active */
  isEnabled?: boolean;
}

/**
 * Determine the effective vegetation type for a position along the route,
 * considering overrides.
 *
 * @param distance Distance along route (meters)
 * @param defaultVegetation Detected/default vegetation type from analysis
 * @param overrides Override configuration
 * @returns Effective vegetation type (override if applicable, otherwise default)
 */
export function getEffectiveVegetation(
  distance: number,
  defaultVegetation: VegetationType,
  overrides?: VegetationOverridesConfig
): VegetationType {
  if (!overrides || !overrides.isEnabled) {
    return defaultVegetation;
  }

  // Check segment overrides first (highest priority)
  if (overrides.segmentOverrides) {
    for (const seg of overrides.segmentOverrides) {
      if (distance >= seg.startDistance && distance <= seg.endDistance) {
        return seg.vegetation;
      }
    }
  }

  // Fall back to route override
  if (overrides.routeOverride) {
    return overrides.routeOverride;
  }

  return defaultVegetation;
}

/**
 * Check if a distance range overlaps with any existing segment overrides.
 * Useful for validating new overrides before adding them.
 *
 * @param startDistance Start of range to check
 * @param endDistance End of range to check
 * @param existingOverrides Array of existing overrides
 * @returns Array of overlapping overrides
 */
export function findOverlappingSegments(
  startDistance: number,
  endDistance: number,
  existingOverrides?: SegmentVegetationOverride[]
): SegmentVegetationOverride[] {
  if (!existingOverrides) return [];
  return existingOverrides.filter(
    (seg) => !(endDistance < seg.startDistance || startDistance > seg.endDistance)
  );
}

/**
 * Merge or replace overlapping segment overrides.
 * When adding a new override that overlaps existing ones, this function
 * handles the conflict by either replacing or merging them.
 *
 * @param newOverride New segment override to add
 * @param existingOverrides Array of existing overrides
 * @param mode 'replace' = remove overlaps, 'merge' = extend boundaries
 * @returns Updated array of overrides
 */
export function mergeSegmentOverrides(
  newOverride: SegmentVegetationOverride,
  existingOverrides: SegmentVegetationOverride[] = [],
  mode: 'replace' | 'merge' = 'replace'
): SegmentVegetationOverride[] {
  const overlapping = findOverlappingSegments(
    newOverride.startDistance,
    newOverride.endDistance,
    existingOverrides
  );

  if (mode === 'replace') {
    // Remove all overlapping segments and add the new one
    return [
      ...existingOverrides.filter((seg) => !overlapping.includes(seg)),
      newOverride,
    ];
  } else {
    // Merge mode: extend boundaries to cover all overlapping segments
    if (overlapping.length === 0) {
      return [...existingOverrides, newOverride];
    }

    const mergedStart = Math.min(newOverride.startDistance, ...overlapping.map((s) => s.startDistance));
    const mergedEnd = Math.max(newOverride.endDistance, ...overlapping.map((s) => s.endDistance));

    return [
      ...existingOverrides.filter((seg) => !overlapping.includes(seg)),
      {
        ...newOverride,
        startDistance: mergedStart,
        endDistance: mergedEnd,
      },
    ];
  }
}

/**
 * Remove a segment override by its position.
 * @param index Index of override to remove
 * @param overrides Current array of overrides
 * @returns Updated array without the removed override
 */
export function removeSegmentOverride(
  index: number,
  overrides: SegmentVegetationOverride[] = []
): SegmentVegetationOverride[] {
  return overrides.filter((_, i) => i !== index);
}

/**
 * Calculate the total distance covered by segment overrides.
 * Useful for progress indicators or validation.
 *
 * @param overrides Array of segment overrides
 * @returns Total distance (meters) covered by overrides
 */
export function getTotalOverriddenDistance(overrides?: SegmentVegetationOverride[]): number {
  if (!overrides || overrides.length === 0) return 0;
  return overrides.reduce((sum, seg) => sum + (seg.endDistance - seg.startDistance), 0);
}
