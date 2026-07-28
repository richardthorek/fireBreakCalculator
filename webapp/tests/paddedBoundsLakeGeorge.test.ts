/**
 * The exact regression the owner caught live-testing against the real Lake
 * George (docs/ROUTE_INTELLIGENCE.md §35, 2026-07-27): a west→east crossing
 * still only got ~227 m before stopping, despite the "expanding retry" fix
 * shipped earlier the same day.
 *
 * Root cause: `computePaddedBounds` (formerly inlined in `buildMobilityGrid`)
 * used to pad `(axis span) * boundsPadFactor`. For a due-EAST crossing,
 * origin and objective sit at nearly the SAME latitude, so `maxLat - minLat`
 * is just the two painted blobs' own thickness — tens to low hundreds of
 * metres — regardless of how far apart the areas actually are. Multiplying a
 * near-zero number by any factor (0.2 through 4.0) stays near-zero: the
 * retry mechanism was scaling the WRONG base quantity and never gave the
 * search real north–south room, reproducing the exact original defect.
 *
 * `expandingSearchLakeGeorge.test.ts` did NOT catch this: it built its
 * synthetic grid directly from raw local coordinates, bypassing the real
 * padding formula entirely — it proved "a wide-enough box finds the route"
 * but never proved "the retry mechanism actually PRODUCES a wide-enough
 * box". THIS test targets that exact gap, against `computePaddedBounds`
 * itself — the pure function the live bug was hiding in.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/paddedBoundsLakeGeorge.test.ts
 */
import * as assert from 'node:assert';
import { computePaddedBounds } from '../src/terrain/mobilityGrid';

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

console.log('Padded-bounds Lake George regression (§35):');

// A real Lake George-scale west->east crossing: origin and objective ~25 km
// apart in longitude, and — the case that broke — at NEARLY THE SAME
// LATITUDE (a small paint blob's worth of thickness apart, not the lake's
// own ~28 km north-south extent).
const westOrigin = { minLat: -35.051, maxLat: -35.050, minLng: 149.300, maxLng: 149.301 };
const eastObjective = { minLat: -35.050, maxLat: -35.049, minLng: 149.550, maxLng: 149.551 };

test('a due-east crossing at boundsPadFactor=0.2 gets REAL north-south room, not a fraction of the blobs\' own thickness', () => {
  const padded = computePaddedBounds(westOrigin, eastObjective, 0.2)!;
  assert.ok(padded, 'test setup: this geometry must produce a valid padded box');
  const northSouthRoomDeg = padded.boundsNe.lat - padded.boundsSw.lat;
  const northSouthRoomM = northSouthRoomDeg * 111320;
  // The old, buggy formula would have produced (maxLat-minLat)*1.2 ≈ 0.002°
  // ≈ 220 m total — matching the "~227 M" the owner's live test reported.
  // The fix must produce room on the order of kilometres, not metres.
  assert.ok(northSouthRoomM > 5000,
    `FAILED: only ${northSouthRoomM.toFixed(0)} m of north-south room — this is the exact live-reported regression (it was ~227 m)`);
});

test('padding scales with the REAL origin<->objective distance, not either axis\'s own incidental span', () => {
  const padded02 = computePaddedBounds(westOrigin, eastObjective, 0.2)!;
  const padded06 = computePaddedBounds(westOrigin, eastObjective, 0.6)!;
  const room02 = padded02.boundsNe.lat - padded02.boundsSw.lat;
  const room06 = padded06.boundsNe.lat - padded06.boundsSw.lat;
  // The square-box formula targets side = spanM * (1 + 2*boundsPadFactor) —
  // at 0.2x that's 1.4x the span, at 0.6x it's 2.2x, a ratio of ~1.57, not a
  // naive 3x (the "1 +" term is the span itself, which doesn't scale with
  // the factor). The point of this assertion isn't the exact ratio, only
  // that room genuinely GROWS with the factor — the bug looked like near-
  // identical (near-zero) room regardless of factor.
  assert.ok(room06 > room02 * 1.4,
    `room did not scale with boundsPadFactor as expected (0.2x=${room02}, 0.6x=${room06}) — padding may still be pinned near zero`);
});

