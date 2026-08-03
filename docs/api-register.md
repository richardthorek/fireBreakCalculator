# API Register

**Last Updated**: August 3, 2026  
**Purpose**: Machine-readable catalog of all API endpoints
**Update Policy**: MUST update when endpoints are added, modified, or removed

This is a **living document** that should be kept synchronized with the API codebase.

---

## Equipment Endpoints

| Endpoint | Method | Purpose | Request Body | Response | Auth Required |
|----------|--------|---------|--------------|----------|---------------|
| `/api/equipment` | GET | List all equipment (seeds the built-in standard catalogue on first use if the table is empty) | None | `Equipment[]` | No |
| `/api/equipment` | POST | Create new equipment | `EquipmentCreateRequest` | `Equipment` | No |
| `/api/equipment/seed` | POST | Seed the built-in standard equipment catalogue. `?force=true` overwrites existing standard rows; otherwise seeds only when empty. | None | `{ seeded, force, count, equipment[] }` | No |
| `/api/equipment/{id}` | GET | Get equipment by ID | None | `Equipment` | No |
| `/api/equipment/{id}` | PUT | Update equipment | `EquipmentUpdateRequest` | `Equipment` | No |
| `/api/equipment/{id}` | DELETE | Delete equipment | None | `204 No Content` | No |

### Equipment Data Model
```typescript
interface Equipment {
  partitionKey: string;      // Equipment type category
  rowKey: string;            // Unique equipment ID
  name: string;              // Display name
  type: string;              // Equipment type
  timePerMeter: number;      // Time estimate per meter
  costPerHour: number;       // Cost per hour
  terrainTags: string[];     // Compatible terrain types
  vegetationTags: string[];  // Compatible vegetation types
  formationId?: string;      // Parent formation (optional)
  etag?: string;             // Concurrency control
}
```

## Analysis Endpoint

| Endpoint | Method | Purpose | Request Body | Response | Auth Required |
|----------|--------|---------|--------------|----------|---------------|
| `/api/analysis/calculate` | POST | Per-segment production-model estimate (time/cost/compatibility) for a drawn fire-break line against every equipment item — the sole calculation engine ([CALCULATION_REVIEW.md](CALCULATION_REVIEW.md)). Prefers a client-joined `segments[]` profile; degrades to marginal slope/vegetation distributions when absent. Segments crossing mapped water are excluded from every result (already a natural break); segments carry independent along-line and sidehill slope figures, gated separately. | `AnalysisRequest` (`distance`, `trackAnalysis`, `vegetationAnalysis`, `segments?: RouteSegment[]`, `breakWidthMeters?`, `parameters?`) | `AnalysisResponse` (`calculations: CalculationResult[]`, `metadata.analysisParameters` incl. `waterCrossingLength`) | No |

## Saved Plans Endpoints (suite subscription)

All saved-plan endpoints require a Station Manager JWT (`Authorization: Bearer <token>`), validated server-side against SM `GET /api/auth/me`, and the org's `fireBreakEnabled` entitlement. Responses when not satisfied: `401` (no/invalid token), `403` (plan lacks the entitlement), `503` (`SUITE_AUTH_URL` unset on the deployment), `502` (Station Manager unreachable). Storage: Table Storage (`SAVED_PLANS_TABLE_NAME`, default `savedplans`), PartitionKey = SM user id.

| Endpoint | Method | Purpose | Request Body | Response | Auth Required |
|----------|--------|---------|--------------|----------|---------------|
| `/api/plans` | GET | List the caller's saved plans (most recently updated first) | None | `SavedPlan[]` | Yes (SM JWT + `fireBreakEnabled`) |
| `/api/plans` | POST | Save a plan (cap: 100 per user → `409` when full) | `{ name, data }` | `SavedPlan` (201) | Yes (SM JWT + `fireBreakEnabled`) |
| `/api/plans/{id}` | PUT | Rename/replace a saved plan | `{ name, data }` | `SavedPlan` | Yes (SM JWT + `fireBreakEnabled`) |
| `/api/plans/{id}` | DELETE | Delete a saved plan | None | `204 No Content` | Yes (SM JWT + `fireBreakEnabled`) |

### Saved Plan Data Model
```typescript
interface SavedPlan {
  id: string;         // RowKey (uuid)
  userId: string;     // PartitionKey — Station Manager user id
  name: string;       // 1–120 chars
  data: string;       // URL-safe-base64 payload from the webapp's encodePlan()
                      // (same envelope as a share link; <= 100,000 chars)
  createdAt: string;  // ISO
  updatedAt: string;  // ISO
}
```

