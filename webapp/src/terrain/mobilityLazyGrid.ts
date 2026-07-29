/**
 * Lazy hex-grid materialisation — docs/ROUTE_INTELLIGENCE.md §35, "the
 * design" points 1 ("delete the box") and 5 ("eager coarse tiles, lazy fine
 * cells"). Replaces `mobilityAppreciation.ts`'s previous fix for the same
 * defect (Lake George: a search walled into a pre-sized box reports "no
 * route" without distinguishing "there is no way" from "I wasn't allowed to
 * look far enough") — escalating `boundsPadFactor` RETRIES that rebuilt the
 * entire grid from scratch (re-sampling every cell, re-running Dijkstra from
 * zero) at a bigger guessed box each time. This module instead grows the
 * grid ORGANICALLY: start with a modest tile footprint around the painted
 * areas, run the search, and whenever the reachable frontier runs off the
 * edge of what's currently materialised, fetch exactly the next ring of
 * tiles and RESUME the same search (`accumulatedCost.ts`'s `resumeFrom`)
 * rather than restarting it. A normal run (the common case — the initial
 * footprint already contains a route) pays for exactly one round, identical
 * cost to the old fixed-box approach; only a genuinely Lake-George-shaped run
 * pays for the extra tiles, and only the NEW ground, never a full resample.
 *
 * Hex size and the local projection are fixed ONCE, from the initial
 * footprint — never recomputed as the grid grows (docs §35 point 4: "two
 * passes, uniform hex size within each" — this is one pass, so simply
 * "uniform hex size, always"). That is what keeps `demDerivatives.ts`'s
 * neighbour plane fit, `corridorField.ts`, chokepoints and min-cut completely
 * unaffected by this change: every one of them still receives one ordinary,
 * uniform-hex `MobilityGridCell[]` once the loop concludes — this module
 * only changes HOW that array gets assembled, not its shape.
 *
 * CAVEAT (honestly stated, not engineered away — see `applyCrossSlope`'s own
 * doc comment): a cell's `crossSlopeDeg` is recomputed from whatever
 * neighbours are materialised AT THE TIME each round runs, then the search
 * may settle that cell using that round's value. A cell settled while sitting
 * at a TEMPORARY edge (before the next round's tiles arrive) keeps whatever
 * crossSlopeDeg it had at settlement, even though a later round might compute
 * a more complete value for the same cell from its now-full neighbour set.
 * This is the same "edge cells have an incomplete neighbourhood" effect the
 * old fixed-box approach already had for its outer ring — genuinely new here
 * only in that the edge is now transient rather than final — and
 * `crossSlopeDeg` is already documented as a conservative upper-bound proxy,
 * not a precise per-edge figure, so this does not change what callers may
 * assume about it.
 */

import { LatLng } from '../utils/chainage';
import { calculateDistance } from '../utils/slopeCalculation';
import {
  makeProjection, toLocal, toLatLng, hexKey, chooseHexSize, hexCorners, hexNeighbors, axialToLocal,
  generateBoxHexes, LocalProjection, LocalPoint, AxialCoord,
} from '../utils/hexGrid';
import { InfrastructureTrail } from '../utils/infrastructureService';
import { PaintedArea, paintedAreaBounds, resolvePaintedAreaGeometry } from './paintedArea';
import {
  computePaddedBounds, computeCellBudget, sampleCellsForHexes, applyCrossSlope, isPaintedAreaMember, nearestCellKey,
  minDetourPadM, MobilityFidelity, DEFAULT_MOBILITY_FIDELITY, MobilityGridResult,
} from './mobilityGrid';
import {
  MobilityGridCell, MobilityCellResult, AccumulatedCostSearchResult, assembleMobilityResults,
} from './accumulatedCost';
import { getMoverProfile } from './moverProfiles';
import { runMobilitySearchInWorker } from './mobilityWorkerClient';
import { SimPathNode } from './mobilityWorker';
import { RoadSpeedOverrides } from './roadSpeedModel';

/** Hexes per tile side — a tile is a batch of roughly `TILE_HEX_SPAN²` hexes,
 *  fetched with ONE round of area-batched network calls (docs §35 point 5:
 *  "fetch sample data in coarse area tiles"). Small enough that a growth
 *  round doesn't over-fetch ground the search will never touch; large enough
 *  that a typical multi-round run stays at a handful of rounds, not dozens. */
const TILE_HEX_SPAN = 10;

