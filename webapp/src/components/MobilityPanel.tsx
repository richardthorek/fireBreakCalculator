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

export interface MobilityPanelProps {
  profileId: string;
  onProfileChange: (id: string) => void;
  nightMode: boolean;
  onNightModeChange: (v: boolean) => void;
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

  // Unit movement simulation (owner "bonus feature", 2026-07-26).
  hasPath: boolean;
  simRunning: boolean;
  onStartSimulation: () => void;
  onStopSimulation: () => void;
  speedMultiplier: number;
  onSpeedMultiplierChange: (x: number) => void;
  simElapsedSeconds: number | null;
}

const SPEED_OPTIONS = [1, 5, 20, 60];

const FAMILY_LABEL: Record<MoverFamily, string> = {
  foot: 'Foot',
  auFleet: 'AU agency / civilian fleet',
  adf: 'ADF-relevant (generic class)',
  generic: 'Generic width/weight class',
};

function groupByFamily(profiles: MoverProfile[]): [MoverFamily, MoverProfile[]][] {
  const order: MoverFamily[] = ['foot', 'auFleet', 'adf', 'generic'];
  return order.map(f => [f, profiles.filter(p => p.family === f)]);
}

export const MobilityPanel: React.FC<MobilityPanelProps> = ({
  profileId, onProfileChange, nightMode, onNightModeChange,
  boxRole, onBoxRoleChange, originPaint, objectivePaint,
  brushSize, onBrushSizeChange, onClearPaint,
  running, logLines, result,
  displayMode, onDisplayModeChange, cursor,
  hasPath, simRunning, onStartSimulation, onStopSimulation,
  speedMultiplier, onSpeedMultiplierChange, simElapsedSeconds,
  cmPlacements = [], cmLedger = null,
}) => {
  const profile = MOVER_PROFILES.find(p => p.id === profileId);

  const exportInput: ExportMobilityInput | null = useMemo(() => {
    if (!result) return null;
    return {
      profile: result.profile,
      nightMode,
      usedEstimatedData: result.usedEstimatedData,
      corridorField: result.corridorField,
      chokepoints: result.chokepoints,
      barrier: result.barrier,
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

      <TacticalCoordinateReadout lat={cursor?.lat ?? null} lng={cursor?.lng ?? null} />

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

      <div className="tac-panel mobility-section">
        <div className="tac-label">AREAS OF INTEREST</div>
        <div className="mobility-aoi-detail tac-mono">
          <span>Origin: {originPaint.length} stroke{originPaint.length === 1 ? '' : 's'} (paint + erase)</span>
          <span>Objective: {objectivePaint.length} stroke{objectivePaint.length === 1 ? '' : 's'} (paint + erase)</span>
        </div>
        {boxRole ? (
          <div className="tac-hint">
            Painting {boxRole} area — drag on the map. <button className="mobility-clear-button tac-mono" onClick={() => onBoxRoleChange(null)}>Stop painting</button>
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
            <div className="mobility-stat-nogo">{result.noGoCount} NO-GO</div>
            <div className="mobility-stat-slowgo">{result.slowGoCount} SLOW-GO</div>
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
              GO / SLOW-GO / NO-GO
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

      {result?.corridorField && result.corridorField.corridors.length > 0 && (
        <div className="tac-panel mobility-section">
          <div className="tac-label">MOVEMENT CORRIDORS</div>
          <div className="tac-hint">
            Bands are smoothed from {result.corridorField.routes.length} analysed routes.
            Width shows where movement is <em>likely</em>, not a surveyed lane —
            {result.corridorField.routedCellCount} cells were actually routed through,
            {result.corridorField.cellCount} fall in the bands after smoothing.
          </div>
          {result.corridorField.unconstrained && (
            <div className="corridor-unconstrained">
              <div className="corridor-unconstrained-head tac-mono">MOVEMENT UNCONSTRAINED</div>
              <p>
                Routes spread across {Math.round(result.corridorField.coverageFraction * 100)}% of this
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
          {result.corridorField.corridors.map(c => (
            <div key={c.id} className={`corridor-card corridor-card--rank${Math.min(c.rank, 4)}`}>
              <div className="corridor-card-head">
                <span className="corridor-rank tac-mono">CORRIDOR {c.rank}</span>
                <span className={`corridor-ease corridor-ease--${c.easeClass}`}>
                  {c.easeClass.replace('-', ' ').toUpperCase()}
                </span>
              </div>
              <div className="corridor-figures tac-mono">
                <div>{c.routeCount}/{result.corridorField!.routes.length} ROUTES ({Math.round(c.shareOfRoutes * 100)}%)</div>
                <div>MEDIAN {(c.medianTravelSeconds / 60).toFixed(0)} MIN · BEST {(c.fastestTravelSeconds / 60).toFixed(0)} MIN</div>
                <div>BOTTLENECK ~{c.bottleneckWidthM.toFixed(0)} M</div>
                <div>{c.bottleneckAbreast} ABREAST · {c.frontage.replace('-', ' ').toUpperCase()}</div>
                <div>{Math.round(c.goFraction * 100)}% GO · {Math.round(c.slowGoFraction * 100)}% SLOW</div>
                <div>{c.cells.length} CELLS</div>
              </div>
              {c.usedEstimatedData && (
                <DataConfidenceBadge tier="estimated" label="CONTAINS TIER 0 SAMPLES" />
              )}
            </div>
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
          <div className="tac-label">UNIT SIMULATION</div>
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
            {simRunning ? 'Stop simulation' : 'Simulate movement'}
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
