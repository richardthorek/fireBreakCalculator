# Technical Debt & Improvement Areas

**Last Updated**: February 8, 2026

This document tracks known technical debt, code quality issues, and areas for improvement in the Fire Break Calculator project.

## Technical Debt Categories

### Critical (Security/Data Loss Risk)
Issues that could lead to security vulnerabilities or data loss.

### High (User Experience Impact)
Issues that significantly affect usability or accessibility.

### Medium (Code Quality)
Issues that affect maintainability or performance.

### Low (Nice to Have)
Minor improvements or optimizations.

---

## Critical Priority

### 1. No Confirmation Dialogs for Destructive Actions
**Category**: Data Safety
**Impact**: Users can accidentally delete equipment or vegetation mappings with one click
**Location**: `EquipmentConfigPanel.tsx`, `VegetationConfigPanel.tsx`
**Risk**: Data loss without recovery
**Fix**: Implement ConfirmDialog component (UI_REDESIGN_PLAN Phase 1.1)
**Estimated Effort**: 4-8 hours
**Issue**: TBD

### 2. Mock Elevation Data
**Category**: Data Accuracy
**Impact**: Slope analysis not based on real terrain data
**Location**: Elevation service (mock implementation)
**Risk**: Inaccurate planning recommendations
**Fix**: Integrate real DEM or elevation API
**Estimated Effort**: 2-3 weeks
**Issue**: See master_plan.md roadmap

---

## High Priority

### 3. WCAG AA Accessibility Compliance Gaps
**Category**: Accessibility
**Impact**: Barriers for users with disabilities
**Issues**:
- Touch targets below 44×44px minimum
- Color contrast ratios < 4.5:1 in some areas
- Missing ARIA landmarks and labels
- No focus management
- No `prefers-reduced-motion` support

**Location**: Multiple components
**Fix**: See UI_REDESIGN_PLAN Phase 1 (items 1.2-1.5)
**Estimated Effort**: 1-2 weeks
**Issue**: TBD

### 4. Inconsistent Design System
**Category**: UI/UX Consistency
**Impact**: Unprofessional appearance, user confusion
**Issues**:
- 6+ different button styles
- 10+ shades of gray for borders/backgrounds
- Font sizes from 0.5rem to 1.6rem with no system
- Spacing inconsistency (2px, 3px, 4px, 6px, 8px, 12px)

**Location**: `styles.css`, `styles-config.css`, multiple components
**Fix**: Implement design token system (UI_REDESIGN_PLAN Phase 2)
**Estimated Effort**: 1-2 weeks
**Issue**: TBD

### 5. No Test Coverage
**Category**: Code Quality
**Impact**: Risk of regressions, difficult to refactor
**Current Coverage**: <20% estimated
**Location**: All components
**Fix**: Add unit and integration tests
**Estimated Effort**: Ongoing
**Issue**: TBD

### 6. Large Component Files
**Category**: Maintainability
**Impact**: Difficult to understand and modify
**Examples**:
- MapboxMapView: ~500 lines
- EquipmentConfigPanel: ~400 lines
- VegetationConfigPanel: ~350 lines

**Fix**: Split into smaller, focused components
**Estimated Effort**: 1 week per component
**Issue**: TBD

---

## Medium Priority

### 7. No Error Boundaries
**Category**: Error Handling
**Impact**: Entire app crashes on component errors
**Location**: App root
**Fix**: Add React Error Boundaries
**Estimated Effort**: 4-8 hours
**Issue**: TBD

### 8. Hardcoded Strings (No i18n)
**Category**: Internationalization
**Impact**: Cannot support multiple languages
**Location**: All components
**Fix**: Extract strings to i18n library
**Estimated Effort**: 1-2 weeks
**Issue**: Future consideration

### 9. No Loading Skeletons
**Category**: UX
**Impact**: Content jumps, poor perceived performance
**Location**: Analysis panel, config panels
**Fix**: Implement Skeleton component (UI_REDESIGN_PLAN Phase 2.5)
**Estimated Effort**: 1 week
**Issue**: TBD

### 10. Limited TypeScript Strictness
**Category**: Type Safety
**Impact**: Potential runtime errors
**Issues**:
- Some `any` types
- Missing interface definitions
- Inconsistent prop typing

**Location**: Multiple files
**Fix**: Enable stricter TypeScript, add proper types
**Estimated Effort**: Ongoing
**Issue**: TBD

### 11. No User Feedback for Async Operations
**Category**: UX
**Impact**: Users unsure if actions succeeded
**Location**: Save/delete operations in config panels
**Fix**: Implement Toast notification system (UI_REDESIGN_PLAN Phase 3.1)
**Estimated Effort**: 1 week
**Issue**: TBD

### 12. Emoji Icons Not Reliable
**Category**: UI Consistency
**Impact**: Icons render differently across platforms
**Location**: Equipment types, buttons
**Fix**: Replace with icon library (Font Awesome, Material Icons)
**Estimated Effort**: 3-5 days
**Issue**: TBD

### 13. No Undo/Redo for Drawing
**Category**: UX
**Impact**: Users must redraw entire fire break on mistake
**Location**: MapboxMapView
**Fix**: Implement drawing history and undo/redo
**Estimated Effort**: 1-2 weeks
**Issue**: Future enhancement

