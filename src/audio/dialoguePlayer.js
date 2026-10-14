// 对话只跟随游戏主循环，无独立 RAF / setTimeout；暂停时字幕、句间停顿和剧情 Promise 一起停。
export function createDialoguePlayer({ show, hide, playVoice, radioOn, radioOff }) {
  let current = null;

  function cancel() {
    if (!current) return;
    const old = current;
    current = null;
    old.voice?.stop();
    hide();
    if (old.radio) radioOff();
    old.resolve(false); // 调用者必须检查 false，不执行被取消对话的剧情续接。
  }

  function beginLine(s) {
    if (current !== s) return;
    if (s.index >= s.lines.length) {
      current = null;
      if (s.radio) radioOff();
      s.resolve(true);
      return;
    }
    const line = s.lines[s.index];
    s.elapsed = 0;
    s.phase = 'line';
    s.result = null;
    s.fallback = (line.ms ?? 1400 + line.text.length * 140) / 1000;
    show(line, s.radio);
    try { s.voice = playVoice(line); } catch { s.voice = null; }
    const voice = s.voice;
    if (voice) Promise.resolve(voice.done).then(
      (ok) => { if (current === s && s.voice === voice) s.result = ok; },
      () => { if (current === s && s.voice === voice) s.result = false; },
    );
  }

  return {
    say(lines, { radio = false } = {}) {
      cancel();
      return new Promise((resolve) => {
        const s = { lines, radio, resolve, index: 0, voice: null };
        current = s;
        if (radio) radioOn();
        beginLine(s);
      });
    },
    update(dt) {
      if (!(dt > 0) || !current) return;
      const s = current;
      s.elapsed += dt;
      if (s.phase === 'gap') {
        if (s.elapsed >= 0.28) { s.index++; beginLine(s); }
      } else if (s.result === true || ((!s.voice || s.result === false) && s.elapsed >= s.fallback)) {
        hide();
        s.voice = null;
        s.phase = 'gap';
        s.elapsed = 0;
      }
    },
    cancel,
    get playing() { return current !== null; },
  };
}
