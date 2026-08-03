/**
 * Server-side grid sampling for a tier-2 mobility job (OCOKA 5,
 * docs/ROUTE_INTELLIGENCE.md §47.3) — the backend equivalent of the client
 * Worker's `webapp/src/terrain/mobilityGrid.ts`, reusing the SAME hex/grid
 * primitives from `@firebreak/terrain` (the whole point of OCOKA 2's
 * extraction) but sourcing data from THIS package's own elevation/
 * infrastructure services rather than the browser's fetch layer.
 *
 * Deliberate v1 scope cuts vs the client Worker's tier-1 sampler (each
 * flagged, not silent — the project's own data-honesty rule applies to
 * scope gaps as much as to individual field values):
 *
 *  - **Vegetation is a flagged placeholder, not classified.** The client's
 *    NVIS path decodes an exported PNG against a legend (needs an image
 *    library this package doesn't have); the NSW SVTM path needs the same
 *    ArcGIS polygon plumbing `vegetationTileService.ts` in `/api` already
 *    has for TILES but not classification. Porting either is real,
 *    follow-up work (docs §47.3's own "code sharing" note already flagged
 *    the underlying browser/server split — this is a further instance of
 *    it, not a new one). Every cell ships `vegetation: 'grassland'`,
 *    `vegEstimated: true` until that lands, which correctly makes
 *    `usedEstimatedData` true for every tier-2 run today.
 *  - **DEA surface-water frequency is not sampled** (`waterFrequency` is
 *    always `null`) — OSM waterway/water-body geometry (real, not
 *    estimated) still drives the hydrology gate.
 *  - **Centre-point snap only** for trail/water proximity, not centre + six
 *    hex corners (`mobilityGrid.ts`'s own refinement for a linear feature
 *    clipping a corner) — a further, smaller-radius simplification.
 *  - **No painted-area membership test.** `originKeys`/`objectiveKeys` are
 *    always the nearest-cell-to-bounds-centroid fallback `buildMobilityGrid`
 *    itself already falls back to when a painted area resolves to zero
 *    member cells — see `MobilityJobRequest`'s own doc comment.
 */

// Relative import, NOT the `@firebreak/terrain` bare specifier webapp uses —
// webapp resolves that via a Vite/tsconfig path alias that bundles the
// source directly, so it never needs Node module resolution at runtime.
// This package compiles with plain `tsc` to real CommonJS `require()` calls
// (see tsconfig.json's `rootDir`/`include` spanning both this package and
// shared/terrain, and README.md), so the import specifier must be one Node
// can actually resolve post-compile — a relative path, preserved unchanged
// through the compiler's mirrored output layout.
import {
  LatLng, makeProjection, toLocal, toLatLng, hexKey, chooseHexSize, generateBoxHexes,
  LocalProjection, MobilityGridCell, nearestCellKey, computeDemDerivatives, RoadWayTags,
} from '../../../shared/terrain/src/index';
import { MobilityJobBounds, MobilityJobFidelity } from '../types/mobilityJob';
import { getElevationProfile } from './elevationService';
import { fetchCorridorInfrastructure, InfrastructureTrail } from './infrastructureService';

interface FidelityTier {
  targetCellCount: number;
  maxHexCells: number;
}

// Deliberately simpler than mobilityGrid.ts's own distance-scaled budget
// (docs §35) — a fixed per-tier cap is a reasonable v1 for a job protocol
// whose own bounds are already a fixed AOI, not a "let it run for minutes
// over half the country" client-side budget.
const FIDELITY_TIERS: Record<MobilityJobFidelity, FidelityTier> = {
  quick: { targetCellCount: 900, maxHexCells: 1200 },
  standard: { targetCellCount: 2200, maxHexCells: 2800 },
  fine: { targetCellCount: 4500, maxHexCells: 6000 },
};

