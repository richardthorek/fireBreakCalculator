#!/usr/bin/env node

/**
 * Upstream data-contract canary.
 *
 * The product is load-bearing on ~10 free public endpoints (NVIS, NSW SVTM,
 * DEA Hotspots, Digital Atlas, Overpass, Mapbox) with no SLA and no notice
 * before they change shape. Real drift has already bitten us: the NVIS
 * `NoData`/`SORT_ORDER` attribute mix-up was a between-release schema change,
 * and Overpass changed its throttling under us. The unit tests are all stubs,
 * so they stay green while production silently returns garbage.
 *
 * This hits each live endpoint with a known input and asserts the response
 * still has the shape/fields the code depends on. It exits non-zero if any
 * REQUIRED check drifts, so a scheduled CI run (see
 * .github/workflows/upstream-canary.yml) surfaces the break before a field user
 * does. Dependency-free (native fetch, Node 20+).
 *
 * Run locally:  node scripts/canary/upstreamCanary.mjs
 * Mapbox check runs only when MAPBOX_TOKEN is set.
 */

const TIMEOUT_MS = 20_000;

async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

// --- Checks -----------------------------------------------------------------
// Each returns a human-readable detail string on success or throws on drift.

const NVIS_MVG_URL =
  process.env.NVIS_MVG_URL ||
  'https://gis.environment.gov.au/gispubmap/rest/services/ogc_services/NVIS_ext_mvg/MapServer';

async function checkNvis() {
  // Known wet-tropics rainforest point — must resolve to a real MVG code (1–32).
  const lat = -16.0;
  const lng = 145.0;
  const d = 0.01;
  const mapExtent = `${lng - d},${lat - d},${lng + d},${lat + d}`;
  const url =
    `${NVIS_MVG_URL}/identify?f=json&geometry=${encodeURIComponent(`${lng},${lat}`)}` +
    `&geometryType=esriGeometryPoint&sr=4326&layers=${encodeURIComponent('all:0')}` +
    `&tolerance=1&mapExtent=${encodeURIComponent(mapExtent)}&imageDisplay=400,400,96&returnGeometry=false`;
  const json = await getJson(url);
  const attrs = json?.results?.[0]?.attributes;
  if (!attrs) throw new Error('identify returned no results/attributes');
  // Mirror extractMVGCode: a valid integer MVG code must be present.
  const code = Object.values(attrs)
    .map((v) => (typeof v === 'number' ? v : parseInt(String(v), 10)))
    .find((n) => Number.isInteger(n) && n >= 1 && n <= 32);
  if (code === undefined) {
    throw new Error(`no MVG code (1–32) in attributes: ${Object.keys(attrs).join(', ')}`);
  }
  return `resolved MVG code ${code}`;
}

async function checkNvisLegend() {
  // The area-sampling path (one export image per corridor instead of one
  // identify per point) decodes pixel colours against the service's OWN
  // legend. Contract: legend?f=json exposes layer 0 with per-class swatch
  // imageData for (nearly) all 33 MVG classes.
  const json = await getJson(`${NVIS_MVG_URL}/legend?f=json`);
  const layer = (json?.layers || []).find((l) => l?.layerId === 0) || json?.layers?.[0];
  const items = (layer?.legend || []).filter((it) => typeof it?.imageData === 'string' && it.imageData.length > 50);
  if (items.length < 15) {
    throw new Error(`legend has only ${items.length} decodable swatch entries (expected ~33 MVG classes)`);
  }
  // Labels must still be resolvable to MVG groups (leading number or name).
  const labelled = items.filter((it) => /\d|forest|grass|shrub|wood|mallee|heath|mangrove|rainforest/i.test(it.label || ''));
  if (labelled.length < 10) {
    throw new Error(`legend labels look unrecognisable (${labelled.length} matched known patterns)`);
  }
  return `${items.length} swatches with imageData, labels recognisable`;
}

