// 调查界面：全部为 HTML 叠加层（细线、编号、等宽数字，接近底特律的界面风格）

const CSS = `
.inv { position: fixed; pointer-events: none; font-family: "PingFang SC", "Helvetica Neue", sans-serif; color: #dff2ff; user-select: none; }
.inv-mono { font-family: "SF Mono", Menlo, monospace; letter-spacing: 0.04em; }
#inv-hud { left: 32px; top: 25%; transform: translateY(-6px) scale(1.5); transform-origin: left bottom; opacity: 0; transition: opacity .4s; }
#inv-hud.on { opacity: 1; }
#inv-hud .mode { font-size: 13px; letter-spacing: .32em; color: #6cc8ff; display: flex; align-items: center; gap: 10px; }
#inv-hud .mode::before { content: ''; width: 8px; height: 8px; border: 1px solid currentColor; transform: rotate(45deg); flex: none; }
#inv-hud .count { margin-top: 8px; font-size: 22px; font-weight: 300; transition: opacity .32s ease, transform .32s ease; }
#inv-hud .count small { font-size: 12px; opacity: .6; margin-left: 8px; letter-spacing: .2em; }
#inv-hud .count b { font-weight: 500; color: #ffcf4a; }
#inv-hud .bar { margin-top: 8px; width: 220px; height: 2px; background: rgba(108,200,255,.2); transition: opacity .32s ease, transform .32s ease; }
#inv-hud .bar i { display: block; height: 100%; width: 0; background: #6cc8ff; transition: width .4s; }
#inv-hud.done .count { color: #b6f3c6; }
#inv-hud.ready .mode, #inv-hud.ready .count { color: #ffcf4a; }
#inv-hud.ready .mode::before { border-color: #ffcf4a; }
#inv-hud.ready .bar i { background: #ffcf4a; }
#inv-hud.out .count, #inv-hud.out .bar { opacity: 0; transform: translateY(-12px); }
#inv-hud.in .count, #inv-hud.in .bar { animation: inv-task-in .42s ease; }
@keyframes inv-task-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
#inv-solved { left: 32px; top: 25%; transform: translateY(-6px) scale(1.5); transform-origin: left bottom; font-size: 12px; letter-spacing: .3em; color: #ffb35c; opacity: 0; transition: opacity .4s; }
#inv-solved.on { opacity: .9; }
#inv-hint { left: 32px; bottom: 28px; font-size: 12px; opacity: .55; letter-spacing: .08em; line-height: 1.9; }
#inv-hint.recon { left: 50%; bottom: 36px; width: min(900px, 86vw); transform: translateX(-50%); text-align: center; }
#inv-hint b { display: inline-block; min-width: 18px; padding: 0 5px; margin-right: 6px; border: 1px solid rgba(223,242,255,.5); text-align: center; font-weight: 400; }
#inv-markers { inset: 0; }
.inv-mk { position: absolute; transform: translate(-50%, -50%) scale(1.5); transition: opacity .3s; }
.inv-mk .d { width: 16px; height: 16px; border: 1.5px solid #ffcf4a; transform: rotate(45deg); background: rgba(255,207,74,.12); box-shadow: 0 0 10px rgba(255,207,74,.5); }
.inv-mk .n { position: absolute; left: 22px; top: -3px; font-size: 11px; color: #ffcf4a; white-space: nowrap; letter-spacing: .1em; }
.inv-mk.done .d { border-color: #e8f6ff; background: rgba(232,246,255,.15); box-shadow: none; }
.inv-mk.done .n { color: #e8f6ff; opacity: .7; }
.inv-mk.aim .d { width: 22px; height: 22px; margin: -3px; background: rgba(255,207,74,.3); }
.inv-mk.pop .d { animation: inv-pop .5s ease-out; }
@keyframes inv-pop { 0% { transform: rotate(45deg) scale(2.4); opacity: 0; } 100% { transform: rotate(45deg) scale(1); opacity: 1; } }
#inv-prompt { left: 50%; bottom: 190px; transform: translateX(-50%); font-size: 14px; letter-spacing: .12em; padding: 8px 18px; border: 1px solid rgba(108,200,255,.5); background: rgba(4,12,20,.55); opacity: 0; transition: opacity .2s; white-space: nowrap; }
#inv-prompt.on { opacity: 1; }
#inv-prompt.gold { border-color: rgba(255,179,92,.7); color: #ffd9a8; }
#inv-analysis { inset: 0; opacity: 0; transition: opacity .18s; z-index: 2; }
#inv-analysis.on { opacity: 1; }
#inv-analysis .target { position: absolute; width: 136px; height: 108px; transform: translate(-50%, -50%); color: #eac65a; transition: width .2s, height .2s; }
#inv-analysis.working .target, #inv-analysis.complete .target { width: 116px; height: 92px; }
#inv-analysis .corner { position: absolute; width: 10px; height: 10px; border: 0 solid currentColor; }
#inv-analysis .a { left: 0; top: 0; border-top-width: 2px; border-left-width: 2px; }
#inv-analysis .b { right: 0; top: 0; border-top-width: 2px; border-right-width: 2px; }
#inv-analysis .c { left: 0; bottom: 0; border-bottom-width: 2px; border-left-width: 2px; }
#inv-analysis .d { right: 0; bottom: 0; border-bottom-width: 2px; border-right-width: 2px; }
#inv-analysis .readout { position: absolute; width: 310px; color: #ffcf4a; transform: perspective(850px) rotateY(-9deg) rotateZ(2deg); transform-origin: left center; text-shadow: 0 1px 5px rgba(0,10,20,.9); }
#inv-analysis .readout::before { content: ''; position: absolute; left: -12px; top: -14px; bottom: -10px; width: 1px; background: linear-gradient(transparent, rgba(255,207,74,.45), transparent); }
#inv-analysis .heading { display: flex; align-items: center; gap: 18px; min-height: 54px; }
#inv-analysis .percent { font-size: 25px; font-weight: 300; font-variant-numeric: tabular-nums; }
#inv-analysis .status { margin-top: 2px; font-size: 16px; letter-spacing: .14em; }
#inv-analysis .track { margin-top: 12px; height: 2px; background: rgba(255,207,74,.22); }
#inv-analysis .fill { display: block; width: 100%; height: 100%; background: #ffcf4a; transform: scaleX(0); transform-origin: left; }
#inv-analysis .caption { margin-top: 9px; color: rgba(255,214,120,.9); font-size: 11px; letter-spacing: .12em; }
#inv-analysis:not(.working):not(.complete) .percent, #inv-analysis:not(.working):not(.complete) .track { display: none; }
#inv-analysis.complete .target { color: #90dcff; }
#inv-analysis.complete .fill { background: #cff0ff; }
#inv-panel { left: 0; top: 0; width: min(560px, 44vw); display: flex; gap: 22px; align-items: flex-start; opacity: 0; transition: opacity .35s; border-left: 2px solid #6cc8ff; padding: 18px 22px; background: linear-gradient(90deg, rgba(6,18,30,.82), rgba(6,18,30,.35)); z-index: 3; }
#inv-panel.on { opacity: 1; }
#inv-panel .txt { flex: 1; min-width: 0; }
#inv-panel .pic { position: relative; width: 250px; height: 250px; flex: none; margin-top: 4px; }
#inv-panel .pic .img { position: absolute; inset: 0; background-size: cover; background-position: center; clip-path: inset(0 0 100% 0); animation: inv-wipe .9s .25s cubic-bezier(.2,.7,.2,1) forwards; filter: saturate(.85) contrast(1.05); }
#inv-panel .pic .img::after { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(0deg, rgba(0,0,0,.18) 0 1px, transparent 1px 3px); }
#inv-panel .pic .scan { position: absolute; left: 0; right: 0; height: 2px; top: 0; background: #6cc8ff; box-shadow: 0 0 12px #6cc8ff; opacity: 0; animation: inv-scanline .9s .25s cubic-bezier(.2,.7,.2,1) forwards; }
#inv-panel .pic .cn { position: absolute; width: 14px; height: 14px; border: 0 solid #6cc8ff; }
#inv-panel .pic .cn.a { left: -6px; top: -6px; border-left-width: 2px; border-top-width: 2px; }
#inv-panel .pic .cn.b { right: -6px; top: -6px; border-right-width: 2px; border-top-width: 2px; }
#inv-panel .pic .cn.c { left: -6px; bottom: -6px; border-left-width: 2px; border-bottom-width: 2px; }
#inv-panel .pic .cn.d { right: -6px; bottom: -6px; border-right-width: 2px; border-bottom-width: 2px; }
#inv-panel .pic .cap { position: absolute; left: 0; bottom: -22px; font-size: 10px; letter-spacing: .2em; color: #6cc8ff; opacity: .8; }
#inv-panel .pic .box { position: absolute; left: 30%; top: 32%; width: 40%; height: 36%; border: 1px solid rgba(255,207,74,.9); opacity: 0; animation: inv-in .3s 1.2s forwards; }
@keyframes inv-wipe { to { clip-path: inset(0 0 0 0); } }
@keyframes inv-scanline { 0% { top: 0; opacity: 1; } 90% { opacity: 1; } 100% { top: 100%; opacity: 0; } }
#inv-panel .tag { font-size: 11px; letter-spacing: .3em; color: #6cc8ff; }
#inv-panel h2 { margin: 6px 0 14px; font-size: 22px; font-weight: 500; letter-spacing: .08em; }
#inv-panel .ln { font-size: 14px; line-height: 1.75; opacity: 0; transform: translateX(-6px); animation: inv-in .35s forwards; }
#inv-panel .ln::before { content: '— '; color: #6cc8ff; }
#inv-panel .res { margin-top: 16px; padding-top: 12px; border-top: 1px solid rgba(108,200,255,.3); font-size: 15px; color: #ffd27a; opacity: 0; animation: inv-in .35s forwards; }
#inv-panel .prob { display: flex; align-items: center; gap: 10px; margin-top: 8px; font-size: 12px; opacity: 0; animation: inv-in .35s forwards; }
#inv-panel .prob .pb { flex: 1; height: 3px; background: rgba(255,210,122,.2); }
#inv-panel .prob .pb i { display: block; height: 100%; background: #ffd27a; width: 0; transition: width 1s ease-out; }
@keyframes inv-in { to { opacity: 1; transform: none; } }
#inv-toast { left: 50%; top: 12%; transform: translateX(-50%); text-align: center; opacity: 0; transition: opacity .4s; }
#inv-toast.on { opacity: 1; }
#inv-toast .t1 { font-size: 11px; letter-spacing: .4em; color: #6cc8ff; }
#inv-toast .t2 { margin-top: 8px; font-size: 18px; letter-spacing: .06em; }
#inv-toast.big { padding: 12px 22px; background: rgba(5,12,20,.62); border: 1px solid rgba(255,207,74,.7); }
#inv-toast.big .t1 { font-size: 12px; letter-spacing: .36em; }
#inv-toast.big .t2 { margin-top: 8px; font-size: 22px; letter-spacing: .08em; color: #ffcf4a; }
#inv-tl { left: 50%; bottom: 84px; width: min(900px, 70vw); transform: translateX(-50%); opacity: 0; transition: opacity .4s; }
#inv-tl.on { opacity: 1; }
#inv-tl .head { display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; letter-spacing: .25em; color: #6cc8ff; margin-bottom: 14px; }
#inv-tl .head .count { font-size: 13px; letter-spacing: .14em; color: #9fd4ff; }
#inv-tl .track { position: relative; display: flex; align-items: center; gap: 3px; height: 14px; }
#inv-tl .track > i { position: relative; z-index: 1; flex: 1; height: 14px; background: rgba(176,186,198,.32); }
#inv-tl .track > i.past { background: rgba(236,242,248,.92); }
#inv-tl .track > i.now { z-index: 3; background: #3aa7ff; box-shadow: 0 0 8px rgba(58,167,255,.85); }
#inv-tl .gap { position: relative; flex: 0 0 14px; align-self: stretch; background: repeating-linear-gradient(90deg, rgba(255,255,255,.7) 0 1px, transparent 1px 3px); }
#inv-tl .gap span { position: absolute; bottom: 22px; transform: translateX(-40%); font-size: 10px; white-space: nowrap; letter-spacing: .12em; color: rgba(232,246,255,.7); }
#inv-tl .clock { position: absolute; top: 20px; transform: translateX(-50%); font-size: 12px; letter-spacing: .08em; color: #7ec8ff; white-space: nowrap; }
#inv-tl .ev { position: absolute; z-index: 2; top: 0; height: 14px; background: rgba(255,207,74,.72); }
#inv-tl .ev.rec { background: #ffcf4a; }
#inv-tl .ev.near { box-shadow: 0 0 8px #ffcf4a; }
#inv-evlabels { inset: 0; }
.inv-evl3 { position: absolute; transform: translate(-50%, -100%); font-size: 12px; padding: 3px 8px; border: 1px solid rgba(255,207,74,.6); color: #ffcf4a; background: rgba(5,10,16,.5); white-space: nowrap; letter-spacing: .08em; transition: opacity .2s; }
.inv-evl3.rec { border-color: rgba(255,255,255,.6); color: #fff; }
.inv-evl3.near { background: rgba(255,207,74,.25); }
#inv-sub { left: 50%; bottom: 128px; transform: translateX(-50%); max-width: 64vw; text-align: center; font-size: 22px; line-height: 1.6; letter-spacing: .06em; color: #f2f6fa; text-shadow: 0 2px 6px rgba(0,0,0,.95), 0 0 18px rgba(0,0,0,.7); opacity: 0; transition: opacity .25s; z-index: 6; }
#inv-sub.on { opacity: 1; }
#inv-sub.lift { bottom: calc(11vh + 36px); }
#inv-sub .who { color: #6cc8ff; margin-right: 12px; font-size: 18px; letter-spacing: .2em; }
#inv-sub.radio .who::before { content: '◉ '; color: #ff8a1a; }
#inv-sub.inner { font-style: italic; color: #e6e0d4; }
#inv-ptr { left: 0; top: 0; transform: translate(-50%, -50%); opacity: 0; transition: opacity .3s; z-index: 4; }
#inv-ptr.on { opacity: 1; }
#inv-ptr .ar { width: 0; height: 0; border-left: 13px solid transparent; border-right: 13px solid transparent; border-bottom: 22px solid #ffcf4a; filter: drop-shadow(0 0 6px rgba(255,207,74,.8)); margin: 0 auto; }
#inv-ptr .lb { margin-top: 8px; font-size: 13px; letter-spacing: .25em; color: #ffcf4a; white-space: nowrap; text-align: center; text-shadow: 0 1px 4px #000; }
#inv-ptr.onscreen .ar { display: none; }
#inv-ptr.onscreen .lb { margin-top: 36px; }
#inv-cine { inset: 0; z-index: 8; }
#inv-cine::before, #inv-cine::after { content: ''; position: absolute; left: 0; right: 0; height: 0; background: #000; transition: height .35s ease; }
#inv-cine::before { top: 0; }
#inv-cine::after { bottom: 0; }
#inv-cine.on::before, #inv-cine.on::after { height: 11vh; }
#inv-black { inset: 0; background: #000; opacity: 0; z-index: 9; }
#inv-ending { inset: 0; z-index: 10; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; opacity: 0; transition: opacity 1.2s; }
#inv-ending.on { opacity: 1; }
#inv-ending h1 { margin: 0 0 22px; font-size: 34px; font-weight: 400; letter-spacing: .5em; color: #9fb4c4; }
#inv-ending .ln { font-size: 19px; letter-spacing: .12em; color: #d8e2ea; opacity: 0; animation: inv-in .8s forwards; }
#inv-ending .back { margin-top: 48px; font-size: 13px; letter-spacing: .3em; color: #ffcf4a; opacity: 0; animation: inv-in .8s forwards; }
#inv-flash { inset: 0; background: radial-gradient(circle at 60% 55%, rgba(255,170,60,.55), rgba(255,120,20,.15) 60%, transparent); opacity: 0; z-index: 5; mix-blend-mode: screen; }
`;

