/**
 * Sidebar notification shown on the map when no fire break line has been drawn.
 * Guides users to use the drawing tools with a clear visual call-to-action.
 * Disappears automatically once a line is drawn (distance becomes non-null).
 * Positioned as a subtle sidebar popup, not a full-screen overlay.
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
  // Don't show notification if map is still loading or if a line has been drawn
  if (!initialLocationSettled || distance !== null) {
    return null;
  }

  return (
    <div className="map-empty-state" aria-live="polite" role="status">
      <div className="map-empty-state-content">
        <div className="map-empty-state-header">
          <span className="map-empty-state-icon" aria-hidden="true">✏️</span>
          <h4 className="map-empty-state-title">Get Started</h4>
        </div>
        <p className="map-empty-state-message">
          Use the <strong>drawing tool</strong> above to start planning your fire break line.
        </p>
      </div>
    </div>
  );
};

export default MapEmptyState;
