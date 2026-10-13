// 声音编辑工程（按 DAW 思路：剪辑区间 EDL → 分层 → EQ / 动态 / 空间 → 淡入淡出 → 响度/峰值标准化）。
// 输入：Fmod/source/*.mp3（scripts/freesound.mjs 下载的 CC0 素材）
// 输出：Fmod/3DSyBer/Assets/<分类>/*.wav（48 kHz / 16-bit），供 Fmod/build-events.js 导入
// 用法：node scripts/sound-design.mjs [名称过滤]
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../Fmod/source/', import.meta.url));
const OUT = fileURLToPath(new URL('../Fmod/3DSyBer/Assets/', import.meta.url));
const only = process.argv[2];

function ffmpeg(args, level = 'error') {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', level, '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stderr;
}

// 一条片段：素材 + 起点 + 长度 + 处理链 + 在混音中的偏移与增益
const clip = (file, start, dur, { fx = '', delay = 0, gain = 0 } = {}) => ({ file, start, dur, fx, delay, gain });

// 把若干片段混成一条，并做母带链；peak 为峰值目标 dBFS，lufs 为响度目标（环境声用）
function render(name, clips, { master = '', peak = -1, lufs, loop = 0, mono = false } = {}) {
  if (only && !name.includes(only)) return;
  const path = `${OUT}${name}.wav`;
  mkdirSync(path.replace(/[^/]+$/, ''), { recursive: true });
  const inputs = [];
  const chains = clips.map((c, i) => {
    inputs.push('-ss', String(c.start), '-t', String(c.dur + loop), '-i', `${SRC}${c.file}.mp3`);
    const d = Math.round(c.delay * 1000);
    return `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,${c.fx ? `${c.fx},` : ''}volume=${c.gain}dB,adelay=${d}|${d}[c${i}]`;
  });
  let graph = chains.join(';');
  graph += `;${clips.map((_, i) => `[c${i}]`).join('')}amix=inputs=${clips.length}:normalize=0:duration=longest${master ? `,${master}` : ''}`;
  if (loop) {
    // 无缝循环：主体 [0, L] 开头淡入，尾部 [L, L+X] 淡出后叠回开头
    const L = clips[0].dur;
    graph += `,asplit[a][b];[a]atrim=0:${L},afade=t=in:d=${loop}:curve=qsin[h];[b]atrim=${L}:${L + loop},asetpts=PTS-STARTPTS,afade=t=out:d=${loop}:curve=qsin[t];[h][t]amix=inputs=2:normalize=0:duration=first`;
  }
  graph += mono ? ',pan=mono|c0=0.5*c0+0.5*c1[m]' : '[m]';
  const tmp = `${path}.tmp.wav`;
  ffmpeg([...inputs, '-filter_complex', graph, '-map', '[m]', '-c:a', 'pcm_f32le', tmp]);
  // 标准化：环境声按积分响度，单发音效按峰值
  let gain;
  if (lufs != null) {
    const s = ffmpeg(['-i', tmp, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], 'info');
    const I = Number(s.match(/I:\s+(-?[\d.]+) LUFS/g).pop().match(/-?[\d.]+/)[0]);
    gain = lufs - I;
  } else {
    const s = ffmpeg(['-i', tmp, '-af', 'volumedetect', '-f', 'null', '-'], 'info');
    gain = peak - Number(s.match(/max_volume: (-?[\d.]+) dB/)[1]);
  }
  ffmpeg(['-i', tmp, '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=0.95:level=false`, '-c:a', 'pcm_s16le', path]);
  spawnSync('rm', [tmp]);
  console.log(`${name}.wav  ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB`);
}

// ---------------- 环境 ----------------
// 雨：城市稳定雨声为主，叠一层近处的密雨，低切去掉风噪轰鸣
render('amb/rain_bed', [
  clip('amb_rain_city', 12, 60, { fx: 'highpass=f=90,equalizer=f=3500:t=q:w=1:g=-2' }),
  clip('amb_rain_heavy', 3, 60, { fx: 'highpass=f=250,lowpass=f=11000', gain: -9 }),
], { lufs: -22, loop: 3 });
// 远处人群：车站人声做低通 + 早期反射，让它退到桥下街区
render('amb/crowd_distant', [
  clip('amb_crowd_distant', 6, 60, { fx: 'highpass=f=180,lowpass=f=2600,aecho=0.8:0.6:60|130:0.35|0.22' }),
], { lufs: -30, loop: 3 });
// 餐馆：室内录音，强低通模拟隔着雨和距离从街边飘上来
render('amb/restaurant_far', [
  clip('amb_restaurant', 70, 60, { fx: 'highpass=f=220,lowpass=f=1700,aecho=0.8:0.5:90|210:0.3|0.18' }),
], { lufs: -32, loop: 3 });
// 远处车流：夜间高架远景，保留卡车低频，去掉过近的高频细节
render('amb/traffic_far', [
  clip('amb_traffic_highway', 20, 90, { fx: 'highpass=f=35,lowpass=f=5500' }),
], { lufs: -27, loop: 4 });

// ---------------- 脚步 + 衣物 ----------------
// 湿靴脚步（onset 分析得到的起点，提前 20 ms 留出起音）。每步叠一小段尼龙雨衣摩擦
const NYLON = [0.515, 1.215, 3.055, 3.44, 4.17, 5.755, 6.185, 6.575, 8.475, 9.55];
const STEP_FX = 'highpass=f=60,equalizer=f=140:t=q:w=1:g=3,equalizer=f=9000:t=q:w=1:g=-3';
[2.68, 3.755, 4.86, 5.955, 7.075, 7.56, 9.76, 10.835, 11.94, 13.035, 14.155].forEach((t, i) => {
  render(`foley/step_walk_${String(i + 1).padStart(2, '0')}`, [
    clip('fs_wet_boots_walkrun', t - 0.02, 0.45, { fx: `${STEP_FX},afade=t=out:st=0.3:d=0.15` }),
    clip('cloth_nylon_raincoat', NYLON[i % NYLON.length] - 0.05, 0.35, { fx: 'highpass=f=400,afade=t=in:d=0.04,afade=t=out:st=0.2:d=0.15', gain: -12, delay: 0.03 }),
  ], { peak: -3, mono: true });
});
[16.47, 17.285, 18.085, 18.89, 19.735, 20.535, 21.375, 22.225, 23.965, 25.575, 26.38, 27.225].forEach((t, i) => {
  render(`foley/step_run_${String(i + 1).padStart(2, '0')}`, [
    clip('fs_wet_boots_walkrun', t - 0.02, 0.34, { fx: `${STEP_FX},afade=t=out:st=0.22:d=0.12` }),
    clip('cloth_nylon_raincoat', NYLON[(i + 3) % NYLON.length] - 0.05, 0.3, { fx: 'highpass=f=400,afade=t=in:d=0.03,afade=t=out:st=0.15:d=0.15', gain: -7, delay: 0.01 }),
  ], { peak: -2, mono: true });
});
// 停步 / 转身时的衣物摆动
[['cloth_ruffle1', 4.8], ['cloth_ruffle1', 5.67], ['cloth_ruffle1', 6.34], ['cloth_ruffle2', 3.43], ['cloth_ruffle2', 3.88]].forEach(([f, t], i) => {
  render(`foley/cloth_move_${String(i + 1).padStart(2, '0')}`, [
    clip(f, t, 0.6, { fx: 'highpass=f=150,afade=t=in:d=0.02,afade=t=out:st=0.35:d=0.25' }),
  ], { peak: -6 });
});
// 掏出扫描仪：外套摆动 → 皮套抽出 → 握持
render('foley/scanner_draw', [
  clip('cloth_ruffle1', 6.3, 0.5, { fx: 'highpass=f=150,afade=t=out:st=0.3:d=0.2', gain: -6 }),
  clip('holster_removal', 3.95, 1.0, { fx: 'highpass=f=100,afade=t=out:st=0.7:d=0.3', delay: 0.08 }),
], { peak: -4 });
// 收回扫描仪：皮套扣合 + 衣物落下
render('foley/scanner_holster', [
  clip('holster_openclose', 3.5, 0.7, { fx: 'highpass=f=100,afade=t=out:st=0.45:d=0.25' }),
  clip('cloth_ruffle2', 3.85, 0.5, { fx: 'highpass=f=150,afade=t=out:st=0.3:d=0.2', gain: -8, delay: 0.12 }),
], { peak: -5 });
// 拿出 / 收起平板：口袋翻找 + 雨衣摩擦
render('foley/tablet_raise', [
  clip('pocket_rummage', 1.5, 0.8, { fx: 'highpass=f=200,afade=t=in:d=0.03,afade=t=out:st=0.5:d=0.3' }),
  clip('cloth_nylon_raincoat', 1.15, 0.6, { fx: 'highpass=f=300,afade=t=out:st=0.35:d=0.25', gain: -5, delay: 0.05 }),
], { peak: -5 });
render('foley/tablet_lower', [
  clip('cloth_nylon_raincoat', 6.5, 0.5, { fx: 'highpass=f=300,afade=t=out:st=0.3:d=0.2', gain: -3 }),
  clip('pocket_rummage', 3.6, 0.7, { fx: 'highpass=f=200,afade=t=in:d=0.03,afade=t=out:st=0.4:d=0.3', delay: 0.1 }),
], { peak: -5 });

// ---------------- UI ----------------
render('ui/click', [clip('ui_click', 0, 0.3, { fx: 'highpass=f=300' })], { peak: -6 });
render('ui/hover', [clip('ui_menu_click', 0, 0.17, { fx: 'highpass=f=1200,asetrate=48000*1.25,aresample=48000' })], { peak: -16 });
render('ui/deny', [clip('ui_error_beep', 0, 0.6, { fx: 'lowpass=f=5000,afade=t=out:st=0.35:d=0.25' })], { peak: -10 });
render('ui/panel_open', [
  clip('ui_hud_open', 0.3, 1.3, { fx: 'highpass=f=260,afade=t=out:st=0.9:d=0.4' }),
], { peak: -8 });
render('ui/panel_close', [clip('ui_cancel', 0, 0.57, { fx: 'highpass=f=250' })], { peak: -10 });
render('ui/toast', [clip('ui_notify_data', 0, 0.42)], { peak: -10 });
render('ui/confirm', [clip('ui_soft_confirm', 0, 1.2, { fx: 'afade=t=out:st=0.7:d=0.5' })], { peak: -8 });
render('ui/record', [clip('ui_confirm_alert', 0, 1.6, { fx: 'afade=t=out:st=1.0:d=0.6' })], { peak: -7 });
render('ui/radio_on', [clip('radio_squelch', 0, 1.2, { fx: 'highpass=f=300,lowpass=f=4500' })], { peak: -12 });
render('ui/radio_off', [clip('radio_end', 0, 0.43, { fx: 'highpass=f=300,lowpass=f=4500' })], { peak: -12 });

// ---------------- 高科技 ----------------
// Q 扫描：0.5 s 充能（与举枪同长）→ 发射脉冲 + 全息扫掠，带空间回声
render('scifi/scan_pulse', [
  clip('sf_charge_up', 0, 0.55, { fx: 'highpass=f=120,afade=t=in:d=0.1' , gain: -4 }),
  clip('sf_holo_whoosh', 0.28, 2.0, { fx: 'highpass=f=150,afade=t=out:st=1.3:d=0.7,aecho=0.8:0.7:180|360:0.3|0.15', delay: 0.45 }),
  clip('sf_bio_scan', 0, 2.2, { fx: 'highpass=f=400,afade=t=out:st=1.5:d=0.7', gain: -8, delay: 0.5 }),
], { peak: -3 });
// 按住分析：扫描器循环 + 低频发生器嗡声，游戏内按进度推高音高
render('scifi/analyze_loop', [
  clip('sf_scanner_loop', 0, 6, { fx: 'highpass=f=200' }),
  clip('sf_generator_loop', 2, 6, { fx: 'lowpass=f=900', gain: -6 }),
], { lufs: -20, loop: 1.5 });
render('scifi/analyze_complete', [
  clip('sf_bio_scan', 1.98, 1.0, { fx: 'afade=t=out:st=0.6:d=0.4' }),
  clip('ui_confirm_alert', 0, 1.4, { fx: 'afade=t=out:st=0.9:d=0.5', gain: -5, delay: 0.05 }),
], { peak: -4 });
// 中断：把充能声倒放并降调，做成断电下滑
render('scifi/analyze_cancel', [
  clip('sf_charge_up', 0, 1.2, { fx: 'areverse,asetrate=48000*0.7,aresample=48000,afade=t=out:st=0.6:d=0.4' }),
], { peak: -10 });
render('scifi/dream_enter', [
  clip('sf_charge_up', 0, 1.2, { fx: 'asetrate=48000*0.8,aresample=48000', gain: -4 }),
  clip('sf_holo_whoosh', 0, 3, { fx: 'aecho=0.8:0.8:250|500:0.35|0.2', delay: 0.4 }),
], { peak: -3 });
render('scifi/dream_exit', [
  clip('sf_holo_whoosh', 0, 3, { fx: 'areverse,afade=t=in:d=0.3,aecho=0.8:0.6:200:0.3' }),
], { peak: -4 });
