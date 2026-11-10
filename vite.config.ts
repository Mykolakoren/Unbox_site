import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Номер сборки (10.11, владелец): кладём в код и в dist/version.json. Открытая
// вкладка сверяет свой номер с файлом на сервере и, если вышла новая версия,
// просит обновить страницу (src/components/UpdateBanner.tsx). Иначе старая
// вкладка работает по старым правилам — так 09.11 у админа не было поля
// «причина», которое сервер уже требовал.
const BUILD_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

function buildVersionFile(): Plugin {
  return {
    name: 'unbox-build-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), buildVersionFile()],
  define: {
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(BUILD_ID),
  },
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
          // Волна 2 (G1-25, X5-10): vendor-leaflet убран. Карты на «/» давно
          // нет, а именованный чанк заставлял браузер качать Leaflet
          // (modulepreload, ~43 КБ gz) на каждой странице. Если карта снова
          // понадобится — импортировать её лениво на своей странице.
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
