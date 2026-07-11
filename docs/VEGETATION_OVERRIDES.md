# Vegetation Override System

**Status**: ✅ Implementation Complete (ready for integration)  
**Date**: 2026-07-11

---

## Overview

The vegetation override system allows users to override auto-detected vegetation with their local knowledge. This addresses cases where:
- The satellite/NVIS data is outdated or inaccurate
- Recent fire regrowth has changed vegetation type
- User has on-site knowledge not captured in datasets
- Landscape management has altered vegetation

Users can override vegetation at two levels:
1. **Route-level**: Apply a single vegetation type to the entire route
2. **Segment-level**: Set different vegetation types for specific segments

---

## Features

### 1. Route-Level Override
Apply a uniform vegetation type to the entire planned route, ignoring auto-detected data.

```
User sets: "entire route is Heavy Forest"
→ All segments default to heavyforest, regardless of NVIS/state data
```

### 2. Segment-Level Overrides
Override vegetation for specific distance ranges along the route.

```
User sets:
  - 0-500m: Grassland (recently cleared)
  - 500-1500m: Heavy Forest (confirmed on-site)
  - 1500-2000m: Light Shrub (sparse regrowth)
→ Each segment uses its override when available
```

### 3. Enable/Disable Toggle
Users can enable/disable all overrides without losing configurations.

```
Enabled: Overrides are active in analysis
Disabled: Returns to auto-detected vegetation data
```

### 4. Confidence Boost
When users provide overrides, confidence scores are boosted to 1.0 (maximum), reflecting explicit human knowledge.

### 5. Audit Trail
Optional notes on each override explain the reasoning ("recent fire regrowth", "on-site inspection", etc).

---

## Data Structures

### VegetationOverridesConfig
```typescript
interface VegetationOverridesConfig {
  // Route-level override for entire route
  routeOverride?: VegetationType;  // 'grassland' | 'lightshrub' | 'mediumscrub' | 'heavyforest'
  routeOverrideNote?: string;       // Why this override was set

  // Segment-level overrides (take precedence over route-level)
  segmentOverrides?: SegmentVegetationOverride[];

  // Whether overrides are currently active
  isEnabled?: boolean;
}
```

### SegmentVegetationOverride
```typescript
interface SegmentVegetationOverride {
  startDistance: number;      // Start of segment (meters)
  endDistance: number;        // End of segment (meters)
  vegetation: VegetationType; // Override vegetation type
  note?: string;              // Optional reason
  createdAt?: string;         // ISO 8601 timestamp
}
```

---

## UI Component: VegetationOverridePanel

### Location
`webapp/src/components/VegetationOverridePanel.tsx`

### Usage
```tsx
import { VegetationOverridePanel } from './components/VegetationOverridePanel';

<VegetationOverridePanel
  totalDistance={routeDistance}
  segments={vegetationAnalysis?.segments}
  overrides={vegetationOverrides}
  onOverridesChange={setVegetationOverrides}
/>
```

### Props
| Prop | Type | Description |
|------|------|-------------|
| `totalDistance` | number | Total route length in meters |
| `segments` | Array | Current vegetation analysis segments |
| `overrides` | VegetationOverridesConfig | Current override state |
| `onOverridesChange` | function | Called when overrides change |

### Features
- ✅ Enable/disable checkbox
- ✅ Route-level dropdown selector
- ✅ Optional reason text field
- ✅ Add/edit/remove segment overrides
- ✅ Visual color-coding for vegetation types
- ✅ Distance range validation
- ✅ Overlap handling (replace vs. merge modes)
- ✅ Progress indicator (% of route overridden)
- ✅ Responsive design

---

## Integration with Route Analysis

### 1. Update App.tsx State

```tsx
import { VegetationOverridesConfig } from './types/vegetationOverrides';

// Add to state
const [vegetationOverrides, setVegetationOverrides] = useState<VegetationOverridesConfig>({
  isEnabled: false,
  routeOverride: undefined,
  segmentOverrides: [],
});
```

