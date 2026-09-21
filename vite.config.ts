import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    VitePWA({
      disable: mode === 'capacitor',
      registerType: 'prompt',
      includeAssets: ['**/*'],
      manifest: {
        name: 'Nour Elrahman',
        short_name: 'Casher',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        lang: 'ar',
        dir: 'rtl',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/__\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [],
      },
    }),
  ],
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
}));
