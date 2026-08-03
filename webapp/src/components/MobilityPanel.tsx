/**
 * Terrain Mobility mode panel — Pass 1 (docs/ROUTE_INTELLIGENCE.md "Terrain
 * Mobility & Counter-Mobility"). Area-to-area movement appreciation: paint an
 * origin area, an objective area, pick a mover profile, run a multi-source
 * search. State (paint, profile, results, log) lives in App.tsx and is
 * passed in as props/callbacks, mirroring how AnalysisPanel/AdvisorPanel are
 * already wired — this panel renders, App.tsx orchestrates.
 *
 * Primary actions (paint origin/objective, run/cancel) live as floating
 * overlay buttons on the map itself (MapboxMapView) — owner feedback
 * 2026-07-26: "on mobile I had to scroll to find buttons... the scroll panel
 * should only need to be expanded to change options or find detail." This
 * panel shows profile/options and results detail only.
 */

import React, { useMemo } from 'react';
import { Footprints, Car, Truck, Tractor } from 'lucide-react';
import { MOVER_PROFILES, MoverProfile, MoverFamily } from '../terrain/moverProfiles';
import { MobilityAppreciationResult } from '../terrain/mobilityAppreciation';
import { PaintedArea, BrushSize } from '../terrain/paintedArea';
import { TacticalCoordinateReadout } from './TacticalCoordinateReadout';
import { AssessmentLog } from './AssessmentLog';
import { DataConfidenceBadge, ConfidenceTier } from './DataConfidenceBadge';
import { MobilityExportControls } from './MobilityExportControls';
import { ExportMobilityInput } from '../utils/mobilityGisExport';
import { MobilityAssistantCard } from './MobilityAssistantCard';
import { buildMobilityAssistantPayload } from '../utils/mobilityAssistantApi';
import { COUNTER_MEASURES } from '../terrain/counterMeasures';
import { CounterMeasurePlacement, DelayLedgerEntry } from '../terrain/delayLedger';
import { BEHAVIOUR_SPREADS, MovementEnsembleResult } from '../terrain/movementSimulation';
import { CorridorField } from '../terrain/corridorField';
import { RoadSpeedOverrides } from '../terrain/roadSpeedModel';
import { RoadSpeedOverridePanel } from './RoadSpeedOverridePanel';
import { MobilityFidelity } from '../terrain/mobilityGrid';

export interface MobilityPanelProps {
  profileId: string;
  onProfileChange: (id: string) => void;
  nightMode: boolean;
  onNightModeChange: (v: boolean) => void;
  roadSpeedOverrides: RoadSpeedOverrides;
  onRoadSpeedOverridesChange: (overrides: RoadSpeedOverrides) => void;
  fidelity: MobilityFidelity;
  onFidelityChange: (f: MobilityFidelity) => void;
  boxRole: 'origin' | 'objective' | null;
  onBoxRoleChange: (role: 'origin' | 'objective' | null) => void;
  originPaint: PaintedArea;
  objectivePaint: PaintedArea;
  brushSize: BrushSize;
  onBrushSizeChange: (size: BrushSize) => void;
  onClearPaint: (role?: 'origin' | 'objective') => void;
  running: boolean;
  logLines: string[];
  result: MobilityAppreciationResult | null;
  displayMode: 'trafficability' | 'isochrone';
  onDisplayModeChange: (m: 'trafficability' | 'isochrone') => void;
  cursor: { lat: number; lng: number } | null;
  /** Proposed counter-measure placements and their scored ledger, if any —
   *  folded into the export pack alongside the corridor/chokepoint/barrier
   *  results so the exported course of action carries the same numbers the
   *  Counter-Mobility panel shows (docs §29). */
  cmPlacements?: CounterMeasurePlacement[];
  cmLedger?: DelayLedgerEntry[] | null;

  // Unit movement simulation (owner "bonus feature", 2026-07-26; promoted to
  // the primary answer 2026-07-27 — see docs §32).
  hasPath: boolean;
  simRunning: boolean;
  onStartSimulation: () => void;
  onStopSimulation: () => void;
  speedMultiplier: number;
  onSpeedMultiplierChange: (x: number) => void;
  simElapsedSeconds: number | null;

