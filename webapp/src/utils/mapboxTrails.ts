/**
 * Trails from the Mapbox vector tiles already on the map — the zero-network,
 * offline-capable primary source for the optimizer's corridor infrastructure.
 *
 * WHY: the map renders a Mapbox style, and Mapbox Streets is built from the
 * SAME OpenStreetMap data Overpass serves. By adding the `mapbox-streets-v8`
 * vector source and reading its `road` layer with `querySourceFeatures`, we get
 * the corridor's trails/roads:
 *   - with **no extra network call** — the tiles load as part of the map;
 *   - with **no CORS problem** — Mapbox serves its own tiles with the token
 *     (unlike the public Overpass instances, which drop CORS headers on their
 *     error responses and thereby killed the direct browser lookup);
 *   - **offline** — once the area's tiles are cached (the field-first case:
 *     the crew panned over the ground before losing reception), trail-aware
 *     optimization keeps working with no connectivity at all.
 *
 * The base map is a satellite style that doesn't itself draw roads, so we add
 * the vector source ourselves plus an INVISIBLE query layer: tiles only load
 * for sources a layer references, and `visibility:none` stops them loading (and
 * makes `querySourceFeatures` return nothing), so the layer stays "visible"
 * with `line-opacity: 0` — loaded and queryable, never seen.
 *
 * Coverage is limited to tiles currently loaded (viewport + buffer, at zooms
 * where the road class is present), so a returned EMPTY set can't distinguish
 * "no roads here" from "tiles not loaded" — the caller treats null/empty as
 * "can't answer" and falls back to the backend Overpass proxy. Same OSM
 * lineage means reused ways still carry the "verify trafficability" caveat.
 */

import type { InfrastructureTrail, InfrastructureKind } from './infrastructureService';
import { logger } from './logger';

const STREETS_SOURCE_ID = 'fbc-streets-v8';
const STREETS_QUERY_LAYER_ID = 'fbc-streets-road-query';
const ROAD_SOURCE_LAYER = 'road';

/** Mapbox Streets v8 road `class` values that represent reusable broken ground,
 *  chosen to mirror the Overpass REUSABLE_HIGHWAYS set (track/path/service/
 *  minor+medium roads). Motorway/trunk are deliberately excluded — a fire break
 *  doesn't run down a freeway. */
const REUSABLE_CLASSES = [
  'track', 'path', 'service', 'street', 'street_limited',
  'tertiary', 'secondary', 'primary', 'road',
];

/**
 * Terrain Mobility's wider class set (docs §35's MOBILITY_HIGHWAYS, Mapbox
 * Streets v8 naming) — added 2026-07-28 after a live-tested failure: Overpass
 * being unreachable for an area left `onTrail` false for every cell, so the
 * hard slope/hydrology gates (which the mapped-road exemption would otherwise
 * bypass) applied along an engineered lake-edge highway shelf and painted it
 * NO-GO end to end, even though the road is plainly visible on the very same
 * map tiles this module already has loaded for zero extra cost. Unlike
 * `REUSABLE_CLASSES` above, motorway/trunk ARE included — mobility mode wants
 * the fastest routes an approaching force would actually use, not just
 * "reusable broken ground" for a fire break. */
const MOBILITY_CLASSES = [
  'motorway', 'motorway_link', 'trunk', 'trunk_link',
  'primary', 'primary_link', 'secondary', 'secondary_link',
  'tertiary', 'tertiary_link', 'street', 'street_limited',
  'track', 'service', 'path', 'road',
];

/** Mapbox Streets v8 buckets several distinct OSM `highway` values into one
 *  class (`street` covers residential/unclassified/living_street alike) —
 *  the tileset simply doesn't carry the original tag. Translated to a single
 *  representative OSM value here so `roadSpeedModel.ts`'s speed-by-highway
 *  table gets a real entry instead of falling through to its generic
 *  untagged-track estimate, which is a worse (and mislabelled) guess than
 *  "residential" for what is visibly a suburban/rural sealed street. Classes
 *  that already match an OSM `highway` value 1:1 (motorway, track, ...) pass
 *  through unchanged. Fidelity cost, stated rather than hidden: this cannot
 *  recover `surface`/`tracktype`/`smoothness` — Mapbox's schema doesn't carry
 *  them at all — so a way sourced this way only ever gets the highway-class
 *  speed, never a surface/tracktype/smoothness refinement. */
const MAPBOX_CLASS_TO_OSM_HIGHWAY: Record<string, string> = {
  street: 'residential',
  street_limited: 'living_street',
};

/** A single query layer, filtered to the UNION of both class sets — cheaper
 *  than two separate Mapbox GL layers, since which subset actually matters is
 *  a per-call, per-`kind` decision made in `extractCorridorTrails` below, not
 *  a per-layer one. */
const ALL_QUERYABLE_CLASSES = Array.from(new Set([...REUSABLE_CLASSES, ...MOBILITY_CLASSES]));
const classFilter = ['match', ['get', 'class'], ALL_QUERYABLE_CLASSES, true, false] as any;

