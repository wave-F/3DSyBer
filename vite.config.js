import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        game: fileURLToPath(new URL('./index.html', import.meta.url)),
        audio: fileURLToPath(new URL('./audio.html', import.meta.url)),
      },
    },
  },
});
