/**
 * Structure analysis engine contract — docs/ROUTE_INTELLIGENCE.md §12, §10.3(b).
 *
 * Deliberately NOT implemented with real computer vision in this pass. The
 * docs are explicit about why: crown detection needs Australian fine-tuning
 * (open pretrained detectors are trained mostly on Northern Hemisphere
 * canopies), and any imagery-derived structure claim is gated on having a
 * lidar calibration set to validate against (docs §10.3b, §10.7 M3d/M3e) —
 * shipping a crown detector without that validation is exactly the
 * "fabricated data presented as real analysis" this project's first
 * principle forbids. So the one engine implemented here is an honest no-op:
 * it reports its own absence rather than a confident-looking wrong answer.
 *
 * The interface itself is real and meant to be built against: a future
 * texture-classification engine (cheap, robust, the docs' recommended FIRST
 * tier — see §10.3b) or a crown-delineation engine (gated as above) both
 * implement this same shape.
 */

import { ImageryTileSet } from './ImageryProvider';

export type StructureObservationKind = 'crown-polygon' | 'gap-network' | 'row-structure' | 'linear-feature' | 'texture-class';

export interface StructureObservation {
  kind: StructureObservationKind;
  /** GeoJSON-shaped geometry in the tile's own pixel space is deliberately
   *  NOT specified further here — a real implementation would georeference
   *  this using the ImageryTileSet's bounds; left abstract since no engine
   *  in this pass produces real geometry to reference. */
  geometry: unknown;
  confidence: number; // 0..1
  /** Which docs §10.5 tier this observation would sit at if it were real
   *  (kept even on a stub result, so callers' tier-handling code has a
   *  stable field to read). */
  dataTier: 0 | 1 | 2 | 3;
}

export interface StructureAnalysisResult {
  observations: StructureObservation[];
  /** True whenever the engine could not produce real observations —
   *  callers MUST treat an empty `observations` array with this flag set as
   *  "not analysed", never as "analysed, found nothing". */
  notAnalysed: boolean;
  reason?: string;
}

export interface StructureAnalysisEngine {
  readonly name: string;
  analyse(tiles: ImageryTileSet): Promise<StructureAnalysisResult>;
}

/**
 * The only engine implemented in this pass. Always reports `notAnalysed`.
 * Exists so the rest of the mode can be wired against the real interface now
 * (provider → engine → observations) without a later engine swap requiring
 * any caller change — only this class gets replaced.
 */
export class NotYetImplementedEngine implements StructureAnalysisEngine {
  readonly name = 'not-yet-implemented';

  async analyse(_tiles: ImageryTileSet): Promise<StructureAnalysisResult> {
    return {
      observations: [],
      notAnalysed: true,
      reason: 'Imagery structure analysis is gated on a lidar calibration set (docs §10.3b) and Australian-specific model validation — not implemented in this pass. See docs/ROUTE_INTELLIGENCE.md §10.7 M3e.',
    };
  }
}
