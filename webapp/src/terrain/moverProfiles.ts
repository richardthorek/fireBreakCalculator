/**
 * Mover profile catalogue — Terrain Mobility & Counter-Mobility mode.
 *
 * Every figure here is sourced (see `source`) and carries an honest
 * `confidence`. Where an ADF-relevant class's real specification could not be
 * reliably cited from open material, the profile is entered as a GENERIC
 * width/weight class rather than a guessed number for a named platform — see
 * docs/ROUTE_INTELLIGENCE.md §11.8 for the owner decision behind that rule.
 *
 * Slope limits are stored in DEGREES (not percent grade) to match the rest of
 * this codebase (`calculateSlope`, `DEFAULT_MAX_SLOPE_DEGREES` in
 * api/src/services/productionModel.ts both use degrees). Doctrine states its
 * anchors in percent grade — 7% ≈ 4.0°, 45% ≈ 24.2° — the conversion is noted
 * in each profile's `source` comment so a percent-grade figure can still be
 * traced back to its doctrinal origin.
 */

export type MoverFamily = 'foot' | 'auFleet' | 'adf' | 'generic';
export type MoverKind = 'foot-individual' | 'foot-unit' | 'wheeled' | 'tracked';

/**
 * How this profile's speed-vs-slope relationship is computed (see
 * `mobilityCost.ts`). Individual foot movement and unit/vehicle movement are
 * DELIBERATELY two different model families — a unit's doctrinal march rate
 * already bakes in column effects, halts and planning conservatism that an
 * individual's measured walking speed does not (docs §11.2).
 */
export type SpeedModel =
  /** Irmischer & Clarke 2018 off-path function — measured on USMA cadets
   *  navigating hilly, wooded terrain on foot. The only widely-used
   *  slope-speed function calibrated off-path on a military cohort, so it is
   *  the primary individual model. v(m/s) = 0.11 + exp(-(100s+2)^2/1800). */
  | 'irmischer-clarke-offpath'
  /** Tobler's hiking function — cross-check / "prefers easy ground" variant.
   *  v(km/h) = 6*exp(-3.5*|s+0.05|). On-path, no vegetation term. */
  | 'tobler'
  /** Doctrinal unit march rate: `roadSpeedKmh` on trail, ×`crossCountryFactor`
   *  off trail, ×`nightFactor` at night — the correct model for a UNIT (not
   *  an individual) on foot. Source: US Army foot-march doctrine. */
  | 'doctrinal-unit-march'
  /** Vehicle: `roadSpeedKmh` on trail, ×`crossCountryFactor` off trail
   *  (estimated per-profile — no citable open source gives vehicle-specific
   *  cross-country speed ratios, only the qualitative doctrinal slope
   *  anchors), ×`nightFactor` at night. */
  | 'vehicle-gradient';

export type ProfileConfidence = 'measured' | 'published' | 'estimated' | 'generic-fallback';

export interface MoverProfile {
  id: string;
  label: string;
  family: MoverFamily;
  kind: MoverKind;
  speedModel: SpeedModel;

  /** Overall width including a real-world margin (mirrors, driver skill),
   *  metres. Binding constraint for WHEELED profiles (percolation / widest
   *  available gap — docs §11.4). */
  widthM: number;
  /** TRACKED profiles only: stems at/below this diameter can be overridden
   *  (pushed through) rather than avoided — the binding constraint for
   *  tracked movement is override force, not gap width (docs §11.4). Absent
   *  for wheeled profiles, which are gap-width-limited instead. */
  overrideStemDiameterMm?: number;

  /** Sustained climb-slope limit, degrees. */
  maxClimbDeg: number;
  /** Cross/side-slope (rollover) limit, degrees — usually the stricter of
   *  the two for wheeled vehicles with a high centre of gravity. */
  maxSideSlopeDeg: number;

