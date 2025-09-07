/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAPBOX_ACCESS_TOKEN: string
  readonly VITE_MAPBOX_TOKEN: string
  readonly VITE_API_BASE_URL?: string
  readonly DEV: boolean
  readonly MODE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Module declarations for Vite asset imports
declare module '*.csv?raw' {
  const content: string
  export default content
}