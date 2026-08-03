import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Vite configuration for React project
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // @firebreak/terrain (OCOKA 2, docs/ROUTE_INTELLIGENCE.md §38) is a
      // source alias, not an npm dependency — see shared/terrain/README.md
      // for why (Azure SWA's Oryx remote build has no workspace awareness).
      '@firebreak/terrain': path.resolve(__dirname, '../shared/terrain/src/index.ts'),
    }
  },
  // Use default publicDir so Vite processes `index.html` and rewrites
  // development entry imports during build. Avoid setting publicDir to
  // the project root ('.') because that causes the index to be copied
  // verbatim into `dist` and leads to duplicate/incorrect script tags.
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:7071',
        changeOrigin: true,
        secure: false
      }
    }
  },
  assetsInclude: ['**/*.csv'],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/react')) {
            return 'vendor';
          }
          if (id.includes('node_modules/mapbox-gl') || id.includes('node_modules/@mapbox/mapbox-gl-draw')) {
            return 'mapbox';
          }
        }
      }
    },
    // Increase chunk size warning limit to 750KB since this is a mapping app
    chunkSizeWarningLimit: 750
  }
});
