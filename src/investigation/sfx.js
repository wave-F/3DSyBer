// 程序合成的金属音效（项目还没有音频资源，撬车门先用 WebAudio 临时合成）
let ctx = null;
let noise = null;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noiseBuffer(c) {
  if (noise) return noise;
  noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noise;
}

// 金属摩擦/变形的吱嘎声：窄带噪声扫频 + 低频呻吟，振幅一顿一顿
export function metalCreak(dur, { gain = 0.35, f0 = 500, f1 = 1300, at = 0 } = {}) {
  const c = ac();
  const t0 = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass'; bp.Q.value = 22;
  bp.frequency.setValueAtTime(f0, t0);
  const amp = c.createGain();
  amp.gain.setValueAtTime(0, t0);
  // 分段：每段频率抖一下、音量顿一下，听起来像金属一点点被掰开
  const steps = Math.max(3, Math.round(dur / 0.07));
  for (let i = 1; i <= steps; i++) {
    const u = i / steps, t = t0 + u * dur;
    bp.frequency.linearRampToValueAtTime(f0 + (f1 - f0) * u + (Math.random() - 0.5) * 260, t);
    amp.gain.linearRampToValueAtTime(gain * (0.35 + Math.random() * 0.65) * Math.sin(Math.PI * Math.min(1, u * 1.15)), t);
  }
  amp.gain.linearRampToValueAtTime(0, t0 + dur + 0.05);
  src.connect(bp).connect(amp).connect(c.destination);
  // 低频呻吟：锯齿波过低通
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(70, t0);
  osc.frequency.linearRampToValueAtTime(110, t0 + dur);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 380;
  const og = c.createGain();
  og.gain.setValueAtTime(0, t0);
  og.gain.linearRampToValueAtTime(gain * 0.25, t0 + dur * 0.3);
  og.gain.linearRampToValueAtTime(0, t0 + dur);
  osc.connect(lp).connect(og).connect(c.destination);
  src.start(t0, Math.random()); src.stop(t0 + dur + 0.1);
  osc.start(t0); osc.stop(t0 + dur + 0.1);
}

// 卡扣崩开：短促的噪声爆点 + 一声闷响
export function metalPop({ gain = 0.6, at = 0 } = {}) {
  const c = ac();
  const t0 = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 1800;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
  src.connect(hp).connect(g).connect(c.destination);
  src.start(t0, Math.random()); src.stop(t0 + 0.15);
  const osc = c.createOscillator();
  osc.frequency.setValueAtTime(160, t0);
  osc.frequency.exponentialRampToValueAtTime(55, t0 + 0.25);
  const og = c.createGain();
  og.gain.setValueAtTime(gain * 0.8, t0);
  og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
  osc.connect(og).connect(c.destination);
  osc.start(t0); osc.stop(t0 + 0.32);
}
