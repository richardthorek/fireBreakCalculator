/**
 * Counter-mobility measure catalogue — Terrain Mobility & Counter-Mobility
 * mode, Pass 2 (docs/ROUTE_INTELLIGENCE.md §5, §11.5, §15.2).
 *
 * WHAT THIS FILE IS NOT: a breach-time matrix. Docs §11.5 states plainly that
 * "the delay imposed on a given mover with given breaching equipment is not,
 * in any open source we have found" — that gap stands until a citable basis
 * exists (Pass 4 exit condition). `edgePenaltyMultiplier` below is therefore
 * a coarse, profile-agnostic search obstruction used only to RANK measures
 * relative to each other via the delay ledger (`delayLedger.ts`), never
 * presented as a calibrated breach time for a specific mover/equipment pair.
 *
 * THE DOCTRINAL RESTRAINT RULE (§11.5), applied deliberately: obstacle
 * effects are the closed four-value set disrupt/turn/fix/block, and doctrine
 * is explicit that these effects "arise from obstacles AND fires together,
 * not obstacles alone" — an unobserved, unanswered barrier is at best
 * `disrupt`. Every entry below is modelled as a STANDALONE physical measure
 * with no asserted covering observation/fires element (that pairing is a
 * planning decision made when a measure is sited alongside the
 * `sensor-observation-post` entry or a real overwatch position — a decision
 * for the planner/ledger consumer, not something this catalogue can assert
 * on a measure's behalf). Consequently **no entry here is rated `block`** —
 * that is not an oversight, it is the restraint rule working as intended.
 * `road-crater`'s notes spell this out explicitly since it is the entry most
 * tempting to over-rate.
 *
 * `relativeEmplacementEffort` is a unitless multiple of a reference
 * "1 crew-hour" and exists ONLY to rank emplacement cost against other
 * measures — it is not a dollar or hour figure, since a real cost claim
 * needs the production-model integration this doc gates on a later pass.
 */

import { ConfidenceTier } from './confidenceTier';

/** Doctrinal obstacle-effect taxonomy (FM 90-7 lineage, current
 *  ATP 3-90.8 / MCWP 3-17.5) — see docs §11.5. Closed four-value set. */
export type ObstacleEffect = 'disrupt' | 'turn' | 'fix' | 'block';

export interface CounterMeasure {
  id: string;
  label: string;
  effect: ObstacleEffect;
  geometry: 'point' | 'line' | 'area';
  /** Doctrinal sourcing and rough physical footprint, for siting sanity
   *  (e.g. a ditch needs a line long enough to span the gap it's cutting) —
   *  dimensions cited from docs §11.5's anti-tank ditch/crater/abatis
   *  figures where an open doctrinal source exists; otherwise stated as
   *  estimated/generic and never given a false precise figure. */
  notes: string;
  confidence: ConfidenceTier;
  source: string;
  /** How this measure is modelled as a search obstacle: a multiplier applied
   *  via `AccumulatedCostSearchOptions.edgePenalties` to the directed
   *  edge(s) it covers (both directions — a physical obstacle blocks travel
   *  either way). Large (1e5-1e6) models a near-total block requiring
   *  dedicated breach equipment; small (2-10) models a genuine slowing
   *  effect a mover can push through. Sized per measure's real severity —
   *  see individual entries, not a uniform default. */
  edgePenaltyMultiplier: number;
  /** Rough emplacement effort as a multiple of a reference "1 crew-hour"
   *  unit — RELATIVE ranking only (cheapest first), not a cost claim. */
  relativeEmplacementEffort: number;
  reversible: boolean;
  /** e.g. "authority required to obstruct a public road", "native
   *  vegetation clearing approval" — from docs §5. */
  legalPrerequisites: string[];
}

