# State Vegetation Integration: Implementation Guide

**Status**: Architecture and phased implementation plan  
**Target**: Replace NVIS-only fallback with state-based hierarchy  
**Timeline**: Phased implementation (start with Tier 1)

---

## Architecture Overview

### Current State
```
analyzeTrackVegetation()
  ├─ fetchNSWVegetation() if in NSW ✅
  └─ fetchNVISVegetation() fallback (all states) ❌
      └─ Mapbox fallback
```

**Problem**: Non-NSW states default to lower-fidelity NVIS.

### Proposed State
```
analyzeTrackVegetation()
  └─ fetchStateVegetation(lat, lng)
      ├─ determineState(lat, lng) → State ID
      └─ Query chain:
          1. NSW → SVTM_NSW_Extant_PCT ✅
          2. VIC → VIC state service 🔧
          3. QLD → QLD state service 🔧
          4. WA → WA state service 🔧
          5. SA → SA state service 🔧
          6. TAS → TAS state service 🔧
          7. ACT/NT → NVIS (placeholder)
          └─ All → Mapbox → Mock
```

---

## Phase 1: Infrastructure (1-2 sprints)

### 1.1 Create State Detection Module

**File**: `webapp/src/utils/stateDetection.ts`

```typescript
export type AustralianState = 'NSW' | 'VIC' | 'QLD' | 'WA' | 'SA' | 'TAS' | 'ACT' | 'NT';

// Bounding boxes (lon/lat order for ArcGIS compatibility)
const STATE_BOUNDS: Record<AustralianState, { minLat: number; maxLat: number; minLng: number; maxLng: number }> = {
  NSW: { minLat: -38.5, maxLat: -27.5, minLng: 140.0, maxLng: 154.5 },
  VIC: { minLat: -39.5, maxLat: -34.0, minLng: 140.5, maxLng: 150.0 },
  QLD: { minLat: -29.0, maxLat: -9.5, minLng: 138.0, maxLng: 154.0 },
  WA: { minLat: -35.5, maxLat: -13.5, minLng: 112.0, maxLng: 129.0 },
  SA: { minLat: -38.0, maxLat: -26.0, minLng: 129.0, maxLng: 141.0 },
  TAS: { minLat: -44.5, maxLat: -40.5, minLng: 144.0, maxLng: 148.5 },
  ACT: { minLat: -35.8, maxLat: -35.1, minLng: 148.7, maxLng: 149.4 },
  NT: { minLat: -26.0, maxLat: -11.0, minLng: 129.0, maxLng: 138.0 },
};

export function determineState(lat: number, lng: number): AustralianState {
  for (const [state, bounds] of Object.entries(STATE_BOUNDS)) {
    if (lat >= bounds.minLat && lat <= bounds.maxLat && lng >= bounds.minLng && lng <= bounds.maxLng) {
      return state as AustralianState;
    }
  }
  // Default to NVIS coverage
  return 'NSW'; // Fallback
}

export function isInAustralia(lat: number, lng: number): boolean {
  return determineState(lat, lng) !== 'NSW' || inNSW(lat, lng); // simplified
}
```

### 1.2 Create Unified State Vegetation Interface

**File**: `webapp/src/utils/stateVegetationInterfaces.ts`

```typescript
import { VegetationType } from '../config/classification';

export interface StateVegetationResult {
  vegetationType: VegetationType;
  confidence: number;
  /** Display label (formation name, PCT name, etc.) */
  displayLabel: string;
  /** Source layer/code (for debugging) */
  source: string;
  /** State code */
  state: string;
  /** Optional: raw attributes from state service */
  rawAttributes?: Record<string, unknown>;
}

export interface StateVegetationService {
  /** Fetch vegetation data for a point; null if outside coverage or query fails */
  fetch(lat: number, lng: number): Promise<StateVegetationResult | null>;
  
  /** Service status/health check */
  isAvailable(): Promise<boolean>;
  
  /** Service name (for logging/monitoring) */
  name: string;
}
```

---

## Phase 2: State Service Router (1 sprint)

### 2.1 Create Router

**File**: `webapp/src/utils/stateVegetationRouter.ts`

