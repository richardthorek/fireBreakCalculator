/**
 * GIS export pack for Terrain Mobility & Counter-Mobility results — the
 * mechanism for "this will then be scouted and planned in more detail"
 * (owner, 2026-07-26): a rapid appreciation done here needs to leave the app
 * as real geometry a ground party can load in QGIS/FireMapper/Google Earth,
 * not just read off a panel. Mirrors gisExport.ts's exact pattern (GeoJSON /
 * KML / KMZ, provenance stamps, per-feature honesty flags) rather than
 * inventing a second one — same consumers, same contract.
 *
 * WHAT IS EXPORTED:
 *  - Movement corridors → one MultiPolygon Feature per corridor, built from
 *    its own hex cells undissolved. That is deliberate: a smoothed outline
 *    would claim a boundary precision the hex grid doesn't have (docs §27/28
 *    — a corridor is "movement will happen somewhere in this band").
 *  - Chokepoints → one Polygon Feature per top route-crossing hex cell.
 *  - Min-cut barrier → one LineString Feature per severing-cut segment.
 *  - Counter-measure placements → one LineString Feature per placed edge (an
 *    obstacle is sited AT an edge between two cells — a line between their
 *    centers is what was actually computed, never an invented point along
 *    it), carrying that measure's own delay-ledger figures so the exported
 *    course of action is backed by the same numbers the panel shows.
 *
 * Every feature carries `estimated_data`/`ledger_status`-style honesty flags
 * scoped to ITSELF, not one blanket caveat for the whole export — some
 * corridors sit entirely on surveyed cells, others don't, and a single flag
 * would either hide a real caveat or over-warn on clean ground.
 *
 * Shapefile is deliberately NOT offered here (unlike gisExport.ts's route
 * export): this pack mixes MultiPolygon/Polygon/LineString features in one
 * set, which needs @mapbox/shp-write's per-geometry-type file splitting to be
 * verified working for MultiPolygon specifically — unconfirmed, so it is left
 * out rather than shipped untested. GeoJSON/KML/KMZ already cover this
 * module's QGIS/FireMapper/Google Earth consumers.
 */

import { CorridorField, Corridor } from '../terrain/corridorField';
import { ChokepointCell } from '../terrain/corridorAnalysis';
import { MinCutResult } from '../terrain/minCutBarrier';
import { MoverProfile } from '../terrain/moverProfiles';
import { MobilityGridCell } from '../terrain/accumulatedCost';
import { CounterMeasurePlacement, DelayLedgerEntry } from '../terrain/delayLedger';
import { CounterMeasure } from '../terrain/counterMeasures';
import { provenanceProperties, provenanceStamp, DISCLAIMER_LONG } from '../config/provenance';
import { LatLng } from '../utils/chainage';
import { xmlEscape, kmlColor, kmlCoords } from './gisExport';

export interface ExportMobilityInput {
  name?: string;
  profile: MoverProfile;
  nightMode: boolean;
  /** Grid-level honesty flag — at least one sampled cell used estimated/
   *  fallback data somewhere in the AOI. */
  usedEstimatedData: boolean;
  corridorField: CorridorField | null;
  chokepoints: ChokepointCell[];
  barrier: MinCutResult | null;
  /** The exact sampled grid, needed to resolve a counter-measure placement's
   *  edge (`segmentFromKey`/`segmentToKey`) back to real coordinates. */
  cells: MobilityGridCell[];
  placements: CounterMeasurePlacement[];
  measures: CounterMeasure[];
  /** Null when the ledger hasn't been run for the current placements —
   *  placements still export, flagged `ledger_status: not_scored` rather
   *  than carrying stale or invented numbers. */
  ledger: DelayLedgerEntry[] | null;
}

