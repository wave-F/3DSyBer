import { mkdir, writeFile, access } from 'node:fs/promises';

const output = new URL('../Fmod/3DSyBer/Assets/test/ping.wav', import.meta.url);
// 不覆盖已经制作或手工替换的素材。
try { await access(output); console.log('Test WAV already exists.'); process.exit(0); } catch {}
const rate = 48000;
const duration = 0.65;
const count = Math.round(rate * duration);
const wav = Buffer.alloc(44 + count * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(count * 2, 40);
for (let i = 0; i < count; i++) {
  const t = i / rate;
  let sample = 0;
  for (const [start, frequency] of [[0, 660], [0.17, 990]]) {
    const age = t - start;
    if (age < 0) continue;
    const attack = Math.min(1, age / 0.008);
    const tail = Math.min(1, (duration - t) / 0.04);
    sample += Math.sin(2 * Math.PI * frequency * age) * attack * Math.exp(-age * 12) * tail * 0.25;
  }
  wav.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
}
await mkdir(new URL('.', output), { recursive: true });
await writeFile(output, wav);
console.log('Generated Fmod/3DSyBer/Assets/test/ping.wav');
