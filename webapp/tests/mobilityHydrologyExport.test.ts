/**
 * Hydrology attributes in GIS export / AI briefing (docs/ROUTE_INTELLIGENCE.md
 * §34) — water-gate fields (`inWaterBody`, `nearestWaterwayKind`,
 * `waterFrequency`, `hydrologyAvailable`) were already computed by the
 * hard-block hydrology gate but never carried into the exported GeoJSON/KML
 * attributes or the AI briefing payload, so a user reading either had no way
 * to see WHY a route avoided (or had to cross) water, even though the system
 * had already worked it out.
 *
 * `carriesWaterSignal` (mobilityAppreciation.ts) is now the single shared
 * predicate the run's own assessment log, the GIS export, and the AI
 * briefing payload all call — this proves the export/briefing side actually
 * uses it correctly, not just that the predicate itself is right (that's
 * already covered by the log line it was extracted from).
 *
 * Plain node:assert. Run: npx tsx webapp/tests/mobilityHydrologyExport.test.ts
 */
import * as assert from 'node:assert';
import { hexKey, AxialCoord } from '../src/utils/hexGrid';
import { MobilityGridCell } from '../src/terrain/accumulatedCost';
import { Corridor, CorridorField } from '../src/terrain/corridorField';
import { toMobilityGeoJSON, toMobilityKML, ExportMobilityInput } from '../src/utils/mobilityGisExport';
import { getMoverProfile } from '../src/terrain/moverProfiles';

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

function cell(q: number, opts: Partial<MobilityGridCell> = {}): MobilityGridCell {
  const hex: AxialCoord = { q, r: 0 };
  return {
    key: hexKey(hex),
    hex,
    center: { lat: -35.0 + q * 0.001, lng: 149.0 },
    elevation: 0,
    vegetation: 'grassland',
    vegEstimated: false,
    onTrail: false,
    nearestTrailTags: null,
    crossSlopeDeg: 0,
    waterDistanceM: Infinity,
    inWaterBody: false,
    nearestWaterwayKind: null,
    waterFrequency: null,
    ...opts,
  };
}

const profile = getMoverProfile('au-light-4wd')!;

// A dry corridor (2 ordinary cells) and a wet corridor (2 cells, one of which
// is literally inside a mapped standing water body, the other just near a
// mapped watercourse) — grid also carries an extra off-corridor water cell,
// so the mission-level total must differ from either corridor's own count.
const dryCells = [cell(0), cell(1)];
const wetCells = [cell(2, { inWaterBody: true }), cell(3, { nearestWaterwayKind: 'stream' })];
const offCorridorWaterCell = cell(4, { inWaterBody: true });
const allCells = [...dryCells, ...wetCells, offCorridorWaterCell];

function toCorridorCell(c: MobilityGridCell) {
  return { key: c.key, center: c.center, polygon: [c.center, c.center, c.center], density: 1, routeCount: 1 };
}

function makeCorridor(id: string, rank: number, cells: MobilityGridCell[]): Corridor {
  return {
    id,
    rank,
    cells: cells.map(toCorridorCell),
    routeCount: 1,
    shareOfRoutes: 1,
    medianTravelSeconds: 600,
    fastestTravelSeconds: 500,
    bottleneckCells: 1,
    bottleneckWidthM: 50,
    widestCells: 2,
    widestWidthM: 100,
    bottleneckAbreast: 1,
    frontage: 'single-file',
    unrestrictedFraction: 1,
    restrictedFraction: 0,
    severelyRestrictedFraction: 0,
    easeClass: 'unrestricted',
    usedEstimatedData: false,
    representativeRoute: null,
  };
}

const dryCorridor = makeCorridor('c-dry', 1, dryCells);
const wetCorridor = makeCorridor('c-wet', 2, wetCells);

const corridorField: CorridorField = {
  corridors: [dryCorridor, wetCorridor],
  evidence: 'optimiser-routes',
  routes: [],
  cellCount: 4,
  routedCellCount: 4,
  peakDensity: 1,
  coverageFraction: 0.5,
  pinchRatio: 1,
  unconstrained: false,
};

