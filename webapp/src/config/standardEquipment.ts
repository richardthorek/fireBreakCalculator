/**
 * Frontend mirror of the built-in standard equipment catalogue.
 *
 * The backend (api/src/data/standardEquipment.ts) is the source of truth and
 * seeds these into Table Storage automatically, so a live deployment serves
 * them from the API. This mirror is a resilient fallback: it lets the UI show
 * the standard catalogue when the API is unavailable (local dev without the
 * Functions host) or returns an empty list, so the equipment lists and
 * estimates are never blank. IDs match the backend (`STD-<code>`) so once the
 * backend seeds, client and server refer to the same items.
 *
 * Units mirror the backend contract: machinery `clearingRate` and hand-crew
 * `clearingRatePerPerson` are metres/hour of single-pass line in flat grassland
 * (the production model derates other fuels/slopes); aircraft `dropLength` is
 * metres of line per drop at grassland coverage. See the backend file header
 * for sourcing (NWCG, DELWP Report 56, NAFC aircraft categories).
 *
 * COST HONESTY: the `costPerHour` figures below are indicative planning rates,
 * not a live price feed. They carry no automatic update and will drift from
 * real agency/contractor rates over time. The basis (currency + as-of month)
 * is declared once in `COST_BASIS` (config/provenance.ts) and stamped into
 * every export so a reader knows the vintage. Review the rates when COST_BASIS
 * is bumped.
 */

import { EquipmentApi } from '../types/equipmentApi';
export { COST_BASIS } from './provenance';

const STANDARD_TS = '2024-01-01T00:00:00.000Z';

const base = (
  id: string,
  overrides: Partial<EquipmentApi> & Pick<EquipmentApi, 'type' | 'name'>
): EquipmentApi =>
  ({
    id: `STD-${id}`,
    description: '',
    allowedTerrain: [],
    allowedVegetation: [],
    active: true,
    standard: true,
    version: 1,
    createdAt: STANDARD_TS,
    updatedAt: STANDARD_TS,
    ...overrides,
  } as EquipmentApi);