  /** Baseline speed on a mapped trail/road, km/h. For the two individual foot
   *  speed models this is informational only (their speed is computed
   *  directly from slope) rather than consumed as a multiplier base. */
  roadSpeedKmh: number;
  /** Off-trail speed multiplier vs `roadSpeedKmh` (0–1). */
  crossCountryFactor: number;
  /** Night / limited-visibility speed multiplier (0–1), applied on top of
   *  whichever of the above already applies. */
  nightFactor: number;
  /** Additional multiplier for a laden/loaded variant of a foot profile
   *  (0–1, default 1.0 i.e. no penalty). Kept separate from the slope-speed
   *  formula itself since neither Tobler nor Irmischer & Clarke take load as
   *  a parameter — this is a Pandolf-derived relative penalty only, per the
   *  published-error caveat on that profile. */
  loadPenaltyFactor?: number;

  /** Unprepared fording depth, metres, where relevant. */
  fordingDepthM?: number;

  confidence: ProfileConfidence;
  source: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Foot — done properly: individual movement and unit movement are different
// models (docs §11.2, §11.8).
// ---------------------------------------------------------------------------

const FOOT_PROFILES: MoverProfile[] = [
  {
    id: 'foot-individual-unladen',
    label: 'Individual, unladen',
    family: 'foot',
    kind: 'foot-individual',
    speedModel: 'irmischer-clarke-offpath',
    widthM: 0.6,
    maxClimbDeg: 45,
    maxSideSlopeDeg: 45,
    roadSpeedKmh: 5.0,
    crossCountryFactor: 1.0, // unused — speed is computed directly from slope
    nightFactor: 0.67,
    confidence: 'published',
    source: 'Irmischer & Clarke (2018), "Measuring and modeling the speed of human navigation" — measured off-path on USMA cadets in hilly, wooded terrain.',
    notes: 'Off-path function; on-path (Tobler) is faster and available as a cross-check in mobilityCost.ts.',
  },
  {
    id: 'foot-individual-laden',
    label: 'Individual, laden (~25 kg)',
    family: 'foot',
    kind: 'foot-individual',
    speedModel: 'irmischer-clarke-offpath',
    widthM: 0.7,
    maxClimbDeg: 40,
    maxSideSlopeDeg: 40,
    roadSpeedKmh: 4.3,
    crossCountryFactor: 1.0,
    nightFactor: 0.67,
    loadPenaltyFactor: 0.85,
    confidence: 'estimated',
    source: 'Irmischer & Clarke (2018) base speed, with a Pandolf-equation (1977, Soule & Goldman 1972 terrain coefficients) load-carriage penalty applied in mobilityCost.ts.',
    notes: 'Pandolf is published as 12–33% error vs contemporary military load carriage (Drain & Aisbett et al.) and under-predicts modern loads — used only as a relative penalty and for endurance comparison, never as an absolute time or energy claim.',
  },
  {
    id: 'foot-unit',
    label: 'Dismounted unit (section/patrol)',
    family: 'foot',
    kind: 'foot-unit',
    speedModel: 'doctrinal-unit-march',
    widthM: 3.0, // column width allowance, not a per-person figure
    maxClimbDeg: 40,
    maxSideSlopeDeg: 40,
    roadSpeedKmh: 4.0,
    crossCountryFactor: 0.6, // 2.4–2.6 km/h cross-country ÷ 4.0 km/h road
    nightFactor: 0.67, // 1.6 km/h cross-country night ÷ 2.4 km/h cross-country day
    confidence: 'published',
    source: 'US Army foot-march doctrine (FM 21-18, superseded by ATP 3-21.18): roads 4.0 km/h day / 3.2 km/h limited visibility; cross-country 2.4–2.6 km/h day / 1.6 km/h night; 20–32 km per 24 h on 5–8 h marching.',
    notes: 'A unit is not an individual — doctrinal rates already include column effects, halts and planning conservatism. Simplification: doctrine\'s on-road night factor is milder (3.2/4.0=0.80) than the cross-country-derived one (1.6/2.4≈0.67); this profile applies the more conservative 0.67 uniformly on- and off-trail rather than modelling both, flagged here rather than silently.',
  },
];

// ---------------------------------------------------------------------------
// AU agency / civilian fleet — the vehicles the StationKit fire audience
// actually operates. Tracked plant figures reuse the SAME NWCG-class slope
// limits already in webapp/src/config/standardEquipment.ts so the two parts
// of the app stay internally consistent rather than asserting two numbers
// for the same machine class.
// ---------------------------------------------------------------------------

const AU_FLEET_PROFILES: MoverProfile[] = [
  {
    id: 'au-light-4wd',
    label: 'Light 4WD (ute/wagon, LandCruiser 70 / Hilux class)',
    family: 'auFleet',
    kind: 'wheeled',
    speedModel: 'vehicle-gradient',
    widthM: 2.1, // ~1.87–1.90 m published body width + mirror/driving margin
    maxClimbDeg: 22, // ≈ doctrine's 45% ("impedes movement") grade anchor
    maxSideSlopeDeg: 18,
    roadSpeedKmh: 60,
    crossCountryFactor: 0.35,
    nightFactor: 0.7,
    fordingDepthM: 0.7,
    confidence: 'estimated',
    source: 'Width: manufacturer-published body dimensions (Toyota LandCruiser 70-series / Hilux class, ~1.87 m). Slope anchors: doctrinal cross-country classification (FM 5-33 lineage) — 7% grade (≈4°) as the general vehicle-obstruction threshold, 45% grade (≈24.2°) as the cross-terrain impedance threshold.',
    notes: 'crossCountryFactor and nightFactor are ESTIMATED, not doctrinally sourced — no open reference gives vehicle-specific cross-country speed ratios the way foot-march doctrine does for a unit on foot. Flagged rather than presented as published.',
  },
  {
    id: 'au-medium-truck',
    label: 'Medium truck (tanker/support class)',
    family: 'auFleet',
    kind: 'wheeled',
    speedModel: 'vehicle-gradient',
    widthM: 2.6,
    maxClimbDeg: 16,
    maxSideSlopeDeg: 12,
    roadSpeedKmh: 55,
    crossCountryFactor: 0.2,
    nightFactor: 0.7,
    fordingDepthM: 0.5,
    confidence: 'estimated',
    source: 'Width: typical medium rigid-truck chassis (fire tanker/support class). Slope anchors: doctrinal cross-country classification, as above.',
    notes: 'Generic medium-truck class figure, not a specific named model.',
  },
  {
    id: 'au-medium-dozer',
    label: 'Medium Dozer (D6/D7 class)',
    family: 'auFleet',
    kind: 'tracked',
    speedModel: 'vehicle-gradient',
    widthM: 3.3, // blade width
    overrideStemDiameterMm: 200,
    maxClimbDeg: 25, // same figure as webapp/src/config/standardEquipment.ts's Medium Dozer entry
    maxSideSlopeDeg: 20,
    roadSpeedKmh: 10,
    crossCountryFactor: 0.6,
    nightFactor: 0.8,
    confidence: 'published',
    source: 'Slope limit reused directly from this app\'s own equipment catalogue (webapp/src/config/standardEquipment.ts, "Medium Dozer (D6/D7 class)", maxSlope: 25) so the fire and mobility modes agree on the same machine class rather than asserting two figures.',
  },
  {
    id: 'au-heavy-dozer',
    label: 'Heavy Dozer (D8/D9 class)',
    family: 'auFleet',
    kind: 'tracked',
    speedModel: 'vehicle-gradient',
    widthM: 3.7,
    overrideStemDiameterMm: 300,
    maxClimbDeg: 30, // matches standardEquipment.ts's Heavy Dozer entry
    maxSideSlopeDeg: 22,
    roadSpeedKmh: 8,
    crossCountryFactor: 0.6,
    nightFactor: 0.8,
    confidence: 'published',
    source: 'Slope limit reused directly from webapp/src/config/standardEquipment.ts, "Heavy Dozer (D8/D9 class)", maxSlope: 30.',
  },
];

// ---------------------------------------------------------------------------
// ADF-relevant vehicle classes. Deliberately GENERIC (class-representative
// dimensions, not a specific named platform's specifications) — per docs
// §11.8, where a real figure could not be reliably sourced from open
// material the profile falls back to its width/weight class rather than an
// invented number. None of these should be read as describing any
// particular in-service ADF vehicle.
// ---------------------------------------------------------------------------

const ADF_PROFILES: MoverProfile[] = [
  {
    id: 'adf-light-wheeled',
    label: 'Light wheeled patrol/utility (generic class)',
    family: 'adf',
    kind: 'wheeled',
    speedModel: 'vehicle-gradient',
    widthM: 2.1,
    maxClimbDeg: 22,
    maxSideSlopeDeg: 16,
    roadSpeedKmh: 70,
    crossCountryFactor: 0.35,
    nightFactor: 0.65,
    fordingDepthM: 0.75,
    confidence: 'generic-fallback',
    source: 'Class-representative figure for a light wheeled military utility vehicle. Not a specific named platform\'s published specification.',
  },
  {
    id: 'adf-medium-pmv',
    label: 'Medium protected mobility vehicle (generic class, wheeled)',
    family: 'adf',
    kind: 'wheeled',
    speedModel: 'vehicle-gradient',
    widthM: 2.5,
    maxClimbDeg: 20,
    maxSideSlopeDeg: 14,
    roadSpeedKmh: 60,
    crossCountryFactor: 0.3,
    nightFactor: 0.65,
    fordingDepthM: 1.0,
    confidence: 'generic-fallback',
    source: 'Class-representative figure for a medium protected wheeled vehicle. Not a specific named platform\'s published specification.',
    notes: 'Side-slope limit set stricter than a civilian light 4WD — a reasonable general engineering inference for a higher-centre-of-gravity protected vehicle, not a measured figure.',
  },
  {
    id: 'adf-heavy-pmv',
    label: 'Heavy protected mobility vehicle (generic class, wheeled)',
    family: 'adf',
    kind: 'wheeled',
    speedModel: 'vehicle-gradient',
    widthM: 2.7,
    maxClimbDeg: 18,
    maxSideSlopeDeg: 12,
    roadSpeedKmh: 50,
    crossCountryFactor: 0.25,
    nightFactor: 0.65,
    fordingDepthM: 1.0,
    confidence: 'generic-fallback',
    source: 'Class-representative figure for a heavy protected wheeled vehicle. Not a specific named platform\'s published specification.',
  },
  {
    id: 'adf-tracked-ifv',
    label: 'Tracked armoured vehicle (generic class, IFV/APC)',
    family: 'adf',
    kind: 'tracked',
    speedModel: 'vehicle-gradient',
    widthM: 3.2,
    overrideStemDiameterMm: 250,
    maxClimbDeg: 30,
    maxSideSlopeDeg: 20,
    roadSpeedKmh: 50,
    crossCountryFactor: 0.5,
    nightFactor: 0.7,
    fordingDepthM: 1.2,
    confidence: 'generic-fallback',
    source: 'Class-representative figure for a tracked IFV/APC. overrideStemDiameterMm is EXTRAPOLATED from Mason et al. (2012) override-force literature and recent robotic off-road work demonstrating controlled override to ~82 mm on a much lighter test platform — scaled up for a heavier tracked vehicle, not measured for this class. Not a specific named platform\'s specification.',
  },
  {
    id: 'adf-tracked-heavy-armour',
    label: 'Heavy tracked armour (generic class, MBT)',
    family: 'adf',
    kind: 'tracked',
    speedModel: 'vehicle-gradient',
    widthM: 3.7,
    overrideStemDiameterMm: 400,
    maxClimbDeg: 30,
    maxSideSlopeDeg: 19,
    roadSpeedKmh: 45,
    crossCountryFactor: 0.45,
    nightFactor: 0.7,
    fordingDepthM: 1.2,
    confidence: 'generic-fallback',
    source: 'Class-representative figure for a main battle tank class vehicle. overrideStemDiameterMm is extrapolated the same way as adf-tracked-ifv, for a heavier platform. Unprepared fording only — deep-wading kit capability not assumed. Not a specific named platform\'s specification.',
  },
];

// ---------------------------------------------------------------------------
// Generic width/weight fallback classes — the explicit "we can't source a
// real spec" answer (docs §11.8), usable standalone or as a substitute for
// any profile above whose confidence is too low for a given deployment.
// ---------------------------------------------------------------------------

const GENERIC_PROFILES: MoverProfile[] = [
  {
    id: 'generic-light-wheeled',
    label: 'Generic light wheeled (≤2.2 m)',
    family: 'generic',
    kind: 'wheeled',
    speedModel: 'vehicle-gradient',
    widthM: 2.2,
    maxClimbDeg: 20,
    maxSideSlopeDeg: 16,
    roadSpeedKmh: 60,
    crossCountryFactor: 0.35,
    nightFactor: 0.7,
    confidence: 'generic-fallback',
    source: 'Generic width/weight class band, used when no specific vehicle spec is available or citable.',
  },
  {
    id: 'generic-medium-wheeled',
    label: 'Generic medium wheeled (2.2–2.6 m)',
    family: 'generic',
    kind: 'wheeled',
    speedModel: 'vehicle-gradient',
    widthM: 2.6,
    maxClimbDeg: 18,
    maxSideSlopeDeg: 14,
    roadSpeedKmh: 55,
    crossCountryFactor: 0.3,
    nightFactor: 0.7,
    confidence: 'generic-fallback',
    source: 'Generic width/weight class band, used when no specific vehicle spec is available or citable.',
  },
  {
    id: 'generic-heavy-wheeled',
    label: 'Generic heavy wheeled (>2.6 m)',
    family: 'generic',
    kind: 'wheeled',
    speedModel: 'vehicle-gradient',
    widthM: 2.9,
    maxClimbDeg: 16,
    maxSideSlopeDeg: 12,
    roadSpeedKmh: 50,
    crossCountryFactor: 0.25,
    nightFactor: 0.7,
    confidence: 'generic-fallback',
    source: 'Generic width/weight class band, used when no specific vehicle spec is available or citable.',
  },
  {
    id: 'generic-tracked-light',
    label: 'Generic tracked (light plant)',
    family: 'generic',
    kind: 'tracked',
    speedModel: 'vehicle-gradient',
    widthM: 2.8,
    overrideStemDiameterMm: 150,
    maxClimbDeg: 22,
    maxSideSlopeDeg: 18,
    roadSpeedKmh: 12,
    crossCountryFactor: 0.6,
    nightFactor: 0.8,
    confidence: 'generic-fallback',
    source: 'Generic width/weight class band, used when no specific vehicle spec is available or citable.',
  },
  {
    id: 'generic-tracked-heavy',
    label: 'Generic tracked (heavy plant/armour)',
    family: 'generic',
    kind: 'tracked',
    speedModel: 'vehicle-gradient',
    widthM: 3.5,
    overrideStemDiameterMm: 300,
    maxClimbDeg: 28,
    maxSideSlopeDeg: 20,
    roadSpeedKmh: 40,
    crossCountryFactor: 0.5,
    nightFactor: 0.75,
    confidence: 'generic-fallback',
    source: 'Generic width/weight class band, used when no specific vehicle spec is available or citable.',
  },
];

export const MOVER_PROFILES: MoverProfile[] = [
  ...FOOT_PROFILES,
  ...AU_FLEET_PROFILES,
  ...ADF_PROFILES,
  ...GENERIC_PROFILES,
];

export function getMoverProfile(id: string): MoverProfile | undefined {
  return MOVER_PROFILES.find(p => p.id === id);
}

export function listMoverProfiles(family?: MoverFamily): MoverProfile[] {
  return family ? MOVER_PROFILES.filter(p => p.family === family) : MOVER_PROFILES;
}

export const DEFAULT_MOVER_PROFILE_ID = 'foot-unit';
