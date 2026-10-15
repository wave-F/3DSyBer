import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// FMOD pthread WASM 使用 SharedArrayBuffer；页面和 Worker 都必须跨源隔离。
const headers = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  server: { headers },
  preview: { headers },
  build: {
    rolldownOptions: {
      input: {
        game: fileURLToPath(new URL('./index.html', import.meta.url)),
        audio: fileURLToPath(new URL('./audio.html', import.meta.url)),
      },
    },
  },
});
