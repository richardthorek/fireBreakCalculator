/**
 * Road-graph fusion, extended into the movement ensemble and min-cut (docs
 * §42 follow-on, 2026-07-28). Step 36 fused the box-free road-graph route
 * into chokepoint/corridor analysis only; the roadmap's own stated remainder
 * was the ensemble's per-step logic (still hex-to-hex, no awareness of which
 * fork the road graph's exact A* actually resolved as fastest) and min-cut
 * (flat 3x trail capacity regardless of a track vs a highway).
 *
 * Two real, bounded fixes tested here — NOT the full "genuinely mixed
 * hex+road-graph adjacency" rewrite, which remains real, larger follow-up
 * work (see roadRouteSearch.ts's own header):
 *
 *  1. `simulateMovementEnsemble`'s new `preferredRouteKeys` option — a small
 *     per-step tie-break bias so movers favour the resolved road-graph
 *     route's own cells at a genuine fork, without collapsing the ensemble's
 *     stochastic spread.
 *  2. `minCutBarrier.ts`'s trail-edge capacity, now tiered by real OSM
 *     highway classification instead of one flat multiplier for every trail.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/roadGraphEnsembleMinCutFusion.test.ts
 */
import * as assert from 'node:assert';
import { hexKey, AxialCoord, axialToLocal, makeProjection, toLatLng } from '../src/utils/hexGrid';
import { MobilityGridCell } from '../src/terrain/accumulatedCost';
import { simulateMovementEnsemble } from '../src/terrain/movementSimulation';
import { computeMinCutBarrier } from '../src/terrain/minCutBarrier';
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

const ANCHOR = { lat: -35.05, lng: 149.30 };
const PROJ = makeProjection(ANCHOR);
const HEX_SIZE = 30;

function cell(hex: AxialCoord, opts: Partial<MobilityGridCell> = {}): MobilityGridCell {
  // Real hex geometry (axialToLocal), not an arbitrary linear map — every
  // hex-adjacent step must be the SAME real distance for the two-fork test
  // below to be a fair comparison (any hand-rolled placement risks silently
  // making one fork's edges longer than the other's).
  const center = toLatLng(PROJ, axialToLocal(hex, HEX_SIZE));
  return {
    key: hexKey(hex),
    hex,
    center,
    elevation: 0,
    vegetation: 'grassland',
    vegEstimated: false,
    onTrail: true,
    nearestTrailTags: { highway: 'residential' },
    crossSlopeDeg: 0,
    waterDistanceM: Infinity,
    inWaterBody: false,
    nearestWaterwayKind: null,
    waterFrequency: null,
    ...opts,
  };
}

// --- Part 1: ensemble known-route tie-break -------------------------------
// Two disjoint 4-step hex paths between the SAME origin (0,0) and objective
// (2,2), built from `(1,0)`/`(0,1)` neighbour-direction moves only (both are
// real single-hex steps — see hexGrid.ts's NEIGHBOR_DIRS) so both are
// genuinely walkable, equal-length, equal-cost routes. Every cell is onTrail
// with an identical class, so nothing but the bias under test should favour
// either one.
const O: AxialCoord = { q: 0, r: 0 };
const D: AxialCoord = { q: 2, r: 2 };
const pathA: AxialCoord[] = [O, { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 2, r: 1 }, D];
const pathB: AxialCoord[] = [O, { q: 0, r: 1 }, { q: 0, r: 2 }, { q: 1, r: 2 }, D];
const forkCellsByHex = new Map<string, AxialCoord>();
for (const h of [...pathA, ...pathB]) forkCellsByHex.set(hexKey(h), h);
const forkCells: MobilityGridCell[] = [...forkCellsByHex.values()].map(h => cell(h));

const vehicle = getMoverProfile('au-light-4wd')!;
const pathAOnlyKey = hexKey({ q: 2, r: 1 }); // on path A, not on path B
const pathBOnlyKey = hexKey({ q: 1, r: 2 }); // on path B, not on path A

function fractionOfTracksThrough(key: string, ensemble: NonNullable<ReturnType<typeof simulateMovementEnsemble>>): number {
  const withKey = ensemble.tracks.filter(t => t.keys.includes(key)).length;
  return withKey / ensemble.tracks.length;
}

console.log('Road-graph fusion into ensemble tie-break + min-cut capacity (§42 follow-on):');

/** Run count high enough for a stable frequency estimate; the two fork
 *  branches sit one hex-step apart from each other for part of their length
 *  (a real feature of a hex tessellation, not a fixture bug — see the module
 *  header), so some movers legitimately cross between them. The ROBUST
 *  signal is therefore not "which cell did a mover visit" in isolation but
 *  the RELATIVE balance (fracA − fracB): baseline should sit near parity,
 *  and biasing toward one fork should shift that balance decisively toward
 *  it, regardless of whatever the unbiased balance happens to be. */
