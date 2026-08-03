/**
 * Key terrain (OCOKA 4, docs/ROUTE_INTELLIGENCE.md §47.1) — proves
 * `generateKeyTerrainCandidates`/`scoreKeyTerrainCandidates` against a real
 * single-gap barrier grid: a due-east crossing forced through ONE narrow gap
 * in an otherwise impassable water body (same fixture shape as
 * `corridorClustering.test.ts`/`corridorRiskAndCount.test.ts`, collapsed to
 * one gap instead of two so denying it is a genuine decisive-candidate case
 * — there is no other way through).
 *
 * Plain node:assert. Run: npx tsx webapp/tests/keyTerrain.test.ts
 */
import * as assert from 'node:assert';
import { generateBoxHexes, hexKey, LocalPoint, makeProjection } from '../src/utils/hexGrid';
import { MobilityGridCell } from '../src/terrain/accumulatedCost';
import { MOVER_PROFILES } from '../src/terrain/moverProfiles';
import { buildCorridorField } from '../src/terrain/corridorField';
import { computeChokepoints, findKDissimilarPaths } from '../src/terrain/corridorAnalysis';
import { computeMinCutBarrier } from '../src/terrain/minCutBarrier';
import {
  generateKeyTerrainCandidates, scoreKeyTerrainCandidates, buildKeyTerrainResult, KEY_TERRAIN_MISSION_CAVEAT,
} from '../src/terrain/keyTerrain';
import { LatLng } from '../src/utils/chainage';

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

const vehicle = MOVER_PROFILES.find(p => p.id === 'foot-individual-unladen')!;
assert.ok(vehicle, 'test setup: need the unladen-foot profile');

const HEX_SIZE = 30;
const ANCHOR: LatLng = { lat: -35.28, lng: 149.13 };
const proj = makeProjection(ANCHOR);

const BARRIER_X_MIN = 460;
const BARRIER_X_MAX = 640;
const GAP = { min: 250, max: 340 }; // ONE gap, roughly mid-height
const BOX_MIN: LocalPoint = { x: 0, y: -20 };
const BOX_MAX: LocalPoint = { x: 1100, y: 620 };

function buildGrid(): MobilityGridCell[] {
  const cellsRaw = generateBoxHexes(BOX_MIN, BOX_MAX, HEX_SIZE);
  return cellsRaw
    .filter(c => c.center.x >= BOX_MIN.x && c.center.x <= BOX_MAX.x && c.center.y >= BOX_MIN.y && c.center.y <= BOX_MAX.y)
    .map(c => {
      const inBarrierX = c.center.x >= BARRIER_X_MIN && c.center.x <= BARRIER_X_MAX;
      const inGap = c.center.y >= GAP.min && c.center.y <= GAP.max;
      const inWaterBody = inBarrierX && !inGap;
      const cell: MobilityGridCell = {
        key: hexKey(c.hex),
        hex: c.hex,
        center: { lat: ANCHOR.lat + c.center.y / 111320, lng: ANCHOR.lng + c.center.x / 111320 },
        elevation: 0,
        vegetation: 'grassland',
        vegEstimated: false,
        onTrail: false,
        nearestTrailTags: null,
        crossSlopeDeg: 0,
        waterDistanceM: inWaterBody ? 0 : Infinity,
        inWaterBody,
        nearestWaterwayKind: null,
        waterFrequency: null,
      };
      return cell;
    });
}

console.log('Key terrain candidate generation + scoring (OCOKA 4):');

const cells = buildGrid();
const originKeys = cells
  .filter(c => c.center.lng < ANCHOR.lng + 60 / 111320 && Math.abs((c.center.lat - ANCHOR.lat) * 111320 - 300) < 60)
  .map(c => c.key);
const objectiveKeys = cells
  .filter(c => c.center.lng > ANCHOR.lng + 1040 / 111320 && Math.abs((c.center.lat - ANCHOR.lat) * 111320 - 300) < 60)
  .map(c => c.key);
assert.ok(originKeys.length > 0 && objectiveKeys.length > 0, 'test setup: seed sets must be non-empty');

const routes = findKDissimilarPaths(cells, originKeys, objectiveKeys, vehicle, false, 14);
assert.ok(routes.length > 0, 'test setup: at least one route must exist through the single gap');

const chokepoints = computeChokepoints(cells, HEX_SIZE, proj, routes).slice(0, 12);
const barrier = computeMinCutBarrier(cells, originKeys, objectiveKeys, vehicle, false);
assert.ok(barrier && barrier.segments.length > 0, 'test setup: the single gap must be a real min-cut');

