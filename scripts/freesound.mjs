// Freesound 素材检索 / 下载（只收 CC0，无需 API Key，取 HQ 预览 mp3）。
//   node scripts/freesound.mjs search "rain city" [page]
//   node scripts/freesound.mjs get <id> <name>   → Fmod/source/<name>.mp3，并登记到 Fmod/source/credits.json
//   node scripts/freesound.mjs fetch             按 credits.json 重新下载全部素材（mp3 不入库）
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const UA = { 'User-Agent': 'Mozilla/5.0 (3DSyBer sound sourcing)' };
const SOURCE = new URL('../Fmod/source/', import.meta.url);
const [mode, arg, extra] = process.argv.slice(2);

async function page(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

if (mode === 'search') {
  const html = await page(`https://freesound.org/search/?q=${encodeURIComponent(arg)}&f=license:%22Creative+Commons+0%22&page=${extra || 1}`);
  const seen = new Set();
  for (const block of html.split('data-mp3="').slice(1)) {
    const id = block.match(/previews\/\d+\/(\d+)_/)?.[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const title = block.match(/title="([^"]+)"/)?.[1];
    const dur = Number(block.match(/data-duration="([^"]+)"/)?.[1]).toFixed(1);
    console.log(`${id}\t${dur}s\t${title}`);
  }
} else if (mode === 'fetch') {
  const credits = JSON.parse(await readFile(new URL('credits.json', SOURCE), 'utf8'));
  for (const [name, { id }] of Object.entries(credits)) {
    if (existsSync(new URL(`${name}.mp3`, SOURCE))) continue;
    const html = await page(`https://freesound.org/s/${id}/`);
    const mp3 = html.match(/https:\/\/cdn\.freesound\.org\/previews\/[^"]+\.mp3/)?.[0]?.replace('-lq.', '-hq.');
    await writeFile(new URL(`${name}.mp3`, SOURCE), new Uint8Array(await (await fetch(mp3, { headers: UA })).arrayBuffer()));
    console.log(`${name}.mp3`);
  }
} else if (mode === 'get') {
  const html = await page(`https://freesound.org/s/${arg}/`);
  if (!/creativecommons\.org\/publicdomain\/zero/.test(html)) throw new Error(`${arg} is not CC0`);
  const mp3 = html.match(/https:\/\/cdn\.freesound\.org\/previews\/[^"]+\.mp3/)?.[0]?.replace('-lq.', '-hq.');
  if (!mp3) throw new Error(`no preview for ${arg}`);
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/^Freesound - /, '').trim();
  await mkdir(SOURCE, { recursive: true });
  const bytes = new Uint8Array(await (await fetch(mp3, { headers: UA })).arrayBuffer());
  await writeFile(new URL(`${extra}.mp3`, SOURCE), bytes);
  const file = new URL('credits.json', SOURCE);
  const credits = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : {};
  credits[extra] = { id: Number(arg), title, url: `https://freesound.org/s/${arg}/`, license: 'CC0 1.0' };
  await writeFile(file, `${JSON.stringify(credits, null, 2)}\n`);
  console.log(`${extra}.mp3 ← ${title}`);
} else throw new Error('Usage: search <query> [page] | get <id> <name> | fetch');
