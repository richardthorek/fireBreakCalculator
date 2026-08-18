/**
 * Live wind fetch for the incident-box feature.
 *
 * Source: Open-Meteo's free, no-key forecast API (`current.wind_speed_10m` +
 * `wind_direction_10m`). This is deliberately NOT presented as a BOM/AFDRS
 * product — official Australian fire-danger data is a separate, currently
 * blocked item (BOM Registered User access, see master_plan.md "Blocked").
 * Open-Meteo is a live, real forecast source; it is flagged as such
 * end-to-end (`WindObservation.source`), never mislabelled.
 *
 * Cache: single-tier, in-process, short TTL — wind changes fast enough that
 * staleness matters more than for the infrastructure (OSM) cache, so no L2
 * blob tier. Never throws: callers get `null` on any upstream failure and
 * fall back to manual entry, same idiom as `infrastructureService.ts`.
 */

import { WindObservation } from '../types/incidentBox';

const CACHE_TTL_MS = 8 * 60_000; // 8 min — short enough to stay live-feeling
const CACHE_MAX = 500;

interface CacheEntry {
  value: WindObservation;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(lat: number, lng: number): string {
  // Round to ~1km so nearby requests share a cache entry.
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

function getCached(key: string): WindObservation | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key: string, value: WindObservation): void {
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

export async function fetchWindObservation(lat: number, lng: number): Promise<WindObservation | null> {
  const key = cacheKey(lat, lng);
  const cached = getCached(key);
  if (cached) return cached;

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kmh&timezone=auto`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const body: any = await res.json();
    const current = body?.current;
    const speedKmh = Number(current?.wind_speed_10m);
    const directionFromDeg = Number(current?.wind_direction_10m);
    if (!Number.isFinite(speedKmh) || !Number.isFinite(directionFromDeg)) return null;

    const observation: WindObservation = {
      directionFromDeg,
      speedKmh,
      gustKmh: Number.isFinite(Number(current?.wind_gusts_10m)) ? Number(current.wind_gusts_10m) : undefined,
      source: 'open-meteo',
      observedAt: typeof current?.time === 'string' ? current.time : new Date().toISOString(),
      usedFallbackWind: false,
    };
    setCached(key, observation);
    return observation;
  } catch {
    return null;
  }
}
