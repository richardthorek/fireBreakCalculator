/**
 * Mapbox Configuration
 * 
 * Manages Mapbox access token configuration with environment variable support.
 * Provides centralized token management for map tiles and services.
 * 
 * @module mapboxToken
 * @version 1.0.0
 */

// Centralized Mapbox access token retrieval.
// Supports both VITE_MAPBOX_ACCESS_TOKEN (preferred) and legacy VITE_MAPBOX_TOKEN.
// Consumers should treat an empty string as undefined.
export const MAPBOX_TOKEN = (
	import.meta.env?.VITE_MAPBOX_ACCESS_TOKEN ||
	import.meta.env?.VITE_MAPBOX_TOKEN ||
	undefined
) as string | undefined;
interface ImportMetaEnv {
	VITE_MAPBOX_ACCESS_TOKEN?: string;
	VITE_MAPBOX_TOKEN?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
