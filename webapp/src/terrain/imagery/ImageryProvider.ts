/**
 * Provider-agnostic imagery contract — docs/ROUTE_INTELLIGENCE.md §12.
 *
 * Owner decision (2026-07-26): assume imagery licensing is in hand for the
 * POC, but architect so the provider is swappable — the licensing analysis
 * in docs §10.3(b) becomes a deployment-time concern, not a design blocker.
 *
 * Two narrow interfaces, deliberately kept apart: a provider supplies pixels
 * for an area; an analysis engine turns pixels into structure observations.
 * Neither is wired to a live crown-detection model in this pass — see
 * `StructureAnalysisEngine.ts` for why, and what would need to be true before
 * one is added.
 */

export interface LatLngBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export type ImageryLicenceClass =
  /** Display only — derivative analysis (crown detection, texture
   *  classification, anything that extracts a NEW dataset from the pixels)
   *  is NOT permitted under this licence. A provider reporting this class
   *  must still be usable for on-screen display; callers MUST refuse to run
   *  a StructureAnalysisEngine against its tiles. */
  | 'display-only'
  /** Derivative analysis is explicitly permitted (a commercial licence with
   *  derivative-works rights, or imagery the deployment owns outright). */
  | 'derivative-analysis-permitted'
  /** Licence terms are unknown/unconfirmed for this deployment — treat as
   *  the MOST restrictive case (equivalent to 'display-only') until someone
   *  confirms otherwise. Never defaults silently to permitted. */
  | 'unconfirmed';

export interface ImageryCoverageInfo {
  /** Native resolution actually backing this bbox at the requested zoom,
   *  metres/pixel — the §10.3(b) "decline rather than produce shapes" probe
   *  reads this before running any analysis. */
  nativeResolutionM: number;
  /** When the source imagery was acquired, if known. Undefined means the
   *  provider could not determine a vintage — treat conservatively. */
  acquisitionDate?: string;
  attribution: string;
  licenceClass: ImageryLicenceClass;
  /** True when this specific bbox/zoom combination is actually backed by
   *  fresh source imagery rather than an upsampled lower-zoom tile. A
   *  provider that cannot tell must report false (never assume yes). */
  isNativeDetail: boolean;
}

export interface ImageryTileSet {
  /** One flattened RGBA raster covering the requested bbox, already
   *  reprojected to simple equirectangular pixel space by the provider —
   *  callers should not need to know the source tiling scheme. */
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  coverage: ImageryCoverageInfo;
}

export interface ImageryProvider {
  readonly name: string;
  /** Cheap, no-pixel-transfer check: can this provider answer for this bbox
   *  at all, and at what fidelity? Callers MUST call this before
   *  `fetchTiles` and MUST refuse to analyse (though may still display) when
   *  `licenceClass !== 'derivative-analysis-permitted'` or
   *  `!isNativeDetail`. */
  describeCoverage(bounds: LatLngBounds, zoom: number): Promise<ImageryCoverageInfo | null>;
  /** Returns pixels, or null when the provider genuinely cannot supply this
   *  bbox/zoom (never a silently-upsampled substitute — that is exactly the
   *  case `describeCoverage` exists to let a caller decline up front). */
  fetchTiles(bounds: LatLngBounds, zoom: number): Promise<ImageryTileSet | null>;
}
