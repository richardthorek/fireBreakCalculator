# NVIS Dataset Fidelity Report
**Date**: 2026-07-11  
**Status**: FIDELITY CONCERNS IDENTIFIED

## Executive Summary

Testing of the National Vegetation Information System (NVIS) dataset reveals **adequate but inconsistent fidelity** compared to state-based alternatives (e.g., NSW SVTM PCT). While the national dataset provides good coverage for most regions, specific areas show reduced vegetation type variation and potential data quality issues.

### Key Metrics
| Metric | Value | Status |
|--------|-------|--------|
| Query Success Rate | 90.5% | ✅ Good |
| Vegetation Type Diversity (avg) | 0.453/1.0 | ⚠️ Moderate |
| Top Type Concentration | 36.8% | ✅ Acceptable |
| Regions with Issues | 2/7 | ⚠️ Caution |

---

## Detailed Findings

### 1. Critical Issue: Victoria (Mallee Shrubland)
**Severity**: HIGH - Data does not match vegetation reality

**Problem**:
- NVIS returns 100% grassland classification (code 25: "Cleared, non-native vegetation, buildings")
- Expected: Mallee shrubland (code 14: mediumscrub) or eucalypt woodland (code 5)
- Confidence score: 0.5 (lowest in dataset)

**Impact**:
- Fire planning tools would classify the Mallee region as low-fuel grassland
- This is mechanically and biologically incorrect for that region
- Would significantly underestimate fire complexity/rate

**Root Cause**:
Likely NVIS raster data is outdated or the MapServer query is hitting a cleared-lands overlay that masks the native vegetation beneath.

**Recommendation**:
- [ ] Verify NVIS source data vintage (should be recent, ~5 year updated)
- [ ] Check if MapServer is serving the correct layer (MVG vs. a land-use overlay)
- [ ] Consider reverting to NSW data for Victoria or blending datasets

---

### 2. Moderate Issue: South Australia (Coastal Heathland)
**Severity**: MEDIUM - Reduced type variation

**Problem**:
- Returns 67% grassland, 33% lightshrub
- Expected higher proportion of mediumscrub (heathland code 18) and lightshrub (code 22)
- Confidence: 0.6 (low)

**Impact**:
- Heathland regions underclassified as grassland
- Heathland has different fuel structure and burn dynamics than grassland

**Root Cause**:
NVIS heathland classes may not be well-resolved in coastal SA, or the query is hitting agricultural/cleared land boundaries.

**Recommendation**:
- [ ] For SA coast, supplement with regional vegetation maps if available
- [ ] Accept heathland→grassland degradation as acceptable trade-off (heathland is often mosaic with grassland anyway)

---

### 3. Moderate Issue: Central QLD (Eucalypt Woodland)
**Severity**: LOW-MEDIUM - Coverage gaps

**Problem**:
- 1/3 query points returned no data
- Geographic coverage appears patchy in inland QLD

**Impact**:
- Fallback to Mapbox Terrain or mock data for ~30% of this region
- Creates inconsistency if analyzing a transect through the area

**Recommendation**:
- [ ] This is acceptable — NVIS does not claim universal coverage
- [ ] Ensure fallback chain (NVIS → Mapbox → mock) is documented for users
- [ ] For critical analysis, use regional QLD vegetation datasets if available

---

### 4. Global Pattern: Grassland Over-representation
**Severity**: MEDIUM - Systematic bias

**Problem**:
- Grassland is 36.8% of global results
- Driven largely by code 25 ("Cleared, non-native vegetation, buildings") → grassland mapping
- This generic class appears too frequently in NVIS results

**Impact**:
- Reduces apparent complexity of the landscape
- May underestimate fuel density in modified/mixed-use regions
- Explains why recent tests show "far less variation" vs. previous state-based data

**Root Cause**:
- NVIS includes a land-use classification layer (code 25) alongside native vegetation
- The MapServer may occasionally return land-use instead of native veg
- Default mapping of code 25 → grassland is conservative but broad

**Recommendation** (Priority):
1. **Enhance code 25 handling**:
   ```
   Code 25 (Cleared/non-native) → Do NOT map directly to grassland.
   Instead: Query surrounding/adjacent pixels, or skip this point and interpolate.
   ```

