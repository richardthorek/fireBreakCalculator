/**
 * GIS file import: GeoJSON, KML, KMZ and GPX.
 *
 * Two destinations, chosen by the user after parsing:
 *  - "Use as plan line": a single imported LineString replaces the drawn line
 *    and runs through the full analysis pipeline (covers FireMapper exports,
 *    GPS tracks, lines drawn in other tools).
 *  - "Add as map overlay": everything (fire perimeters, sectors, other lines)
 *    renders as a non-editable reference layer for context.
 *
 * Parsing is lenient — we extract what we understand and report counts —
 * but never silent: unreadable files produce a visible error, not an empty map.
 */

import { LatLng } from './chainage';
import { logger } from './logger';

export interface ImportedLine {
  name: string;
  coords: LatLng[];
}

export interface ImportedFeatures {
  /** Source filename (for labelling the overlay). */
  sourceName: string;
  lines: ImportedLine[];
  /** Polygons as GeoJSON-style ring arrays (outer ring first). */
  polygons: { name: string; rings: number[][][] }[];
}

/** Parse a user-supplied file into lines + polygons. Throws with a readable message. */
export async function parseGisFile(file: File): Promise<ImportedFeatures> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.kmz')) {
    const kml = await extractKmlFromKmz(await file.arrayBuffer());
    return parseKml(kml, file.name);
  }
  const text = await file.text();
  if (name.endsWith('.kml')) return parseKml(text, file.name);
  if (name.endsWith('.gpx')) return parseGpx(text, file.name);
  if (name.endsWith('.geojson') || name.endsWith('.json')) return parseGeoJson(text, file.name);
  // Unknown extension: sniff content.
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) return parseGeoJson(text, file.name);
  if (trimmed.includes('<kml')) return parseKml(text, file.name);
  if (trimmed.includes('<gpx')) return parseGpx(text, file.name);
  throw new Error(`Unsupported file type: ${file.name}. Use GeoJSON, KML, KMZ or GPX.`);
}

// --- GeoJSON ---------------------------------------------------------------------

function parseGeoJson(text: string, sourceName: string): ImportedFeatures {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON.');
  }
  const out: ImportedFeatures = { sourceName, lines: [], polygons: [] };
  const features: any[] =
    json.type === 'FeatureCollection' ? json.features ?? []
    : json.type === 'Feature' ? [json]
    : json.type ? [{ type: 'Feature', properties: {}, geometry: json }]
    : [];

  features.forEach((f: any, i: number) => {
    const g = f?.geometry;
    if (!g) return;
    const label = f.properties?.name || f.properties?.Name || f.properties?.title || `Feature ${i + 1}`;
    const addLine = (coords: number[][]) => {
      const pts = coords.filter(c => Array.isArray(c) && c.length >= 2).map(c => ({ lat: c[1], lng: c[0] }));
      if (pts.length >= 2) out.lines.push({ name: label, coords: pts });
    };
    if (g.type === 'LineString') addLine(g.coordinates);
    else if (g.type === 'MultiLineString') (g.coordinates ?? []).forEach(addLine);
    else if (g.type === 'Polygon') out.polygons.push({ name: label, rings: g.coordinates ?? [] });
    else if (g.type === 'MultiPolygon') (g.coordinates ?? []).forEach((rings: number[][][], j: number) =>
      out.polygons.push({ name: `${label} (${j + 1})`, rings }));
  });

  if (out.lines.length === 0 && out.polygons.length === 0) {
    throw new Error('No lines or polygons found in the GeoJSON file.');
  }
  return out;
}

// --- KML / KMZ ---------------------------------------------------------------------

async function extractKmlFromKmz(buffer: ArrayBuffer): Promise<string> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const entries = unzipSync(new Uint8Array(buffer));
  const kmlEntry =
    entries['doc.kml'] !== undefined
      ? 'doc.kml'
      : Object.keys(entries).find(k => k.toLowerCase().endsWith('.kml'));
  if (!kmlEntry) throw new Error('KMZ archive contains no KML document.');
  return strFromU8(entries[kmlEntry]);
}