/**
 * Add the Mapbox Streets vector source + an invisible query layer so the road
 * tiles load and stay queryable. Idempotent; safe to call on every style load.
 */
export function ensureStreetsSource(map: any): void {
  try {
    if (!map.getSource(STREETS_SOURCE_ID)) {
      map.addSource(STREETS_SOURCE_ID, {
        type: 'vector',
        url: 'mapbox://mapbox.mapbox-streets-v8',
      });
    }
    if (!map.getLayer(STREETS_QUERY_LAYER_ID)) {
      // Insert at the very bottom so this never sits over markers/overlays —
      // opacity 0 makes that moot, but bottom-most is the safe default.
      const firstLayerId = (map.getStyle()?.layers?.[0] || {}).id;
      map.addLayer(
        {
          id: STREETS_QUERY_LAYER_ID,
          type: 'line',
          source: STREETS_SOURCE_ID,
          'source-layer': ROAD_SOURCE_LAYER,
          filter: classFilter,
          paint: { 'line-opacity': 0 },
        },
        firstLayerId
      );
    }
  } catch (e) {
    // A style/source race just means the provider returns null until the layer
    // exists; the caller falls back to the network. Never fatal.
    logger.warn('Could not add Mapbox streets query source', e);
  }
}

/**
 * Extract reusable trails/roads within a bbox from the currently-loaded Mapbox
 * road tiles. Returns null when the layer isn't present or no roads are loaded
 * for the corridor (so the caller falls back to the network), never throws.
 *
 * `kind` selects which class set this call actually wants — `'highway'`
 * (fire-break reuse) keeps the narrower `REUSABLE_CLASSES` filter it always
 * had; `'highway-mobility'` widens to `MOBILITY_CLASSES` (motorway/trunk/
 * primary included). The underlying Mapbox GL layer is queried once against
 * the union of both (see `ALL_QUERYABLE_CLASSES`) and filtered here per call,
 * rather than maintaining two separate map layers for a filter that only
 * needs to change per caller, not per tile load.
 */
export function extractCorridorTrails(
  map: any,
  south: number,
  west: number,
  north: number,
  east: number,
  kind: InfrastructureKind = 'highway'
): InfrastructureTrail[] | null {
  try {
    if (!map || !map.getLayer || !map.getLayer(STREETS_QUERY_LAYER_ID)) return null;
    const wantedClasses = kind === 'highway-mobility' ? MOBILITY_CLASSES : REUSABLE_CLASSES;
    const feats = map.querySourceFeatures(STREETS_SOURCE_ID, {
      sourceLayer: ROAD_SOURCE_LAYER,
      filter: classFilter,
    });
    if (!feats || feats.length === 0) return null;

    const trails: InfrastructureTrail[] = [];
    // querySourceFeatures returns the same way duplicated across adjacent tiles
    // and clipped at tile edges; dedupe the obvious repeats by a cheap key.
    const seen = new Set<string>();
    for (const f of feats) {
      const mapboxClass = (f.properties?.class as string) || 'road';
      if (!wantedClasses.includes(mapboxClass)) continue;
      const g = f.geometry;
      if (!g) continue;
      const lines: number[][][] =
        g.type === 'LineString' ? [g.coordinates] :
        g.type === 'MultiLineString' ? g.coordinates : [];
      for (const line of lines) {
        if (!Array.isArray(line) || line.length < 2) continue;
        // Bounding-box reject: querySourceFeatures returns everything in loaded
        // tiles, well beyond the corridor — keep only ways whose bbox overlaps.
        let lo = Infinity, la = Infinity, ho = -Infinity, ha = -Infinity;
        for (const c of line) {
          if (c[0] < lo) lo = c[0]; if (c[0] > ho) ho = c[0];
          if (c[1] < la) la = c[1]; if (c[1] > ha) ha = c[1];
        }
        if (ho < west || lo > east || ha < south || la > north) continue;
        const key = `${f.id ?? ''}:${line.length}:${line[0][0].toFixed(5)},${line[0][1].toFixed(5)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        trails.push({
          // See `MAPBOX_CLASS_TO_OSM_HIGHWAY`'s doc comment — translated where
          // Mapbox buckets several OSM highway values into one class.
          kind: MAPBOX_CLASS_TO_OSM_HIGHWAY[mapboxClass] ?? mapboxClass,
          name: f.properties?.name,
          coords: line.map((c: number[]) => ({ lat: c[1], lng: c[0] })),
          // surface/tracktype/smoothness left undefined — Mapbox's schema
          // doesn't carry them (see MAPBOX_CLASS_TO_OSM_HIGHWAY's doc
          // comment). roadSpeedModel.ts already treats an absent tag as "no
          // cap from this dimension", so this degrades gracefully to a
          // highway-class-only speed rather than a full OSM-tag refinement.
        });
      }
    }
    return trails.length > 0 ? trails : null;
  } catch (e) {
    logger.warn('Mapbox trail extraction failed, falling back to network', e);
    return null;
  }
}