```typescript
import { AustralianState, determineState } from './stateDetection';
import { StateVegetationService, StateVegetationResult } from './stateVegetationInterfaces';
import { fetchNSWVegetation } from './nswVegetationService';
import { fetchNVISVegetation } from './nvisVegetationService';
// import { fetchVICVegetation } from './vicVegetationService'; // Phase 3+
// import { fetchQLDVegetation } from './qldVegetationService';

const cache: Record<string, StateVegetationResult | null> = {};

/** Route to appropriate state service based on coordinates */
export async function fetchStateVegetation(lat: number, lng: number): Promise<StateVegetationResult | null> {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (key in cache) return cache[key];

  const state = determineState(lat, lng);
  
  let result: StateVegetationResult | null = null;

  try {
    switch (state) {
      case 'NSW':
        result = await fetchNSWVegetation(lat, lng);
        break;
      // case 'VIC':
      //   result = await fetchVICVegetation(lat, lng);
      //   break;
      // case 'QLD':
      //   result = await fetchQLDVegetation(lat, lng);
      //   break;
      // ... other states
      default:
        // Fall back to NVIS for unimplemented states
        result = await fetchNVISVegetation(lat, lng);
    }
  } catch (error) {
    logger.warn(`State vegetation lookup failed for (${lat}, ${lng}):`, error);
    // Fall back to NVIS on error
    result = await fetchNVISVegetation(lat, lng);
  }

  cache[key] = result || null;
  return result;
}

export function _clearStateVegetationCache() {
  Object.keys(cache).forEach(k => delete cache[k]);
}
```

### 2.2 Update Vegetation Analysis to Use Router

**File**: `webapp/src/utils/vegetationAnalysis.ts`

Replace:
```typescript
const nswVeg = await fetchNSWVegetation(midLat, midLng);
if (nswVeg) { ... } else {
  const nvis = await fetchNVISVegetation(midLat, midLng);
  ...
}
```

With:
```typescript
const stateVeg = await fetchStateVegetation(midLat, midLng);
if (stateVeg) { ... } else {
  // Fall back to Mapbox if state services fail
  const landcover = await fetchLandcoverData(midLat, midLng, token || '');
  ...
}
```

---

## Phase 3: Implement High-Priority States (2-3 sprints each)

### 3.1 Victoria State Service

**File**: `webapp/src/utils/vicVegetationService.ts`

Template:
```typescript
/**
 * Victorian vegetation via [TBD - identify correct endpoint].
 * Queries [dataset name] for high-fidelity vegetation formation.
 */

import { logger } from './logger';
import { StateVegetationResult } from './stateVegetationInterfaces';
import { VegetationType } from '../config/classification';

const VIC_SERVICE_URL = '[TBD]'; // Environment variable overridable
const VIC_LAYER_ID = 0; // [TBD]
const VIC_BBOX = { minLat: -39.5, maxLat: -34.0, minLng: 140.5, maxLng: 150.0 };

const cache: Record<string, StateVegetationResult | null> = {};

/** Map Victorian vegetation formation to 4-class fuel taxonomy */
function mapVICToInternal(formation: string, otherAttrs: Record<string, unknown>): StateVegetationResult | null {
  // Similar to NSW service: regex patterns, confidence scoring
  // [IMPLEMENTATION DETAILS - similar to mapNSWToInternal]
  return null; // Placeholder
}

export async function fetchVICVegetation(lat: number, lng: number): Promise<StateVegetationResult | null> {
  if (!inVIC(lat, lng)) return null;
  
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (key in cache) return cache[key];

  try {
    const url = buildQueryUrl(lat, lng); // Similar to NSW
    const resp = await fetch(url);
    if (!resp.ok) return null;
    
    const json = await resp.json();
    const attrs = json?.features?.[0]?.attributes;
    if (!attrs) return null;

    const result = mapVICToInternal(attrs.formation || attrs.vegClass, attrs);
    cache[key] = result || null;
    return result;
  } catch (error) {
    logger.warn('VIC vegetation query failed:', error);
    cache[key] = null;
    return null;
  }
}

export function _clearVICCache() {
  Object.keys(cache).forEach(k => delete cache[k]);
}
```

