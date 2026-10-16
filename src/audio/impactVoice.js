// 每次结局只触发一次；暂停、重复跨帧或调试倒带不能再次喊叫。
export function createImpactVoice(playVoice, hitTime) {
  let triggered = false, voice = null;
  function stop() {
    voice?.stop();
    voice = null;
  }
  return {
    reset() { stop(); triggered = false; },
    stop,
    update(before, now) {
      if (triggered || before >= hitTime || now < hitTime) return;
      triggered = true;
      voice = playVoice('fatalImpact_01');
    },
  };
}
