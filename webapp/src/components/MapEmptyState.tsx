/**
 * Overlay prompt shown on the map when no fire break line has been drawn.
 * Guides users to use the drawing tools with a clear visual call-to-action.
 * Disappears automatically once a line is drawn (distance becomes non-null).
 */

import React from 'react';

interface MapEmptyStateProps {
  /** Whether the map has finished its initial location setup */
  initialLocationSettled: boolean;
  /** Current fire break distance in meters (null when no line drawn) */
  distance: number | null;
}

export const MapEmptyState: React.FC<MapEmptyStateProps> = ({ 
  initialLocationSettled, 
  distance 
}) => {
  // Don't show overlay if map is still loading or if a line has been drawn
  if (!initialLocationSettled || distance !== null) {
    return null;
  }

  return (
    <div className="map-empty-state" aria-live="polite" role="status">
      <div className="map-empty-state-card">
        <div className="map-empty-state-icon" aria-hidden="true">
          ✏️
        </div>
        <h3 className="map-empty-state-title">
          Start Planning Your Fire Break
        </h3>
        <p className="map-empty-state-message">
          Click the <strong>drawing tool</strong> (pencil icon) in the top-right corner, then click on the map to start tracing your route.
        </p>
        <div className="map-empty-state-arrow" aria-hidden="true">
          ↗
        </div>
      </div>
    </div>
  );
};

export default MapEmptyState;
