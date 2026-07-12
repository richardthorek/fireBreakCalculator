/**
 * Live context layers control — toggles for the national situational feeds
 * (hotspots, fire boundaries) and jurisdictional incidents, with per-source
 * status, "as of" timestamps and attribution.
 *
 * Data honesty rules: a failed source shows an explicit error (never a
 * silent empty layer); jurisdictions with no feed are listed so missing
 * markers are never mistaken for "no incidents"; every layer shows when it
 * was fetched.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchHotspots, fetchFireBoundaries, fetchIncidents, incidentsToGeoJson,
  INCIDENTS_NOT_COVERED,
  HotspotsResult, BoundariesResult, IncidentsResult, ViewBounds
} from '../utils/liveFeedsService';
import type { LiveFeedMapData } from '../utils/liveFeedLayers';
import { logger } from '../utils/logger';

const REFRESH_MS = 5 * 60 * 1000;

interface LiveFeedsControlProps {
  /** Current map view bounds — drives the hotspot bbox query. */
  viewBounds: ViewBounds | null;
  /** Emits the combined layer data whenever anything changes. */
  onData: (data: LiveFeedMapData) => void;
}

interface FeedToggleState { enabled: boolean; loading: boolean; error: string | null }

const asOf = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/** Pad a bbox by a fraction on each side so small pans don't refetch. */
const padBounds = (b: ViewBounds, frac: number): ViewBounds => {
  const dLat = (b.maxLat - b.minLat) * frac;
  const dLng = (b.maxLng - b.minLng) * frac;
  return { minLat: b.minLat - dLat, maxLat: b.maxLat + dLat, minLng: b.minLng - dLng, maxLng: b.maxLng + dLng };
};

const contains = (outer: ViewBounds, inner: ViewBounds): boolean =>
  inner.minLat >= outer.minLat && inner.maxLat <= outer.maxLat &&
  inner.minLng >= outer.minLng && inner.maxLng <= outer.maxLng;

