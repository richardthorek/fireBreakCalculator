/**
 * Australian state/territory detection from lat/lng coordinates.
 * Used to route vegetation queries to the appropriate state-specific service.
 */

export type AustralianState = 'NSW' | 'VIC' | 'QLD' | 'WA' | 'SA' | 'TAS' | 'ACT' | 'NT';

interface StateBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

// Bounding boxes (lon/lat order) for each state/territory.
// Generous padding to account for coastal areas and islands.
const STATE_BOUNDS: Record<AustralianState, StateBounds> = {
  NSW: { minLat: -37.5, maxLat: -27.0, minLng: 140.0, maxLng: 154.5 },
  VIC: { minLat: -39.5, maxLat: -34.0, minLng: 140.5, maxLng: 150.0 },
  QLD: { minLat: -28.5, maxLat: -9.0, minLng: 138.0, maxLng: 154.0 },
  WA: { minLat: -35.5, maxLat: -13.0, minLng: 112.0, maxLng: 129.0 },
  SA: { minLat: -37.5, maxLat: -25.5, minLng: 129.0, maxLng: 141.0 },
  TAS: { minLat: -44.5, maxLat: -40.5, minLng: 144.0, maxLng: 148.5 },
  ACT: { minLat: -35.8, maxLat: -35.1, minLng: 148.7, maxLng: 149.4 },
  NT: { minLat: -26.0, maxLat: -11.0, minLng: 129.0, maxLng: 138.0 },
};

/**
 * Determine which Australian state/territory a coordinate is in.
 * Returns the state code, or 'NSW' as default fallback if outside known bounds.
 */
export function determineState(lat: number, lng: number): AustralianState {
  for (const [state, bounds] of Object.entries(STATE_BOUNDS)) {
    if (lat >= bounds.minLat && lat <= bounds.maxLat && lng >= bounds.minLng && lng <= bounds.maxLng) {
      return state as AustralianState;
    }
  }
  // Outside Australia — default to fallback chain behavior
  return 'NSW';
}

/**
 * Check if a point is plausibly within Australia.
 */
export function isInAustralia(lat: number, lng: number): boolean {
  // Rough Australia bounding box
  return lat >= -44.5 && lat <= -9.0 && lng >= 112.0 && lng <= 154.5;
}

/**
 * Get the bounding box for a state/territory.
 * Useful for spatial queries or visualization.
 */
export function getStateBounds(state: AustralianState): StateBounds {
  return STATE_BOUNDS[state];
}
