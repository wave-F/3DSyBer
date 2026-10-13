import * as THREE from 'three/webgpu';
import { clock } from './clock.js';
import { createAnalysisFx } from './analysisFx.js';
import { createUI, preloadClueImages } from './ui.js';
import { createRecon } from './recon.js';
import { buildTwistProps } from './props.js';
import { createTablet } from './tablet.js';
import { createViewmodel } from './viewmodel.js';
import { createCutscene } from './cutscene.js';
import { CLUES, PROBES, ROUNDS, REPORTS, LINES } from './clues.js';

const HOLD_TIME = 1.4;      // Includes raising the instrument and one readable scan pass.
const AIM_RANGE = 6;        // 准星可分析距离
const PROBE_RANGE = 5;      // 黑梦分析点要走近到这个距离内才能瞄准，和现场 NEAR_RANGE 一致
const NEAR_RANGE = 5;       // 走近到此距离内自动发现线索
const SCAN_RANGE = 40;      // Q 扫描可发现的范围
const SCAN_SHOW = 2;        // 扫描出的标记显示秒数，之后隐藏
const SCAN_COOLDOWN = 5;    // 扫描冷却
const RECORD_WINDOW = 0.22; // 事件节点可记录的时间窗口
// 黑梦完成后的报告流程（自动举平板出报告 → 按住确认归档 → 双闪中断 → 车漆特写过场 → 第 2 轮），暂时屏蔽
// 屏蔽时：本轮只标记完成，不出报告、不进第 2 轮。代码保留，改回 true 即恢复
const REPORT_FLOW = false;
const PROBE_WINDOW = 0.25;  // 带时间点 t 的分析点：回放时间在 t ± 此值内才出现
const CONFIRM_TIME = 1.8;   // 按住确认归档走满所需时间
const INTERRUPT_AT = 0.68;  // 确认进度到这里被双闪打断