## Vegetation Mapping Endpoints

| Endpoint | Method | Purpose | Request Body | Response | Auth Required |
|----------|--------|---------|--------------|----------|---------------|
| `/api/vegetation-mappings` | GET | List all vegetation mappings | None | `VegetationMapping[]` | No |
| `/api/vegetation-mappings` | POST | Create new mapping | `VegetationMappingRequest` | `VegetationMapping` | No |
| `/api/vegetation-mappings/{id}` | GET | Get mapping by ID | None | `VegetationMapping` | No |
| `/api/vegetation-mappings/{id}` | PUT | Update mapping | `VegetationMappingRequest` | `VegetationMapping` | No |
| `/api/vegetation-mappings/{id}` | DELETE | Delete mapping | None | `204 No Content` | No |

### Vegetation Mapping Data Model
```typescript
interface VegetationMapping {
  partitionKey: string;      // "VegetationMapping"
  rowKey: string;            // Unique mapping ID
  formation: string;         // Top-level formation
  class: string;             // Mid-level class
  type: string;              // Specific type
  multiplier: number;        // Time/cost multiplier
  etag?: string;             // Concurrency control
}
```

## Vegetation Tile Cache Endpoints (shared cross-user cache)

Blob-backed read-through cache of the external vegetation area data, keyed by
quantised tiles so different users' overlapping corridors hit identical cache
keys (first user at an incident pays the upstream fetch; everyone after reads
the blob — container `vegtiles`, 365-day lifecycle expiry, so one fetch caches a
tile for a whole fire season). Tile grids MUST
match `webapp/src/utils/vegetationTiles.ts`: NVIS 0.5°/tile (500×500 px
native-resolution export PNG), NSW 0.05°/tile (paginated PCT polygon JSON).
Rate-limited (`vegtile` tag); responses carry `Cache-Control: public,
max-age=604800` and an `X-Tile-Cache: hit|miss` diagnostic header. On
upstream failure returns `502` and the client falls back to its
direct-to-government path.

| Endpoint | Method | Purpose | Request Body | Response | Auth Required |
|----------|--------|---------|--------------|----------|---------------|
| `/api/vegetation/tile/{source}/{tx}/{ty}` | GET | One cached tile. `source` = `nvis` (export PNG) or `nsw` (`{ features: [...] }` merged pages, `{ exceeded: true }` when the tile is denser than the pagination cap — uncached, client skips the tile) | None | `image/png` or JSON | No |
| `/api/vegetation/legend` | GET | Cached NVIS `legend?f=json` passthrough (colour→MVG decode contract) | None | JSON | No |

## Infrastructure (Overpass proxy)

Server-side proxy for the OSM/Overpass corridor trail lookup the optimizer uses
(reusable trails/roads as discounted edges + the snap-to-trail path
refinement). **Note the client tries the Mapbox vector tiles already on the map
FIRST** (`mapboxTrails.ts` — same OSM lineage, zero-network, offline-capable)
and only calls this proxy when those tiles don't cover the corridor. The browser
calls this same-origin endpoint instead of the public Overpass instances
directly: those instances omit `Access-Control-Allow-Origin`
on their rate-limited/error responses, so a direct browser call that hits a
429/504/timeout is surfaced as an opaque CORS failure and the whole trail lookup
dies. The server→Overpass hop has no CORS, and one server IP with a short
in-process cache (10 min, rounded-bbox key) spends the public 2-slot-per-IP
quota once per corridor rather than once per user. Rate-limited (`infra` tag).
On upstream failure returns `502` and the client falls back to calling Overpass
directly; a `404` (endpoint not deployed) makes the client stop probing the
proxy for the session and use the direct path.

**`kind` param (added docs §34):** `highway` (default) fetches reusable trails/
roads; `water` fetches waterway/water-body geometry (`waterway=river|canal|
stream`, `natural=water`) for the Terrain Mobility hydrology gate. Same proxy,
same resilience, same cache — one extra query branch rather than a second
endpoint.

| Endpoint | Method | Purpose | Request | Response | Auth Required |
|----------|--------|---------|---------|----------|---------------|
| `/api/infrastructure` | GET | Reusable trails/roads (or waterways, see `kind`) within a corridor bbox, via Overpass | Query `s`,`w`,`n`,`e` (WGS84 bounds; each side ≤ 3°), optional `kind=highway\|water` | `{ trails: { name?, kind, coords: {lat,lng}[] }[], available: boolean }` | No |