const TRAIL_SNAP_M = 30;
const WATER_SNAP_M = 30;
/** Padding either side of the origin/objective union box, as a fraction of
 *  its own span — same purpose as mobilityGrid.ts's boundsPadFactor (room
 *  to route around obstacles), a fixed value here rather than a tunable
 *  option since this job protocol has no interactive retry loop yet. */
const BOUNDS_PAD_FACTOR = 0.25;

function unionBounds(a: MobilityJobBounds, b: MobilityJobBounds): MobilityJobBounds {
  return {
    minLat: Math.min(a.minLat, b.minLat),
    minLng: Math.min(a.minLng, b.minLng),
    maxLat: Math.max(a.maxLat, b.maxLat),
    maxLng: Math.max(a.maxLng, b.maxLng),
  };
}

function padBounds(b: MobilityJobBounds, factor: number): MobilityJobBounds {
  const latPad = (b.maxLat - b.minLat) * factor;
  const lngPad = (b.maxLng - b.minLng) * factor;
  return { minLat: b.minLat - latPad, minLng: b.minLng - lngPad, maxLat: b.maxLat + latPad, maxLng: b.maxLng + lngPad };
}

function boundsCentre(b: MobilityJobBounds): LatLng {
  return { lat: (b.minLat + b.maxLat) / 2, lng: (b.minLng + b.maxLng) / 2 };
}

/** Pure geometry, copied from `webapp/src/utils/infrastructureService.ts`
 *  (same temporary-duplicate reasoning as elevationService.ts/
 *  infrastructureService.ts in this directory — see README.md). Point-to-
 *  polyline distance in metres, local equirectangular approximation (fine
 *  at hex-grid scale). */
function distanceToNearestTrail(point: LatLng, trails: InfrastructureTrail[], earlyExitThreshold = 0): number {
  let best = Infinity;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((point.lat * Math.PI) / 180);
  for (const trail of trails) {
    const c = trail.coords;
    for (let i = 1; i < c.length; i++) {
      const ax = (c[i - 1].lng - point.lng) * mPerDegLng;
      const ay = (c[i - 1].lat - point.lat) * mPerDegLat;
      const bx = (c[i].lng - point.lng) * mPerDegLng;
      const by = (c[i].lat - point.lat) * mPerDegLat;
      const dx = bx - ax;
      const dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      let t = lenSq > 0 ? -(ax * dx + ay * dy) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d < best) {
        best = d;
        if (best <= earlyExitThreshold) return best;
      }
    }
  }
  return best;
}

/** Test seam — exercises the pure geometry helper without a network call. @internal */
export const _distanceToNearestTrailForTest = distanceToNearestTrail;

export interface SampledServerGrid {
  cells: MobilityGridCell[];
  hexSize: number;
  proj: LocalProjection;
  originKeys: string[];
  objectiveKeys: string[];
  usedEstimatedData: boolean;
  infrastructureAvailable: boolean;
}

/** Builds the server-side grid for a job request. Never throws for upstream
 *  data failures (elevation/roads/water each degrade to an estimated/absent
 *  state, matching the client Worker's own honesty rules) — only throws if
 *  the resulting box is degenerate (origin/objective bounds coincide). */
