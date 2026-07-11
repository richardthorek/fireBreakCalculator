# State-Based Vegetation Data Sources for Australia

**Status**: Research document identifying authoritative vegetation databases by state  
**Date**: 2026-07-11

## Goal
Replace NVIS-only fallback with a prioritized state-based data strategy, using each state's native vegetation database (like NSW SVTM PCT) for higher fidelity.

---

## Current Implementation
- **NSW**: ✅ Using SVTM_NSW_Extant_PCT (high-fidelity, ~25m resolution)
- **Other states**: ❌ Fall back to NVIS (100m, lower fidelity)

## Identified State Data Sources

### 1. New South Wales ✅ (IMPLEMENTED)
**Data**: SVTM_NSW_Extant_PCT (State Vegetation Type Mapping)  
**Provider**: NSW Department of Planning, Environment and Biodiversity  
**Type**: Plant Community Type (PCT) polygons  
**Resolution**: ~25 m grid equivalent  
**Coverage**: Entire NSW  
**Endpoint**: 
```
https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/VIS/SVTM_NSW_Extant_PCT/MapServer
```
**Layer ID**: 3 (PCT data)  
**Confidence**: HIGH (already in use)  
**Note**: This is the gold standard we're using — maintain this priority.

---

### 2. Victoria 🔍 (RESEARCH NEEDED)
**Candidate Data**: 
- Victorian Vegetation Quality Assessment (VVQA)
- Biodiversity Assessment and Planning Tool (BAPt) vegetation layers
- VicMap — Victorian cadastral and vegetation data

**Provider**: Department of Environment and Biodiversity (Victoria)  
**Status**: Likely available via ArcGIS REST service  
**Resolution**: Estimated ~25-50 m  
**Coverage**: Entire Victoria  

**Action Items**:
- [ ] Verify VVQA or BAPt are publicly queryable via ArcGIS
- [ ] Document endpoint and layer ID
- [ ] Test query performance and result quality
- [ ] Map Victoria vegetation classes to our 4-class fuel taxonomy

**Suggested Endpoint** (to verify):
```
https://mapshare.vic.gov.au/arcgis/rest/services/...
```

---

### 3. Queensland 🔍 (RESEARCH NEEDED)
**Candidate Data**:
- Queensland Herbarium vegetation classification
- Vegetation Management Framework (VMF) remnant vegetation layer
- Queensland Vegetation Classification Framework

**Provider**: Department of Resources, Queensland Government  
**Status**: Likely available via ArcGIS or WFS  
**Resolution**: Estimated ~25 m  
**Coverage**: Entire Queensland  

**Action Items**:
- [ ] Identify public-facing ArcGIS endpoint for QLD vegetation
- [ ] Determine layer structure and attribute names
- [ ] Test coverage for inland/remote regions (Central QLD was patchy in NVIS)
- [ ] Map QLD vegetation classes to fuel taxonomy

**Note**: Central QLD had 67% query success with NVIS; state data should improve this.

---

### 4. Western Australia 🔍 (RESEARCH NEEDED)
**Candidate Data**:
- Southwest Australia Floristic Region (SWAFR) Vegetation
- Department of Biodiversity, Conservation and Attractions (DBCA) mapping
- Native Vegetation Integrated Monitoring System (NVIMS)

**Provider**: Department of Biodiversity, Conservation and Attractions, WA  
**Status**: Likely available via ArcGIS  
**Resolution**: Estimated ~25-50 m  
**Coverage**: Entire WA  

**Action Items**:
- [ ] Locate public ArcGIS service for WA vegetation
- [ ] Verify WA has consistent vegetation classification across coastal/inland regions
- [ ] Map WA vegetation formations to fuel taxonomy

---

### 5. South Australia 🔍 (RESEARCH NEEDED)
**Candidate Data**:
- South Australian Native Vegetation Council (NVC) mapping
- SA Vegetation Monitoring Program
- Statewide Vegetation-Landuse Mapping (SVLM)

**Provider**: Department for Environment and Water, South Australia  
**Status**: Likely available via ArcGIS or WFS  
**Resolution**: Estimated ~25 m  
**Coverage**: Entire SA  

**Action Items**:
- [ ] Identify SA public vegetation data endpoint
- [ ] South Australia showed low confidence (0.6) in coastal heathland — verify state data improves this
- [ ] Map SA vegetation classes to fuel taxonomy

---

### 6. Tasmania 🔍 (RESEARCH NEEDED)
**Candidate Data**:
- Tasmanian Vegetation Monitoring and Mapping Program (TVMMP)
- Tasmanian Grassland Monitoring
- Natural Values Atlas vegetation layers

**Provider**: Department of State Growth, Tasmania  
**Status**: Likely available via WFS or ArcGIS  
**Resolution**: Estimated ~25 m  
**Coverage**: Entire Tasmania  

**Action Items**:
- [ ] Identify Tasmania public vegetation endpoint
- [ ] Tasmania showed good diversity (0.792) in test — verify state data maintains/improves this
- [ ] Map Tasmanian vegetation formations to fuel taxonomy

---

### 7. Australian Capital Territory 🔍 (RESEARCH NEEDED)
**Candidate Data**:
- ACT Vegetation Monitoring Program
- ACT Native Grassland and Woodland Mapping

**Provider**: ACT Directorate of Environment, Planning and Land Management  
**Status**: Coverage may be limited; NVIS fallback acceptable  
**Resolution**: Estimated ~25-50 m  
**Coverage**: ACT only (small area)  

**Action Items**:
- [ ] Determine if dedicated ACT service exists
- [ ] If not, NVIS fallback is reasonable for small territory
- [ ] Priority: LOWER than other states