  // --- Probabilistic movement (docs §32) ------------------------------------
  behaviourSpreadId: string;
  onBehaviourSpreadChange: (id: string) => void;
  /** Which movement picture is shown: untouched ground, or with the
   *  recommended restrictions emplaced. */
  movementView: 'unrestricted' | 'restricted';
  onMovementViewChange: (v: 'unrestricted' | 'restricted') => void;
  showTransitField: boolean;
  onShowTransitFieldChange: (v: boolean) => void;
  displayedEnsemble: MovementEnsembleResult | null;
  displayedCorridorField: CorridorField | null;
  highlightedCorridorId: string | null;
  onCorridorHighlight: (id: string | null) => void;
  simMode: 'ensemble' | 'single';
  onSimModeChange: (m: 'ensemble' | 'single') => void;
}

function minutes(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !isFinite(seconds)) return '—';
  return `${Math.round(seconds / 60)} min`;
}

const SPEED_OPTIONS = [1, 5, 20, 60];

const FAMILY_LABEL: Record<MoverFamily, string> = {
  foot: 'Foot',
  auFleet: 'AU agency / civilian fleet',
  adf: 'ADF-relevant (generic class)',
  generic: 'Generic width/weight class',
};

const FIDELITY_HINT: Record<MobilityFidelity, string> = {
  quick: 'Coarsest hexes, fastest turnaround — good for a first look or a very long-range crossing.',
  standard: 'The default balance of resolution and run time for a typical local-to-regional analysis.',
  fine: 'Finest resolution this run\'s range allows. A country-scale crossing at this setting can genuinely take minutes — it still runs entirely on THIS device, not a shared server, so it only costs your own session.',
};

function groupByFamily(profiles: MoverProfile[]): [MoverFamily, MoverProfile[]][] {
  const order: MoverFamily[] = ['foot', 'auFleet', 'adf', 'generic'];
  return order.map(f => [f, profiles.filter(p => p.family === f)]);
}

/**
 * Four broad movement classes for a fast start on mobile (owner, 2026-07-29:
 * "the coordinates panel isn't super useful and shouldn't be the 'top' of
 * the control bar. Consider a four icon/button selector for quick and broad
 * vehicle/movement classes instead of having to scroll down to the dropdown
 * and then scroll the list... then it's an easy few taps to get started").
 * Each maps to one REAL, already-catalogued profile (`moverProfiles.ts`) —
 * not a new synthetic "class", just a fast path to the four defaults most
 * likely to match a first tap, picked from the AU fleet/foot families this
 * app's own audience actually operates (docs comment on `AU_FLEET_PROFILES`:
 * "the vehicles the StationKit fire audience actually operates"). The full
 * dropdown below remains for every other catalogued profile (ADF classes,
 * generic width bands, laden/unit foot variants, specific dozer classes) —
 * this is a shortcut for the common case, not a replacement for it.
 */
const QUICK_PROFILES: { key: string; label: string; profileId: string; Icon: typeof Footprints }[] = [
  { key: 'foot', label: 'Foot', profileId: 'foot-individual-unladen', Icon: Footprints },
  { key: '4x4', label: '4x4', profileId: 'au-light-4wd', Icon: Car },
  { key: 'medium', label: 'Medium', profileId: 'au-medium-truck', Icon: Truck },
  { key: 'heavy', label: 'Heavy', profileId: 'au-heavy-dozer', Icon: Tractor },
];