export async function buildServerMobilityGrid(
  originBounds: MobilityJobBounds,
  objectiveBounds: MobilityJobBounds,
  fidelity: MobilityJobFidelity
): Promise<SampledServerGrid> {
  const padded = padBounds(unionBounds(originBounds, objectiveBounds), BOUNDS_PAD_FACTOR);
  const sw: LatLng = { lat: padded.minLat, lng: padded.minLng };
  const ne: LatLng = { lat: padded.maxLat, lng: padded.maxLng };

  const { targetCellCount, maxHexCells } = FIDELITY_TIERS[fidelity];

  const centre: LatLng = { lat: (sw.lat + ne.lat) / 2, lng: (sw.lng + ne.lng) / 2 };
  const proj = makeProjection(centre);
  const minLocal = toLocal(proj, sw);
  const maxLocal = toLocal(proj, ne);
  const min = { x: Math.min(minLocal.x, maxLocal.x), y: Math.min(minLocal.y, maxLocal.y) };
  const max = { x: Math.max(minLocal.x, maxLocal.x), y: Math.max(minLocal.y, maxLocal.y) };
  const width = max.x - min.x;
  const height = max.y - min.y;
  if (width < 10 || height < 10) {
    throw new Error('origin/objective bounds are degenerate (too close together to sample a grid)');
  }

  let size = chooseHexSize(Math.max(width, height), Math.min(width, height) / 2, targetCellCount);
  let hexesRaw = generateBoxHexes(min, max, size);
  for (let tries = 0; hexesRaw.length > maxHexCells && tries < 5; tries++) {
    size *= 1.25;
    hexesRaw = generateBoxHexes(min, max, size);
  }
  if (hexesRaw.length < 1) throw new Error('grid sampling produced zero cells');

  const points = hexesRaw.map((c) => toLatLng(proj, c.center));

  const [elevRes, roads, water] = await Promise.all([
    getElevationProfile(points),
    fetchCorridorInfrastructure(padded.minLat, padded.minLng, padded.maxLat, padded.maxLng, 'highway-mobility'),
    fetchCorridorInfrastructure(padded.minLat, padded.minLng, padded.maxLat, padded.maxLng, 'water'),
  ]);

  const cells: MobilityGridCell[] = hexesRaw.map((c, i) => {
    const center = points[i];

    let waterDistanceM = Infinity;
    let inWaterBody = false;
    let nearestWaterwayKind: string | null = null;
    if (water.trails.length > 0) {
      waterDistanceM = distanceToNearestTrail(center, water.trails, 0);
      const waterBodies = water.trails.filter((f) => f.kind === 'water');
      if (waterBodies.length > 0 && waterDistanceM <= 0) inWaterBody = true;
      if (waterDistanceM <= WATER_SNAP_M) {
        let bestD = Infinity;
        for (const feature of water.trails) {
          if (feature.kind === 'water') continue;
          const d = distanceToNearestTrail(center, [feature], WATER_SNAP_M);
          if (d < bestD) { bestD = d; nearestWaterwayKind = feature.kind; }
        }
        if (bestD > WATER_SNAP_M) nearestWaterwayKind = null;
      }
    }

    let onTrail = false;
    let nearestTrailTags: RoadWayTags | null = null;
    if (roads.trails.length > 0) {
      const d = distanceToNearestTrail(center, roads.trails, TRAIL_SNAP_M);
      onTrail = d <= TRAIL_SNAP_M;
      if (onTrail) {
        let bestD = Infinity;
        for (const feature of roads.trails) {
          const fd = distanceToNearestTrail(center, [feature], TRAIL_SNAP_M);
          if (fd < bestD) {
            bestD = fd;
            nearestTrailTags = { highway: feature.kind, surface: feature.surface, tracktype: feature.tracktype, smoothness: feature.smoothness };
          }
        }
      }
    }

    return {
      key: hexKey(c.hex),
      hex: c.hex,
      center,
      elevation: elevRes.elevations[i],
      vegetation: 'grassland',
      vegEstimated: true,
      onTrail,
      nearestTrailTags,
      crossSlopeDeg: 0, // filled in below
      waterDistanceM,
      inWaterBody,
      nearestWaterwayKind,
      waterFrequency: null,
    };
  });

  const derivatives = computeDemDerivatives(cells);
  for (const cell of cells) {
    cell.crossSlopeDeg = derivatives.get(cell.key)?.crossSlopeDeg ?? 0;
  }

  const originCentre = boundsCentre(originBounds);
  const objectiveCentre = boundsCentre(objectiveBounds);

  return {
    cells,
    hexSize: size,
    proj,
    originKeys: [nearestCellKey(cells, originCentre)],
    objectiveKeys: [nearestCellKey(cells, objectiveCentre)],
    usedEstimatedData: true, // vegetation placeholder always estimated (see module header)
    infrastructureAvailable: roads.available && water.available,
  };
}