---

### 8. Northern Territory 🔍 (RESEARCH NEEDED)
**Candidate Data**:
- NT Vegetation Information System
- Remote Sensing Laboratory vegetation mapping
- NT Land Management Framework

**Provider**: Northern Territory Parks and Wildlife Commission  
**Status**: Coverage may be limited; NVIS fallback acceptable  
**Resolution**: Estimated variable (some regions sparse)  
**Coverage**: Entire NT, but data quality varies  

**Action Items**:
- [ ] Identify NT public vegetation service
- [ ] Note: NT tested region (Savanna) showed good diversity with NVIS (0.5)
- [ ] Priority: MODERATE (large area, but NVIS performs reasonably)

---

## Implementation Strategy

### Priority Tier 1 (High Fidelity, High Coverage)
1. **NSW** ✅ Already implemented
2. **Victoria** 🔍 High priority (large population, diverse vegetation)
3. **Queensland** 🔍 High priority (large area, mixed results with NVIS)
4. **Western Australia** 🔍 High priority (large area)

### Priority Tier 2 (Medium Fidelity, Medium Coverage)
5. **South Australia** 🔍 Medium priority (showed low confidence with NVIS)
6. **Tasmania** 🔍 Medium priority (works OK with NVIS but can improve)

### Priority Tier 3 (May Use NVIS as Primary)
7. **Northern Territory** — NVIS acceptable, but implement if easy
8. **Australian Capital Territory** — NVIS fallback acceptable (small area)

---

## Proposed Fallback Chain

For any given point (lat, lng):

1. **Determine state/territory** from coordinates
2. **Query state-specific service** (if implemented)
   - NSW → SVTM_NSW_Extant_PCT
   - VIC → Victorian data source (TBD)
   - QLD → Queensland data source (TBD)
   - WA → WA data source (TBD)
   - SA → SA data source (TBD)
   - TAS → Tasmanian data source (TBD)
   - ACT → ACT data source (if exists)
   - NT → NT data source (if exists)
3. **If state service fails/no data**: Fall back to NVIS
4. **If NVIS fails**: Fall back to Mapbox Terrain landcover
5. **If all fail**: Use mock data (flag as estimated)

---

## Technical Implementation

### New Service Structure

```
webapp/src/utils/
├── nswVegetationService.ts        ✅ Existing
├── vicVegetationService.ts         🔧 New
├── qldVegetationService.ts         🔧 New
├── waVegetationService.ts          🔧 New
├── saVegetationService.ts          🔧 New
├── tasVegetationService.ts         🔧 New
├── stateVegetationRouter.ts        🔧 New (orchestrator)
├── nvisVegetationService.ts        (keep as fallback)
└── ...
```

### State Detection Logic
```typescript
function determineState(lat: number, lng: number): State {
  // Use bounding boxes to determine which state/territory
  // Return state ID for fallback chain
}

async function fetchStateVegetation(lat: number, lng: number): Promise<Result | null> {
  const state = determineState(lat, lng);
  
  // Try state-specific service first
  const stateResult = await fetchStateData(state, lat, lng);
  if (stateResult) return stateResult;
  
  // Fall back to NVIS
  const nvisResult = await fetchNVISVegetation(lat, lng);
  if (nvisResult) return nvisResult;
  
  // Fall back to Mapbox
  return fetchMapboxData(lat, lng);
}
```

---

## Research Tasks (Actionable)

### High Priority
- [ ] **Victoria**: Find and document public vegetation ArcGIS endpoint
- [ ] **Queensland**: Identify Vegetation Management Framework (VMF) service
- [ ] **WA**: Locate DBCA native vegetation ArcGIS service
- [ ] **SA**: Find South Australian native vegetation mapping endpoint

### Medium Priority
- [ ] **Tasmania**: Document TVMMP or Tasmanian Atlas service
- [ ] **ACT**: Verify ACT has public vegetation service
- [ ] **NT**: Identify NT vegetation mapping service

### Testing
- [ ] After each state service is implemented, run fidelity test in that state
- [ ] Validate state data provides better diversity scores than NVIS
- [ ] Verify fallback chain works correctly (state → NVIS → Mapbox)

---

## Success Criteria

- [x] NSW maintains current SVTM PCT integration
- [ ] Victoria: Implement state vegetation service
- [ ] Queensland: Implement state vegetation service  
- [ ] WA: Implement state vegetation service
- [ ] SA: Implement state vegetation service
- [ ] Tasmania: Implement state vegetation service
- [ ] Average diversity score improves from 0.453 → 0.55+ (10% improvement)
- [ ] Grassland representation drops from 36.8% → <30%
- [ ] No region with diversity < 0.3 (currently Mallee at 0.0)
- [ ] Coastal Heathland confidence improves from 0.6 → 0.75+

---

## References

- NSW SVTM PCT: https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/VIS/SVTM_NSW_Extant_PCT/MapServer
- NVIS National Service: https://gis.environment.gov.au/gispubmap/rest/services/ogc_services/NVIS_ext_mvg/MapServer
- Australian Government Geoscience Portal: https://www.ga.gov.au/
- Spatial Data Directory: https://ckan.io/ (Australian government data)

---

## Notes for Future Developers

1. **Consistency**: Each state service should return the same interface (vegetationType, confidence, mvgName, source)
2. **Caching**: Implement shared cache layer to reduce duplicate queries across services
3. **Documentation**: Update user-facing docs to explain data sources and region-specific quality
4. **Monitoring**: Track which state services are being used (telemetry) to identify gaps
5. **Graceful Degradation**: Ensure app works even if some state services fail; fall back transparently
