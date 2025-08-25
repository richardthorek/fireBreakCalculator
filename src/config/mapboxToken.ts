// Centralized Mapbox access token retrieval
// Consumed by map rendering and elevation (terrain) utilities
export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined;
