/**
 * Owner-reported defect, small AOIs (docs/ROUTE_INTELLIGENCE.md §35 addendum,
 * 2026-07-28): "moving approximately 1-2km from one side of a hill to the
 * other is not considering the very viable possibility of travelling an
 * additional 1-2km north or south to a bunch of viable pathways... we need
 * to consider all paths within a reasonable minimum distance, especially for
 * the vehicle types... so 'foot' would be quite constrained compared to
 * vehicles."
 *
 * `computePaddedBounds`'s box used to be sized purely proportionally to the
 * direct origin<->objective span — fine for a long trip, but a short trip got
 * proportionately short padding regardless of whether a much better route
 * sat just outside the box. `minDetourPadM()` adds a profile-scaled floor:
 * how far this mover could travel in a fixed time budget, so a vehicle gets
 * proportionately more search room than a foot mover for the identical trip.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/detourPadScaling.test.ts
 */
import * as assert from 'node:assert';
import { computePaddedBounds, minDetourPadM } from '../src/terrain/mobilityGrid';
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

console.log('Profile-scaled detour pad floor (§35 addendum):');

// The reported scenario: origin/objective ~1.5 km apart (a short hill
// crossing), well under the range where the proportional term alone gives
// meaningful room.
const hillOrigin = { minLat: -35.0500, maxLat: -35.0499, minLng: 149.3000, maxLng: 149.3001 };
const hillObjective = { minLat: -35.0500, maxLat: -35.0499, minLng: 149.3135, maxLng: 149.3136 }; // ~1.25km east at this latitude
const INITIAL_PAD_FACTOR = 0.3;

test('a foot profile gets a real, but modest, detour floor', () => {
  const foot = getMoverProfile('foot-individual-unladen')!;
  const padM = minDetourPadM(foot);
  // 5.0 km/h for 15 minutes = 1250 m — matches the owner's own "1-2km"
  // framing for the reported hill-crossing scenario (docs §39 revision).
  assert.ok(padM > 1000 && padM < 1500, `expected foot's detour pad near 1250m, got ${padM.toFixed(0)}m`);
});

test('a vehicle profile gets proportionately MORE detour room than foot, not the same flat number', () => {
  const foot = getMoverProfile('foot-individual-unladen')!;
  const vehicle = getMoverProfile('au-light-4wd')!;
  const footPad = minDetourPadM(foot);
  const vehiclePad = minDetourPadM(vehicle);
  // 60 km/h vs 5 km/h -> 12x, matching each profile's own sourced road speed.
  assert.ok(vehiclePad > footPad * 10,
    `expected the vehicle's detour pad to be an order of magnitude more than foot's (foot=${footPad.toFixed(0)}m, vehicle=${vehiclePad.toFixed(0)}m)`);
});

test('THE REPORTED SCENARIO: a short hill crossing gets enough room for a 1-2km detour, not just a fraction of the direct span', () => {
  const foot = getMoverProfile('foot-individual-unladen')!;
  const withoutFloor = computePaddedBounds(hillOrigin, hillObjective, INITIAL_PAD_FACTOR)!;
  const withFloor = computePaddedBounds(hillOrigin, hillObjective, INITIAL_PAD_FACTOR, minDetourPadM(foot))!;
  const roomWithoutM = (withoutFloor.boundsNe.lat - withoutFloor.boundsSw.lat) * 111320;
  const roomWithM = (withFloor.boundsNe.lat - withFloor.boundsSw.lat) * 111320;
  assert.ok(roomWithM > roomWithoutM,
    `the profile-scaled floor should add real room over the proportional-only box (without=${roomWithoutM.toFixed(0)}m, with=${roomWithM.toFixed(0)}m)`);
  // A viable detour "1-2km to the north or south" must fit inside HALF the
  // box's own north-south room (the box is centred on the direct line).
  assert.ok(roomWithM / 2 >= 1500,
    `expected at least 1.5km of room on EACH side for a foot profile, got ${(roomWithM / 2).toFixed(0)}m`);
});

test('a vehicle profile gets a dramatically wider box than foot for the IDENTICAL short trip', () => {
  const foot = getMoverProfile('foot-individual-unladen')!;
  const vehicle = getMoverProfile('au-light-4wd')!;
  const footBox = computePaddedBounds(hillOrigin, hillObjective, INITIAL_PAD_FACTOR, minDetourPadM(foot))!;
  const vehicleBox = computePaddedBounds(hillOrigin, hillObjective, INITIAL_PAD_FACTOR, minDetourPadM(vehicle))!;
  const footRoomM = (footBox.boundsNe.lat - footBox.boundsSw.lat) * 111320;
  const vehicleRoomM = (vehicleBox.boundsNe.lat - vehicleBox.boundsSw.lat) * 111320;
  assert.ok(vehicleRoomM > footRoomM * 5,
    `expected the vehicle's box to be dramatically wider than foot's for the same trip (foot=${footRoomM.toFixed(0)}m, vehicle=${vehicleRoomM.toFixed(0)}m)`);
});

test('a long-range trip is UNCHANGED by the floor — the proportional term already dominates', () => {
  const farOrigin = { minLat: -35.150, maxLat: -35.149, minLng: 149.100, maxLng: 149.101 };
  const farObjective = { minLat: -35.150, maxLat: -35.149, minLng: 149.700, maxLng: 149.701 }; // ~55km east
  const foot = getMoverProfile('foot-individual-unladen')!;
  const withoutFloor = computePaddedBounds(farOrigin, farObjective, INITIAL_PAD_FACTOR)!;
  const withFloor = computePaddedBounds(farOrigin, farObjective, INITIAL_PAD_FACTOR, minDetourPadM(foot))!;
  const roomWithoutM = withoutFloor.boundsNe.lat - withoutFloor.boundsSw.lat;
  const roomWithM = withFloor.boundsNe.lat - withFloor.boundsSw.lat;
  assert.ok(Math.abs(roomWithM - roomWithoutM) / roomWithoutM < 0.01,
    `a long trip's box should be ~unchanged by the (much smaller) foot detour floor (without=${roomWithoutM}, with=${roomWithM})`);
});

test('omitting the detour pad argument entirely keeps the OLD formula exactly (backward compatible)', () => {
  const a = computePaddedBounds(hillOrigin, hillObjective, INITIAL_PAD_FACTOR);
  const b = computePaddedBounds(hillOrigin, hillObjective, INITIAL_PAD_FACTOR, 0);
  assert.deepStrictEqual(a, b, 'omitting the new parameter must behave identically to passing 0');
});

if (process.exitCode === 1) {
  console.error(`\nThe detour-pad scaling fix is NOT working as expected.`);
} else {
  console.log(`\nAll ${passed} detour-pad scaling checks passed.`);
}