// 证据图（Gemini 生成），启动时预加载，避免面板弹出时图片还没到
const clueImage = (c) => `/assets/gen/clue_${c.id}.jpg`;
export function preloadClueImages(clues) {
  clues.forEach((c) => { const i = new Image(); i.src = clueImage(c); });
}

function el(id, cls = '', html = '') {
  const d = document.createElement('div');
  d.id = id;
  d.className = `inv ${cls}`;
  d.innerHTML = html;
  document.body.appendChild(d);
  return d;
}

export function createUI() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const hud = el('inv-hud', '', `<div class="mode"><span>分析模式</span></div><div class="count inv-mono">0 / 0<small>线索</small></div><div class="bar"><i></i></div>`);
  const solved = el('inv-solved', '', '◆ 案件已重建');
  const hint = el('inv-hint');
  const markers = el('inv-markers');
  const evlabels = el('inv-evlabels');
  const prompt = el('inv-prompt');
  const analysis = el('inv-analysis', '', `<div class="target"><i class="corner a"></i><i class="corner b"></i><i class="corner c"></i><i class="corner d"></i></div>
    <div class="readout"><div class="heading"><div><div class="percent inv-mono"></div><div class="status"></div></div></div>
    <div class="track" role="progressbar" aria-label="线索分析" aria-valuemin="0" aria-valuemax="100"><i class="fill"></i></div><div class="caption"></div></div>`);
  const analysisTarget = analysis.querySelector('.target');
  const readout = analysis.querySelector('.readout');
  const analysisPercent = analysis.querySelector('.percent');
  const analysisStatus = analysis.querySelector('.status');
  const analysisFill = analysis.querySelector('.fill');
  const analysisTrack = analysis.querySelector('.track');
  const analysisCaption = analysis.querySelector('.caption');
  const panel = el('inv-panel');
  const toast = el('inv-toast', '', '<div class="t1"></div><div class="t2"></div>');
  const tl = el('inv-tl');
  const sub = el('inv-sub');
  const ptr = el('inv-ptr', '', '<div class="ar"></div><div class="lb"></div>');
  const cine = el('inv-cine');
  const black = el('inv-black');
  const flash = el('inv-flash');
  const ending = el('inv-ending');
  let panelTimer = 0, toastTimer = 0, toastHold = null;
  let sayToken = 0;

  const HINTS = {
    explore: '<b>WASD</b>移动　<b>Shift</b>跑　<b>Q</b>扫描线索　<b>E</b>按住分析　<b>TAB</b>平板',
    exploreReady: '<b>WASD</b>移动　<b>Shift</b>跑　<b>Q</b>扫描线索　<b>E</b>按住分析　<b>R</b>启动黑梦　<b>TAB</b>平板',
    recon: '<b>滚轮</b>拖动时间　<b>空格</b>播放 / 暂停　<b>E</b>记录事件 / 按住分析全息　<b>Q</b>退出黑梦',
  };

  const markerEls = new Map();
  const evEls = [];
  const markPos = new Map();
  let clueId = null;

  // 分析面板挂在探索点所在的世界位置右侧。离开画面或走到点后面就看不见，不拉回屏幕内
  function placePanel(x, y, front) {
    const gap = 200;
    const pw = panel.offsetWidth || 560;
    const ph = panel.offsetHeight || 280;
    const left = x + gap;
    const top = y - ph * 0.4;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    const onScreen = front && left + pw > 0 && left < innerWidth && top + ph > 0 && top < innerHeight;
    panel.style.visibility = onScreen ? '' : 'hidden';
  }

  return {
    setMode(mode, label) {
      this._mode = mode;
      hud.classList.toggle('on', mode === 'explore' || mode === 'recon');
      hud.querySelector('.mode span').textContent = label;
      hint.innerHTML = HINTS[mode === 'explore' && this._ready ? 'exploreReady' : mode] ?? '';
      hint.classList.toggle('recon', mode === 'recon');
      if (mode !== 'explore' && mode !== 'recon') { markers.style.opacity = 0; this.setAnalysis(null); this.hidePanel(); }
      else markers.style.opacity = 1;
      if (mode !== 'explore') this.setPointer(null);
      if (mode === 'cut') { clearTimeout(toastTimer); toast.classList.remove('on'); }
      sub.style.bottom = mode === 'recon' ? '250px' : '';   // 黑梦里避开时间轴
      const ch = document.getElementById('crosshair');
      if (ch) ch.style.opacity = mode === 'cut' ? 0 : '';
      evlabels.style.opacity = mode === 'recon' ? 1 : 0;
      tl.classList.toggle('on', mode === 'recon');
    },
    setHint(ready) {
      this._ready = ready;
      if (this._mode === 'explore') hint.innerHTML = HINTS[ready ? 'exploreReady' : 'explore'];
    },
    // 平板举起时隐藏屏幕上的常驻界面
    setTabletOpen(on) {
      for (const e of [hud, hint, markers, solved, document.getElementById('crosshair')]) if (e) e.style.visibility = on ? 'hidden' : '';
      if (on) { prompt.classList.remove('on'); this.setAnalysis(null); }
    },
    // 线索计数位置改为显示任务目标（html），进度条清空
    setObjective(html) {
      clearTimeout(this._taskTimer);
      clearTimeout(this._taskTimer2);
      this._countStamp = `objective:${html}`;
      this._taskReady = false;
      hud.classList.remove('done', 'out', 'ready');
      hud.querySelector('.count').innerHTML = html;
      hud.querySelector('.bar i').style.width = '0%';
      hud.classList.add('in');
      setTimeout(() => hud.classList.remove('in'), 460);
    },
    setSolved(text) { if (text) solved.textContent = text; solved.classList.toggle('on', !!text); },
    setCounter(done, total, label = '线索') {
      const count = hud.querySelector('.count');
      const bar = hud.querySelector('.bar i');
      const taskDone = this._mode === 'explore' && label === '线索' && total > 0 && done >= total;
      const stamp = `${this._mode}:${label}:${done}/${total}:${taskDone}`;
      if (stamp === this._countStamp) return;
      this._countStamp = stamp;
      clearTimeout(this._taskTimer);
      clearTimeout(this._taskTimer2);
      const show = (html, width, ready) => {
        count.innerHTML = html;
        bar.style.width = width;
        hud.classList.toggle('ready', ready);
      };
      // 线索刚满：先停在 3/3，再切成「按 R 构建黑梦」
      if (taskDone && !this._taskReady) {
        this._taskReady = true;
        hud.classList.remove('in', 'out', 'ready');
        hud.classList.add('done');
        show(`${done} / ${total}<small>${label}完成</small>`, '100%', false);
        this._taskTimer = setTimeout(() => {
          hud.classList.add('out');
          this._taskTimer2 = setTimeout(() => {
            hud.classList.remove('done', 'out');
            show('按 <b>R</b> 构建<small>黑梦</small>', '100%', true);
            hud.classList.add('in');
            setTimeout(() => hud.classList.remove('in'), 460);
          }, 340);
        }, 640);
        return;
      }
      this._taskReady = taskDone;
      hud.classList.remove('done', 'out', 'in');
      show(taskDone ? '按 <b>R</b> 构建<small>黑梦</small>' : `${done} / ${total}<small>${label}</small>`, `${total ? (done / total) * 100 : 0}%`, taskDone);
    },
    // list: [{ id, x, y, show, done, aim, label }]
    updateMarkers(list) {
      for (const m of list) {
        let e = markerEls.get(m.id);
        if (!e) {
          e = document.createElement('div');
          e.className = 'inv-mk';
          e.innerHTML = `<div class="d"></div><div class="n"></div>`;
          e.style.opacity = 0;
          markers.appendChild(e);
          markerEls.set(m.id, e);
        }
        if (m.show && !e._shown) { e.classList.remove('pop'); void e.offsetWidth; e.classList.add('pop'); }
        e._shown = m.show;
        e.style.opacity = m.show ? 1 : 0;
        e.style.left = `${m.x}px`;
        e.style.top = `${m.y}px`;
        e.classList.toggle('done', m.done);
        e.classList.toggle('aim', m.aim);
        e.querySelector('.n').textContent = m.label;
        markPos.set(m.id, m);
      }
      if (clueId) {
        const m = markPos.get(clueId);
        if (m) placePanel(m.x, m.y, m.front);
      }
    },
    setPrompt(text, gold = false) {
      if (text) prompt.textContent = text;
      prompt.classList.toggle('on', !!text);
      prompt.classList.toggle('gold', gold);
    },
    setAnalysis(target, p = 0, phase = 'ready') {
      const visible = target?.front && target.x > 0 && target.x < innerWidth && target.y > 0 && target.y < innerHeight;
      analysis.classList.toggle('on', !!visible);
      if (!visible) return;
      analysis.classList.toggle('working', phase === 'working');
      analysis.classList.toggle('complete', phase === 'complete');
      analysisTarget.style.left = `${target.x}px`;
      analysisTarget.style.top = `${target.y}px`;
      // Keep the readout beside the evidence, with a fixed readable size and edge clearance.
      const width = 310, height = 122, margin = 32;
      let x = target.x + 92;
      if (x + width > innerWidth - margin) x = target.x - width - 92;
      readout.style.left = `${Math.max(margin, Math.min(innerWidth - width - margin, x))}px`;
      readout.style.top = `${Math.max(margin, Math.min(innerHeight - height - margin, target.y - 142))}px`;
      const progress = Math.max(0, Math.min(1, p));
      const percent = phase === 'complete' ? 100 : Math.min(99, Math.floor(progress * 100));
      analysisPercent.textContent = `${percent}%`;
      analysisStatus.textContent = phase === 'complete' ? '分析完成' : phase === 'working'
        ? progress < 0.3 ? '探头接通' : progress < 0.85 ? '读取表面特征' : '证据比对'
        : '按住 E 分析';
      analysisCaption.textContent = phase === 'ready' ? '' : target.name;
      analysisFill.style.transform = `scaleX(${progress})`;
      analysisTrack.setAttribute('aria-valuenow', String(percent));
    },
    showClue(c, index) {
      clearTimeout(panelTimer);
      clueId = c.id;
      const lines = c.lines.map((l, i) => `<div class="ln" style="animation-delay:${0.15 + i * 0.35}s">${l}</div>`).join('');
      const dl = 0.15 + c.lines.length * 0.35;
      const no = String(index + 1).padStart(2, '0');
      const tag = c.probe ? '黑梦分析 · 全息重建' : `证据 #${no} · 已分析`;
      const pic = c.probe ? '' : `<div class="pic"><div class="img" style="background-image:url(${clueImage(c)})"></div><div class="scan"></div>
        <div class="box"></div><i class="cn a"></i><i class="cn b"></i><i class="cn c"></i><i class="cn d"></i>
        <div class="cap inv-mono">影像记录 · EV-${no}</div></div>`;
      panel.innerHTML = `<div class="txt"><div class="tag inv-mono">${tag}</div><h2>${c.name}</h2>${lines}
        <div class="res" style="animation-delay:${dl}s">${c.result}</div>
        <div class="prob inv-mono" style="animation-delay:${dl + 0.2}s"><span>概率</span><div class="pb"><i></i></div><span>${Math.round(c.prob * 100)}%</span></div></div>
        ${pic}`;
      panel.classList.add('on');
      const m = markPos.get(c.id);
      if (m) placePanel(m.x, m.y, m.front);
      setTimeout(() => { const i = panel.querySelector('.pb i'); if (i) i.style.width = `${c.prob * 100}%`; }, (dl + 0.3) * 1000);
      panelTimer = setTimeout(() => { panel.classList.remove('on'); panel.style.visibility = ''; clueId = null; }, 4000);
    },
    hidePanel() { clearTimeout(panelTimer); panel.classList.remove('on'); panel.style.visibility = ''; clueId = null; },
    // ms 为 0 时不自动消失，直到下一条提示或 clearToast
    toast(t1, t2, ms = 3200) {
      clearTimeout(toastTimer);
      const big = ms === 0;
      if (big) toastHold = [t1, t2];
      toast.querySelector('.t1').textContent = t1;
      toast.querySelector('.t2').textContent = t2;
      toast.classList.toggle('big', big);
      toast.classList.add('on');
      if (ms > 0) toastTimer = setTimeout(() => {
        if (toastHold) this.toast(toastHold[0], toastHold[1], 0);
        else toast.classList.remove('on', 'big');
      }, ms);
    },
    clearToast() {
      clearTimeout(toastTimer);
      toastHold = null;
      toast.classList.remove('on', 'big');
    },
    buildTimeline(events, duration, jumpT, jumpLabel, frac, title = 'BLACKDREAM · 黑梦回放') {
      const CELLS = 72;
      this._frac = frac;
      this._cells = CELLS;
      this._evSpan = events.map((e) => [frac(e.t0 ?? e.t), frac(e.t1 ?? e.t)]);
      const jumpAt = jumpT == null ? null : Math.round(frac(jumpT) * CELLS);
      const before = jumpAt == null ? CELLS : jumpAt;
      const cell = (i) => `<i data-i="${i}"></i>`;
      const strip = Array.from({ length: before }, (_, i) => cell(i)).join('')
        + (jumpAt == null ? '' : `<b class="gap"><span>${jumpLabel}</span></b>`)
        + Array.from({ length: CELLS - before }, (_, i) => cell(before + i)).join('');
      tl.innerHTML = `<div class="head"><span>${title}</span><span class="count inv-mono"></span></div>
        <div class="track">${strip}
        ${events.map((e, i) => `<div class="ev" data-i="${i}"></div>`).join('')}
        <div class="clock inv-mono">00:00.0</div></div>`;
    },
    // recorded / nearIdx 按 buildTimeline 传入的标记顺序；countText 为标题右侧的计数文字
    updateTimeline(t, duration, clockText, recorded, nearIdx, countText = '') {
      const track = tl.querySelector('.track');
      if (!track) return;
      const cells = track.querySelectorAll(':scope > i');
      const n = cells.length || this._cells || 1;
      const head = Math.round(this._frac(t) * (n - 1));
      const half = 2;
      cells.forEach((el) => {
        const i = +el.dataset.i;
        el.className = i < head - half ? 'past' : (i <= head + half ? 'now' : '');
      });
      const anchor = cells[Math.max(0, Math.min(n - 1, head))];
      const clock = tl.querySelector('.clock');
      clock.textContent = clockText;
      if (anchor) {
        const cr = track.getBoundingClientRect();
        const ar = anchor.getBoundingClientRect();
        clock.style.left = `${ar.left - cr.left + ar.width / 2}px`;
      }
      const done = recorded.filter(Boolean).length;
      tl.querySelector('.count').textContent = countText;
      const cr = track.getBoundingClientRect();
      const xAt = (f) => {
        const x = Math.max(0, Math.min(n - 1, f * (n - 1)));
        const i = Math.min(n - 1, Math.floor(x + 1e-6));
        const cell = cells[i].getBoundingClientRect();
        if (i >= n - 1) return cell.right;
        const next = cells[i + 1].getBoundingClientRect();
        return cell.left + (next.left - cell.left) * (x - i);
      };
      tl.querySelectorAll('.ev').forEach((e) => {
        const i = +e.dataset.i;
        e.classList.toggle('rec', recorded[i]);
        e.classList.toggle('near', i === nearIdx);
        const span = this._evSpan[i] ?? [0, 0];
        const left = xAt(span[0]);
        const right = xAt(span[1]);
        e.style.left = `${left - cr.left}px`;
        e.style.width = `${Math.max(2, right - left)}px`;
      });
    },
    // list: [{ x, y, show, rec, near }]
    updateEventLabels(list) {
      list.forEach((m, i) => {
        const e = evEls[i];
        if (!e) return;
        e.style.opacity = m.show ? 1 : 0;
        e.style.left = `${m.x}px`;
        e.style.top = `${m.y}px`;
        e.classList.toggle('rec', m.rec);
        e.classList.toggle('near', m.near);
      });
    },
    // 字幕：逐条显示，返回 Promise。who 为空是内心独白；radio 为无线电通话
    say(lines, { radio = false } = {}) {
      const token = ++sayToken;
      return lines.reduce((p, l) => p.then(() => new Promise((res) => {
        if (token !== sayToken) return res();
        const lift = cine.classList.contains('on') ? ' lift' : '';
        sub.className = `inv on${l.who ? (radio && l.who !== '陈墨' ? ' radio' : '') : ' inner'}${lift}`;
        sub.innerHTML = l.who ? `<span class="who">${l.who}</span>${l.text}` : l.text;
        const ms = l.ms ?? 1400 + l.text.length * 140;
        setTimeout(() => { if (token === sayToken) sub.classList.remove('on'); setTimeout(res, 280); }, ms);
      })), Promise.resolve());
    },
    // 方向标记：目标在屏幕内时只显示文字，在屏幕外时箭头贴边指向目标
    setPointer(p) {
      if (!p) { ptr.classList.remove('on'); return; }
      ptr.querySelector('.lb').textContent = p.label;
      const m = 70;
      let { x, y } = p;
      const on = p.front && x > m && x < innerWidth - m && y > m && y < innerHeight - m;
      ptr.classList.add('on');
      ptr.classList.toggle('onscreen', on);
      const ar = ptr.querySelector('.ar');
      if (on) { ptr.style.left = `${x}px`; ptr.style.top = `${y}px`; return; }
      // 相机后方时投影点会翻转，取反方向
      const cx = innerWidth / 2, cy = innerHeight / 2;
      let dx = x - cx, dy = y - cy;
      if (!p.front) { dx = -dx; dy = -dy; }
      if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = 1;
      const k = Math.min((cx - m) / Math.abs(dx || 1e-3), (cy - m) / Math.abs(dy || 1e-3));
      ptr.style.left = `${cx + dx * k}px`;
      ptr.style.top = `${cy + dy * k}px`;
      ar.style.transform = `rotate(${Math.atan2(dy, dx) + Math.PI / 2}rad)`;
    },
    setCinema(on) { cine.classList.toggle('on', on); sub.classList.toggle('lift', on); },
    hush() { sayToken++; sub.classList.remove('on'); },
    // 黑场：a 为不透明度，ms 为过渡时长
    black(a, ms = 0) { black.style.transition = `opacity ${ms}ms`; black.style.opacity = a; },
    flash(a, ms = 0) { flash.style.transition = `opacity ${ms}ms`; flash.style.opacity = a; },
    // 结局黑场文字：{ title, lines, back }；传 null 隐藏
    ending(d) {
      if (!d) { ending.classList.remove('on'); return; }
      ending.innerHTML = `<h1>${d.title}</h1>`
        + d.lines.map((l, i) => `<div class="ln" style="animation-delay:${0.8 + i * 1.1}s">${l}</div>`).join('')
        + `<div class="back" style="animation-delay:${1.2 + d.lines.length * 1.1}s">${d.back}</div>`;
      ending.classList.add('on');
    },
  };
}
