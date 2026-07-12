/**
 * Live context feeds — national situational awareness layers.
 *
 * Sources (all public, attribution required, verified 2026-07-12; see
 * docs/GIS_INTEROP.md §4 for confirmed endpoint structures):
 *  - DEA Sentinel Hotspots (Geoscience Australia WFS) — national, CC BY 4.0.
 *  - Digital Atlas of Australia NRT Bushfire Boundaries (ArcGIS) — national
 *    (excludes NT), CC BY 4.0.
 *  - Jurisdictional incident/warning feeds (NSW, VIC, SA, WA, ACT) normalised
 *    to Australian Warning System levels. QLD (no CORS), TAS (blocked) and
 *    NT (licence prohibits reuse) are NOT included — the UI must say so
 *    rather than implying national incident coverage.
 *
 * Data honesty: every fetch result carries a `fetchedAt` timestamp and each
 * source reports ok/error individually. A failed source is surfaced, never
 * silently dropped. These are advisory situational layers, not
 * safety-of-life products.
 */

import { parseXml, findAll, childFirst } from './xmlScan';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Endpoints (env-overridable, mirroring the NVIS pattern)

const env = (import.meta as any).env ?? {};

export const HOTSPOTS_WFS_URL: string =
  env.VITE_FEED_HOTSPOTS_URL ||
  'https://hotspots.dea.ga.gov.au/geoserver/wfs';

export const BOUNDARIES_URL: string =
  env.VITE_FEED_BOUNDARIES_URL ||
  'https://services-ap1.arcgis.com/ypkPEy1AmwPKGNNv/arcgis/rest/services/Near_Real_Time_Bushfire_Boundaries_view/FeatureServer/3/query';

/** Jurisdictional incident feeds that are directly browser-consumable (CORS-clean). */
const INCIDENT_FEEDS = {
  nsw: env.VITE_FEED_NSW_URL || 'https://www.rfs.nsw.gov.au/feeds/majorIncidents.json',
  vic: env.VITE_FEED_VIC_URL || 'https://emergency.vic.gov.au/public/osom-geojson.json',
  sa: env.VITE_FEED_SA_URL || 'https://data.eso.sa.gov.au/prod/cfs/criimson/cfs_current_incidents.json',
  waIncidents: env.VITE_FEED_WA_INCIDENTS_URL || 'https://api.emergency.wa.gov.au/v1/incidents',
  waWarnings: env.VITE_FEED_WA_WARNINGS_URL || 'https://api.emergency.wa.gov.au/v1/warnings',
  act: env.VITE_FEED_ACT_URL || 'https://esa.act.gov.au/feeds/currentincidents.xml'
} as const;

// ---------------------------------------------------------------------------
// Types

/** Australian Warning System level, plus 'incident' for events with no warning attached. */
export type AwsWarningLevel = 'emergency-warning' | 'watch-and-act' | 'advice' | 'incident';

export interface LiveIncident {
  id: string;
  /** Publishing agency, e.g. "NSW RFS". */
  source: string;
  state: 'NSW' | 'VIC' | 'SA' | 'WA' | 'ACT';
  title: string;
  /** Agency-native incident type, e.g. "Bush Fire", "Planned Burn". */
  category: string;
  status: string;
  level: AwsWarningLevel;
  lat: number;
  lng: number;
  /** Best-effort ISO timestamp of last update; null when unparseable. */
  updated: string | null;
  /** Agency-native timestamp string, always kept for honest display. */
  updatedRaw: string | null;
  sizeFmt: string | null;
}

export interface FeedSourceStatus {
  id: string;
  label: string;
  ok: boolean;
  error?: string;
  count: number;
}

export interface IncidentsResult {
  incidents: LiveIncident[];
  sources: FeedSourceStatus[];
  fetchedAt: string;
}

export interface HotspotsResult {
  geojson: GeoJSON.FeatureCollection;
  /** Total matching in the queried bbox (may exceed features returned). */
  totalMatched: number;
  truncated: boolean;
  fetchedAt: string;
}

export interface BoundariesResult {
  geojson: GeoJSON.FeatureCollection;
  truncated: boolean;
  fetchedAt: string;
}

export interface ViewBounds { minLat: number; minLng: number; maxLat: number; maxLng: number }

/** Jurisdictions with no live incident feed in this build — shown in the UI so
 *  absence of markers is never mistaken for absence of incidents. */
export const INCIDENTS_NOT_COVERED = ['QLD', 'TAS', 'NT'] as const;

const HOTSPOT_FEATURE_CAP = 2000;

// ---------------------------------------------------------------------------
// Shared helpers

const fetchJson = async (url: string, timeoutMs = 20000): Promise<any> => {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    window.clearTimeout(timer);
  }
};

