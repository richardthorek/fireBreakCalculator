/**
 * WP2 (movement-analysis performance work) proof: `runAccumulatedCostSearch`/
 * `runCostToGoSearch` were rewritten to precompute a per-grid `CellIndex`
 * (`shared/terrain/src/cellIndex.ts`) once and search over flat
 * `TypedArray`/integer-index state instead of re-deriving hex neighbours,
 * `hexKey` strings, `toMobilitySample` objects and haversine distances on
 * every node pop, in every one of the ~120 full-grid passes a real Terrain
 * Mobility run performs (profiling audit — see cellIndex.ts's own header).
 *
 * The refactor is required to be a PURE MECHANICAL SPEEDUP: identical
 * neighbour iteration order, identical heap tie-break-by-insertion-order,
 * identical floating-point operation sequence in cost accumulation. This
 * test proves that by keeping a byte-for-byte copy of the PRE-REFACTOR
 * search functions below (same hexNeighbors/hexKey/toMobilitySample/
 * calculateDistance calls, same key-based MinHeap) as an independent
 * reference oracle, and asserting the CURRENT (refactored, package-exported)
 * implementation produces EXACTLY the same `best`/`prev` output — every key,
 * every value, bit-for-bit via `Object.is` — across a synthetic grid built to
 * exercise every real cost gate (climb slope, cross/side slope, vegetation
 * gap-width, fording, onTrail exemptions), plus a `resumeFrom` case and a
 * fully-unreachable-objective case.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/searchCoreEquivalence.test.ts
 */
import * as assert from 'node:assert';
import {
  generateBoxHexes, hexKey, hexNeighbors, LocalPoint, MobilityGridCell, MoverProfile, MOVER_PROFILES,
  toMobilitySample, edgeMobilityCost, LatLng, calculateDistance,
  runAccumulatedCostSearch, runCostToGoSearch, extractPath,
  AccumulatedCostSearchResult, AccumulatedCostSearchOptions,
} from '@firebreak/terrain';
import { VegetationType } from '@firebreak/terrain';

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

// ---------------------------------------------------------------------------
// REFERENCE ORACLE — a verbatim copy of the PRE-REFACTOR search functions
// (same Map<string,...> lookups, same hexNeighbors()/hexKey() per node pop,
// same toMobilitySample() per edge, same key-based MinHeap). Kept entirely
// independent of accumulatedCost.ts/cellIndex.ts so this test cannot pass by
// accident (e.g. both sides sharing a bug the refactor introduced).
// ---------------------------------------------------------------------------

class RefMinHeap {
  private items: { key: string; priority: number }[] = [];
  get size(): number { return this.items.length; }
  push(key: string, priority: number): void {
    this.items.push({ key, priority });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].priority <= this.items[i].priority) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }
  pop(): { key: string; priority: number } | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      const n = this.items.length;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let smallest = i;
        if (l < n && this.items[l].priority < this.items[smallest].priority) smallest = l;
        if (r < n && this.items[r].priority < this.items[smallest].priority) smallest = r;
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

