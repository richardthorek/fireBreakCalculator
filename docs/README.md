# Documentation Index

This directory holds **essential as-built documents only**. All planning,
roadmap, decisions, and status live in **`master_plan.md`** at the repo root.

## As-Built Documents (Authoritative)

These documents capture technical decisions, data sources, and model specifics.
Update them when the code changes in those areas.

- **[NVIS_INTEGRATION.md](NVIS_INTEGRATION.md)** — Vegetation/fuel data sources
  (NVIS national spine, NSW overlay), endpoint structures, appropriate use.
- **[CALCULATION_REVIEW.md](CALCULATION_REVIEW.md)** — Production/estimate model
  (per-segment, slope/fuel multipliers, machinery limits).
- **[VEGETATION_OVERRIDES.md](VEGETATION_OVERRIDES.md)** — User override workflow
  for auto-detected vegetation.
- **[ROUTE_INTELLIGENCE.md](ROUTE_INTELLIGENCE.md)** — Corridor pathfinding, chainage
  model, Plan Assistant rules (as-built) + infrastructure-aware optimizer (design).
- **[GIS_INTEROP.md](GIS_INTEROP.md)** — Export formats, ArcGIS/FireMapper/Avenza
  integration, AFDRS & live feeds (design).
- **[AI_ASSISTANT.md](AI_ASSISTANT.md)** — LLM layer on Azure AI Foundry: grounding
  contract, doctrine RAG, anti-hallucination controls (design).

## Machine-Readable Registers (Update on code changes)

- **[api-register.md](api-register.md)** — API endpoint catalog. Update when
  endpoints are added/modified/removed.
- **[component-register.md](component-register.md)** — React component catalog.
  Update when components are added/modified/removed.

## Visual Documentation

- **[screenshots/](screenshots/)** — UI/UX snapshots (naming: `YYYY-MM-DD-feature-name-[before|after].png`).

## Where to Find What

| Need | Look here |
| --- | --- |
| Project vision, roadmap, current state | [`master_plan.md`](../master_plan.md) |
| AI contributor guidance | [`CLAUDE.md`](../CLAUDE.md) |
| Vegetation data strategy & endpoints | `NVIS_INTEGRATION.md` (this folder) |
| How estimates are calculated | `CALCULATION_REVIEW.md` (this folder) |
| How users override vegetation | `VEGETATION_OVERRIDES.md` (this folder) |
| Pathfinding & Plan Assistant internals | `ROUTE_INTELLIGENCE.md` (this folder) |
| Exports, agency GIS, AFDRS feeds | `GIS_INTEROP.md` (this folder) |
| AI assistant architecture & guardrails | `AI_ASSISTANT.md` (this folder) |
| All API endpoints | `api-register.md` (this folder) |
| All React components | `component-register.md` (this folder) |

## Note on documentation discipline

Per `CLAUDE.md`: **Do not create new summary/status/reference documents.** Extend
an existing as-built, link from `master_plan.md`, or update a register. This
keeps documentation focused and prevents sprawl.