/** Same initial generosity the old fixed-box approach's first attempt used
 *  (`mobilityAppreciation.ts`'s prior `INITIAL_PAD_FACTOR`) — sizes the
 *  STARTING tile footprint only. Growth beyond it is frontier-driven, not
 *  another guessed multiplier. */
const INITIAL_PAD_FACTOR = 0.3;

/** How many more cells the lazy grid may materialise beyond one fidelity
 *  tier's normal `maxHexCells`, before treating further growth as a
 *  ceiling-hit rather than genuine progress. An organically-grown region
 *  legitimately covers more ground than a single symmetric box at the same
 *  cell budget would (that is the entire point), so this is deliberately
 *  more generous than `maxHexCells` alone, while still bounding worst-case
 *  (unreachable objective) runtime to a fixed multiple of it. */
const LAZY_CELL_CEILING_MULTIPLIER = 4;

/** Safety net independent of cell count — defends against a pathological
 *  shape where each round only turns up a handful of new cells (a narrow,
 *  winding reachable channel) that would otherwise take many rounds to hit
 *  the cell ceiling. */
const MAX_LAZY_ROUNDS = 14;

/** Exported purely for direct, network-free unit testing (docs precedent:
 *  `mobilityGrid.ts` exports `computePaddedBounds`/`frontierTouchedEdges`
 *  the same way) — the async materialisation loop below that actually calls
 *  these is, like `buildMobilityGrid` itself, not unit-testable without
 *  mocking every upstream fetch. */
export function tileKeyOf(tx: number, ty: number): string {
  return `${tx}:${ty}`;
}

export function tileIndexOfLocal(p: LocalPoint, tileSizeM: number): { tx: number; ty: number } {
  return { tx: Math.floor(p.x / tileSizeM), ty: Math.floor(p.y / tileSizeM) };
}

/** Every tile index whose box overlaps `[min, max]` (local coords) — the
 *  INITIAL footprint's tile set. */
export function tilesCoveringBox(min: LocalPoint, max: LocalPoint, tileSizeM: number): Set<string> {
  const txMin = Math.floor(min.x / tileSizeM);
  const txMax = Math.floor(max.x / tileSizeM);
  const tyMin = Math.floor(min.y / tileSizeM);
  const tyMax = Math.floor(max.y / tileSizeM);
  const out = new Set<string>();
  for (let tx = txMin; tx <= txMax; tx++) {
    for (let ty = tyMin; ty <= tyMax; ty++) out.add(tileKeyOf(tx, ty));
  }
  return out;
}

/** All hexes belonging to tile `(tx, ty)` — generated over the tile's own
 *  box (`generateBoxHexes`, which is INCLUSIVE at both ends and so can
 *  return a hex that actually belongs to a neighbouring tile at a shared
 *  boundary) then filtered down to hexes whose centre's OWN tile index
 *  really is `(tx, ty)` — a clean partition regardless of that inclusivity,
 *  so no hex is ever double-materialised across two tiles. */
export function hexesForTile(
  tx: number, ty: number, hexSize: number, tileSizeM: number
): { hex: AxialCoord; center: LocalPoint }[] {
  const minPt: LocalPoint = { x: tx * tileSizeM, y: ty * tileSizeM };
  const maxPt: LocalPoint = { x: (tx + 1) * tileSizeM, y: (ty + 1) * tileSizeM };
  const raw = generateBoxHexes(minPt, maxPt, hexSize);
  return raw.filter(h => {
    const idx = tileIndexOfLocal(h.center, tileSizeM);
    return idx.tx === tx && idx.ty === ty;
  });
}

export interface LazyMobilitySearchOptions {
  signal?: AbortSignal;
  profileId: string;
  nightMode: boolean;
  fidelity?: MobilityFidelity;
  roadSpeedOverrides?: RoadSpeedOverrides;
  /** Overall progress across sampling+search for ALL rounds combined, 0..1.
   *  Heuristic, not exact (the total round count isn't known upfront): each
   *  round closes half the remaining distance to 1, so a decisive first
   *  round already reads as substantial progress and a run that needs
   *  several rounds still visibly advances on every one, without ever
   *  claiming completion before the search actually is. */
  onProgress?: (fraction: number) => void;
  onLog?: (line: string) => void;
  /** Fires once per round, before that round's sampling starts — lets the
   *  caller label "sampling" vs "widening the search" the same way the old
   *  retry loop's `onStage` did. `round` is 1-indexed. */
  onRoundStart?: (round: number, materializedCellCount: number) => void;
  /** Same shape as `mobilityAppreciation.ts`'s `onPreviewCells` — fires after
   *  EVERY round's sampling (not just the first), so a multi-round run
   *  visibly redraws the growing surveyed ground on the map as tiles arrive,
   *  matching the design's own "paint the explored frontier" honesty goal. */
  onPreviewCells?: (cells: MobilityCellResult[]) => void;
}

