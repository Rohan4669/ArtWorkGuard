import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss()],
    server: { port: 5173, proxy: { '/api': { target: env.VITE_DEV_PROXY_TARGET || 'http://localhost:4000', changeOrigin: false } } },
    build: { chunkSizeWarningLimit: 1500 },
    test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.js'], css: false },
  };
});
