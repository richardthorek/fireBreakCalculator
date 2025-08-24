# Architecture Overview

This project is intentionally lightweight. Below is a quick overview of present and near-term structure.

## Current

- React functional components (no global state yet)
- Single `MapView` component encapsulates Leaflet setup & teardown
- Environment variable pattern for secrets (`import.meta.env` via Vite)

## Design Principles

1. Separation of concerns: UI layout vs geospatial logic
2. Environment isolation: tokens never hardcoded
3. Progressive enhancement: base map first, add features incrementally

## Planned Expansion (Optional)

| Potential Feature | Suggested Approach |
|-------------------|--------------------|
| Basemap switcher | Maintain array of style configs, update tile layer |
| User location | `navigator.geolocation` -> Leaflet marker & accuracy circle |
| Drawing tools | Integrate `leaflet-draw` plugin lazily |
| Search/geocode | Mapbox Geocoding API (fetch wrapper + debounced input) |
| State management | Introduce Zustand for ephemeral UI state |
| Theming | CSS variables / Tailwind optional integration |

## Component Responsibilities

- `App`: Layout shell (header + main content)
- `MapView`: Map lifecycle, tile layer, basic marker, error handling

## Environment & Build

Vite handles module bundling & dev server. TypeScript strict mode ensures safer refactors as complexity grows.

## Performance Notes

- Map container isolated to avoid unnecessary re-renders
- Future layers should use refs & imperative Leaflet APIs for performance

## Testing (Future)

- Unit: utility functions (to be added later)
- Integration: React Testing Library + jsdom rendering of `MapView` (mock Leaflet)

## Security Considerations

- Do not expose privileged Mapbox scopes in public tokens
- Add rate limiting / caching in backend if geocoding or heavy API usage is added

---
End of document.
