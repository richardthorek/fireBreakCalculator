/**
 * Map key for Terrain Mobility mode (owner, 2026-07-27: "I need a key that
 * helps me understand what the coloured cells mean, what the red dots are, the
 * red lines are etc etc").
 *
 * Two rules it follows, both deliberate:
 *
 *  1. **It only lists what is actually on the map right now.** A key showing
 *     symbols that are not present is worse than none — the reader starts
 *     hunting the map for a red line that was never drawn. Every section is
 *     gated on the layer being live.
 *  2. **It states which entries are MODELLED behaviour.** The transit field
 *     and the corridors-from-simulation carry the assumed behaviour parameters
 *     documented in movementSimulation.ts, while the GO/SLOW-GO/NO-GO cells
 *     are a (Tier 0) property of the ground. Those are different kinds of
 *     claim and the key is the one place a reader is definitely looking when
 *     they need to be told the difference.
 *
 * It also carries the overlay opacity slider, because "what am I looking at"
 * and "let me see the ground under it" are the same moment of use.
 */

import React, { useState } from 'react';
import { SEVERELY_RESTRICTED_MEANING } from '@firebreak/terrain';

export interface MobilityLegendProps {
  /** Which layers are currently drawn — the key shows only these. */
  present: {
    originPaint: boolean;
    objectivePaint: boolean;
    observePaint: boolean;
    cells: boolean;
    displayMode: 'trafficability' | 'isochrone';
    corridors: boolean;
    corridorsFromSimulation: boolean;
    corridorRoutes: boolean;
    transitField: boolean;
    chokepoints: boolean;
    barrier: boolean;
    roadBarrier: boolean;
    restrictions: boolean;
    water: boolean;
    unitPath: boolean;
    movers: boolean;
    roadRoute: boolean;
  };
  overlayOpacity: number;
  onOverlayOpacityChange: (value: number) => void;
}

const Swatch: React.FC<{ color: string; kind?: 'fill' | 'line' | 'dot' | 'dash'; children: React.ReactNode }> = ({
  color, kind = 'fill', children,
}) => (
  <li className="legend-row">
    <span className={`legend-swatch legend-swatch--${kind}`} style={{ ['--legend-color' as string]: color }} aria-hidden />
    <span className="legend-label">{children}</span>
  </li>
);

