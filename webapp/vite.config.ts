import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite configuration for React project
export default defineConfig({
  plugins: [react()],
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