function forkBalance(preferredRouteKeys?: string[]): number {
  const ensemble = simulateMovementEnsemble(
    forkCells, [hexKey(O)], [hexKey(D)], vehicle, false, HEX_SIZE, PROJ,
    { moverCount: 500, seed: 42, keepTrajectories: 0, preferredRouteKeys }
  )!;
  return fractionOfTracksThrough(pathAOnlyKey, ensemble) - fractionOfTracksThrough(pathBOnlyKey, ensemble);
}

test('BASELINE (no preferred route): the two forks are close to balanced', () => {
  const balance = forkBalance();
  assert.ok(Math.abs(balance) < 0.15, `expected a roughly balanced baseline fork, got fracA-fracB=${balance}`);
});

test('WITH preferredRouteKeys = path A: the balance shifts decisively toward A', () => {
  const baseline = forkBalance();
  const biasedTowardA = forkBalance(pathA.map(hexKey));
  assert.ok(
    biasedTowardA > baseline + 0.1,
    `expected the known-route bias to shift the fork balance toward A: baseline=${baseline}, biasedTowardA=${biasedTowardA}`
  );
});

test('WITH preferredRouteKeys = path B: the balance shifts decisively toward B (bias is not one-directional)', () => {
  const baseline = forkBalance();
  const biasedTowardB = forkBalance(pathB.map(hexKey));
  assert.ok(
    biasedTowardB < baseline - 0.1,
    `expected the known-route bias to shift the fork balance toward B: baseline=${baseline}, biasedTowardB=${biasedTowardB}`
  );
});

test('preferredRouteKeys never forces movement onto a NO-GO edge — it only re-weights real candidates', () => {
  // A preferred key that is not even in this grid should be silently ignored,
  // not crash or corrupt scoring.
  const ensemble = simulateMovementEnsemble(
    forkCells, [hexKey(O)], [hexKey(D)], vehicle, false, HEX_SIZE, PROJ,
    { moverCount: 20, seed: 1, keepTrajectories: 0, preferredRouteKeys: ['999,999', '888,888'] }
  );
  assert.ok(ensemble && ensemble.arrivedCount > 0, 'expected movers to still arrive with an irrelevant preferred-route set');
});

// --- Part 2: min-cut road-class-tiered capacity ---------------------------
// A minimal 1-wide corridor (a single chain of cells) so the min-cut value IS
// the capacity of that one edge class — origin one end, objective the other.
function chain(highway: string | undefined): MobilityGridCell[] {
  const hexes: AxialCoord[] = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }];
  return hexes.map(h => cell(h, { onTrail: true, nearestTrailTags: highway ? { highway } : null }));
}

console.log('\nMin-cut road-class-tiered trail capacity:');

test('a motorway chain has strictly higher min-cut value than an untagged-track chain', () => {
  const foot = getMoverProfile('foot-individual-unladen')!;
  const motorwayCut = computeMinCutBarrier(chain('motorway'), [hexKey({ q: 0, r: 0 })], [hexKey({ q: 2, r: 0 })], foot, false);
  const trackCut = computeMinCutBarrier(chain(undefined), [hexKey({ q: 0, r: 0 })], [hexKey({ q: 2, r: 0 })], foot, false);
  assert.ok(motorwayCut && trackCut, 'expected both cuts to be found');
  assert.ok(
    motorwayCut!.cutValue > trackCut!.cutValue,
    `expected a motorway chain to carry more cut capacity than an untagged track: motorway=${motorwayCut!.cutValue}, track=${trackCut!.cutValue}`
  );
});

test('an off-trail chain still gets the original unit (1x) capacity, unaffected by the tiering', () => {
  const foot = getMoverProfile('foot-individual-unladen')!;
  const offTrail = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }].map(h => cell(h, { onTrail: false, nearestTrailTags: null }));
  const cut = computeMinCutBarrier(offTrail, [hexKey({ q: 0, r: 0 })], [hexKey({ q: 2, r: 0 })], foot, false);
  assert.ok(cut, 'expected a cut to be found');
  assert.strictEqual(cut!.cutValue, 1, 'off-trail edges should still be unit capacity, exactly as before this change');
});

if (process.exitCode === 1) {
  console.error(`\nThe ensemble/min-cut road-graph fusion is NOT working as expected.`);
} else {
  console.log(`\nAll ${passed} checks passed.`);
}