/** Map agency wording onto an AWS level. Unrecognised → plain 'incident'. */
export const normaliseAwsLevel = (raw: string | null | undefined): AwsWarningLevel => {
  const s = (raw || '').toLowerCase();
  if (s.includes('emergency')) return 'emergency-warning';
  if (s.includes('watch')) return 'watch-and-act';
  if (s.includes('advice')) return 'advice';
  return 'incident';
};

/** First Point coordinates in a geometry (recursing into GeometryCollections). */
const firstPoint = (geom: any): [number, number] | null => {
  if (!geom) return null;
  if (geom.type === 'Point' && Array.isArray(geom.coordinates)) {
    const [lng, lat] = geom.coordinates;
    return typeof lng === 'number' && typeof lat === 'number' ? [lng, lat] : null;
  }
  if (geom.type === 'GeometryCollection') {
    for (const g of geom.geometries ?? []) {
      const p = firstPoint(g);
      if (p) return p;
    }
  }
  if (geom.type === 'Polygon' && Array.isArray(geom.coordinates?.[0])) {
    // Rough centroid of the outer ring — good enough for a marker.
    const ring: number[][] = geom.coordinates[0];
    if (!ring.length) return null;
    const sum = ring.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]);
    return [sum[0] / ring.length, sum[1] / ring.length];
  }
  return null;
};

/** Parse "dd/mm/yyyy h:mm:ss AM" (NSW) / "dd/mm/yyyy" + "HH:mm" (SA) to ISO, else null. */
const parseAuDate = (dateStr: string | null | undefined, timeStr?: string): string | null => {
  if (!dateStr) return null;
  const m = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
  if (!m) return null;
  let hours = 0, minutes = 0, seconds = 0;
  if (m[4]) {
    hours = parseInt(m[4], 10);
    minutes = parseInt(m[5], 10);
    seconds = m[6] ? parseInt(m[6], 10) : 0;
    const ampm = m[7]?.toUpperCase();
    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
  } else if (timeStr) {
    const t = timeStr.match(/(\d{1,2}):(\d{2})/);
    if (t) { hours = parseInt(t[1], 10); minutes = parseInt(t[2], 10); }
  }
  const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10), hours, minutes, seconds);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

// ---------------------------------------------------------------------------
// National feed: DEA Hotspots

/**
 * Fetch recent hotspots (last 3 days) within the given view bounds.
 * The `public:hotspots` full archive cannot be scanned unfiltered (times
 * out) — always the pre-filtered 3-day layer, always a bbox.
 */
export async function fetchHotspots(bounds: ViewBounds): Promise<HotspotsResult> {
  const bbox = `${bounds.minLat},${bounds.minLng},${bounds.maxLat},${bounds.maxLng},urn:ogc:def:crs:EPSG::4326`;
  const url = `${HOTSPOTS_WFS_URL}?service=WFS&version=2.0.0&request=GetFeature` +
    `&typeNames=public:hotspots_three_days&outputFormat=application/json` +
    `&count=${HOTSPOT_FEATURE_CAP}&srsName=EPSG:4326&bbox=${encodeURIComponent(bbox)}`;
  const data = await fetchJson(url, 30000);
  const totalMatched = typeof data.numberMatched === 'number' ? data.numberMatched : (data.features?.length ?? 0);
  return {
    geojson: { type: 'FeatureCollection', features: data.features ?? [] },
    totalMatched,
    truncated: totalMatched > (data.features?.length ?? 0),
    fetchedAt: new Date().toISOString()
  };
}

// ---------------------------------------------------------------------------
// National feed: Digital Atlas NRT bushfire boundaries

/** Fetch current national fire / prescribed-burn extents. Epoch-ms dates are
 *  converted to ISO copies (`*_iso`) so popups never show raw epoch values. */
export async function fetchFireBoundaries(): Promise<BoundariesResult> {
  const url = `${BOUNDARIES_URL}?where=1%3D1&outFields=fire_id,fire_name,fire_type,ignition_date,capt_date,area_ha,perim_km,state,agency,date_retrieved&f=geojson`;
  const data = await fetchJson(url, 30000);
  const features: GeoJSON.Feature[] = (data.features ?? []).map((f: any) => {
    const p = { ...(f.properties ?? {}) };
    for (const key of ['ignition_date', 'capt_date', 'date_retrieved']) {
      if (typeof p[key] === 'number') {
        const d = new Date(p[key]);
        p[`${key}_iso`] = isNaN(d.getTime()) ? null : d.toISOString();
      }
    }
    return { ...f, properties: p };
  });
  return {
    geojson: { type: 'FeatureCollection', features },
    truncated: data.properties?.exceededTransferLimit === true || data.exceededTransferLimit === true,
    fetchedAt: new Date().toISOString()
  };
}

// ---------------------------------------------------------------------------
// Jurisdictional incident feeds → normalised LiveIncident list

