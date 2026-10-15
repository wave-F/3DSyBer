// 台词对象 → 配音 ID。只在中文原文和录音时的原文（VOICE_LINES.source）逐字一致时才播，改过的台词只走字幕、不错配声音。
// 先找同组里逐字相同的录音；同组没有时，全局只有一条逐字相同才用（台词挪了组还能播），有多条就不播，避免相同的字配错段。
// 键用中文原对象：英文模式下 LINES 返回 bi() 代理，用 RAW 取回原对象再查。
import { RAW } from '../i18n.js';

export function createVoiceMap(lines, clips) {
  const byGroup = new Map(), byText = new Map();
  for (const [id, clip] of Object.entries(clips)) {
    if (clip?.source == null) continue;
    const group = id.replace(/_\d+$/, '');
    if (!byGroup.has(group)) byGroup.set(group, new Map());
    const inGroup = byGroup.get(group);
    if (!inGroup.has(clip.source)) inGroup.set(clip.source, id);
    byText.set(clip.source, [...(byText.get(clip.source) ?? []), id]);
  }

  const ids = new WeakMap();
  for (const [group, list] of Object.entries(lines[RAW] ?? lines)) {
    if (!Array.isArray(list)) continue;   // dreamGuide 等函数型台词没有配音
    for (const line of list) {
      const hits = byText.get(line.text);
      const id = byGroup.get(group)?.get(line.text) ?? (hits?.length === 1 ? hits[0] : undefined);
      if (id) ids.set(line, id);
    }
  }
  return (line) => (line ? ids.get(line[RAW] ?? line) : undefined);
}
