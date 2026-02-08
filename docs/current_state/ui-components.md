# UI Components Inventory

**Last Updated**: February 8, 2026

This document catalogs all React components in the Fire Break Calculator application.

## Component Status Legend

| Status | Description |
|--------|-------------|
| ✅ Stable | Production-ready, well-tested |
| 🚧 Needs Work | Functional but requires improvements |
| ⚠️ Has Issues | Has known bugs or accessibility issues |
| 📋 Planned | Not yet implemented |

## Application Structure

### Core Application Components

| Component | Path | Status | Purpose | Issues/Notes |
|-----------|------|--------|---------|--------------|
| App | `webapp/src/App.tsx` | ✅ | Root application component | Main layout orchestrator |
| MapboxMapView | `webapp/src/components/MapboxMapView.tsx` | ✅ | Map container and controls | Core mapping functionality |
| AnalysisPanel | `webapp/src/components/AnalysisPanel.tsx` | 🚧 | Results display panel | Fixed height on mobile causes scrolling |
| IntegratedConfigPanel | `webapp/src/components/IntegratedConfigPanel.tsx` | 🚧 | Configuration sidebar | Complex nested tabs |

### Configuration Components

| Component | Path | Status | Purpose | Issues/Notes |
|-----------|------|--------|---------|--------------|
| EquipmentConfigPanel | `webapp/src/components/EquipmentConfigPanel.tsx` | ⚠️ | Equipment management | No delete confirmation |
| VegetationConfigPanel | `webapp/src/components/VegetationConfigPanel.tsx` | ⚠️ | Vegetation mapping config | No delete confirmation, complex hierarchy |
| SearchControl | `webapp/src/components/SearchControl.tsx` | ✅ | Equipment search | Three search modes |

### Display Components

| Component | Path | Status | Purpose | Issues/Notes |
|-----------|------|--------|---------|--------------|
| EquipmentResults | `webapp/src/components/EquipmentResults.tsx` | ✅ | Equipment analysis results | - |
| OverlapMatrix | `webapp/src/components/OverlapMatrix.tsx` | 🚧 | Terrain/vegetation distribution | Requires scrolling on mobile |
| GuidancePanel | `webapp/src/components/GuidancePanel.tsx` | ✅ | Help and instructions | - |

## Planned Components (from UI_REDESIGN_PLAN.md)

### Phase 1: Critical Components

| Component | Purpose | Priority | Complexity | Status | Target |
|-----------|---------|----------|------------|--------|--------|
| ConfirmDialog | Delete confirmations | Critical | Low | 📋 | ASAP |

### Phase 2: Design System Components

| Component | Purpose | Priority | Complexity | Status | Target |
|-----------|---------|----------|------------|--------|--------|
| Button | Standardized button | High | Low | 📋 | Q2 2026 |
| Skeleton | Loading placeholders | High | Low | 📋 | Q2 2026 |

### Phase 3: UX Enhancement Components

| Component | Purpose | Priority | Complexity | Status | Target |
|-----------|---------|----------|------------|--------|--------|
| Toast | Notifications | Medium | Medium | 📋 | Q2 2026 |
| ToastContainer | Toast manager | Medium | Medium | 📋 | Q2 2026 |
| DrawingHelpOverlay | Gesture instructions | Medium | Low | 📋 | Q2 2026 |
| PresetManager | Equipment presets | Medium | Medium | 📋 | Q3 2026 |

### Phase 4: Polish Components

| Component | Purpose | Priority | Complexity | Status | Target |
|-----------|---------|----------|------------|--------|--------|
| KeyboardShortcuts | Shortcut modal | Low | Medium | 📋 | Q3 2026 |
| ThemeToggle | Dark/light mode | Low | Medium | 📋 | Q3 2026 |

## Component Architecture Notes

### Props Patterns
- Most components use props for configuration
- State lifted to parent components when shared
- Context API not currently used (may be needed for theme)

### Styling Approach
- Component styles in `webapp/src/styles.css` and `webapp/src/styles-config.css`
- No CSS modules or styled-components
- Global CSS with BEM-like naming conventions
- Design tokens planned for Phase 2

### State Management
- React hooks (useState, useEffect, useRef)
- No Redux or external state management
- Local component state where possible
- Props for parent-child communication

## Component Dependencies

### External Libraries
| Library | Version | Used By | Purpose |
|---------|---------|---------|---------|
| react | 18.3.1 | All components | Core framework |
| mapbox-gl | 3.18.1 | MapboxMapView | Map rendering |
| @mapbox/mapbox-gl-draw | 1.5.1 | MapboxMapView | Drawing tools |
| leaflet | - | (legacy) | Being phased out |

### Internal Dependencies
- **EquipmentConfigPanel** → SearchControl, EquipmentList
- **AnalysisPanel** → EquipmentResults, OverlapMatrix, GuidancePanel
- **IntegratedConfigPanel** → EquipmentConfigPanel, VegetationConfigPanel

## Accessibility Status by Component

