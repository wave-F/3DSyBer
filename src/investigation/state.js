import * as THREE from 'three/webgpu';
import { clock } from './clock.js';
import { createAnalysisFx } from './analysisFx.js';
import { createUI, preloadClueImages } from './ui.js';
import { createRecon } from './recon.js';
import { buildTwistProps } from './props.js';
import { createTablet } from './tablet.js';
import { createViewmodel } from './viewmodel.js';
import { CLUES, EVENTS, RECON_DURATION, TIME_JUMP, CONCLUSION } from './clues.js';

const HOLD_TIME = 1.4;      // Includes raising the instrument and one readable scan pass.
const AIM_RANGE = 6;        // 准星可分析距离
const NEAR_RANGE = 5;       // 走近到此距离内自动发现线索
const SCAN_RANGE = 40;      // Q 扫描可发现的范围
const SCAN_SHOW = 2;        // 扫描出的标记显示秒数，之后隐藏
const SCAN_COOLDOWN = 5;    // 扫描冷却
const RECORD_WINDOW = 0.22; // 事件节点可记录的时间窗口

// 时间轴显示：时间跳跃前为实时秒数，跳跃后映射到事故后约 50~83 秒
function clockText(t) {
  const sec = t < TIME_JUMP ? t : 50 + (t - TIME_JUMP) * 5.5;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

export function createInvestigation(scene, camera, crash, controls) {
  buildTwistProps(scene, crash.carGroup);
  const fx = createAnalysisFx(scene, camera);
  const ui = createUI();
  preloadClueImages(CLUES);
  const recon = createRecon(scene, crash);
  const tablet = createTablet(camera, {
    onStamp: () => ui.toast('案件已结案', '调查报告已提交归档', 4000),
  });
  const vm = createViewmodel(tablet.uiScene, camera);
  const emitter = new THREE.Vector3();
  // 打开平板：释放鼠标用来点击界面，视角固定；收起：重新锁定鼠标
  // relock = false 时（Esc 收起）不重新锁定，回到暂停层
  function setTablet(on, relock = true) {
    tablet.toggle(on);
    if (on) {
      holdT = 0; finishedAnalysis = null; fx.setFocus(false); ui.setAnalysis(null);
      holdKey = false; vm.analyze(null, 0); ui.setPrompt(null); ui.hidePanel(); syncTablet();
      controls.keepOverlayHidden = true;
      controls.unlock();
    } else if (relock) controls.lock();
    else controls.showPause();
  }
  // 把当前调查进度同步给平板
  function syncTablet() {
    tablet.setData({
      clues,
      events: EVENTS.map((ev, i) => ({ ...ev, recorded: recorded[i], ts: clockText(ev.t) })),
      conclusion: solved ? CONCLUSION : null,
    });
  }

  // reveal：扫描后剩余显示时间；hit：本次扫描是否已扫到
  const clues = CLUES.map((c) => ({ ...c, p: new THREE.Vector3(...c.pos), done: false, reveal: 0, hit: false }));
  const keyTotal = clues.filter((c) => c.key).length;
  const recorded = EVENTS.map(() => false);
  let mode = 'explore';
  let holdT = 0, holdKey = false, aimed = null;
  let finishedAnalysis = null;
  let rt = 0, playing = false;
  let solved = false;
  let endTimer = 0;
  let scanCd = 0;
  let dbgAim = -1;

  // 时间轴分段显示：跳跃前的 4 秒占 62% 宽度，事件更分散
  const frac = (t) => (t < TIME_JUMP ? (t / TIME_JUMP) * 0.62 : 0.62 + ((t - TIME_JUMP) / (RECON_DURATION - TIME_JUMP)) * 0.38);
  ui.buildTimeline(EVENTS, RECON_DURATION, TIME_JUMP, '≈ 46 秒后', frac);
  setMode('explore');

  const locked = () => document.pointerLockElement != null;

  // 测试按钮：跳过探索，标记全部线索已分析并直接进入事件重建
  // 只在鼠标未锁定时显示（暂停画面、平板打开时）
  const testBtn = document.createElement('button');
  testBtn.textContent = '测试 · 直接重建';
  testBtn.style.cssText = 'position:fixed;right:24px;top:20px;transform:scale(1.5);transform-origin:right top;z-index:10;padding:8px 16px;font:13px "PingFang SC",sans-serif;letter-spacing:.1em;color:#ffcf6a;background:rgba(5,12,20,.7);border:1px solid rgba(255,207,106,.6);cursor:pointer;';
  document.body.appendChild(testBtn);
  const syncTestBtn = () => { testBtn.style.display = locked() || mode === 'end' ? 'none' : ''; };
  document.addEventListener('pointerlockchange', syncTestBtn);
  testBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clues.forEach((c) => { c.done = true; });
    ui.setHint(true);
    if (tablet.open) tablet.toggle(false);
    ui.hideConclusion();
    setMode('recon');
    controls.lock();
    testBtn.blur();
  });
  syncTestBtn();
  const keyDone = () => clues.filter((c) => c.key && c.done).length;
  const reconReady = () => keyDone() >= keyTotal;

  // 模式：explore（自由探索 + 线索分析）、recon（事件重建，世界冻结）、end（结论页）
  function setMode(m) {
    mode = m;
    holdT = 0; holdKey = false; finishedAnalysis = null;
    fx.setFocus(false);
    ui.setAnalysis(null);
    clock.target = m === 'explore' ? 1 : 0;
    fx.setActive(m === 'recon');
    recon.root.visible = m === 'recon';
    ui.setMode(m, m === 'recon' ? '事件重建' : '现场调查');
    ui.setPrompt(null);
    ui.setSolved(solved && m === 'explore');
    if (m === 'explore') ui.setCounter(clues.filter((c) => c.done).length, clues.length);
    if (m === 'recon') {
      rt = 0; playing = true;
      ui.setCounter(recorded.filter(Boolean).length, EVENTS.length, '事件');
    }
  }

  addEventListener('keydown', (e) => {
    if (e.code === 'Tab') e.preventDefault();
    // 平板打开时鼠标已释放，按键照常处理
    if (!locked() && mode !== 'end' && !tablet.open) return;
    // 平板只在探索时可用；打开期间按键都交给平板
    if (e.code === 'Tab' && mode === 'explore') { if (!e.repeat) setTablet(!tablet.open); return; }
    if (tablet.open) {
      if (!tablet.nav(e.code) && e.code === 'Escape') setTablet(false, false);
      return;
    }
    if (e.code === 'KeyQ') {
      if (mode === 'explore') scan();
      else if (mode === 'recon') setMode('explore');
      else if (mode === 'end') { ui.hideConclusion(); setMode('explore'); }
    }
    if (e.code === 'KeyE') {
      holdKey = true;
      if (mode === 'recon') tryRecord();
      else if (mode === 'explore' && !e.repeat && aimed && aimed.done) ui.showClue(aimed, clues.indexOf(aimed));
    }
    if (e.code === 'KeyR' && mode === 'explore' && reconReady()) setMode('recon');
    if (e.code === 'Space' && mode === 'recon') {
      if (rt >= RECON_DURATION) rt = 0;
      playing = !playing;
    }
  });
  addEventListener('keyup', (e) => { if (e.code === 'KeyE') holdKey = false; });
  document.addEventListener('pointerlockchange', () => {
    if (!locked()) {
      holdKey = false; holdT = 0; finishedAnalysis = null;
      fx.setFocus(false); vm.analyze(null, 0); ui.setAnalysis(null);
    }
  });
  addEventListener('wheel', (e) => {
    if (mode !== 'recon') return;
    playing = false;
    rt = THREE.MathUtils.clamp(rt + e.deltaY * 0.0025, 0, RECON_DURATION);
  }, { passive: true });

  function nearEvent() {
    let best = -1, bd = RECORD_WINDOW;
    EVENTS.forEach((ev, i) => { const d = Math.abs(ev.t - rt); if (d <= bd) { bd = d; best = i; } });
    return best;
  }

  function tryRecord() {
    const i = nearEvent();
    if (i < 0 || recorded[i]) return;
    recorded[i] = true;
    ui.toast(`事件已记录 · ${clockText(EVENTS[i].t)}`, EVENTS[i].fact);
    ui.setCounter(recorded.filter(Boolean).length, EVENTS.length, '事件');
    if (recorded.every(Boolean)) {
      endTimer = setTimeout(() => {
        solved = true;
        mode = 'end';
        recon.root.visible = false;
        fx.setActive(false);
        ui.setMode('end', '');
        ui.setPrompt(null);
        ui.showConclusion(CONCLUSION, EVENTS.map((ev) => ({ ts: clockText(ev.t), text: ev.fact })));
      }, 1800);
    }
  }

  // 准星射线与线索球体求交，取最近的
  const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3();
  function aim() {
    camera.getWorldPosition(_o);
    camera.getWorldDirection(_d);
    let best = null, bt = AIM_RANGE;
    for (const c of clues) {
      _v.subVectors(c.p, _o);
      const tca = _v.dot(_d);
      if (tca < 0 || tca > bt) continue;
      const d2 = _v.lengthSq() - tca * tca;
      if (d2 > c.radius * c.radius) continue;
      best = c; bt = tca;
    }
    return best;
  }

  const _s = new THREE.Vector3();
  function project(p) {
    _s.copy(p).project(camera);
    return { x: (_s.x * 0.5 + 0.5) * innerWidth, y: (-_s.y * 0.5 + 0.5) * innerHeight, front: _s.z < 1 && _s.z > -1 };
  }

  // Q 扫描：扫描波扩散，波前经过的线索被发现（不冻结时间，不切换模式）
  function scan() {
    if (scanCd > 0) return;
    // 手持设备举起对准前方，发射瞬间从设备位置放出扫描波
    if (!vm.scan((origin) => { clues.forEach((c) => { c.hit = false; }); fx.pulse(origin); })) return;
    scanCd = SCAN_COOLDOWN;
  }

  function updateExplore(dt) {
    scanCd = Math.max(0, scanCd - dt);
    // 线索标记：靠近时显示；扫描波经过时显示 2 秒后隐藏
    for (const c of clues) {
      c.reveal = Math.max(0, c.reveal - dt);
      const d = c.p.distanceTo(camera.position);
      if (fx.pulsing && !c.hit && d < SCAN_RANGE && d < fx.pulseRadius) { c.hit = true; c.reveal = SCAN_SHOW; }
    }
    const nextAim = aim();
    if (nextAim !== aimed) holdT = 0;
    aimed = nextAim;
    if (finishedAnalysis) {
      finishedAnalysis.remaining -= dt;
      if (finishedAnalysis.remaining <= 0) {
        const c = finishedAnalysis.clue;
        ui.showClue(c, clues.indexOf(c));
        finishedAnalysis = null;
      }
    }
    if (aimed && !aimed.done && holdKey && locked() && !finishedAnalysis) {
      if (holdT === 0) ui.hidePanel();
      holdT += dt;
      if (holdT >= HOLD_TIME) {
        aimed.done = true;
        holdT = 0;
        finishedAnalysis = { clue: aimed, remaining: 0.45 };
        ui.setCounter(clues.filter((c) => c.done).length, clues.length);
        if (aimed.key && reconReady()) ui.toast('关键线索已收集完毕', '按 R 开始事件重建', 4500);
        ui.setHint(reconReady());
      }
    } else holdT = 0;
    const analyzing = holdT > 0;
    const analysisClue = locked() ? finishedAnalysis?.clue ?? (aimed && !aimed.done ? aimed : null) : null;
    ui.setAnalysis(analysisClue ? { ...project(analysisClue.p), name: analysisClue.name } : null,
      finishedAnalysis ? 1 : holdT / HOLD_TIME, finishedAnalysis ? 'complete' : analyzing ? 'working' : 'ready');
    fx.setFocus(analyzing || !!finishedAnalysis);
    const reading = analyzing ? aimed : finishedAnalysis?.clue;
    const progress = finishedAnalysis ? 1 : holdT / HOLD_TIME;
    vm.analyze(reading?.p ?? null, progress);
    fx.analyze(reading?.p ?? null, reading?.radius ?? 1, progress);
    if (dbgAim >= 0) {
      vm.analyze(clues[dbgAim].p, 0.6);
      fx.analyze(clues[dbgAim].p, clues[dbgAim].radius, 0.6);
    }

    if (analysisClue) ui.setPrompt(null);
    else if (aimed && aimed.done) ui.setPrompt(`按 E 查看：${aimed.name}`);
    else if (reconReady()) ui.setPrompt('线索充足 · 按 R 开始事件重建', true);
    else ui.setPrompt(null);

    ui.updateMarkers(clues.map((c) => {
      const s = project(c.p);
      const d = c.p.distanceTo(camera.position);
      return {
        id: c.id, x: s.x, y: s.y, front: s.front, show: c !== analysisClue && s.front && (d < NEAR_RANGE || c === aimed || (!c.done && c.reveal > 0)), done: c.done, aim: c === aimed,
        label: c.done ? (c === aimed ? c.name : '') : (c === aimed || d < 8 ? `${d.toFixed(1)} m` : ''),
      };
    }));
  }

  function updateRecon(dt) {
    if (playing) {
      rt += dt * (rt >= TIME_JUMP ? 0.5 : 1); // 时间跳跃后放慢，人物动作看得清

      if (rt >= RECON_DURATION) { rt = RECON_DURATION; playing = false; }
    }
    recon.setTime(rt, Math.floor(performance.now() / 400) % 2 === 0);
    const ni = nearEvent();
    ui.updateTimeline(rt, RECON_DURATION, clockText(rt), recorded, ni);
    if (ni >= 0 && !recorded[ni]) ui.setPrompt(`按 E 记录：${EVENTS[ni].label}`, true);
    else if (recorded.every(Boolean)) ui.setPrompt('重建完成', true);
    else ui.setPrompt(null);
    // 只标注离当前时间最近的一个事件，避免同一位置的标签重叠
    let closest = -1, cd = 0.35;
    EVENTS.forEach((ev, i) => { const d = Math.abs(ev.t - rt); if (d < cd) { cd = d; closest = i; } });
    ui.updateEventLabels(recon.eventPos.map((p, i) => {
      const s = project(p);
      return { x: s.x, y: s.y, show: s.front && i === closest, rec: recorded[i], near: i === ni };
    }));
  }

  return {
    fx,
    tablet,
    get moveScale() { return mode === 'end' || tablet.open ? 0 : mode === 'recon' ? 0.5 : 1; },
    update(realDt) {
      tablet.update(realDt);
      ui.setTabletOpen(tablet.amount > 0.05);
      const available = !tablet.open && tablet.amount <= 0.05;
      if (mode === 'explore' && available) updateExplore(realDt);
      else {
        vm.analyze(null, 0);
        fx.analyze(null);
        if (mode === 'recon' && available) updateRecon(realDt);
      }
      vm.update(realDt, mode === 'explore' && !tablet.open && tablet.amount < 0.02);
      fx.update(realDt, vm.emitterWorld(emitter));
    },
    // 开发调试：直接切换状态 / 设置时间轴
    debug: {
      setMode, analyzeAll() { clues.forEach((c) => { c.done = true; }); },
      setTime(t) { rt = t; playing = false; },
      scan,
      tablet(on = true) { setTablet(on); },
      tabletNav(code) { tablet.nav(code); },
      aim(i) { dbgAim = i; },
      showClue(i) { clues[i].done = true; ui.showClue(clues[i], i); },
      recordAll() { EVENTS.forEach((ev) => { rt = ev.t; tryRecord(); }); },
      get mode() { return mode; },
    },
  };
}
