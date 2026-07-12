/**
 * GIS export pack: GeoJSON, KML, KMZ and Shapefile for the planned line.
 *
 * The exported features mirror exactly what the analysis panel shows — the
 * same joined slope×vegetation slices (`segmentJoin.ts`), the same values,
 * and crucially the same data-provenance flags. Honesty flags MUST survive
 * the round-trip into other tools: a plan built on estimated data stays
 * labelled as such in FireMapper/QGIS/Earth.
 *
 * Consumers: FireMapper (GeoJSON/KML import), QGIS/ArcGIS (GeoJSON/SHP),
 * Google Earth & Avenza (KML/KMZ), plus the existing GPX export in
 * `planSharing.ts` for GPS units.
 */

import { TrackAnalysis, VegetationAnalysis } from '../types/config';
import { SLOPE_CATEGORIES, VEGETATION_CATEGORIES } from '../config/categories';
import { buildJoinedSegments, JoinedSegment } from './segmentJoin';
import { buildChainageIndex, sliceByChainage, LatLng } from './chainage';

export interface ExportPlanInput {
  /** Ordered vertices of the drawn line. */
  coords: LatLng[];
  /** Total distance in metres. */
  distance: number;
  trackAnalysis: TrackAnalysis | null;
  vegetationAnalysis: VegetationAnalysis | null;
  breakWidthMeters: number;
  difficultyScore?: number;
  difficultyLabel?: string;
  /** Plan name used in file metadata. */
  name?: string;
  /** User-drawn access lines (annotation, exported with role: access). */
  accessLines?: LatLng[][];
}

interface SegmentWithCoords extends JoinedSegment {
  coords: LatLng[];
}

/** Resolve the joined segments and attach their geographic slices. */
function resolveSegments(input: ExportPlanInput): SegmentWithCoords[] {
  if (!input.trackAnalysis) return [];
  const joined = buildJoinedSegments(input.trackAnalysis, input.vegetationAnalysis);
  const index = buildChainageIndex(input.coords);
  return joined.map(seg => ({ ...seg, coords: sliceByChainage(index, seg.startM, seg.endM) }));
}

/** Common plan-level properties, provenance flags included. */
function planProperties(input: ExportPlanInput) {
  return {
    kind: 'route',
    name: input.name || 'Fire break plan',
    generator: 'Fire Break Calculator',
    generated_utc: new Date().toISOString(),
    distance_m: Math.round(input.distance),
    break_width_m: input.breakWidthMeters,
    max_slope_deg: input.trackAnalysis ? Math.round(input.trackAnalysis.maxSlope * 10) / 10 : null,
    mean_slope_deg: input.trackAnalysis ? Math.round(input.trackAnalysis.averageSlope * 10) / 10 : null,
    predominant_vegetation: input.vegetationAnalysis?.predominantVegetation ?? null,
    difficulty_score: input.difficultyScore ?? null,
    difficulty_label: input.difficultyLabel ?? null,
    // Data honesty: these flags must survive into downstream tools.
    estimated_elevation_data: !!input.trackAnalysis?.usedMockElevation,
    estimated_vegetation_data: !!input.vegetationAnalysis?.usedFallbackData,
  };
}

function segmentProperties(seg: JoinedSegment, index: number) {
  return {
    kind: 'segment',
    segment: index + 1,
    chainage_start_m: Math.round(seg.startM),
    chainage_end_m: Math.round(seg.endM),
    length_m: Math.round(seg.endM - seg.startM),
    grade_deg: Math.round(seg.slope * 10) / 10,
    slope_category: seg.slopeCategory,
    vegetation: seg.vegetation ?? 'unknown',
    vegetation_label: seg.vegLabel ?? null,
    vegetation_confidence: seg.confidence !== undefined ? Math.round(seg.confidence * 100) / 100 : null,
    estimated_data: seg.estimated,
  };
}

const lineStringCoords = (coords: LatLng[]): number[][] => coords.map(c => [c.lng, c.lat]);

// --- GeoJSON -----------------------------------------------------------------

export function toGeoJSON(input: ExportPlanInput): string {
  const segments = resolveSegments(input);
  const features: any[] = [
    {
      type: 'Feature',
      properties: planProperties(input),
      geometry: { type: 'LineString', coordinates: lineStringCoords(input.coords) },
    },
    ...segments
      .filter(s => s.coords.length >= 2)
      .map((seg, i) => ({
        type: 'Feature',
        properties: segmentProperties(seg, i),
        geometry: { type: 'LineString', coordinates: lineStringCoords(seg.coords) },
      })),
  ];
  return JSON.stringify({ type: 'FeatureCollection', features }, null, 2);
}

// --- KML / KMZ ---------------------------------------------------------------

const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Convert a #rrggbb CSS color to KML aabbggrr. */
const kmlColor = (hex: string, alpha = 'ff'): string => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return `${alpha}ffffff`;
  return `${alpha}${m[3]}${m[2]}${m[1]}`.toLowerCase();
};

const kmlCoords = (coords: LatLng[]): string => coords.map(c => `${c.lng},${c.lat},0`).join(' ');

