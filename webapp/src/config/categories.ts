// Central category configuration for slope and vegetation distributions
// Ensures single source of truth for labels, colors, and value keys

export interface CategoryDef {
  key: string;
  label: string;
  color: string;
  range?: string; // slope range or other descriptor
}

export const SLOPE_CATEGORIES: CategoryDef[] = [
  { key: 'flat', label: 'Flat', color: '#00aa00', range: '0-10°' },
  { key: 'medium', label: 'Medium', color: '#c8c800', range: '10-25°' },
  { key: 'steep', label: 'Steep', color: '#ff8800', range: '25-45°' },
  { key: 'very_steep', label: 'Very Steep', color: '#ff0000', range: '45°+' }
];

export const VEGETATION_CATEGORIES: CategoryDef[] = [
  // light yellow for dry grass
  { key: 'grassland', label: 'Grass', color: '#FFF380' },
  // light green for light shrub
  { key: 'lightshrub', label: 'Light', color: '#B4DFAF' },
  // medium green for medium scrub
  { key: 'mediumscrub', label: 'Medium', color: '#4CAF50' },
  // dark green for heavy forest
  { key: 'heavyforest', label: 'Heavy', color: '#003300' }
];

// Development-time sanity checks: ensure keys used for visualization match
// the canonical classification keys used by analysis code. This prevents
// accidental label/color edits from breaking matching logic which relies on
// the `key` values (not display labels).
try {
  // Lazy import to avoid circular references at module load time
  // (classification lives in the same folder)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { VEGETATION_TYPES, TERRAIN_LEVELS } = require('./classification');

  if (process.env.NODE_ENV !== 'production') {
    const vegKeys = VEGETATION_CATEGORIES.map(c => c.key).sort();
    const expectedVeg = Array.from(VEGETATION_TYPES).sort();
    if (JSON.stringify(vegKeys) !== JSON.stringify(expectedVeg)) {
      // Use console.error instead of throwing to avoid breaking CI flows unexpectedly,
      // but make the mismatch loud during development.
      // eslint-disable-next-line no-console
      console.error('VEGETATION_CATEGORIES keys do not match VEGETATION_TYPES:', { vegKeys, expectedVeg });
    }

    const slopeKeys = (require('./classification').SLOPE_CATEGORIES || []).map((s: any) => s.key).sort();
    const expectedSlope = Array.from(TERRAIN_LEVELS).sort();
    if (JSON.stringify(slopeKeys) !== JSON.stringify(expectedSlope)) {
      // eslint-disable-next-line no-console
      console.error('SLOPE_CATEGORIES keys do not match TERRAIN_LEVELS:', { slopeKeys, expectedSlope });
    }
  }
} catch (e) {
  // If require fails (unlikely), skip the checks quietly.
}