### 2. Persist Overrides in Route Data

Update route sharing/persistence to include overrides:

```tsx
const routeData = {
  lineCoords,
  trackAnalysis,
  vegetationAnalysis,
  vegetationOverrides,  // NEW: Add overrides to route data
  // ... other fields
};
```

### 3. Pass to buildRouteProfile()

```tsx
import { buildRouteProfile } from './utils/routeProfile';

const segments = buildRouteProfile(
  fireBreakDistance,
  trackAnalysis,
  vegetationAnalysis,
  undefined,  // Legacy overrideVegetation parameter (keep for backwards compatibility)
  vegetationOverrides  // NEW: Pass advanced overrides
);
```

### 4. Include Override Panel in UI

```tsx
{vegetationAnalysis && (
  <VegetationOverridePanel
    totalDistance={fireBreakDistance}
    segments={vegetationAnalysis.segments}
    overrides={vegetationOverrides}
    onOverridesChange={setVegetationOverrides}
  />
)}
```

---

## Utility Functions

### getEffectiveVegetation()
Determine the vegetation type for a position, considering overrides.

```typescript
import { getEffectiveVegetation } from './types/vegetationOverrides';

const effectiveVeg = getEffectiveVegetation(
  distance,                    // Distance along route (meters)
  defaultVegetation,           // Auto-detected type
  vegetationOverrides          // User overrides
);
```

### mergeSegmentOverrides()
Add or replace overlapping segment overrides.

```typescript
import { mergeSegmentOverrides } from './types/vegetationOverrides';

const updated = mergeSegmentOverrides(
  newOverride,                 // New override to add
  existingOverrides,           // Current overrides
  'replace'                    // 'replace' | 'merge'
);
```

### removeSegmentOverride()
Remove a segment override by index.

```typescript
const updated = removeSegmentOverride(index, segmentOverrides);
```

### getTotalOverriddenDistance()
Calculate total distance covered by overrides.

```typescript
const distance = getTotalOverriddenDistance(segmentOverrides);
const percent = (distance / totalDistance) * 100;
```

### findOverlappingSegments()
Find existing overrides that overlap a range.

```typescript
const overlapping = findOverlappingSegments(
  start,
  end,
  existingOverrides
);
```

---

## Workflow Examples

### Example 1: User Knows Entire Route is Recently Cleared

```
1. User draws route
2. NVIS detects mostly "mediumscrub" (average confidence 0.65)
3. User checks "Vegetation Overrides"
4. User selects "Grassland" from route-level dropdown
5. User adds note: "Recent clearing - on-site knowledge"
6. Analysis now treats entire route as grassland
7. Fire break production estimates updated accordingly
```

### Example 2: Mixed Vegetation with Patches

```
1. User draws 2000m route
2. NVIS detects:
   - 0-800m: Light shrub
   - 800-1500m: Medium scrub
   - 1500-2000m: Grassland
3. User adds segment overrides:
   - 300-800m: Heavy forest (recent regrowth)
   - 1200-1400m: Grassland (recent fire)
4. Effective vegetation becomes:
   - 0-300m: Light shrub (auto-detected)
   - 300-800m: Heavy forest (OVERRIDE)
   - 800-1200m: Medium scrub (auto-detected)
   - 1200-1400m: Grassland (OVERRIDE)
   - 1400-2000m: Grassland (auto-detected)
5. Analysis uses this mixed profile
```

### Example 3: Disable During Review

```
1. User creates route with overrides enabled
2. During review, wants to compare against auto-detected
3. User unchecks enable toggle
4. Analysis reverts to NVIS/state data temporarily
5. User re-enables to confirm overrides should apply
```

---

## Confidence Scoring

### Auto-Detected (No Override)
```
confidence = NVIS/state service confidence
Range: 0.3 - 0.95 depending on data quality
```

### User Override (Segment-Level or Route-Level)
```
confidence = 1.0 (maximum)
Rationale: User has asserted explicit knowledge
```