function refRunAccumulatedCostSearch(
  cells: MobilityGridCell[],
  originKeys: string[],
  profile: MoverProfile,
  nightMode: boolean,
  options: AccumulatedCostSearchOptions = {}
): AccumulatedCostSearchResult {
  const { edgePenalties, onProgress, resumeFrom } = options;
  const byKey = new Map<string, MobilityGridCell>();
  for (const c of cells) byKey.set(c.key, c);
  const totalCells = Math.max(1, cells.length);

  const best = new Map<string, { timeSeconds: number; estimated: boolean }>();
  const prev = new Map<string, string>();
  const heap = new RefMinHeap();
  if (resumeFrom) {
    for (const [key, v] of resumeFrom.best) best.set(key, v);
    for (const [key, p] of resumeFrom.prev) prev.set(key, p);
    for (const [key, v] of best) {
      if (byKey.has(key)) heap.push(key, v.timeSeconds);
    }
  } else {
    for (const key of originKeys) {
      if (!byKey.has(key)) continue;
      best.set(key, { timeSeconds: 0, estimated: false });
      heap.push(key, 0);
    }
  }

  while (heap.size > 0) {
    const cur = heap.pop()!;
    const known = best.get(cur.key);
    if (!known || cur.priority > known.timeSeconds) continue;
    const cell = byKey.get(cur.key);
    if (!cell) continue;
    onProgress?.(Math.min(1, best.size / totalCells));

    for (const nHex of hexNeighbors(cell.hex)) {
      const nKey = hexKey(nHex);
      const neighbor = byKey.get(nKey);
      if (!neighbor) continue;
      const dist = calculateDistance(cell.center.lat, cell.center.lng, neighbor.center.lat, neighbor.center.lng);
      const sampleA = toMobilitySample(cell);
      const sampleB = toMobilitySample(neighbor);
      const result = edgeMobilityCost(profile, sampleA, sampleB, dist, { nightMode, crossSlopeDeg: cell.crossSlopeDeg });
      if (!isFinite(result.timeSeconds)) continue;
      const penalty = edgePenalties?.get(`${cur.key}|${nKey}`) ?? 1;
      const candidateTime = known.timeSeconds + result.timeSeconds * penalty;
      const existing = best.get(nKey);
      if (!existing || candidateTime < existing.timeSeconds) {
        const estimated = known.estimated || result.estimated;
        best.set(nKey, { timeSeconds: candidateTime, estimated });
        prev.set(nKey, cur.key);
        heap.push(nKey, candidateTime);
      }
    }
  }

  return { best, prev };
}

