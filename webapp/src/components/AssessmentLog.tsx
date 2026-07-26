/**
 * Scrolling append-only log panel for Mobility Mode's tactical skin.
 *
 * The caller owns line order (append-only); this component only renders
 * `lines` top-to-bottom and auto-scrolls to the bottom whenever the array
 * changes, optionally showing a trailing blinking cursor while `running`.
 */

import React, { useEffect, useRef } from 'react';

export interface AssessmentLogProps {
  lines: string[];
  running?: boolean;
  title?: string;
}

export const AssessmentLog: React.FC<AssessmentLogProps> = ({
  lines,
  running = false,
  title = 'ASSESSMENT LOG'
}) => {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines]);

  return (
    <div className="tac-panel">
      <span className="tac-label">{title}</span>
      <div className="tac-log tac-mono" ref={logRef}>
        {lines.length === 0 ? (
          <div className="tac-log-line tac-log-line--placeholder">STANDING BY</div>
        ) : (
          lines.map((line, index) => (
            <div className="tac-log-line" key={index}>{line}</div>
          ))
        )}
        {running && <div className="tac-log-cursor" aria-hidden="true" />}
      </div>
    </div>
  );
};

export default AssessmentLog;