// 流程：
// 第 1 轮：取证（单车线索）→ 黑梦 1 → 复核报告 01 → 按住确认归档时被双闪打断 → 特写镜头
// 第 2 轮：车门残漆（引导）→ 派单通话 → 解锁其余线索 → 黑梦 2 → 复核报告 02 → 待续
export function createInvestigation(scene, camera, crash, controls) {
  const props = buildTwistProps(scene, crash);
  const fx = createAnalysisFx(scene, camera);
  const ui = createUI();
  preloadClueImages(CLUES);
  const recon = createRecon(scene, crash);
  const tablet = createTablet(camera);
  const vm = createViewmodel(tablet.uiScene, camera);
  const cut = createCutscene(camera);
  const emitter = new THREE.Vector3();

  // reveal：扫描后剩余显示时间；hit：本次扫描是否已扫到
  const clues = CLUES.map((c) => ({ ...c, p: new THREE.Vector3(...c.pos), done: false, reveal: 0, hit: false, unlocked: c.round === 1 }));
  const probes = PROBES.map((c) => ({ ...c, probe: true, p: c.pos ? new THREE.Vector3(...c.pos) : new THREE.Vector3(), done: false, visible: false }));
  const recorded = { 1: ROUNDS[1].events.map(() => false), 2: ROUNDS[2].events.map(() => false) };
  const reports = ['initial'];
  let guideTablet = true;   // 开场第一次按 Tab，直接落在报告页
  const roundDone = { 1: false, 2: false };
  let round = 1;
  let lead = false;            // 第 2 轮：只有车门残漆可查，分析后解锁其余线索
  let glint = false;           // 残漆随双闪反光
  let paintTask = false;       // 第 1 次黑梦退出后，收起报告就去查车漆
  let confirm = null;          // { p, state: 'idle' | 'suspended' }
  let holdConfirm = false;
  let reportT = 0;

  let mode = 'explore';        // explore | recon | report | cut
  let holdT = 0, holdKey = false, aimed = null, aimedProbe = null;
  let finishedAnalysis = null;
  let rt = 0, playing = false;
  let scanCd = 0;
  let dbgAim = -1;
  let started = false;
  let cutFrozen = false;       // 调试：冻结过场，逐步查看镜头

  const R = () => ROUNDS[round];
  const unlocked = () => clues.filter((c) => c.unlocked);
  const stageClues = () => unlocked().filter((c) => c.round === round);
  const evIndex = (c) => unlocked().indexOf(c);
  const roundKeys = () => clues.filter((c) => c.round === round && c.key);
  const reconReady = () => !lead && roundKeys().every((c) => c.done);
  const events = () => R().events;
  const locked = () => document.pointerLockElement != null;

  // 时间轴显示：时间跳跃前为实时秒数，跳跃后映射到事故后约 50~83 秒
  function clockText(t, r = R()) {
    const sec = r.jump == null || t < r.jump ? t : 50 + (t - r.jump) * 5.5;
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
  }
  // 时间轴分段显示：有跳跃时，跳跃前占 62% 宽度
  function frac(t) {
    const r = R();
    if (r.jump == null) return t / r.duration;
    return t < r.jump ? (t / r.jump) * 0.62 : 0.62 + ((t - r.jump) / (r.duration - r.jump)) * 0.38;
  }

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

  // 把当前调查进度同步给平板。事件页显示最近一次黑梦
  function syncTablet() {
    const er = recorded[round].some(Boolean) || round === 1 ? round : round - 1;
    tablet.setData({
      clues: [...unlocked(), ...probes.filter((p) => p.done)],
      events: ROUNDS[er].events.map((ev, i) => ({ ...ev, recorded: recorded[er][i], ts: clockText(ev.t, ROUNDS[er]) })),
      reports: reports.map((k) => ({ key: k, ...REPORTS[k] })),
      confirm,
      status: roundDone[2] ? '待续' : `第 ${round} 轮复核`,
    });
  }

  setMode('explore');

  // 测试按钮：跳过取证，标记本轮线索已分析并直接进入黑梦
  // 只在鼠标未锁定时显示（暂停画面、平板打开时）
  const testBtn = document.createElement('button');
  testBtn.textContent = '测试 · 直接进黑梦';
  testBtn.style.cssText = 'position:fixed;right:24px;top:20px;transform:scale(1.5);transform-origin:right top;z-index:10;padding:8px 16px;font:13px "PingFang SC",sans-serif;letter-spacing:.1em;color:#ffcf6a;background:rgba(5,12,20,.7);border:1px solid rgba(255,207,106,.6);cursor:pointer;';
  document.body.appendChild(testBtn);
  testBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (lead) unlockRound2();
    clues.forEach((c) => { if (c.round === round) c.done = true; });
    ui.setHint(true);
    if (tablet.open) tablet.toggle(false);
    setMode('recon');
    controls.lock();
    testBtn.blur();
  });
  const round2Btn = document.createElement('button');
  round2Btn.textContent = '测试 · 第二轮搜证';
  round2Btn.style.cssText = 'position:fixed;right:24px;top:68px;transform:scale(1.5);transform-origin:right top;z-index:10;padding:8px 16px;font:13px "PingFang SC",sans-serif;letter-spacing:.1em;color:#ffcf6a;background:rgba(5,12,20,.7);border:1px solid rgba(255,207,106,.6);cursor:pointer;';
  document.body.appendChild(round2Btn);
  const syncTestBtns = () => {
    const hide = locked() || mode === 'report' || mode === 'cut' ? 'none' : '';
    testBtn.style.display = hide;
    round2Btn.style.display = hide;
  };
  document.addEventListener('pointerlockchange', syncTestBtns);
  round2Btn.addEventListener('click', (e) => {
    e.stopPropagation();
    clues.forEach((c) => {
      if (c.round === 1) { c.unlocked = true; c.done = true; }
      if (c.round === 2) { c.unlocked = false; c.done = false; }
    });
    probes.forEach((p) => { if (p.round === 1) p.done = true; });
    roundDone[1] = true;
    roundDone[2] = false;
    if (!reports.includes('r1')) reports.push('r1');
    paintTask = false;
    confirm = null;
    if (tablet.open) tablet.toggle(false);
    startRound2();
    controls.lock();
    round2Btn.blur();
  });
  syncTestBtns();

  function setMode(m) {
    mode = m;
    holdT = 0; holdKey = false; finishedAnalysis = null;
    fx.setFocus(false);
    ui.setAnalysis(null);
    clock.target = m === 'explore' || m === 'cut' ? 1 : 0;
    fx.setActive(m === 'recon');
    recon.root.visible = m === 'recon';
    ui.setMode(m, m === 'recon' ? '黑梦回放' : '现场调查');
    ui.setPrompt(null);
    ui.setCinema(m === 'cut');
    ui.setSolved(roundDone[2] && m === 'explore' ? '◆ 第 2 次复核完成 · 未完待续' : null);
    controls.enabled = m !== 'cut';
    if (m === 'explore') {
      ui.setCounter(stageClues().filter((c) => c.done).length, stageClues().length);
      ui.setHint(reconReady());
    }
    if (m === 'recon') {
      ui.clearToast();
      rt = 0; playing = true;
      recon.setRound(round);
      const r = R();
      ui.buildTimeline(timeMarks(), r.duration, r.jump, r.jumpLabel, frac);
      if (r.events.length) ui.setCounter(recorded[round].filter(Boolean).length, r.events.length, '事件');
      else ui.setCounter(keyProbes().filter((c) => c.done).length, keyProbes().length, '分析');
    }
  }

  // ---------- 输入 ----------
  addEventListener('keydown', (e) => {
    if (e.code === 'Tab') e.preventDefault();
    if (mode === 'cut') return;
    // 平板打开时鼠标已释放，按键照常处理
    if (!locked() && !tablet.open) return;

    // 报告页：确认归档（第 1 轮）或收起继续调查
    if (mode === 'report') {
      const pending = confirm && confirm.state === 'idle';
      if (e.code === 'KeyE' && pending) holdConfirm = true;
      else if ((e.code === 'Tab' || e.code === 'Escape') && !confirm && !e.repeat) closeReport(e.code === 'Tab');
      else tablet.nav(e.code);
      return;
    }

    // 平板只在探索时可用；打开期间按键都交给平板
    if (e.code === 'Tab' && mode === 'explore') {
      if (!e.repeat) {
        const first = !tablet.open && guideTablet;
        setTablet(!tablet.open);
        if (first) { guideTablet = false; tablet.showReport('initial'); }
      }
      return;
    }
    if (tablet.open) {
      if (!tablet.nav(e.code) && e.code === 'Escape') setTablet(false, false);
      return;
    }
    if (e.code === 'KeyQ') {
      if (mode === 'explore') scan();
      else if (mode === 'recon') leaveRecon();
    }
    if (e.code === 'KeyE') {
      holdKey = true;
      if (mode === 'recon' && !e.repeat) {
        // 正对事件节点时点 E 记录；否则按住分析全息物体
        if (tryRecord()) holdKey = false;
        else if (aimedProbe && aimedProbe.done) ui.showClue(aimedProbe, 0);
      } else if (mode === 'explore' && !e.repeat && aimed && aimed.done) ui.showClue(aimed, evIndex(aimed));
    }
    if (e.code === 'KeyR' && mode === 'explore' && reconReady()) setMode('recon');
    if (e.code === 'Space' && mode === 'recon') {
      if (rt >= R().duration) rt = 0;
      playing = !playing;
    }
  });
  addEventListener('keyup', (e) => { if (e.code === 'KeyE') { holdKey = false; holdConfirm = false; } });
  document.addEventListener('pointerlockchange', () => {
    if (!locked()) {
      holdKey = false; holdT = 0; finishedAnalysis = null;
      fx.setFocus(false); vm.analyze(null, 0); ui.setAnalysis(null);
    } else if (!started) {
      // 开场：第一次进入游戏时派单员呼叫，提示平板里已有系统初判
      started = true;
      setTimeout(() => {
        ui.say(LINES.opening, { radio: true }).then(() => ui.toast('系统初判已下发', 'TAB 打开平板查看报告', 4500));
      }, 900);
    }
  });
  addEventListener('wheel', (e) => {
    if (mode !== 'recon') return;
    playing = false;
    rt = THREE.MathUtils.clamp(rt + e.deltaY * 0.0025, 0, R().duration);
  }, { passive: true });

  // ---------- 黑梦：事件记录 ----------
  function nearEvent() {
    let best = -1, bd = RECORD_WINDOW;
    events().forEach((ev, i) => { const d = Math.abs(ev.t - rt); if (d <= bd) { bd = d; best = i; } });
    return best;
  }

  function tryRecord() {
    const i = nearEvent();
    const rec = recorded[round];
    if (i < 0 || rec[i]) return false;
    rec[i] = true;
    const ev = events()[i];
    ui.toast(`事件已记录 · ${clockText(ev.t)}`, ev.fact);
    ui.setCounter(rec.filter(Boolean).length, rec.length, '事件');
    checkRoundDone();
    return true;
  }

  // 本轮黑梦完成：事件全部记录，且 key 分析点全部分析（黑梦 1 没有事件，只要分析车辙）
  const keyProbes = () => probes.filter((c) => c.round === round && c.key);
  // 带时间点的分析点，在进度条上显示为黄块
  const timedProbes = () => probes.filter((c) => c.round === round && c.t != null);
  const timeMarks = () => [...R().events, ...timedProbes()].map((m) => ({ t: m.t }));
  const roundComplete = () => recorded[round].every(Boolean) && keyProbes().every((c) => c.done);
  function checkRoundDone() {
    // 分析做完留在黑梦里，按 Q 离开时才进入下一轮
  }

  // 分析做完后按 Q：打开平板，用本轮报告指出问题，再引导下一轮探索
  function advanceAfterDream() {
    if (!roundComplete() || roundDone[round]) return;
    const r = round;
    roundDone[r] = true;
    const key = ROUNDS[r].report;
    if (!reports.includes(key)) reports.push(key);
    confirm = null;
    paintTask = r === 1;
    setMode('explore');
    setTimeout(() => {
      if (mode !== 'explore') return;
      setMode('report');
      setTablet(true);
      tablet.showReport(key);
      syncTablet();
    }, 500);
  }

  // ---------- 复核报告 ----------
  // 黑梦回放结束：仪器生成本轮报告，平板自动举起
  function finishRecon() {
    const key = R().report;
    roundDone[round] = true;
    if (!reports.includes(key)) reports.push(key);
    confirm = REPORTS[key].confirm ? { p: 0, state: 'idle' } : null;
    holdConfirm = false;
    reportT = 0;
    setMode('report');
    setTablet(true);
    tablet.showReport(key);
    syncTablet();
  }

  function leaveRecon() {
    if (roundComplete()) advanceAfterDream();
    else setMode('explore');
  }

  function closeReport(relock) {
    setTablet(false, relock);
    setMode('explore');
    if (paintTask) {
      paintTask = false;
      startRound2();
    } else if (roundDone[2]) ui.toast('下一轮探索', '回到蓝车，核对转向是不是刮擦造成的。这一轮还没接上。', 5000);
  }

  function updateReport(dt) {
    reportT += dt;
    if (!confirm || confirm.state !== 'idle') return;
    const ready = reportT > 1.8;   // 报告逐行打完、确认按钮出现之后
    const before = confirm.p;
    confirm.p = holdConfirm && ready ? confirm.p + dt / CONFIRM_TIME : Math.max(0, confirm.p - dt * 2);
    if (confirm.p !== before) syncTablet();
    if (confirm.p >= INTERRUPT_AT) interrupt();
  }

  // ---------- 转折：拇指移向确认键，双闪亮了 ----------
  function interrupt() {
    confirm.state = 'suspended';
    holdConfirm = false;
    syncTablet();
    clock.target = 1;
    crash.setHazardOverride({ on: true, boost: 9 });
    ui.flash(1);
    ui.flash(0, 600);
    tablet.glitch(0.7);
    setTimeout(() => crash.setHazardOverride({ on: false }), 260);
    // 按键的用户激活还在有效期内，这时重新锁定鼠标
    setTimeout(() => { setTablet(false); }, 700);
    setTimeout(playTwist, 1100);
  }

  // 右侧后转向灯（双闪）在车身本地坐标中的位置，就在车门凹陷后方
  const LED_LOCAL = new THREE.Vector3(-0.73, 0.42, 1.04);
  const SCRAPE_LOCAL = new THREE.Vector3(-0.35, 0.58, 1.02);
  const SCRAPE_ALPHA = 1;   // 转折后残漆的可见度（第 1 轮为 0.3）
  const W = (x, y, z) => crash.carGroup.localToWorld(new THREE.Vector3(x, y, z));
  const WV = (v) => crash.carGroup.localToWorld(v.clone());

  function playTwist() {
    setMode('cut');
    ui.black(1);
    ui.black(0, 220);
    const led = WV(LED_LOCAL);
    const scrape = WV(SCRAPE_LOCAL);
    props.setScrape(SCRAPE_ALPHA, 0);
    const shots = [
      // A：双闪特写。先暗，随后猛地亮起
      {
        dur: 1.2, fov: 28,
        from: W(-1.75, 0.66, 2.4), to: W(-1.5, 0.62, 2.15),
        lookFrom: led, lookTo: led,
        update(u, t) { crash.setHazardOverride({ on: t > 0.35, boost: 3, x: -1.4, z: 2.0 }); },
      },
      // B：车门近景。橙光从车尾扫向车头，经过凹陷时闪出黄色
      {
        dur: 1.9, fov: 38,
        from: W(1.7, 1.05, 3.5), to: W(1.25, 0.95, 3.05),
        lookFrom: scrape, lookTo: scrape,
        update(u) {
          const x = THREE.MathUtils.lerp(-3.4, 2.2, u);
          crash.setHazardOverride({ on: true, boost: 4, x, z: 2.3 });
          props.setScrape(SCRAPE_ALPHA, 0.15 + 1.5 * Math.exp(-(((x - SCRAPE_LOCAL.x) / 0.9) ** 2)));
        },
      },
      // C：凹陷特写。双闪再亮一次，黄色又闪一下
      {
        dur: 1.7, fov: 30,
        from: W(0.9, 0.85, 2.6), to: W(0.7, 0.8, 2.35),
        lookFrom: scrape, lookTo: scrape,
        update(u, t) {
          const on = t > 0.45 && t < 1.1;
          crash.setHazardOverride({ on, boost: 2.5, x: -1.2, z: 2.2 });
          props.setScrape(SCRAPE_ALPHA, on ? 1.4 : 0.1);
          if (u >= 1) { ui.black(1, 150); }
        },
      },
    ];
    cut.play(shots, () => {
      crash.setHazardOverride(null);
      ui.black(0, 350);
      startRound2();
    });
  }

  function startRound2() {
    round = 2;
    lead = true;
    glint = true;
    props.setTracks(true);
    clues.forEach((c) => { if (c.round === 2) c.unlocked = true; });
    setMode('explore');
    syncTablet();
  }

  // 分析完车门残漆：派单通话，解锁第二辆车相关线索
  function unlockRound2() {
    lead = false;
    clues.forEach((c) => { if (c.round === 2) c.unlocked = true; });
    ui.setCounter(stageClues().filter((c) => c.done).length, stageClues().length);
    syncTablet();
  }
  function onLeadDone() {
    glint = false;
    props.setScrape(SCRAPE_ALPHA, 0);
    unlockRound2();
    setTimeout(() => {
      ui.say(LINES.call, { radio: true }).then(() => ui.toast('新的疑点', '第二辆车的痕迹 · 按 Q 扫描现场', 4500));
    }, 1200);
  }

  // ---------- 探索 ----------
  // 准星射线与球体求交，取最近的
  const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3();
  function aimAt(list, range) {
    camera.getWorldPosition(_o);
    camera.getWorldDirection(_d);
    let best = null, bt = range;
    for (const c of list) {
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

  // 按住 E 分析：返回本帧的分析状态
  function holdAnalyze(target, dt, onDone) {
    if (target && !target.done && holdKey && locked() && !finishedAnalysis) {
      if (holdT === 0) ui.hidePanel();
      holdT += dt;
      if (holdT >= HOLD_TIME) {
        target.done = true;
        holdT = 0;
        finishedAnalysis = { clue: target, remaining: 0.45 };
        onDone(target);
      }
    } else holdT = 0;
  }

  function tickFinished(dt) {
    if (!finishedAnalysis) return;
    finishedAnalysis.remaining -= dt;
    if (finishedAnalysis.remaining <= 0) {
      const c = finishedAnalysis.clue;
      ui.showClue(c, c.probe ? 0 : evIndex(c));
      finishedAnalysis = null;
      syncTablet();
    }
  }

  // 分析界面、手持设备、扫描光（探索和黑梦共用）
  function showAnalysis(target) {
    const analyzing = holdT > 0;
    const analysisClue = locked() ? finishedAnalysis?.clue ?? (target && !target.done ? target : null) : null;
    ui.setAnalysis(analysisClue ? { ...project(analysisClue.p), name: analysisClue.name } : null,
      finishedAnalysis ? 1 : holdT / HOLD_TIME, finishedAnalysis ? 'complete' : analyzing ? 'working' : 'ready');
    fx.setFocus(analyzing || !!finishedAnalysis);
    const reading = analyzing ? target : finishedAnalysis?.clue;
    const progress = finishedAnalysis ? 1 : holdT / HOLD_TIME;
    vm.analyze(reading?.p ?? null, progress);
    fx.analyze(reading?.p ?? null, reading?.radius ?? 1, progress);
    return analysisClue;
  }

  function markerList(showClues, showProbes, analysisClue) {
    const list = clues.map((c) => {
      const s = project(c.p);
      const d = c.p.distanceTo(camera.position);
      const show = showClues && c.unlocked && c.round === round && c !== analysisClue && s.front && (d < NEAR_RANGE || (!c.nearOnly && (c === aimed || (!c.done && c.reveal > 0))));
      return {
        id: c.id, x: s.x, y: s.y, front: s.front, show, done: c.done, aim: c === aimed,
        label: c.done ? (c === aimed ? c.name : '') : (c === aimed || d < 8 ? `${d.toFixed(1)} m` : ''),
      };
    });
    for (const c of probes) {
      const s = project(c.p);
      const mine = c.round === round && c.visible;
      const show = showProbes && mine && c !== analysisClue && s.front && (!c.done || c === aimedProbe);
      list.push({ id: c.id, x: s.x, y: s.y, front: s.front, show, done: c.done, aim: c === aimedProbe, label: c === aimedProbe ? c.name : '' });
    }
    return list;
  }

  function updateExplore(dt) {
    scanCd = Math.max(0, scanCd - dt);
    // 线索标记：靠近时显示；扫描波经过时显示 2 秒后隐藏
    for (const c of clues) {
      c.reveal = Math.max(0, c.reveal - dt);
      if (!c.unlocked) continue;
      const d = c.p.distanceTo(camera.position);
      if (fx.pulsing && !c.nearOnly && !c.hit && d < SCAN_RANGE && d < fx.pulseRadius) { c.hit = true; c.reveal = SCAN_SHOW; }
    }
    const nextAim = aimAt(stageClues(), AIM_RANGE);
    if (nextAim !== aimed) holdT = 0;
    aimed = nextAim;
    tickFinished(dt);
    holdAnalyze(aimed, dt, (c) => {
      ui.setCounter(stageClues().filter((x) => x.done).length, stageClues().length);
      if (c.lead) onLeadDone();
      else if (c.key && reconReady()) ui.toast('信息量达到重建要求', '黑梦已就绪 · 按 R 启动回放', 0);
      ui.setHint(reconReady());
    });
    const analysisClue = showAnalysis(aimed);
    if (dbgAim >= 0) {
      vm.analyze(clues[dbgAim].p, 0.6);
      fx.analyze(clues[dbgAim].p, clues[dbgAim].radius, 0.6);
    }

    // 车门残漆和普通线索一样：走近出现菱形，没有远处方向标记
    if (glint) props.setScrape(SCRAPE_ALPHA, crash.hazardLit ? 1.2 : 0.1);
    ui.setPointer(null);

    if (analysisClue) ui.setPrompt(null);
    else if (aimed && aimed.done) ui.setPrompt(`按 E 查看：${aimed.name}`);
    else ui.setPrompt(null);

    ui.updateMarkers(markerList(true, false, analysisClue));
  }

  // ---------- 黑梦 ----------
  function updateRecon(dt) {
    const r = R();
    if (playing) {
      rt += dt * (r.jump != null && rt >= r.jump ? 0.5 : 1); // 时间跳跃后放慢，人物动作看得清
      if (rt >= r.duration) { rt = r.duration; playing = false; }
    }
    recon.setTime(rt);

    // 分析点一律：回放到自己的时间窗，并且人走到 5 m 内，菱形才出现、才能瞄准
    for (const c of probes) {
      const inTime = c.t == null || Math.abs(rt - c.t) <= PROBE_WINDOW;
      const placed = c.pos ? true : recon.targetPos(c.target, c.p);
      c.visible = c.round === round && inTime && placed && c.p.distanceTo(camera.position) < PROBE_RANGE;
    }
    const nextAim = aimAt(probes.filter((c) => c.visible), PROBE_RANGE);
    if (nextAim !== aimedProbe) holdT = 0;
    aimedProbe = nextAim;
    tickFinished(dt);
    holdAnalyze(aimedProbe, dt, (c) => {
      if (c.id === 'p1turn') ui.say(LINES.dream1);
      if (c.key) ui.setCounter(keyProbes().filter((x) => x.done).length, keyProbes().length, '分析');
      checkRoundDone();
    });
    if (holdT > 0) playing = false;
    const analysisClue = showAnalysis(aimedProbe);

    const rec = recorded[round];
    const ni = nearEvent();
    // 进度条黄块：先是事件，后是带时间点的分析点（已分析视为已记录）
    const tp = timedProbes();
    const tpNear = tp.findIndex((c) => Math.abs(rt - c.t) <= PROBE_WINDOW);
    const markNear = ni >= 0 ? ni : (tpNear >= 0 ? rec.length + tpNear : -1);
    const countText = r.events.length ? `已记录事件 ${rec.filter(Boolean).length}/${rec.length}` : `已分析 ${tp.filter((c) => c.done).length}/${tp.length}`;
    ui.updateTimeline(rt, r.duration, clockText(rt), [...rec, ...tp.map((c) => c.done)], markNear, countText);
    if (ni >= 0 && !rec[ni]) ui.setPrompt(`按 E 记录：${r.events[ni].label}`, true);
    else if (analysisClue) ui.setPrompt(null);
    else if (aimedProbe && aimedProbe.done) ui.setPrompt(`按 E 查看：${aimedProbe.name}`);
    else if (REPORT_FLOW && roundComplete()) ui.setPrompt('回放完成 · 正在生成复核报告', true);
    else ui.setPrompt(null);
    ui.updateMarkers(markerList(false, true, analysisClue));
  }

  return {
    fx,
    tablet,
    get moveScale() { return mode === 'report' || mode === 'cut' || tablet.open ? 0 : mode === 'recon' ? 0.5 : 1; },
    update(realDt) {
      tablet.update(realDt);
      ui.setTabletOpen(tablet.amount > 0.05);
      if (mode === 'cut') {
        cut.update(cutFrozen ? 0 : realDt);
        vm.analyze(null, 0);
        fx.analyze(null);
        vm.update(realDt, false);
        fx.update(realDt, null);
        return;
      }
      const available = !tablet.open && tablet.amount <= 0.05;
      if (mode === 'explore' && available) updateExplore(realDt);
      else if (mode === 'recon' && available) updateRecon(realDt);
      else {
        vm.analyze(null, 0);
        fx.analyze(null);
        if (mode === 'report') updateReport(realDt);
      }
      vm.update(realDt, mode === 'explore' && !tablet.open && tablet.amount < 0.02);
      fx.update(realDt, vm.emitterWorld(emitter));
    },
    // 开发调试：直接切换状态 / 设置时间轴
    debug: {
      setMode, analyzeAll() { clues.forEach((c) => { if (c.unlocked) c.done = true; }); },
      setTime(t) { rt = t; playing = false; },
      scan,
      tablet(on = true) { setTablet(on); },
      tabletNav(code) { tablet.nav(code); },
      aim(i) { dbgAim = i; },
      showClue(i) { clues[i].done = true; ui.showClue(clues[i], i); },
      recordAll() { events().forEach((ev) => { rt = ev.t; tryRecord(); }); },
      report() { finishRecon(); },
      confirm(on = true) { holdConfirm = on; },
      twist() { playTwist(); },
      cutFreeze(on = true) { cutFrozen = on; },
      cutStep(dt) { cut.update(dt); },
      leadDone() { const c = clues.find((x) => x.lead); c.done = true; onLeadDone(); },
      get mode() { return mode; },
      get round() { return round; },
    },
  };
}
