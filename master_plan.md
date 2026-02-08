# Fire Break Calculator - Master Plan

**Last Updated**: February 8, 2026
**Document Owner**: Project Maintainers
**Related Documentation**: [.github/copilot-instructions.md](.github/copilot-instructions.md)

---

## ⚠️ MANDATORY WORKFLOW FOR ALL CONTRIBUTORS

### BEFORE Starting Any Work
1. ✅ **READ this entire master_plan.md** - Understand context, goals, current state
2. ✅ **REVIEW the Forward Roadmap** - Find your task, understand acceptance criteria
3. ✅ **CHECK Recent Updates** - Know what was just completed
4. ✅ **VERIFY alignment** - Ensure your work fits the documented vision

### AFTER Completing Any Work
1. ✅ **UPDATE this master_plan.md** - Add dated entry in Recent Updates section
2. ✅ **LINK your PR/issue** - Reference in the relevant roadmap section
3. ✅ **MARK items complete** - Change 📋 Planned to ✅ Complete with date and PR link
4. ✅ **UPDATE architecture** - If you changed technical decisions or structure

### DO NOT Create These
- ❌ Post-work "summary" documents
- ❌ Separate status tracking files  
- ❌ "Current state" reports separate from this plan
- ❌ Duplicate documentation of what's in this master plan

### The ONLY Docs That Matter
1. **THIS FILE** (`master_plan.md`) - Living source of truth, constantly maintained
2. **Machine-readable registers** (when they exist):
   - `docs/api-register.md` - API endpoint catalog (update when API changes)
   - `docs/component-register.md` - Component catalog (update when components change)
3. **Everything else** - Reference only, can be archived

---

## Overview

The Fire Break Calculator Master Plan serves as the **single source of truth** for tracking project vision, major initiatives, technical decisions, and implementation roadmap. This is a **living document** that must be read before starting work and updated after completing work.

### Purpose
- **Track Major Initiatives**: Document significant features, architectural changes, and technical decisions
- **Maintain Project History**: Preserve context and rationale for important decisions  
- **Guide Future Development**: Provide a clear roadmap for upcoming work
- **Enable Collaboration**: Help contributors understand project direction and priorities
- **Eliminate Documentation Sprawl**: One authoritative document instead of scattered status files

### Document Structure
1. **Mandatory Workflow**: How to use this document (above)
2. **Overview**: Purpose and project context (this section)
3. **Goals & Vision**: Long-term objectives and success criteria
4. **Recent Updates**: Completed work and recent milestones (ALWAYS updated after work)
5. **Forward Roadmap**: Planned initiatives with detailed issue descriptions
6. **Project Architecture**: Current technology stack and structure
7. **Acceptance Criteria**: How we measure success
8. **Risks & Mitigation**: Known risks and mitigation strategies
9. **Rollback Plan**: Emergency procedures for major changes
10. **Version Control**: Repository and branch information

### How This Document Works
- **Before Work**: Read it to understand context and avoid duplicate effort
- **During Work**: Reference it for decisions and acceptance criteria
- **After Work**: Update it with what was accomplished, link PRs/issues
- **Always**: This is THE document, not one of many status docs

---

## Goals & Vision

### Project Mission
Empower rural firefighters and emergency response teams with a modern, accessible, and accurate geospatial planning tool for fire break and trail planning, providing instant estimates for time, cost, and resource requirements.

### Strategic Goals

#### 1. Accessibility & Usability (Critical Priority)
- **Goal**: Achieve WCAG 2.1 AA compliance across entire application
- **Rationale**: Ensure all emergency responders can use the tool regardless of ability
- **Success Metric**: Lighthouse accessibility score ≥95, 100% keyboard navigability
- **Timeline**: Q2 2026 (Phase 1)

#### 2. Data Accuracy & Reliability (High Priority)
- **Goal**: Integrate real elevation data for accurate slope analysis
- **Rationale**: Mock data undermines planning confidence and safety
- **Success Metric**: ±5% accuracy on slope calculations vs ground truth
- **Timeline**: Q2 2026

