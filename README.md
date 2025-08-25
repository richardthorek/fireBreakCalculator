# RFS Fire Break Calculator

Modern React web application to assist rural firefighters in estimating the time and resources required to construct fire breaks and trails using machinery, aircraft, and hand crews. Built with React + Vite + TypeScript and featuring an interactive Leaflet map for geospatial analysis.

## Features

- **Interactive Map-based Planning**: Draw fire break lines directly on the map with real-time distance calculation
- **Resource Library**: Choose from various machinery (dozers, graders), aircraft (helicopters, fixed-wing), and hand crews
- **Intelligent Calculations**: Factor in terrain difficulty and vegetation density for accurate time estimates
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
2. **Set Conditions**: Expand the analysis panel and select terrain difficulty (Easy/Moderate/Difficult/Extreme) and vegetation density (Light/Moderate/Heavy/Extreme)
3. **Select Resources**: Choose from available machinery, aircraft, and hand crews to include in your analysis
4. **View Results**: See estimated completion times and costs for each selected resource type

## Configuration

Resource capabilities and calculation rules are defined in `src/config/defaultConfig.ts`. You can modify:
- **Machinery specifications**: Clearing rates, operating costs, descriptions
- **Aircraft capabilities**: Drop lengths, speeds, turnaround times
- **Hand crew profiles**: Crew sizes, clearing rates per person, tool types
- **Calculation factors**: Terrain and vegetation difficulty multipliers

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
| `src/config/defaultConfig.ts` | Default resource specifications and calculation rules |
| `src/styles.css` | Global styles including analysis panel and drawing tools |

## Technical Details

**Map Features:**
- Line drawing with real-time distance measurement
- Terrain-appropriate styling for fire break visualization
- Edit and delete capabilities for drawn lines
- Popup displays showing calculated distances

**Calculation Engine:**
- Machinery time estimates based on clearing rates and conditions
- Aircraft drop calculations considering coverage and turnaround times
- Hand crew estimates factoring crew size and efficiency
- Terrain and vegetation difficulty multipliers
- Optional cost estimation for operational planning

**Resource Types:**
- **Machinery**: Dozers (D4, D6, D8), Motor Graders with varying capabilities
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

- **Elevation Profile**: Add terrain elevation analysis for more accurate calculations
- **Weather Integration**: Factor weather conditions into resource planning
- **GPS Integration**: Import/export GPX routes for field use
- **Multi-language Support**: Localization for international use
- **Offline Mode**: Cache maps and operate without internet connectivity
- **Report Generation**: Export detailed analysis reports in PDF format

## License

This project is intended for use by Rural Fire Service and emergency response organizations. Choose an appropriate license for distribution.

---

## Contributing

For questions, issues, or contributions, please follow organizational standards for code documentation and testing. All components should include comprehensive comment blocks and adhere to the established folder structure.
