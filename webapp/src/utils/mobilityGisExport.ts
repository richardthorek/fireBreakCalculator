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
 *  - Road-network min-cut barrier → one LineString Feature per severing ROAD
 *    segment (OCOKA 3, docs/ROUTE_INTELLIGENCE.md §47) — the road-network-exact
 *    sibling of the hex min-cut above, resolution-matched to the real road
 *    graph edge rather than a hex-cell boundary. Carries the OSM way name
 *    where known, since this cut runs directly over named road geometry.
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
import { MinCutResult, RoadMinCutResult } from '../terrain/minCutBarrier';
import { MoverProfile } from '../terrain/moverProfiles';
import { MobilityGridCell } from '../terrain/accumulatedCost';
import { CounterMeasurePlacement, DelayLedgerEntry } from '../terrain/delayLedger';
import { CounterMeasure } from '../terrain/counterMeasures';
import { carriesWaterSignal } from '../terrain/mobilityAppreciation';
import { RoadSpeedOverrides, countActiveRoadSpeedOverrides } from '../terrain/roadSpeedModel';
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
  /** True when either hydrology source (OSM waterway/water-body geometry, DEA
   *  WOfS frequency, docs §34) returned real data for this AOI — false means
   *  the water-crossing gate had nothing to work from, stated rather than
   *  silently absent (mirrors `MobilityAppreciationResult.hydrologyAvailable`). */
  hydrologyAvailable: boolean;
  /** User-edited road-class speeds (docs §35 config UI, step 21) — visibly
   *  flagged in the panel/run log already; this is what carries that same
   *  flag into export attributes, matching how hydrology already behaves.
   *  `null`/empty means no overrides were configured for this run. */
  roadSpeedOverrides: RoadSpeedOverrides | null;
  corridorField: CorridorField | null;
  chokepoints: ChokepointCell[];
  barrier: MinCutResult | null;
  /** OCOKA 3 (docs/ROUTE_INTELLIGENCE.md §47) — the road-network-exact min-cut,
   *  vehicle profiles only (see `computeRoadNetworkMinCut`). Null under the
   *  same conditions `barrier` is: no separating cut for this profile/AOI. */
  roadNetworkBarrier: RoadMinCutResult | null;
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

function hydrologySummary(cells: MobilityGridCell[]) {
  const waterAffectedCellCount = cells.filter(carriesWaterSignal).length;
  const waterBodyCellCount = cells.filter(c => c.inWaterBody).length;
  return { waterAffectedCellCount, waterBodyCellCount };
}

function missionProperties(input: ExportMobilityInput) {
  const { waterAffectedCellCount, waterBodyCellCount } = hydrologySummary(input.cells);
  const roadSpeedOverrideCount = countActiveRoadSpeedOverrides(input.roadSpeedOverrides);
  return {
    kind: 'terrain_mobility_appreciation',
    name: input.name || 'Terrain mobility appreciation',
    // schema_version 2 (OCOKA 1, docs/ROUTE_INTELLIGENCE.md §47): mobility-class
    // fields below are dual-emitted — both the current MCOO vocabulary and the
    // legacy `go_fraction`/`slow_go_fraction`/`no_go_fraction`/`ease_class`
    // values, for one release, since a saved external symbology may key off
    // the attribute names. See docs/ROUTE_INTELLIGENCE.md §29 addendum / §47.6.
    schema_version: 2,
    ...provenanceProperties(),
    mover_profile: input.profile.label,
    mover_profile_confidence: input.profile.confidence,
    night_mode: input.nightMode,
    estimated_data_present: input.usedEstimatedData,
    hydrology_available: input.hydrologyAvailable,
    water_affected_cell_count: waterAffectedCellCount,
    water_body_cell_count: waterBodyCellCount,
    // Road-speed override confidence (general queue item, docs §35 step 21) —
    // carries the SAME flag the panel already shows live into the export
    // attributes, matching how hydrology already behaves here.
    road_speed_overrides_active: roadSpeedOverrideCount > 0,
    road_speed_override_count: roadSpeedOverrideCount,
  };
}