#### 3. Professional UI/UX (High Priority)
- **Goal**: Implement consistent design system and modern UX patterns
- **Rationale**: Professional appearance builds user trust and improves adoption
- **Success Metric**: Unified design tokens, consistent component library
- **Timeline**: Q2-Q3 2026 (Phases 2-3)

#### 4. Mobile-First Experience (Medium Priority)
- **Goal**: Optimize for field use on tablets and smartphones
- **Rationale**: Fire planning often happens in the field, not at desks
- **Success Metric**: Touch-optimized interface, offline capability
- **Timeline**: Q3-Q4 2026

#### 5. Testing & Quality (Medium Priority)
- **Goal**: Establish comprehensive test coverage
- **Rationale**: Prevent regressions, enable confident refactoring
- **Success Metric**: >80% test coverage on critical paths
- **Timeline**: Ongoing, Q4 2026 focus

#### 6. Advanced Features (Long-term)
- **Goal**: AI-powered route optimization, weather integration, analytics
- **Rationale**: Differentiate from basic mapping tools, provide decision support
- **Success Metric**: User adoption of advanced features >50%
- **Timeline**: 2027+

### Non-Goals (Out of Scope)
- Real-time fire tracking (use dedicated fire management systems)
- Multi-user collaboration (single-user tool focus)
- Historical fire data analysis (may reconsider for v2.0)
- Integration with CAD/dispatch systems (future API consideration)

---

## Recent Updates

### February 2026 - Comprehensive Dependency Audit and Upgrade

**Issue Reference:** Conduct full dependency audit and upgrade to latest versions

**Objective:** Modernize all project dependencies to their latest stable versions while maintaining Azure Static Web Apps compatibility and resolving all security vulnerabilities. **Upgraded to Node.js 22.x** as the runtime environment.

#### Node.js Version Upgrade

Node.js: 20.x → 22.x
- Updated GitHub Actions workflow to use Node.js 22.x
- Updated API `.nvmrc` to specify Node 22
- Updated API `package.json` engines field to `>=22.x`
- Created `staticwebapp.config.json` to configure Azure Functions runtime as `node:22`
- Updated API `@types/node` from 20.x to 22.x for TypeScript compatibility
- Verified all dependencies are compatible with Node.js 22.x

#### Changes Implemented

##### Webapp Dependencies (`/webapp`)
- **Vite**: 7.1.4 → 7.3.1
  - Resolved 3 moderate security vulnerabilities (GHSA-g4jq-h2w9-997c, GHSA-jqfw-vq24-v9c3, GHSA-93m4-6634-74q7)
- **mapbox-gl**: 3.14.0 → 3.18.1
  - Latest features and bug fixes for map rendering
- **@mapbox/mapbox-gl-draw**: 1.5.0 → 1.5.1
  - Minor improvements to drawing tools
- **TypeScript**: 5.9.2 → 5.9.3
  - Latest patch release with bug fixes
- **@types/node**: 24.3.1 → 24.10.12
  - Updated type definitions
- **@types/react**: 18.3.24 → 18.3.28
  - Latest React 18 type definitions

**Security Status:** ✅ 0 vulnerabilities

##### API Dependencies (`/api`)
- **@azure/functions**: 4.7.2 → 4.11.2
  - Resolved 2 moderate + 2 high security vulnerabilities (undici, fast-xml-parser, glob)
  - Latest Azure Functions runtime compatibility
- **@azure/data-tables**: 13.3.1 → 13.3.2
  - Latest Azure Table Storage client improvements
- **TypeScript**: 4.9.5 → 5.9.3
  - Major version upgrade (4.x → 5.x) with improved type checking and performance
- **rimraf**: 5.0.10 → 6.1.2
  - Updated file cleanup utility
- **@types/node**: 20.x → 22.x
  - Updated to match Node.js 22 runtime

