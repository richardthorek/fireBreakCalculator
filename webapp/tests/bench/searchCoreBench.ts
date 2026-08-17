/**
 * WP2 micro-benchmark — NOT a test, not wired into `npm test`. Times the
 * pre-refactor reference search (a verbatim copy of the old
 * `Map<string,...>`/`hexNeighbors()`/`toMobilitySample()`-per-edge
 * implementation — same copy `searchCoreEquivalence.test.ts` uses as its
 * correctness oracle) against the current package-exported
 * `runAccumulatedCostSearch` (the `CellIndex`-based rewrite,
 * `shared/terrain/src/cellIndex.ts` + `accumulatedCost.ts`) over grids sized
 * near N=2200 (a typical single-run grid) and N=12000 (a large-AOI run), at
 * the ~120-pass-per-run order of magnitude the profiling audit measured, so
 * the printed number is a real per-run speedup estimate, not a single-call
 * microbenchmark that a JIT warm-up or GC pause could dominate.
 *
 * Run: npx tsx webapp/tests/bench/searchCoreBench.ts
 */
import {
  generateBoxHexes, hexKey, hexNeighbors, HEX_AREA_FACTOR, LocalPoint, MobilityGridCell, MoverProfile,
  MOVER_PROFILES, toMobilitySample, edgeMobilityCost, LatLng, calculateDistance,
  runAccumulatedCostSearch, AccumulatedCostSearchResult, AccumulatedCostSearchOptions,
} from '@firebreak/terrain';
import { VegetationType } from '@firebreak/terrain';

// ---------------------------------------------------------------------------
// Reference (pre-refactor) implementation — see searchCoreEquivalence.test.ts
// for why this is kept as an independent, byte-for-byte copy.
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
  const { edgePenalties, resumeFrom } = options;
  const byKey = new Map<string, MobilityGridCell>();
  for (const c of cells) byKey.set(c.key, c);

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

// ---------------------------------------------------------------------------
// Grid construction — same shape of variety as the equivalence test (real
// elevation/vegetation/water/onTrail gates firing, not a trivial open field
// that would flatter either implementation).
// ---------------------------------------------------------------------------

const VEG_CYCLE: VegetationType[] = ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'];
const ANCHOR: LatLng = { lat: -35.31, lng: 149.08 };

function buildGrid(targetCount: number): MobilityGridCell[] {
  // A roughly 3:2 box sized so `chooseHexSize`-style area division lands
  // close to `targetCount` cells.
  const boxWidth = 3000, boxHeight = 2000;
  const size = Math.sqrt((boxWidth * boxHeight) / (HEX_AREA_FACTOR * targetCount));
  const minPt: LocalPoint = { x: 0, y: 0 };
  const maxPt: LocalPoint = { x: boxWidth, y: boxHeight };
  const waterXMin = boxWidth * 0.45, waterXMax = boxWidth * 0.48;
  const gapYMin = boxHeight * 0.4, gapYMax = boxHeight * 0.55;

  return generateBoxHexes(minPt, maxPt, size)
    .filter(c => c.center.x >= minPt.x && c.center.x <= maxPt.x && c.center.y >= minPt.y && c.center.y <= maxPt.y)
    .map(c => {
      const { q, r } = c.hex;
      const elevation = 40 * Math.sin(c.center.x / 140) + 25 * Math.cos(c.center.y / 110) + (c.center.x + c.center.y) * 0.02;
      const vegetation = VEG_CYCLE[((q % 4) + 4 + r) % 4];
      const inBarrierX = c.center.x >= waterXMin && c.center.x <= waterXMax;
      const inGapY = c.center.y >= gapYMin && c.center.y <= gapYMax;
      const inWaterBody = inBarrierX && !inGapY;
      const onTrail = c.center.y >= boxHeight * 0.48 && c.center.y <= boxHeight * 0.52;
      const crossSlopeDeg = Math.abs(15 * Math.sin(c.center.x / 65) * Math.cos(c.center.y / 90));
      const cell: MobilityGridCell = {
        key: hexKey(c.hex),
        hex: c.hex,
        center: { lat: ANCHOR.lat + c.center.y / 111320, lng: ANCHOR.lng + c.center.x / (111320 * Math.cos(ANCHOR.lat * Math.PI / 180)) },
        elevation,
        vegetation,
        vegEstimated: (q + r) % 3 === 0,
        onTrail,
        nearestTrailTags: null,
        crossSlopeDeg,
        waterDistanceM: inWaterBody ? 0 : Infinity,
        inWaterBody,
        nearestWaterwayKind: null,
        waterFrequency: null,
      };
      return cell;
    });
}

function timeMs(fn: () => void): number {
  const start = process.hrtime.bigint();
  fn();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1e6;
}

const foot = MOVER_PROFILES.find(p => p.id === 'foot-individual-unladen')!;
const vehicle = MOVER_PROFILES.find(p => p.id === 'au-light-4wd')!;
const profiles = [foot, vehicle];

function runPasses(impl: (cells: MobilityGridCell[], originKeys: string[], profile: MoverProfile, nightMode: boolean) => unknown, cells: MobilityGridCell[], originKeys: string[], passes: number): number {
  return timeMs(() => {
    for (let i = 0; i < passes; i++) {
      const profile = profiles[i % profiles.length];
      const nightMode = i % 2 === 0;
      impl(cells, originKeys, profile, nightMode);
    }
  });
}

console.log('WP2 search-core micro-benchmark — pre-refactor reference vs. CellIndex-based rewrite\n');

for (const targetN of [2200, 12000]) {
  const cells = buildGrid(targetN);
  const originKeys = cells.filter(c => (c.center.lng - ANCHOR.lng) * 111320 < 60).map(c => c.key);
  const passes = targetN <= 2200 ? 120 : 20; // full ~120-pass order for the small grid; fewer for the large one to keep the bench itself fast
  console.log(`--- N=${cells.length} (target ${targetN}), origin seeds=${originKeys.length}, passes=${passes} ---`);

  // Warm-up (JIT) — untimed, discarded.
  runPasses(refRunAccumulatedCostSearch, cells, originKeys, 3);
  runPasses(runAccumulatedCostSearch, cells, originKeys, 3);

  const tOld = runPasses(refRunAccumulatedCostSearch, cells, originKeys, passes);
  const tNew = runPasses(runAccumulatedCostSearch, cells, originKeys, passes);

  console.log(`  OLD (per-pass rebuild):      ${tOld.toFixed(1)} ms total, ${(tOld / passes).toFixed(2)} ms/pass`);
  console.log(`  NEW (CellIndex, cached):     ${tNew.toFixed(1)} ms total, ${(tNew / passes).toFixed(2)} ms/pass`);
  console.log(`  Speedup:                     ${(tOld / tNew).toFixed(2)}x\n`);
}
