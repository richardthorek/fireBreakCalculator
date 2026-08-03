/**
 * OCOKA five-factor panel — Terrain Mobility mode (OCOKA 3,
 * docs/ROUTE_INTELLIGENCE.md §47.1/§47.2, master_plan.md "Next up"). Renders
 * `buildOcokaAppreciation`'s output (`terrain/oakoc.ts`) as five headed
 * sections in the doctrinal O-C-O-K-A order (Observation and fields of fire,
 * Cover and concealment, Obstacles, Key terrain, Avenues of approach) — NOT
 * the declaration order of `OcokaAppreciation` itself, which groups
 * obstacles/avenues (real content) ahead of key terrain/observation/cover
 * (the acknowledged gaps) for that module's own review purposes. The
 * acronym's own letter order is what a reader expects here.
 *
 * PRESENTATION ONLY, same discipline as `oakoc.ts` itself: every value
 * rendered below already exists on `result`/`oakoc` — this component adds no
 * analysis, only formatting (seconds→minutes, fractions→percent). If a
 * number is wrong, the bug is upstream in `oakoc.ts` or
 * `mobilityAppreciation.ts`, never here.
 *
 * THE ONE THING THIS FILE MUST NEVER GET WRONG: `'not-assessed'` vs
 * "assessed, found nothing" is not a stylistic choice, it is this repo's
 * core data-honesty rule (root CLAUDE.md "Data honesty"; `oakoc.ts`'s own
 * header comment). Obstacles/Avenues/Key terrain all render their real
 * `'not-assessed'` gate (objective unreachable — no analysis ran at all)
 * with the same caveat styling this mode already uses elsewhere
 * (`mobility-caveat`), which reads as "this run genuinely has nothing to
 * show here" — correct, because it does.
 *
 * Key terrain carries ONE MORE state beyond that, unique to it among the
 * five factors (`OcokaKeyTerrainFactor`'s own doc comment in `oakoc.ts`):
 * `state === 'assessed'` with `result === null` — a real run whose key
 * terrain scoring hasn't landed yet because a separate, already-planned
 * worker-wiring step hasn't shipped. That gets its own `mobility-caveat`
 * line, worded as a genuine transitional limitation ("scoring not
 * available"), never conflated with either the not-assessed gate above it or
 * a real (possibly empty) candidate list below it. And within a real result,
 * `decisiveCandidate` is a computed PREDICATE, never an assertion
 * (`keyTerrain.ts`'s own header explains why at length) — its callout must
 * always read as "candidate, requires a commander's confirmation", never as
 * a flat claim that the ground IS decisive; getting this wording wrong
 * reproduces the exact fabrication this repo's data-honesty rule exists to
 * prevent.
 *
 * Cover & concealment is a DIFFERENT kind of not-assessed: not a property of
 * this particular run but of the build (OCOKA 7 is not built yet, full stop,
 * for every run). It gets a visually distinct treatment — a dashed
 * "NOT YET ASSESSED" card — so a reader never mistakes "this feature
 * doesn't exist yet" for "checked, found nothing" or "this run's objective
 * was unreachable". The badge deliberately does not reuse
 * `DataConfidenceBadge`'s measured/published/estimated/generic-fallback
 * tiers: not-assessed isn't a fifth, lower confidence tier, it is "no
 * analysis ran", a different claim entirely.
 *
 * Observation (OCOKA 6) used to be in that same "not built" category but is
 * now real (`terrain/viewshed.ts`) — it renders through its own
 * `mobility-caveat`-styled branch below instead, on a gate keyed on whether
 * an observer was painted THIS run (`OcokaObservationFactor`'s own doc
 * comment in `oakoc.ts`), not on the build existing. The one thing that
 * NEVER goes away, real result or not: the bare-earth-DEM-optimism caveat
 * (`viewshed.ts`'s own header, point 1) — a screened viewshed is still
 * built from one elevation sample per hex centre, so every sight line stays
 * systematically optimistic regardless of how real the rest of the
 * computation is.
 */