**Bug Fix:** Updated test script path from `dist/test/e2e.test.js` to `dist/src/test/e2e.test.js` to match TypeScript output structure.

**Security Status:** ✅ 0 vulnerabilities

##### Scripts Dependencies (`/scripts`)
- **@azure/data-tables**: 13.3.1 → 13.3.2
  - Consistency with API version
- **node-fetch**: Maintained at 2.7.0
  - Version 3.x is ESM-only and would break CommonJS scripts
  - Applied npm audit fix to resolve transitive fast-xml-parser vulnerability

**Security Status:** ✅ 0 vulnerabilities

#### Verification Results
- ✅ Webapp builds successfully with all upgraded dependencies
- ✅ Webapp tests pass (machine-compatibility test suite)
- ✅ API builds successfully with TypeScript 5.x

---

## Forward Roadmap

This section documents all planned initiatives. Each item is ready to be converted into a GitHub issue.

**Documentation References**:
- **UI Redesign Details**: [docs/UI_REDESIGN_PLAN.md](docs/UI_REDESIGN_PLAN.md) - Complete implementation specifications
- **UI Audit Findings**: [docs/UI_AUDIT.md](docs/UI_AUDIT.md) - Detailed analysis of current state
- **Component Catalog**: [docs/component-register.md](docs/component-register.md) - Machine-readable component list
- **API Catalog**: [docs/api-register.md](docs/api-register.md) - Machine-readable API endpoint list

### Roadmap Priority Levels
- **P0 - Critical**: Blocking issues, security, data loss risks, accessibility barriers
- **P1 - High**: Major features, significant UX improvements  
- **P2 - Medium**: Enhancements, quality improvements
- **P3 - Low**: Nice-to-have features, polish

---

### Phase 1: Critical Fixes - Accessibility & Safety (P0)
**Target**: Q2 2026 (2-3 weeks) | **Status**: 📋 Planned

**Goal**: Eliminate critical accessibility barriers and data loss risks per WCAG 2.1 AA requirements.

#### 1.1 Add Confirmation Dialogs for Destructive Actions
- **Priority**: P0 | **Effort**: 4-8 hours | **Issue**: TBD
- **Problem**: Single-click deletes equipment/vegetation with no confirmation → data loss risk
- **Solution**: Create `ConfirmDialog` component, add to all delete actions
- **Acceptance**: Dialog with clear message, Cancel/Delete buttons, keyboard accessible, focus trap
- **Files**: Create `ConfirmDialog.tsx`, modify `EquipmentConfigPanel.tsx`, `VegetationConfigPanel.tsx`
- **Reference**: [UI_REDESIGN_PLAN.md Phase 1.1](docs/UI_REDESIGN_PLAN.md)

#### 1.2 Increase Touch Target Sizes to WCAG Minimum
- **Priority**: P0 | **Effort**: 8-12 hours | **Issue**: TBD
- **Problem**: Equipment tags (~24×16px), formation icons (~12×12px) below 44×44px minimum
- **Solution**: Increase all interactive elements to meet 44×44px WCAG requirement
- **Acceptance**: All touch targets ≥44×44px, Lighthouse audit passes, works on mobile/tablet
- **Files**: Modify `styles-config.css`, `styles.css`
- **Reference**: [UI_REDESIGN_PLAN.md Phase 1.2](docs/UI_REDESIGN_PLAN.md)

#### 1.3 Fix Color Contrast for WCAG AA Compliance
- **Priority**: P0 | **Effort**: 4-6 hours | **Issue**: TBD
- **Problem**: Equipment hover (3.2:1) fails WCAG AA 4.5:1 requirement
- **Solution**: Adjust colors to meet 4.5:1 minimum for normal text, 3:1 for large text
- **Acceptance**: All text meets WCAG AA, Lighthouse shows no contrast failures
- **Files**: Modify `styles-config.css`, `styles.css`
- **Reference**: [UI_REDESIGN_PLAN.md Phase 1.3](docs/UI_REDESIGN_PLAN.md)