function refRunCostToGoSearch(
  cells: MobilityGridCell[],
  objectiveKeys: string[],
  profile: MoverProfile,
  nightMode: boolean,
  blockedEdges?: Set<string>
): Map<string, number> {
  const byKey = new Map<string, MobilityGridCell>();
  for (const c of cells) byKey.set(c.key, c);

  const best = new Map<string, number>();
  const heap = new RefMinHeap();
  for (const key of objectiveKeys) {
    if (!byKey.has(key)) continue;
    best.set(key, 0);
    heap.push(key, 0);
  }

  while (heap.size > 0) {
    const cur = heap.pop()!;
    const known = best.get(cur.key);
    if (known === undefined || cur.priority > known) continue;
    const cell = byKey.get(cur.key);
    if (!cell) continue;

    for (const nHex of hexNeighbors(cell.hex)) {
      const nKey = hexKey(nHex);
      const neighbor = byKey.get(nKey);
      if (!neighbor) continue;
      const dist = calculateDistance(neighbor.center.lat, neighbor.center.lng, cell.center.lat, cell.center.lng);
      const sampleFrom = toMobilitySample(neighbor);
      const sampleTo = toMobilitySample(cell);
      if (blockedEdges?.has(`${nKey}|${cur.key}`)) continue;
      const result = edgeMobilityCost(profile, sampleFrom, sampleTo, dist, { nightMode, crossSlopeDeg: neighbor.crossSlopeDeg });
      if (!isFinite(result.timeSeconds)) continue;
      const candidate = known + result.timeSeconds;
      const existing = best.get(nKey);
      if (existing === undefined || candidate < existing) {
        best.set(nKey, candidate);
        heap.push(nKey, candidate);
      }
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Synthetic grid — deterministic (no Math.random), varies elevation
// (climb + cross-slope gates), vegetation (gap-width gate), a water barrier
// with a gap (fording gate + genuine unreachability), and an onTrail band
// (the exemptions every gate above carries for mapped road/trail).
// ---------------------------------------------------------------------------

const VEG_CYCLE: VegetationType[] = ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'];
const HEX_SIZE = 25;
const ANCHOR: LatLng = { lat: -35.31, lng: 149.08 };

const WATER_X_MIN = 480, WATER_X_MAX = 520;
const WATER_GAP_Y_MIN = 180, WATER_GAP_Y_MAX = 260;
const TRAIL_Y_MIN = -30, TRAIL_Y_MAX = 30;

function buildComplexGrid(minPt: LocalPoint, maxPt: LocalPoint): MobilityGridCell[] {
  return generateBoxHexes(minPt, maxPt, HEX_SIZE)
    .filter(c => c.center.x >= minPt.x && c.center.x <= maxPt.x && c.center.y >= minPt.y && c.center.y <= maxPt.y)
    .map(c => {
      const { q, r } = c.hex;
      // Smooth-ish but genuinely varying elevation field — deterministic
      // function of position, exercises both climb-slope and (via the local
      // plane-fit proxy below) cross-slope gates for the vehicle profile.
      const elevation = 40 * Math.sin(c.center.x / 140) + 25 * Math.cos(c.center.y / 110) + (c.center.x + c.center.y) * 0.02;
      const vegetation = VEG_CYCLE[((q % 4) + 4 + r) % 4];
      const vegEstimated = (q + r) % 3 === 0;
      const inBarrierX = c.center.x >= WATER_X_MIN && c.center.x <= WATER_X_MAX;
      const inGapY = c.center.y >= WATER_GAP_Y_MIN && c.center.y <= WATER_GAP_Y_MAX;
      const inWaterBody = inBarrierX && !inGapY;
      const nearWaterway = !inWaterBody && inBarrierX; // just outside the body, still near it
      const onTrail = c.center.y >= TRAIL_Y_MIN && c.center.y <= TRAIL_Y_MAX;
      // A crude, deterministic "steepest local gradient" proxy — same role
      // demDerivatives.ts's real plane fit plays, just synthetic here — high
      // enough in places to genuinely trip the vehicle profile's side-slope
      // gate (18°) without blocking every cell.
      const crossSlopeDeg = Math.abs(15 * Math.sin(c.center.x / 65) * Math.cos(c.center.y / 90));
      const waterFrequency = !inWaterBody && !nearWaterway && (q + r) % 5 === 0 ? 0.35 : null;
      const cell: MobilityGridCell = {
        key: hexKey(c.hex),
        hex: c.hex,
        center: { lat: ANCHOR.lat + c.center.y / 111320, lng: ANCHOR.lng + c.center.x / (111320 * Math.cos(ANCHOR.lat * Math.PI / 180)) },
        elevation,
        vegetation,
        vegEstimated,
        onTrail,
        nearestTrailTags: null,
        crossSlopeDeg,
        waterDistanceM: inWaterBody ? 0 : (nearWaterway ? 10 : Infinity),
        inWaterBody,
        nearestWaterwayKind: nearWaterway ? 'river' : null,
        waterFrequency,
      };
      return cell;
    });
}

const foot = MOVER_PROFILES.find(p => p.id === 'foot-individual-unladen')!;
const vehicle = MOVER_PROFILES.find(p => p.id === 'au-light-4wd')!;
assert.ok(foot && vehicle, 'test setup: need both a foot and a vehicle profile to exercise every gate');

function compareResults(actual: AccumulatedCostSearchResult, expected: AccumulatedCostSearchResult, label: string) {
  assert.strictEqual(actual.best.size, expected.best.size, `${label}: best.size differs (actual=${actual.best.size}, expected=${expected.best.size})`);
  for (const [key, exp] of expected.best) {
    const act = actual.best.get(key);
    assert.ok(act, `${label}: key ${key} present in reference but missing from refactored output`);
    assert.ok(Object.is(act!.timeSeconds, exp.timeSeconds), `${label}: timeSeconds for ${key} differs bit-for-bit: actual=${act!.timeSeconds}, expected=${exp.timeSeconds}`);
    assert.strictEqual(act!.estimated, exp.estimated, `${label}: estimated flag for ${key} differs`);
  }
  assert.strictEqual(actual.prev.size, expected.prev.size, `${label}: prev.size differs`);
  for (const [key, p] of expected.prev) {
    assert.strictEqual(actual.prev.get(key), p, `${label}: predecessor for ${key} differs`);
  }
  // ITERATION ORDER, not just per-key values: `best`/`prev` are populated in
  // relaxation-discovery order (Map first-insertion order), and a caller
  // resuming a search (`resumeFrom`) iterates a prior result's `best` to seed
  // the heap in that exact order, which feeds the MinHeap's
  // tie-break-by-insertion-order. Two implementations can agree on every
  // key/value pair while disagreeing on discovery order — that drift is
  // invisible to the per-key checks above and only shows up here.
  assert.deepStrictEqual([...actual.best.keys()], [...expected.best.keys()], `${label}: best key ITERATION ORDER differs from reference oracle`);
  assert.deepStrictEqual([...actual.prev.keys()], [...expected.prev.keys()], `${label}: prev key ITERATION ORDER differs from reference oracle`);
}

function compareCostToGo(actual: Map<string, number>, expected: Map<string, number>, label: string) {
  assert.strictEqual(actual.size, expected.size, `${label}: size differs`);
  for (const [key, exp] of expected) {
    const act = actual.get(key);
    assert.ok(act !== undefined, `${label}: key ${key} present in reference but missing from refactored output`);
    assert.ok(Object.is(act, exp), `${label}: value for ${key} differs bit-for-bit: actual=${act}, expected=${exp}`);
  }
  assert.deepStrictEqual([...actual.keys()], [...expected.keys()], `${label}: key ITERATION ORDER differs from reference oracle`);
}

console.log('Search core equivalence (WP2 — refactored index-based search vs. pre-refactor reference oracle):');

const BOX_MIN: LocalPoint = { x: 0, y: -100 };
const BOX_MAX: LocalPoint = { x: 1000, y: 400 };
const grid = buildComplexGrid(BOX_MIN, BOX_MAX);
assert.ok(grid.length > 300, 'test setup: need a substantial grid to exercise real gate diversity');

const originKeys = grid.filter(c => (c.center.lng - ANCHOR.lng) * 111320 < 40).map(c => c.key);
const objectiveKeys = grid.filter(c => (c.center.lng - ANCHOR.lng) * 111320 > 960).map(c => c.key);
assert.ok(originKeys.length > 0 && objectiveKeys.length > 0, 'test setup');

for (const [label, profile] of [['foot', foot], ['vehicle (au-light-4wd)', vehicle]] as const) {
  test(`forward search: refactored matches reference oracle exactly — ${label} profile`, () => {
    const expected = refRunAccumulatedCostSearch(grid, originKeys, profile, false);
    const actual = runAccumulatedCostSearch(grid, originKeys, profile, false);
    compareResults(actual, expected, label);
    assert.ok(expected.best.size > 50, 'test setup: the reference oracle itself must reach a meaningful chunk of the grid');
  });

  test(`forward search with night mode: refactored matches reference oracle exactly — ${label} profile`, () => {
    const expected = refRunAccumulatedCostSearch(grid, originKeys, profile, true);
    const actual = runAccumulatedCostSearch(grid, originKeys, profile, true);
    compareResults(actual, expected, `${label} (night)`);
  });

  test(`backward cost-to-go search: refactored matches reference oracle exactly — ${label} profile`, () => {
    const expected = refRunCostToGoSearch(grid, objectiveKeys, profile, false);
    const actual = runCostToGoSearch(grid, objectiveKeys, profile, false);
    compareCostToGo(actual, expected, label);
    assert.ok(expected.size > 50, 'test setup: the reference oracle itself must reach a meaningful chunk of the grid');
  });

  test(`extractPath over the refactored search matches a path backtracked over the reference oracle — ${label} profile`, () => {
    const expected = refRunAccumulatedCostSearch(grid, originKeys, profile, false);
    const actual = runAccumulatedCostSearch(grid, originKeys, profile, false);
    const pathExpected = extractPath(expected, objectiveKeys);
    const pathActual = extractPath(actual, objectiveKeys);
    assert.deepStrictEqual(pathActual, pathExpected);
  });
}

test('edgePenalties option: refactored matches reference oracle exactly (exercises the penalty-lookup path)', () => {
  const baseline = refRunAccumulatedCostSearch(grid, originKeys, foot, false);
  const path = extractPath(baseline, objectiveKeys);
  assert.ok(path && path.length > 2, 'test setup: need a real path to penalise');
  const edgePenalties = new Map<string, number>();
  for (let i = 0; i + 1 < path!.length; i++) edgePenalties.set(`${path![i]}|${path![i + 1]}`, 3.5);

  const expected = refRunAccumulatedCostSearch(grid, originKeys, foot, false, { edgePenalties });
  const actual = runAccumulatedCostSearch(grid, originKeys, foot, false, { edgePenalties });
  compareResults(actual, expected, 'edgePenalties');
});

test('INFINITY edgePenalties (keyTerrain.ts\'s candidate-denial shape): refactored matches reference oracle exactly — the case that produced RangeError: Invalid array length in the live keyTerrain.test.ts failure', () => {
  // Mirrors keyTerrain.ts's own denialEdgePenalties() exactly: every edge
  // touching a denied cell and each of ITS neighbours, in BOTH directions,
  // gets an Infinity multiplier — not a single denied edge. This is the
  // shape that actually exercises the bug: a denied cell surrounded on
  // every side by Infinity-cost edges gets relaxed into from MULTIPLE
  // directions, and a "hadExisting" check that used `bestTime[i] ===
  // Infinity` as its presence sentinel (instead of tracking presence
  // separately) re-discovered it on every one of those relaxations,
  // growing `order` without bound.
  const denyKeys = grid.slice(Math.floor(grid.length / 2), Math.floor(grid.length / 2) + 3).map(c => c.key);
  const byKey = new Map(grid.map(c => [c.key, c]));
  const edgePenalties = new Map<string, number>();
  for (const key of denyKeys) {
    const cell = byKey.get(key);
    if (!cell) continue;
    for (const nHex of hexNeighbors(cell.hex)) {
      const nKey = hexKey(nHex);
      if (!byKey.has(nKey)) continue;
      edgePenalties.set(`${key}|${nKey}`, Infinity);
      edgePenalties.set(`${nKey}|${key}`, Infinity);
    }
  }
  assert.ok(edgePenalties.size > 0, 'test setup: denial must actually touch real edges');

  const expected = refRunAccumulatedCostSearch(grid, originKeys, foot, false, { edgePenalties });
  const actual = runAccumulatedCostSearch(grid, originKeys, foot, false, { edgePenalties });
  compareResults(actual, expected, 'infinity edgePenalties');

  // Also prove the refactored search actually TERMINATES with a sane,
  // bounded `best` — the live failure mode was an unbounded `order` array
  // (RangeError: Invalid array length), which this call surviving at all
  // (let alone matching the oracle) already disproves, but assert the
  // bound explicitly so a future regression fails fast with a clear message
  // rather than an opaque RangeError deep in Array.push.
  assert.ok(actual.best.size <= grid.length, `best.size (${actual.best.size}) exceeded grid.length (${grid.length}) — order grew unbounded`);
});

test('blockedEdges option (cost-to-go): refactored matches reference oracle exactly', () => {
  const baseline = refRunCostToGoSearch(grid, objectiveKeys, vehicle, false);
  const someKeys = [...baseline.keys()].slice(0, 5);
  const blocked = new Set<string>();
  for (const k of someKeys) blocked.add(`${k}|${k}`); // synthetic, doesn't need to be a real edge to exercise the lookup path

  const expected = refRunCostToGoSearch(grid, objectiveKeys, vehicle, false, blocked);
  const actual = runCostToGoSearch(grid, objectiveKeys, vehicle, false, blocked);
  compareCostToGo(actual, expected, 'blockedEdges');
});

test('resumeFrom: refactored matches reference oracle exactly across a GROWN cell set', () => {
  const partialMax: LocalPoint = { x: 500, y: 400 };
  const partialGrid = buildComplexGrid(BOX_MIN, partialMax);
  assert.ok(partialGrid.length > 0 && partialGrid.length < grid.length, 'test setup: partial set must be a genuine subset');

  const partialExpected = refRunAccumulatedCostSearch(partialGrid, originKeys, foot, false);
  const partialActual = runAccumulatedCostSearch(partialGrid, originKeys, foot, false);
  compareResults(partialActual, partialExpected, 'resumeFrom (partial round)');

  const resumedExpected = refRunAccumulatedCostSearch(grid, originKeys, foot, false, { resumeFrom: partialExpected });
  const resumedActual = runAccumulatedCostSearch(grid, originKeys, foot, false, { resumeFrom: partialActual });
  compareResults(resumedActual, resumedExpected, 'resumeFrom (resumed round)');

  const pathExpected = extractPath(resumedExpected, objectiveKeys);
  const pathActual = extractPath(resumedActual, objectiveKeys);
  assert.deepStrictEqual(pathActual, pathExpected);
  assert.ok(pathExpected, 'test setup: the grown grid must actually reach the objective');
});

// ---------------------------------------------------------------------------
// TIE-HEAVY fixture — a perfectly flat, uniform-cost grid. `buildComplexGrid`
// above varies elevation/vegetation/water enough that almost every cost is
// numerically distinct, so it can't exercise the MinHeap's
// tie-break-by-insertion-order at all. Real flat terrain routinely produces
// bit-identical accumulated costs (concentric hex "rings" from a single
// source all cost the same to reach), so this is not a contrived edge case.
// Push/insertion ORDER only changes anything observable when combined with
// `resumeFrom` (the order a prior result's `best` map is iterated in seeds
// the next round's heap) — see the dedicated test below.
// ---------------------------------------------------------------------------

function buildFlatTieGrid(minPt: LocalPoint, maxPt: LocalPoint): MobilityGridCell[] {
  return generateBoxHexes(minPt, maxPt, HEX_SIZE)
    .filter(c => c.center.x >= minPt.x && c.center.x <= maxPt.x && c.center.y >= minPt.y && c.center.y <= maxPt.y)
    .map(c => {
      const cell: MobilityGridCell = {
        key: hexKey(c.hex),
        hex: c.hex,
        center: { lat: ANCHOR.lat + c.center.y / 111320, lng: ANCHOR.lng + c.center.x / (111320 * Math.cos(ANCHOR.lat * Math.PI / 180)) },
        elevation: 0, // perfectly flat — every directed edge costs the same for a given profile
        vegetation: 'grassland',
        vegEstimated: false,
        onTrail: false,
        nearestTrailTags: null,
        crossSlopeDeg: 0,
        waterDistanceM: Infinity,
        inWaterBody: false,
        nearestWaterwayKind: null,
        waterFrequency: null,
      };
      return cell;
    });
}

const TIE_BOX_A_MIN: LocalPoint = { x: -300, y: -300 };
const TIE_BOX_A_MAX: LocalPoint = { x: 300, y: 300 };
const TIE_BOX_B_MIN: LocalPoint = { x: -650, y: -650 };
const TIE_BOX_B_MAX: LocalPoint = { x: 650, y: 650 };

test('TIE-HEAVY flat grid: single round matches reference oracle exactly, including insertion order (fixture sanity + Defect 2 order check)', () => {
  const flatCells = buildFlatTieGrid(TIE_BOX_A_MIN, TIE_BOX_A_MAX);
  assert.ok(flatCells.length > 50, 'test setup: need a substantial flat grid');
  const tieOrigin = [flatCells[Math.floor(flatCells.length / 2)].key];

  const expected = refRunAccumulatedCostSearch(flatCells, tieOrigin, foot, false);
  const actual = runAccumulatedCostSearch(flatCells, tieOrigin, foot, false);
  compareResults(actual, expected, 'tie-heavy (single round)');

  // Confirm the fixture actually produces genuine ties — the whole point of
  // it. A flood fill from a single centre seed over a uniform-cost hex grid
  // ties every mirror-symmetric direction pair at bit-identical accumulated
  // cost (haversine distance is symmetric under a sign flip of the
  // longitude delta — see cellIndex.ts's own header proof — so opposite hex
  // directions from any cell cost exactly the same). In practice that ties
  // the overwhelming majority of the grid, not just a handful of cells.
  const costCounts = new Map<number, number>();
  for (const v of expected.best.values()) costCounts.set(v.timeSeconds, (costCounts.get(v.timeSeconds) ?? 0) + 1);
  const tieGroupSizes = [...costCounts.values()];
  const maxTieGroup = Math.max(...tieGroupSizes);
  const tiedCellCount = tieGroupSizes.filter(s => s >= 2).reduce((sum, s) => sum + s, 0);
  assert.ok(maxTieGroup >= 2, `test setup: fixture must produce genuine cost ties (largest tie group=${maxTieGroup})`);
  assert.ok(tiedCellCount >= expected.best.size * 0.5,
    `test setup: fixture must be genuinely TIE-HEAVY, not just incidentally tied (${tiedCellCount}/${expected.best.size} cells in a size>=2 tie group)`);
});

test('TIE-HEAVY flat grid + resumeFrom: refactored matches reference oracle exactly — the case Defect 1 broke (push-order-dependent tie-break changes prev pointers, not just Map iteration order)', () => {
  const roundACells = buildFlatTieGrid(TIE_BOX_A_MIN, TIE_BOX_A_MAX);
  const tieOrigin = [roundACells[Math.floor(roundACells.length / 2)].key];

  const roundAExpected = refRunAccumulatedCostSearch(roundACells, tieOrigin, foot, false);
  const roundAActual = runAccumulatedCostSearch(roundACells, tieOrigin, foot, false);
  compareResults(roundAActual, roundAExpected, 'tie-heavy (round A)');

  // Round B grows the box and RESUMES from round A's result — the exact
  // `mobilityLazyGrid.ts` tile-growth shape. Round B's heap is seeded by
  // iterating `resumeFrom.best`, so round A's iteration order feeds round
  // B's tie-break-by-insertion-order directly.
  const roundBCells = buildFlatTieGrid(TIE_BOX_B_MIN, TIE_BOX_B_MAX);
  const roundBExpected = refRunAccumulatedCostSearch(roundBCells, [], foot, false, { resumeFrom: roundAExpected });
  const roundBActual = runAccumulatedCostSearch(roundBCells, [], foot, false, { resumeFrom: roundAActual });
  compareResults(roundBActual, roundBExpected, 'tie-heavy (round B, resumed)');

  const farKey = roundBCells[roundBCells.length - 1].key;
  const pathExpected = extractPath(roundBExpected, [farKey]);
  const pathActual = extractPath(roundBActual, [farKey]);
  assert.deepStrictEqual(pathActual, pathExpected, 'tie-heavy: extracted path differs after resume — a tie-break resolved differently because round A\'s best-map insertion order fed round B\'s heap seeding in a different order');
});

test('resumeFrom onto a shrinking/disjoint cell set (overflow keys retained unrelaxed): refactored matches reference oracle exactly', () => {
  // Deliberately pathological — resumeFrom's own docs note it's built for
  // GROWING sets, but the original code never assumed that; a key from the
  // prior round absent from the new cell set must simply persist, unrelaxed,
  // in the output. Exercises the refactor's overflow path precisely.
  const roundAMax: LocalPoint = { x: 500, y: 400 };
  const roundACells = buildComplexGrid(BOX_MIN, roundAMax);
  const roundAOrigin = originKeys.filter(k => roundACells.some(c => c.key === k));
  const roundAExpected = refRunAccumulatedCostSearch(roundACells, roundAOrigin, foot, false);
  const roundAActual = runAccumulatedCostSearch(roundACells, roundAOrigin, foot, false);

  // Round B: a DIFFERENT, only partly-overlapping box — some round-A keys
  // will not resolve in round B's index at all.
  const roundBMin: LocalPoint = { x: 200, y: -100 };
  const roundBMax: LocalPoint = { x: 900, y: 250 };
  const roundBCells = buildComplexGrid(roundBMin, roundBMax);
  const overlap = roundACells.some(c => !roundBCells.some(rc => rc.key === c.key));
  assert.ok(overlap, 'test setup: round B must genuinely drop some round-A keys to exercise the overflow path');

  const expected = refRunAccumulatedCostSearch(roundBCells, [], foot, false, { resumeFrom: roundAExpected });
  const actual = runAccumulatedCostSearch(roundBCells, [], foot, false, { resumeFrom: roundAActual });
  compareResults(actual, expected, 'resumeFrom (disjoint/shrinking)');
});

test('fully-unreachable objective: refactored matches reference oracle exactly (no route exists, no manufactured shortcut)', () => {
  // A solid water barrier with NO gap at all — objective keys on the far side
  // must never be reached by either implementation.
  function buildSolidBarrierGrid(): MobilityGridCell[] {
    return generateBoxHexes(BOX_MIN, BOX_MAX, HEX_SIZE)
      .filter(c => c.center.x >= BOX_MIN.x && c.center.x <= BOX_MAX.x && c.center.y >= BOX_MIN.y && c.center.y <= BOX_MAX.y)
      .map(c => {
        const inBarrierX = c.center.x >= WATER_X_MIN && c.center.x <= WATER_X_MAX;
        const cell: MobilityGridCell = {
          key: hexKey(c.hex), hex: c.hex,
          center: { lat: ANCHOR.lat + c.center.y / 111320, lng: ANCHOR.lng + c.center.x / (111320 * Math.cos(ANCHOR.lat * Math.PI / 180)) },
          elevation: 0, vegetation: 'grassland', vegEstimated: false, onTrail: false, nearestTrailTags: null,
          crossSlopeDeg: 0, waterDistanceM: inBarrierX ? 0 : Infinity, inWaterBody: inBarrierX, nearestWaterwayKind: null, waterFrequency: null,
        };
        return cell;
      });
  }
  const solidGrid = buildSolidBarrierGrid();
  const solidOrigin = solidGrid.filter(c => (c.center.lng - ANCHOR.lng) * 111320 < 40).map(c => c.key);
  const solidObjective = solidGrid.filter(c => (c.center.lng - ANCHOR.lng) * 111320 > 960).map(c => c.key);
  assert.ok(solidOrigin.length > 0 && solidObjective.length > 0, 'test setup');

  const expectedForward = refRunAccumulatedCostSearch(solidGrid, solidOrigin, vehicle, false);
  const actualForward = runAccumulatedCostSearch(solidGrid, solidOrigin, vehicle, false);
  compareResults(actualForward, expectedForward, 'unreachable (forward)');

  for (const key of solidObjective) {
    assert.ok(!actualForward.best.has(key), `FAILED: objective cell ${key} was reached across a solid, gap-free barrier — manufactured shortcut`);
  }
  assert.strictEqual(extractPath(actualForward, solidObjective), null, 'FAILED: extractPath must return null when no objective cell was reached');
  assert.strictEqual(extractPath(expectedForward, solidObjective), null);

  const expectedBackward = refRunCostToGoSearch(solidGrid, solidObjective, vehicle, false);
  const actualBackward = runCostToGoSearch(solidGrid, solidObjective, vehicle, false);
  compareCostToGo(actualBackward, expectedBackward, 'unreachable (backward)');
  for (const key of solidOrigin) {
    assert.ok(!actualBackward.has(key), `FAILED: origin cell ${key} was reached across a solid, gap-free barrier in the cost-to-go field — manufactured shortcut`);
  }
});

test('calling the search twice over the SAME cells array (CellIndex cache reuse path) still matches the reference oracle exactly', () => {
  const expected1 = refRunAccumulatedCostSearch(grid, originKeys, vehicle, false);
  const actual1 = runAccumulatedCostSearch(grid, originKeys, vehicle, false);
  compareResults(actual1, expected1, 'cache reuse (pass 1)');
  // Second call, same `grid` array reference, different profile — the exact
  // shape every real caller (movement ensemble, restriction planner, key
  // terrain scoring) hits ~120 times per run. Proves the memoised CellIndex
  // doesn't leak state between calls.
  const expected2 = refRunAccumulatedCostSearch(grid, originKeys, foot, true);
  const actual2 = runAccumulatedCostSearch(grid, originKeys, foot, true);
  compareResults(actual2, expected2, 'cache reuse (pass 2, different profile+nightMode)');
});

if (process.exitCode === 1) {
  console.error(`\nSearch core equivalence did NOT hold — the refactor introduced drift.`);
} else {
  console.log(`\nAll ${passed} search core equivalence checks passed — refactored search is bit-identical to the pre-refactor reference oracle.`);
}
