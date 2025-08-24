# RFS Geospatial Viewer

Simple starter React + Vite + TypeScript web app with a full-screen Leaflet map (Mapbox tiles) and a 10% viewport-height header.

## Features

- React + Vite + TypeScript for fast dev & type safety
- Leaflet map with Mapbox Streets style tiles
- Responsive layout: 10% header, 90% map
- Environment-based Mapbox access token (no hardcoded secrets)
- Graceful error message if token missing

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create an `.env` file (copy from `.env.example`) and add your Mapbox token:
   ```bash
   cp .env.example .env
   # Then edit .env and set VITE_MAPBOX_ACCESS_TOKEN
   ```
3. Run the dev server:
   ```bash
   npm run dev
   ```
4. Open the printed local URL (usually `http://localhost:5173`).

## Environment Variables

| Name | Purpose |
|------|---------|
| `VITE_MAPBOX_ACCESS_TOKEN` | Mapbox token used to authenticate tile requests |

Never commit real tokens. The `.gitignore` excludes `.env` files.

## Code Overview

| Path | Purpose |
|------|---------|
| `src/main.tsx` | App entry point | 
| `src/App.tsx` | Layout (header + map) |
| `src/components/MapView.tsx` | Leaflet map initialization |
| `src/styles.css` | Global styles and layout |

## Changing the Default Map

Edit `DEFAULT_CENTER` and `DEFAULT_ZOOM` in `src/components/MapView.tsx`.

## Mapbox Styles

Default style id: `mapbox/streets-v12`. You can change to other styles (e.g. `mapbox/dark-v11`, `mapbox/outdoors-v12`). Ensure your token has style access.

## Production Build

```bash
npm run build
npm run preview
```

## Next Ideas

- Add layer toggles & basemap switcher
- Geolocation (user position marker)
- Search / geocoding
- Draw & measure tools
- State management (Zustand, Redux) as features grow

## License

Choose a license for distribution (MIT recommended). Not included by default.

---
Happy mapping!