import React, { useMemo } from 'react';
import { MobilityAppreciationResult } from '../terrain/mobilityAppreciation';
import { buildOcokaAppreciation } from '../terrain/oakoc';
import { CorridorField, Corridor } from '@firebreak/terrain';
import { KeyTerrainCandidateSource, ScoredKeyTerrainCandidate } from '@firebreak/terrain';

export interface OakocPanelProps {
  result: MobilityAppreciationResult | null;
}

/** Same trivial seconds→minutes format `MobilityPanel.tsx` uses under its
 *  own private `minutes()` — duplicated rather than imported because that
 *  function isn't exported and this file must stay self-contained (see
 *  task constraints); there is no shared computation here to diverge on,
 *  only a display format. */
function minutes(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !isFinite(seconds)) return '—';
  return `${Math.round(seconds / 60)} min`;
}

/** Compact summary of up to two corridors from a `CorridorField`, reusing
 *  the exact corridor-card/ease/figures classes `MobilityPanel.tsx` uses for
 *  its own (much fuller) corridor browser — deliberately a SUBSET of that
 *  card's content, not a second full corridor browser (that duplication is
 *  the thing OCOKA 3's brief explicitly warns against). */
const AvenueCorridorSummary: React.FC<{ corridors: Corridor[] }> = ({ corridors }) => (
  <>
    {[...corridors]
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 2)
      .map(c => (
        <div key={c.id} className={`corridor-card corridor-card--rank${Math.min(c.rank, 4)}`}>
          <div className="corridor-card-head">
            <span className="corridor-rank tac-mono">CORRIDOR {c.rank}</span>
            <span className={`corridor-ease corridor-ease--${c.easeClass}`}>
              {c.easeClass.replace('-', ' ').toUpperCase()}
            </span>
          </div>
          <div className="corridor-figures tac-mono">
            <div>MEDIAN {minutes(c.medianTravelSeconds).toUpperCase()}</div>
            <div>BOTTLENECK ~{c.bottleneckWidthM.toFixed(0)} M</div>
          </div>
        </div>
      ))}
  </>
);

/** OCOKA 6/7's shared "not yet built" treatment — see this file's header
 *  comment for why it must stay visually distinct from both an assessed
 *  factor and a 'not-assessed' obstacles/avenues/key-terrain gate. (Key
 *  terrain used this too until OCOKA 4 shipped a real computation — it now
 *  renders through its own branch below instead.) */
const NotAssessedCard: React.FC<{ note: string }> = ({ note }) => (
  <div className="oakoc-notassessed">
    <span className="oakoc-notassessed-badge">NOT YET ASSESSED</span>
    <p>{note}</p>
  </div>
);

/** Readable label for a `KeyTerrainCandidateSource` — the SAME "replace the
 *  first hyphen, uppercase" convention `AvenueCorridorSummary` already uses
 *  for `easeClass` below, which happens to read correctly for every value
 *  here too: 'hex-min-cut' → 'HEX MIN-CUT' (the SECOND hyphen, inside
 *  "min-cut", is deliberately left alone, matching how a person would
 *  actually write it) rather than a bespoke lookup table for four strings. */
function keyTerrainSourceLabel(source: KeyTerrainCandidateSource): string {
  return source.replace('-', ' ').toUpperCase();
}

/** Plain-English one-liner over a candidate's real `CorridorComparison`
 *  counts (`terrain/corridorField.ts`) — collapse and degrade are always
 *  shown (`impactScoreOf`'s own comment in `keyTerrain.ts` explains why
 *  those two carry the score); displacement is only shown when non-zero to
 *  keep the common case terse. `effects`/`newCorridors` stay in the
 *  underlying data for export — too granular for this compact line. */
function keyTerrainComparisonSummary(comparison: ScoredKeyTerrainCandidate['comparison']): string {
  const parts = [`${comparison.collapsedCount} COLLAPSED`, `${comparison.degradedCount} DEGRADED`];
  if (comparison.displacedIntoCount > 0) parts.push(`${comparison.displacedIntoCount} DISPLACED-INTO`);
  return parts.join(', ');
}