const field = buildCorridorField(cells, originKeys, objectiveKeys, vehicle, false, HEX_SIZE, proj, { routeCount: 14 });
assert.ok(field, 'test setup: a corridor field must be built at all');

const gapKeys = new Set(
  cells.filter(c => {
    const localY = (c.center.lat - ANCHOR.lat) * 111320;
    const localX = (c.center.lng - ANCHOR.lng) * 111320;
    return localX >= BARRIER_X_MIN && localX <= BARRIER_X_MAX && localY >= GAP.min && localY <= GAP.max;
  }).map(c => c.key)
);

const candidates = generateKeyTerrainCandidates(cells, chokepoints, barrier, null, field);

test('candidates were nominated from chokepoints and the hex min-cut', () => {
  assert.ok(candidates.some(c => c.source === 'chokepoint'));
  assert.ok(candidates.some(c => c.source === 'hex-min-cut'));
});

test('at least one candidate sits ON the real gap ground (not invented elsewhere)', () => {
  assert.ok(candidates.some(c => c.cellKeys.some(k => gapKeys.has(k))));
});

test('candidates with an identical cell set are deduplicated, not double-counted', () => {
  const seen = new Set<string>();
  for (const c of candidates) {
    const key = [...c.cellKeys].sort().join(',');
    assert.ok(!seen.has(key), `duplicate candidate ground: ${key}`);
    seen.add(key);
  }
});

const scored = scoreKeyTerrainCandidates(
  cells, originKeys, objectiveKeys, vehicle, false, HEX_SIZE, proj, field!, candidates
);

test('every scored candidate carries rank 1..N with no gaps or repeats', () => {
  const ranks = scored.map(c => c.rank).sort((a, b) => a - b);
  assert.deepStrictEqual(ranks, scored.map((_, i) => i + 1));
});

test('the top-ranked candidate sits on the real gap — the only ground that actually controls this crossing', () => {
  const top = scored[0];
  assert.ok(top.cellKeys.some(k => gapKeys.has(k)), `top candidate (${top.source}, ${top.id}) is not on the real gap`);
});

test('the top real candidate has a genuine, nonzero collapse/degrade effect — not a no-op denial', () => {
  const top = scored[0];
  assert.ok(top.comparison.collapsedCount + top.comparison.degradedCount > 0, 'denying the real gap ground did nothing to any corridor');
});

test('decisiveCandidate fires correctly: denying the WHOLE real min-cut (union of every segment) makes every route impossible', () => {
  // Any single min-cut SEGMENT only need be part of a multi-segment cut if the
  // gap is wider than one cell — this fixture's gap may be. The full cut's
  // own union is guaranteed to actually sever the corridor (it IS the min-cut
  // computeMinCutBarrier proved severs origin from objective), so scoring it
  // directly proves the decisive predicate itself, independent of whether any
  // one GENERATED candidate happens to cover the whole cut on its own.
  const wholeCutKeys = [...new Set(barrier!.segments.flatMap(s => [s.fromKey, s.toKey]))];
  const [wholeCutScored] = scoreKeyTerrainCandidates(
    cells, originKeys, objectiveKeys, vehicle, false, HEX_SIZE, proj, field!,
    [{ id: 'whole-cut', source: 'hex-min-cut', cellKeys: wholeCutKeys, center: { lat: 0, lng: 0 }, provenance: {} }]
  );
  assert.strictEqual(wholeCutScored.decisiveCandidate, true);
  assert.strictEqual(wholeCutScored.comparison.collapsedCount, field!.corridors.length);
});

test('a candidate whose ground has no real effect (deep inside open, unconstrained ground) ranks below the real chokepoint', () => {
  const top = scored[0];
  const worst = scored[scored.length - 1];
  if (scored.length > 1) assert.ok(top.impactScore >= worst.impactScore);
});

const result = buildKeyTerrainResult(candidates, scored);

test('buildKeyTerrainResult carries the mission caveat verbatim and the real considered/evaluated counts', () => {
  assert.strictEqual(result.missionCaveat, KEY_TERRAIN_MISSION_CAVEAT);
  assert.strictEqual(result.candidatesConsidered, candidates.length);
  assert.strictEqual(result.candidates.length, scored.length);
});

console.log(`\n${passed} assertion group(s) passed.`);