const parseNsw = (data: any): LiveIncident[] => {
  const out: LiveIncident[] = [];
  for (const f of data?.features ?? []) {
    const pt = firstPoint(f.geometry);
    if (!pt) continue;
    const props = f.properties ?? {};
    const desc: string = props.description ?? '';
    const alertMatch = desc.match(/ALERT LEVEL:\s*([^<]+)/i);
    const statusMatch = desc.match(/STATUS:\s*([^<]+)/i);
    const sizeMatch = desc.match(/SIZE:\s*([^<]+)/i);
    out.push({
      id: `nsw-${props.guid ?? props.title ?? out.length}`,
      source: 'NSW RFS', state: 'NSW',
      title: props.title ?? 'Incident',
      category: props.category ?? 'Incident',
      status: statusMatch?.[1]?.trim() ?? '',
      level: normaliseAwsLevel(alertMatch?.[1]),
      lng: pt[0], lat: pt[1],
      updated: parseAuDate(props.pubDate),
      updatedRaw: props.pubDate ?? null,
      sizeFmt: sizeMatch?.[1]?.trim() ?? null
    });
  }
  return out;
};

const parseVic = (data: any): LiveIncident[] => {
  const out: LiveIncident[] = [];
  for (const f of data?.features ?? []) {
    const props = f.properties ?? {};
    // burn-area polygons duplicate the national boundaries layer — skip.
    if (props.feedType === 'burn-area') continue;
    const pt = firstPoint(f.geometry);
    if (!pt) continue;
    const isWarning = props.feedType === 'warning';
    out.push({
      id: `vic-${props.id ?? props.sourceId ?? out.length}`,
      source: props.sourceOrg ?? 'VIC EMV', state: 'VIC',
      title: props.name ?? props.sourceTitle ?? props.category2 ?? 'Incident',
      category: props.category2 ?? props.category1 ?? 'Incident',
      status: props.status ?? '',
      level: isWarning ? normaliseAwsLevel(props.category1) : 'incident',
      lng: pt[0], lat: pt[1],
      updated: props.updated ?? props.created ?? null,
      updatedRaw: props.updated ?? props.created ?? null,
      sizeFmt: props.sizeFmt ?? null
    });
  }
  return out;
};

const parseSa = (data: any): LiveIncident[] => {
  const out: LiveIncident[] = [];
  for (const inc of Array.isArray(data) ? data : []) {
    const loc: string = inc.Location ?? '';
    const [latS, lngS] = loc.split(',');
    const lat = parseFloat(latS), lng = parseFloat(lngS);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    out.push({
      id: `sa-${inc.IncidentNo ?? out.length}`,
      source: 'SA CFS', state: 'SA',
      title: inc.Location_name ?? 'Incident',
      category: inc.Type ?? 'Incident',
      status: inc.Status ?? '',
      level: 'incident', // SA incident feed carries response level, not AWS warnings
      lat, lng,
      updated: parseAuDate(inc.Date, inc.Time),
      updatedRaw: [inc.Date, inc.Time].filter(Boolean).join(' ') || null,
      sizeFmt: null
    });
  }
  return out;
};

const parseWaIncidents = (data: any): LiveIncident[] => {
  const out: LiveIncident[] = [];
  for (const inc of data?.incidents ?? []) {
    const lat = inc?.location?.latitude, lng = inc?.location?.longitude;
    const pt: [number, number] | null =
      typeof lat === 'number' && typeof lng === 'number' ? [lng, lat]
        : firstPoint(inc?.['geo-source']?.features?.[0]?.geometry);
    if (!pt) continue;
    out.push({
      id: `wa-${inc.id ?? inc['cad-id'] ?? out.length}`,
      source: 'DFES (Emergency WA)', state: 'WA',
      title: inc.name ?? 'Incident',
      category: inc['incident-type'] ?? 'Incident',
      status: inc['incident-status'] ?? '',
      level: 'incident',
      lng: pt[0], lat: pt[1],
      updated: inc['updated-date-time'] ?? null,
      updatedRaw: inc['updated-date-time'] ?? null,
      sizeFmt: null
    });
  }
  return out;
};

const parseWaWarnings = (data: any): LiveIncident[] => {
  const out: LiveIncident[] = [];
  for (const w of data?.warnings ?? []) {
    const lat = w?.location?.latitude, lng = w?.location?.longitude;
    const pt: [number, number] | null =
      typeof lat === 'number' && typeof lng === 'number' ? [lng, lat]
        : firstPoint(w?.['geo-source']?.features?.[0]?.geometry);
    if (!pt) continue;
    // Level is encoded in entitySubType, e.g. "warnings_bushfire--advice".
    const subtype: string = w.entitySubType ?? '';
    const levelPart = subtype.split('--')[1]?.replace(/-/g, ' ');
    out.push({
      id: `wa-warn-${w.id ?? out.length}`,
      source: 'DFES (Emergency WA)', state: 'WA',
      title: w.name ?? 'Warning',
      category: w['incident-type'] ?? 'Warning',
      status: w['publishing-status'] ?? '',
      level: normaliseAwsLevel(levelPart),
      lng: pt[0], lat: pt[1],
      updated: w['updated-date-time'] ?? null,
      updatedRaw: w['updated-date-time'] ?? null,
      sizeFmt: null
    });
  }
  return out;
};

