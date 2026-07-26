/**
 * Terrain Mobility mode panel — Pass 1 (docs/ROUTE_INTELLIGENCE.md "Terrain
 * Mobility & Counter-Mobility"). Area-to-area movement appreciation: draw an
 * origin area, an objective area, pick a mover profile, run a multi-source
 * search. State (boxes, profile, results, log) lives in App.tsx and is
 * passed in as props/callbacks, mirroring how AnalysisPanel/AdvisorPanel are
 * already wired — this panel renders, App.tsx orchestrates.
 */

import React from 'react';
import { MOVER_PROFILES, MoverProfile, MoverFamily } from '../terrain/moverProfiles';
import { MobilityAppreciationResult } from '../terrain/mobilityAppreciation';
import { TacticalCoordinateReadout } from './TacticalCoordinateReadout';
import { AssessmentLog } from './AssessmentLog';
import { DataConfidenceBadge, ConfidenceTier } from './DataConfidenceBadge';

export interface MobilityAoiBox {
  sw: { lat: number; lng: number };
  ne: { lat: number; lng: number };
}

export interface MobilityPanelProps {
  profileId: string;
  onProfileChange: (id: string) => void;
  nightMode: boolean;
  onNightModeChange: (v: boolean) => void;
  boxRole: 'origin' | 'objective' | null;
  onBoxRoleChange: (role: 'origin' | 'objective' | null) => void;
  originBox: MobilityAoiBox | null;
  objectiveBox: MobilityAoiBox | null;
  onClearBoxes: () => void;
  onRun: () => void;
  onCancel: () => void;
  running: boolean;
  logLines: string[];
  result: MobilityAppreciationResult | null;
  displayMode: 'trafficability' | 'isochrone';
  onDisplayModeChange: (m: 'trafficability' | 'isochrone') => void;
  cursor: { lat: number; lng: number } | null;

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
  boxRole, onBoxRoleChange, originBox, objectiveBox, onClearBoxes,
  onRun, onCancel, running, logLines, result,
  displayMode, onDisplayModeChange, cursor,
  hasPath, simRunning, onStartSimulation, onStopSimulation,
  speedMultiplier, onSpeedMultiplierChange, simElapsedSeconds,
}) => {
  const profile = MOVER_PROFILES.find(p => p.id === profileId);
  const canRun = !!originBox && !!objectiveBox && !running;

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
        <div className="mobility-aoi-row">
          <button
            className={`mobility-aoi-button mobility-aoi-button--origin${boxRole === 'origin' ? ' active' : ''}`}
            onClick={() => onBoxRoleChange(boxRole === 'origin' ? null : 'origin')}
          >
            {boxRole === 'origin' ? 'Click two corners…' : originBox ? 'Redraw origin area' : 'Draw origin area'}
          </button>
          <button
            className={`mobility-aoi-button mobility-aoi-button--objective${boxRole === 'objective' ? ' active' : ''}`}
            onClick={() => onBoxRoleChange(boxRole === 'objective' ? null : 'objective')}
          >
            {boxRole === 'objective' ? 'Click two corners…' : objectiveBox ? 'Redraw objective area' : 'Draw objective area'}
          </button>
        </div>
        {(originBox || objectiveBox) && (
          <button className="mobility-clear-button tac-mono" onClick={onClearBoxes}>Clear areas</button>
        )}
      </div>

      <div className="mobility-run-row">
        {!running ? (
          <button className="mobility-run-button" disabled={!canRun} onClick={onRun}>
            Run terrain appreciation
          </button>
        ) : (
          <button className="mobility-run-button mobility-run-button--cancel" onClick={onCancel}>
            Cancel
          </button>
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
        estimate from NVIS formation only — not measured. Cross-slope is not evaluated
        in the reachability search. Counter-mobility planning, imagery analysis and real
        soil/lidar structure data are later passes, not this one.
      </div>
    </div>
  );
};

export default MobilityPanel;