export interface LazyMobilitySearchResult {
  grid: MobilityGridResult;
  results: MobilityCellResult[];
  path: SimPathNode[] | null;
  /** How many tile-materialisation rounds this run actually used (1 = the
   *  initial footprint alone already settled it). */
  roundsUsed: number;
  /** How many tiles were fetched in total across every round. */
  tilesUsed: number;
  /** True when growth stopped because the ceiling (cells/tiles/rounds) was
   *  hit rather than because the frontier ran out of anywhere left to grow
   *  (a genuine enclosure) or a route was found. */
  hitCeiling: boolean;
}

/**
 * Assemble the local-coordinate footprint (fixed hex size + projection) the
 * WHOLE lazy run uses, from the SAME initial-pad math the old fixed-box
 * approach's first attempt used — so a typical short-range run's hex count
 * and resolution are unchanged; only genuinely large/awkward AOIs take a
 * different path from here on.
 */
function initialFootprint(
  origin: PaintedArea, objective: PaintedArea, fidelity: MobilityFidelity, profileRoadSpeedKmh: number
): {
  proj: LocalProjection; hexSize: number; tileSizeM: number; targetCellCount: number; maxHexCells: number;
  min: LocalPoint; max: LocalPoint;
} | null {
  const originBounds = paintedAreaBounds(origin);
  const objectiveBounds = paintedAreaBounds(objective);
  if (!originBounds || !objectiveBounds) return null;

  const detourPadM = minDetourPadM({ roadSpeedKmh: profileRoadSpeedKmh });
  const padded = computePaddedBounds(originBounds, objectiveBounds, INITIAL_PAD_FACTOR, detourPadM);
  if (!padded) return null;
  const { boundsSw, boundsNe } = padded;

  const boxWidthM = calculateDistance(boundsSw.lat, boundsSw.lng, boundsSw.lat, boundsNe.lng);
  const boxHeightM = calculateDistance(boundsSw.lat, boundsSw.lng, boundsNe.lat, boundsSw.lng);
  const spanMForBudget = Math.max(boxWidthM, boxHeightM);
  const { targetCellCount, maxHexCells } = computeCellBudget(spanMForBudget, fidelity);

  const center: LatLng = { lat: (boundsSw.lat + boundsNe.lat) / 2, lng: (boundsSw.lng + boundsNe.lng) / 2 };
  const proj = makeProjection(center);
  const boxMinLocal = toLocal(proj, boundsSw);
  const boxMaxLocal = toLocal(proj, boundsNe);
  const min: LocalPoint = { x: Math.min(boxMinLocal.x, boxMaxLocal.x), y: Math.min(boxMinLocal.y, boxMaxLocal.y) };
  const max: LocalPoint = { x: Math.max(boxMinLocal.x, boxMaxLocal.x), y: Math.max(boxMinLocal.y, boxMaxLocal.y) };
  const width = max.x - min.x;
  const height = max.y - min.y;
  if (width < 10 || height < 10) return null;

  const hexSize = chooseHexSize(Math.max(width, height), Math.min(width, height) / 2, targetCellCount);
  const tileSizeM = hexSize * TILE_HEX_SPAN;
  return { proj, hexSize, tileSizeM, targetCellCount, maxHexCells, min, max };
}