export function toKML(input: ExportPlanInput): string {
  const segments = resolveSegments(input);
  const plan = planProperties(input);
  const estimatedNote = plan.estimated_elevation_data || plan.estimated_vegetation_data
    ? '<p><b>⚠️ ESTIMATED DATA:</b> parts of this analysis used non-authoritative fallback data. Verify on the ground.</p>'
    : '';

  const styles = SLOPE_CATEGORIES.map(cat => `
    <Style id="slope-${cat.key}">
      <LineStyle><color>${kmlColor(cat.color)}</color><width>5</width></LineStyle>
    </Style>`).join('');

  const legend = [
    ...SLOPE_CATEGORIES.map(c => `${c.label} (${c.range ?? ''})`),
    '—',
    ...VEGETATION_CATEGORIES.map(c => c.label),
  ].join(' · ');

  const routeDescription = `<![CDATA[
    <h3>${xmlEscape(plan.name)}</h3>
    <p>Length: <b>${plan.distance_m} m</b> · Break width: <b>${plan.break_width_m} m</b>
    ${plan.max_slope_deg != null ? ` · Max slope: <b>${plan.max_slope_deg}°</b>` : ''}
    ${plan.difficulty_label ? ` · Difficulty: <b>${plan.difficulty_label} (${plan.difficulty_score}/100)</b>` : ''}</p>
    ${estimatedNote}
    <p><small>Generated ${plan.generated_utc} by Fire Break Calculator. Line colours: ${xmlEscape(legend)}</small></p>
  ]]>`;

  const segmentPlacemarks = segments
    .filter(s => s.coords.length >= 2)
    .map((seg, i) => {
      const p = segmentProperties(seg, i);
      return `
      <Placemark>
        <name>Seg ${p.segment}: ${xmlEscape(String(p.vegetation))} · ${p.grade_deg}°${p.estimated_data ? ' (est.)' : ''}</name>
        <styleUrl>#slope-${p.slope_category}</styleUrl>
        <description><![CDATA[
          <p>Chainage ${p.chainage_start_m}–${p.chainage_end_m} m (${p.length_m} m)</p>
          <p>Grade: ${p.grade_deg}° (${p.slope_category}) · Fuel: ${xmlEscape(String(p.vegetation_label ?? p.vegetation))}
          ${p.vegetation_confidence != null ? ` · Confidence: ${Math.round(p.vegetation_confidence * 100)}%` : ''}</p>
          ${p.estimated_data ? '<p><b>⚠️ Estimated (non-authoritative) data for this segment.</b></p>' : ''}
        ]]></description>
        <LineString><tessellate>1</tessellate><coordinates>${kmlCoords(seg.coords)}</coordinates></LineString>
      </Placemark>`;
    }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${xmlEscape(plan.name)}</name>
    ${styles}
    <Placemark>
      <name>${xmlEscape(plan.name)} (route)</name>
      <description>${routeDescription}</description>
      <Style><LineStyle><color>${kmlColor('#ff6b35')}</color><width>3</width></LineStyle></Style>
      <LineString><tessellate>1</tessellate><coordinates>${kmlCoords(input.coords)}</coordinates></LineString>
    </Placemark>
    <Folder>
      <name>Segments (grade × fuel)</name>
      ${segmentPlacemarks}
    </Folder>
  </Document>
</kml>`;
}

/** KMZ = zipped KML (doc.kml at archive root). */
export async function toKMZ(input: ExportPlanInput): Promise<Blob> {
  const { zipSync, strToU8 } = await import('fflate');
  const kml = toKML(input);
  const zipped = zipSync({ 'doc.kml': strToU8(kml) });
  // Uint8Array-backed Blob; cast keeps TS happy across lib versions.
  return new Blob([zipped as unknown as BlobPart], { type: 'application/vnd.google-earth.kmz' });
}

// --- Shapefile ------------------------------------------------------------------

/**
 * Shapefile export (zipped .shp/.shx/.dbf/.prj) via @mapbox/shp-write.
 * DBF fields come from the flattened feature properties; field names are
 * truncated to the DBF 10-char limit by the library.
 */
export async function toShapefileZip(input: ExportPlanInput): Promise<Blob> {
  const shpwrite = (await import('@mapbox/shp-write')) as any;
  const geojson = JSON.parse(toGeoJSON(input));
  // DBF cannot hold nulls comfortably — stringify and drop nulls.
  for (const f of geojson.features) {
    for (const [k, v] of Object.entries(f.properties)) {
      if (v === null || v === undefined) delete f.properties[k];
      else if (typeof v === 'boolean') f.properties[k] = v ? 1 : 0;
    }
  }
  const buffer: ArrayBuffer = await shpwrite.zip(geojson, {
    outputType: 'arraybuffer',
    compression: 'STORE',
    types: { polyline: 'fire_break_plan' },
  });
  return new Blob([buffer], { type: 'application/zip' });
}

// --- Download helpers -------------------------------------------------------------

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const exportFilename = (ext: string): string =>
  `fire-break-${new Date().toISOString().slice(0, 10)}.${ext}`;