export const MobilityPanel: React.FC<MobilityPanelProps> = ({
  profileId, onProfileChange, nightMode, onNightModeChange,
  roadSpeedOverrides, onRoadSpeedOverridesChange,
  fidelity, onFidelityChange,
  boxRole, onBoxRoleChange, originPaint, objectivePaint,
  brushSize, onBrushSizeChange, onClearPaint,
  running, logLines, result,
  displayMode, onDisplayModeChange, cursor,
  hasPath, simRunning, onStartSimulation, onStopSimulation,
  speedMultiplier, onSpeedMultiplierChange, simElapsedSeconds,
  cmPlacements = [], cmLedger = null,
  behaviourSpreadId, onBehaviourSpreadChange,
  movementView, onMovementViewChange,
  showTransitField, onShowTransitFieldChange,
  displayedEnsemble, displayedCorridorField,
  highlightedCorridorId, onCorridorHighlight,
  simMode, onSimModeChange,
}) => {
  const profile = MOVER_PROFILES.find(p => p.id === profileId);

  const exportInput: ExportMobilityInput | null = useMemo(() => {
    if (!result) return null;
    return {
      profile: result.profile,
      nightMode,
      usedEstimatedData: result.usedEstimatedData,
      hydrologyAvailable: result.hydrologyAvailable,
      corridorField: result.corridorField,
      chokepoints: result.chokepoints,
      barrier: result.barrier,
      roadNetworkBarrier: result.roadNetworkBarrier,
      cells: result.cells,
      placements: cmPlacements,
      measures: COUNTER_MEASURES,
      ledger: cmLedger,
    };
  }, [result, nightMode, cmPlacements, cmLedger]);

  const assistantPayload = useMemo(
    () => (result ? buildMobilityAssistantPayload(result, nightMode, cmLedger) : null),
    [result, nightMode, cmLedger]
  );

  return (
    <div className="tac-panel mobility-panel">
      <div className="tac-label">TERRAIN APPRECIATION — POC</div>

      {/* Quick mover-class picker (owner, 2026-07-29: "an easy few taps to
          get started" on mobile, ahead of the coordinate readout and the
          full dropdown — see QUICK_PROFILES's own doc comment). */}
      <div className="mobility-quick-profile-row" role="group" aria-label="Quick mover class">
        {QUICK_PROFILES.map(({ key, label, profileId: qId, Icon }) => (
          <button
            key={key}
            type="button"
            className={`mobility-quick-profile-btn${profileId === qId ? ' active' : ''}`}
            onClick={() => onProfileChange(qId)}
            aria-pressed={profileId === qId}
          >
            <Icon size={20} strokeWidth={2} aria-hidden />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="tac-panel mobility-section">
        <div className="tac-label">MOVER PROFILE</div>
        <select
          className="tac-mono mobility-select"
          value={profileId}
          onChange={e => onProfileChange(e.target.value)}
        >
          {groupByFamily(MOVER_PROFILES).map(([family, profiles]) => (
            profiles.length > 0 && (
              <optgroup key={family} label={FAMILY_LABEL[family]}>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </optgroup>
            )
          ))}
        </select>
        {profile && (
          <div className="mobility-profile-meta">
            <DataConfidenceBadge tier={profile.confidence as ConfidenceTier} />
            <span className="mobility-profile-source tac-mono">{profile.source}</span>
            {profile.notes && <span className="mobility-profile-notes tac-mono">{profile.notes}</span>}
          </div>
        )}
        <label className="mobility-night-toggle tac-mono">
          <input type="checkbox" checked={nightMode} onChange={e => onNightModeChange(e.target.checked)} />
          Night / limited visibility
        </label>
      </div>

      <RoadSpeedOverridePanel overrides={roadSpeedOverrides} onOverridesChange={onRoadSpeedOverridesChange} />

      {/* Analysis depth (docs §35, owner: "let the user select a scale of
          something like 'quick' to 'fine' for analysis depth"). The cell
          budget scales with the real origin<->objective distance AND this
          setting — a short local run behaves the same at any fidelity, a
          long-range one gets noticeably more/fewer cells (and time) per
          notch. Re-running at a different fidelity is the "more/fewer
          cells" control — no separate UI needed for that. */}
      <div className="tac-panel mobility-section">
        <div className="tac-label">ANALYSIS DEPTH</div>
        <select
          className="tac-mono mobility-select"
          value={fidelity}
          onChange={e => onFidelityChange(e.target.value as MobilityFidelity)}
        >
          <option value="quick">Quick — coarser, fastest</option>
          <option value="standard">Standard</option>
          <option value="fine">Fine — finer resolution, slower</option>
        </select>
        <div className="tac-hint">
          {FIDELITY_HINT[fidelity]}
        </div>
      </div>

      {/* How the simulated movers behave. This is the model's biggest
          assumption and it belongs in front of the user BEFORE the run, not
          buried in a caveat afterwards. */}
      <div className="tac-panel mobility-section">
        <div className="tac-label">HOW THEY MOVE</div>
        <select
          className="tac-mono mobility-select"
          value={behaviourSpreadId}
          onChange={e => onBehaviourSpreadChange(e.target.value)}
        >
          {BEHAVIOUR_SPREADS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <div className="tac-hint">{BEHAVIOUR_SPREADS.find(s => s.id === behaviourSpreadId)?.description}</div>
        <div className="mobility-caveat tac-mono">
          MODELLED BEHAVIOUR, NOT MEASURED. THE GROUND IS REAL DATA; HOW A MOVER CHOOSES ITS
          NEXT STEP — ROAD PREFERENCE, DECISIVENESS, HOW WELL IT KNOWS THE GROUND — IS AN
          ASSUMPTION, AND NO SOURCE CALIBRATES IT. USE THE SPREAD TO COMPARE OPTIONS, NOT AS
          A PREDICTION.
        </div>
      </div>

      <TacticalCoordinateReadout lat={cursor?.lat ?? null} lng={cursor?.lng ?? null} />

      <div className="tac-panel mobility-section">
        <div className="tac-label">AREAS OF INTEREST</div>
        <div className="mobility-aoi-detail tac-mono">
          <span>Origin: {originPaint.length} stroke{originPaint.length === 1 ? '' : 's'} (paint + erase)</span>
          <span>Objective: {objectivePaint.length} stroke{objectivePaint.length === 1 ? '' : 's'} (paint + erase)</span>
        </div>
        {boxRole ? (
          <div className="tac-hint">
            Painting {boxRole} area — click and drag on the map; paint appears as you drag.
            Hold <kbd>Space</kbd> (or two fingers on a touch screen) to pan without painting.
            <button className="mobility-clear-button tac-mono" onClick={() => onBoxRoleChange(null)}>Stop painting</button>
          </div>
        ) : (
          <div className="tac-hint">Use the paint-origin / paint-objective buttons on the map to draw areas.</div>
        )}
        <div className="mobility-brush-row">
          {(['small', 'medium', 'large'] as BrushSize[]).map(size => (
            <button
              key={size}
              className={`mobility-brush-btn${brushSize === size ? ' active' : ''}`}
              onClick={() => onBrushSizeChange(size)}
            >
              {size === 'small' ? 'S' : size === 'medium' ? 'M' : 'L'}
            </button>
          ))}
        </div>
        {(originPaint.length > 0 || objectivePaint.length > 0) && (
          <div className="mobility-aoi-row">
            {originPaint.length > 0 && (
              <button className="mobility-clear-button tac-mono" onClick={() => onClearPaint('origin')}>Clear origin</button>
            )}
            {objectivePaint.length > 0 && (
              <button className="mobility-clear-button tac-mono" onClick={() => onClearPaint('objective')}>Clear objective</button>
            )}
          </div>
        )}
      </div>

      <AssessmentLog lines={logLines} running={running} />

      {result && (
        <div className="tac-panel mobility-section">
          <div className="tac-label">RESULT</div>
          <div className="mobility-result-stats tac-mono">
            <div>{result.cellCount} CELLS SAMPLED</div>
            <div>{result.reachableCount} REACHABLE</div>
            <div className="mobility-stat-nogo">{result.severelyRestrictedCount} SEVERELY RESTRICTED</div>
            <div className="mobility-stat-slowgo">{result.restrictedCount} RESTRICTED</div>
          </div>
          {result.usedEstimatedData && (
            <DataConfidenceBadge tier="estimated" label="ONE OR MORE TIER 0 SAMPLES" />
          )}
          {!result.infrastructureAvailable && (
            <div className="mobility-caveat tac-mono">TRAIL DATA UNAVAILABLE — TERRAIN + FUEL ONLY</div>
          )}
          <div className="mobility-display-toggle">
            <button
              className={displayMode === 'trafficability' ? 'active' : ''}
              onClick={() => onDisplayModeChange('trafficability')}
            >
              UNRESTRICTED / RESTRICTED / SEVERELY RESTRICTED
            </button>
            <button
              className={displayMode === 'isochrone' ? 'active' : ''}
              onClick={() => onDisplayModeChange('isochrone')}
            >
              Isochrone bands
            </button>
          </div>
          <div className="mobility-export-row">
            <MobilityExportControls exportInput={exportInput} />
          </div>
        </div>
      )}

      {/* --- The headline: how movement actually went, as a distribution --- */}
      {result?.ensemble && displayedEnsemble && (
        <div className="tac-panel mobility-section">
          <div className="tac-label">
            {movementView === 'restricted' ? 'MOVEMENT — WITH RESTRICTIONS' : 'MOVEMENT — UNRESTRICTED'}
          </div>
          {result.restrictionPlan && result.restrictionPlan.restrictions.length > 0 && (
            <div className="mobility-display-toggle">
              <button
                className={movementView === 'unrestricted' ? 'active' : ''}
                onClick={() => onMovementViewChange('unrestricted')}
              >
                Unrestricted
              </button>
              <button
                className={movementView === 'restricted' ? 'active' : ''}
                onClick={() => onMovementViewChange('restricted')}
              >
                With restrictions
              </button>
            </div>
          )}
          <div className="movement-figures">
            <div className="movement-figure">
              <span className="movement-figure-value tac-mono">{minutes(displayedEnsemble.arrivalP50Seconds)}</span>
              <span className="movement-figure-label">Median journey</span>
            </div>
            <div className="movement-figure">
              <span className="movement-figure-value tac-mono">
                {minutes(displayedEnsemble.arrivalP10Seconds)} – {minutes(displayedEnsemble.arrivalP90Seconds)}
              </span>
              <span className="movement-figure-label">P10 – P90 spread</span>
            </div>
            <div className="movement-figure">
              <span className="movement-figure-value tac-mono">
                {Math.round((displayedEnsemble.arrivedCount / Math.max(1, displayedEnsemble.moverCount)) * 100)}%
              </span>
              <span className="movement-figure-label">
                Reached the objective ({displayedEnsemble.arrivedCount}/{displayedEnsemble.moverCount})
              </span>
            </div>
            <div className="movement-figure">
              <span className="movement-figure-value tac-mono">
                {Math.round(displayedEnsemble.crossCountryFraction * 100)}%
              </span>
              <span className="movement-figure-label">Of movement was off the road network</span>
            </div>
          </div>
          {displayedEnsemble.optimalSeconds !== null && (
            <div className="tac-hint">
              The optimiser's single best route is {minutes(displayedEnsemble.optimalSeconds)}. Simulated
              movers took longer because they are not optimisers — they prefer roads, cannot see
              past the next ridge, and make imperfect choices.
            </div>
          )}
          {displayedEnsemble.lostCount > 0 && (
            <div className="mobility-caveat tac-mono">
              {displayedEnsemble.lostCount} MOVER(S) NEVER ARRIVED — DEAD-ENDED OR EXHAUSTED THEIR STEP BUDGET.
            </div>
          )}
          <label className="mobility-night-toggle tac-mono">
            <input type="checkbox" checked={showTransitField} onChange={e => onShowTransitFieldChange(e.target.checked)} />
            Show transit-frequency field on the map
          </label>
          <DataConfidenceBadge tier="estimated" label="MODELLED BEHAVIOUR — ASSUMED PARAMETERS" />
        </div>
      )}

      {/* --- The actionable output: where to deny movement --- */}
      {result?.restrictionPlan && (
        <div className="tac-panel mobility-section">
          <div className="tac-label">RECOMMENDED RESTRICTIONS</div>
          {result.restrictionPlan.restrictions.length === 0 ? (
            <div className="corridor-unconstrained">
              <div className="corridor-unconstrained-head tac-mono">NOTHING WORTH BLOCKING</div>
              <p>{result.restrictionPlan.bypassNote ?? 'No candidate site imposed a meaningful delay.'}</p>
            </div>
          ) : (
            <>
              <div className="tac-hint">
                Chosen one at a time, each against the world the previous ones created — blocking a
                road does not remove that traffic, it moves it. Every figure below is a difference
                between two real runs of the simulation.
              </div>
              <div className="movement-figures">
                <div className="movement-figure">
                  <span className="movement-figure-value tac-mono">
                    {minutes(result.restrictionPlan.baselineMedianSeconds)} → {minutes(result.restrictionPlan.scenarioMedianSeconds)}
                  </span>
                  <span className="movement-figure-label">Median journey, all restrictions in place</span>
                </div>
                <div className="movement-figure">
                  <span className="movement-figure-value tac-mono">
                    {Math.round(result.restrictionPlan.baselineArrivedFraction * 100)}% → {Math.round(result.restrictionPlan.scenarioArrivedFraction * 100)}%
                  </span>
                  <span className="movement-figure-label">Movers that still reached the objective</span>
                </div>
                <div className="movement-figure">
                  <span className="movement-figure-value tac-mono">
                    {Math.round(result.restrictionPlan.baselineCrossCountryFraction * 100)}% → {Math.round(result.restrictionPlan.scenarioCrossCountryFraction * 100)}%
                  </span>
                  <span className="movement-figure-label">Movement forced off the road network</span>
                </div>
              </div>
              {result.restrictionPlan.restrictions.map(r => (
                <div key={r.id} className={`restriction-card restriction-card--${r.kind}`}>
                  <div className="restriction-card-head">
                    <span className="restriction-rank tac-mono">{r.rank}</span>
                    <span className="restriction-kind">
                      {r.kind === 'road-block' ? 'ROAD BLOCK' : 'GROUND DENIAL'}
                    </span>
                  </div>
                  <div className="corridor-figures tac-mono">
                    <div>ON GROUND {Math.round(r.baselineTransitFraction * 100)}% OF MOVERS USED</div>
                    <div>+{minutes(r.marginalMedianDelaySeconds).toUpperCase()} MEDIAN (MARGINAL)</div>
                    <div>+{minutes(r.cumulativeMedianDelaySeconds).toUpperCase()} CUMULATIVE</div>
                    <div>
                      ARRIVALS {Math.round(r.arrivedFractionBefore * 100)}% → {Math.round(r.arrivedFractionAfter * 100)}%
                    </div>
                    <div>
                      CROSS-COUNTRY {Math.round(r.crossCountryFractionBefore * 100)}% → {Math.round(r.crossCountryFractionAfter * 100)}%
                    </div>
                  </div>
                </div>
              ))}
              {result.restrictionPlan.bypassNote && (
                <div className="mobility-caveat tac-mono">{result.restrictionPlan.bypassNote}</div>
              )}
            </>
          )}
          {result.restrictionPlan.networkUnavailable && (
            <div className="mobility-caveat tac-mono">
              NO ROAD OR TRAIL DATA FOR THIS AREA — EVERY CANDIDATE IS GROUND DENIAL BY DEFAULT,
              NOT BY ANALYSIS. A ROAD BLOCK MAY BE THE BETTER MEASURE AND THIS RUN CANNOT SEE IT.
            </div>
          )}
          <div className="mobility-caveat tac-mono">
            THESE ARE SITING PRIORITIES FROM A BEHAVIOUR MODEL, NOT ENGINEERING ESTIMATES. WHAT IT
            TAKES TO BUILD AND BREACH A SPECIFIC OBSTACLE IS THE COUNTER-MOBILITY PLANNER'S
            DELAY LEDGER, WHICH ANSWERS A DIFFERENT QUESTION.
          </div>
          <div className="mobility-caveat tac-mono">
            EACH CANDIDATE WAS RANKED ON {result.restrictionPlan.evaluationMoverCount} MOVERS;
            THE FIGURES SHOWN ARE FROM FULL-COUNT RE-RUNS.
          </div>
        </div>
      )}

      {displayedCorridorField && displayedCorridorField.corridors.length > 0 && (
        <div className="tac-panel mobility-section">
          <div className="tac-label">MOVEMENT CORRIDORS</div>
          <div className="tac-hint">
            {displayedCorridorField.evidence === 'simulated-movers'
              ? <>Bands are smoothed from the tracks of {displayedCorridorField.routes.length} simulated movers —
                  where movement actually went, at the frequency it went there.</>
              : <>Bands are smoothed from {displayedCorridorField.routes.length} computed optimal routes.</>}
            {' '}Width shows where movement is <em>likely</em>, not a surveyed lane —
            {' '}{displayedCorridorField.routedCellCount} cells were actually crossed,
            {' '}{displayedCorridorField.cellCount} fall in the bands after smoothing.
            {' '}Select a corridor to isolate it on the map.
          </div>
          {displayedCorridorField.unconstrained && (
            <div className="corridor-unconstrained">
              <div className="corridor-unconstrained-head tac-mono">MOVEMENT UNCONSTRAINED</div>
              <p>
                Movement spread across {Math.round(displayedCorridorField.coverageFraction * 100)}% of this
                area — it does not canalise movement, so the corridors below are a weak
                description of it and the chokepoints are not real chokepoints.
              </p>
              <p>
                <strong>What this means for denial:</strong> obstacles sited at points will be
                walked around. Denying this ground needs observation and fires, or a continuous
                barrier — a materially different and more expensive course of action. Consider
                a tighter objective area, or a mover profile the terrain actually restricts.
              </p>
            </div>
          )}
          {displayedCorridorField.corridors.map(c => (
            <button
              key={c.id}
              type="button"
              className={
                `corridor-card corridor-card--rank${Math.min(c.rank, 4)}` +
                (highlightedCorridorId === c.id ? ' selected' : '') +
                (highlightedCorridorId && highlightedCorridorId !== c.id ? ' dimmed' : '')
              }
              onClick={() => onCorridorHighlight(highlightedCorridorId === c.id ? null : c.id)}
              aria-pressed={highlightedCorridorId === c.id}
            >
              <div className="corridor-card-head">
                <span className="corridor-rank tac-mono">CORRIDOR {c.rank}</span>
                <span className={`corridor-ease corridor-ease--${c.easeClass}`}>
                  {c.easeClass.replace('-', ' ').toUpperCase()}
                </span>
              </div>
              {(c.id === displayedCorridorField.mostLikelyCorridorId || c.id === displayedCorridorField.mostRiskyCorridorId) && (
                <div className="corridor-picks">
                  {c.id === displayedCorridorField.mostLikelyCorridorId && (
                    <span className="corridor-pick corridor-pick--likely">MOST LIKELY</span>
                  )}
                  {c.id === displayedCorridorField.mostRiskyCorridorId && (
                    <span className="corridor-pick corridor-pick--risky">MOST RISKY</span>
                  )}
                </div>
              )}
              <div className="corridor-figures tac-mono">
                <div>
                  {Math.round(c.shareOfRoutes * 100)}% OF{' '}
                  {displayedCorridorField.evidence === 'simulated-movers' ? 'MOVERS' : 'ROUTES'}
                  {' '}({c.routeCount}/{displayedCorridorField.routes.length})
                </div>
                <div>MEDIAN {(c.medianTravelSeconds / 60).toFixed(0)} MIN · BEST {(c.fastestTravelSeconds / 60).toFixed(0)} MIN</div>
                <div>BOTTLENECK ~{c.bottleneckWidthM.toFixed(0)} M</div>
                <div>{c.bottleneckAbreast} ABREAST · {c.frontage.replace('-', ' ').toUpperCase()}</div>
                <div>{Math.round(c.unrestrictedFraction * 100)}% UNRESTRICTED · {Math.round(c.restrictedFraction * 100)}% RESTRICTED</div>
                <div>{Math.round(c.riskScore * 100)}% RISK · {Math.round(c.waterCrossingFraction * 100)}% WATER</div>
                <div>{c.cells.length} CELLS</div>
              </div>
              {c.usedEstimatedData && (
                <DataConfidenceBadge tier="estimated" label="CONTAINS TIER 0 SAMPLES" />
              )}
            </button>
          ))}
          <div className="mobility-caveat tac-mono">
            BOTTLENECK WIDTHS ARE GRID-RESOLUTION-LIMITED ESTIMATES, NOT SURVEYED GAPS.
            ECHELON/COLUMN THROUGHPUT AND VCI PASS VERDICTS ARE NOT CLAIMED — THEY NEED
            SOURCED MARCH-SPACING AND SOIL DATA THIS BUILD DOES NOT HAVE.
          </div>
        </div>
      )}

      {result && result.dissimilarRoutes.length > 0 && (
        <div className="tac-panel mobility-section">
          <div className="tac-label">CHOKEPOINTS &amp; SEVERING CUT</div>
          <div className="mobility-result-stats tac-mono">
            <div>{result.dissimilarRoutes.length} DISTINCT ROUTE(S)</div>
            <div>{result.chokepoints.length} CHOKEPOINT(S)</div>
          </div>
          {result.barrier ? (
            <>
              <div className="mobility-caveat tac-mono">
                MIN-CUT: {result.barrier.segments.length} SEGMENT(S), CUT VALUE {result.barrier.cutValue.toFixed(0)}
              </div>
              <DataConfidenceBadge tier="estimated" label="UNIT/TRAIL-WEIGHTED, NOT REAL VEHICLE CAPACITY" />
            </>
          ) : (
            <div className="mobility-caveat tac-mono">NO SEPARATING CUT FOUND FOR THIS PROFILE</div>
          )}
        </div>
      )}

      {assistantPayload && (
        <div className="tac-panel mobility-section">
          <MobilityAssistantCard payload={assistantPayload} />
        </div>
      )}

      {hasPath && (
        <div className="tac-panel mobility-section">
          <div className="tac-label">PLAYBACK</div>
          <div className="mobility-display-toggle">
            <button
              className={simMode === 'ensemble' ? 'active' : ''}
              onClick={() => onSimModeChange('ensemble')}
              disabled={(displayedEnsemble?.sampleTrajectories.length ?? 0) === 0}
            >
              Many movers
            </button>
            <button
              className={simMode === 'single' ? 'active' : ''}
              onClick={() => onSimModeChange('single')}
            >
              One unit, replanning
            </button>
          </div>
          <div className="tac-hint">
            {simMode === 'ensemble'
              ? <>Watch {displayedEnsemble?.sampleTrajectories.length ?? 0} of the simulated movers set off
                  together and find their own way. Where they converge is the corridor.</>
              : <>A single unit on the optimiser's best route, which re-searches from its actual
                  position part-way through — a different demonstration: real mid-course replanning.</>}
          </div>
          <div className="mobility-speed-toggle">
            {SPEED_OPTIONS.map(x => (
              <button
                key={x}
                className={speedMultiplier === x ? 'active' : ''}
                onClick={() => onSpeedMultiplierChange(x)}
              >
                {x}×
              </button>
            ))}
          </div>
          <button className="mobility-sim-button" onClick={simRunning ? onStopSimulation : onStartSimulation}>
            {simRunning ? 'Stop playback' : 'Simulate movement'}
          </button>
          {simRunning && simElapsedSeconds !== null && (
            <div className="mobility-eta tac-mono">
              ELAPSED {Math.floor(simElapsedSeconds / 60)}m {Math.round(simElapsedSeconds % 60)}s
            </div>
          )}
        </div>
      )}

      <div className="mobility-limitation-panel tac-mono">
        POC LIMITATIONS: vegetation structure (stem diameter / gap width) is a Tier 0
        estimate keyed to vegetation class, not measured per cell. Cross-slope is a
        direction-agnostic worst-case proxy (steepest local gradient), not a true
        per-direction-of-travel calculation. Time-since-fire/fractional-cover/surface-water
        (Tier 1) are built but not yet sampled per cell. Real soil/lidar structure data
        and imagery analysis are later passes, not this one.
      </div>
    </div>
  );
};

export default MobilityPanel;
