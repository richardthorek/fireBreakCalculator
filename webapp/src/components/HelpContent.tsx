/**
 * Help Content component for initial user guidance.
 * Displays instructions for drawing fire break lines and map navigation
 * when no fire break line has been drawn yet.
 */

import React from 'react';

export const HelpContent: React.FC = () => {
  return (
    <div className="help-content">
      <div className="help-header">
        <h4>🔥 Welcome to Fire Break Calculator</h4>
        <p className="help-subtitle">Plan fire breaks and trails with precision</p>
      </div>

      <div className="help-sections">
        <section className="help-section">
          <h5>✏️ Drawing Your Fire Break Route</h5>
          <div className="help-steps">
            <ol>
              <li>
                <strong>Select the drawing tool</strong> - Click the pencil icon (✏️) in the top-right corner of the map
              </li>
              <li>
                <strong>Start drawing</strong> - Click on the map to place your first point
              </li>
              <li>
                <strong>Add more points</strong> - Continue clicking to trace your proposed fire break route
              </li>
              <li>
                <strong>Finish the line</strong> - Double-click or press Enter to complete your route
              </li>
            </ol>
          </div>
          
          <div className="help-tip mobile-tip">
            <strong>📱 Mobile/Touch Devices:</strong>
            <ul>
              <li><strong>Press and hold (~1 second)</strong> to add intermediate points</li>
              <li><strong>Quick tap</strong> to finish the line</li>
              <li>Use the edit tool (✎) afterward to adjust points if needed</li>
            </ul>
          </div>
        </section>

        <section className="help-section">
          <h5>🗺️ Map Navigation Controls</h5>
          <div className="help-controls">
            <div className="control-group">
              <h6>🖱️ Mouse Controls</h6>
              <ul>
                <li><strong>Zoom:</strong> Mouse wheel or +/- buttons</li>
                <li><strong>Pan:</strong> Click and drag to move around</li>
                <li><strong>Tilt:</strong> Right-click and drag vertically</li>
                <li><strong>Rotate:</strong> Ctrl + click and drag</li>
              </ul>
            </div>

            <div className="control-group">
              <h6>⌨️ Keyboard Shortcuts</h6>
              <ul>
                <li><strong>Arrow keys:</strong> Pan in any direction</li>
                <li><strong>+ / -:</strong> Zoom in/out</li>
                <li><strong>Shift + Arrow:</strong> Rotate the map</li>
                <li><strong>Ctrl + Arrow:</strong> Tilt the map</li>
              </ul>
            </div>

            <div className="control-group">
              <h6>📱 Touch Gestures</h6>
              <ul>
                <li><strong>Pinch:</strong> Zoom in/out</li>
                <li><strong>Swipe:</strong> Pan around the map</li>
                <li><strong>Two-finger rotate:</strong> Rotate the map</li>
                <li><strong>Two-finger vertical:</strong> Tilt the map</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="help-section">
          <h5>📍 Locate Me</h5>
          <div className="help-steps">
            <p>
              The <strong>Locate Me</strong> control (pin/target icon) centers the map on your current device location and drops a temporary location marker. This is separate from the drawing tools which use the pencil icon.
            </p>
            <ul>
              <li><strong>Tap/click the pin icon</strong> to center the map on your device.</li>
              <li>Your browser will ask for location permission the first time; allow it to use the feature.</li>
              <li>If location is denied or unavailable, use the search box to manually center the map.</li>
            </ul>
            <p className="help-note">Note: The drawing tool now uses the pencil icon (✏️) so the pin (📍) uniquely identifies the Locate Me control.</p>
          </div>
        </section>

        <section className="help-section">
          <h5>⚡ Quick Start Tips</h5>
          <div className="help-tips">
            <div className="tip-item">
              <span className="tip-icon">🎯</span>
              <span>Start by drawing a simple line to see how the analysis works</span>
            </div>
            <div className="tip-item">
              <span className="tip-icon">📏</span>
              <span>The system automatically calculates distance and analyzes terrain slopes</span>
            </div>
            <div className="tip-item">
              <span className="tip-icon">🛠️</span>
              <span>Use the edit tool (✎) to modify your route after drawing</span>
            </div>
            <div className="tip-item">
              <span className="tip-icon">🗑️</span>
              <span>Use the delete tool to start over with a new route</span>
            </div>
          </div>
        </section>

        <section className="help-section">
          <h5>🔍 What Happens Next?</h5>
          <p className="help-description">
            Once you draw a fire break line, this panel will show:
          </p>
          <ul className="help-features">
            <li>Estimated completion times for different equipment types</li>
            <li>Slope analysis with color-coded terrain difficulty</li>
            <li>Vegetation analysis and environmental conditions</li>
            <li>Equipment compatibility based on terrain constraints</li>
            <li>Cost estimates and resource requirements</li>
          </ul>
        </section>
      </div>

      <div className="help-footer">
        <p className="help-footer-text">
          <strong>Ready to start?</strong> Click the drawing tool (✏️) and start planning your fire break!
        </p>
      </div>
    </div>
  );
};

export default HelpContent;