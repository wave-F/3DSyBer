import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));

// 开发服务器：光照图导出页（bake.html）把静态场景写进 art/bake/（只允许这个目录）
function lightmapSave() {
  const body = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });
  return {
    name: 'lightmap-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__lightmap/save', async (req, res) => {
        const path = new URL(req.url, 'http://x').searchParams.get('path') ?? '';
        const file = resolve(root, path);
        if (relative(resolve(root, 'art/bake'), file).startsWith('..')) { res.statusCode = 403; res.end(); return; }
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, await body(req));
        res.end('ok');
      });
      server.middlewares.use('/__lightmap/done', async (req, res) => {
        const err = (await body(req)).toString();
        mkdirSync(resolve(root, 'art/bake'), { recursive: true });
        writeFileSync(resolve(root, 'art/bake/done.json'), JSON.stringify({ ok: !err, error: err, time: Date.now() }));
        res.end('ok');
      });
    },
  };
}

export default defineConfig({
  plugins: [lightmapSave()],
  build: {
    rolldownOptions: {
      input: {
        game: fileURLToPath(new URL('./index.html', import.meta.url)),
        audio: fileURLToPath(new URL('./audio.html', import.meta.url)),
      },
    },
  },
});
