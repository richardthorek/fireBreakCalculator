/**
 * Types for the fire-break "incident box" recommendation feature: draw the
 * current fire perimeter, fetch wind, generate an asymmetric standoff box
 * (head/flanks/rear), then hand the box edges to the existing corridor
 * pathfinder + `/api/analysis/calculate` cost engine.
 *
 * Must-match pair: this file's `WindObservation` is hand-mirrored (not
 * imported — api and webapp are separate deployables) in
 * `webapp/src/utils/windService.ts`. Check both sides when either changes.
 */

/** A live or manually-entered wind reading for a single point. */
export interface WindObservation {
  /** Compass bearing wind is blowing FROM, 0-360 (meteorological convention). */
  directionFromDeg: number;
  /** Sustained speed, km/h. */
  speedKmh: number;
  /** Wind gust speed, km/h, when the source provides one. */
  gustKmh?: number;
  /** Where this reading came from. 'open-meteo' is a live public forecast
   *  API — NOT an official BOM product; never labelled as BOM in the UI. */
  source: 'open-meteo' | 'manual';
  /** ISO timestamp of the observation/forecast instant used. */
  observedAt: string;
  /** True when this is a live fetch; false for user-typed manual entry. */
  usedFallbackWind: boolean;
}

export interface WindResponse extends WindObservation {
  lat: number;
  lng: number;
}
