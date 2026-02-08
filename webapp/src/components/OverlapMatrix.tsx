import React, { useMemo } from 'react';
import { SLOPE_CATEGORIES, VEGETATION_CATEGORIES } from '../config/categories';
import { TrackAnalysis, VegetationAnalysis } from '../types/config';
import { computeSlopeVegetationOverlap } from '../utils/analysisOverlap';

interface OverlapMatrixProps {
  trackAnalysis: TrackAnalysis;
  vegetationAnalysis: VegetationAnalysis;
}

/**
 * OverlapMatrix renders a slope (columns) × vegetation (rows) matrix.
 * Each cell's bar length is % of total route distance for that combination.
 * Dominant vegetation row has a left accent; max cell per row outlined.
 */
export const OverlapMatrix: React.FC<OverlapMatrixProps> = ({ trackAnalysis, vegetationAnalysis }) => {
  const overlap = useMemo(
    () => computeSlopeVegetationOverlap(trackAnalysis.segments, vegetationAnalysis.segments),
    [trackAnalysis, vegetationAnalysis]
  );
  const total = trackAnalysis.totalDistance || 1;
  // Precompute column totals (meters per slope column) for secondary percent calculations
  const colTotals: Record<string, number> = {};
  Object.entries(overlap).forEach(([slopeCat, vegMap]) => {
    colTotals[slopeCat] = Object.values(vegMap).reduce((a, b) => a + b, 0);
  });
  // Order vegetation rows by descending total coverage to show largest concentration at top
  const vegTotals: Record<string, number> = {};
  Object.entries(overlap).forEach(([slopeCat, vegMap]) => {
    Object.entries(vegMap).forEach(([veg, meters]) => {
      vegTotals[veg] = (vegTotals[veg] || 0) + meters;
    });
  });
  const vegRows = VEGETATION_CATEGORIES.map(v => v.key).sort((a, b) => (vegTotals[b] || 0) - (vegTotals[a] || 0));
  const slopeCols = SLOPE_CATEGORIES.map(s => s.key);
  const heavyVegKey = Object.entries(vegetationAnalysis.vegetationDistribution).sort((a,b)=>b[1]-a[1])[0]?.[0];

  return (
    <div className="overlap-matrix" aria-label="Slope and vegetation overlap matrix" role="table">
      <div className="overlap-header-row" role="row">
        <div className="overlap-corner" role="columnheader">Veg \\ Slope</div>
        {slopeCols.map(col => {
          const def = SLOPE_CATEGORIES.find(c=>c.key===col)!;
          return <div key={col} className="overlap-col-header" role="columnheader" title={def.label}>{def.label}</div>;
        })}
        <div className="overlap-row-total" role="columnheader" title="Row total %">Total</div>
      </div>
      {vegRows.map(rowKey => {
        const vegDef = VEGETATION_CATEGORIES.find(c=>c.key===rowKey)!;
        const rowMeters: Record<string, number> = {};
        Object.entries(overlap).forEach(([slopeCat, vegMap]) => {
          Object.entries(vegMap).forEach(([veg, meters]) => {
            if (veg === rowKey) rowMeters[slopeCat] = (rowMeters[slopeCat] || 0) + meters;
          });
        });
        const rowTotalMeters = Object.values(rowMeters).reduce((a,b)=>a+b,0);
        const rowTotalPct = Math.round((rowTotalMeters / total) * 100);
        const rowCells = slopeCols.map(col => {
          const meters = rowMeters[col] || 0;
          const pctOfRoute = (meters / total) * 100; // used for bar sizing
          const pctOfRow = rowTotalMeters > 0 ? (meters / rowTotalMeters) * 100 : 0; // percent of this vegetation row
          const colTotal = colTotals[col] || 1;
          const pctOfCol = colTotal > 0 ? (meters / colTotal) * 100 : 0; // percent of the slope column
          return { col, meters, pctOfRoute, pctOfRow, pctOfCol };
        });
        const maxCell = rowCells.reduce((m,c)=> c.pctOfRoute>m.pctOfRoute?c:m, rowCells[0]);
        return (
          <div key={rowKey} className={`overlap-row ${heavyVegKey===rowKey? 'dominant-row':''}`} role="row">
            <div className="overlap-row-header" role="rowheader" title={vegDef.label}>{vegDef.label}</div>
            {rowCells.map(cell => {
              const pctRouteRounded = Math.round(cell.pctOfRoute);
              const pctRowRounded = Math.round(cell.pctOfRow);
              const pctColRounded = Math.round(cell.pctOfCol);
              return (
                <div
                  key={cell.col}
                  role="cell"
                  className={`overlap-cell ${maxCell.col===cell.col && pctRouteRounded>0 ? 'max-in-row':''}`}
                  aria-label={`${vegDef.label} on ${cell.col} slope: ${pctRouteRounded}% of route; ${pctRowRounded}% of ${vegDef.label}; ${pctColRounded}% of ${cell.col} slope`}
                  title={`${vegDef.label} on ${cell.col} slope: ${pctRouteRounded}% of route (${Math.round(cell.meters)} m); ${pctRowRounded}% of this vegetation; ${pctColRounded}% of this slope category`}
                >
                      <div className="cell-bar" style={{ width: `${pctRouteRounded}%` }} data-color={vegDef.color} />
                      {/* Always show a small percent label to make the matrix explicit; hide visually when zero */}
                      <span className={`cell-label ${pctRouteRounded === 0 ? 'cell-label-empty' : ''}`} aria-hidden="true">{pctRouteRounded}%</span>
                </div>
              );
            })}
            <div className="overlap-row-total" role="cell" title={`Total ${vegDef.label}: ${rowTotalPct}%`}>{rowTotalPct}%</div>
          </div>
        );
      })}
    </div>
  );
};
