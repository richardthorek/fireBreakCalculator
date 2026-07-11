# Fire Break Calculator — Master Plan

**Last Updated**: July 11, 2026
**Related Docs**: [CLAUDE.md](CLAUDE.md) · [docs/README.md](docs/README.md)

---

## ⚠️ MANDATORY WORKFLOW

**Before starting:** read this document; find your step below; check the linked design doc for detail.
**After finishing:** add a dated entry in Recent Updates, link the PR, flip the step status (📋 → ✅), and update the relevant design doc / register.
**Never create** new planning/status/summary docs — planning lives here; technical detail lives in the linked docs; everything else is doc sprawl.

---

## Vision

A **mitigation copilot** for rural firefighters: draw a line, get grounded time/cost/resource estimates, a smarter path, official fire-danger context, and a cited, plain-language briefing — then hand the plan to the tools agencies already use (FireMapper, ArcGIS, Avenza, GPS).

**Non-negotiable principles**
1. **Deterministic core.** All numbers come from the calculation engine and published models. The AI layer narrates and cites; it never computes ([docs/AI_ASSISTANT.md](docs/AI_ASSISTANT.md)).
2. **Data honesty.** Estimated/fallback data is always flagged, end to end — including in exports. A missing value is shown as missing, never defaulted silently.
3. **Don't rebuild what exists.** AFDRS/BOM own fire danger; Spark/Phoenix own spread prediction. We display official products and integrate.
4. Field-ready: offline-capable, touch-first, low data.

## Current state

- **Estimates:** per-segment production model in the API is the sole engine ([docs/CALCULATION_REVIEW.md](docs/CALCULATION_REVIEW.md)).
- **Vegetation:** NVIS national spine + NSW SVTM overlay; state expansion frozen ([docs/NVIS_INTEGRATION.md](docs/NVIS_INTEGRATION.md)).
- **Route intelligence:** corridor pathfinding, chainage-addressed segment detail, elevation profile, rule-based Plan Assistant, tabbed analysis UI — shipped in PR [#163](https://github.com/richardthorek/fireBreakCalculator/pull/163) ([docs/ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md)).

## The Plan

| # | Step | Scope (one line) | Detail | Status |
|---|------|-------------------|--------|--------|
| 0 | **Route intelligence & analysis UI** | Corridor optimizer, Plan Assistant, tabbed workspace | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) | ✅ PR #163 |
| 1 | **Universal GIS export pack** | GeoJSON/KML/KMZ/SHP export with provenance flags → covers FireMapper/QGIS/Earth; file import (perimeters, lines) | [GIS_INTEROP.md](docs/GIS_INTEROP.md) §1, §4 | ✅ PR #163 |
| 2 | **Infrastructure-aware optimizer** | Existing trails/roads as discounted edges (✅), unanchored-end insights (✅); water-point & cadastre advisory layers (📋 — licensing check pending) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) | ✅ core, PR #163 |
| 3 | **AFDRS & live context** | Official fire danger rating + behaviour index for plan location/date; hotspots & incidents layers; break-adequacy heuristics keyed to AFDRS, doctrine-cited | [GIS_INTEROP.md](docs/GIS_INTEROP.md) §4 | 📋 |
| 4 | **AI assistant** | Azure AI Foundry (OpenAI-spec API) via IaC; RAG doctrine KB; grounded briefings, doctrine callouts, cited chat; hard anti-hallucination controls | [AI_ASSISTANT.md](docs/AI_ASSISTANT.md) | 📋 |
| 5 | **Agency hand-off** | ArcGIS Online hosted-feature-layer push (OAuth PKCE); Avenza geospatial-PDF spike (fallback: KMZ) | [GIS_INTEROP.md](docs/GIS_INTEROP.md) §2, §3 | 📋 |
| 6 | **Field hardening** | Offline-first PWA (cached tiles + analyses), WCAG 2.1 AA completion, vegetation NoData uplift | [NVIS_INTEGRATION.md](docs/NVIS_INTEGRATION.md) | 📋 |

Sequencing logic: exports first (highest reach per effort, unblocks real-world feedback), then make the optimizer street-smart, then live context so the assistant (step 4) has rich grounded payloads, then agency push, then hardening. Accessibility fixes and the small vegetation NVIS uplift ride inside steps as touched, with step 6 as the sweep.

## Architecture snapshot

React 18 + Vite + TS (`/webapp`) · Azure Functions Node 22 (`/api`) · Azure Table Storage · Mapbox GL JS · Azure Static Web Apps, Bicep IaC (`/infra`, OIDC).
Data flow: draw line → slope (~10 m) + vegetation (~200 m) sampling → joined chainage profile → `POST /api/analysis/calculate` → per-segment estimates + flags → UI/assistant/exports.
Gates: `npm run build` (webapp, strict TS), `npm run test:unit` (api) — both in CI.

## Recent Updates

- **2026-07-11 — Steps 1–2 shipped** (PR [#163](https://github.com/richardthorek/fireBreakCalculator/pull/163)): GIS export pack (GeoJSON/KML/KMZ/Shapefile, provenance flags in every format) + file import (GeoJSON/KML/KMZ/GPX) as plan line or map overlay; optimizer now prices OSM-mapped trails as discounted edges (Overpass, graceful degradation, "verify trafficability" labelling) and the assistant flags unanchored ends in continuous fuel. Water/cadastre advisory layers deferred pending licensing check.
- **2026-07-11 — Route Intelligence & UI overhaul** (PR [#163](https://github.com/richardthorek/fireBreakCalculator/pull/163)): corridor pathfinding over real DEM + NVIS/NSW samples with apply/dismiss preview; rule-based Plan Assistant with chainage-located hazards; elevation profile + segment breakdown; tabbed analysis workspace. Verified: builds clean, API tests pass, 22-check optimizer smoke test. As-built: [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md).
- **2026-07-11 — Master plan replaced** with the mitigation-copilot direction above (steps 1–6); detail moved to [AI_ASSISTANT.md](docs/AI_ASSISTANT.md), [GIS_INTEROP.md](docs/GIS_INTEROP.md), [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md). Prior plan content preserved in git history.
- **2026-07-11 — Vegetation strategy: NVIS-first confirmed**; per-state expansion frozen. See [NVIS_INTEGRATION.md](docs/NVIS_INTEGRATION.md).
- **2026-07-10 — Calculation engine overhaul** (PR [#148](https://github.com/richardthorek/fireBreakCalculator/pull/148)): per-segment grounded production model (NWCG 2021, DELWP 56), machinery slope limits, backend as sole engine. See [CALCULATION_REVIEW.md](docs/CALCULATION_REVIEW.md).

---

**Next review:** after Step 1 (GIS export pack) ships.