export async function runLazyMobilitySearch(
  origin: PaintedArea,
  objective: PaintedArea,
  options: LazyMobilitySearchOptions
): Promise<LazyMobilitySearchResult | null> {
  const { signal, fidelity = DEFAULT_MOBILITY_FIDELITY, roadSpeedOverrides, onProgress, onLog, onRoundStart, onPreviewCells } = options;
  const profile = getMoverProfile(options.profileId);
  if (!profile) return null;

  const foot = initialFootprint(origin, objective, fidelity, profile.roadSpeedKmh);
  if (!foot) return null;
  const { proj, hexSize, tileSizeM, targetCellCount, maxHexCells, min, max } = foot;
  const cellCeiling = maxHexCells * LAZY_CELL_CEILING_MULTIPLIER;
  const tileCeiling = Math.max(16, Math.ceil(cellCeiling / (TILE_HEX_SPAN * TILE_HEX_SPAN * 0.7)));

  const originBounds = paintedAreaBounds(origin)!;
  const objectiveBounds = paintedAreaBounds(objective)!;
  const originGeom = resolvePaintedAreaGeometry(origin);
  const objectiveGeom = resolvePaintedAreaGeometry(objective);

  const materialized = new Map<string, MobilityGridCell>();
  const materializedTiles = new Set<string>();
  let neededTiles = tilesCoveringBox(min, max, tileSizeM);

  let usedEstimatedData = false;
  let infrastructureAvailable = false;
  let hydrologyAvailable = false;
  const waterFeatures: InfrastructureTrail[] = [];
  const roadWays: InfrastructureTrail[] = [];

  let originKeys: string[] = [];
  let objectiveKeys: string[] = [];
  let reach: AccumulatedCostSearchResult | undefined;
  let results: MobilityCellResult[] = [];
  let path: SimPathNode[] | null = null;
  let hitCeiling = false;
  let round = 0;

  while (true) {
    round++;
    if (signal?.aborted) return null;

    const newTileKeys = [...neededTiles].filter(k => !materializedTiles.has(k));
    if (newTileKeys.length === 0) break; // nothing left anywhere to grow into — genuine enclosure
    for (const k of newTileKeys) materializedTiles.add(k);
    onRoundStart?.(round, materialized.size);

    const newHexesAll = newTileKeys.flatMap(k => {
      const [txStr, tyStr] = k.split(':');
      return hexesForTile(Number(txStr), Number(tyStr), hexSize, tileSizeM);
    });
    const newHexes = newHexesAll.filter(h => !materialized.has(hexKey(h.hex)));
    if (newHexes.length === 0) {
      // Every hex these tiles would contribute is already materialised
      // (defensive — the tile partition should make this unreachable) or the
      // tiles themselves cover no hexes at all (possible right at the very
      // edge of a tile-size rounding). Either way there's nothing new to
      // fetch or search over from this batch.
      if (materializedTiles.size >= tileCeiling || round >= MAX_LAZY_ROUNDS) { hitCeiling = true; break; }
      continue;
    }

    // Bounds for this round's area-batched fetches (vegetation/roads/water)
    // — the new hexes' own extent, padded a couple of hex-widths so corner
    // sampling and nearby-feature snapping right at the tile edge aren't
    // starved of context the way a razor-tight bbox would risk.
    const newPoints = newHexes.map(h => toLatLng(proj, h.center));
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const p of newPoints) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }
    const padDeg = (hexSize * 2) / 111320;
    const roundBounds = { minLat: minLat - padDeg, minLng: minLng - padDeg, maxLat: maxLat + padDeg, maxLng: maxLng + padDeg };

    const sampled = await sampleCellsForHexes(newHexes, proj, hexSize, roundBounds, signal, f => {
      onProgress?.(roundProgress(round, f * 0.6));
    });
    if (!sampled) return null; // aborted mid-fetch
    for (const c of sampled.cells) materialized.set(c.key, c);
    usedEstimatedData = usedEstimatedData || sampled.usedEstimatedData;
    infrastructureAvailable = infrastructureAvailable || sampled.infrastructureAvailable;
    hydrologyAvailable = hydrologyAvailable || sampled.hydrologyAvailable;
    waterFeatures.push(...sampled.waterFeatures);
    roadWays.push(...sampled.roadWays);

    const allCells = Array.from(materialized.values());
    applyCrossSlope(allCells);

    if (round === 1) {
      const cornerPoints = allCells.map(c => hexCorners(axialToLocal(c.hex, hexSize), hexSize).map(p => toLatLng(proj, p)));
      const originMatch = allCells.filter((_, i) => isPaintedAreaMember(cornerPoints[i], originGeom)).map(c => c.key);
      const objectiveMatch = allCells.filter((_, i) => isPaintedAreaMember(cornerPoints[i], objectiveGeom)).map(c => c.key);
      originKeys = originMatch.length > 0 ? originMatch
        : [nearestCellKey(allCells, { lat: (originBounds.minLat + originBounds.maxLat) / 2, lng: (originBounds.minLng + originBounds.maxLng) / 2 })];
      objectiveKeys = objectiveMatch.length > 0 ? objectiveMatch
        : [nearestCellKey(allCells, { lat: (objectiveBounds.minLat + objectiveBounds.maxLat) / 2, lng: (objectiveBounds.minLng + objectiveBounds.maxLng) / 2 })];
    }

    // Same real classification `assembleMobilityResults` always does — a
    // genuine GO/SLOW-GO/NO-GO terrain read per cell, using whatever
    // reachability `reach` carries so far (the previous round's, or none on
    // round 1) rather than a fabricated placeholder. Matches
    // `mobilityAppreciation.ts`'s own pre-search `onPreviewCells` call.
    onPreviewCells?.(assembleMobilityResults(allCells, hexSize, proj, reach?.best ?? new Map(), profile));

    const outcome = await runMobilitySearchInWorker(
      allCells, hexSize, proj, originKeys, objectiveKeys, options.profileId, options.nightMode, roadSpeedOverrides,
      f => onProgress?.(roundProgress(round, 0.6 + f * 0.4)),
      reach
    );
    if (signal?.aborted) return null;
    reach = outcome.reach;
    results = outcome.results;
    path = outcome.path;

    if (path) break; // found it

    // Which tiles does the reachable frontier actually border? Only cells
    // this round's search could reach at all are relevant — an unreached
    // cell's neighbours say nothing about where growth would help (matches
    // `frontierTouchedEdges`'s own "unreachable cells don't count" rule from
    // the old fixed-box approach).
    const nextNeeded = new Set<string>();
    for (const key of reach.best.keys()) {
      const cell = materialized.get(key);
      if (!cell) continue;
      for (const nHex of hexNeighbors(cell.hex)) {
        const nKey = hexKey(nHex);
        if (materialized.has(nKey)) continue;
        const idx = tileIndexOfLocal(axialToLocal(nHex, hexSize), tileSizeM);
        const tk = tileKeyOf(idx.tx, idx.ty);
        if (!materializedTiles.has(tk)) nextNeeded.add(tk);
      }
    }

    if (nextNeeded.size === 0) break; // reachable frontier is fully enclosed by terrain, not by missing tiles
    if (materialized.size >= cellCeiling || materializedTiles.size >= tileCeiling || round >= MAX_LAZY_ROUNDS) {
      hitCeiling = true;
      break;
    }
    onLog?.(`NO ROUTE YET — MATERIALISING ${nextNeeded.size} MORE TILE(S) TOWARD THE REACHABLE FRONTIER (ROUND ${round + 1})`);
    neededTiles = nextNeeded;
  }

  const allCells = Array.from(materialized.values());
  if (allCells.length === 0) return null;
  if (!reach) {
    // Should be unreachable in practice (the loop always runs at least one
    // round before it can break), kept only so TS sees every path assigns.
    reach = { best: new Map(), prev: new Map() };
  }

  let boundsMinLat = Infinity, boundsMaxLat = -Infinity, boundsMinLng = Infinity, boundsMaxLng = -Infinity;
  for (const c of allCells) {
    if (c.center.lat < boundsMinLat) boundsMinLat = c.center.lat;
    if (c.center.lat > boundsMaxLat) boundsMaxLat = c.center.lat;
    if (c.center.lng < boundsMinLng) boundsMinLng = c.center.lng;
    if (c.center.lng > boundsMaxLng) boundsMaxLng = c.center.lng;
  }

  const grid: MobilityGridResult = {
    cells: allCells,
    hexSize,
    proj,
    originKeys,
    objectiveKeys,
    usedEstimatedData,
    infrastructureAvailable,
    hydrologyAvailable,
    waterFeatures,
    roadWays,
    usedCoarseGrid: false, // this path never coarsens hex size — growth is by tile, not by enlarging cells
    boundsPadFactor: INITIAL_PAD_FACTOR,
    boundsSw: { lat: boundsMinLat, lng: boundsMinLng },
    boundsNe: { lat: boundsMaxLat, lng: boundsMaxLng },
    fidelity,
    targetCellCount,
  };

  return { grid, results, path, roundsUsed: round, tilesUsed: materializedTiles.size, hitCeiling };
}

/** Diminishing-returns progress curve — see `LazyMobilitySearchOptions.onProgress`'s
 *  doc comment for why. `withinRound` is 0..1 progress through round `round`'s
 *  own sampling+search. */
function roundProgress(round: number, withinRound: number): number {
  const roundBase = 1 - Math.pow(0.5, round - 1);
  const roundSpan = Math.pow(0.5, round - 1);
  return roundBase + roundSpan * Math.max(0, Math.min(1, withinRound));
}