#### 1.4 Implement Reduced Motion Support
- **Priority**: P0 | **Effort**: 2-4 hours | **Issue**: TBD
- **Problem**: No `prefers-reduced-motion` support, violates WCAG 2.1
- **Solution**: Add media query to disable/minimize animations when preference set
- **Acceptance**: All animations respect reduced motion, pulse animation stops, transitions minimal
- **Files**: Modify `styles.css`
- **Reference**: [UI_REDESIGN_PLAN.md Phase 1.4](docs/UI_REDESIGN_PLAN.md)

#### 1.5 Add ARIA Landmarks and Focus Management
- **Priority**: P0 | **Effort**: 8-12 hours | **Issue**: TBD
- **Problem**: Missing ARIA landmarks, focus not managed on panel open/close
- **Solution**: Add `main`, `complementary` landmarks, manage focus, add `aria-selected`/`aria-expanded`
- **Acceptance**: Screen reader navigable, focus moves/returns properly, NVDA/JAWS tested
- **Files**: Modify `App.tsx`, `IntegratedConfigPanel.tsx`, `EquipmentConfigPanel.tsx`, `VegetationConfigPanel.tsx`
- **Reference**: [UI_REDESIGN_PLAN.md Phase 1.5](docs/UI_REDESIGN_PLAN.md)

---

### Phase 2: Visual Consistency & Polish (P1)
**Target**: Q2 2026 (3-4 weeks) | **Status**: 📋 Planned

**Goal**: Establish consistent design system and professional appearance.

#### 2.1 Create Design Token System
- **Priority**: P1 | **Effort**: 1-2 weeks | **Issue**: TBD
- **Problem**: Inconsistent colors (10+ grays), font sizes (0.5-1.6rem), spacing (2-12px)
- **Solution**: Create `design-tokens.css` with CSS custom properties for colors, typography, spacing
- **Acceptance**: All hardcoded values replaced with tokens, 8px baseline grid, font minimum 0.75rem
- **Files**: Create `design-tokens.css`, modify `styles.css`, `styles-config.css`
- **Reference**: [UI_REDESIGN_PLAN.md Phase 2.1-2.3](docs/UI_REDESIGN_PLAN.md)

#### 2.2 Create Standardized Button Component
- **Priority**: P1 | **Effort**: 1 week | **Issue**: TBD
- **Problem**: 6 different button styles, no consistency
- **Solution**: Create reusable `Button` component with variants (primary, secondary, success, danger, ghost) and sizes
- **Acceptance**: All buttons use component, meet 44×44px minimum, consistent hover effects
- **Files**: Create `Button.tsx`, update all components using buttons
- **Reference**: [UI_REDESIGN_PLAN.md Phase 2.4](docs/UI_REDESIGN_PLAN.md), [component-register.md](docs/component-register.md)

#### 2.3 Add Skeleton Loading States
- **Priority**: P1 | **Effort**: 1 week | **Issue**: TBD
- **Problem**: Emoji spinners, sudden content appearance, poor perceived performance
- **Solution**: Create `Skeleton` component for smooth loading transitions
- **Acceptance**: Skeleton in AnalysisPanel, config panels, respects reduced motion, aria-busy attribute
- **Files**: Create `Skeleton.tsx`, modify `AnalysisPanel.tsx`, `EquipmentConfigPanel.tsx`, `VegetationConfigPanel.tsx`
- **Reference**: [UI_REDESIGN_PLAN.md Phase 2.5](docs/UI_REDESIGN_PLAN.md), [component-register.md](docs/component-register.md)

---

### Phase 3: UX Enhancements (P2)
**Target**: Q2-Q3 2026 (3-4 weeks) | **Status**: 📋 Planned

**Goal**: Add modern UX patterns and user feedback mechanisms.

