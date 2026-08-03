# @firebreak/terrain

Pure-compute terrain/mobility algorithms, extracted (not copied) out of
`webapp/src/terrain` so the same code can run client-side today and,
from OCOKA 5 onward, on the Azure Functions backend too. See
`docs/ROUTE_INTELLIGENCE.md` §38 and `master_plan.md`'s OCOKA programme.

## What belongs here

Only modules that are pure functions over already-sampled data — no
`fetch`, no `window`/`document`/`self`, no Mapbox GL, no Vite-specific
`import.meta`/Worker URL syntax. Anything that fetches a live data source
(Overpass trails, DEA rasters, NAFI fire history, elevation APIs) or talks
to a browser API (`mobilityWorker.ts`'s Web Worker, `mobilityWorkerClient.ts`'s
`new Worker(new URL(...))`, `mobilityTelemetry.ts`'s beacon) stays in
`webapp/src/terrain` and imports the pure algorithms from here instead.

`webapp/src/terrain/oakoc.ts` is a deliberate, recorded exception in the
other direction: it only assembles the OCOKA five-factor view model for
`OakocPanel.tsx` from an already-computed `MobilityAppreciationResult` — it
never computes anything a server would also need to compute independently,
so it stays client-side rather than forcing that large orchestrator type
to move too.

## How it's wired (and why there's no `npm install` here)

This is **not** an npm-installed dependency and there is **no root npm
workspace**. `webapp/tsconfig.json` maps `@firebreak/terrain` to
`shared/terrain/src/index.ts` via `compilerOptions.paths`, and
`webapp/vite.config.ts` maps the same specifier via `resolve.alias` — Vite
bundles this source directly into the webapp build, exactly like any other
local module.

That's deliberate: Azure Static Web Apps deploys via `Azure/static-web-apps-deploy@v1`,
which runs an independent Oryx remote build scoped to `app_location: 'webapp'`
and `api_location: 'api'` — it has no notion of an npm workspace root and
would not know to install or build a sibling `shared/` package first. A
path alias avoids that failure mode entirely: there is nothing to install,
so there is nothing for the remote build to miss.

When OCOKA 5 wires the API to this package, prefer the same pattern:
a TypeScript path mapping (or a `references` project-reference build if the
API needs a real emitted-JS import) rather than an npm dependency, unless
Azure Functions deployment is re-verified to tolerate a workspace install.

`npm run build` here runs a standalone, no-emit type-check only — it exists
to catch a file in this package accidentally importing something
browser/network-coupled, independent of whichever consumer's own build
would otherwise mask that. Nothing consumes its output.