export const COUNTER_MEASURES: CounterMeasure[] = [
  {
    id: 'abatis-felled-timber',
    label: 'Abatis (felled-timber obstacle)',
    effect: 'disrupt',
    geometry: 'line',
    notes:
      'Trees felled across the track with tops crisscrossed toward the expected approach, ' +
      'stumps left high so the obstacle cannot be shouldered aside; most effective in forest ' +
      'or on narrow routes, several sited in depth (docs §5, §11.5). No covering observation ' +
      'or fires asserted for this catalogue entry, so per §11.5\'s restraint rule this stays ' +
      '`disrupt`, not `block` — a determined party with chainsaws and time will clear it.',
    confidence: 'published',
    source:
      'Method and siting doctrine from docs/ROUTE_INTELLIGENCE.md §5 and §11.5 (ATP 3-90.8 / ' +
      'MCWP 3-17.5 / FM 90-7 obstacle-effect lineage). No specific delay figure is doctrinally ' +
      'cited — see the module-level breach/delay gap note.',
    edgePenaltyMultiplier: 6,
    relativeEmplacementEffort: 3,
    reversible: true,
    legalPrerequisites: [
      'native vegetation clearing / tree-felling approval',
      'authority required to obstruct a public road, if sited on one',
    ],
  },
  {
    id: 'anti-vehicle-ditch',
    label: 'Anti-vehicle ditch',
    effect: 'disrupt',
    geometry: 'line',
    notes:
      'Doctrinal geometry (docs §11.5): approximately 4 m wide × 1.5 m deep triangular profile, ' +
      'or 4.5-6 m wide × 1.8 m deep rectangular, spoil cast to the far side. Stops wheeled and ' +
      'tracked momentum crossing directly, but doctrine states a ditch is only non-bypassable ' +
      'where its flanks tie into steep slopes or are otherwise covered — this entry makes no ' +
      'such covering assumption, so it stays `disrupt` rather than `block`.',
    confidence: 'published',
    source:
      'Dimensions cited directly from docs/ROUTE_INTELLIGENCE.md §11.5\'s doctrinal anti-tank ' +
      'ditch figures. Delay-to-breach is not doctrinally sourced (see module note).',
    edgePenaltyMultiplier: 1e6,
    relativeEmplacementEffort: 20,
    reversible: false,
    legalPrerequisites: [
      'authority required to obstruct a public road, if sited on one',
      'works-in-a-waterway approval if the ditch intercepts drainage',
      'native vegetation clearing approval if the alignment requires it',
    ],
  },
  {
    id: 'road-crater',
    label: 'Road crater (demolition)',
    effect: 'disrupt',
    geometry: 'line',
    notes:
      'Doctrinal hasty-crater figure (docs §11.5): on the order of 1.5 m wide × 2.4 m deep × 6 m ' +
      'long. Doctrine states plainly that "road craters are only effective where the flanks tie ' +
      'into steep slopes or are otherwise covered" — i.e. paired with observation/fires, per the ' +
      '§11.5 restraint rule. This catalogue entry asserts NO such pairing, so despite the ' +
      'physically severe geometry it is rated `disrupt`, not `block`; only upgrade to `block` ' +
      'when this crater is explicitly sited with a specific covering element (e.g. alongside a ' +
      '`sensor-observation-post` entry and a fires plan), which is a planning decision made ' +
      'outside this catalogue.',
    confidence: 'published',
    source:
      'Dimensions cited directly from docs/ROUTE_INTELLIGENCE.md §11.5\'s doctrinal hasty-crater ' +
      'figure. Delay-to-breach is not doctrinally sourced (see module note).',
    edgePenaltyMultiplier: 1e6,
    relativeEmplacementEffort: 15,
    reversible: false,
    legalPrerequisites: [
      'explosive ordnance / demolitions authority',
      'authority required to obstruct a public road',
      'traffic-management notification to the road authority',
    ],
  },
  {
    id: 'log-crib-tank-trap',
    label: 'Log crib / tank trap',
    effect: 'fix',
    geometry: 'line',
    notes:
      'A buried/cribbed log structure a vehicle grounds or bellies out on attempting to cross ' +
      '(docs §5). Rated `fix` rather than `disrupt` because the mechanism itself (the vehicle ' +
      'becomes physically stuck) holds the mover in place without needing an asserted covering ' +
      'fires element — `fix` describes the physical entrapment effect, not a doctrinal ' +
      'block-with-fires claim. No distinct doctrinal dimension is cited for this class ' +
      '(unlike the ditch/crater figures above) so the geometry is treated as an estimate scaled ' +
      'off the anti-vehicle-ditch class footprint.',
    confidence: 'estimated',
    source:
      'Mechanism described in docs/ROUTE_INTELLIGENCE.md §5 ("log cribs and tank traps"); no ' +
      'specific open-source dimension citation found, so geometry and multiplier are estimated ' +
      'rather than doctrinally sourced.',
    edgePenaltyMultiplier: 40,
    relativeEmplacementEffort: 10,
    reversible: true,
    legalPrerequisites: [
      'native vegetation clearing approval (timber sourcing)',
      'authority required to obstruct a public road, if sited on one',
    ],
  },
  {
    id: 'concrete-jersey-barriers',
    label: 'Concrete / Jersey barriers',
    effect: 'turn',
    geometry: 'line',
    notes:
      'Precast concrete Jersey/F-type barriers, gabions or filled shipping containers placed to ' +
      'close a lane (docs §5). Rated `turn` because the standard use of a barrier line is to ' +
      'divert traffic into a chosen alternate lane or gap rather than to hold a mover in one ' +
      'place — channels movement, does not fix it. Bypassable by foot around either end and ' +
      'movable by recovery/loader plant, so not rated as a full block.',
    confidence: 'estimated',
    source:
      'Generic civil/military barrier engineering practice (docs §5 names the object class); no ' +
      'ROUTE_INTELLIGENCE-cited dimension exists, so the ~0.8 m standard barrier height / ' +
      'per-linear-metre footprint is an industry-typical figure, not a doctrinal one.',
    edgePenaltyMultiplier: 15,
    relativeEmplacementEffort: 12,
    reversible: true,
    legalPrerequisites: [
      'authority required to obstruct a public road',
      'traffic-management / road-safety approval',
    ],
  },
  {
    id: 'immobilised-vehicle-hulk',
    label: 'Immobilised vehicle / plant hulk',
    effect: 'disrupt',
    geometry: 'point',
    notes:
      'A vehicle or farm-plant hulk placed across the route. Docs §5 is explicit that ' +
      '"effectiveness is in the detail, not the object": a hulk not chained to an anchor, with ' +
      'wheels on and an accessible engine bay, is a ten-minute winch job. This entry models the ' +
      'properly-executed version (chained to a deadman anchor, wheels removed, engine ' +
      'disabled) — still only `disrupt` since no observation/fires pairing is asserted, and the ' +
      'multiplier is set moderate rather than high to reflect that even a well-prepared hulk is a ' +
      'recoverable obstacle, not a structural one.',
    confidence: 'published',
    source:
      'Effectiveness caveat quoted directly from docs/ROUTE_INTELLIGENCE.md §5. Delay-to-remove ' +
      'is not doctrinally sourced (see module note).',
    edgePenaltyMultiplier: 10,
    relativeEmplacementEffort: 5,
    reversible: true,
    legalPrerequisites: [
      'environmental approval for vehicle fluids / disposal',
      'authority required to obstruct a public road, if sited on one',
    ],
  },
  {
    id: 'culvert-removal',
    label: 'Culvert removal',
    effect: 'turn',
    geometry: 'point',
    notes:
      'Removing a road culvert rather than blocking the road over it (docs §5: "remove the ' +
      'route instead of blocking it — usually cheaper and far more durable"). Rated `turn` ' +
      'because removing one crossing forces movement onto the remaining crossings elsewhere in ' +
      'the network, which is a channelling effect, not an in-place fix or a full-network block. ' +
      'Also doubles as erosion control per docs §5.',
    confidence: 'published',
    source: 'Practice described in docs/ROUTE_INTELLIGENCE.md §5 ("what land managers actually do").',
    edgePenaltyMultiplier: 1e5,
    relativeEmplacementEffort: 6,
    reversible: true,
    legalPrerequisites: [
      'works-in-a-waterway approval',
      'erosion and sediment control plan',
      'native vegetation clearing approval if disturbing banks',
    ],
  },
  {
    id: 'bridge-deck-removal',
    label: 'Bridge deck removal',
    effect: 'turn',
    geometry: 'point',
    notes:
      'Removing a bridge deck rather than cratering the approach (docs §5). Rated `turn`, not ' +
      '`block`, per the §11.5 restraint rule — even though a removed deck is physically severe ' +
      'at that exact point, this catalogue entry asserts no covering observation/fires, and a ' +
      'determined dismounted party may still cross the remaining structure. The realistic effect ' +
      'is diverting vehicle traffic to another crossing.',
    confidence: 'published',
    source: 'Practice named directly in docs/ROUTE_INTELLIGENCE.md §5.',
    edgePenaltyMultiplier: 1e6,
    relativeEmplacementEffort: 18,
    reversible: false,
    legalPrerequisites: [
      'structural / asset-owner authority (bridges are frequently a council or state asset)',
      'works-in-a-waterway approval',
      'traffic-management notification',
    ],
  },
  {
    id: 'cattle-grid-removal',
    label: 'Cattle-grid removal',
    effect: 'disrupt',
    geometry: 'point',
    notes:
      'Lifting a cattle grid out of a formed track (docs §5). A smaller-scale, easily-bridged ' +
      'gap compared to culvert/bridge removal (a determined party can lay timber or fill across ' +
      'it quickly), so rated `disrupt` with a correspondingly modest multiplier rather than the ' +
      'near-total figures used for the larger removal measures.',
    confidence: 'published',
    source: 'Named directly in docs/ROUTE_INTELLIGENCE.md §5 among "remove the route" measures.',
    edgePenaltyMultiplier: 8,
    relativeEmplacementEffort: 2,
    reversible: true,
    legalPrerequisites: [
      'land-manager / asset-owner authority',
      'authority required to obstruct a public road, if the grid sits on a road reserve',
    ],
  },
  {
    id: 'terrain-ripping-scarification',
    label: 'Terrain ripping / scarification',
    effect: 'disrupt',
    geometry: 'area',
    notes:
      'Rip, scarify, windrow, mound or contour-bank a track surface to deny by terrain ' +
      'modification (docs §5); this is the legitimate headline application for land managers ' +
      'closing illegal 4WD/trail-bike access, and it doubles as erosion control. No specific ' +
      'doctrinal delay figure exists for this class, so it stays `disrupt` — mainly a nuisance to ' +
      'foot movement, materially slower for wheeled traffic which loses traction and ' +
      'ground clearance on the ripped surface.',
    confidence: 'estimated',
    source:
      'Technique named directly in docs/ROUTE_INTELLIGENCE.md §5 ("deny by terrain ' +
      'modification"); no cited delay figure, so the multiplier is an engineering estimate.',
    edgePenaltyMultiplier: 4,
    relativeEmplacementEffort: 8,
    reversible: false,
    legalPrerequisites: [
      'native vegetation clearing approval',
      'erosion and sediment control / soil conservation approval',
      'authority required to obstruct a public road, if sited on one',
    ],
  },
  {
    id: 'locked-gate-signage',
    label: 'Locked gate + signage',
    effect: 'turn',
    geometry: 'point',
    notes:
      'A locked gate and formal closure signage (docs §5: "a locked gate turns away most casual ' +
      'traffic for a fraction of any engineering cost"). Rated `turn` — its real function is ' +
      'diverting casual/undetermined traffic elsewhere, not fixing or blocking a determined one; ' +
      'the cheapest measure in the catalogue by design, ranked on delay-per-effort like ' +
      'everything else per docs §5\'s own framing.',
    confidence: 'published',
    source: 'Quoted directly from docs/ROUTE_INTELLIGENCE.md §5.',
    edgePenaltyMultiplier: 2,
    relativeEmplacementEffort: 0.5,
    reversible: true,
    legalPrerequisites: [
      'formal closure instrument / authority to close a public road or track',
      'signage compliance with land-manager standards',
    ],
  },
  {
    id: 'sensor-observation-post',
    label: 'Sensor / observation post',
    effect: 'disrupt',
    geometry: 'point',
    notes:
      'Trail camera, gate counter, seismic/tripwire sensor, drone patrol line or observation ' +
      'post (docs §5). This is NOT an obstacle — its value is detection, not obstruction, so ' +
      'edgePenaltyMultiplier is 1 (no search-cost effect at all). The `effect` field is mandatory ' +
      'across this schema but the doctrinal four-value taxonomy (§11.5) doesn\'t strictly apply ' +
      'to a sensor; `disrupt` is entered as the closest nominal value only to satisfy the shared ' +
      'type, not as a claim this measure itself disrupts anything. Its real function is enabling ' +
      'a response force to supply the fires/observation that would let a CO-SITED obstacle be ' +
      'legitimately rated `block` — that upgrade is a planning decision made when pairing this ' +
      'entry with another measure, not something asserted here. Optimal siting is computable from ' +
      'the highest-betweenness cells or cumulative viewshed over the corridor band (docs §5, §4).',
    confidence: 'estimated',
    source:
      'Measure class and siting method named in docs/ROUTE_INTELLIGENCE.md §5 and §4 ' +
      '(chokepoint betweenness / viewshed siting); device-specific performance is not sourced.',
    edgePenaltyMultiplier: 1,
    relativeEmplacementEffort: 1,
    reversible: true,
    legalPrerequisites: [
      'surveillance / privacy law compliance if covering ground the public accesses',
      'land-manager authority for device placement',
    ],
  },
];

export function getCounterMeasure(id: string): CounterMeasure | undefined {
  return COUNTER_MEASURES.find(m => m.id === id);
}

export function listCounterMeasures(effect?: ObstacleEffect): CounterMeasure[] {
  return effect ? COUNTER_MEASURES.filter(m => m.effect === effect) : COUNTER_MEASURES;
}
