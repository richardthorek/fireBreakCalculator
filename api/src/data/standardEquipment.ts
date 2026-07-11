/**
 * Standard Fire Break Equipment Catalogue
 * ------------------------------------------------------------------
 * A built-in, well-sourced set of machinery, aircraft and hand crews so the
 * calculator returns estimates out of the box. The backend seeds these into
 * Azure Table Storage on first use (see seedStandardEquipment.ts); users can
 * then add, edit or delete their own custom equipment alongside them.
 *
 * UNITS & MODEL CONTRACT (see services/productionModel.ts)
 * - Machinery `clearingRate` and hand-crew `clearingRatePerPerson` are the
 *   REFERENCE production rate in metres of single-pass line per hour, achieved
 *   in the easiest conditions: FLAT GRASSLAND. The production model derates
 *   every other fuel/slope from this reference, so these are grass rates, not
 *   averages.
 * - Aircraft `dropLength` is the metres of retardant/water line laid per drop
 *   at grassland coverage; heavier fuel needs higher coverage and is derated by
 *   the model's aircraft coverage factor.
 *
 * SOURCING
 * These are planning-grade defaults grounded in published fireline production
 * literature and standard Australian resource types, intended to be calibrated
 * against local observations:
 *  - NWCG Fireline Handbook / Fireline Production Rate tables (dozer & hand-crew
 *    rates by fuel and slope; chains/hr converted at 1 chain = 20.12 m).
 *  - Victorian DELWP Research Report 56, "Prediction of firefighting resources
 *    for suppression operations".
 *  - NAFC (National Aerial Firefighting Centre) standard aircraft categories and
 *    manufacturer tank capacities for the aircraft cycle model.
 * Costs are indicative planning figures only (aerial "call-when-needed" rates in
 * particular vary widely) and should be overridden with local contract rates.
 */

import {
  Equipment,
  Machinery,
  Aircraft,
  HandCrew,
  timestamp,
  initialVersion,
} from '../models/equipment';

/** A machinery seed: everything except bookkeeping fields, plus a stable code. */
type MachinerySeed = Omit<Machinery, 'id' | 'version' | 'createdAt' | 'updatedAt'> & { code: string };
type AircraftSeed = Omit<Aircraft, 'id' | 'version' | 'createdAt' | 'updatedAt'> & { code: string };
type HandCrewSeed = Omit<HandCrew, 'id' | 'version' | 'createdAt' | 'updatedAt'> & { code: string };
export type StandardEquipmentSeed = MachinerySeed | AircraftSeed | HandCrewSeed;

/** Deterministic id for a standard catalogue item, so re-seeding is idempotent. */
export function standardEquipmentId(code: string): string {
  return `STD-${code}`;
}

