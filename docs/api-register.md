# API Register

**Last Updated**: February 8, 2026  
**Purpose**: Machine-readable catalog of all API endpoints
**Update Policy**: MUST update when endpoints are added, modified, or removed

This is a **living document** that should be kept synchronized with the API codebase.

---

## Equipment Endpoints

| Endpoint | Method | Purpose | Request Body | Response | Auth Required |
|----------|--------|---------|--------------|----------|---------------|
| `/api/equipment` | GET | List all equipment | None | `Equipment[]` | No |
| `/api/equipment` | POST | Create new equipment | `EquipmentCreateRequest` | `Equipment` | No |
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

## External Integrations

### NSW Vegetation Service
| Endpoint | Method | Purpose | Parameters | Response |
|----------|--------|---------|------------|----------|
| NSW SVTM PCT MapServer | GET | Query vegetation data for coordinates | `geometry, geometryType, spatialRel` | GeoJSON with PCT data |

**Service URL**: `https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/VIS/SVTM_NSW_Extant_PCT/MapServer`

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
