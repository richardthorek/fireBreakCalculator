/**
 * Manual tier-2 backend job trigger (OCOKA 5, docs/ROUTE_INTELLIGENCE.md
 * §47.3). Deliberately MANUAL, not automatic threshold routing — §38's own
 * gate: "the right trigger is a function of (cell count × terrain/veg
 * difficulty mix) calibrated against what THIS device has actually
 * measured... until there's enough of it, no automatic tier-2/tier-3
 * routing should ship." A manual "try the backend" button needs no such
 * calibration and gives the telemetry that gate is waiting on real usage
 * of, without asserting a threshold this product hasn't earned yet.
 *
 * Renders nothing when `isMobilityBackendConfigured()` is false — every
 * deployment until the owner sets `VITE_MOBILITY_API_BASE_URL` at a real
 * cutover, so there's no dead button pointing at a backend that doesn't
 * exist yet.
 */

import React, { useCallback, useRef, useState } from 'react';
import { paintedAreaBounds, PaintedArea } from '@firebreak/terrain';
import {
  isMobilityBackendConfigured, MobilityJobArtefact, MobilityJobStatusResponse, MobilityJobFidelity,
} from '../utils/mobilityJobApi';
import { startMobilityJobSession, MobilityJobSession } from '../terrain/mobilityJobClient';

export interface MobilityBackendJobPanelProps {
  originPaint: PaintedArea;
  objectivePaint: PaintedArea;
  profileId: string;
  nightMode: boolean;
  fidelity: MobilityJobFidelity;
}

type RunState =
  | { kind: 'idle' }
  | { kind: 'running'; jobId: string; artefactCount: number; incompleteStages?: string[] }
  | { kind: 'complete'; jobId: string; artefactCount: number }
  | { kind: 'error'; message: string };

export const MobilityBackendJobPanel: React.FC<MobilityBackendJobPanelProps> = ({
  originPaint, objectivePaint, profileId, nightMode, fidelity,
}) => {
  const [state, setState] = useState<RunState>({ kind: 'idle' });
  const sessionRef = useRef<MobilityJobSession | null>(null);

  const start = useCallback(async () => {
    const originBounds = paintedAreaBounds(originPaint);
    const objectiveBounds = paintedAreaBounds(objectivePaint);
    if (!originBounds || !objectiveBounds) {
      setState({ kind: 'error', message: 'Paint both an origin and an objective area first.' });
      return;
    }
    sessionRef.current?.cancel();
    setState({ kind: 'running', jobId: '', artefactCount: 0 });
    try {
      const session = await startMobilityJobSession(
        { originBounds, objectiveBounds, moverProfileId: profileId, nightMode, fidelity },
        {
          onArtefact: (_artefact: MobilityJobArtefact) => {
            setState((prev) => (prev.kind === 'running' ? { ...prev, artefactCount: prev.artefactCount + 1 } : prev));
          },
          onStatus: (status: MobilityJobStatusResponse) => {
            setState((prev) =>
              prev.kind === 'running' ? { ...prev, jobId: status.jobId, incompleteStages: status.incompleteStages } : prev
            );
          },
          onComplete: (status: MobilityJobStatusResponse) => {
            setState({ kind: 'complete', jobId: status.jobId, artefactCount: status.artefacts.length });
          },
          onError: (message: string) => setState({ kind: 'error', message }),
        }
      );
      sessionRef.current = session;
      setState((prev) => (prev.kind === 'running' ? { ...prev, jobId: session.jobId } : prev));
    } catch (err: any) {
      setState({ kind: 'error', message: err?.message ?? 'Job submit failed' });
    }
  }, [originPaint, objectivePaint, profileId, nightMode, fidelity]);

  const cancel = useCallback(() => {
    sessionRef.current?.cancel();
    setState({ kind: 'idle' });
  }, []);

  if (!isMobilityBackendConfigured()) return null;

  return (
    <div className="tac-panel mobility-section">
      <div className="tac-label">BACKEND JOB (EXPERIMENTAL)</div>
      <p className="tac-hint">
        Runs this appreciation server-side instead of in this tab — useful on a slow device or a large area.
        A v1 subset of factors only (route, corridors, obstacles, unscored key terrain); requires connectivity.
      </p>
      {state.kind === 'idle' && (
        <button className="mobility-clear-button tac-mono" onClick={start}>Run on backend</button>
      )}
      {state.kind === 'running' && (
        <div className="tac-mono">
          <span>Running… {state.artefactCount} artefact{state.artefactCount === 1 ? '' : 's'} received</span>
          {state.incompleteStages && state.incompleteStages.length > 0 && (
            <span> · remaining: {state.incompleteStages.join(', ')}</span>
          )}
          <button className="mobility-clear-button tac-mono" onClick={cancel}>Stop watching</button>
        </div>
      )}
      {state.kind === 'complete' && (
        <div className="tac-mono">
          <span>Complete — {state.artefactCount} artefact(s). Job {state.jobId}.</span>
          <button className="mobility-clear-button tac-mono" onClick={() => setState({ kind: 'idle' })}>Reset</button>
        </div>
      )}
      {state.kind === 'error' && (
        <div className="tac-mono">
          <span>{state.message}</span>
          <button className="mobility-clear-button tac-mono" onClick={() => setState({ kind: 'idle' })}>Dismiss</button>
        </div>
      )}
    </div>
  );
};
