import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  esbuild: { 
    target: 'esnext', 
    supported: { 
      'top-level-await': true,
    },
  },
  build: {
    target: 'esnext', 
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
    // Ya que noVNC se carga desde CDN, no necesita estar en 'include'
    include: [/* Si tienes otros non-noVNC items, mantenlos aquí */],
    esbuildOptions: {
      target: 'esnext', 
      supported: { 
        'top-level-await': true,
      },
    },
  },
});