#### 3.1 Implement Toast Notification System
- **Priority**: P2 | **Effort**: 1 week | **Issue**: TBD
- **Problem**: No feedback for saves, errors not prominent
- **Solution**: Create `Toast`, `ToastContainer`, `useToast()` hook for success/error/warning/info notifications
- **Acceptance**: Auto-dismiss, stackable, accessible (aria-live), keyboard dismissible, used in all CRUD operations
- **Files**: Create `Toast.tsx`, `ToastContainer.tsx`, `useToast.ts`, modify `App.tsx`, config panels
- **Reference**: [UI_REDESIGN_PLAN.md Phase 3.1](docs/UI_REDESIGN_PLAN.md), [component-register.md](docs/component-register.md)

#### 3.2 Add Drawing Gesture Help Overlay
- **Priority**: P2 | **Effort**: 3-5 days | **Issue**: TBD
- **Problem**: Touch gestures unclear, help buried in scrollable content
- **Solution**: Create `DrawingHelpOverlay` shown on first draw with visual instructions
- **Acceptance**: Shows on first draw, localStorage "don't show again", desktop/touch instructions separate
- **Files**: Create `DrawingHelpOverlay.tsx`, modify `MapboxMapView.tsx`, `AnalysisPanel.tsx`
- **Reference**: [UI_REDESIGN_PLAN.md Phase 3.2](docs/UI_REDESIGN_PLAN.md), [component-register.md](docs/component-register.md)

#### 3.3 Add Result Export (PDF/CSV)
- **Priority**: P2 | **Effort**: 1-2 weeks | **Issue**: TBD
- **Problem**: Cannot export analysis for documentation
- **Solution**: Add export dropdown with PDF (full report) and CSV (equipment data) options
- **Acceptance**: PDF includes map, results, matrix; CSV importable to Excel; meaningful filenames
- **Files**: Modify `AnalysisPanel.tsx`, add `jspdf` dependency
- **Reference**: [UI_REDESIGN_PLAN.md Phase 3.3](docs/UI_REDESIGN_PLAN.md), [api-register.md](docs/api-register.md)

#### 3.4 Implement Equipment Presets
- **Priority**: P2 | **Effort**: 1 week | **Issue**: TBD
- **Problem**: Must manually select equipment each time
- **Solution**: Create `PresetManager` to save/load/delete equipment configurations
- **Acceptance**: Save/load/delete presets, localStorage persistence, preset dropdown, max 10 presets
- **Files**: Create `PresetManager.tsx`, modify `AnalysisPanel.tsx`, `EquipmentConfigPanel.tsx`
- **Reference**: [UI_REDESIGN_PLAN.md Phase 3.4](docs/UI_REDESIGN_PLAN.md), [component-register.md](docs/component-register.md)

---

### Phase 4: Polish & Delight (P3)
**Target**: Q3 2026 (2-3 weeks) | **Status**: 📋 Planned

**Goal**: Add micro-interactions and delightful details.

#### 4.1 Add Micro-interactions
- **Priority**: P3 | **Effort**: 3-5 days | **Issue**: TBD
- **Solution**: Button hover lift, equipment row hover, smooth transitions, respects reduced motion
- **Reference**: [UI_REDESIGN_PLAN.md Phase 4.1-4.2](docs/UI_REDESIGN_PLAN.md)

#### 4.2 Add Keyboard Shortcuts
- **Priority**: P3 | **Effort**: 1 week | **Issue**: TBD
- **Solution**: Create `KeyboardShortcuts` modal, implement shortcuts (?, c, h, Enter, Escape)
- **Reference**: [UI_REDESIGN_PLAN.md Phase 4.3](docs/UI_REDESIGN_PLAN.md), [component-register.md](docs/component-register.md)

#### 4.3 Add Dark/Light Mode Toggle
- **Priority**: P3 | **Effort**: 1 week | **Issue**: TBD
- **Solution**: Create `ThemeToggle`, define light theme variables, localStorage + system preference
- **Reference**: [UI_REDESIGN_PLAN.md Phase 4.4](docs/UI_REDESIGN_PLAN.md), [component-register.md](docs/component-register.md)

---

### Long-term Roadmap (2027+)