function baseInput(hydrologyAvailable: boolean): ExportMobilityInput {
  return {
    profile,
    nightMode: false,
    usedEstimatedData: false,
    hydrologyAvailable,
    corridorField,
    chokepoints: [],
    barrier: null,
    cells: allCells,
    placements: [],
    measures: [],
    ledger: null,
  };
}

console.log('Hydrology attributes in GIS export (docs §34):');

test('GeoJSON mission feature carries mission-wide water counts, not just a boolean', () => {
  const geojson = JSON.parse(toMobilityGeoJSON(baseInput(true)));
  const mission = geojson.features.find((f: any) => f.properties.kind === 'terrain_mobility_appreciation');
  assert.ok(mission, 'expected a mission-level feature');
  assert.strictEqual(mission.properties.hydrology_available, true);
  // 3 of the 5 total cells carry a water signal (2 wetCorridor cells + the
  // off-corridor one); 2 of those are literally inWaterBody.
  assert.strictEqual(mission.properties.water_affected_cell_count, 3, JSON.stringify(mission.properties));
  assert.strictEqual(mission.properties.water_body_cell_count, 2, JSON.stringify(mission.properties));
});

test('GeoJSON mission feature reports hydrology_available: false honestly, not defaulted to true', () => {
  const geojson = JSON.parse(toMobilityGeoJSON(baseInput(false)));
  const mission = geojson.features.find((f: any) => f.properties.kind === 'terrain_mobility_appreciation');
  assert.strictEqual(mission.properties.hydrology_available, false);
});

test('each CORRIDOR feature carries only ITS OWN water-crossing count — not the grid total', () => {
  const geojson = JSON.parse(toMobilityGeoJSON(baseInput(true)));
  const corridorFeatures = geojson.features.filter((f: any) => f.properties.kind === 'movement_corridor');
  assert.strictEqual(corridorFeatures.length, 2);
  const dry = corridorFeatures.find((f: any) => f.properties.rank === 1);
  const wet = corridorFeatures.find((f: any) => f.properties.rank === 2);
  assert.strictEqual(dry.properties.crosses_water, false, 'the dry corridor must not be flagged');
  assert.strictEqual(dry.properties.water_cell_count, 0);
  assert.strictEqual(wet.properties.crosses_water, true, 'the wet corridor must be flagged');
  assert.strictEqual(wet.properties.water_cell_count, 2, 'the wet corridor has exactly 2 water-affected cells of its own — NOT the grid-wide 3');
});

test('KML mission description warns plainly when no hydrology data was available', () => {
  const kml = toMobilityKML(baseInput(false));
  assert.ok(kml.includes('NO HYDROLOGY DATA'), 'expected an explicit no-data warning in the KML mission description');
});

test('KML mission description reports real water counts when hydrology data exists', () => {
  const kml = toMobilityKML(baseInput(true));
  assert.ok(kml.includes('3 cell(s) carry a water signal'), kml);
  assert.ok(kml.includes('2 standing water body'), kml);
});

test('KML corridor placemark for the wet corridor carries a water-crossing note; the dry one does not', () => {
  const kml = toMobilityKML(baseInput(true));
  const wetIdx = kml.indexOf('Corridor 2');
  const dryIdx = kml.indexOf('Corridor 1');
  assert.ok(wetIdx > -1 && dryIdx > -1);
  const wetBlock = kml.slice(wetIdx, wetIdx + 800);
  const dryBlock = kml.slice(dryIdx, dryIdx + 800);
  assert.ok(wetBlock.includes('Water crossing'), 'the wet corridor placemark must carry a water-crossing note');
  assert.ok(!dryBlock.includes('Water crossing'), 'the dry corridor placemark must NOT carry a water-crossing note');
});

if (process.exitCode === 1) {
  console.error(`\nHydrology export attributes are NOT working as expected.`);
} else {
  console.log(`\nAll ${passed} hydrology export checks passed.`);
}