const round = (v: number, dp = 0): number | null => {
  if (!isFinite(v)) return null;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

const ringCoords = (ring: LatLng[]): number[][] => ring.map(p => [p.lng, p.lat]);

function missionProperties(input: ExportMobilityInput) {
  return {
    kind: 'terrain_mobility_appreciation',
    name: input.name || 'Terrain mobility appreciation',
    ...provenanceProperties(),
    mover_profile: input.profile.label,
    mover_profile_confidence: input.profile.confidence,
    night_mode: input.nightMode,
    estimated_data_present: input.usedEstimatedData,
  };
}

function corridorProperties(c: Corridor, totalRoutes: number) {
  return {
    kind: 'movement_corridor',
    rank: c.rank,
    ease_class: c.easeClass,
    route_count: c.routeCount,
    route_total_analysed: totalRoutes,
    share_of_routes: round(c.shareOfRoutes, 2),
    median_travel_min: round(c.medianTravelSeconds / 60, 1),
    fastest_travel_min: round(c.fastestTravelSeconds / 60, 1),
    bottleneck_width_m: round(c.bottleneckWidthM),
    bottleneck_abreast: c.bottleneckAbreast,
    frontage: c.frontage,
    go_fraction: round(c.goFraction, 2),
    slow_go_fraction: round(c.slowGoFraction, 2),
    no_go_fraction: round(c.noGoFraction, 2),
    cell_count: c.cells.length,
    estimated_data: c.usedEstimatedData,
  };
}

function chokepointProperties(cp: ChokepointCell, totalRoutes: number) {
  return {
    kind: 'chokepoint',
    pass_count: cp.passCount,
    route_total_analysed: totalRoutes,
  };
}

function barrierProperties(barrier: MinCutResult, segmentIndex: number) {
  return {
    kind: 'min_cut_barrier_segment',
    segment: segmentIndex + 1,
    segment_count: barrier.segments.length,
    // Informational total for the WHOLE cut, repeated per segment so a GIS
    // user filtering to one segment still sees the cut it belongs to.
    cut_value_total: round(barrier.cutValue),
  };
}

function placementProperties(
  p: CounterMeasurePlacement,
  measure: CounterMeasure | undefined,
  ledgerEntry: DelayLedgerEntry | undefined
) {
  return {
    kind: 'counter_measure_placement',
    measure_id: p.measureId,
    measure_label: measure?.label ?? p.measureId,
    measure_effect: measure?.effect ?? null,
    measure_geometry: measure?.geometry ?? null,
    measure_confidence: measure?.confidence ?? null,
    measure_source: measure?.source ?? null,
    ledger_status: ledgerEntry ? 'scored' : 'not_scored',
    delay_imposed_min: ledgerEntry ? round(ledgerEntry.delayImposedSeconds / 60, 1) : null,
    bypass_delay_min:
      ledgerEntry?.bypassDelaySeconds != null ? round(ledgerEntry.bypassDelaySeconds / 60, 1) : null,
    egress_safe: ledgerEntry?.egressSafe ?? null,
    egress_warning: ledgerEntry?.egressWarning ?? null,
    objective_unreachable: ledgerEntry?.objectiveUnreachable ?? null,
  };
}

// --- GeoJSON -----------------------------------------------------------------

export function toMobilityGeoJSON(input: ExportMobilityInput): string {
  const totalRoutes = input.corridorField?.routes.length ?? 0;
  const features: any[] = [
    // Mission-level metadata as a geometry-less Feature (valid per RFC 7946
    // §3.2) rather than a nonstandard top-level property — every consumer of
    // this file can read it the same way it reads any other Feature.
    { type: 'Feature', properties: missionProperties(input), geometry: null },
  ];

  for (const c of input.corridorField?.corridors ?? []) {
    features.push({
      type: 'Feature',
      properties: corridorProperties(c, totalRoutes),
      geometry: { type: 'MultiPolygon', coordinates: c.cells.map(cell => [ringCoords(cell.polygon)]) },
    });
  }

  for (const cp of input.chokepoints) {
    features.push({
      type: 'Feature',
      properties: chokepointProperties(cp, totalRoutes),
      geometry: { type: 'Polygon', coordinates: [ringCoords(cp.polygon)] },
    });
  }

  if (input.barrier) {
    input.barrier.segments.forEach((seg, i) => {
      features.push({
        type: 'Feature',
        properties: barrierProperties(input.barrier!, i),
        geometry: { type: 'LineString', coordinates: ringCoords([seg.from, seg.to]) },
      });
    });
  }

  if (input.placements.length > 0) {
    const cellsByKey = new Map(input.cells.map(c => [c.key, c]));
    const measuresById = new Map(input.measures.map(m => [m.id, m]));
    const ledgerByMeasureId = new Map((input.ledger ?? []).map(e => [e.measure.id, e]));
    for (const p of input.placements) {
      const from = cellsByKey.get(p.segmentFromKey);
      const to = cellsByKey.get(p.segmentToKey);
      if (!from || !to) continue; // stale key against a different grid — never invent a location
      features.push({
        type: 'Feature',
        properties: placementProperties(p, measuresById.get(p.measureId), ledgerByMeasureId.get(p.measureId)),
        geometry: { type: 'LineString', coordinates: ringCoords([from.center, to.center]) },
      });
    }
  }

  return JSON.stringify({ type: 'FeatureCollection', features }, null, 2);
}

// --- KML / KMZ ---------------------------------------------------------------

const CORRIDOR_PALETTE = ['#ff6b35', '#2ec4b6', '#e71d36', '#ffbf47', '#8338ec', '#3a86ff'];
const corridorStyleId = (rank: number): string => `corridor-${rank}`;

export function toMobilityKML(input: ExportMobilityInput): string {
  const totalRoutes = input.corridorField?.routes.length ?? 0;
  const mission = missionProperties(input);

  const missionDescription = `<![CDATA[
    <h3>${xmlEscape(mission.name)}</h3>
    <p>Mover: <b>${xmlEscape(mission.mover_profile)}</b> (${xmlEscape(mission.mover_profile_confidence)} confidence)${mission.night_mode ? ' · Night' : ''}</p>
    ${mission.estimated_data_present ? '<p><b>⚠️ ESTIMATED DATA:</b> parts of this appreciation used non-authoritative fallback data. Verify on the ground.</p>' : ''}
    <p><b>⚠️ Rapid appreciation, not a tasking.</b> ${xmlEscape(DISCLAIMER_LONG)}</p>
    <p><small>${xmlEscape(provenanceStamp())}</small></p>
  ]]>`;

  const corridors = input.corridorField?.corridors ?? [];
  const corridorStyles = corridors
    .map(c => `
    <Style id="${corridorStyleId(c.rank)}">
      <PolyStyle><color>${kmlColor(CORRIDOR_PALETTE[(c.rank - 1) % CORRIDOR_PALETTE.length], '99')}</color><outline>0</outline></PolyStyle>
    </Style>`).join('');

  const corridorPlacemarks = corridors.map(c => {
    const p = corridorProperties(c, totalRoutes);
    const polys = c.cells
      .map(cell => `<Polygon><outerBoundaryIs><LinearRing><coordinates>${kmlCoords(cell.polygon)}</coordinates></LinearRing></outerBoundaryIs></Polygon>`)
      .join('');
    return `
      <Placemark>
        <name>Corridor ${p.rank} — ${xmlEscape(p.ease_class)} (${p.route_count}/${p.route_total_analysed} routes)</name>
        <styleUrl>#${corridorStyleId(c.rank)}</styleUrl>
        <description><![CDATA[
          <p>Median ${p.median_travel_min} min · Bottleneck ~${p.bottleneck_width_m} m (${p.bottleneck_abreast} abreast, ${xmlEscape(String(p.frontage))})</p>
          <p>GO ${Math.round((p.go_fraction ?? 0) * 100)}% · SLOW-GO ${Math.round((p.slow_go_fraction ?? 0) * 100)}% · NO-GO ${Math.round((p.no_go_fraction ?? 0) * 100)}%</p>
          ${p.estimated_data ? '<p><b>⚠️ Estimated data present in this corridor.</b></p>' : ''}
        ]]></description>
        <MultiGeometry>${polys}</MultiGeometry>
      </Placemark>`;
  }).join('');

  const chokepointPlacemarks = input.chokepoints.map(cp => {
    const p = chokepointProperties(cp, totalRoutes);
    return `
      <Placemark>
        <name>Chokepoint — ${p.pass_count}/${p.route_total_analysed} routes</name>
        <Style>
          <PolyStyle><color>${kmlColor('#e71d36', 'aa')}</color></PolyStyle>
          <LineStyle><color>${kmlColor('#e71d36')}</color><width>2</width></LineStyle>
        </Style>
        <Polygon><outerBoundaryIs><LinearRing><coordinates>${kmlCoords(cp.polygon)}</coordinates></LinearRing></outerBoundaryIs></Polygon>
      </Placemark>`;
  }).join('');

  const barrierPlacemarks = input.barrier
    ? input.barrier.segments.map((seg, i) => `
      <Placemark>
        <name>Min-cut barrier segment ${i + 1}</name>
        <Style><LineStyle><color>${kmlColor('#ff2222')}</color><width>4</width></LineStyle></Style>
        <description>Cut value ${round(input.barrier!.cutValue)} (unit/trail-weighted, not vehicle capacity)</description>
        <LineString><tessellate>1</tessellate><coordinates>${kmlCoords([seg.from, seg.to])}</coordinates></LineString>
      </Placemark>`).join('')
    : '';

  const cellsByKey = new Map(input.cells.map(c => [c.key, c]));
  const measuresById = new Map(input.measures.map(m => [m.id, m]));
  const ledgerByMeasureId = new Map((input.ledger ?? []).map(e => [e.measure.id, e]));
  const placementPlacemarks = input.placements.map(p => {
    const from = cellsByKey.get(p.segmentFromKey);
    const to = cellsByKey.get(p.segmentToKey);
    if (!from || !to) return '';
    const measure = measuresById.get(p.measureId);
    const entry = ledgerByMeasureId.get(p.measureId);
    const props = placementProperties(p, measure, entry);
    return `
      <Placemark>
        <name>${xmlEscape(measure?.label ?? p.measureId)}</name>
        <Style><LineStyle><color>${kmlColor('#ffbf47')}</color><width>5</width></LineStyle></Style>
        <description><![CDATA[
          <p>${xmlEscape(String(props.measure_effect ?? ''))} · ${xmlEscape(String(props.measure_confidence ?? ''))} confidence</p>
          ${entry
            ? `<p>Delay imposed: <b>${props.delay_imposed_min} min</b> · Bypass delay: <b>${props.bypass_delay_min ?? '—'} min</b></p>
               ${entry.egressSafe ? '' : `<p><b>⚠️ EGRESS UNSAFE:</b> ${xmlEscape(entry.egressWarning ?? '')}</p>`}`
            : '<p><i>Not yet scored against the delay ledger.</i></p>'}
        ]]></description>
        <LineString><tessellate>1</tessellate><coordinates>${kmlCoords([from.center, to.center])}</coordinates></LineString>
      </Placemark>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${xmlEscape(mission.name)}</name>
    <description>${missionDescription}</description>
    ${corridorStyles}
    <Folder><name>Movement corridors</name>${corridorPlacemarks}</Folder>
    <Folder><name>Chokepoints</name>${chokepointPlacemarks}</Folder>
    <Folder><name>Min-cut barrier</name>${barrierPlacemarks}</Folder>
    <Folder><name>Counter-measure placements</name>${placementPlacemarks}</Folder>
  </Document>
</kml>`;
}

/** KMZ = zipped KML (doc.kml at archive root), same as gisExport.ts's toKMZ. */
export async function toMobilityKMZ(input: ExportMobilityInput): Promise<Blob> {
  const { zipSync, strToU8 } = await import('fflate');
  const kml = toMobilityKML(input);
  const zipped = zipSync({ 'doc.kml': strToU8(kml) });
  return new Blob([zipped as unknown as BlobPart], { type: 'application/vnd.google-earth.kmz' });
}

export const mobilityExportFilename = (ext: string): string =>
  `terrain-mobility-${new Date().toISOString().slice(0, 10)}.${ext}`;