const parseAct = (xml: string): LiveIncident[] => {
  const out: LiveIncident[] = [];
  const root = parseXml(xml);
  for (const item of findAll(root, 'item')) {
    const pointText = childFirst(item, 'point')?.text?.trim() ?? '';
    const [latS, lngS] = pointText.split(/\s+/);
    const lat = parseFloat(latS), lng = parseFloat(lngS);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    const desc = childFirst(item, 'description')?.text ?? '';
    const statusMatch = desc.match(/Status:\s*([^\r\n]+)/i);
    out.push({
      id: `act-${childFirst(item, 'guid')?.text ?? out.length}`,
      source: 'ACT ESA', state: 'ACT',
      title: childFirst(item, 'title')?.text?.trim() ?? 'Incident',
      category: childFirst(item, 'type')?.text?.trim() ?? 'Incident',
      status: statusMatch?.[1]?.trim() ?? '',
      level: 'incident',
      lat, lng,
      updated: null, // feed pubDate is "YYYY-MM-DD HH:mm AEST" — kept raw only
      updatedRaw: childFirst(item, 'pubdate')?.text?.trim() ?? null,
      sizeFmt: null
    });
  }
  return out;
};

/**
 * Fetch all available jurisdictional incident feeds in parallel. Each source
 * fails independently and reports its own status — one broken agency feed
 * never hides the others, and failures are surfaced to the UI.
 */
export async function fetchIncidents(): Promise<IncidentsResult> {
  const tasks: { id: string; label: string; run: () => Promise<LiveIncident[]> }[] = [
    { id: 'nsw', label: 'NSW RFS', run: async () => parseNsw(await fetchJson(INCIDENT_FEEDS.nsw)) },
    { id: 'vic', label: 'VIC (EMV)', run: async () => parseVic(await fetchJson(INCIDENT_FEEDS.vic)) },
    { id: 'sa', label: 'SA CFS', run: async () => parseSa(await fetchJson(INCIDENT_FEEDS.sa)) },
    {
      id: 'wa', label: 'WA DFES', run: async () => {
        const [inc, warn] = await Promise.allSettled([
          fetchJson(INCIDENT_FEEDS.waIncidents),
          fetchJson(INCIDENT_FEEDS.waWarnings)
        ]);
        const items: LiveIncident[] = [];
        if (inc.status === 'fulfilled') items.push(...parseWaIncidents(inc.value));
        if (warn.status === 'fulfilled') items.push(...parseWaWarnings(warn.value));
        if (inc.status === 'rejected' && warn.status === 'rejected') throw inc.reason;
        return items;
      }
    },
    {
      id: 'act', label: 'ACT ESA', run: async () => {
        const res = await fetch(INCIDENT_FEEDS.act);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return parseAct(await res.text());
      }
    }
  ];

  const settled = await Promise.allSettled(tasks.map(t => t.run()));
  const incidents: LiveIncident[] = [];
  const sources: FeedSourceStatus[] = settled.map((result, i) => {
    const t = tasks[i];
    if (result.status === 'fulfilled') {
      incidents.push(...result.value);
      return { id: t.id, label: t.label, ok: true, count: result.value.length };
    }
    logger.warn(`Live feed ${t.label} failed`, result.reason);
    return { id: t.id, label: t.label, ok: false, count: 0, error: result.reason?.message ?? 'fetch failed' };
  });

  return { incidents, sources, fetchedAt: new Date().toISOString() };
}

/** Convert normalised incidents to GeoJSON for the map layer. */
export function incidentsToGeoJson(incidents: LiveIncident[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: incidents.map(inc => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [inc.lng, inc.lat] },
      properties: {
        id: inc.id, source: inc.source, state: inc.state, title: inc.title,
        category: inc.category, status: inc.status, level: inc.level,
        updatedRaw: inc.updatedRaw ?? '', sizeFmt: inc.sizeFmt ?? '',
        // Emergency Warning sorts above Watch and Act, etc., so higher levels
        // render on top when symbols collide.
        levelRank: inc.level === 'emergency-warning' ? 3 : inc.level === 'watch-and-act' ? 2 : inc.level === 'advice' ? 1 : 0
      }
    }))
  };
}
