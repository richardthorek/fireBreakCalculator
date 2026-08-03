# CLAUDE.md — webapp

Scoped to `/webapp`. Repo-wide rules (data honesty, docs discipline, roadmap) are
in the root `CLAUDE.md` — read that first.

- **Stack:** React 18 + Vite + TypeScript. Mapbox GL JS for the map.
- **Before a PR:** `npm test` (33 files under `tsx` via `scripts/runTests.mjs`,
  one live-network exception — see that script's own comment) and
  `npm run build` (strict TS via `tsc -b`) must both pass. Both run in CI
  (`.github/workflows/deploy.yml`).
- **Terrain Mobility mode** (`src/terrain/*`, `src/components/Mobility*.tsx`,
  `src/components/CounterMobilityPanel.tsx`): see the root `CLAUDE.md`'s OCOKA
  rules — they apply here. One webapp-specific detail: import `MobilityClass`
  from `@firebreak/terrain`; do not redeclare the union.
- **`shared/terrain` (`@firebreak/terrain`, OCOKA 2):** most pure terrain/
  mobility algorithm modules now live in `shared/terrain/src`, not
  `webapp/src/terrain` — consumed via a TS path alias (`tsconfig.json`
  paths + `vite.config.ts` resolve.alias), not an npm dependency. See
  `shared/terrain/README.md` before moving a file into or out of it, and
  `docs/ROUTE_INTELLIGENCE.md` §38.1 for the full move/stay rationale.