/** How many top-ranked candidates to show — a SUBSET, same "compact
 *  summary, not a second full browser" discipline `AvenueCorridorSummary`
 *  follows for corridors (there capped at 2; key terrain gets a slightly
 *  wider window because rank alone, unlike corridor ease, doesn't tell a
 *  reader which candidates are worth a second look). */
const KEY_TERRAIN_DISPLAY_COUNT = 5;

/** Top-ranked key terrain candidates (OCOKA 4). `decisiveCandidate` gets its
 *  own always-worded callout — see this file's header and
 *  `OcokaKeyTerrainFactor`'s doc comment in `oakoc.ts` for why that flag
 *  must never be softened into an assertion that the ground IS decisive. */
const KeyTerrainCandidateList: React.FC<{ candidates: ScoredKeyTerrainCandidate[] }> = ({ candidates }) => (
  <>
    {[...candidates]
      .sort((a, b) => a.rank - b.rank)
      .slice(0, KEY_TERRAIN_DISPLAY_COUNT)
      .map(c => (
        <div key={c.id} className="keyterrain-candidate">
          <div className="keyterrain-candidate-head">
            <span className="tac-mono">#{c.rank} — {keyTerrainSourceLabel(c.source)}</span>
            <span className="keyterrain-candidate-score tac-mono">IMPACT {c.impactScore.toFixed(2)}</span>
          </div>
          <div className="keyterrain-candidate-summary tac-mono">{keyTerrainComparisonSummary(c.comparison)}</div>
          {c.decisiveCandidate && (
            <div className="keyterrain-decisive tac-mono">
              <strong>CANDIDATE DECISIVE TERRAIN</strong> — denying this ground made every analysed
              route impossible in this re-run. Requires a commander's confirmation against the
              actual mission; not asserted by this tool.
            </div>
          )}
        </div>
      ))}
  </>
);

