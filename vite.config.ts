import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import fs from 'fs';
import { resolve } from 'path';

function readBackendPort(): number {
  if (process.env.BACKEND_PORT) return Number(process.env.BACKEND_PORT);
  try {
    const raw = fs.readFileSync(resolve(__dirname, '.deskit-port'), 'utf8').trim();
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    // use default
  }
  return 3457;
}

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5174,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3457',
        changeOrigin: true,
        router() {
          return `http://127.0.0.1:${readBackendPort()}`;
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      onwarn(warning, defaultHandler) {
        if (warning.code === 'INVALID_ANNOTATION') return;
        defaultHandler(warning);
      },
    },
  }
})
