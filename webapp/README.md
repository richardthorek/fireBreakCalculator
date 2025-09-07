# Fire Break Calculator

Modern React web application to assist emergency responders in estimating the time and resources required to construct fire breaks and trails using machinery, aircraft, and hand crews. Built with React + Vite + TypeScript and featuring an interactive Leaflet map for geospatial analysis.

## Features

- **Interactive Map-based Planning**: Draw fire break lines directly on the map with real-time distance calculation
- **Automated Vegetation Analysis**: Mapbox Terrain v2 integration automatically detects vegetation type/density with manual override option
- **Resource Library**: Choose from various machinery (dozers, graders), aircraft (helicopters, fixed-wing), and hand crews
- **Intelligent Calculations**: Factor in terrain difficulty and auto-detected vegetation density for accurate time estimates
- **Slope Analysis**: Real-time slope calculation and visualization with equipment compatibility checks
- **Cost Analysis**: View estimated operational costs for different resource combinations
- **Responsive Design**: Collapsible analysis panel with full mobile support
- **Configurable Rules**: All equipment specifications and calculation rules defined in editable configuration files

## Getting Started

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure Mapbox access token:**
   ```bash
   cp .env.example .env
   # Edit .env and set VITE_MAPBOX_ACCESS_TOKEN with your Mapbox token
   # Get a free token at: https://account.mapbox.com/
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```

4. **Open the application:**
   Navigate to the printed local URL (usually `http://localhost:5173`)

## How to Use

1. **Draw a Fire Break**: Use the drawing tool (pencil icon) in the top-right corner to draw a line on the map representing your proposed fire break route
2. **Automatic Analysis**: The system automatically analyzes slope and vegetation along your route using elevation data and Mapbox Terrain v2
3. **Review Auto-Detection**: Check the auto-detected vegetation type and confidence level, or manually override if needed
4. **Select Resources**: Choose from available machinery, aircraft, and hand crews to include in your analysis
5. **View Results**: See estimated completion times and costs for each selected resource type

## Configuration

Calculation rules are defined in `src/config/defaultConfig.ts`. You can modify:
- **Calculation factors**: Terrain and vegetation difficulty multipliers

Resource specifications (machinery, aircraft, hand crews) are now dynamically loaded from the API backend and stored in Azure Table Storage. No hardcoded equipment is used in the application.

## Environment Variables

| Name | Purpose |
|------|---------|
| `VITE_MAPBOX_ACCESS_TOKEN` | Mapbox token used to authenticate tile requests |

Never commit real tokens. The `.gitignore` excludes `.env` files.

## Code Overview

| Path | Purpose |
|------|---------|
| `src/main.tsx` | App entry point with CSS imports |
| `src/App.tsx` | Root component managing state between map and analysis panel |
| `src/components/MapView.tsx` | Leaflet map with drawing tools and distance calculation |
| `src/components/AnalysisPanel.tsx` | Resource selection and calculation display |
| `src/types/config.ts` | TypeScript interfaces for resource configurations |
| `src/config/defaultConfig.ts` | Default calculation rules (resource specifications come from API) |
| `src/styles.css` | Global styles including analysis panel and drawing tools |

## Technical Details

**Map Features:**
- Line drawing with real-time distance measurement
- **Automated vegetation analysis** using Mapbox Terrain v2 for intelligent landcover detection
- **Slope analysis and visualization** with color-coded terrain difficulty
- Terrain-appropriate styling for fire break visualization
- Edit and delete capabilities for drawn lines
- Popup displays showing calculated distances, slope information, and vegetation analysis

**Calculation Engine:**
- Machinery time estimates based on clearing rates and conditions
- **Automated vegetation detection** with confidence scoring and manual override
- **Slope compatibility checks** with equipment capability limits
- Aircraft drop calculations considering coverage and turnaround times
- Hand crew estimates factoring crew size and efficiency
- Terrain and vegetation difficulty multipliers
- Optional cost estimation for operational planning

**Resource Types:**
- **Machinery**: Dozers (D4, D6, D7, D8), Motor Graders with **slope capability limits**
- **Aircraft**: Light/Medium Helicopters, Fixed-wing aircraft with different drop patterns
- **Hand Crews**: Standard, Rapid Response, and Heavy Clearing crews

## Changing the Default Map Location

Edit `DEFAULT_CENTER` and `DEFAULT_ZOOM` in `src/components/MapView.tsx`. Current default shows New South Wales, Australia.

## Mapbox Configuration

Default style: `mapbox/streets-v12`. You can change to other styles (e.g. `mapbox/dark-v11`, `mapbox/outdoors-v12`). Ensure your token has style access.

## Production Build

```bash
npm run build
npm run preview
```

## Future Enhancements

- **Enhanced Vector Tile Integration**: Full MVT parsing for more detailed Mapbox Terrain v2 analysis
- **Enhanced Elevation Integration**: Replace mock elevation data with real topographic services
- **Weather Integration**: Factor weather conditions into resource planning
- **GPS Integration**: Import/export GPX routes for field use
- **Multi-language Support**: Localization for international use
- **Offline Mode**: Cache maps and operate without internet connectivity
- **Report Generation**: Export detailed analysis reports in PDF format
- **Route Optimization**: Suggest alternative routes based on slope, vegetation, and terrain analysis

## License

This project is intended for use by Rural Fire Service and emergency response organizations. Choose an appropriate license for distribution.

---

## Contributing

For questions, issues, or contributions, please follow organizational standards for code documentation and testing. All components should include comprehensive comment blocks and adhere to the established folder structure.
