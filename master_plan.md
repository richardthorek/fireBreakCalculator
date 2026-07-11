# Fire Break Calculator - Master Plan

**Last Updated**: July 11, 2026  
**Document Owner**: Project Maintainers  
**Related Docs**: [CLAUDE.md](CLAUDE.md), [.github/copilot-instructions.md](.github/copilot-instructions.md)

---

## ⚠️ MANDATORY WORKFLOW

### BEFORE Starting Work
1. **READ** this entire document to understand context and current state
2. **REVIEW** the Forward Roadmap to find your task and acceptance criteria
3. **VERIFY** your work aligns with the documented vision

### AFTER Completing Work
1. **UPDATE** this file — add a dated entry in Recent Updates
2. **LINK** your PR/issue in the relevant roadmap section
3. **MARK** roadmap items complete (📋 → ✅)

### DO NOT Create
- Post-work summary documents (everything goes here)
- Separate status/tracking files
- Duplicate documentation of what's in this plan

### The Only Docs That Matter
1. **THIS FILE** (`master_plan.md`) — single source of truth
2. **As-built docs** in `docs/`:
   - `NVIS_INTEGRATION.md` — vegetation data strategy
   - `CALCULATION_REVIEW.md` — estimate model
   - `VEGETATION_OVERRIDES.md` — override workflow
3. **Machine-readable registers**:
   - `api-register.md` — API endpoints (update on code change)
   - `component-register.md` — React components (update on code change)

---

## Project Overview

A geospatial planning tool for rural firefighters. Users draw a fire-break/trail line on a map and get grounded estimates of **time, cost, and resources** to build it — segment by segment, accounting for actual slope and vegetation along the line.

**Core principle:** Never present fabricated data as real analysis. All estimates must flag confidence, fall back gracefully, and warn when using estimated/mock data.

**Current tech stack:** React 18 + Vite 7 + TypeScript / Azure Functions (Node 22) + TypeScript / Mapbox GL JS / Azure Table Storage / Azure Static Web Apps.

---

## Goals & Vision

### Strategic Goals (Current Quarter)

**1. Accessibility & Safety (P0)**  
WCAG 2.1 AA compliance. Touch targets ≥44×44px, color contrast ≥4.5:1, confirmation dialogs for destructive actions, ARIA landmarks, keyboard navigation, reduced-motion support.

**2. Data Accuracy (Ongoing)**  
Real elevation data (DEM), authoritative vegetation (NVIS + NSW overlay), explicit confidence scoring, graceful fallbacks, transparent data provenance.

**3. Professional UI/UX (Q2-Q3)**  
Design token system, consistent component library, modern patterns, responsive mobile-first.

**4. Field-Ready (Q3-Q4)**  
Offline-first PWA, mobile optimization, touch-friendly controls, minimal data usage.

### Non-Goals (Out of Scope)
- Real-time fire tracking
- Multi-user collaboration
- Integration with dispatch systems (future consideration)

---

## Recent Updates

### July 11, 2026 — Vegetation Data Strategy: NVIS-First (Discovery, Confirmation, Design)

**Objective:** Settle how the tool sources a comprehensive, consistent view of vegetation (fuel) across Australia.

**What was tested:**  
Live queries to every candidate vegetation endpoint from a CI-class network. NVIS national is adequate and uniform (tested across rainforest, tall forest, savanna, arid Acacia, genuine Mallee, Jarrah, cleared cropland, ocean). The documented "Victoria Mallee failure" was a bad test point (cleared farmland where NVIS returning MVG 25 "cleared" is correct); genuine Mallee returns MVG 14 as expected.

**Decision:**  
**Standardise on NVIS national as the vegetation spine; keep the existing NSW SVTM overlay; freeze per-state expansion.** Only NSW (in use), QLD, VIC, and TAS have anonymous public endpoints; WA is auth-gated (401), SA/NT have no open path — so a state hierarchy would still be NVIS across ~half the country (the inconsistency it aimed to remove).

**Confirmed endpoint structures (2026-07-11):**
- NVIS `.../NVIS_ext_mvg/MapServer` layer 0 is a **raster** (use `identify`). MVG code in `UniqueValue.Pixel Value` (string 1–32 or `"NoData"` over water); name in `Raster.MVG_NAME`. Outside AU → empty `results`.
- NSW `.../SVTM_NSW_Extant_PCT/MapServer/3` is a feature layer with `vegForm`/`vegClass`/`PCTName` (~25 m, kept as the one high-fidelity overlay).

**Documentation:**  
- **[docs/NVIS_INTEGRATION.md](docs/NVIS_INTEGRATION.md)** — new consolidated vegetation as-built (sources, endpoint structures, appropriate use, deferred state overlays, implementation spec).
- Four stale docs marked **superseded** (STATE_VEGETATION_*, NVIS_FIDELITY_REPORT).

### July 10, 2026 — Calculation Engine Overhaul: Per-Segment, Grounded Production Model

