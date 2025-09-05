// Type declarations for leaflet-vector-tile-layer
declare module 'leaflet-vector-tile-layer' {
  import { Layer, LayerOptions } from 'leaflet';

  interface VectorTileLayerOptions extends LayerOptions {
    interactive?: boolean;
    zIndex?: number;
    maxZoom?: number;
    style?: {
      [layerName: string]: {
        stroke?: boolean;
        color?: string;
        weight?: number;
        opacity?: number;
        fill?: boolean;
        lineCap?: string;
        lineJoin?: string;
      };
    };
    filter?: (feature: any) => boolean;
    attribution?: string;
  }

  function vectorTileLayer(url: string, options?: VectorTileLayerOptions): Layer;
  
  export = vectorTileLayer;
}