#### Real Elevation Data Integration (P1)
- **Status**: 📋 Planned Q4 2026
- **Problem**: Mock elevation data undermines accuracy
- **Solution**: Integrate Google Elevation API, SRTM, or Australian Geoscience DEM
- **Reference**: Recent Updates section, README roadmap

#### Route Optimization (P2)
- **Status**: 📋 Planned Q3 2026
- **Solution**: AI-powered route suggestions based on efficiency
- **Reference**: README roadmap

#### Offline Capability (P2)
- **Status**: 📋 Planned Q4 2026
- **Solution**: Service worker, local caching for field use
- **Reference**: README roadmap

#### AI Recommendations, Weather, Analytics (P3)
- **Status**: 📋 Long-term 2027+
- **Reference**: README roadmap

---

### Roadmap Maintenance

**When Creating Issues**:
1. Copy description from roadmap item
2. Link back to this master_plan.md section
3. Add labels: `enhancement`, `ui-ux`, `accessibility`
4. Assign milestone (Q2 2026, etc.)

**When Completing Items**:
1. Update this roadmap: 📋 Planned → ✅ Complete (with date and PR link)
2. Add detailed entry to Recent Updates section
3. Update component-register.md or api-register.md if applicable
4. Add screenshots to docs/screenshots/

**Quarterly Review**:
1. Review relevance of all planned items
2. Adjust priorities based on feedback
3. Update effort estimates
4. Add newly discovered items

---
- ✅ No security vulnerabilities across all packages
- ✅ Compatible with Node.js 20.x (Azure SWA requirement)

#### React 19 Consideration
React 19 was available (19.2.4) but **not upgraded** due to:
- React 19 is relatively new and includes breaking changes
- Current React 18.3.1 is stable and fully functional
- Risk/benefit analysis favors stability for production deployment
- Can be revisited in a future dedicated upgrade once React 19 ecosystem matures

#### Node.js Compatibility
- **Production Environment:** Node.js 22.x (Azure Static Web Apps CI/CD)
- **API Engine Requirement:** `>=22.x` (explicitly configured via staticwebapp.config.json)
- **Azure Functions Runtime:** node:22
- All dependencies confirmed compatible with Node 22.x
- Node.js 22 provides enhanced performance, security updates, and latest V8 JavaScript engine features

#### Dependabot Status
- No specific Dependabot configuration file found in `.github/dependabot.yml`
- Recommendation: Consider adding Dependabot configuration for automated dependency updates
- Suggested configuration would monitor webapp, api, and scripts directories separately

#### Future Considerations
1. **React 19 Migration:** Re-evaluate in Q2 2026 once ecosystem stabilizes
2. **Dependabot Setup:** Add `.github/dependabot.yml` for automated security updates
3. **ESM Migration for Scripts:** Consider converting scripts to ES modules to enable node-fetch 3.x+
4. **Regular Audits:** Schedule quarterly dependency reviews to stay current

---

## Acceptance Criteria

This section defines how we measure success for the project and individual initiatives.

### Project-Level Success Metrics

#### Accessibility (Critical)
- ✅ **WCAG 2.1 AA Compliance**: Lighthouse accessibility score ≥95
- ✅ **Touch Targets**: 100% of interactive elements ≥44×44px
- ✅ **Color Contrast**: All text meets WCAG AA minimum (4.5:1 normal, 3:1 large)
- ✅ **Keyboard Navigation**: 100% functionality accessible via keyboard
- ✅ **Screen Reader**: Full navigation with NVDA/JAWS/VoiceOver
- ✅ **Reduced Motion**: All animations respect `prefers-reduced-motion`

#### User Experience (High Priority)
- ✅ **Design Consistency**: Single design token system, unified visual language
- ✅ **Mobile Optimization**: Touch-optimized interface, ≥44×44px targets
- ✅ **Loading Performance**: Time to Interactive <3s on broadband
- ✅ **User Feedback**: Toast notifications for all CRUD operations
- ✅ **Error Prevention**: Confirmation dialogs for destructive actions

