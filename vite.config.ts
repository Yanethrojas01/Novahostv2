import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  esbuild: { // Configure esbuild options for project TS/JSX files
    // Using 'esnext' implies support for latest features including top-level await
    target: 'esnext', 
    supported: { // Explicitly state support for top-level-await
      'top-level-await': true,
    },
  },
  build: {
    // Target modern browsers that support top-level await (ES2022)
    // Required because @novnc/novnc uses top-level await
    // Using 'esnext' for production build as well for consistency
    target: 'esnext', 
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
    include: [
      '@novnc/novnc/core/input/keysym',
      '@novnc/novnc/core/input/keysymdef',
      '@novnc/novnc/core/util/browser'
    ],
    // Explicitly set esbuild target for dependency optimization (pre-bundling)
    esbuildOptions: {
      target: 'esnext', // Use 'esnext' for pre-bundling as well
      supported: { // Explicitly state support for top-level-await here too
        'top-level-await': true,
      },
    },
  },
});
