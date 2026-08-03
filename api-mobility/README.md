# api-mobility

Terrain Mobility tier-2 backend job protocol (OCOKA 5,
[`docs/ROUTE_INTELLIGENCE.md` §47.3](../docs/ROUTE_INTELLIGENCE.md)) — a
Durable Functions app that runs a mobility appreciation server-side and
delivers results as append-only blob artefacts, polled over a small HTTP
protocol.

## Why this is a separate package from `/api`

Azure Static Web Apps allows exactly ONE backend type per environment:
**managed functions** (what `/api` is today, Consumption-only, HTTP-trigger-
only, no Durable Functions) OR a **linked custom backend** (any Functions
plan, including the Flex Consumption plan Durable orchestration needs) — never
both at once. Linking a custom backend is a real cutover: every existing
`/api/*` route has to move onto the SAME custom Function App, not just the
new mobility routes.

This package is built as a standalone, independently buildable/testable unit
so that work — and CI coverage of it — doesn't have to wait for that cutover,
and so nothing about it can regress `/api`'s existing, live, SWA-managed
deployment. `deployMobilityBackend` (`infra/main.bicep`) stays `false` by
default; merging this package's code changes nothing in production.

**At cutover time** (`deployMobilityBackend: true`, a deliberate owner-driven
migration — see `docs/ROUTE_INTELLIGENCE.md` §47.3's runbook), this package's
functions are intended to move into `/api` itself, since post-cutover both
sets of endpoints deploy through the same custom Function App anyway and the
temporary duplication below stops being necessary.

## Temporary duplication (tracked, not accidental)

- `src/services/elevationService.ts` — duplicate of `api/src/services/elevationService.ts`.
- `src/services/infrastructureService.ts` — duplicate of `api/src/services/infrastructureService.ts`.

Both are small, stable, already-tested modules; keep them in sync until the
cutover above merges the two packages.

## Why `@firebreak/terrain` is imported via a relative path, not the bare specifier

`webapp` resolves `@firebreak/terrain` via a Vite/tsconfig path alias that
bundles the shared source directly — no Node module resolution ever happens
at runtime. This package compiles with plain `tsc` to real CommonJS
`require()` calls (see `tsconfig.json`'s `rootDir`/`include` spanning both
this package and `../shared/terrain/src`), so a bare `@firebreak/terrain`
specifier would compile fine but fail at runtime with `Cannot find module`
— there's no `node_modules/@firebreak/terrain` to resolve it to. A relative
import (`../../../shared/terrain/src/index`) is preserved unchanged through
the compiler's mirrored output layout (`dist/api-mobility/...` alongside
`dist/shared/terrain/...`), so it resolves correctly post-compile.

## v1 algorithmic scope (deliberate, documented cuts)

See `src/functions/mobilityJobOrchestrator.ts` and
`src/services/mobilityGridServer.ts`'s own header comments for the full list
— in short: the optimiser's cheapest route + corridors (not the simulated-
mover ensemble), hex chokepoints/min-cut (not the road-network-exact cut),
and UNSCORED key-terrain candidates. Vegetation ships as a flagged
`vegEstimated: true` placeholder pending a server-side NVIS/NSW SVTM
classification port. No fan-out (that's OCOKA 8, built on tier-2 usage
evidence).

## Local development

```bash
npm install
npm run build
npm test        # unit tests — pure/no-network paths only
npm start        # func start — needs Azurite + a real TABLES_CONNECTION_STRING
                  # for anything beyond the HTTP routes registering
```