## Terrain Mobility Telemetry

Fire-and-forget scale/performance sink for Terrain Mobility runs — cell
counts, terrain/veg difficulty mix, elapsed time by phase, device hints. No
location, no user identity. Feeds the cloud-offload threshold decision in
[ROUTE_INTELLIGENCE.md](ROUTE_INTELLIGENCE.md) §38. Rate-limited (`telemetry`
tag). Always returns `202` on a structurally valid payload even if the table
write fails — telemetry must never surface as an error to the caller.

| Endpoint | Method | Purpose | Request Body | Response | Auth Required |
|----------|--------|---------|--------------|----------|---------------|
| `/api/mobility-telemetry` | POST | Record one completed Terrain Mobility run's scale/performance metadata | `MobilityRunTelemetry` (see below) | `202 Accepted` (no body) | No |

```typescript
interface MobilityRunTelemetry {
  sessionId: string;      // random per browser session, not tied to identity
  timestamp: string;      // ISO, client clock
  profileId: string;
  fidelity: string;
  cellCount: number; targetCellCount: number;
  reachableCount: number; noGoCount: number; slowGoCount: number; goCount: number;
  distanceM: number | null;
  searchAttempts: number; usedExpandedSearch: boolean; routeFound: boolean;
  elapsedMs: number;
  stageDurationsMs: Record<string, number>;    // grid/sampling/search/ensemble/corridors/chokepoints/barrier/restrictions/done
  vegetationHistogram: Record<string, number>; // vegetation kind -> cell count
  hardwareConcurrency: number | null;
  deviceMemoryGb: number | null;
}
```

## Terrain Mobility Backend (tier-2, OCOKA 5)

Served by the **separate** `api-mobility/` Function App, NOT `/api` — gated
behind `infra/main.bicep`'s `deployMobilityBackend bool = false` (off in every
deployment today; see [ROUTE_INTELLIGENCE.md](ROUTE_INTELLIGENCE.md) §49 for
why this can't be an additive endpoint on `/api` the way every other row on
this page is). Base URL is whatever `VITE_MOBILITY_API_BASE_URL` is set to for
a given deployment — unset means the feature doesn't exist client-side either.

| Endpoint | Method | Purpose | Request Body | Response | Auth Required |
|----------|--------|---------|--------------|----------|---------------|
| `/mobility/jobs` | POST | Start a tier-2 mobility appreciation job (Durable orchestration) | `MobilityJobRequest` | `202 { jobId, statusUrl }` | No (Table-Storage rate-limited + concurrent-job cap) |
| `/mobility/jobs/{jobId}` | GET | Poll job status — pointers only, never Durable internals; each artefact carries a freshly-minted read-only SAS `url`, reminted every poll | None | `MobilityJobStatusResponse` (see below) | No |

```typescript
interface MobilityJobRequest {
  originBounds: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  objectiveBounds: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  moverProfileId: string;
  nightMode: boolean;
  fidelity: 'quick' | 'standard' | 'fine';
}

interface MobilityJobStatusResponse {
  jobId: string;
  phase: 'running' | 'complete' | 'failed';
  provisional: boolean;       // export/AI-briefing must refuse while true
  artefacts: { seq: number; kind: 'grid-summary' | 'route' | 'corridors' | 'obstacles' | 'key-terrain'; blobPath: string; url: string }[];
  incompleteStages?: string[];
  error?: string;
  startedAt: string;
  updatedAt: string;
}
```

`MobilityJobRequest`/`MobilityJobStatusResponse` are the **third** webapp/api
must-match pair (`api-mobility/src/types/mobilityJob.ts` ↔
`webapp/src/utils/mobilityJobApi.ts`).

## AI Assistant Endpoints

