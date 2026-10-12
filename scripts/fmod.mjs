import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { BANKS } from '../src/audio/events.js';

const root = new URL('../', import.meta.url);
const project = fileURLToPath(new URL('Fmod/3DSyBer/3DSyBer.fspro', root));
const executable = process.env.FMOD_STUDIO_BIN || '/Applications/FMOD Studio.app/Contents/MacOS/fmodstudio';
const mode = process.argv[2];
if (!['create-test', 'build'].includes(mode)) throw new Error('Usage: node scripts/fmod.mjs create-test|build');
const args = mode === 'build'
  ? ['-build', '-platforms', 'Desktop', '-export-guids', project]
  : ['-script', fileURLToPath(new URL('Fmod/create-test-event.js', root)), project];
// macOS 官方 fmodstudiocl 包装器依赖 tty；直接启动同一二进制的命令行模式。
const result = spawnSync(executable, ['--platform', 'minimal', ...args], {
  cwd: fileURLToPath(root),
  env: { ...process.env, FMODSTUDIOCMDLINE: '1' },
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
if (mode === 'build') {
  const source = new URL('Fmod/3DSyBer/Build/Desktop/', root);
  const destination = new URL('public/fmod/', root);
  // 全部读取成功后才同步，避免缺 Bank 时覆盖一半。
  for (const name of BANKS) {
    const bytes = await readFile(new URL(name, source));
    if (!bytes.length) throw new Error(`Empty bank: ${name}`);
  }
  await mkdir(destination, { recursive: true });
  for (const name of BANKS) await copyFile(new URL(name, source), new URL(name, destination));
  console.log(`Synced ${BANKS.join(', ')} -> public/fmod/`);
}