**Research Required**:
- [ ] Confirm Victoria's public vegetation endpoint (ArcGIS)
- [ ] Identify layer ID and queryable attributes (formation, vegClass, etc.)
- [ ] Document attribute names and values
- [ ] Create mapping rules (formation → 4-class fuel taxonomy)
- [ ] Test with sample points from the fidelity test

**Testing**:
- [ ] Run fidelity test specifically for Victoria
- [ ] Verify Mallee region returns mediumscrub (not grassland)
- [ ] Confirm diversity improves from test baseline

---

### 3.2 Queensland State Service

Similar structure to Victoria, but:
- Research QLD Vegetation Management Framework (VMF) endpoint
- Focus on Central QLD (had 67% success with NVIS)
- Map Queensland vegetation types to fuel taxonomy
- Test inland/remote regions

---

### 3.3 Western Australia State Service

Similar structure, focus on:
- DBCA native vegetation mapping
- Diverse WA vegetation (forest, woodland, mallee, arid shrub)
- Test coastal vs. inland regions

---

### 3.4 South Australia State Service

Focus on:
- SA Native Vegetation Council data
- Coastal Heathland (had low confidence 0.6 with NVIS)
- Verify heathland confidence improves

---

## Phase 4: Optional States (1-2 sprints each)

### 4.1 Tasmania Service
### 4.2 ACT Service (if public data available)
### 4.3 NT Service (if public data available)

---

## Phased Rollout Timeline

| Phase | Work | Duration | States Covered | Expected Improvement |
|-------|------|----------|---|---|
| Current | NSW only | ✅ Done | NSW (27% of Australia) | Baseline |
| 1 | Infrastructure | 1-2 weeks | All (routing only) | No change (NVIS fallback) |
| 2 | Router + updates | 1 week | NSW + routing | No change (NSW + NVIS) |
| 3a | Victoria service | 1-2 weeks | NSW + VIC | +5% diversity, Mallee fix |
| 3b | Queensland service | 1-2 weeks | NSW + VIC + QLD | +5% diversity, Central QLD coverage |
| 3c | WA service | 1-2 weeks | NSW + VIC + QLD + WA | +5% diversity |
| 3d | SA service | 1-2 weeks | NSW + VIC + QLD + WA + SA | +5% diversity, Coastal SA fix |
| 4 | TAS/ACT/NT | 1-2 weeks each | All Australia | Final polish |

**Total**: ~3-4 months for full implementation (if pursued aggressively)

---

## Success Metrics

### Fidelity Test Targets

- [ ] NSW: Maintain current high performance (diversity 0.45+, confidence 0.73+)
- [ ] Victoria: Mallee diversity ↑ from 0.0 → 0.6+ (mediumscrub detected)
- [ ] Queensland: Central region success rate ↑ from 67% → 95%+
- [ ] South Australia: Coastal Heathland confidence ↑ from 0.6 → 0.75+
- [ ] Tasmania: Maintain diversity 0.79+

### Overall Targets

- [x] Average diversity: 0.453 → 0.55+ (10% improvement)
- [x] Grassland concentration: 36.8% → <30%
- [x] No region with diversity < 0.3
- [x] Success rate: 90.5% → 95%+

---

## Implementation Checklist

### Phase 1 (This Week)
- [ ] Create `stateDetection.ts` with bounding boxes
- [ ] Create `stateVegetationInterfaces.ts` (shared interface)
- [ ] Create `stateVegetationRouter.ts` (orchestrator)
- [ ] Update `vegetationAnalysis.ts` to use router

### Phase 2
- [ ] Update NSW service to use new interface
- [ ] Test router fallback chain
- [ ] Deploy to staging

### Phase 3+
- [ ] Research each state endpoint
- [ ] Implement Victoria service
- [ ] Run fidelity tests after each state added
- [ ] Document data sources for users

---

## References

- State Data Sources: [STATE_VEGETATION_DATA_SOURCES.md](./STATE_VEGETATION_DATA_SOURCES.md)
- Fidelity Report: [NVIS_FIDELITY_REPORT.md](./NVIS_FIDELITY_REPORT.md)
- Fidelity Test: `scripts/test-nvis-fidelity.mjs`