export const MobilityLegend: React.FC<MobilityLegendProps> = ({ present, overlayOpacity, onOverlayOpacityChange }) => {
  const [open, setOpen] = useState(true);

  const anything = Object.values(present).some(v => v === true);
  if (!anything) return null;

  return (
    <div className={`mobility-legend${open ? '' : ' collapsed'}`}>
      <button
        type="button"
        className="mobility-legend-toggle"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span>MAP KEY</span>
        <span className="mobility-legend-chevron" aria-hidden>{open ? '▾' : '▴'}</span>
      </button>

      {open && (
        <div className="mobility-legend-body">
          <div className="mobility-legend-opacity">
            <label htmlFor="mobility-overlay-opacity">
              Overlay opacity <strong>{Math.round(overlayOpacity * 100)}%</strong>
            </label>
            <input
              id="mobility-overlay-opacity"
              type="range"
              min={10}
              max={100}
              step={5}
              value={Math.round(overlayOpacity * 100)}
              onChange={e => onOverlayOpacityChange(Number(e.target.value) / 100)}
            />
            <span className="mobility-legend-note">
              Fades every analysis layer together so you can read the ground underneath.
              Your painted areas are not faded — they are your input, not a result.
            </span>
          </div>

          {(present.originPaint || present.objectivePaint || present.observePaint) && (
            <section>
              <h4>Your areas</h4>
              <ul>
                {present.originPaint && <Swatch color="#38bdf8">Origin — where movement starts from</Swatch>}
                {present.objectivePaint && <Swatch color="#F6A609">Objective — where it is heading</Swatch>}
                {present.observePaint && <Swatch color="#EC4899">Observer — line-of-sight traced from here (OCOKA 6)</Swatch>}
              </ul>
            </section>
          )}

          {present.cells && (
            <section>
              <h4>{present.displayMode === 'isochrone' ? 'Cells — time to reach' : 'Cells — trafficability'}</h4>
              {present.displayMode === 'isochrone' ? (
                <ul>
                  <Swatch color="#38bdf8">Reached soonest</Swatch>
                  <Swatch color="#0b2a3f">Reached latest</Swatch>
                  <Swatch color="#1c2733">Never reached by this mover profile</Swatch>
                </ul>
              ) : (
                <ul>
                  <Swatch color="#1E9E62">Unrestricted — passable at normal pace</Swatch>
                  <Swatch color="#F6A609">Restricted — passable, near a limit or through heavy vegetation</Swatch>
                  <Swatch color="#D8232A">Severely restricted — slope, side-slope or vegetation blocks this profile</Swatch>
                </ul>
              )}
              <p className="mobility-legend-note">
                A property of the ground for the selected profile. Tier 0 data: vegetation
                structure is estimated from its class, not measured per cell.
                {present.displayMode !== 'isochrone' && <> {SEVERELY_RESTRICTED_MEANING}</>}
              </p>
            </section>
          )}

          {present.water && (
            <section>
              <h4>Waterways &amp; water bodies</h4>
              <ul>
                <Swatch color="#4fc3f7" kind="line">Mapped river, canal or stream</Swatch>
                <Swatch color="#1e88e5">Standing water body (lake, dam, reservoir)</Swatch>
              </ul>
              <p className="mobility-legend-note">
                The actual mapped watercourse — real OSM/DEA data, not a derived line. Cells
                near it are gated by the mover's fording capability: too deep for the
                profile reads NO-GO, within capability reads SLOW-GO. A mapped trail/road
                crossing is assumed to be a bridge or ford already and is not gated.
              </p>
            </section>
          )}

          {present.transitField && (
            <section>
              <h4>Simulated transit</h4>
              <ul>
                <Swatch color="#f2603c">Most simulated movers crossed here</Swatch>
                <Swatch color="#2f7fb5">Some crossed here</Swatch>
                <Swatch color="#1b3a5c">A few wandered through</Swatch>
              </ul>
              <p className="mobility-legend-note modelled">
                MODELLED BEHAVIOUR. This is the share of simulated movers that crossed each
                cell, not a probability about a real unit. The terrain is real data; how a
                mover chooses is an assumed model.
              </p>
            </section>
          )}

          {present.corridors && (
            <section>
              <h4>Movement corridors</h4>
              <ul>
                <Swatch color="#3B82F6" kind="line">Corridor 1 — carries the most movement</Swatch>
                <Swatch color="#8B5CF6" kind="line">Corridor 2</Swatch>
                <Swatch color="#06B6D4" kind="line">Corridor 3</Swatch>
                <Swatch color="#94a3b8" kind="line">Corridor 4+</Swatch>
                {present.corridorRoutes && (
                  <Swatch color="#e2e8f0" kind="line">
                    Thin line — that corridor's fastest analysed route, snapped to any
                    road it follows and smoothed elsewhere
                  </Swatch>
                )}
              </ul>
              <p className="mobility-legend-note">
                The outline is the corridor's real extent; the fill brightens toward its
                spine, where movement concentrates. Soft edges are deliberate — a corridor
                is a band, not a surveyed lane. Tap a band or its label to isolate it.
                {present.corridorsFromSimulation
                  ? ' Built from simulated movers — modelled behaviour.'
                  : ' Built from the cheapest computed routes.'}
              </p>
            </section>
          )}

          {(present.chokepoints || present.barrier || present.roadBarrier || present.restrictions) && (
            <section>
              <h4>Denial</h4>
              <ul>
                {present.chokepoints && (
                  <Swatch color="#D8232A" kind="dot">
                    Red dots — chokepoints. Bigger = more of the analysed routes funnel through it.
                  </Swatch>
                )}
                {present.barrier && (
                  <Swatch color="#D8232A" kind="line">
                    Solid red line — the cheapest continuous cut that severs origin from objective.
                  </Swatch>
                )}
                {present.roadBarrier && (
                  <Swatch color="#7C3AED" kind="dash">
                    Dashed purple line — road-network-exact min-cut: the cheapest set of real road
                    segments that severs the route (a more precise vehicle-specific answer alongside
                    the solid-red hex cut above).
                  </Swatch>
                )}
                {present.restrictions && (
                  <>
                    <Swatch color="#ff4d4d" kind="dash">
                      Numbered red bar — recommended road block, in priority order.
                    </Swatch>
                    <Swatch color="#F6A609" kind="dash">
                      Numbered amber bar — recommended ground denial (not on a road).
                    </Swatch>
                  </>
                )}
              </ul>
            </section>
          )}

          {present.roadRoute && (
            <section>
              <h4>Road-network route (docs §35)</h4>
              <ul>
                <Swatch color="#f59e0b" kind="dash">
                  Amber dashed line — fastest ROAD-ONLY route between the painted areas
                  (vehicle profiles), independent of the hex-grid search above. Road
                  access point to road access point — excludes the off-road legs.
                </Swatch>
              </ul>
            </section>
          )}

          {(present.unitPath || present.movers) && (
            <section>
              <h4>Simulation playback</h4>
              <ul>
                {present.unitPath && <Swatch color="#38bdf8" kind="dash">Dashed line — the single optimal route being followed</Swatch>}
                {present.movers && (
                  <>
                    <Swatch color="#38bdf8" kind="dot">Moving dot — a simulated mover, still travelling</Swatch>
                    <Swatch color="#1E9E62" kind="dot">Green dot — that mover reached the objective</Swatch>
                    <Swatch color="#7dd3fc" kind="line">Pale trail — the ground it has covered so far</Swatch>
                  </>
                )}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
};

export default MobilityLegend;
