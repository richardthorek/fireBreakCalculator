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
  from `terrain/mobilityClass.ts`; do not redeclare the union.
