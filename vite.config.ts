
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // CRITICAL: Base must be relative for Capacitor to load assets from file system
  base: './',
  esbuild: {
    drop: ['console', 'debugger'],
  },
  build: {
    target: 'chrome87', // Better compatibility for Android WebViews
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1600, // Increase limit for Firebase
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom', 'lucide-react', 'react-hot-toast'],
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/performance'],
          utils: ['zustand'],
        },
      },
    },
  },
});
