import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite configuration for React project
export default defineConfig({
  plugins: [react()],
  // Use default publicDir so Vite processes `index.html` and rewrites
  // development entry imports during build. Avoid setting publicDir to
  // the project root ('.') because that causes the index to be copied
  // verbatim into `dist` and leads to duplicate/incorrect script tags.
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:7071',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, '/api')
      }
    }
  },
  assetsInclude: ['**/*.csv'],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunk for large external libraries
          vendor: ['react', 'react-dom'],
          // Mapbox chunk for mapping libraries
          mapbox: ['mapbox-gl', '@mapbox/mapbox-gl-draw']
        }
      }
    },
    // Increase chunk size warning limit to 750KB since this is a mapping app
    chunkSizeWarningLimit: 750
  }
});
