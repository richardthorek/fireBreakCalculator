# CLAUDE.md — Fire Break Calculator

Guidance for AI coding agents (Claude Code and others) working in this repo.
Keep it simple, keep it current, keep planning in one place.

## What this project is

A geospatial planning tool for rural firefighters and emergency crews. A user
draws a fire-break/trail line on a map and gets grounded estimates of **time,
cost, and resources** to build it — segment by segment, accounting for the actual
slope and vegetation (fuel) along the line. It must work in the field with poor
or no reception, and it must **never present fabricated data as real analysis**.

## Where the truth lives (read before doing anything)

1. **`master_plan.md`** — the single source of truth for vision, current state,
   decisions, and the forward roadmap. **Read it before starting; update it after
   finishing** (dated entry in Recent Updates, link the PR/issue, flip roadmap
   items 📋 → ✅).
2. **A small set of as-built docs** in `docs/` for areas with real depth. The
   ones that matter:
   - [`docs/NVIS_INTEGRATION.md`](docs/NVIS_INTEGRATION.md) — vegetation/fuel data
     (sources, confirmed endpoint structures, appropriate use). **NVIS-first.**
   - [`docs/CALCULATION_REVIEW.md`](docs/CALCULATION_REVIEW.md) — the production/
     estimate model.
   - [`docs/VEGETATION_OVERRIDES.md`](docs/VEGETATION_OVERRIDES.md) — user override
     of auto-detected vegetation.
   - [`docs/ROUTE_INTELLIGENCE.md`](docs/ROUTE_INTELLIGENCE.md) — corridor
     pathfinding, chainage model, Plan Assistant rules.
   - [`docs/GIS_INTEROP.md`](docs/GIS_INTEROP.md) — export/import formats,
     agency GIS integration, live feeds.
   - [`docs/AI_ASSISTANT.md`](docs/AI_ASSISTANT.md) — LLM layer, knowledge base,
     grounding contract, hosting/IaC.
   - [`docs/api-register.md`](docs/api-register.md) / [`docs/component-register.md`](docs/component-register.md)
     — machine-readable catalogs; update when endpoints/components change.

## Documentation discipline (strict)

- **All planning goes in `master_plan.md`.** Not in new files, not in PR-side
  summaries.
- **Design/reference detail goes in an existing as-built doc** — extend one,
  don't spawn another. Treat the list above as roughly the full set.
- **Do NOT create** post-work summary docs, status reports, "current state" files,
  or anything that duplicates the master plan. If you feel the urge to write a
  new `.md`, put it in the master plan or the relevant as-built instead.
- Superseded docs get a one-line banner pointing to what replaced them; they are
  not maintained. (Doc-sprawl cleanup is a known, separate task — don't add to it.)

## Current state & next steps (keep this section short and live)

- **Vegetation:** NVIS national is the confirmed spine; NSW SVTM is a high-fidelity
  overlay. Per-state expansion is **frozen** (deferred future overlays are recorded
  in `NVIS_INTEGRATION.md`). Next: the small "Vegetation NVIS-first uplift" in the
  roadmap (explicit `NoData` handling, flag cleared/modified segments).
- **Estimates:** per-segment production model lives in the API and is the sole
  accurate engine; the frontend delegates to it. See `CALCULATION_REVIEW.md`.
- For anything else, the roadmap in `master_plan.md` is authoritative.

## How to work here

- **Stack:** React 18 + Vite + TypeScript (`/webapp`); Azure Functions + Node 22
  + TypeScript (`/api`); Azure Table Storage; Mapbox GL JS; Azure Static Web Apps.
- **Before a PR:** `npm run lint`, `npm test`, and `npm run build` must pass in the
  package you touched. TypeScript strict; avoid `any` without justification.
- **Branches:** work off `main` via a feature branch; no direct commits to `main`.
- **Data honesty:** any estimated/fallback/mock value must stay flagged
  (`estimated`, `usedFallbackData`, `usedMockElevation`) so the UI can warn — this
  is a safety property, not a nicety.
- **Secrets:** none in code; use environment variables. External data (NVIS, NSW
  vegetation) is public but requires attribution.

## Guardrails

- Keep changes aligned with the documented roadmap; if a task isn't there and is
  non-trivial, add it to the roadmap first.
- Prefer extending existing patterns/services over adding new ones.
- When you finish: update `master_plan.md`, and the relevant as-built doc if you
  changed a data source, endpoint, or the model.
