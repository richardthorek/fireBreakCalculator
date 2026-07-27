/**
 * Road-class speed model — Terrain Mobility Slice A (docs/ROUTE_INTELLIGENCE.md
 * §35 "Slice A — road network graph: full design").
 *
 * Composes a vehicle speed CEILING for one OSM way from its `highway`,
 * `surface`, `tracktype` and `smoothness` tags — the tags this app already
 * fetches (`infrastructureService.ts`'s `highway-mobility` kind) but, until
 * now, discarded after reducing them to a single `kind` string.
 *
 * SOURCE: the OSRM (Project-OSRM/osrm-backend) `car.lua` and `foot.lua`
 * routing profiles, values read from the repository 2026-07-27. Chosen
 * because they are open, independently verifiable, in production routing
 * use worldwide, and — decisively — keyed to the EXACT OSM tags this app
 * already fetches, so no translation layer is needed.
 *
 * WHAT THIS IS NOT: the NATO Reference Mobility Model (NRMM) is the
 * doctrinal reference for off-road speed prediction, but it is a physics
 * model requiring vehicle-specific parameters (cone index, power-to-weight,
 * track/tyre geometry) this app has no source for. Referenced as prior art
 * only; claiming to implement it here would be a fabrication.
 *
 * CAVEAT that must travel with every result: OSRM's tables encode CIVILIAN
 * DRIVING speeds — legal/practical road speeds, not military off-road
 * capability. For the denial use case that is arguably the right model (you
 * care how an approaching vehicle actually drives, not its spec sheet), but
 * it must be labelled as such, never presented as a military-mobility
 * figure.
 *
 * FOOT IS DELIBERATELY NOT MODULATED BY ROAD CLASS. OSRM's foot profile is a
 * flat 5 km/h across every highway class (only surface caps it: gravel-family
 * → 3.75, mud/sand → 2.5) — road class barely affects walking speed. Foot
 * movers keep their existing Irmischer & Clarke (2018) slope-speed model
 * (mobilityCost.ts) unchanged; nothing here should ever be applied to a
 * `foot-individual`/`foot-unit` profile. Applying a car speed table to a foot
 * mover would be a fabrication this module has no basis for.
 */

/** Speed by OSM `highway` tag, km/h — OSRM car.lua `speeds` table.
 *  Deliberately has NO entry for `track`/`path`/`road`: OSRM's own car
 *  profile does not give those a class-based speed either — a track's real
 *  speed comes from its `surface`/`tracktype` tags, not from being called a
 *  "track". See `UNTAGGED_TRACK_FALLBACK_KMH` for what happens when even
 *  those are absent. */
export const HIGHWAY_SPEED_KMH: Readonly<Record<string, number>> = {
  motorway: 90,
  motorway_link: 45,
  trunk: 85,
  trunk_link: 40,
  primary: 65,
  primary_link: 30,
  secondary: 55,
  secondary_link: 25,
  tertiary: 40,
  tertiary_link: 20,
  unclassified: 25,
  residential: 25,
  living_street: 10,
  service: 15,
};

/** Speed CAP by OSM `surface` tag, km/h — OSRM car.lua `surface_speeds`.
 *  Premium surfaces (asphalt/concrete/paved and variants) are uncapped in
 *  OSRM (no entry here means "no cap from this tag", not "impassable" — see
 *  `roadClassCeiling`). */
export const SURFACE_SPEED_CAP_KMH: Readonly<Record<string, number>> = {
  cement: 80,
  compacted: 80,
  fine_gravel: 80,
  paving_stones: 60,
  metal: 60,
  bricks: 60,
  grass: 40,
  wood: 40,
  sett: 40,
  gravel: 40,
  unpaved: 40,
  ground: 40,
  dirt: 40,
  pebblestone: 40,
  tartan: 40,
  cobblestone: 30,
  clay: 30,
  earth: 20,
  stone: 20,
  rocky: 20,
  sand: 20,
  laterite: 15,
  mud: 10,
  ice: 20,
  snow: 30,
};

/** Speed CAP by OSM `tracktype` tag, km/h — OSRM car.lua `tracktype_speeds`.
 *  Only meaningful on `highway=track` ways, but harmless to look up
 *  regardless — a way that carries `tracktype` without `highway=track` is a
 *  tagging quirk, not something this function needs to police. */
export const TRACKTYPE_SPEED_CAP_KMH: Readonly<Record<string, number>> = {
  grade1: 60,
  grade2: 40,
  grade3: 30,
  grade4: 25,
  grade5: 20,
};

/** Speed CAP by OSM `smoothness` tag, km/h — OSRM car.lua `smoothness_speeds`.
 *  `impassable: 0` is a genuine, SOURCED NO-GO — the first road gate in this
 *  app that is not engineering judgement. */
export const SMOOTHNESS_SPEED_CAP_KMH: Readonly<Record<string, number>> = {
  intermediate: 80,
  bad: 40,
  very_bad: 20,
  horrible: 10,
  very_horrible: 5,
  impassable: 0,
};

/** When a `track`/`path`/`road` way carries NONE of surface/tracktype/
 *  smoothness, there is no sourced number to derive a speed from at all.
 *  Rather than invent one, this falls back to the middle of the OSRM
 *  tracktype scale (grade3, "even mixture of hard and soft materials") as a
 *  documented, clearly-flagged Tier 0 assumption — the same honesty
 *  discipline `mobilityCost.ts`'s `estimateFordingRequirement` already
 *  applies to a missing signal. NEVER reported as `published`. */
