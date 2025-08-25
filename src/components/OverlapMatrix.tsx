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
  const vegRows = VEGETATION_CATEGORIES.map(v => v.key);
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
          const pct = (meters / total) * 100;
          return { col, meters, pct };
        });
        const maxCell = rowCells.reduce((m,c)=> c.pct>m.pct?c:m, rowCells[0]);
        return (
          <div key={rowKey} className={`overlap-row ${heavyVegKey===rowKey? 'dominant-row':''}`} role="row">
            <div className="overlap-row-header" role="rowheader" title={vegDef.label}>{vegDef.label}</div>
            {rowCells.map(cell => {
              const pctRounded = Math.round(cell.pct);
              return (
                <div
                  key={cell.col}
                  role="cell"
                  className={`overlap-cell ${maxCell.col===cell.col && pctRounded>0 ? 'max-in-row':''}`}
                  aria-label={`${vegDef.label} in ${cell.col} slope: ${pctRounded}%`}
                  title={`${vegDef.label} + ${cell.col}: ${pctRounded}% (${Math.round(cell.meters)} m)`}
                >
                  <div className={`cell-bar dist-pct-${pctRounded}`} data-color={vegDef.color} />
                  {pctRounded >= 6 && <span className="cell-label" aria-hidden="true">{pctRounded}%</span>}
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
