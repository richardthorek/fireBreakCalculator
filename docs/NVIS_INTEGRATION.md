# NVIS Vegetation Data Integration

How the Fire Break Calculator sources vegetation (fuel) data, why we use the
NVIS **web service** rather than self-hosting the raster, and how to operate,
tune, or change that decision.

## Why vegetation data matters here

Every estimate is integrated per segment along the planned line. Each segment
needs a **fuel class** — one of `grassland`, `lightshrub`, `mediumscrub`,
`heavyforest` — because a hand crew slows dramatically in heavy forest, a dozer
less so, and aircraft coverage scales with fuel. Wrong or missing fuel data
means wrong or missing estimates. A planning tool must never silently invent
fuel data, so the sourcing chain is explicit and every value is flagged with a
confidence and whether it was estimated.

## Data sources, in priority order

Vegetation for each sample point is resolved in this order
(`webapp/src/utils/vegetationAnalysis.ts`):

1. **NSW SVTM PCT** (`nswVegetationService.ts`) — high-fidelity Plant Community
   Type polygons. NSW only. Highest confidence where available.
2. **NVIS Major Vegetation Groups** (`nvisVegetationService.ts`) — the
   Australia-wide authoritative fallback. This document is about this layer.
3. **Mapbox Terrain v2 landcover** — coarse global landcover, last resort.
4. **Deterministic mock** — only when everything else fails; always flagged
   `estimated: true` so the UI can warn that the value is not real analysis.

NVIS is what turns "NSW-only real data + guesses everywhere else" into
"real fuel classes across almost the whole continent."

## Decision: web service, not self-hosted raster

The request was to pick between (a) the DCCEEW web services and (b) downloading
the NVIS raster and hosting it ourselves. We use **(a) the web service.**

**The NVIS raster is heavy infrastructure.** The national product (Major
Vegetation Groups / Subgroups) is a continental grid at ~100 m — multi-gigabyte
GeoTIFFs per release. To answer the per-point lookups this app makes, hosting it
ourselves would require either:

- a raster sampling server (e.g. a COG + a `GetPixelValue`/`identify` service),
  which is a stateful GIS service to run, scale, and keep patched; or
- a preprocessing pipeline that reclassifies the raster into vectorised MVG
  polygons and packs them into vector tiles / PMTiles for point-in-polygon
  lookups.

Either is significant build-and-run cost for a lightweight planning tool, and
both need re-doing on each NVIS release.

**DCCEEW already runs the service.** The department publishes a maintained
ArcGIS REST map service for NVIS Extant MVG that answers point lookups directly.
Consuming it gives authoritative, always-current data with no storage, no GIS
server, and no reprojection pipeline on our side.

**We keep the door open.** The endpoint is a single environment variable
(`VITE_NVIS_MVG_URL`). If the public service is ever rate-limited, deprecated,
or too slow, we can stand up a self-hosted mirror (raster sampler or vector-tile
service) that speaks the same ArcGIS `identify`/`query` contract and repoint the
app with no code change. The "host it ourselves" option remains available as an
operational fallback rather than the default.

### When self-hosting would win

Revisit this if any of these become true: the public endpoint's availability or
latency is unacceptable for interactive use; browser CORS to the government host
proves unreliable across users (in which case add a thin backend proxy — see
below — before going all the way to hosting the raster); or the app needs the
finer **MVG Subgroups** or offline operation, where a packaged PMTiles extract
of the operating area is a better fit than live queries.

## How the integration works

`fetchNVISVegetation(lat, lng)` in `webapp/src/utils/nvisVegetationService.ts`:

- Short-circuits outside a continental Australia bounding box.
- Caches results per ~100 m grid cell to avoid duplicate network hits.
- Calls the ArcGIS service with **`identify` first** (the correct operation for a
  raster map service) and **falls back to `query`** (for deployments that expose
  a feature layer instead).
- Resolves the **Major Vegetation Group** from the response: a numeric **MVG
  code** is preferred (mapped via the authoritative `MVG_CLASSES` table of the
  32 groups + "unknown"), falling back to the **group name** parsed tolerantly,
  because field names vary across NVIS releases.
- Maps the MVG to the app's 4-class fuel taxonomy with a per-group confidence.

### MVG → fuel class mapping

The 4 fuel classes proxy line-building difficulty, so the mapping follows
vegetation **structure**: tall/closed forests → `heavyforest`;
woodlands/shrublands/heath/mallee → `mediumscrub`; open woodlands and low sparse
shrublands → `lightshrub`; grasslands/herblands/sedgelands and effectively
fuel-free classes (bare, water, cleared) → `grassland`. The full table with
per-group confidences lives in `MVG_CLASSES` in the service file and is the
place to tune local calibration.

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `VITE_NVIS_MVG_URL` | NVIS MVG ArcGIS MapServer base URL. Repoint to a mirror/proxy if needed. | DCCEEW public NVIS Extant MVG MapServer |

Set it in the webapp build environment (e.g. `.env`, CI, or Static Web App
configuration).

## Verifying it works

The government GIS host may be blocked from some sandboxes/CI networks (403 on
CONNECT); it resolves normally from a browser and from Australian cloud regions.
To verify from a machine with access:

```bash
# identify (raster map service) at a point (lng,lat)
curl "https://gis.environment.gov.au/gispubmap/rest/services/ogc_services/NVIS_ext_mvg/MapServer/identify?f=json&geometry=149.13,-35.28&geometryType=esriGeometryPoint&sr=4326&layers=all:0&tolerance=1&mapExtent=149.12,-35.29,149.14,-35.27&imageDisplay=400,400,96&returnGeometry=false"
```

Look for an MVG code (a `Value`/`Pixel Value`/`MVG*` attribute in `1..32` or
`99`) or an MVG name in the returned attributes; both paths are handled.

## Possible next step: backend proxy (not yet built)

If direct browser calls to the government host prove flaky (CORS, throttling),
add a thin Azure Functions endpoint (e.g. `GET /api/vegetation?lat=&lng=`) that
performs the NSW → NVIS lookup server-side and caches results in Table Storage.
The frontend would call our own origin (no CORS), and we would gain a shared
cache and a single place to swap in a self-hosted raster later. The current
implementation calls the services directly from the browser, which is simpler
and keeps the API stateless; the proxy is the recommended first escalation
before self-hosting the raster.
