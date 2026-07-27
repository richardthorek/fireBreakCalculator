/**
 * Mapbox imagery provider — reads pixels from the satellite tiles already
 * loaded on the map, mirroring webapp/src/utils/mapboxTrails.ts's pattern
 * (zero extra network, works offline once the area is cached, no CORS
 * problem since Mapbox serves its own tiles with the token already in use).
 *
 * INTEGRATION CAVEAT, stated plainly rather than glossed over: capturing
 * pixels from a WebGL canvas via `canvas.toDataURL()` / `getImageData()`
 * only returns real content when the context was created with
 * `preserveDrawingBuffer: true` — otherwise the buffer may already be
 * cleared by the time this code runs after the render loop, and the capture
 * silently returns a blank image. MapboxMapView.tsx's `new mapboxgl.Map(...)`
 * call does NOT currently set that option (checked as of this pass). This
 * provider therefore verifies its own capture (see `looksBlank` below) and
 * returns null — a caller sees "no imagery available", never a fabricated
 * texture — rather than claim success prematurely. Turning
 * `preserveDrawingBuffer: true` on is a one-line follow-up in the map init
 * options; flagged here, not fixed silently in this file, since it's a
 * property of the shared map instance other code also depends on.
 *
 * LICENCE CLASS: hardcoded to 'unconfirmed' — Mapbox Satellite's standard
 * terms license *display*, not extraction of derived datasets (docs
 * §10.3b/§12). A deployment with a confirmed derivative-works licence must
 * override this via the constructor param; the default never claims
 * permission it doesn't have.
 */

import { ImageryProvider, ImageryCoverageInfo, ImageryTileSet, LatLngBounds, ImageryLicenceClass } from './ImageryProvider';

/** Mapbox raster tiles are 512px (or 256px) squares; below this zoom the
 *  imagery is a visibly upsampled overview, not native detail, for most of
 *  the Australian interior (docs §10.3b — must be probed per-AOI in a real
 *  deployment; this is a conservative default threshold, not a measurement). */
const ASSUMED_NATIVE_DETAIL_MIN_ZOOM = 17;

export class MapboxImageryProvider implements ImageryProvider {
  readonly name = 'mapbox-loaded-tiles';
  private readonly getMap: () => any | null;
  private readonly licenceClass: ImageryLicenceClass;

  constructor(getMap: () => any | null, licenceClass: ImageryLicenceClass = 'unconfirmed') {
    this.getMap = getMap;
    this.licenceClass = licenceClass;
  }

  async describeCoverage(bounds: LatLngBounds, zoom: number): Promise<ImageryCoverageInfo | null> {
    const map = this.getMap();
    if (!map) return null;
    // Real-if-crude probe: Mapbox's own zoom level is the honest signal we
    // have without a per-tile metadata call. Below the assumed threshold we
    // report isNativeDetail: false rather than guess otherwise.
    const isNativeDetail = zoom >= ASSUMED_NATIVE_DETAIL_MIN_ZOOM;
    return {
      nativeResolutionM: isNativeDetail ? 0.5 : 4.8 * Math.pow(2, ASSUMED_NATIVE_DETAIL_MIN_ZOOM - zoom),
      attribution: '© Mapbox, © Maxar',
      licenceClass: this.licenceClass,
      isNativeDetail,
    };
  }

  async fetchTiles(bounds: LatLngBounds, zoom: number): Promise<ImageryTileSet | null> {
    const coverage = await this.describeCoverage(bounds, zoom);
    if (!coverage) return null;
    if (coverage.licenceClass !== 'derivative-analysis-permitted') {
      // Display-only or unconfirmed: refuse to hand back pixels for
      // analysis. Display code should read the map directly, not through
      // this provider — this method exists for the analysis path only.
      return null;
    }
    const map = this.getMap();
    if (!map) return null;
    try {
      const canvas: HTMLCanvasElement = map.getCanvas();
      const dataUrl: string = canvas.toDataURL('image/png');
      const rgba = await decodeDataUrlToRgba(dataUrl, canvas.width, canvas.height);
      if (!rgba || looksBlank(rgba)) return null; // preserveDrawingBuffer likely unset — see module note
      return { width: canvas.width, height: canvas.height, rgba, coverage };
    } catch {
      return null; // tainted/cross-origin canvas or capture failure — never fabricate pixels
    }
  }
}

async function decodeDataUrlToRgba(dataUrl: string, width: number, height: number): Promise<Uint8ClampedArray | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const off = document.createElement('canvas');
      off.width = width;
      off.height = height;
      const ctx = off.getContext('2d');
      if (!ctx) { resolve(null); return; }
      ctx.drawImage(img, 0, 0);
      try {
        resolve(ctx.getImageData(0, 0, width, height).data as unknown as Uint8ClampedArray);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/** Cheap heuristic: a capture with no preserveDrawingBuffer typically comes
 *  back as a single uniform colour (the clear colour) — sample a handful of
 *  pixels rather than decode the whole buffer to decide. */
function looksBlank(rgba: Uint8ClampedArray): boolean {
  if (rgba.length < 4) return true;
  const first = [rgba[0], rgba[1], rgba[2], rgba[3]];
  const sampleCount = 20;
  const stride = Math.max(4, Math.floor(rgba.length / sampleCount / 4) * 4);
  for (let i = 4; i < rgba.length; i += stride) {
    if (rgba[i] !== first[0] || rgba[i + 1] !== first[1] || rgba[i + 2] !== first[2] || rgba[i + 3] !== first[3]) {
      return false;
    }
  }
  return true;
}
