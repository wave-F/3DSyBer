// 调查界面：全部为 HTML 叠加层（细线、编号、等宽数字，接近底特律的界面风格）

const CSS = `
.inv { position: fixed; pointer-events: none; font-family: "PingFang SC", "Helvetica Neue", sans-serif; color: #dff2ff; user-select: none; }
.inv-mono { font-family: "SF Mono", Menlo, monospace; letter-spacing: 0.04em; }
#inv-hud { left: 32px; top: 25%; transform: translateY(-6px) scale(1.5); transform-origin: left bottom; opacity: 0; transition: opacity .4s; }
#inv-hud.on { opacity: 1; }
#inv-hud .mode { font-size: 13px; letter-spacing: .32em; color: #6cc8ff; display: flex; align-items: center; gap: 10px; }
#inv-hud .mode::before { content: ''; width: 8px; height: 8px; border: 1px solid #6cc8ff; transform: rotate(45deg); }
#inv-hud .count { margin-top: 8px; font-size: 22px; font-weight: 300; }
#inv-hud .count small { font-size: 12px; opacity: .6; margin-left: 8px; letter-spacing: .2em; }
#inv-hud .bar { margin-top: 8px; width: 220px; height: 2px; background: rgba(108,200,255,.2); }
#inv-hud .bar i { display: block; height: 100%; width: 0; background: #6cc8ff; transition: width .4s; }
#inv-solved { left: 32px; top: 25%; transform: translateY(-6px) scale(1.5); transform-origin: left bottom; font-size: 12px; letter-spacing: .3em; color: #ffb35c; opacity: 0; transition: opacity .4s; }
#inv-solved.on { opacity: .9; }
#inv-hint { left: 32px; bottom: 28px; font-size: 12px; opacity: .55; letter-spacing: .08em; line-height: 1.9; }
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
#inv-hold { left: 50%; top: 50%; width: 44px; height: 44px; margin: -22px; opacity: 0; }
#inv-hold.on { opacity: 1; }
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
#inv-toast { left: 50%; top: 18%; transform: translateX(-50%); text-align: center; opacity: 0; transition: opacity .4s; }
#inv-toast.on { opacity: 1; }
#inv-toast .t1 { font-size: 11px; letter-spacing: .4em; color: #6cc8ff; }
#inv-toast .t2 { margin-top: 8px; font-size: 18px; letter-spacing: .06em; }
#inv-tl { left: 50%; bottom: 84px; width: min(900px, 70vw); transform: translateX(-50%); opacity: 0; transition: opacity .4s; }
#inv-tl.on { opacity: 1; }
#inv-tl .head { display: flex; justify-content: space-between; font-size: 12px; letter-spacing: .25em; color: #6cc8ff; margin-bottom: 40px; }
#inv-tl .head .clock { font-size: 16px; color: #e8f6ff; letter-spacing: .08em; }
#inv-tl .track { position: relative; height: 2px; background: rgba(108,200,255,.3); }
#inv-tl .fill { position: absolute; left: 0; top: 0; height: 100%; background: #6cc8ff; }
#inv-tl .ph { position: absolute; top: -9px; width: 2px; height: 20px; background: #fff; box-shadow: 0 0 8px #6cc8ff; }
#inv-tl .ev { position: absolute; top: -6px; width: 10px; height: 10px; margin-left: -5px; border: 1.5px solid #ffcf4a; transform: rotate(45deg); background: rgba(5,10,16,.8); }
#inv-tl .ev.rec { background: #ffcf4a; }
#inv-tl .ev.near { box-shadow: 0 0 12px #ffcf4a; width: 14px; height: 14px; margin-left: -7px; top: -8px; }
#inv-tl .evl { position: absolute; top: 14px; transform: translateX(-50%); font-size: 11px; white-space: nowrap; color: #ffcf4a; opacity: .75; }
#inv-tl .evl.rec { color: #fff; opacity: .9; }
#inv-tl .evl.up { top: -30px; }
#inv-tl .jump { position: absolute; top: -14px; height: 30px; border-left: 1px dashed rgba(255,255,255,.5); }
#inv-tl .jump span { position: absolute; top: -16px; left: 6px; font-size: 10px; white-space: nowrap; opacity: .6; letter-spacing: .1em; }
#inv-evlabels { inset: 0; }
.inv-evl3 { position: absolute; transform: translate(-50%, -100%); font-size: 12px; padding: 3px 8px; border: 1px solid rgba(255,207,74,.6); color: #ffcf4a; background: rgba(5,10,16,.5); white-space: nowrap; letter-spacing: .08em; transition: opacity .2s; }
.inv-evl3.rec { border-color: rgba(255,255,255,.6); color: #fff; }
.inv-evl3.near { background: rgba(255,207,74,.25); }
#inv-end { inset: 0; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle, rgba(4,10,18,.75), rgba(2,5,9,.92)); opacity: 0; transition: opacity .8s; }
#inv-end.on { opacity: 1; }
#inv-end .box { width: min(760px, 80vw); }
#inv-end .tag { font-size: 12px; letter-spacing: .5em; color: #6cc8ff; }
#inv-end h1 { margin: 10px 0 26px; font-size: 34px; font-weight: 400; letter-spacing: .12em; }
#inv-end .f { font-size: 15px; line-height: 2; opacity: 0; animation: inv-in .4s forwards; }
#inv-end .f .ts { color: #6cc8ff; margin-right: 14px; }
#inv-end .v { margin-top: 26px; padding-top: 20px; border-top: 1px solid rgba(255,179,92,.4); opacity: 0; animation: inv-in .5s forwards; }
#inv-end .v .vd { font-size: 26px; color: #ffb35c; letter-spacing: .1em; }
#inv-end .v .pr { margin-top: 6px; font-size: 13px; opacity: .8; }
#inv-end .v p { font-size: 14px; line-height: 1.9; opacity: .85; }
#inv-end .k { margin-top: 26px; font-size: 12px; opacity: .5; letter-spacing: .2em; }
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

  const hud = el('inv-hud', '', `<div class="mode">分析模式</div><div class="count inv-mono">0 / 0<small>线索</small></div><div class="bar"><i></i></div>`);
  const solved = el('inv-solved', '', '◆ 案件已重建');
  const hint = el('inv-hint');
  const markers = el('inv-markers');
  const evlabels = el('inv-evlabels');
  const prompt = el('inv-prompt');
  const hold = el('inv-hold', '', `<svg viewBox="0 0 44 44" width="44" height="44"><circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,207,74,.25)" stroke-width="2"/><circle id="inv-hold-c" cx="22" cy="22" r="18" fill="none" stroke="#ffcf4a" stroke-width="2.5" stroke-dasharray="113.1" stroke-dashoffset="113.1" transform="rotate(-90 22 22)"/></svg>`);
  const holdC = hold.querySelector('#inv-hold-c');
  const panel = el('inv-panel');
  const toast = el('inv-toast', '', '<div class="t1"></div><div class="t2"></div>');
  const tl = el('inv-tl');
  const end = el('inv-end');
  let panelTimer = 0, toastTimer = 0;

  const HINTS = {
    explore: '<b>Q</b>扫描线索　<b>E</b>按住分析　<b>TAB</b>平板',
    exploreReady: '<b>Q</b>扫描线索　<b>E</b>按住分析　<b>R</b>开始事件重建　<b>TAB</b>平板',
    recon: '<b>滚轮</b>拖动时间　<b>空格</b>播放 / 暂停　<b>E</b>记录事件　<b>Q</b>退出重建',
    end: '',
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
      hud.querySelector('.mode').textContent = label;
      hint.innerHTML = HINTS[mode === 'explore' && this._ready ? 'exploreReady' : mode] ?? '';
      if (mode !== 'explore') { markers.style.opacity = 0; this.setHold(0); this.hidePanel(); }
      else markers.style.opacity = 1;
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
      if (on) { prompt.classList.remove('on'); this.setHold(0); }
    },
    setSolved(on) { solved.classList.toggle('on', on); },
    setCounter(done, total, label = '线索') {
      hud.querySelector('.count').innerHTML = `${done} / ${total}<small>${label}</small>`;
      hud.querySelector('.bar i').style.width = `${(done / total) * 100}%`;
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
    setHold(p) {
      hold.classList.toggle('on', p > 0);
      holdC.setAttribute('stroke-dashoffset', String(113.1 * (1 - p)));
    },
    showClue(c, index) {
      clearTimeout(panelTimer);
      clueId = c.id;
      const lines = c.lines.map((l, i) => `<div class="ln" style="animation-delay:${0.15 + i * 0.35}s">${l}</div>`).join('');
      const dl = 0.15 + c.lines.length * 0.35;
      const no = String(index + 1).padStart(2, '0');
      panel.innerHTML = `<div class="txt"><div class="tag inv-mono">证据 #${no} · 已分析</div><h2>${c.name}</h2>${lines}
        <div class="res" style="animation-delay:${dl}s">${c.result}</div>
        <div class="prob inv-mono" style="animation-delay:${dl + 0.2}s"><span>概率</span><div class="pb"><i></i></div><span>${Math.round(c.prob * 100)}%</span></div></div>
        <div class="pic"><div class="img" style="background-image:url(${clueImage(c)})"></div><div class="scan"></div>
        <div class="box"></div><i class="cn a"></i><i class="cn b"></i><i class="cn c"></i><i class="cn d"></i>
        <div class="cap inv-mono">影像记录 · EV-${no}</div></div>`;
      panel.classList.add('on');
      const m = markPos.get(c.id);
      if (m) placePanel(m.x, m.y, m.front);
      setTimeout(() => { const i = panel.querySelector('.pb i'); if (i) i.style.width = `${c.prob * 100}%`; }, (dl + 0.3) * 1000);
      panelTimer = setTimeout(() => { panel.classList.remove('on'); panel.style.visibility = ''; clueId = null; }, 4000);
    },
    hidePanel() { clearTimeout(panelTimer); panel.classList.remove('on'); panel.style.visibility = ''; clueId = null; },
    toast(t1, t2, ms = 3200) {
      clearTimeout(toastTimer);
      toast.querySelector('.t1').textContent = t1;
      toast.querySelector('.t2').textContent = t2;
      toast.classList.add('on');
      toastTimer = setTimeout(() => toast.classList.remove('on'), ms);
    },
    buildTimeline(events, duration, jumpT, jumpLabel, frac) {
      this._frac = frac;
      const pct = (t) => `${frac(t) * 100}%`;
      tl.innerHTML = `<div class="head"><span>事件重建</span><span class="clock inv-mono">00:00.0</span></div>
        <div class="track"><div class="fill"></div>
        <div class="jump" style="left:${pct(jumpT)}"><span>${jumpLabel}</span></div>
        ${events.map((e, i) => `<div class="ev" data-i="${i}" style="left:${pct(e.t)}"></div><div class="evl${i % 2 ? ' up' : ''}" data-i="${i}" style="left:${pct(e.t)}">${e.label}</div>`).join('')}
        <div class="ph"></div></div>
`;
      evlabels.innerHTML = '';
      evEls.length = 0;
      events.forEach((e) => {
        const d = document.createElement('div');
        d.className = 'inv-evl3';
        d.textContent = e.label;
        evlabels.appendChild(d);
        evEls.push(d);
      });
    },
    updateTimeline(t, duration, clockText, recorded, nearIdx) {
      const f = this._frac(t) * 100;
      tl.querySelector('.fill').style.width = `${f}%`;
      tl.querySelector('.ph').style.left = `${f}%`;
      tl.querySelector('.clock').textContent = clockText;
      tl.querySelectorAll('.ev').forEach((e) => {
        const i = +e.dataset.i;
        e.classList.toggle('rec', recorded[i]);
        e.classList.toggle('near', i === nearIdx);
      });
      tl.querySelectorAll('.evl').forEach((e) => e.classList.toggle('rec', recorded[+e.dataset.i]));
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
    showConclusion(c, facts) {
      end.innerHTML = `<div class="box"><div class="tag inv-mono">RECONSTRUCTION COMPLETE</div><h1>${c.title}</h1>
        ${facts.map((f, i) => `<div class="f" style="animation-delay:${0.4 + i * 0.45}s"><span class="ts inv-mono">${f.ts}</span>${f.text}</div>`).join('')}
        <div class="v" style="animation-delay:${0.6 + facts.length * 0.45}s"><div class="vd">结论：${c.verdict}</div>
        <div class="pr inv-mono">概率 ${Math.round(c.prob * 100)}%</div><p>${c.summary}</p></div>
        <div class="k">按 Q 返回现场</div></div>`;
      end.classList.add('on');
    },
    hideConclusion() { end.classList.remove('on'); },
  };
}
