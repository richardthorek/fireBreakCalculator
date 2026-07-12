# API Register

**Last Updated**: July 11, 2026  
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

## AI Assistant Endpoints

| Endpoint | Method | Purpose | Request Body | Response | Auth Required |
|----------|--------|---------|--------------|----------|---------------|
| `/api/assistant/briefing` | POST | One-shot field briefing narrating the current analysis. Always 200: returns a validated AI narration when the model is configured and stays grounded, otherwise a deterministic template built from the payload. | `{ payload: AssistantPayload }` | `AssistantResponse` | No |
| `/api/assistant/chat` | POST | Grounded Q&A over the current plan. No template fallback — an unconfigured/unreachable model or a failed grounding check returns `source: 'unavailable'` with a plain message, never a guess. | `{ payload: AssistantPayload, question: string, history?: {role,content}[] }` (question ≤500 chars, history ≤6 turns of ≤800 chars) | `AssistantResponse` | No |

```typescript
interface AssistantPayload {
  distanceM: number; breakWidthM: number; maxSlopeDeg: number; meanSlopeDeg: number;
  predominantVegetation: string; vegetationConfidence: number; estimatedData: boolean;
  difficultyScore: number; difficultyLabel: string;
  topEquipment: { name: string; type: string; timeHours: number; cost: number; compatibilityLevel: string }[];
  insights: { severity: string; title: string; detail: string }[];
}

interface AssistantResponse {
  source: 'ai' | 'template' | 'unavailable';
  text: string;
  citations: { id: string; title: string; source: string }[];
}
```

Backed by an Azure AI Foundry model deployment (`AI_FOUNDRY_ENDPOINT`/`AI_FOUNDRY_API_KEY`/`AI_FOUNDRY_DEPLOYMENT_NAME` app settings, provisioned via `infra/main.bicep`'s `deployAiAssistant` flag — off by default). Every AI response is validated against the payload before being returned; see [AI_ASSISTANT.md](AI_ASSISTANT.md) for the grounding contract.

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
