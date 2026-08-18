/**
 * Wind fetch for the incident-box feature, with a manual-entry fallback so
 * fire-break mode's zero-reception guarantee still holds — if the live fetch
 * fails or the device is offline, the user types in observed wind and the box
 * still generates, flagged `usedFallbackWind: true` end to end.
 *
 * Must-match pair: `WindObservation` here mirrors `api/src/types/incidentBox.ts`.
 * Check both sides when either changes.
 */

const baseUrl = (import.meta as any).env?.VITE_API_BASE_URL || '/api';

export interface WindObservation {
  /** Compass bearing wind is blowing FROM, 0-360 (meteorological convention). */
  directionFromDeg: number;
  /** Sustained speed, km/h. */
  speedKmh: number;
  gustKmh?: number;
  /** 'open-meteo' is a live public forecast API, not an official BOM product. */
  source: 'open-meteo' | 'manual';
  observedAt: string;
  usedFallbackWind: boolean;
}

/**
 * Fetch live wind for a point. Returns null on any failure — callers should
 * fall back to `manualWindObservation`, never a silent guess.
 */
export async function fetchWindObservation(lat: number, lng: number): Promise<WindObservation | null> {
  try {
    const res = await fetch(`${baseUrl}/wind?lat=${lat}&lng=${lng}`);
    if (!res.ok) return null;
    const body = await res.json();
    if (!Number.isFinite(body?.directionFromDeg) || !Number.isFinite(body?.speedKmh)) return null;
    return {
      directionFromDeg: body.directionFromDeg,
      speedKmh: body.speedKmh,
      gustKmh: Number.isFinite(body?.gustKmh) ? body.gustKmh : undefined,
      source: 'open-meteo',
      observedAt: body.observedAt,
      usedFallbackWind: false,
    };
  } catch {
    return null;
  }
}

/** Build a manual-entry observation from user-typed values. */
export function manualWindObservation(directionFromDeg: number, speedKmh: number): WindObservation {
  return {
    directionFromDeg,
    speedKmh,
    source: 'manual',
    observedAt: new Date().toISOString(),
    usedFallbackWind: true,
  };
}