export const OakocPanel: React.FC<OakocPanelProps> = ({ result }) => {
  const oakoc = useMemo(() => (result ? buildOcokaAppreciation(result) : null), [result]);

  if (!oakoc) {
    return (
      <div className="tac-panel mobility-panel">
        <div className="tac-label">OCOKA — TERRAIN APPRECIATION</div>
        <div className="mobility-caveat tac-mono">
          NO RESULT YET — RUN A TERRAIN APPRECIATION FIRST TO SEE THE FIVE-FACTOR OCOKA BREAKDOWN
        </div>
      </div>
    );
  }

  const unrestricted: CorridorField | null = oakoc.avenuesOfApproach.unrestricted;

  return (
    <div className="tac-panel mobility-panel">
      <div className="tac-label">OCOKA — FIVE-FACTOR TERRAIN APPRECIATION</div>

      {/* --- O: Observation and fields of fire (OCOKA 6) --- */}
      <div className="tac-panel mobility-section">
        <div className="tac-label">O — Observation and fields of fire</div>
        {oakoc.observationAndFieldsOfFire.state === 'not-assessed' ? (
          <div className="mobility-caveat tac-mono">
            NO OBSERVER PAINTED — OBSERVATION IS OPTIONAL, ADDITIONAL ANALYSIS
          </div>
        ) : (
          <div className="mobility-result-stats tac-mono">
            <div>{oakoc.observationAndFieldsOfFire.result!.observers.length} OBSERVER(S)</div>
            <div>{oakoc.observationAndFieldsOfFire.result!.screenedUnionKeys.size} CELL(S) SEEN (SCREENED)</div>
            <div>{oakoc.observationAndFieldsOfFire.result!.bareEarthUnionKeys.size} CELL(S) SEEN (BARE EARTH)</div>
            {oakoc.observationAndFieldsOfFire.result!.corridorCoverageFraction !== null && (
              <div>
                {Math.round(oakoc.observationAndFieldsOfFire.result!.corridorCoverageFraction! * 100)}% OF THE
                HEADLINE CORRIDOR(S) SEEN BY AT LEAST ONE OBSERVER
              </div>
            )}
          </div>
        )}
        {/* fieldsOfFireAssessed stays false regardless of state — a separate,
         *  real remaining gap (see oakoc.ts's own comment), so this reads the
         *  computed note rather than assuming "assessed" means fields of fire
         *  are covered too. */}
        <p className="tac-hint">{oakoc.observationAndFieldsOfFire.note}</p>
        {/* Bare-earth-DEM optimism caveat — ALWAYS shown, real result or not,
         *  same "'not-assessed' must never look like more confidence than
         *  the assessed case actually earned, and the assessed case must
         *  never look more confident than it actually is either" discipline.
         *  Screened already accounts for vegetation canopy; it does not, and
         *  cannot, account for buildings, walls or other structures. */}
        <p className="tac-hint">
          Elevation here is a bare-earth DEM, one sample per hex centre — every sight line is
          systematically optimistic (root CLAUDE.md). The screened surface already accounts for
          vegetation canopy; it does not account for buildings, walls or other structures.
        </p>
      </div>

      {/* --- C: Cover and concealment (OCOKA 7) — split, never blended:
       *  Concealment is real, Cover stays permanently not computed. --- */}
      <div className="tac-panel mobility-section">
        <div className="tac-label">C — Cover and concealment</div>

        <div className="mobility-section">
          <div className="tac-label">Concealment</div>
          {oakoc.coverAndConcealment.concealmentState === 'not-assessed' ? (
            <div className="mobility-caveat tac-mono">
              NO OBSERVER PAINTED — CONCEALMENT IS RELATIVE TO A SPECIFIED POSITION
            </div>
          ) : (
            <div className="mobility-result-stats tac-mono">
              <div>
                {oakoc.coverAndConcealment.concealmentResult!.concealedKeys.size}/
                {oakoc.coverAndConcealment.concealmentResult!.cellsConsidered} CELL(S) CONCEALED
              </div>
              <div>{oakoc.coverAndConcealment.concealmentResult!.deadGroundKeys.size} DEAD GROUND</div>
              <div>{oakoc.coverAndConcealment.concealmentResult!.vegetationConcealedKeys.size} BY VEGETATION</div>
            </div>
          )}
          <p className="tac-hint">{oakoc.coverAndConcealment.concealmentNote}</p>
        </div>

        <div className="mobility-section">
          <div className="tac-label">Cover</div>
          <NotAssessedCard note={oakoc.coverAndConcealment.coverNote} />
        </div>
      </div>

      {/* --- O: Obstacles --- */}
      <div className="tac-panel mobility-section">
        <div className="tac-label">O — Obstacles</div>
        {oakoc.obstacles.state === 'not-assessed' ? (
          <div className="mobility-caveat tac-mono">
            OBJECTIVE UNREACHABLE — NO OBSTACLE ANALYSIS RAN
          </div>
        ) : (
          <>
            <div className="mobility-section">
              <div className="tac-label">Existing</div>
              <div className="mobility-result-stats tac-mono">
                <div>
                  {oakoc.obstacles.existing.barrier
                    ? `${oakoc.obstacles.existing.barrier.segments.length} SEGMENT(S), CUT VALUE ${oakoc.obstacles.existing.barrier.cutValue.toFixed(0)}`
                    : 'NO SEPARATING CUT NEEDED OR FOUND'}
                </div>
                {oakoc.obstacles.existing.roadNetworkBarrier !== null && (
                  <div>
                    ROAD NETWORK: {oakoc.obstacles.existing.roadNetworkBarrier.segments.length} SEGMENT(S),
                    CUT VALUE {oakoc.obstacles.existing.roadNetworkBarrier.cutValue.toFixed(0)}
                  </div>
                )}
                <div>{oakoc.obstacles.existing.chokepoints.length} TOP CHOKEPOINT(S)</div>
              </div>
            </div>

            <div className="mobility-section">
              <div className="tac-label">Reinforcing</div>
              {oakoc.obstacles.reinforcing.plan === null ? (
                <div className="mobility-caveat tac-mono">NO RESTRICTION PLAN RAN</div>
              ) : (
                <>
                  <div className="mobility-result-stats tac-mono">
                    <div>{oakoc.obstacles.reinforcing.plan.restrictions.length} RECOMMENDED MEASURE(S)</div>
                  </div>
                  {oakoc.obstacles.reinforcing.plan.bypassNote && (
                    <div className="mobility-caveat tac-mono">
                      {oakoc.obstacles.reinforcing.plan.bypassNote}
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* --- K: Key terrain (OCOKA 4) --- */}
      <div className="tac-panel mobility-section">
        <div className="tac-label">K — Key terrain</div>
        {oakoc.keyTerrain.state === 'not-assessed' ? (
          <div className="mobility-caveat tac-mono">
            OBJECTIVE UNREACHABLE — NO KEY TERRAIN ANALYSIS RAN
          </div>
        ) : oakoc.keyTerrain.result === null ? (
          // 'assessed' but result is null: a real run, staging gap — see
          // `OcokaKeyTerrainFactor`'s doc comment in oakoc.ts. Genuinely
          // distinct from the not-assessed gate above, so worded as its own
          // limitation, not reused text.
          <div className="mobility-caveat tac-mono">
            KEY TERRAIN SCORING NOT AVAILABLE FOR THIS RUN
          </div>
        ) : (
          <>
            <div className="mobility-result-stats tac-mono">
              <div>{oakoc.keyTerrain.result.candidatesConsidered} CANDIDATE(S) CONSIDERED</div>
              <div>{oakoc.keyTerrain.result.candidates.length} SCORED</div>
            </div>
            {oakoc.keyTerrain.result.candidates.length === 0 ? (
              <div className="mobility-caveat tac-mono">NO KEY TERRAIN CANDIDATES SCORED FOR THIS RUN</div>
            ) : (
              <KeyTerrainCandidateList candidates={oakoc.keyTerrain.result.candidates} />
            )}
            {/* Mission caveat: always shown while a real result is on screen,
             *  not only when a decisive candidate is present — see this
             *  file's header and `KEY_TERRAIN_MISSION_CAVEAT` in
             *  keyTerrain.ts for why it must never be summarised or dropped. */}
            <p className="tac-hint">{oakoc.keyTerrain.result.missionCaveat}</p>
          </>
        )}
      </div>

      {/* --- A: Avenues of approach --- */}
      <div className="tac-panel mobility-section">
        <div className="tac-label">A — Avenues of approach</div>
        {oakoc.avenuesOfApproach.state === 'not-assessed' ? (
          <div className="mobility-caveat tac-mono">
            OBJECTIVE UNREACHABLE — NO AVENUE-OF-APPROACH ANALYSIS RAN
          </div>
        ) : (
          <>
            {unrestricted ? (
              <>
                <div className="mobility-result-stats tac-mono">
                  <div>{unrestricted.corridors.length} CORRIDOR(S) IDENTIFIED</div>
                </div>
                <AvenueCorridorSummary corridors={unrestricted.corridors} />
              </>
            ) : (
              <div className="mobility-caveat tac-mono">NO CORRIDORS FORMED FOR THIS RUN</div>
            )}
            {oakoc.avenuesOfApproach.restricted && (
              <p className="tac-hint">
                A second picture exists once the recommended restrictions above are emplaced —
                see Movement Corridors / "With restrictions" in the Terrain Appreciation tab.
              </p>
            )}
            <p className="tac-hint">
              Avenue-of-approach grouping above individual corridors is not yet built (OCOKA 3) —
              doctrine distinguishes a mobility corridor from an avenue of approach, which groups
              mutually supporting corridors. Each corridor is shown directly, as its own
              avenue-equivalent band, until that grouping is built.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default OakocPanel;
