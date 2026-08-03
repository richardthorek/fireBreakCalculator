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
 * header comment). Obstacles/Avenues render their real `'not-assessed'`
 * gate (objective unreachable — no analysis ran at all) with the same
 * caveat styling this mode already uses elsewhere (`mobility-caveat`), which
 * reads as "this run genuinely has nothing to show here" — correct, because
 * it does. Key terrain / Observation / Cover & concealment are a DIFFERENT
 * kind of not-assessed: not a property of this particular run but of the
 * build (OCOKA 4/6/7 are not built yet, full stop, for every run). Those
 * three get a visually distinct treatment — a dashed "NOT YET ASSESSED" card
 * — so a reader never mistakes "this feature doesn't exist yet" for either
 * "checked, found nothing" or "this run's objective was unreachable". The
 * badge deliberately does not reuse `DataConfidenceBadge`'s
 * measured/published/estimated/generic-fallback tiers: not-assessed isn't a
 * fifth, lower confidence tier, it is "no analysis ran", a different claim
 * entirely.
 */

import React, { useMemo } from 'react';
import { MobilityAppreciationResult } from '../terrain/mobilityAppreciation';
import { buildOcokaAppreciation } from '../terrain/oakoc';
import { CorridorField, Corridor } from '../terrain/corridorField';

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

/** OCOKA 4/6/7's shared "not yet built" treatment — see this file's header
 *  comment for why it must stay visually distinct from both an assessed
 *  factor and a 'not-assessed' obstacles/avenues gate. */
const NotAssessedCard: React.FC<{ note: string }> = ({ note }) => (
  <div className="oakoc-notassessed">
    <span className="oakoc-notassessed-badge">NOT YET ASSESSED</span>
    <p>{note}</p>
  </div>
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

      {/* --- O: Observation and fields of fire (OCOKA 6, always not-assessed) --- */}
      <div className="tac-panel mobility-section">
        <div className="tac-label">O — Observation and fields of fire</div>
        <NotAssessedCard note={oakoc.observationAndFieldsOfFire.note} />
      </div>

      {/* --- C: Cover and concealment (OCOKA 7, always not-assessed) --- */}
      <div className="tac-panel mobility-section">
        <div className="tac-label">C — Cover and concealment</div>
        <NotAssessedCard note={oakoc.coverAndConcealment.note} />
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

      {/* --- K: Key terrain (OCOKA 4, always not-assessed) --- */}
      <div className="tac-panel mobility-section">
        <div className="tac-label">K — Key terrain</div>
        <NotAssessedCard note={oakoc.keyTerrain.note} />
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