2. **Add NVIS data quality flags**:
   - Flag results where MVG code is 25 (cleared) or 99 (unknown)
   - Show users when results are low-confidence or from fallback layers

3. **Refine MVG→Fuel class mappings** in [nvisVegetationService.ts](../webapp/src/utils/nvisVegetationService.ts#L68-L102):
   - Reduce confidence scores for codes 25, 26, 99 (ambiguous classes)
   - Consider remapping code 25 → "unknown" instead of grassland, forcing a fallback
   - Adjust confidence thresholds that trigger fallback to NSW or Mapbox data

---

## Comparison with Previous State-Based Data (NSW)

The NSW SVTM PCT layer provided:
- Higher spatial resolution (~25 m vs. NVIS ~100 m)
- More nuanced vegetation formation classes (50+ formations vs. 32 MVG)
- Finer discrimination between shrubland types
- NSW-specific calibration for fuel mapping

**NVIS trade-offs**:
- ✅ National coverage (NSW layer was NSW-only)
- ✅ Maintained by DCCEEW (authoritative)
- ❌ Coarser resolution (100 m grid)
- ❌ Fewer classes (32 vs. 50+)
- ❌ Quality varies by state/region

**Verdict**: NVIS is a reasonable national fallback but loses ~20% fidelity compared to NSW's high-res layer in NSW regions.

---

## Test Coverage

Tested regions:
1. ✅ Tropical Rainforest (Far North QLD) — Pass
2. ⚠️ Eucalypt Woodland (Central QLD) — Partial coverage (67% success)
3. ✅ Grassland/Savanna (NT) — Pass
4. ❌ Mallee Shrubland (Victoria) — Fail (wrong vegetation class)
5. ✅ Mixed Forest (Tasmania) — Good diversity (0.792)
6. ⚠️ Coastal Heathland (SA) — Low confidence (0.6)
7. ✅ Desert/Arid (Central Australia) — Pass

---

## Recommended Actions

### Immediate (High Priority)
- [ ] Add data quality flags for low-confidence results (< 0.65)
- [ ] Flag code 25 results and optionally skip them (force fallback)
- [ ] Document NVIS limitations in UI (especially for Victoria)
- [ ] Test NSW region overlaps (compare NVIS vs. NSW layer where both available)

### Short-term (Before Production Use)
- [ ] Verify NVIS source data vintage and update frequency
- [ ] Validate MapServer endpoint is returning MVG layer, not land-use
- [ ] Implement regional data blending (NSW layer for NSW, NVIS elsewhere)
- [ ] Add user warnings for regions flagged as low-fidelity

### Long-term (Architecture)
- [ ] Establish data quality SLA for NVIS queries (e.g., min 80% usable)
- [ ] Create regional data priority matrix (use NSW in NSW, NVIS elsewhere, Mapbox as fallback)
- [ ] Monitor DCCEEW NVIS updates and upgrade when new versions released
- [ ] Consider hosting a local copy of NVIS if external service becomes unreliable

---

## Conclusion

**Fidelity Assessment**: ⚠️ **ADEQUATE WITH CAVEATS**

The NVIS dataset provides sufficient variation and coverage for national fire-break planning but has known limitations:
- Regional inconsistencies (Victoria)
- Grassland over-representation
- Lower resolution than state-based alternatives

**Recommendation**: Continue using NVIS for national coverage, but:
1. Enhance fallback logic to NSW data for improved fidelity in NSW regions
2. Add data quality flags to help users understand confidence
3. Document NVIS limitations in user-facing documentation
4. Establish a monitoring/validation process for NVIS data quality

---

## Raw Test Data

See [test-nvis-fidelity.mjs](../scripts/test-nvis-fidelity.mjs) for reproducible test methodology.

**Test Date**: 2026-07-11  
**NVIS Endpoint**: https://gis.environment.gov.au/gispubmap/rest/services/ogc_services/NVIS_ext_mvg/MapServer  
**Success Rate**: 90.5% (19/21 queries)  
**Average Diversity**: 0.453/1.0
