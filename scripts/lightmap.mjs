// 光照图烘焙：npm run lightmap [export|bake]
//   export  起开发服务器，用无头 Chrome 打开 bake.html，把代码生成的静态场景导出到 art/bake/
//   bake    Blender 后台打开 art/city.blend（不保存），跑 tools/blender/scene_bake.py，产出 public/assets/lightmap/ 和 public/assets/bldg/
//   不带参数 = 先 export 再 bake
// 环境变量：BLENDER（Blender 可执行文件）、CHROME、LM_SAMPLES（Cycles 采样，默认 1024）、LM_QUICK=1（低采样试跑）
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const root = fileURLToPath(new URL('..', import.meta.url));
const step = process.argv[2] ?? 'all';

const BLENDERS = [
  process.env.BLENDER,
  '/Applications/Blender.app/Contents/MacOS/Blender',
  `${homedir()}/Library/Application Support/Steam/steamapps/common/Blender/Blender.app/Contents/MacOS/Blender`,
];
const CHROMES = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
const pick = (list, what) => {
  const f = list.find((p) => p && existsSync(p));
  if (!f) throw new Error(`找不到 ${what}，用环境变量指定`);
  return f;
};

function run(cmd, args, opts = {}) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`${cmd} 退出码 ${code}`))));
  });
}

async function exportScene() {
  const { createServer } = await import('vite');
  const server = await createServer({ root, logLevel: 'warn', server: { port: 5199, strictPort: false } });
  await server.listen();
  const url = `${server.resolvedUrls.local[0]}bake.html`;
  const done = resolve(root, 'art/bake/done.json');
  rmSync(done, { force: true });
  console.log('导出静态场景：', url);
  const chrome = spawn(pick(CHROMES, 'Chrome'), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${resolve(root, 'art/bake/.chrome')}`, url,
  ], { stdio: 'ignore' });
  const t0 = Date.now();
  while (!existsSync(done)) {
    if (Date.now() - t0 > 180000) { chrome.kill(); await server.close(); throw new Error('导出超时'); }
    await new Promise((r) => setTimeout(r, 500));
  }
  chrome.kill();
  await server.close();
  const res = JSON.parse(readFileSync(done, 'utf8'));
  if (!res.ok) throw new Error(`导出失败：\n${res.error}`);
  const json = JSON.parse(readFileSync(resolve(root, 'art/bake/scene.json'), 'utf8'));
  console.log(`导出完成：${json.objects.length} 个物体，${json.lights.length} 盏灯，${(statSync(resolve(root, 'art/bake/scene.bin')).size / 1048576).toFixed(1)} MB`);
  for (const [k, a] of Object.entries(json.atlases)) console.log(`  图集 ${k}：${a.charts} 块，缩放 ${a.scale}，hash ${a.hash}`);
}

async function bake() {
  const blender = pick(BLENDERS, 'Blender');
  await run(blender, ['-b', resolve(root, 'art/city.blend'), '--python', resolve(root, 'tools/blender/scene_bake.py'), '--', root]);
}

if (step === 'export' || step === 'all') await exportScene();
if (step === 'bake' || step === 'all') await bake();