function corridorProperties(
  c: Corridor,
  totalRoutes: number,
  evidence: string,
  cellsByKey: Map<string, MobilityGridCell>
) {
  const corridorCells = c.cells.map(cc => cellsByKey.get(cc.key)).filter((cc): cc is MobilityGridCell => !!cc);
  const waterCellCount = corridorCells.filter(carriesWaterSignal).length;
  return {
    kind: 'movement_corridor',
    rank: c.rank,
    // mobility_class is the current field (OCOKA 1, docs/ROUTE_INTELLIGENCE.md
    // §47); ease_class kept alongside it for one release — same value, legacy
    // key, since a saved external symbology may key off the attribute name.
    mobility_class: c.easeClass,
    ease_class: c.easeClass,
    // What the counts below are counts OF. Since 2026-07-27 corridors are
    // normally derived from a simulated movement ensemble, so `route_count` is
    // a count of SIMULATED MOVERS under a behaviour model with assumed
    // parameters — not a count of computed optimal routes. A consumer opening
    // this file in QGIS has no other way to know which it is, and the
    // difference changes what the number means, so it travels with the data.
    evidence,
    evidence_note: evidence === 'simulated-movers'
      ? 'Counts are simulated movers from a behaviour model with assumed parameters, not measured traffic.'
      : 'Counts are computed cheapest-path routes assuming perfect knowledge of the terrain.',
    route_count: c.routeCount,
    route_total_analysed: totalRoutes,
    share_of_routes: round(c.shareOfRoutes, 2),
    median_travel_min: round(c.medianTravelSeconds / 60, 1),
    fastest_travel_min: round(c.fastestTravelSeconds / 60, 1),
    bottleneck_width_m: round(c.bottleneckWidthM),
    bottleneck_abreast: c.bottleneckAbreast,
    frontage: c.frontage,
    // Current field names; the three go_/slow_go_/no_go_ keys below are the
    // same values under the superseded names, kept for one release.
    unrestricted_fraction: round(c.unrestrictedFraction, 2),
    restricted_fraction: round(c.restrictedFraction, 2),
    severely_restricted_fraction: round(c.severelyRestrictedFraction, 2),
    go_fraction: round(c.unrestrictedFraction, 2),
    slow_go_fraction: round(c.restrictedFraction, 2),
    no_go_fraction: round(c.severelyRestrictedFraction, 2),
    cell_count: c.cells.length,
    estimated_data: c.usedEstimatedData,
    // Water crossing (docs §34): a corridor with ANY water-affected cells
    // may route through a fordable stretch or hug a bank — a GIS user
    // planning a physical route through it should know before scouting.
    crosses_water: waterCellCount > 0,
    water_cell_count: waterCellCount,
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

function roadBarrierProperties(barrier: RoadMinCutResult, segmentIndex: number) {
  const seg = barrier.segments[segmentIndex];
  return {
    kind: 'road_network_min_cut_segment',
    segment: segmentIndex + 1,
    segment_count: barrier.segments.length,
    // Informational total for the WHOLE cut, repeated per segment so a GIS
    // user filtering to one segment still sees the cut it belongs to.
    cut_value_total: round(barrier.cutValue),
    // Real OSM way name where known — the hex barrier has no equivalent
    // since it cuts hex-cell edges, not named road geometry.
    way_name: seg.wayName ?? null,
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
  const corridorEvidence = input.corridorField?.evidence ?? 'optimiser-routes';
  const cellsByKey = new Map(input.cells.map(c => [c.key, c]));
  const features: any[] = [
    // Mission-level metadata as a geometry-less Feature (valid per RFC 7946
    // §3.2) rather than a nonstandard top-level property — every consumer of
    // this file can read it the same way it reads any other Feature.
    { type: 'Feature', properties: missionProperties(input), geometry: null },
  ];

  for (const c of input.corridorField?.corridors ?? []) {
    features.push({
      type: 'Feature',
      properties: corridorProperties(c, totalRoutes, corridorEvidence, cellsByKey),
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

  if (input.roadNetworkBarrier) {
    input.roadNetworkBarrier.segments.forEach((seg, i) => {
      features.push({
        type: 'Feature',
        properties: roadBarrierProperties(input.roadNetworkBarrier!, i),
        geometry: { type: 'LineString', coordinates: ringCoords([seg.from, seg.to]) },
      });
    });
  }

  if (input.placements.length > 0) {
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
  const corridorEvidence = input.corridorField?.evidence ?? 'optimiser-routes';
  const cellsByKey = new Map(input.cells.map(c => [c.key, c]));
  const mission = missionProperties(input);

  const missionDescription = `<![CDATA[
    <h3>${xmlEscape(mission.name)}</h3>
    <p>Mover: <b>${xmlEscape(mission.mover_profile)}</b> (${xmlEscape(mission.mover_profile_confidence)} confidence)${mission.night_mode ? ' · Night' : ''}</p>
    ${mission.estimated_data_present ? '<p><b>⚠️ ESTIMATED DATA:</b> parts of this appreciation used non-authoritative fallback data. Verify on the ground.</p>' : ''}
    ${!mission.hydrology_available ? '<p><b>⚠️ NO HYDROLOGY DATA:</b> no waterway/water-body data was available for this area — the water-crossing gate had nothing to check against.</p>'
      : mission.water_affected_cell_count > 0
        ? `<p>Hydrology: ${mission.water_affected_cell_count} cell(s) carry a water signal (${mission.water_body_cell_count} standing water body) — routes account for this as a hard block where fording capability is insufficient.</p>`
        : ''}
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
    const p = corridorProperties(c, totalRoutes, corridorEvidence, cellsByKey);
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
          ${p.crosses_water ? `<p><b>💧 Water crossing:</b> ${p.water_cell_count} cell(s) in this corridor carry a water signal.</p>` : ''}
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

  const roadBarrierPlacemarks = input.roadNetworkBarrier
    ? input.roadNetworkBarrier.segments.map((seg, i) => `
      <Placemark>
        <name>Road-network min-cut segment ${i + 1}${seg.wayName ? ` — ${xmlEscape(seg.wayName)}` : ''}</name>
        <Style><LineStyle><color>${kmlColor('#7C3AED')}</color><width>4</width></LineStyle></Style>
        <description>${seg.wayName ? `${xmlEscape(seg.wayName)} · ` : ''}Cut value ${round(input.roadNetworkBarrier!.cutValue)} (unit/trail-weighted, not vehicle capacity)</description>
        <LineString><tessellate>1</tessellate><coordinates>${kmlCoords([seg.from, seg.to])}</coordinates></LineString>
      </Placemark>`).join('')
    : '';

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
    <Folder><name>Road-network min-cut barrier</name>${roadBarrierPlacemarks}</Folder>
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
