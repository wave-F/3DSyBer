// 台词对象 → 配音 ID。配音按「组名_序号」对应，但只在中文原文和录音时的原文（VOICE_LINES.source）一致时才播，
// 改过的台词只走字幕、不错配声音。键用中文原对象：英文模式下 LINES 返回 bi() 代理，用 RAW 取回原对象再查。
import { RAW } from '../i18n.js';

export function createVoiceMap(lines, clips) {
  const ids = new WeakMap();
  for (const [group, list] of Object.entries(lines[RAW] ?? lines)) {
    if (!Array.isArray(list)) continue;   // dreamGuide 等函数型台词没有配音
    list.forEach((line, i) => {
      const id = `${group}_${String(i + 1).padStart(2, '0')}`;
      if (clips[id]?.source === line.text) ids.set(line, id);
    });
  }
  return (line) => (line ? ids.get(line[RAW] ?? line) : undefined);
}
