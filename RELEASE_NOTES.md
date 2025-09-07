# rfsFireBreakCalculator — v1.0.0 🎉🔥🌲

Welcome to v1.0.0 — the release where the map stops sulking, the header learns manners, and small screens get treated with respect.

Short version: it’s smoother, sassier, and smarter. Read on for the fun bits and the fine print.

## Project snapshot (baseline features — see `README.md` for full detail)

This project ships a complete, opinionated toolset for planning and analysing fire breaks. For a thorough, canonical list see the `README.md`. Below is the canonical Top 10 features snapshot you can reference for the current project state:

Top 10 features — canonical snapshot

1. Interactive Map & Drawing
	- Mapbox GL-powered map with drawing and editing tools to define fire break polygons and measure distances.

2. Multi-mode Location Search
	- Address geocoding, raw coordinates, and grid-reference parsing with selectable results that fly the map to the selected location.

3. Break Analysis Panel
	- Automated calculations for break width, slope-aware recommendations, and visual overlays for analysis results.

4. Machine / Equipment Matching
	- Configurable equipment profiles and a compatibility engine that recommends suitable machines for a given break and terrain.

5. Vegetation Mapping & CSV Import
	- Vegetation classification support, CSV import utilities, and mapping data used to influence analysis and recommendations.

6. Persistent Backend (Azure Functions)
	- Simple API implemented as Azure Functions with table storage for persisting equipment and vegetation mapping records.

7. Projected Workflow Tools & Seed Data
	- CLI / scripts for seeding data, importing vegetation CSVs and adding machine records (located in `scripts/`).

8. Responsive, Accessible UI
	- Mobile-first, responsive layout with header collapse, compact configuration controls, and UI transitions for modes/results.

9. Testable Dev Stack & Tooling
	- React 18 + Vite + TypeScript frontend, with backend tests in `api/test` and webapp tests in `tests/` for CI-ready validation.

10. Export / Integration-friendly Data Model
	- Simple, documented models for equipment and vegetation mapping enabling export, audits, and easy integration with other tooling.

This section is the baseline snapshot — the rest of this document highlights what changed or was specifically polished for v1.0.0.

## Spotlight Features

- Map magic: click a search result and the map now flies to it like it always wanted — zoom, pan, and center are back on speaking terms. ✈️🗺️
- Responsive header: title, subtitle, and search now behave on one line and collapse neatly on tiny screens so nothing overlaps. 🎯
- Search modes moved: address / coordinate / grid options now live below the search box so they won’t hide behind your thumb on mobile. 👇📱
- Subtle animations: mode buttons and results slide and fade in — less jarring, more delightful. ✨

## Quality-of-life improvements

- Smaller bottom buttons in the analysis panel — less visual weight, same power. 🧭
- Search icon no longer photobombs the input text — spacing and padding cleansed. 🖼️➡️👌
- Configuration button collapses to a compact gear on small screens — we kept the functionality, trimmed the footprint. ⚙️➡️🧩

## Bug fixes

- Wired up `selectedSearchLocation` from `SearchControl` → `App.tsx` → `MapboxMapView` so search results actually move the map. (Turns out the map was only pretending to listen.) 🧩➡️📡
- Eliminated conflicting header CSS rules so layout decisions are now decisive and not passive-aggressive. 🧹
- Fixed layering and spacing so mode buttons and results don't overlap or get lost off-screen. 🔧

## Developer notes

- Files touched: `styles.css`, `styles-config.css` (layout and animation tweaks), `App.tsx` (added `searchLocation` state), `MapboxMapView.tsx` (hooked `selectedSearchLocation`), `SearchControl.tsx` (selection flow).
- Tagging: this release is intended as the first formal milestone; see `v1.0.0` tag.

## Known small things / next polish items

- Safari: add `-webkit-backdrop-filter` for visual parity (minor lint warning noted).
- Mode height offset: currently uses a static CSS offset variable; we can replace that with a dynamic layout for even less fragility.

## Quick sanity-check

1. Search an address, pick a result — watch the map fly to it.
2. Shrink the browser to mobile width — title collapses, config becomes a gear, modes sit under the search box.
3. Open an analysis and look at the bottom buttons — lighter, less aggressive.

Thanks for getting us to 1.0.0 — want this saved as the official release notes and pushed to your remote? If yes, tell me which remote/branch to push to and I’ll force-push the cleaned repo (this is destructive to remote history).

---
_Made with care by the rfsFireBreakCalculator team — version 1.0.0_