test('the box is genuinely SQUARE — a due-east crossing gets north-south extent comparable to its east-west extent, not just "more than before"', () => {
  // Owner, refining the fix live: "a 'more' square ratio could be a good
  // way to start... one axis of loaded data is more similar to the linear
  // distance so we have a proportionate area of data to work with." Padding
  // each axis by an independent delta (the FIRST fix attempt) would still
  // leave a due-east crossing's own north-south span far short of its
  // east-west one — this asserts the two are actually comparable, not just
  // "no longer near-zero".
  const padded = computePaddedBounds(westOrigin, eastObjective, 0.3)!;
  const northSouthDeg = padded.boundsNe.lat - padded.boundsSw.lat;
  const midLat = (padded.boundsSw.lat + padded.boundsNe.lat) / 2;
  const eastWestDeg = (padded.boundsNe.lng - padded.boundsSw.lng) * Math.cos((midLat * Math.PI) / 180);
  const ratio = northSouthDeg / eastWestDeg;
  assert.ok(ratio > 0.6 && ratio < 1.4,
    `expected a roughly square box (ratio near 1.0), got north-south/east-west = ${ratio.toFixed(2)}`);
});

test('a due-NORTH crossing (the symmetric case) also gets real east-west room', () => {
  const southOrigin = { minLat: -35.300, maxLat: -35.299, minLng: 149.400, maxLng: 149.401 };
  const northObjective = { minLat: -35.100, maxLat: -35.099, minLng: 149.400, maxLng: 149.401 };
  const padded = computePaddedBounds(southOrigin, northObjective, 0.2)!;
  const eastWestRoomM = (padded.boundsNe.lng - padded.boundsSw.lng) * 111320 * Math.cos((-35.2 * Math.PI) / 180);
  assert.ok(eastWestRoomM > 3000,
    `FAILED: only ${eastWestRoomM.toFixed(0)} m of east-west room for a due-north crossing — the symmetric failure mode`);
});

test('a genuinely close origin/objective pair still gets a sane minimum pad, not zero', () => {
  const closeA = { minLat: -35.0501, maxLat: -35.0500, minLng: 149.3000, maxLng: 149.3001 };
  const closeB = { minLat: -35.0500, maxLat: -35.0499, minLng: 149.3005, maxLng: 149.3006 };
  const padded = computePaddedBounds(closeA, closeB, 0.2)!;
  assert.ok(padded, 'a close pair must still produce a valid box');
  const roomM = (padded.boundsNe.lat - padded.boundsSw.lat) * 111320;
  assert.ok(roomM >= 200, `expected the MIN_PAD_M floor (>=200m), got ${roomM.toFixed(0)}m`);
});

test('THE REPORTED SCENARIO: a real Lake-George-scale crossing clears the lake\'s full extent on the FIRST attempt (no retry needed)', () => {
  // Real Lake George: ~28 km north-south (lat -35.15 to -34.90), origin
  // west/objective east ~25 km apart, both near the lake's own mid-latitude
  // (-35.05) — the exact geometry from the owner's live screenshot.
  // mobilityAppreciation.ts's INITIAL_PAD_FACTOR is 0.3.
  const INITIAL_PAD_FACTOR = 0.3;
  const padded = computePaddedBounds(westOrigin, eastObjective, INITIAL_PAD_FACTOR)!;
  const lakeSouthLat = -35.15;
  const lakeNorthLat = -34.90;
  assert.ok(padded.boundsSw.lat <= lakeSouthLat,
    `box's south edge (${padded.boundsSw.lat.toFixed(3)}) does not clear the lake's southern extent (${lakeSouthLat}) — the road detour would still be cut off`);
  assert.ok(padded.boundsNe.lat >= lakeNorthLat,
    `box's north edge (${padded.boundsNe.lat.toFixed(3)}) does not clear the lake's northern extent (${lakeNorthLat}) — this is the exact live-reported failure`);
});

test('a degenerate span (origin and objective at literally the same point) returns null, not a divide-by-zero artefact', () => {
  const samePoint = { minLat: -35.05, maxLat: -35.05, minLng: 149.30, maxLng: 149.30 };
  const padded = computePaddedBounds(samePoint, samePoint, 0.2);
  assert.strictEqual(padded, null);
});

if (process.exitCode === 1) {
  console.error(`\nThe padded-bounds Lake George regression is NOT fixed.`);
} else {
  console.log(`\nAll ${passed} padded-bounds checks passed.`);
}