| Component | ARIA Labels | Keyboard Nav | Focus Mgmt | Touch Targets | Status |
|-----------|-------------|--------------|------------|---------------|--------|
| App | ⚠️ Missing | ✅ Basic | ⚠️ Partial | N/A | Needs Work |
| MapboxMapView | ✅ Present | ✅ Good | ✅ Good | ⚠️ Small icons | Mostly Good |
| AnalysisPanel | ⚠️ Incomplete | ✅ Basic | ⚠️ None | ✅ Adequate | Needs Work |
| IntegratedConfigPanel | ⚠️ Incomplete | ✅ Basic | ⚠️ Partial | ⚠️ Too Small | Needs Work |
| EquipmentConfigPanel | ⚠️ Incomplete | ✅ Basic | ⚠️ None | ❌ Too Small | Critical |
| VegetationConfigPanel | ⚠️ Incomplete | ✅ Basic | ⚠️ None | ❌ Too Small | Critical |
| SearchControl | ✅ Good | ✅ Good | ✅ Good | ✅ Adequate | Good |

### Specific Accessibility Issues

**Critical Issues:**
- Equipment tag buttons: ~24×16px (need 44×44px)
- Formation expand icons: ~12×12px (need 44×44px)
- Equipment delete buttons: ~24px (need 44×44px)
- No confirmation dialogs for destructive actions

**High Priority:**
- Missing ARIA landmarks (main, complementary, navigation)
- No `aria-selected` on tabs
- No `aria-expanded` on collapsible sections
- Focus not managed when opening/closing panels
- Color contrast on hover states: 3.2:1 (needs 4.5:1)

**Medium Priority:**
- Placeholder text as primary labels
- No `aria-live` for dynamic updates
- Missing `aria-busy` indicators
- Inconsistent heading hierarchy

## Component Complexity Analysis

### High Complexity Components (>300 lines)
1. **EquipmentConfigPanel** (~400 lines)
   - Multiple nested states
   - Inline editing logic
   - CRUD operations
   - Tag management
   - Recommendation: Consider splitting into subcomponents

2. **VegetationConfigPanel** (~350 lines)
   - Three-level hierarchy management
   - Complex state updates
   - Nested UI patterns
   - Recommendation: Extract hierarchy logic to custom hook

3. **MapboxMapView** (~500 lines)
   - Map initialization
   - Drawing controls
   - Event handling
   - Multiple layers
   - Recommendation: Extract drawing logic to separate module

### Medium Complexity (150-300 lines)
- IntegratedConfigPanel
- AnalysisPanel
- EquipmentResults

### Low Complexity (<150 lines)
- SearchControl
- GuidancePanel
- OverlapMatrix

## Performance Notes

### Optimization Opportunities
1. **MapboxMapView**: Memoize map instance and controls
2. **EquipmentResults**: Virtualize long lists if >50 items
3. **OverlapMatrix**: Consider lazy rendering for large matrices
4. **General**: Add React.memo for pure components

### Current Performance
- Initial load: Good (<2s on broadband)
- Map interaction: Excellent (60fps)
- Panel switching: Good (no lag)
- Large equipment lists: Adequate (may slow with >100 items)

## Testing Status

| Component | Unit Tests | Integration Tests | E2E Tests | Coverage |
|-----------|------------|-------------------|-----------|----------|
| App | ⚠️ Minimal | ❌ None | ⚠️ Basic | Low |
| MapboxMapView | ❌ None | ❌ None | ⚠️ Basic | None |
| AnalysisPanel | ⚠️ Minimal | ❌ None | ⚠️ Basic | Low |
| IntegratedConfigPanel | ❌ None | ❌ None | ❌ None | None |
| EquipmentConfigPanel | ❌ None | ❌ None | ❌ None | None |
| VegetationConfigPanel | ❌ None | ❌ None | ❌ None | None |

**Overall Test Coverage**: Estimated <20%
**Recommendation**: Add component tests for critical user paths

## Refactoring Opportunities

### High Priority
1. **Extract Design Token System** (Phase 2)
   - Create `design-tokens.css`
   - Replace hardcoded colors/spacing
   - Enable theming

2. **Create Reusable Button Component** (Phase 2)
   - Standardize 6 different button styles
   - Ensure WCAG AA compliance
   - Support all sizes and variants

3. **Add Confirmation Dialog** (Phase 1)
   - Critical safety feature
   - Reusable across components

### Medium Priority
1. **Split Large Components**
   - EquipmentConfigPanel → Equipment list subcomponent
   - VegetationConfigPanel → Hierarchy tree subcomponent
   - MapboxMapView → Drawing tools module

2. **Extract Custom Hooks**
   - useToast (Phase 3)
   - useLocalStorage (for presets)
   - useKeyboardShortcuts (Phase 4)

3. **Improve Type Definitions**
   - Create shared interfaces file
   - Reduce `any` types
   - Add JSDoc comments

### Low Priority
1. **Add Component Stories** (Storybook)
2. **Extract Common Patterns** (HOCs or render props)
3. **Add Error Boundaries**

## Component Documentation Status

| Component | JSDoc | Props Documented | Examples | README |
|-----------|-------|------------------|----------|--------|
| App | ❌ | ❌ | ❌ | ❌ |
| MapboxMapView | ⚠️ Partial | ⚠️ Partial | ❌ | ❌ |
| AnalysisPanel | ❌ | ❌ | ❌ | ❌ |
| IntegratedConfigPanel | ❌ | ❌ | ❌ | ❌ |
| EquipmentConfigPanel | ❌ | ❌ | ❌ | ❌ |
| VegetationConfigPanel | ❌ | ❌ | ❌ | ❌ |

**Recommendation**: Add JSDoc comments and prop type documentation for all components

---

**Maintenance Notes**:
- Update after adding new components
- Review accessibility status quarterly
- Track component complexity growth
- Document breaking changes
