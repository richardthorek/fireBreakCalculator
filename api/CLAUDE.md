# CLAUDE.md — api

Scoped to `/api`. Repo-wide rules (data honesty, docs discipline, roadmap) are
in the root `CLAUDE.md` — read that first.

- **Stack:** Azure Functions + Node 22 + TypeScript. Azure Table Storage for
  persistence.
- **Before a PR:** `npm run test:unit` (plain node:assert, `npm run build` then
  runs each compiled test file) must pass. Runs in CI
  (`.github/workflows/deploy.yml`).
- **Webapp/api must-match pairs** — shapes duplicated on both sides that have
  to stay in lock-step (a known bug class, several prior confirmed hits):
  `MobilityAssistantPayload` (`types/mobilityAssistant.ts` ↔
  `webapp/src/utils/mobilityAssistantApi.ts`), the Overpass water/highway
  query constants, `stitchRings` water-relation reassembly. Check both sides
  whenever you touch one.
- **Secrets:** none in code; environment variables only.
