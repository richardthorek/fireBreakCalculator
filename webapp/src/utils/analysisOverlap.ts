import { SlopeSegment, VegetationSegment } from '../types/config';

/**
 * Compute overlap distances (meters) between slope segments and vegetation segments.
 * Both input arrays are expected to be ordered along-track and cover the same route.
 * Returns a mapping: { [slopeCategory]: { [vegetationType]: meters } }
 */
export function computeSlopeVegetationOverlap(
  slopeSegments: SlopeSegment[],
  vegSegments: VegetationSegment[]
): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  if (!slopeSegments || !vegSegments) return result;

  let i = 0; // slope index
  let j = 0; // veg index
  let remS = slopeSegments.length ? slopeSegments[0].distance : 0;
  let remV = vegSegments.length ? vegSegments[0].distance : 0;

  while (i < slopeSegments.length && j < vegSegments.length) {
    const s = slopeSegments[i];
    const v = vegSegments[j];
    const overlap = Math.min(remS, remV);

    if (!result[s.category]) result[s.category] = {};
    if (!result[s.category][v.vegetationType]) result[s.category][v.vegetationType] = 0;
    result[s.category][v.vegetationType] += overlap;

    remS -= overlap;
    remV -= overlap;

    if (remS <= 0) {
      i++;
      remS = i < slopeSegments.length ? slopeSegments[i].distance : 0;
    }
    if (remV <= 0) {
      j++;
      remV = j < vegSegments.length ? vegSegments[j].distance : 0;
    }
  }

  return result;
}