---

## Low Priority

### 14. No Component Documentation
**Category**: Documentation
**Impact**: Difficult for new contributors
**Location**: All components
**Fix**: Add JSDoc comments and prop documentation
**Estimated Effort**: Ongoing
**Issue**: TBD

### 15. No Storybook or Component Library
**Category**: Development Experience
**Impact**: Harder to develop components in isolation
**Fix**: Set up Storybook
**Estimated Effort**: 1 week
**Issue**: Future consideration

### 16. No Performance Monitoring
**Category**: Performance
**Impact**: Cannot track performance regressions
**Fix**: Add performance monitoring (Web Vitals, etc.)
**Estimated Effort**: 1 week
**Issue**: Future consideration

### 17. No E2E Test Suite
**Category**: Testing
**Impact**: Cannot test full user flows automatically
**Fix**: Implement Playwright or Cypress tests
**Estimated Effort**: 2-3 weeks
**Issue**: Future consideration

### 18. CSS Not Organized by Component
**Category**: Code Organization
**Impact**: Hard to find relevant styles
**Location**: `styles.css`, `styles-config.css`
**Fix**: Consider CSS modules or styled-components
**Estimated Effort**: 2-3 weeks (large refactor)
**Issue**: Future consideration

### 19. No Build Optimization Analysis
**Category**: Performance
**Impact**: Bundle may be larger than necessary
**Fix**: Run bundle analyzer, implement code splitting
**Estimated Effort**: 1 week
**Issue**: Future consideration

### 20. No Automated Dependency Updates
**Category**: Maintenance
**Impact**: Dependencies can become outdated
**Fix**: Set up Dependabot (mentioned in master_plan.md)
**Estimated Effort**: 2-4 hours
**Issue**: TBD

---

## Architecture Improvements

### API Layer
- **Issue**: No API client abstraction
- **Impact**: API calls scattered throughout components
- **Fix**: Create centralized API service layer
- **Effort**: 1-2 weeks

### State Management
- **Issue**: Props drilling in deep component trees
- **Impact**: Difficult to manage shared state
- **Fix**: Consider Context API or lightweight state manager
- **Effort**: 1 week

### Data Validation
- **Issue**: Limited client-side validation
- **Impact**: Invalid data can reach API
- **Fix**: Implement validation library (Zod, Yup)
- **Effort**: 1 week

---

## Performance Debt

### Bundle Size
- **Current**: Not measured
- **Target**: <500KB initial bundle
- **Actions**: Analyze, implement code splitting, tree shaking

### Render Performance
- **Issue**: No memoization of expensive operations
- **Impact**: Potential unnecessary re-renders
- **Fix**: Add React.memo, useMemo, useCallback strategically
- **Effort**: Ongoing

### Map Performance
- **Current**: Generally good
- **Concerns**: Large polylines, many markers
- **Actions**: Monitor and optimize if needed

---

## Security Considerations

### API Keys
- **Status**: ✅ Mapbox token in environment variables
- **Concern**: Ensure no secrets in code
- **Action**: Regular security audits

### Input Sanitization
- **Status**: ⚠️ Limited
- **Concern**: XSS vulnerabilities
- **Action**: Implement input sanitization for user text

### HTTPS Enforcement
- **Status**: ✅ Azure Static Web Apps enforces HTTPS
- **Action**: Ensure all external resources use HTTPS

### Dependency Vulnerabilities
- **Status**: ✅ 0 vulnerabilities (as of Feb 2026)
- **Action**: Regular `npm audit` runs

---

## Documentation Debt

### Missing Documentation
- [ ] API endpoint documentation
- [ ] Component API documentation
- [ ] Architecture decision records (ADRs)
- [ ] Deployment runbook
- [ ] Troubleshooting guide

### Outdated Documentation
- [ ] Review all docs for accuracy quarterly
- [ ] Update screenshots after UI changes
- [ ] Verify external links still work

---

## Debt Paydown Strategy

### Quarterly Goals
**Q2 2026**: Phase 1 Critical Fixes (accessibility, confirmations)
**Q3 2026**: Phase 2 Design System Implementation
**Q4 2026**: Testing infrastructure and coverage improvement
**Q1 2027**: Performance optimization and monitoring

### Continuous Improvements
- Add tests for all new features
- Document new components
- Refactor when touching existing code
- Keep dependencies up to date

### Debt Review Process
- Monthly review of this document
- Prioritize based on user impact
- Track progress in issues/PRs
- Celebrate debt reduction!

---

## Metrics to Track

### Code Quality Metrics
- Test coverage %
- TypeScript strict mode violations
- ESLint warnings/errors
- Duplicate code blocks

### Performance Metrics
- Bundle size
- Time to Interactive (TTI)
- Lighthouse scores
- Core Web Vitals

### Accessibility Metrics
- WCAG AA compliance %
- Keyboard navigation coverage
- Screen reader compatibility

---

**Maintenance Notes**:
- Review and update monthly
- Link to created issues as debt is addressed
- Archive resolved items to separate "Resolved Technical Debt" document
- Celebrate wins when debt is paid down!