### Fallback (Mapbox/Mock)
```
confidence = 0.4 - 0.7 (low-medium)
When state/NVIS queries fail
```

---

## Data Persistence

### Sharing Routes with Overrides
When saving/sharing a route plan:

```json
{
  "id": "route-123",
  "lineCoords": [...],
  "trackAnalysis": {...},
  "vegetationAnalysis": {...},
  "vegetationOverrides": {
    "isEnabled": true,
    "routeOverride": null,
    "segmentOverrides": [
      {
        "startDistance": 300,
        "endDistance": 800,
        "vegetation": "heavyforest",
        "note": "Recent regrowth confirmed on-site"
      }
    ]
  }
}
```

### Backwards Compatibility
If a saved route doesn't have `vegetationOverrides`, it defaults to:
```json
{
  "isEnabled": false,
  "segmentOverrides": []
}
```

---

## Testing

### Unit Tests
Test utility functions for correctness:
```bash
# Check getEffectiveVegetation() logic
# Check overlap detection and merging
# Check distance calculations
```

### Integration Tests
1. Draw route with auto-detected vegetation
2. Enable overrides and set route-level override
3. Verify analysis uses override
4. Add segment-level override
5. Verify segment takes precedence
6. Disable overrides
7. Verify analysis reverts to auto-detected

### Edge Cases
- [ ] Empty segments
- [ ] Overlapping overrides (merge vs. replace)
- [ ] Overrides beyond route distance
- [ ] Zero-length segments
- [ ] Persistence across share/restore cycles

---

## Future Enhancements

### Phase 2 (Future)
- [ ] Visual override tool (click-to-edit on map visualization)
- [ ] Batch segment operations (select multiple, apply override)
- [ ] Undo/redo for overrides
- [ ] Override templates (save/load common patterns)
- [ ] Confidence suggestions based on recent local changes

### Phase 3 (Future)
- [ ] Override history and audit log
- [ ] Collaboration: note which team member set override
- [ ] Integration with external datasources (fire history, management records)
- [ ] ML-assisted suggestions ("this region was recently burned, likely grassland")

---

## Implementation Checklist

- [x] Create type definitions (`vegetationOverrides.ts`)
- [x] Implement utility functions
- [x] Create UI component (`VegetationOverridePanel.tsx`)
- [x] Update route profile builder (`routeProfile.ts`)
- [x] Build and verify no TypeScript errors
- [ ] Integrate panel into App.tsx
- [ ] Add state management for overrides
- [ ] Connect to route sharing/persistence
- [ ] Update backend API if needed (for persisting overrides)
- [ ] Add user documentation
- [ ] Test override logic with real routes
- [ ] Deploy to staging/production

---

## Files

| File | Purpose | Status |
|------|---------|--------|
| `types/vegetationOverrides.ts` | Data model and utilities | ✅ Done |
| `components/VegetationOverridePanel.tsx` | UI component | ✅ Done |
| `components/VegetationOverridePanel.css` | Component styling | ✅ Done |
| `utils/routeProfile.ts` (updated) | Apply overrides in analysis | ✅ Done |
| `App.tsx` (needs update) | Integrate component and state | ⏳ Next |

---

## Notes for Developers

### When Adding New Vegetation Types
If you add a new VegetationType (e.g., 'barren'), also update:
- `VEGETATION_OPTIONS` in VegetationOverridePanel.tsx (add color)
- Any type-specific logic in override functions

### Performance Considerations
- Override lookup is O(n) where n = number of segment overrides
- For typical routes (5-20 segments), this is negligible
- If routes have 100+ override segments, consider indexing

### State Management
Consider Redux/Zustand if app state gets complex. For now, useState + context is sufficient.

### Testing Data
Create test routes with:
- Various vegetation type combinations
- Overlapping overrides (test merge behavior)
- Boundary conditions (0m, max distance)
- Empty overrides (verify no regressions)