#### Technical Quality (High Priority)
- ✅ **Test Coverage**: ≥80% coverage on critical paths
- ✅ **Type Safety**: TypeScript strict mode, minimal `any` types
- ✅ **Build Quality**: Zero linting errors, zero console warnings in production
- ✅ **Security**: Zero npm audit vulnerabilities
- ✅ **Documentation**: Master plan updated for all major work

#### Data Accuracy (Medium Priority)
- ✅ **Elevation Data**: Real DEM integration (vs mock data)
- ✅ **Vegetation Data**: NSW Government data integrated and current
- ✅ **Calculation Accuracy**: Slope analysis ±5% vs ground truth

### Feature-Level Acceptance Criteria

Each roadmap item includes specific acceptance criteria. General requirements for all features:
- **Functionality**: Feature works as described in all supported browsers/devices
- **Accessibility**: Meets WCAG 2.1 AA standards
- **Performance**: No degradation in Time to Interactive or Core Web Vitals
- **Documentation**: Master plan updated, component/API registers updated if applicable
- **Testing**: Unit tests for logic, accessibility tests for UI
- **Code Quality**: Passes linting, no TypeScript errors, follows existing patterns

---

## Risks & Mitigation Strategies

### Technical Risks

#### Risk 1: Real Elevation Data Integration Complexity
- **Probability**: Medium | **Impact**: High
- **Description**: Integrating real DEM or elevation API may be more complex/expensive than anticipated
- **Mitigation**: 
  - Research multiple providers (Google Elevation API, SRTM, Australian Geoscience)
  - Create cost model before committing
  - Keep mock service as fallback
  - Implement with feature flag for gradual rollout
- **Contingency**: Continue with mock data, clearly label as "demonstration mode"

#### Risk 2: Browser Compatibility Issues with Design Tokens
- **Probability**: Low | **Impact**: Medium
- **Description**: CSS custom properties may not work in older browsers
- **Mitigation**:
  - Check browser support data (caniuse.com)
  - Test on target browsers early
  - Consider PostCSS plugin for fallbacks
- **Contingency**: Maintain dual stylesheet approach (tokens + fallback values)

#### Risk 3: Performance Degradation with Large Equipment Lists
- **Probability**: Medium | **Impact**: Medium
- **Description**: UI may slow with >100 equipment items or complex analyses
- **Mitigation**:
  - Profile performance during development
  - Implement virtualization if needed
  - Add pagination/filtering
  - Monitor Core Web Vitals
- **Contingency**: Add "performance mode" that simplifies rendering

#### Risk 4: Third-Party Dependency Vulnerabilities
- **Probability**: Medium | **Impact**: Medium
- **Description**: New vulnerabilities discovered in dependencies
- **Mitigation**:
  - Run `npm audit` regularly (weekly minimum)
  - Set up Dependabot alerts
  - Have update process ready
  - Pin dependency versions
- **Contingency**: Rollback to previous version, find alternative library

### Project Risks

#### Risk 5: Scope Creep on UI Redesign
- **Probability**: High | **Impact**: Medium
- **Description**: UI improvements could expand beyond planned scope
- **Mitigation**:
  - Stick to phased approach (Phase 1 → 2 → 3 → 4)
  - Each phase has clear acceptance criteria
  - Regular check-ins on progress vs plan
  - Defer "nice-to-haves" to later phases
- **Contingency**: Cut Phase 4 if timeline pressured, focus on P0/P1 items

#### Risk 6: Accessibility Standards Evolving
- **Probability**: Low | **Impact**: Low
- **Description**: WCAG guidelines may change or new requirements emerge
- **Mitigation**:
  - Monitor WCAG updates
  - Build with best practices that exceed minimums
  - Design system makes updates easier
- **Contingency**: Schedule dedicated accessibility review every 6 months

### User Experience Risks

