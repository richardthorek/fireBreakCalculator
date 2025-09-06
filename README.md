# RFS Fire Break Calculator Monorepo

Modern geospatial planning tool to help rural firefighters estimate time, cost, and resource requirements for constructing fire breaks and trails. This repository contains:

| Package | Path | Purpose |
|---------|------|---------|
| Web App | `webapp/` | React + Vite + TypeScript interactive mapping UI (Mapbox GL JS) & analysis engine |
| API | `api/` | Azure Functions (TypeScript) providing CRUD for equipment catalogue via Azure Table Storage |
| Scripts | `scripts/` | Utility scripts (e.g. seeding equipment) |

## ✨ Key Features
* Interactive map drawing of proposed fire break routes with real‑time distance
* **Optimized touch controls** for mobile devices with tap-by-tap point placement
* Automated slope & vegetation difficulty analysis with visual overlays
* Equipment library: machinery, aircraft, hand crews (configurable)
* Time, cost, and aircraft drop estimations with terrain / vegetation multipliers
* Slope compatibility checks per machinery type
* Drop pattern preview for aircraft (interval markers along route)
* Config‑driven rules & rates (easy to extend)

## 🗂 Project Structure
```
api/              Azure Functions (equipment CRUD)
webapp/           React + Vite front-end
webapp/Documentation/  In-depth product & design docs (architecture, user guide, etc.)
scripts/          Helper / seed scripts
```

## ✅ Prerequisites
* Node.js 18+
* Azure Functions Core Tools v4 (for local API)
* An Azure Storage account (Table Storage) OR Azurite for local dev
* Mapbox access token (for map tiles & terrain)

## 🚀 Quick Start (Local Development)
Clone & install:
```pwsh
git clone <repo-url>
cd rfsBreakCalculator
cd api; npm install; cd ..
cd webapp; npm install; cd ..
```

Set environment values:
1. API: create `api/local.settings.json` (not committed) – example:
```jsonc
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "TABLES_CONNECTION_STRING": "UseDevelopmentStorage=true",
    "EQUIPMENT_TABLE_NAME": "equipment"
  }
}
```
2. Web: create `webapp/.env`:
```bash
VITE_MAPBOX_ACCESS_TOKEN=<your_token>
# Optional override (otherwise dev proxy to Functions):
# VITE_API_BASE_URL=http://localhost:7071/api
```

Run both services (separate terminals):
```pwsh
cd api; npm start          # Starts Functions host on http://localhost:7071
cd webapp; npm run dev     # Starts Vite dev server (usually http://localhost:5173)
```
Navigate to the web URL; the frontend proxies `/api` to the Functions host.

## 🔐 Environment Variables

| Component | Variable | Description | Default |
|-----------|----------|-------------|---------|
| API | `TABLES_CONNECTION_STRING` | Connection string for Azure Table Storage | (required) |
| API | `EQUIPMENT_TABLE_NAME` | Table name for equipment catalogue | `equipment` |
| Web | `VITE_MAPBOX_ACCESS_TOKEN` | Mapbox token for tiles/styles | (required) |
| Web | `VITE_API_BASE_URL` | Explicit API base (omit to use dev proxy) | none |

## 🛠 Equipment API
Base URL (local): `http://localhost:7071/api`

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/equipment` | List all equipment |
| GET | `/equipment?type=Machinery` | Filter by type (`Machinery|Aircraft|HandCrew`) |
| POST | `/equipment` | Create new equipment item |
| PUT/PATCH | `/equipment/{type}/{id}` | Update existing item (optimistic version check) |
| DELETE | `/equipment/{type}/{id}` | Delete item |

### Create Example (Machinery)
```json
{
  "type": "Machinery",
  "name": "Caterpillar D6",
  "description": "Medium dozer",
  "allowedTerrain": ["easy","moderate","difficult"],
  "allowedVegetation": ["grassland","lightshrub","mediumscrub"],
  "clearingRate": 180,                // meters/hour
  "costPerHour": 450,
  "maxSlope": 25,
  "cutWidthMeters": 4
}
```

Concurrency control: supply `version` when updating; a mismatched version returns `409` with the current value.

## 🧮 Calculation Overview
Time & cost estimates combine:
* Base clearing or drop performance metrics (per resource)
* Terrain difficulty multiplier
* Vegetation density multiplier
* Line distance & (for aircraft) drop length and turnaround
* Crew size (for hand crews) and per‑person rate

Slope analysis segments the drawn line and flags incompatibility if any segment exceeds machinery limits.

## 🧭 Using the Application (High Level)
1. Draw a polyline route on the map
2. Review auto slope & vegetation analysis (adjust if needed)
3. Select equipment / aircraft / crews in the analysis panel
4. Inspect time, cost, drop counts & compatibility
5. Optionally preview aircraft drops (markers along line)
6. Iterate: edit or redraw route to optimize results

For full operational guidance see `webapp/Documentation/USER_GUIDE.md`.

## 🧪 Testing
Currently only API end‑to‑end tests placeholder:
```pwsh
cd api
npm run build
npm test
```

## 📦 Production Build
Web:
```pwsh
cd webapp
npm run build
```
API: deploy compiled `api/dist` with Azure Functions (Node 18). Ensure environment variables set in Function App configuration.

## 🚀 Deployment (Azure Outline)
1. Provision: Storage Account (Table), Function App (Linux, Node 18), Static Web App or Web App for front-end hosting
2. Configure settings: `TABLES_CONNECTION_STRING`, `EQUIPMENT_TABLE_NAME` (if not default)
3. Build & deploy API (zip or AZD) then web static assets
4. Set CDN / static hosting caching headers as appropriate

## 🗺 Roadmap (Excerpt)
* Real elevation & vegetation data integration
* Route optimization suggestions
* Offline capable mode
* Report / PDF export
* Authentication & role-based equipment management

## 🤝 Contributing
1. Fork & branch from `main`
2. Run lint/tests locally before PR
3. Include doc updates for user-facing changes
4. Observe security & quality guidelines (`SECURITY.md`, `QUALITY_REVIEW.md`)

## 📄 License
See `LICENSE`.

## 📚 Further Documentation
An index of deeper documentation is in `Documentation/` (root) and existing detailed guides remain in `webapp/Documentation/`.

---
Last updated: 2025-08-26
