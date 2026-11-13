import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [
    basicSsl(),
  ],
  server: {
    host: true,
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    minify: 'terser',
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          'model-viewer': ['@google/model-viewer'],
        },
      },
    },
  },
});