#### Risk 7: User Resistance to UI Changes
- **Probability**: Medium | **Impact**: Medium
- **Description**: Existing users may resist interface changes
- **Mitigation**:
  - Phased rollout with user feedback
  - Document changes clearly
  - Preserve familiar workflows
  - Provide "what's new" guides
- **Contingency**: Create "classic mode" toggle if feedback strongly negative

---

## Rollback Plan

### General Rollback Procedure

For any major change that causes critical issues:

1. **Immediate Action**: Revert the PR/merge that introduced the issue
2. **Communication**: Document what was rolled back and why in master_plan.md
3. **Analysis**: Investigate root cause before attempting again
4. **Prevention**: Add tests to prevent recurrence

### Rollback Procedures by Change Type

#### UI Component Changes
- **Trigger**: Component breaks functionality, causes accessibility regression, or major visual bugs
- **Rollback**: `git revert <commit-sha>` and redeploy
- **Validation**: Test all affected user flows work as before
- **Timeline**: <1 hour for critical issues

#### Design Token System
- **Trigger**: Widespread visual bugs, browser compatibility issues, performance degradation
- **Rollback**: Revert to hardcoded styles in previous commit
- **Validation**: Visual regression test across browsers
- **Timeline**: <2 hours
- **Note**: Keep tokens in feature branch, merge only when fully tested

#### API Changes
- **Trigger**: Data corruption, breaking changes, performance issues
- **Rollback**: Revert API code and redeploy Azure Functions
- **Validation**: Test all CRUD operations, verify data integrity
- **Timeline**: <1 hour for critical issues
- **Note**: Azure Functions can deploy previous version from portal

#### Dependency Updates
- **Trigger**: Breaking changes, security vulnerabilities in new version, compatibility issues
- **Rollback**: `npm install package@previous-version`, commit and deploy
- **Validation**: Full test suite run, npm audit clean
- **Timeline**: <30 minutes
- **Note**: Document in master_plan.md which versions caused issues

#### Database Schema Changes
- **Trigger**: Data loss, corruption, or incompatible changes
- **Rollback**: Restore from Azure Table Storage backup
- **Validation**: Verify data integrity, test all operations
- **Timeline**: Variable (depends on backup size)
- **Note**: Always test schema changes in non-production first

### Prevention Measures

To minimize need for rollbacks:
- ✅ Test thoroughly before merge (manual + automated)
- ✅ Use feature branches for large changes
- ✅ Deploy to staging environment first
- ✅ Monitor after deployment (errors, performance)
- ✅ Have rollback plan before making change
- ✅ Document changes in master_plan.md

### Post-Rollback Actions

After any rollback:
1. **Document**: Add entry to master_plan.md Recent Updates section
2. **Analyze**: Root cause analysis of what went wrong
3. **Prevent**: Add tests, update procedures to prevent recurrence
4. **Communicate**: Update any related issues/PRs with findings
5. **Plan**: Determine if/when to retry with fixes

---

## Project Architecture

### Technology Stack
- **Frontend:** React 18 + Vite 7 + TypeScript 5
- **Backend:** Azure Functions (Node.js 22) + TypeScript 5
- **Database:** Azure Table Storage
- **Mapping:** Mapbox GL JS
- **Deployment:** Azure Static Web Apps
- **Runtime:** Node.js 22.x

### Key Components
- **Webapp** (`/webapp`): React-based frontend application
- **API** (`/api`): Azure Functions serverless backend
- **Scripts** (`/scripts`): Data management and seeding utilities

---

## Version Control
- **Repository:** https://github.com/richardthorek/fireBreakCalculator
- **Primary Branch:** main
- **Node Version:** 22.x (LTS)

---

## ⚠️ REMEMBER: Update This Document

**After ANY significant work:**
1. Add dated entry to Recent Updates section
2. Link your PR/issue number
3. Mark roadmap items complete (📋 → ✅) with date
4. Update Architecture section if you changed technical decisions
5. Update component-register.md or api-register.md if you added/modified components/APIs

**This document is the living source of truth. Keep it current.**