const MACHINERY: MachinerySeed[] = [
  {
    code: 'GRADER',
    type: 'Machinery',
    name: 'Motor Grader',
    description:
      'Road grader — very fast fireline in grass and light fuels on gentle ground; ineffective in scrub or timber.',
    clearingRate: 2200,
    cutWidthMeters: 3.7,
    maxSlope: 15,
    costPerHour: 250,
    allowedTerrain: ['flat', 'medium'],
    allowedVegetation: ['grassland', 'lightshrub'],
    standard: true,
    active: true,
  },
  {
    code: 'DOZER-LIGHT',
    type: 'Machinery',
    name: 'Light Dozer (D4/D5 class)',
    description:
      'Small tracked dozer (NWCG Type 3). Agile on light-to-medium fuels and gentle-to-moderate slopes.',
    clearingRate: 700,
    cutWidthMeters: 2.7,
    maxSlope: 20,
    costPerHour: 220,
    allowedTerrain: ['flat', 'medium'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub'],
    standard: true,
    active: true,
  },
  {
    code: 'DOZER-MED',
    type: 'Machinery',
    name: 'Medium Dozer (D6/D7 class)',
    description:
      'Medium tracked dozer (NWCG Type 2). Workhorse fireline machine across most fuels and slopes.',
    clearingRate: 950,
    cutWidthMeters: 3.4,
    maxSlope: 25,
    costPerHour: 320,
    allowedTerrain: ['flat', 'medium', 'steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
    standard: true,
    active: true,
  },
  {
    code: 'DOZER-HEAVY',
    type: 'Machinery',
    name: 'Heavy Dozer (D8/D9 class)',
    description:
      'Large tracked dozer (NWCG Type 1). Pushes through heavy timber and works steep ground; highest cost.',
    clearingRate: 1200,
    cutWidthMeters: 4.3,
    maxSlope: 30,
    costPerHour: 450,
    allowedTerrain: ['flat', 'medium', 'steep', 'very_steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
    standard: true,
    active: true,
  },
  {
    code: 'EXCAVATOR',
    type: 'Machinery',
    name: 'Tracked Excavator (20t, rake/bucket)',
    description:
      'Tracked excavator with rake or bucket — effective in heavy timber and on broken ground where dozers struggle.',
    clearingRate: 600,
    cutWidthMeters: 2.5,
    maxSlope: 25,
    costPerHour: 280,
    allowedTerrain: ['flat', 'medium', 'steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
    standard: true,
    active: true,
  },
  {
    code: 'POSITRACK',
    type: 'Machinery',
    name: 'Tracked Skid-Steer (mulching head)',
    description:
      'Compact tracked loader with mulching/slashing head — good access, narrow line in grass and light-to-medium fuels.',
    clearingRate: 500,
    cutWidthMeters: 1.8,
    maxSlope: 20,
    costPerHour: 180,
    allowedTerrain: ['flat', 'medium'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub'],
    standard: true,
    active: true,
  },
];

const AIRCRAFT: AircraftSeed[] = [
  {
    code: 'HELI-LIGHT',
    type: 'Aircraft',
    name: 'Light Helicopter (Type 3, ~700 L)',
    description:
      'Light helicopter with belly tank or bucket. Fast cycle from close water; short line per drop.',
    dropLength: 60,
    turnaroundMinutes: 6,
    capacityLitres: 700,
    costPerHour: 2500,
    allowedTerrain: ['flat', 'medium', 'steep', 'very_steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub'],
    standard: true,
    active: true,
  },
  {
    code: 'HELI-MED',
    type: 'Aircraft',
    name: 'Medium Helicopter (Type 2, ~1500 L)',
    description:
      'Medium helicopter (e.g. Bell 212/412 class). Versatile across fuels and terrain.',
    dropLength: 120,
    turnaroundMinutes: 8,
    capacityLitres: 1500,
    costPerHour: 4500,
    allowedTerrain: ['flat', 'medium', 'steep', 'very_steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
    standard: true,
    active: true,
  },
  {
    code: 'HELI-HEAVY',
    type: 'Aircraft',
    name: 'Heavy Helicopter (Type 1, ~7500 L)',
    description:
      'Heavy helitanker (e.g. S-64 Aircrane / Chinook class). Large loads, long line per drop.',
    dropLength: 300,
    turnaroundMinutes: 12,
    capacityLitres: 7500,
    costPerHour: 22000,
    allowedTerrain: ['flat', 'medium', 'steep', 'very_steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
    standard: true,
    active: true,
  },
  {
    code: 'SEAT',
    type: 'Aircraft',
    name: 'Single Engine Air Tanker (SEAT, ~3000 L)',
    description:
      'Fixed-wing SEAT (e.g. AT-802 / Fire Boss). Good line-laying rate; needs airstrip or water for scooper.',
    dropLength: 250,
    turnaroundMinutes: 15,
    capacityLitres: 3000,
    costPerHour: 6000,
    allowedTerrain: ['flat', 'medium', 'steep', 'very_steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub'],
    standard: true,
    active: true,
  },
  {
    code: 'LAT',
    type: 'Aircraft',
    name: 'Large Air Tanker (LAT, ~15000 L)',
    description:
      'Large fixed-wing air tanker (e.g. RJ85 / B737 class). Long retardant lines; long cycle to base.',
    dropLength: 700,
    turnaroundMinutes: 40,
    capacityLitres: 15000,
    costPerHour: 18000,
    allowedTerrain: ['flat', 'medium', 'steep', 'very_steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
    standard: true,
    active: true,
  },
];

const HAND_CREWS: HandCrewSeed[] = [
  {
    code: 'CREW-STD',
    type: 'HandCrew',
    name: 'Standard Crew (5)',
    description:
      'Standard five-person crew with hand tools (rakehoes/McLeods). Hand line in grass to medium scrub.',
    crewSize: 5,
    clearingRatePerPerson: 30,
    equipmentList: ['rakehoes', 'mcleods', 'drip torch'],
    costPerHour: 250,
    allowedTerrain: ['flat', 'medium', 'steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub'],
    standard: true,
    active: true,
  },
  {
    code: 'CREW-CHAINSAW',
    type: 'HandCrew',
    name: 'Chainsaw Crew (4)',
    description:
      'Sawyer team for timbered fuels — slower line but capable in medium scrub and heavy forest.',
    crewSize: 4,
    clearingRatePerPerson: 22,
    equipmentList: ['chainsaws', 'rakehoes'],
    costPerHour: 280,
    allowedTerrain: ['flat', 'medium', 'steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
    standard: true,
    active: true,
  },
  {
    code: 'CREW-RAFT',
    type: 'HandCrew',
    name: 'Remote Area Firefighting Team (6)',
    description:
      'Winch/remote-insertion team for steep, inaccessible country. Works the ground machinery cannot reach.',
    crewSize: 6,
    clearingRatePerPerson: 25,
    equipmentList: ['chainsaws', 'rakehoes', 'pulaskis'],
    costPerHour: 360,
    allowedTerrain: ['flat', 'medium', 'steep', 'very_steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
    standard: true,
    active: true,
  },
  {
    code: 'CREW-STRIKE',
    type: 'HandCrew',
    name: 'Hand Crew Strike Team (20)',
    description:
      'Large 20-person crew (NWCG Type 1 equivalent) for sustained hand line on major breaks.',
    crewSize: 20,
    clearingRatePerPerson: 28,
    equipmentList: ['chainsaws', 'rakehoes', 'mcleods', 'pulaskis'],
    costPerHour: 1000,
    allowedTerrain: ['flat', 'medium', 'steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
    standard: true,
    active: true,
  },
];

/** All standard catalogue seeds (machinery, aircraft, hand crews). */
export const STANDARD_EQUIPMENT_SEEDS: StandardEquipmentSeed[] = [
  ...MACHINERY,
  ...AIRCRAFT,
  ...HAND_CREWS,
];

/**
 * Build the full standard catalogue as `Equipment[]` with deterministic ids,
 * initial version and timestamps. Timestamps are generated at build time so the
 * seeded rows carry a real createdAt/updatedAt.
 */
export function buildStandardEquipment(): Equipment[] {
  const now = timestamp();
  return STANDARD_EQUIPMENT_SEEDS.map((seed) => {
    const { code, ...rest } = seed;
    return {
      ...rest,
      id: standardEquipmentId(code),
      version: initialVersion(),
      createdAt: now,
      updatedAt: now,
    } as Equipment;
  });
}