| Endpoint | Method | Purpose | Request Body | Response | Auth Required |
|----------|--------|---------|--------------|----------|---------------|
| `/api/assistant/briefing` | POST | One-shot field briefing narrating the current analysis. Always 200: returns a validated AI narration when the model is configured and stays grounded, otherwise a deterministic template built from the payload. | `{ payload: AssistantPayload }` | `AssistantResponse` | No |
| `/api/assistant/chat` | POST | Grounded Q&A over the current plan. No template fallback — an unconfigured/unreachable model or a failed grounding check returns `source: 'unavailable'` with a plain message, never a guess. | `{ payload: AssistantPayload, question: string, history?: {role,content}[] }` (question ≤500 chars, history ≤6 turns of ≤800 chars) | `AssistantResponse` | No |
| `/api/assistant/mobility-briefing` | POST | One-shot plain-language appreciation narrating a Terrain Mobility & Counter-Mobility result (corridors, chokepoints, min-cut barrier, scored counter-measure placements). Same always-200 contract as `/assistant/briefing`: validated AI narration when grounded, otherwise a deterministic template built straight from the payload. | `{ payload: MobilityAssistantPayload }` | `AssistantResponse` | No |
| `/api/assistant/smeacs` | POST | SMEACS-structured briefing (six NSW RFS doctrinal sections: situation/mission/execution/administration/command/safety) built deterministically from the same fire-break `AssistantPayload` — no AI model layer yet, always 200. | `{ payload: AssistantPayload }` | `SmeacsBriefing` | No |

```typescript
interface AssistantPayload {
  distanceM: number; breakWidthM: number; maxSlopeDeg: number; meanSlopeDeg: number;
  predominantVegetation: string; vegetationConfidence: number; estimatedData: boolean;
  difficultyScore: number; difficultyLabel: string;
  topEquipment: { name: string; type: string; timeHours: number; cost: number; compatibilityLevel: string }[];
  insights: { severity: string; title: string; detail: string }[];
  // SMEACS briefing fields (optional — an older client's payload still validates)
  startCoords?: { lat: number; lng: number };
  endCoords?: { lat: number; lng: number };
  locality?: string;
  taskedResourceTypes?: string[];
  entryPoint?: { coords: { lat: number; lng: number }; roadName?: string; roadKind: string; gapM: number; forLineEnd: 'start' | 'end' };
  approachSteps?: { roadName: string; distanceM: number }[];
}

interface AssistantResponse {
  source: 'ai' | 'template' | 'unavailable';
  text: string;
  citations: { id: string; title: string; source: string }[];
}

interface SmeacsBriefing {
  sections: { section: 'situation' | 'mission' | 'execution' | 'administration' | 'command' | 'safety';
    heading: string; lines: string[]; userEditable: boolean;
    citations: { id: string; title: string; source: string }[] }[];
  generatedAt: string;
  dataHonestyCaveat?: string;
  disclaimer: string;
  /** Reproducibility stamp: which estimate engine produced these numbers. */
  provenance: string;
}

interface MobilityAssistantPayload {
  moverProfileLabel: string; moverProfileConfidence: string; nightMode: boolean;
  cellCount: number; reachableCount: number; noGoCount: number; slowGoCount: number;
  estimatedData: boolean;
  // True when either hydrology source (OSM waterway/water-body geometry, DEA WOfS
  // frequency) returned real data for this AOI — false states "nothing to check
  // against" rather than leaving water-affected counts silently absent.
  hydrologyAvailable: boolean;
  waterAffectedCellCount: number; // any water signal: standing body, watercourse, high DEA wet-frequency
  waterBodyCellCount: number; // subset literally inside a mapped standing water body
  unconstrained: boolean; coveragePercent: number;
  topCorridors: { rank: number; easeClass: string; routeCount: number; routeTotal: number;
    medianTravelMin: number; bottleneckWidthM: number; bottleneckAbreast: number;
    frontage: string; goFractionPct: number }[];
  chokepointCount: number; topChokepointPassCount: number | null;
  barrierSegmentCount: number | null; barrierCutValue: number | null;
  placements: { measureId: string; measureLabel: string; delayImposedMin: number;
    bypassDelayMin: number | null; egressSafe: boolean }[];
  // Probabilistic movement (ROUTE_INTELLIGENCE.md §32) — all optional so an older
  // client's payload still validates; a missing figure is reported as missing,
  // never defaulted into a number.
  corridorEvidence?: 'optimiser-routes' | 'simulated-movers';
  movement?: { moverCount: number; arrivedPercent: number; medianMin: number | null;
    p10Min: number | null; p90Min: number | null; crossCountryPercent: number;
    optimalMin: number | null; behaviourSpread: string };
  restrictions?: { rank: number; kind: string; transitPercent: number; marginalDelayMin: number;
    cumulativeDelayMin: number; arrivedPercentAfter: number }[];
  restrictionEffect?: { baselineMedianMin: number | null; scenarioMedianMin: number | null;
    baselineArrivedPercent: number; scenarioArrivedPercent: number;
    baselineCrossCountryPercent: number; scenarioCrossCountryPercent: number;
    bypassNote: string | null };
}
```

