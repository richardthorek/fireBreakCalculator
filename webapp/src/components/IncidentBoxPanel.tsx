/**
 * Incident box recommendation panel — fire-break mode only.
 *
 * Flow: get a fire perimeter (manual draw or imported from the live fire
 * boundary feed) → get wind (live fetch or manual entry) → enter rate of
 * spread (manual, the user's own figure) → solve a conservative standoff
 * box per sector ("rate of spread + build time = minimum distance") →
 * pathfind the box into a real buildable corridor → show the conservative
 * (slowest compatible resource) construction-time estimate.
 *
 * All the actual number-crunching lives in `incidentBoxPlanner.ts`
 * (geometry/ROS solve) and the existing `/api/analysis/calculate` engine
 * (construction time/cost) — this component is display + input plumbing
 * only, per the "deterministic core, AI/UI never computes" rule.
 */

import React, { useCallback, useState } from 'react';
import { LatLng } from '@firebreak/terrain';
import { WindObservation, fetchWindObservation, manualWindObservation } from '../utils/windService';
import { planIncidentBox, IncidentBoxPlan, RateOfSpreadInputs } from '../utils/incidentBoxPlanner';
import { fetchImportableFireBoundaries, ImportableFireBoundary } from '../utils/incidentBoundaryImport';
import { centroidOf } from '../utils/incidentBoxGeometry';

interface IncidentBoxPanelProps {
  active: boolean;
  onActiveChange: (active: boolean) => void;
  /** True while the map's own draw tool is armed and collecting clicks. */
  drawingActive: boolean;
  onDrawingActiveChange: (active: boolean) => void;
  /** Perimeter finished by the map's draw tool (fires once per finish). */
  drawnPerimeter: LatLng[] | null;
  onBoxRingChange: (ring: [number, number][] | null) => void;
  mapCenter: LatLng | null;
}

type Stage = 'perimeter' | 'wind-ros' | 'plan';

