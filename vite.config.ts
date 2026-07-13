import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Everything used to land in one 1.2 MB entry chunk. Splitting the
        // vendors out means a deploy that only touches app code no longer
        // invalidates React/Leaflet/charts in the browser cache, and the
        // browser fetches them in parallel instead of one long file.
        // Only libraries the entry graph already pulls in. Do NOT add recharts
        // or @dnd-kit here: they are reached exclusively from lazy pages, and
        // naming them as a manual chunk drags them onto the critical path
        // (recharts alone is 388 kB of charts nobody has asked for yet).
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // ExplorePage is the "/" route and renders the map, so Leaflet is
          // eager by definition — but as its own chunk it caches separately.
          'vendor-leaflet': ['leaflet', 'react-leaflet'],
          'vendor-motion': ['framer-motion'],
          'vendor-sentry': ['@sentry/react'],
        },
      },
    },
    // The entry chunk should stay well under this; a breach means something
    // heavy got pulled back into the critical path.
    chunkSizeWarningLimit: 600,
  },
  server: {
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      }
    }
  }
})