Backed by an Azure AI Foundry model deployment (`AI_FOUNDRY_ENDPOINT`/`AI_FOUNDRY_API_KEY`/`AI_FOUNDRY_DEPLOYMENT_NAME` app settings, provisioned via `infra/main.bicep`'s `deployAiAssistant` flag — off by default). Every AI response is validated against the payload before being returned; see [AI_ASSISTANT.md](AI_ASSISTANT.md) for the grounding contract. `/assistant/mobility-briefing` reuses the exact same grounding gate (`aiGrounding.ts`'s `buildSystemPrompt`/`validateGroundedResponse`, both payload-shape-agnostic) with a mobility-specific audience string and its own deterministic template (`mobilityBriefingTemplate.ts`) — see ROUTE_INTELLIGENCE.md §30.

## External Integrations

### NSW Vegetation Service
| Endpoint | Method | Purpose | Parameters | Response |
|----------|--------|---------|------------|----------|
| NSW SVTM PCT MapServer | GET | Query vegetation data for coordinates | `geometry, geometryType, spatialRel` | GeoJSON with PCT data |

**Service URL**: `https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/VIS/SVTM_NSW_Extant_PCT/MapServer`

### NVIS Vegetation Service (national fallback)
| Endpoint | Method | Purpose | Parameters | Response |
|----------|--------|---------|------------|----------|
| NVIS Extant MVG MapServer | GET | Australia-wide Major Vegetation Group at a point (`identify`, `query` fallback) | `geometry, geometryType, sr, layers` | Attributes incl. MVG code/name |

**Service URL** (override via `VITE_NVIS_MVG_URL`): `https://gis.environment.gov.au/gispubmap/rest/services/ogc_services/NVIS_ext_mvg/MapServer`

See [NVIS_INTEGRATION.md](NVIS_INTEGRATION.md) for the web-service-vs-raster decision and MVG→fuel-class mapping.

### Elevation Service (Mock)
| Endpoint | Method | Purpose | Parameters | Response |
|----------|--------|---------|------------|----------|
| `/api/elevation` (planned) | POST | Get elevation profile for path | `coordinates[]` | `{ elevations: number[], distances: number[] }` |

**Current Status**: Mock implementation, real integration planned Q2 2026

---

## Response Status Codes

| Status Code | Meaning | Usage |
|-------------|---------|-------|
| 200 OK | Success | GET, PUT requests |
| 201 Created | Resource created | POST requests |
| 204 No Content | Success, no body | DELETE requests |
| 400 Bad Request | Invalid request data | Validation failures |
| 404 Not Found | Resource doesn't exist | Invalid ID |
| 409 Conflict | Concurrency conflict | ETag mismatch |
| 500 Internal Server Error | Server error | Unexpected failures |

---

## Error Response Format

All error responses follow this structure:

```typescript
interface ErrorResponse {
  error: string;          // Error type/code
  message: string;        // Human-readable message
  details?: any;          // Additional context (optional)
}
```

Example:
```json
{
  "error": "VALIDATION_ERROR",
  "message": "Equipment name is required",
  "details": {
    "field": "name",
    "value": null
  }
}
```

---

## Authentication & Authorization

**Current Status**: No authentication required (public API)
**Planned**: Authentication system planned for Q4 2026 (see master_plan.md roadmap)

---

## Rate Limiting

**Current Status**: No rate limiting
**Planned**: To be determined based on usage patterns

---

## API Versioning

**Current Version**: v1 (implicit, no version in URL)
**Strategy**: Breaking changes will introduce versioned endpoints (e.g., `/api/v2/equipment`)

---

## Update Instructions

When adding/modifying an endpoint:
1. Add/update row in appropriate table above
2. Include method, purpose, request/response types
3. Update data models if changed
4. Update status codes if new ones used
5. Commit changes with API changes

When removing an endpoint:
1. Mark as deprecated first (if possible)
2. Remove row after deprecation period
3. Note removal in master_plan.md Recent Updates
4. Commit changes with endpoint removal

---

**Maintained By**: All contributors
**Format**: Markdown tables (easily parseable by tools)
**Related**: [Component Register](component-register.md), [master_plan.md](/master_plan.md)