function parseCoordinateString(raw: string): LatLng[] {
  // KML coordinates: "lng,lat[,alt]" tuples separated by whitespace.
  return raw
    .trim()
    .split(/\s+/)
    .map(tuple => {
      const [lng, lat] = tuple.split(',').map(Number);
      return { lat, lng };
    })
    .filter(p => isFinite(p.lat) && isFinite(p.lng));
}

function parseKml(text: string, sourceName: string): ImportedFeatures {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('File is not valid KML.');
  const out: ImportedFeatures = { sourceName, lines: [], polygons: [] };

  doc.querySelectorAll('Placemark').forEach((pm, i) => {
    const label = pm.querySelector(':scope > name')?.textContent?.trim() || `Placemark ${i + 1}`;
    pm.querySelectorAll('LineString > coordinates').forEach(node => {
      const coords = parseCoordinateString(node.textContent ?? '');
      if (coords.length >= 2) out.lines.push({ name: label, coords });
    });
    pm.querySelectorAll('Polygon').forEach(poly => {
      const outer = poly.querySelector('outerBoundaryIs coordinates');
      if (!outer) return;
      const ring = parseCoordinateString(outer.textContent ?? '').map(p => [p.lng, p.lat]);
      const inner: number[][][] = [];
      poly.querySelectorAll('innerBoundaryIs coordinates').forEach(n => {
        inner.push(parseCoordinateString(n.textContent ?? '').map(p => [p.lng, p.lat]));
      });
      if (ring.length >= 4) out.polygons.push({ name: label, rings: [ring, ...inner] });
    });
  });

  if (out.lines.length === 0 && out.polygons.length === 0) {
    throw new Error('No LineStrings or Polygons found in the KML file.');
  }
  return out;
}

// --- GPX ------------------------------------------------------------------------------

function parseGpx(text: string, sourceName: string): ImportedFeatures {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('File is not valid GPX.');
  const out: ImportedFeatures = { sourceName, lines: [], polygons: [] };

  const readPoints = (nodes: NodeListOf<Element>): LatLng[] =>
    Array.from(nodes)
      .map(n => ({ lat: Number(n.getAttribute('lat')), lng: Number(n.getAttribute('lon')) }))
      .filter(p => isFinite(p.lat) && isFinite(p.lng));

  doc.querySelectorAll('trk').forEach((trk, i) => {
    const label = trk.querySelector('name')?.textContent?.trim() || `Track ${i + 1}`;
    const coords = readPoints(trk.querySelectorAll('trkpt'));
    if (coords.length >= 2) out.lines.push({ name: label, coords });
  });
  doc.querySelectorAll('rte').forEach((rte, i) => {
    const label = rte.querySelector('name')?.textContent?.trim() || `Route ${i + 1}`;
    const coords = readPoints(rte.querySelectorAll('rtept'));
    if (coords.length >= 2) out.lines.push({ name: label, coords });
  });

  if (out.lines.length === 0) throw new Error('No tracks or routes found in the GPX file.');
  return out;
}

/** Convert imported features to a GeoJSON FeatureCollection for the overlay layer. */
export function importedToGeoJSON(features: ImportedFeatures): any {
  return {
    type: 'FeatureCollection',
    features: [
      ...features.lines.map(l => ({
        type: 'Feature',
        properties: { name: l.name },
        geometry: { type: 'LineString', coordinates: l.coords.map(c => [c.lng, c.lat]) },
      })),
      ...features.polygons.map(p => ({
        type: 'Feature',
        properties: { name: p.name },
        geometry: { type: 'Polygon', coordinates: p.rings },
      })),
    ],
  };
}

/** Cap import size defensively (vertices across all features). */
export function totalVertices(features: ImportedFeatures): number {
  const lineVerts = features.lines.reduce((n, l) => n + l.coords.length, 0);
  const polyVerts = features.polygons.reduce((n, p) => n + p.rings.reduce((m, r) => m + r.length, 0), 0);
  return lineVerts + polyVerts;
}

export const MAX_IMPORT_VERTICES = 50000;

export function validateImportSize(features: ImportedFeatures): void {
  const n = totalVertices(features);
  if (n > MAX_IMPORT_VERTICES) {
    logger.warn(`Import rejected: ${n} vertices exceeds cap`);
    throw new Error(`File too large (${n.toLocaleString()} vertices; max ${MAX_IMPORT_VERTICES.toLocaleString()}). Simplify it in your GIS first.`);
  }
}
