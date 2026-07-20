# 🔥 Fire Break Calculator

A modern geospatial planning tool designed to help rural firefighters and emergency response teams efficiently plan fire breaks and trails. Get instant estimates for time, cost, and resource requirements using various equipment types, aircraft, and hand crews.

[![License](https://img.shields.io/badge/license-see%20LICENSE-blue)](#license) 
[![Azure Functions](https://img.shields.io/badge/backend-Azure%20Functions-0078d4)]()
[![React](https://img.shields.io/badge/frontend-React%20%2B%20Vite-61dafb)]()

## ✨ What This Tool Does

**Plan fire breaks with confidence** by drawing routes on an interactive map and getting immediate analysis including:

- 📏 **Real-time distance calculation** as you draw
- ⛰️ **Automated slope analysis** with equipment compatibility checking  
- 🌿 **Vegetation assessment** using NSW Government data
- ⚡ **Equipment recommendations** for machinery, aircraft, and hand crews
- 💰 **Cost and time estimates** with terrain and vegetation factors
- 🚁 **Aircraft drop pattern preview** with visual markers
- 📱 **Mobile-optimized** touch controls for field use

## 🚀 Getting Started

### For Users

There's no standalone user guide yet (tracked in `master_plan.md`) — the tool
is designed to be usable from the in-app UI alone. Quick Start below covers
the whole workflow.

**Quick Start:**
1. Open the application in your web browser
2. Draw a fire break route on the map by clicking points
3. Select terrain conditions (easy, moderate, difficult, extreme)
4. Choose vegetation density (light, moderate, heavy, extreme)  
5. Pick equipment types to compare options
6. Review time, cost, and compatibility results

### For Administrators & Developers
- **📋 [System Requirements & Setup](README-local-dev.md)** - Installation and configuration
- **📘 [Master Plan](master_plan.md)** - Vision, current state, roadmap, decisions (the single source of truth — start here)
- **🏗️ [Technical docs](docs/README.md)** - Architecture, calculation model, vegetation data, route intelligence, GIS interop, AI assistant
- **🤝 [Contributing Guidelines](CONTRIBUTING.md)** - How to contribute to the project

## 🎯 Key Features

### Interactive Planning
- **Smart Drawing Tools**: Touch-optimized map interface with polyline drawing
- **Real-time Feedback**: Distance updates as you draw your fire break route
- **Visual Analysis**: Color-coded slope segments and vegetation overlays

### Equipment Analysis  
- **Machinery Options**: Dozers, graders with slope compatibility checking
- **Aircraft Resources**: Helicopters and fixed-wing with drop pattern preview
- **Hand Crews**: Various crew sizes and specializations
- **Multi-resource Comparison**: Select multiple options to find the best approach

### Advanced Analytics
- **Slope Analysis**: Automatic terrain assessment every 100m along your route
- **Vegetation Intelligence**: Integration with NSW Government vegetation databases
- **Compatibility Checking**: Equipment limitations automatically flagged
- **Cost Optimization**: Compare scenarios to find most cost-effective solutions

### Mobile & Accessibility
- **Touch Controls**: Optimized for tablets and smartphones in the field
- **Responsive Design**: Works on all screen sizes
- **Accessibility**: WCAG 2.1 AA compliant with screen reader support

## 📊 Data Sources & Attribution

This application integrates with several authoritative data sources:

### Map Data & Imagery
- **[Mapbox](https://www.mapbox.com/)** - Base map tiles, satellite imagery, and terrain data
  - *License*: [Mapbox Terms of Service](https://www.mapbox.com/legal/tos)
  - *Attribution*: © Mapbox © OpenStreetMap contributors
  - *Usage*: Requires valid Mapbox access token

### Vegetation Data
- **[NSW Department of Planning and Environment](https://www.dpie.nsw.gov.au/)** - Plant Community Type (PCT) vegetation classifications
  - *Service*: SVTM NSW Extant PCT ArcGIS MapServer
  - *URL*: `https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/VIS/SVTM_NSW_Extant_PCT/MapServer`
  - *Attribution*: © State of New South Wales through Department of Planning and Environment
  - *License*: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)
  - *Data Currency*: Updated regularly by NSW Government

### Equipment & Configuration Data
- **Azure Table Storage** - Equipment specifications and vegetation mappings
  - *Hosted*: Microsoft Azure Cloud Services
  - *Management*: Configurable via API endpoints
  - *Backup*: Automated Azure backup policies

### Elevation Data
- **Primary**: A bare-earth Digital Elevation Model (DEM), sampled server-side
  via an ArcGIS ImageServer
- **Fallback**: When the DEM endpoint is unavailable, elevation is flagged
  `usedMockElevation`/`estimated` end to end (including exports) rather than
  presented as real — see the "Data honesty" principle in `master_plan.md`

## 🗂️ Project Structure

```
📁 fireBreakCalculator/
├── 📁 webapp/              # React frontend application
│   └── 📁 src/            # Source code and components
├── 📁 api/                # Azure Functions backend API
│   └── 📁 src/           # API functions and data access
├── 📁 scripts/           # Utility and seed scripts
└── 📁 docs/              # As-built technical docs (see docs/README.md)
```

## 🛠️ Technology Stack

### Frontend
- **React 18** with TypeScript for robust UI development
- **Vite** for fast development and optimized builds
- **Mapbox GL JS** for interactive mapping
- **Modern CSS** with responsive design patterns

### Backend  
- **Azure Functions** (Node.js/TypeScript) for serverless API
- **Azure Table Storage** for equipment and configuration data
- **RESTful API** design with optimistic concurrency control

### Infrastructure
- **Azure Cloud Services** for hosting and data storage
- **GitHub Actions** for CI/CD (planned)
- **Environment-based configuration** for flexible deployments

## 📱 Device Compatibility

### Recommended Browsers
- Chrome 90+ (optimal performance)
- Firefox 88+, Safari 14+, Edge 90+
- Mobile browsers on iOS Safari and Android Chrome

### Hardware Requirements
- **Desktop/Laptop**: Modern processor, 4GB+ RAM
- **Tablets**: iPad (iOS 14+), Android tablets (Android 10+)  
- **Smartphones**: iOS 14+, Android 10+ (limited screen real estate)

### Network Requirements
- **Internet connection required** for map tiles and vegetation data
- **Bandwidth**: 2+ Mbps recommended for smooth map interaction
- **Offline mode**: Planned for future release

## 🚀 Quick Deployment Guide

### Prerequisites
- Node.js 18+ and npm
- Azure subscription (for production)
- Mapbox account and access token

### Development Setup
```bash
# Clone and install dependencies
git clone <repo-url>
cd rfsFireBreakCalculator
cd api && npm install && cd ..
cd webapp && npm install && cd ..

# Configure environment variables
# (See README-local-dev.md for detailed instructions)

# Start development servers
cd api && npm start &      # Azure Functions (port 7071)
cd webapp && npm run dev   # Vite dev server (port 5173)
```

### Production Deployment
See [deployment documentation](README-local-dev.md#deployment) for Azure-specific setup instructions.

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for:
- 🐛 Bug reports and feature requests
- 💻 Code contributions and pull request process  
- 📝 Documentation improvements
- 🧪 Testing guidelines

## 📄 License

This project is licensed under the terms specified in the [LICENSE](LICENSE) file.

## 📞 Support

- **💡 Feature Suggestions**: Click the "💡 Suggest Feature" button in the analysis panel to submit feature requests directly
- **🆘 Issues**: Report bugs or request features via [GitHub Issues](../../issues)
- **📚 Documentation**: Browse [`docs/`](docs/README.md) and [`master_plan.md`](master_plan.md)
- **👥 Community**: Contact your local Rural Fire Service IT support team

### Feature Suggestion Button
The Fire Break Calculator includes a convenient "💡 Suggest Feature" button located at the bottom of the analysis panel, next to the "Buy Me A Coffee" button. This button:
- Directs users to GitHub's issue creation page with a pre-filled feature request template
- Automatically applies the "enhancement" label for easy categorization
- Provides a direct channel for user feedback and feature suggestions
- Opens in a new tab to preserve your current planning session

---

## 📈 Roadmap

The roadmap lives in one place — **[`master_plan.md`](master_plan.md)** (status
board + prioritised steps) — to avoid this README drifting out of sync with it.
Don't duplicate roadmap items here; update the master plan instead.

*For technical detail on any feature, see [`docs/`](docs/README.md).*

---
**Last Updated**: 2026-07-19