export const IncidentBoxPanel: React.FC<IncidentBoxPanelProps> = ({
  active,
  onActiveChange,
  drawingActive,
  onDrawingActiveChange,
  drawnPerimeter,
  onBoxRingChange,
  mapCenter,
}) => {
  const [perimeter, setPerimeter] = useState<LatLng[] | null>(null);
  const [importCandidates, setImportCandidates] = useState<ImportableFireBoundary[] | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [wind, setWind] = useState<WindObservation | null>(null);
  const [windLoading, setWindLoading] = useState(false);
  const [manualDirection, setManualDirection] = useState('');
  const [manualSpeed, setManualSpeed] = useState('');
  const [headRos, setHeadRos] = useState('');
  const [flankRos, setFlankRos] = useState('');
  const [rearRos, setRearRos] = useState('');
  const [plan, setPlan] = useState<IncidentBoxPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  // A perimeter just finished on the map — adopt it and move to the next stage.
  React.useEffect(() => {
    if (drawnPerimeter && drawnPerimeter.length >= 3) {
      setPerimeter(drawnPerimeter);
      setPlan(null);
      onBoxRingChange(null);
    }
  }, [drawnPerimeter, onBoxRingChange]);

  const stage: Stage = !perimeter ? 'perimeter' : plan ? 'plan' : 'wind-ros';

  const handleFindNearbyFires = useCallback(async () => {
    setImportLoading(true);
    try {
      const near = mapCenter ?? undefined;
      const results = await fetchImportableFireBoundaries(near);
      setImportCandidates(results.slice(0, 8));
    } finally {
      setImportLoading(false);
    }
  }, [mapCenter]);

  const handleUseImportedBoundary = useCallback((boundary: ImportableFireBoundary) => {
    setPerimeter(boundary.ring);
    setImportCandidates(null);
    setPlan(null);
    onBoxRingChange(null);
  }, [onBoxRingChange]);

  const handleFetchWind = useCallback(async () => {
    if (!perimeter) return;
    setWindLoading(true);
    try {
      const centroid = centroidOf(perimeter);
      const observation = await fetchWindObservation(centroid.lat, centroid.lng);
      if (observation) setWind(observation);
    } finally {
      setWindLoading(false);
    }
  }, [perimeter]);

  const handleUseManualWind = useCallback(() => {
    const dir = Number(manualDirection);
    const speed = Number(manualSpeed);
    if (!Number.isFinite(dir) || !Number.isFinite(speed)) return;
    setWind(manualWindObservation(dir, speed));
  }, [manualDirection, manualSpeed]);

  const handleGeneratePlan = useCallback(async () => {
    if (!perimeter || !wind) return;
    const head = Number(headRos);
    if (!Number.isFinite(head) || head <= 0) {
      setPlanError('Enter a head rate of spread (m/h) greater than zero.');
      return;
    }
    const ros: RateOfSpreadInputs = {
      headMPerHour: head,
      flankMPerHour: flankRos ? Number(flankRos) : undefined,
      rearMPerHour: rearRos ? Number(rearRos) : undefined,
    };
    setPlanLoading(true);
    setPlanError(null);
    try {
      const result = await planIncidentBox(perimeter, wind, ros);
      setPlan(result);
      onBoxRingChange(result.ring);
    } catch (err: any) {
      setPlanError(err?.message || 'Could not generate the incident box.');
    } finally {
      setPlanLoading(false);
    }
  }, [perimeter, wind, headRos, flankRos, rearRos, onBoxRingChange]);

  const handleReset = useCallback(() => {
    setPerimeter(null);
    setPlan(null);
    setImportCandidates(null);
    onBoxRingChange(null);
  }, [onBoxRingChange]);

  if (!active) {
    return (
      <button type="button" className="incident-box-panel-open-btn" onClick={() => onActiveChange(true)}>
        Incident box
      </button>
    );
  }

  return (
    <div className="incident-box-panel">
      <div className="incident-box-panel-header">
        <h3>Incident box</h3>
        <button type="button" onClick={() => { onActiveChange(false); handleReset(); }}>Close</button>
      </div>

      {stage === 'perimeter' && (
        <div className="incident-box-panel-section">
          <p>Get the current fire perimeter — rough is fine (roads/waterways as landmarks), refine later.</p>
          <button type="button" onClick={() => onDrawingActiveChange(!drawingActive)}>
            {drawingActive ? 'Drawing… click perimeter on map' : 'Draw perimeter on map'}
          </button>
          <button type="button" onClick={handleFindNearbyFires} disabled={importLoading}>
            {importLoading ? 'Searching…' : 'Load from live fire boundary'}
          </button>
          {importCandidates && (
            <ul className="incident-box-import-list">
              {importCandidates.length === 0 && <li>No mapped fire boundaries found.</li>}
              {importCandidates.map(c => (
                <li key={c.id}>
                  <button type="button" onClick={() => handleUseImportedBoundary(c)}>
                    {c.name} ({c.state}{c.areaHa != null ? `, ${Math.round(c.areaHa)} ha` : ''})
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {stage === 'wind-ros' && perimeter && (
        <div className="incident-box-panel-section">
          <p>{perimeter.length} perimeter vertices set.</p>

          <div className="incident-box-wind-block">
            <button type="button" onClick={handleFetchWind} disabled={windLoading}>
              {windLoading ? 'Fetching wind…' : 'Fetch live wind'}
            </button>
            {wind && (
              <p className="incident-box-wind-reading">
                {Math.round(wind.speedKmh)} km/h from {Math.round(wind.directionFromDeg)}°
                {wind.source === 'manual' ? ' (manual entry)' : ' (live forecast, not an official BOM product)'}
              </p>
            )}
            <div className="incident-box-manual-wind">
              <input type="number" placeholder="Direction FROM (0-360)" value={manualDirection} onChange={e => setManualDirection(e.target.value)} />
              <input type="number" placeholder="Speed (km/h)" value={manualSpeed} onChange={e => setManualSpeed(e.target.value)} />
              <button type="button" onClick={handleUseManualWind}>Use manual wind</button>
            </div>
          </div>

          <div className="incident-box-ros-block">
            <label>
              Head rate of spread (m/h) — required
              <input type="number" value={headRos} onChange={e => setHeadRos(e.target.value)} />
            </label>
            <label>
              Flank rate of spread (m/h) — optional, defaults to head (conservative)
              <input type="number" value={flankRos} onChange={e => setFlankRos(e.target.value)} />
            </label>
            <label>
              Rear rate of spread (m/h) — optional, defaults to head (conservative)
              <input type="number" value={rearRos} onChange={e => setRearRos(e.target.value)} />
            </label>
          </div>

          {planError && <p className="incident-box-error">{planError}</p>}
          <button type="button" disabled={!wind || planLoading} onClick={handleGeneratePlan}>
            {planLoading ? 'Solving standoff distances…' : 'Generate box'}
          </button>
          <button type="button" onClick={handleReset}>Start over</button>
        </div>
      )}

      {stage === 'plan' && plan && (
        <div className="incident-box-panel-section">
          <p className="incident-box-headline">
            Conservative estimate: <strong>{plan.conservativeHours.toFixed(1)} h</strong> to build
            {' '}({Math.round(plan.distance)} m), using the slowest compatible resource.
          </p>
          {plan.anySectorUnconverged && (
            <p className="incident-box-caveat">
              At least one sector's standoff distance did not fully converge — treat it as a lower bound, not a settled answer.
            </p>
          )}
          {plan.usedFallbackRoute && (
            <p className="incident-box-caveat">
              Corridor pathfinding was unavailable — this is the raw box outline, not a road/trail-snapped route.
            </p>
          )}
          <table className="incident-box-sector-table">
            <thead><tr><th>Sector</th><th>ROS (m/h)</th><th>Standoff (m)</th><th>Build time (h)</th><th>Converged</th></tr></thead>
            <tbody>
              {plan.sectors.map(s => (
                <tr key={s.sector}>
                  <td>{s.sector}</td>
                  <td>{s.rosMPerHour}</td>
                  <td>{Math.round(s.distanceM)}</td>
                  <td>{Number.isFinite(s.buildTimeHours) ? s.buildTimeHours.toFixed(1) : '—'}</td>
                  <td>{s.converged ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="incident-box-equipment-table">
            <thead><tr><th>Resource</th><th>Time (h)</th><th>Cost</th><th>Compatible</th></tr></thead>
            <tbody>
              {plan.finalAnalysis.calculations.map(c => (
                <tr key={c.id} className={c.compatible ? '' : 'incompatible'}>
                  <td>{c.name}</td>
                  <td>{c.time.toFixed(1)}</td>
                  <td>{c.cost.toFixed(0)}</td>
                  <td>{c.compatible ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" onClick={handleReset}>Start over</button>
        </div>
      )}
    </div>
  );
};