export const LiveFeedsControl: React.FC<LiveFeedsControlProps> = ({ viewBounds, onData }) => {
  const [open, setOpen] = useState(false);
  const [hotspotsState, setHotspotsState] = useState<FeedToggleState>({ enabled: false, loading: false, error: null });
  const [boundariesState, setBoundariesState] = useState<FeedToggleState>({ enabled: false, loading: false, error: null });
  const [incidentsState, setIncidentsState] = useState<FeedToggleState>({ enabled: false, loading: false, error: null });

  const [hotspots, setHotspots] = useState<HotspotsResult | null>(null);
  const [boundaries, setBoundaries] = useState<BoundariesResult | null>(null);
  const [incidents, setIncidents] = useState<IncidentsResult | null>(null);

  // The bbox the current hotspot data was fetched for (padded).
  const hotspotFetchBoundsRef = useRef<ViewBounds | null>(null);
  const viewBoundsRef = useRef<ViewBounds | null>(viewBounds);
  viewBoundsRef.current = viewBounds;

  // Publish combined data upward whenever anything material changes.
  useEffect(() => {
    onData({
      hotspots: hotspotsState.enabled ? hotspots : null,
      boundaries: boundariesState.enabled ? boundaries : null,
      incidents: incidentsState.enabled && incidents ? incidentsToGeoJson(incidents.incidents) : null
    });
  }, [hotspots, boundaries, incidents, hotspotsState.enabled, boundariesState.enabled, incidentsState.enabled, onData]);

  const loadHotspots = useCallback(async () => {
    const b = viewBoundsRef.current;
    if (!b) return;
    setHotspotsState(s => ({ ...s, loading: true }));
    try {
      const padded = padBounds(b, 0.5);
      const result = await fetchHotspots(padded);
      hotspotFetchBoundsRef.current = padded;
      setHotspots(result);
      setHotspotsState(s => ({ ...s, loading: false, error: null }));
    } catch (e: any) {
      logger.warn('Hotspots fetch failed', e);
      setHotspotsState(s => ({ ...s, loading: false, error: e?.message ?? 'fetch failed' }));
    }
  }, []);

  const loadBoundaries = useCallback(async () => {
    setBoundariesState(s => ({ ...s, loading: true }));
    try {
      setBoundaries(await fetchFireBoundaries());
      setBoundariesState(s => ({ ...s, loading: false, error: null }));
    } catch (e: any) {
      logger.warn('Boundaries fetch failed', e);
      setBoundariesState(s => ({ ...s, loading: false, error: e?.message ?? 'fetch failed' }));
    }
  }, []);

  const loadIncidents = useCallback(async () => {
    setIncidentsState(s => ({ ...s, loading: true }));
    try {
      setIncidents(await fetchIncidents());
      setIncidentsState(s => ({ ...s, loading: false, error: null }));
    } catch (e: any) {
      logger.warn('Incidents fetch failed', e);
      setIncidentsState(s => ({ ...s, loading: false, error: e?.message ?? 'fetch failed' }));
    }
  }, []);

  // Fetch on enable.
  useEffect(() => { if (hotspotsState.enabled && !hotspots) loadHotspots(); }, [hotspotsState.enabled, hotspots, loadHotspots]);
  useEffect(() => { if (boundariesState.enabled && !boundaries) loadBoundaries(); }, [boundariesState.enabled, boundaries, loadBoundaries]);
  useEffect(() => { if (incidentsState.enabled && !incidents) loadIncidents(); }, [incidentsState.enabled, incidents, loadIncidents]);

  // Refetch hotspots when the view leaves the fetched (padded) bbox.
  useEffect(() => {
    if (!hotspotsState.enabled || !viewBounds || hotspotsState.loading) return;
    const fetched = hotspotFetchBoundsRef.current;
    if (fetched && contains(fetched, viewBounds)) return;
    loadHotspots();
  }, [viewBounds, hotspotsState.enabled, hotspotsState.loading, loadHotspots]);

  // Periodic refresh while any layer is on.
  useEffect(() => {
    const anyEnabled = hotspotsState.enabled || boundariesState.enabled || incidentsState.enabled;
    if (!anyEnabled) return;
    const timer = window.setInterval(() => {
      if (hotspotsState.enabled) loadHotspots();
      if (boundariesState.enabled) loadBoundaries();
      if (incidentsState.enabled) loadIncidents();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [hotspotsState.enabled, boundariesState.enabled, incidentsState.enabled, loadHotspots, loadBoundaries, loadIncidents]);

  const anyEnabled = hotspotsState.enabled || boundariesState.enabled || incidentsState.enabled;

  const row = (
    label: string,
    state: FeedToggleState,
    setState: React.Dispatch<React.SetStateAction<FeedToggleState>>,
    detail: React.ReactNode
  ) => (
    <div className="livefeed-row">
      <label className="livefeed-toggle">
        <input
          type="checkbox"
          checked={state.enabled}
          onChange={e => setState(s => ({ ...s, enabled: e.target.checked }))}
        />
        <span>{label}</span>
        {state.loading && <span className="livefeed-spinner" aria-label="loading">…</span>}
      </label>
      {state.enabled && state.error && (
        <div className="livefeed-error" role="alert">⚠ Unavailable: {state.error}</div>
      )}
      {state.enabled && !state.error && <div className="livefeed-detail">{detail}</div>}
    </div>
  );

  return (
    <div className={`live-feeds-control${open ? ' open' : ''}`}>
      <button
        className="live-feeds-toggle-btn"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        title="Live context layers: hotspots, fire areas, incidents"
      >
        🔥 Live layers{anyEnabled ? ' •' : ''}
      </button>
      {open && (
        <div className="live-feeds-panel">
          <div className="live-feeds-caveat">
            Advisory layers — not for safety-of-life decisions. Check your state emergency service for warnings.
          </div>

          {row('Satellite hotspots (72 h)', hotspotsState, setHotspotsState, hotspots && (
            <>
              <span>
                {hotspots.truncated
                  ? `latest ${hotspots.geojson.features.length.toLocaleString()} of ${hotspots.totalMatched.toLocaleString()} in view`
                  : `${hotspots.geojson.features.length.toLocaleString()} in view`}
                {asOf(hotspots.fetchedAt) && ` · as of ${asOf(hotspots.fetchedAt)}`}
              </span>
              <span className="livefeed-attr">DEA Hotspots · Geoscience Australia (CC BY 4.0)</span>
            </>
          ))}

          {row('Fire & burn areas (NRT)', boundariesState, setBoundariesState, boundaries && (
            <>
              <span>
                {boundaries.geojson.features.length.toLocaleString()} areas national
                {boundaries.truncated && ' (truncated)'}
                {asOf(boundaries.fetchedAt) && ` · as of ${asOf(boundaries.fetchedAt)}`}
              </span>
              <span className="livefeed-attr">Digital Atlas of Australia · Geoscience Australia (CC BY 4.0) · excludes NT</span>
            </>
          ))}

          {row('Incidents & warnings', incidentsState, setIncidentsState, incidents && (
            <>
              <span>
                {incidents.incidents.length.toLocaleString()} incidents
                {asOf(incidents.fetchedAt) && ` · as of ${asOf(incidents.fetchedAt)}`}
              </span>
              <span className="livefeed-sources">
                {incidents.sources.map(s => (
                  <span key={s.id} className={s.ok ? 'src-ok' : 'src-fail'} title={s.ok ? `${s.count} incidents` : s.error}>
                    {s.ok ? '✓' : '✗'} {s.label}
                  </span>
                ))}
              </span>
              <span className="livefeed-attr">
                No feed yet: {INCIDENTS_NOT_COVERED.join(', ')} — absence of markers there is not absence of incidents.
              </span>
            </>
          ))}
        </div>
      )}
    </div>
  );
};

export default LiveFeedsControl;