async function checkNvisExport() {
  // Same area-sampling path: export must render a small bbox to a real PNG.
  const url =
    `${NVIS_MVG_URL}/export?f=image&format=png&transparent=true` +
    `&bbox=145.0,-16.05,145.1,-15.95&bboxSR=4326&imageSR=4326&size=100,100&layers=${encodeURIComponent('show:0')}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!isPng) throw new Error(`export did not return a PNG (${bytes.length} bytes, content-type ${res.headers.get('content-type')})`);
  if (bytes.length < 200) throw new Error(`export PNG suspiciously small (${bytes.length} bytes — likely blank)`);
  return `PNG returned (${bytes.length} bytes) for wet-tropics probe bbox`;
}

const NSW_SVTM_BASE =
  process.env.NSW_SVTM_URL ||
  'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/VIS/SVTM_NSW_Extant_PCT/MapServer';

async function checkNswSvtm() {
  // Schema contract: the code reads vegForm/vegClass/PCTName off layer 3. Check
  // the layer metadata still exposes those fields (catches field renames — the
  // exact drift class that collapsed every formation to medium scrub).
  const json = await getJson(`${NSW_SVTM_BASE}/3?f=json`);
  const fields = (json?.fields || []).map((f) => f.name);
  const required = ['vegForm', 'vegClass', 'PCTName'];
  const missing = required.filter((r) => !fields.includes(r));
  if (missing.length) throw new Error(`layer 3 missing fields: ${missing.join(', ')}`);
  return `layer 3 exposes ${required.join('/')}`;
}

async function checkDeaHotspots() {
  // Small bbox over NSW; assert a valid GeoJSON FeatureCollection (may be empty).
  const bbox = '-34,150,-33,151,urn:ogc:def:crs:EPSG::4326';
  const url =
    'https://hotspots.dea.ga.gov.au/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature' +
    `&typeNames=public:hotspots_three_days&outputFormat=application/json&count=1&srsName=EPSG:4326` +
    `&bbox=${encodeURIComponent(bbox)}`;
  const json = await getJson(url);
  if (json?.type !== 'FeatureCollection' || !Array.isArray(json.features)) {
    throw new Error(`not a FeatureCollection (type=${json?.type})`);
  }
  return `FeatureCollection, ${json.features.length} feature(s) in probe bbox`;
}

async function checkDigitalAtlas() {
  const url =
    'https://services-ap1.arcgis.com/ypkPEy1AmwPKGNNv/arcgis/rest/services/' +
    'Near_Real_Time_Bushfire_Boundaries_view/FeatureServer/3/query' +
    '?where=1%3D1&outFields=fire_id,fire_name,state&f=geojson&resultRecordCount=1';
  const json = await getJson(url);
  if (json?.type !== 'FeatureCollection' || !Array.isArray(json.features)) {
    throw new Error(`not a FeatureCollection (type=${json?.type})`);
  }
  return `FeatureCollection, ${json.features.length} feature(s)`;
}

async function checkOverpass() {
  // Tiny query over a known area; assert the JSON contract (elements array).
  const query = '[out:json][timeout:20];way(around:200,-33.7,150.3)[highway];out ids 1;';
  const json = await getJson('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!Array.isArray(json?.elements)) throw new Error('response has no elements array');
  return `elements array present (${json.elements.length})`;
}

async function checkMapbox() {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) return { skipped: true, detail: 'MAPBOX_TOKEN not set' };
  // Tilequery against Mapbox Terrain (used for elevation fallback).
  const url = `https://api.mapbox.com/v4/mapbox.mapbox-terrain-v2/tilequery/150.3,-33.7.json?access_token=${token}`;
  const json = await getJson(url);
  if (json?.type !== 'FeatureCollection') throw new Error(`unexpected response type ${json?.type}`);
  return { skipped: false, detail: 'tilequery ok' };
}

const CHECKS = [
  { name: 'NVIS Extant MVG (national vegetation)', required: true, run: checkNvis },
  { name: 'NVIS legend (area colour-decode contract)', required: true, run: checkNvisLegend },
  { name: 'NVIS export image (area sampling)', required: true, run: checkNvisExport },
  { name: 'NSW SVTM PCT (vegetation overlay)', required: true, run: checkNswSvtm },
  { name: 'DEA Sentinel Hotspots (WFS)', required: true, run: checkDeaHotspots },
  { name: 'Digital Atlas NRT bushfire boundaries', required: true, run: checkDigitalAtlas },
  { name: 'Overpass / OSM (infrastructure trails)', required: false, run: checkOverpass },
  { name: 'Mapbox Terrain tilequery', required: false, run: checkMapbox },
];

async function main() {
  console.log('=== Upstream data-contract canary ===');
  console.log(new Date().toISOString());
  let failures = 0;
  let skipped = 0;

  for (const check of CHECKS) {
    try {
      const result = await check.run();
      if (result && typeof result === 'object' && result.skipped) {
        skipped++;
        console.log(`  ○ SKIP  ${check.name} — ${result.detail}`);
        continue;
      }
      const detail = typeof result === 'object' ? result.detail : result;
      console.log(`  ✓ OK    ${check.name} — ${detail}`);
    } catch (err) {
      const tag = check.required ? 'FAIL' : 'WARN';
      if (check.required) failures++;
      console.log(`  ✗ ${tag}  ${check.name} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('');
  console.log(`Result: ${failures} required failure(s), ${skipped} skipped.`);
  if (failures > 0) {
    console.log('A required upstream drifted — investigate before it reaches the field.');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('Canary crashed:', e);
  process.exitCode = 1;
});