export const STANDARD_EQUIPMENT: EquipmentApi[] = [
  // ---- Machinery ----
  base('GRADER', {
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
  }),
  base('DOZER-LIGHT', {
    type: 'Machinery',
    name: 'Light Dozer (D4/D5 class)',
    description: 'Small tracked dozer (NWCG Type 3). Agile on light-to-medium fuels and gentle-to-moderate slopes.',
    clearingRate: 700,
    cutWidthMeters: 2.7,
    maxSlope: 20,
    costPerHour: 220,
    allowedTerrain: ['flat', 'medium'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub'],
  }),
  base('DOZER-MED', {
    type: 'Machinery',
    name: 'Medium Dozer (D6/D7 class)',
    description: 'Medium tracked dozer (NWCG Type 2). Workhorse fireline machine across most fuels and slopes.',
    clearingRate: 950,
    cutWidthMeters: 3.4,
    maxSlope: 25,
    costPerHour: 320,
    allowedTerrain: ['flat', 'medium', 'steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
  }),
  base('DOZER-HEAVY', {
    type: 'Machinery',
    name: 'Heavy Dozer (D8/D9 class)',
    description: 'Large tracked dozer (NWCG Type 1). Pushes through heavy timber and works steep ground; highest cost.',
    clearingRate: 1200,
    cutWidthMeters: 4.3,
    maxSlope: 30,
    costPerHour: 450,
    allowedTerrain: ['flat', 'medium', 'steep', 'very_steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
  }),
  base('EXCAVATOR', {
    type: 'Machinery',
    name: 'Tracked Excavator (20t, rake/bucket)',
    description: 'Tracked excavator with rake or bucket — effective in heavy timber and on broken ground where dozers struggle.',
    clearingRate: 600,
    cutWidthMeters: 2.5,
    maxSlope: 25,
    costPerHour: 280,
    allowedTerrain: ['flat', 'medium', 'steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
  }),
  base('POSITRACK', {
    type: 'Machinery',
    name: 'Tracked Skid-Steer (mulching head)',
    description: 'Compact tracked loader with mulching/slashing head — good access, narrow line in grass and light-to-medium fuels.',
    clearingRate: 500,
    cutWidthMeters: 1.8,
    maxSlope: 20,
    costPerHour: 180,
    allowedTerrain: ['flat', 'medium'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub'],
  }),

  // ---- Aircraft ----
  base('HELI-LIGHT', {
    type: 'Aircraft',
    name: 'Light Helicopter (Type 3, ~700 L)',
    description: 'Light helicopter with belly tank or bucket. Fast cycle from close water; short line per drop.',
    dropLength: 60,
    turnaroundMinutes: 6,
    capacityLitres: 700,
    costPerHour: 2500,
    allowedTerrain: ['flat', 'medium', 'steep', 'very_steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub'],
  }),
  base('HELI-MED', {
    type: 'Aircraft',
    name: 'Medium Helicopter (Type 2, ~1500 L)',
    description: 'Medium helicopter (e.g. Bell 212/412 class). Versatile across fuels and terrain.',
    dropLength: 120,
    turnaroundMinutes: 8,
    capacityLitres: 1500,
    costPerHour: 4500,
    allowedTerrain: ['flat', 'medium', 'steep', 'very_steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
  }),
  base('HELI-HEAVY', {
    type: 'Aircraft',
    name: 'Heavy Helicopter (Type 1, ~7500 L)',
    description: 'Heavy helitanker (e.g. S-64 Aircrane / Chinook class). Large loads, long line per drop.',
    dropLength: 300,
    turnaroundMinutes: 12,
    capacityLitres: 7500,
    costPerHour: 22000,
    allowedTerrain: ['flat', 'medium', 'steep', 'very_steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
  }),
  base('SEAT', {
    type: 'Aircraft',
    name: 'Single Engine Air Tanker (SEAT, ~3000 L)',
    description: 'Fixed-wing SEAT (e.g. AT-802 / Fire Boss). Good line-laying rate; needs airstrip or water for scooper.',
    dropLength: 250,
    turnaroundMinutes: 15,
    capacityLitres: 3000,
    costPerHour: 6000,
    allowedTerrain: ['flat', 'medium', 'steep', 'very_steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub'],
  }),
  base('LAT', {
    type: 'Aircraft',
    name: 'Large Air Tanker (LAT, ~15000 L)',
    description: 'Large fixed-wing air tanker (e.g. RJ85 / B737 class). Long retardant lines; long cycle to base.',
    dropLength: 700,
    turnaroundMinutes: 40,
    capacityLitres: 15000,
    costPerHour: 18000,
    allowedTerrain: ['flat', 'medium', 'steep', 'very_steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
  }),

  // ---- Hand Crews ----
  base('CREW-STD', {
    type: 'HandCrew',
    name: 'Standard Crew (5)',
    description: 'Standard five-person crew with hand tools (rakehoes/McLeods). Hand line in grass to medium scrub.',
    crewSize: 5,
    clearingRatePerPerson: 30,
    equipmentList: ['rakehoes', 'mcleods', 'drip torch'],
    costPerHour: 250,
    allowedTerrain: ['flat', 'medium', 'steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub'],
  }),
  base('CREW-CHAINSAW', {
    type: 'HandCrew',
    name: 'Chainsaw Crew (4)',
    description: 'Sawyer team for timbered fuels — slower line but capable in medium scrub and heavy forest.',
    crewSize: 4,
    clearingRatePerPerson: 22,
    equipmentList: ['chainsaws', 'rakehoes'],
    costPerHour: 280,
    allowedTerrain: ['flat', 'medium', 'steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
  }),
  base('CREW-RAFT', {
    type: 'HandCrew',
    name: 'Remote Area Firefighting Team (6)',
    description: 'Winch/remote-insertion team for steep, inaccessible country. Works the ground machinery cannot reach.',
    crewSize: 6,
    clearingRatePerPerson: 25,
    equipmentList: ['chainsaws', 'rakehoes', 'pulaskis'],
    costPerHour: 360,
    allowedTerrain: ['flat', 'medium', 'steep', 'very_steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
  }),
  base('CREW-STRIKE', {
    type: 'HandCrew',
    name: 'Hand Crew Strike Team (20)',
    description: 'Large 20-person crew (NWCG Type 1 equivalent) for sustained hand line on major breaks.',
    crewSize: 20,
    clearingRatePerPerson: 28,
    equipmentList: ['chainsaws', 'rakehoes', 'mcleods', 'pulaskis'],
    costPerHour: 1000,
    allowedTerrain: ['flat', 'medium', 'steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
  }),
];
