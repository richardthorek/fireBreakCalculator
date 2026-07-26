/**
 * Sidebar notification shown on the map before the user has started their
 * plan. Guides users to the right tool with a clear visual call-to-action.
 * Disappears automatically once they've started (fire-break: a line drawn;
 * Terrain mode: at least one area painted). Positioned as a subtle sidebar
 * popup, not a full-screen overlay.
 *
 * 2026-07-26 UI review: this was unconditional — it kept telling Terrain
 * mode users to "use the drawing tool above" (fire-break's own instruction,
 * meaningless there) because it never checked which mode was active at all.
 */

import React from 'react';

interface MapEmptyStateProps {
  /** Whether the map has finished its initial location setup */
  initialLocationSettled: boolean;
  /** Current fire break distance in meters (null when no line drawn) —
   *  fire-break mode's own "started" signal. */
  distance: number | null;
  /** Whether Terrain mode is active — swaps the copy and the "started"
   *  signal entirely rather than reusing fire-break's. */
  tacticalMode?: boolean;
  /** Terrain mode's own "started" signal: true once at least one area has
   *  been painted (origin or objective). */
  mobilityStarted?: boolean;
}

export const MapEmptyState: React.FC<MapEmptyStateProps> = ({
  initialLocationSettled,
  distance,
  tacticalMode = false,
  mobilityStarted = false,
}) => {
  if (!initialLocationSettled) return null;

  if (tacticalMode) {
    if (mobilityStarted) return null;
    return (
      <div className="map-empty-state" aria-live="polite" role="status">
        <div className="map-empty-state-content">
          <div className="map-empty-state-header">
            <span className="map-empty-state-icon" aria-hidden="true">🎯</span>
            <span className="map-empty-state-title">Get Started</span>
          </div>
          <p className="map-empty-state-message">
            Use the <strong>Paint origin</strong> / <strong>Paint objective</strong> buttons (top right) to define your areas of interest.
          </p>
        </div>
      </div>
    );
  }

  if (distance !== null) return null;

  return (
    <div className="map-empty-state" aria-live="polite" role="status">
      <div className="map-empty-state-content">
        <div className="map-empty-state-header">
          <span className="map-empty-state-icon" aria-hidden="true">✏️</span>
          <span className="map-empty-state-title">Get Started</span>
        </div>
        <p className="map-empty-state-message">
          Use the <strong>drawing tool</strong> (top right) to start planning your fire break line.
        </p>
      </div>
    </div>
  );
};

export default MapEmptyState;
