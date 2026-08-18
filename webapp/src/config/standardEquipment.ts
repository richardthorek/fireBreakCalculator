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
    sourceNote:
      'Rate/slope: order-of-magnitude consistent with grader-class fireline production in the NWCG production tables (grass fuel models); cost: indicative plant-hire figure, calibrate to local contract rates. Reviewed 2026-08-18, not independently re-derived from the primary table (see CALCULATION_REVIEW.md).',
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
    sourceNote:
      'NWCG Type 3 dozer class — rate/slope order-of-magnitude consistent with NWCG light-dozer production tables; cost is an indicative plant-hire figure. Reviewed 2026-08-18: corroborated, not chain-by-chain re-derived from the primary table.',
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
    sourceNote:
      'NWCG Type 2 dozer class; DELWP Report 56 (McCarthy, Tolhurst & Wouters) models D6/D7/D9 construction rate together from real fireground data (33 cases). Rate/slope order-of-magnitude consistent with both; cost indicative. Reviewed 2026-08-18: corroborated, not re-derived exactly.',
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
    sourceNote:
      'NWCG Type 1 dozer class; DELWP Report 56 groups D9-class machines with D6/D7 in its combined large-bulldozer model. Rate/slope order-of-magnitude consistent; cost indicative. Reviewed 2026-08-18: corroborated, not re-derived exactly.',
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
    sourceNote:
      'No direct NWCG/Report 56 excavator-with-rake table exists; rate is the project\'s own calibrated estimate (scaled down from dozer figures for broken/heavy-timber ground, add_machines.js), not a literature figure. Reviewed 2026-08-18: flagged for SME verification against local plant data.',
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
    sourceNote:
      'No published production table for mulching skid-steers on fireline. Rate/cost are the project\'s own estimate (add_machines.js), not from NWCG/Report 56/NAFC. Reviewed 2026-08-18: this is the least literature-grounded item in the machinery catalogue — verify against local plant-hire experience before relying on it.',
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
    sourceNote:
      'Tank capacity matches NAFC\'s light helicopter (Type 3) category, ~700 L belly tank/bucket. Drop length/turnaround/cost are indicative planning figures, not a published per-drop-length table — calibrate to local contract rates. Reviewed 2026-08-18.',
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
    sourceNote:
      'Tank capacity matches the Bell 212/412-class medium helitanker (NAFC Type 2), ~1,500 L. Drop length/turnaround/cost indicative planning figures — calibrate to local contract rates. Reviewed 2026-08-18.',
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
    sourceNote:
      'NAFC Type 1 heavy helitanker category; capacity rounded down slightly from the S-64 Aircrane\'s published ~8,000 L tank to a representative Type 1 figure. Drop length/turnaround/cost indicative — call-when-needed rates vary widely, override with the real contract rate. Reviewed 2026-08-18.',
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
    sourceNote:
      'Tank capacity matches the AT-802 Fire Boss\'s published ~3,000 L retardant/water tank (NAFC SEAT category). Drop length/turnaround/cost indicative planning figures — calibrate to local contract rates. Reviewed 2026-08-18.',
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
    sourceNote:
      '15,000 L sits within the published retardant-tank range for RJ85/B737-class Large Air Tankers (NAFC LAT category, typically 11,000-15,000 L). Drop length/turnaround/cost indicative — call-when-needed rates vary widely, override with the real contract rate. Reviewed 2026-08-18.',
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
    sourceNote:
      'DELWP Report 56 found average 6-person hand-crew rates of 90-120 m/crew/hour across mixed real fireground conditions (~15-20 m/person/hour), declining sharply with elevated fuel/steep terrain. This item\'s 30 m/person/hour is the FLAT GRASSLAND easiest-case reference rate the production model derates from (see file header), so a higher figure than Report 56\'s mixed-conditions average is expected — but it has not been checked against Report 56\'s own grassland-only subset. Reviewed 2026-08-18: order-of-magnitude plausible, flagged for closer SME check.',
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
    sourceNote:
      'Rate reduced from the standard hand crew (CREW-STD) per NWCG\'s general timbered-fuel hand-line derating for sawyer/chainsaw teams; not independently checked against a specific published sawyer-crew production table. Reviewed 2026-08-18: order-of-magnitude plausible, uncited exact figure.',
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
    sourceNote:
      'No published production table specific to remote/winch-insertion RAFT teams was found; rate is the project\'s own estimate, positioned between CREW-STD and CREW-CHAINSAW for steep/inaccessible ground. Reviewed 2026-08-18: the least literature-grounded item in the hand-crew catalogue — verify against agency RAFT operational data.',
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
    sourceNote:
      'NWCG Type 1 20-person crew — the NWCG 2021 Fire Line Production Rate Tables express 20-person crew rates in chains/hour by fuel model; this per-person figure is order-of-magnitude consistent but was not re-derived chain-by-chain from the primary table for this review. Reviewed 2026-08-18.',
    crewSize: 20,
    clearingRatePerPerson: 28,
    equipmentList: ['chainsaws', 'rakehoes', 'mcleods', 'pulaskis'],
    costPerHour: 1000,
    allowedTerrain: ['flat', 'medium', 'steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
  }),
];