**PR:** [#148](https://github.com/richardthorek/fireBreakCalculator/pull/148)

**What changed:**  
Replaced the whole-route heuristic estimate with an accurate, per-segment production model grounded in published fireline-production literature (NWCG 2021, Victorian DELWP Report 56). Reinstated real machinery slope-safety limits.

**Key deliverables:**
- `api/src/services/productionModel.ts` — resource-specific speed multipliers, slope limits.
- `api/src/services/equipmentAnalysis.ts` — per-segment integration, slope-limit resolution, aircraft load-coverage model.
- `webapp/src/utils/routeProfile.ts` — joins slope (~10 m) and vegetation (~200 m) samples, honours overrides.
- Backend is now the sole accurate engine; frontend delegates (offline fallback retained).
- 11 unit tests; all pass.

**Infrastructure as code:**  
Bicep/Azure Static Web Apps pipeline; OIDC login (no deployment-token secret stored); `infra/README.md` documents one-time setup.

**Data provenance:**  
Slope and vegetation analyses flag fallback data (`usedMockElevation`, `usedFallbackData`); UI shows prominent "estimated data in use" warning.

**Impact:**  
Estimates now reflect the actual mix of slope and fuel along the line, not a single worst case. Machinery is no longer recommended for unsafe slopes. Rate model is grounded and tunable.

---

## Forward Roadmap

**Priority:** P0 = Blocking/safety, P1 = Major features, P2 = Enhancements, P3 = Polish.

### Phase 1: Critical Fixes — Accessibility & Safety (P0)
**Target:** Q2 2026 (2–3 weeks) | **Status**: 📋 Planned

1. **Confirmation dialogs for destructive actions** (delete equipment/vegetation)
   - Files: `ConfirmDialog.tsx`, update config panels
2. **Touch targets ≥44×44px** (equipment tags, formation icons)
   - Files: `styles-config.css`, `styles.css`
3. **Color contrast ≥4.5:1 WCAG AA** (equipment hover, formation text)
   - Files: `styles-config.css`, `styles.css`
4. **Reduce-motion support** (`prefers-reduced-motion: reduce`)
   - Files: `styles.css`
5. **ARIA landmarks & focus management** (main, complementary, aria-selected)
   - Files: `App.tsx`, config panels, analysis panel

---

### Data Quality: Vegetation NVIS-First Uplift (P1)
**Target:** 1 sprint | **Status**: 📋 Planned (design complete, ready to implement)

**Scope:**
1. Make `NoData`/empty-result handling explicit and unit-tested (`nvisVegetationService.ts`)
2. Surface "modified/low-fidelity" flag for MVG 24/25/26/27/28/99 through to the panel
3. Keep NSW overlay; freeze state expansion — remove TODO scaffolding in router
4. Fix false Victoria test point (`-36.0,141.0` is cleared farmland; use genuine Mallee coord)

**Acceptance:** `NoData`/ocean/out-of-AU never yield non-`estimated` classes (tested); cleared segments flagged + overridable; no new state services; fidelity test passes.

---

### Phase 2: Visual Consistency & Polish (P1)
**Target:** Q2–Q3 2026 (3–4 weeks) | **Status**: 📋 Planned

- Replace hardcoded colors with design tokens
- Apply typography system (eliminate fractional sizes)
- Apply 8px baseline spacing grid throughout
- Add skeleton loading states
- Standardize button usage

---

### Phase 3: UX Enhancements (P2)
**Target:** Q3 2026 (3–4 weeks) | **Status**: 📋 Planned

- Toast notification system
- Drawing gesture help overlay
- Result export (PDF/CSV)
- Equipment presets/favorites
- Improved mobile keyboard handling

---

### Phase 4: Polish & Delight (P3)
**Target:** Q4 2026 (2–3 weeks) | **Status**: 📋 Planned

- Micro-interactions, smooth transitions
- Dark mode toggle
- Keyboard shortcuts modal
- Advanced route visualization (3D preview, vehicle routing)

---

## Project Architecture

### Technology Stack
- **Frontend:** React 18 + Vite 7 + TypeScript 5, Mapbox GL JS
- **Backend:** Azure Functions (Node.js 22) + TypeScript 5
- **Database:** Azure Table Storage
- **Deployment:** Azure Static Web Apps (OIDC + Bicep IaC)
- **Package Manager:** npm

### Key Component Paths
- **Frontend:** `/webapp` (React app, Vite)
- **Backend:** `/api` (Azure Functions, serverless)
- **Shared:** `/scripts` (data seeding, utilities)
- **Infrastructure:** `/infra` (Bicep, IaC)
- **Docs:** `/docs` (as-built + registers; see README)

### Data Flow
1. User draws line on map → sampled at ~200 m intervals for vegetation, ~10 m for slope
2. Frontend calls backend `POST /api/analysis/calculate` with segment profile
3. Backend applies production model (per-segment, slope/fuel multipliers, machinery limits)
4. Response includes time/cost/resources + metadata (mean/max slope, confidence, coverage)
5. Frontend renders results in analysis panel; all fallback/estimated data flagged

### Key Services
- **Vegetation:** NVIS national (100 m raster, `identify` query) + NSW SVTM overlay (25 m feature layer)
- **Elevation:** Azure DEM ImageServer (server-side) + Mapbox Terrain-RGB fallback
- **Production model:** Published rates (NWCG 2021, DELWP 56) × fuel/slope multipliers × equipment type

### Testing
- **Frontend:** Vite test suite, TypeScript strict mode
- **Backend:** 11 unit checks on production model + analysis logic
- **Coverage target:** >80% on critical paths; all PRs must pass CI

---

## How to Contribute

1. **Pick a roadmap item** (or create an issue for new work)
2. **Create a feature branch** (e.g., `feature/accessibility-fixes`)
3. **Implement & test** (`npm run lint`, `npm test`, `npm run build`)
4. **Submit PR** with clear description and issue link
5. **Update this file** after merge (Recent Updates entry, roadmap status flip)

See [CLAUDE.md](CLAUDE.md) for AI contributor guidance, [docs/README.md](docs/README.md) for doc discipline.

---

**Next review:** After Phase 1 completion (accessibility fixes)