export const UNTAGGED_TRACK_FALLBACK_KMH = TRACKTYPE_SPEED_CAP_KMH.grade3;

export type RoadClassConfidence = 'published' | 'estimated' | 'user-override';

export interface RoadClassResult {
  /** The speed ceiling this way's tags imply, km/h. Compose with a mover
   *  profile's own capability via `min(profile.roadSpeedKmh, result.speedKmh)`
   *  — this is a ceiling the ROAD imposes, not the vehicle's own speed. */
  speedKmh: number;
  confidence: RoadClassConfidence;
  source: string;
}

/** One way's relevant OSM tags — matches `InfrastructureTrail`'s shape from
 *  both `infrastructureService.ts` copies, kept as a separate minimal type
 *  here so this module has no import dependency on either. */
export interface RoadWayTags {
  highway?: string;
  surface?: string;
  tracktype?: string;
  smoothness?: string;
}

/** User overrides, keyed by the same tag values as the tables above. A
 *  present key wins outright over the sourced default for that table;
 *  absent keys fall through to the sourced value. Flips `confidence` to
 *  `'user-override'` for any component that came from an override. */
export interface RoadSpeedOverrides {
  highway?: Partial<Record<string, number>>;
  surface?: Partial<Record<string, number>>;
  tracktype?: Partial<Record<string, number>>;
  smoothness?: Partial<Record<string, number>>;
}

interface Component {
  speedKmh: number;
  confidence: RoadClassConfidence;
  source: string;
}

function lookup(
  table: Readonly<Record<string, number>>,
  overrideTable: Partial<Record<string, number>> | undefined,
  tagName: 'highway' | 'surface' | 'tracktype' | 'smoothness',
  tagValue: string | undefined,
  publishedLabel: string
): Component | null {
  if (!tagValue) return null;
  const overridden = overrideTable?.[tagValue];
  if (overridden !== undefined) {
    return { speedKmh: overridden, confidence: 'user-override', source: `user override for ${tagName}=${tagValue}` };
  }
  const sourced = table[tagValue];
  if (sourced === undefined) return null;
  return { speedKmh: sourced, confidence: 'published', source: `${publishedLabel} (${tagName}=${tagValue})` };
}

/**
 * The vehicle speed ceiling one OSM way's tags imply, km/h — the min across
 * whichever of highway/surface/tracktype/smoothness are present, each
 * capable of being user-overridden independently. Returns `null` only when
 * NOTHING useful is tagged at all (a bare, untagged way with none of the
 * four tags) — callers should treat that as "no road-class data", not zero.
 *
 * Composition, not replacement: this is a ceiling the ROAD imposes. A
 * mover's own capability (`MoverProfile.roadSpeedKmh`) is a separate,
 * independent ceiling — take `min()` of both, never substitute one for the
 * other. See the module header for why foot profiles must never pass
 * through this function at all.
 */
export function roadClassCeiling(way: RoadWayTags, overrides?: RoadSpeedOverrides): RoadClassResult | null {
  const components: Component[] = [];

  const highway = lookup(HIGHWAY_SPEED_KMH, overrides?.highway, 'highway', way.highway, 'OSRM car profile highway speed');
  if (highway) components.push(highway);

  const surface = lookup(SURFACE_SPEED_CAP_KMH, overrides?.surface, 'surface', way.surface, 'OSRM car profile surface cap');
  if (surface) components.push(surface);

  const tracktype = lookup(TRACKTYPE_SPEED_CAP_KMH, overrides?.tracktype, 'tracktype', way.tracktype, 'OSRM car profile tracktype cap');
  if (tracktype) components.push(tracktype);

  const smoothness = lookup(SMOOTHNESS_SPEED_CAP_KMH, overrides?.smoothness, 'smoothness', way.smoothness, 'OSRM car profile smoothness cap');
  if (smoothness) components.push(smoothness);

  if (components.length > 0) {
    const winner = components.reduce((min, c) => (c.speedKmh < min.speedKmh ? c : min));
    return {
      speedKmh: winner.speedKmh,
      // 'user-override' if ANY contributing component was overridden — the
      // caller edited this way's effective speed, even if a different
      // (unedited) tag happened to be the binding constraint.
      confidence: components.some(c => c.confidence === 'user-override') ? 'user-override' : 'published',
      source: components.map(c => c.source).join('; '),
    };
  }

  // Nothing at all is tagged. `track`/`path`/`road` are common in rural
  // Australia without a tracktype — the documented Tier 0 fallback applies.
  // Any other untagged highway class (shouldn't occur — MOBILITY_HIGHWAYS'
  // other members all have a HIGHWAY_SPEED_KMH entry) also lands here rather
  // than silently returning no ceiling at all.
  if (way.highway === 'track' || way.highway === 'path' || way.highway === 'road' || way.highway) {
    return {
      speedKmh: UNTAGGED_TRACK_FALLBACK_KMH,
      confidence: 'estimated',
      source: `no surface/tracktype/smoothness tag on this ${way.highway} way — assumed tracktype=grade3-equivalent (Tier 0, not measured)`,
    };
  }

  return null;
}
