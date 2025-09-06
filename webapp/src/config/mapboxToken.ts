// Centralized Mapbox access token retrieval.
// Supports both VITE_MAPBOX_ACCESS_TOKEN (preferred) and legacy VITE_MAPBOX_TOKEN.
// Consumers should treat an empty string as undefined.
export const MAPBOX_TOKEN = (
	(import.meta as any).env?.VITE_MAPBOX_ACCESS_TOKEN ||
	(import.meta as any).env?.VITE_MAPBOX_TOKEN ||
	undefined
) as string | undefined;
