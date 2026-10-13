import * as THREE from 'three/webgpu';
import { clock } from './clock.js';
import { createAnalysisFx } from './analysisFx.js';
import { createUI, preloadClueImages } from './ui.js';
import { createRecon } from './recon.js';
import { buildTwistProps } from './props.js';
import { createTablet } from './tablet.js';
import { createViewmodel } from './viewmodel.js';
import { CLUES, PROBES, ROUNDS, REPORTS, LINES, ENDINGS, CARD_HACK, ROOT_HACK, TARGET_INDEX } from './clues.js';
import { buildCardSlot } from './cardSlot.js';

const HOLD_TIME = 1.4;      // Includes raising the instrument and one readable scan pass.
const AIM_RANGE = 6;        // 准星可分析距离
const PROBE_RANGE = 5;      // 黑梦分析点要走近到这个距离内才能瞄准，和现场 NEAR_RANGE 一致
const NEAR_RANGE = 5;       // 走近到此距离内自动发现线索
const SCAN_RANGE = 40;      // Q 扫描可发现的范围
const SCAN_SHOW = 2;        // 扫描出的标记显示秒数，之后隐藏
const SCAN_COOLDOWN = 5;    // 扫描冷却
const RECORD_WINDOW = 0.22; // 事件节点可记录的时间窗口
const PROBE_WINDOW = 0.25;  // 带时间点 t 的分析点：回放时间在 t ± 此值内才出现
const CONFIRM_TIME = 1.8;   // 按住确认走满所需时间

// 流程：
// 第 1 轮：取证（单车线索）→ 黑梦 1 → 复核报告 01 → 收起后进入第 2 轮
// 第 2 轮：三处线索同时出现 → 黑梦 2（A 车前轮：先转向后接触）→ 复核报告 02
//   按住 E 归档 → 假结局 → 按 E 回到报告 02
//   TAB 暂不归档 → 陈墨质问仪器 → 报告改写为「复核挂起」→ 收起平板 → 派单员施压 → 第 3 轮
// 第 3 轮：右后翼子板检修卡槽 → 按 E 插卡（镜头下蹲、扫描枪换成取证卡）→ 平板接入画面 → 车载数据线索
//   → TAB 收起平板 → 倒放拔卡、换回扫描枪 → 按 R 黑梦 3（A 车接管 / 零号保障边界 / A 车去向）
//   → Q 离开 → 复核报告 03（特权保护）
//   按住 E 移交审查 → 假结局 → 按 E 回到报告 03
//   TAB 暂不移交 → 追问 P0 何时写入 → 报告改写为「移交暂缓」→ 收起后独白，拿出根钥 → 第 4 轮
// 第 4 轮：平板里对锁住的「车辆 B 原始记录」插入根钥（暂时视为随身携带）→ 接入画面 → 原始字段、P0 授予、时间轴叠合
//   → 陈墨质问仪器 → 按 R 黑梦 4（边界生成 / 黄车切入 / A 车去向）→ 复核报告 04（系统主动制造事故）
//   → 收起后对象索引（处置目标：注销）→ 独白（结局待接入）
export function createInvestigation(scene, camera, crash, controls) {
  const props = buildTwistProps(scene, crash);
  const fx = createAnalysisFx(scene, camera);
  const ui = createUI();
  preloadClueImages(CLUES);
  const recon = createRecon(scene, crash);
  const tablet = createTablet(camera);
  const vm = createViewmodel(tablet.uiScene, camera);
  const slot = buildCardSlot(crash);
  const emitter = new THREE.Vector3();

  // reveal：扫描后剩余显示时间；hit：本次扫描是否已扫到
  const clues = CLUES.map((c) => ({ ...c, p: c.pos ? new THREE.Vector3(...c.pos) : new THREE.Vector3(), done: false, reveal: 0, hit: false, unlocked: c.round === 1 }));
  const probes = PROBES.map((c) => ({ ...c, probe: true, p: c.pos ? new THREE.Vector3(...c.pos) : new THREE.Vector3(), done: false, visible: false }));
  const recorded = Object.fromEntries(Object.entries(ROUNDS).map(([k, r]) => [k, r.events.map(() => false)]));
  const reports = ['initial'];
  let guideTablet = true;   // 开场第一次按 Tab，直接落在报告页
  const roundDone = { 1: false, 2: false, 3: false, 4: false };
  let round = 1;
  let lead = false;            // 第 2 轮：只有车门残漆可查，分析后解锁其余线索
  let glint = false;           // 残漆随双闪反光
  let paintTask = false;       // 第 1 次黑梦的报告收起后，进入第 2 轮
  let pendingReport = null;    // 黑梦结束后等玩家按 Tab 才打开的报告
  // { key, p, state: 'idle' | 'talking' | 'suspended' | 'archived', text, onDecline }
  let confirm = null;
  let holdConfirm = false;
  let reportT = 0;
  const revised = new Set();   // 已被质疑改写的报告
  let storyTask = false;       // 报告 02 挂起、派单施压之后：左侧任务改由 showTask 按剧情阶段给出
  let after3Said = false;      // 收起报告 03 后的独白只播一次
  let endingKey = null;        // 当前假结局对应的报告
  // 第 4 轮根钥：done 为原始字段已展开，told 为收起平板后已提示黑梦就绪
  const root = { done: false, told: false };
  let finale = null;           // 报告 04 之后：null | 'index'（对象索引已显示）| 'done'
  let endingT = 0;             // 假结局黑场文字出现后的计时，防止误按立刻返回
  // 第 3 轮插卡：phase 为 null | camIn | card | hack | data | out | pull | camOut
  const ins = { phase: null, t: 0, done: false, camFrom: new THREE.Vector3(), quatFrom: new THREE.Quaternion(), camTo: new THREE.Vector3(), quatTo: new THREE.Quaternion() };
  let portAimed = false;

  let mode = 'explore';        // explore | recon | report | ending | insert
  let holdT = 0, holdKey = false, aimed = null, aimedProbe = null;
  let finishedAnalysis = null;
  let rt = 0, playing = false;
  let scanCd = 0;
  let dbgAim = -1;
  let started = false;

  const R = () => ROUNDS[round];
  const unlocked = () => clues.filter((c) => c.unlocked);
  const stageClues = () => unlocked().filter((c) => c.round === round);
  const fieldClues = () => stageClues().filter((c) => !c.data);   // 有现场位置、能瞄准的线索
  const evIndex = (c) => unlocked().indexOf(c);
  const roundKeys = () => clues.filter((c) => c.round === round && c.key);
  // 第 3、4 轮没有现场线索：读完车载数据 / 根钥展开原始字段才能进黑梦
  const gates = { 3: () => ins.done, 4: () => root.done };
  const reconReady = () => !!ROUNDS[round] && !lead && roundKeys().every((c) => c.done) && (gates[round]?.() ?? true);
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

  // 把当前调查进度同步给平板
  function syncTablet() {
    // 第 4 轮根钥未用：锁住的车辆 B 原始记录下方出现「插入根钥」按钮
    const rootAction = round === 4 && !root.done ? { label: '插入根钥 · 读取原始字段', fn: startRoot } : null;
    tablet.setData({
      // 第 3 轮起只列出上一轮和本轮，避免列表过长
      clues: [...unlocked(), ...probes.filter((p) => p.done)]
        .filter((c) => round < 3 || c.round >= round - 1)
        .map((c) => (rootAction && c.id === 'dRaw' ? { ...c, action: rootAction } : c)),
      events: [],
      reports: reports.map((k) => ({ key: k, ...REPORTS[k], revisedOn: revised.has(k) })),
      confirm,
      status: statusText(),
    });
  }
  function statusText() {
    if (round >= 4) return roundDone[4] ? '复核未结' : '第 4 轮复核';
    if (round === 3) return revised.has('r3') ? '移交暂缓' : '第 3 轮复核';
    return revised.has('r2') ? '复核挂起' : roundDone[2] ? '待归档' : `第 ${round} 轮复核`;
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
    if (!ROUNDS[round]) { ui.toast(`黑梦 ${round} 尚未接入`, '', 2500); return; }
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
  const round3Btn = document.createElement('button');
  round3Btn.textContent = '测试 · 第三轮插卡';
  round3Btn.style.cssText = round2Btn.style.cssText.replace('top: 68px', 'top: 116px');
  document.body.appendChild(round3Btn);
  const round4Btn = document.createElement('button');
  round4Btn.textContent = '测试 · 第四轮根钥';
  round4Btn.style.cssText = round2Btn.style.cssText.replace('top: 68px', 'top: 164px');
  document.body.appendChild(round4Btn);
  // 前两轮做完、报告 02 挂起，停在第 3 轮开头
  function skipToRound3() {
    clues.forEach((c) => { if (c.round <= 2) { c.unlocked = true; c.done = true; } });
    probes.forEach((p) => { if (p.round <= 2) p.done = true; });
    roundDone[1] = roundDone[2] = true;
    for (const k of ['r1', 'r2']) if (!reports.includes(k)) reports.push(k);
    revised.add('r2');
    paintTask = false; pendingReport = null; lead = false; glint = false;
    confirm = null;
    if (tablet.open) tablet.toggle(false);
    resetRound4();
    resetRound3();
    startRound3();
  }
  round3Btn.addEventListener('click', (e) => {
    e.stopPropagation();
    skipToRound3();
    controls.lock();
    round3Btn.blur();
  });
  // 第 3 轮做完、报告 03 暂不移交，停在第 4 轮开头（根钥未用）
  round4Btn.addEventListener('click', (e) => {
    e.stopPropagation();
    skipToRound3();
    clues.forEach((c) => { if (c.round === 3) { c.unlocked = true; c.done = true; } });
    probes.forEach((p) => { if (p.round === 3) p.done = true; });
    ins.done = true;
    slot.setState('done');
    roundDone[3] = true;
    after3Said = true;
    if (!reports.includes('r3')) reports.push('r3');
    revised.add('r3');
    startRound4();
    controls.lock();
    round4Btn.blur();
  });
  const syncTestBtns = () => {
    const hide = locked() || mode === 'report' || mode === 'ending' || mode === 'insert' ? 'none' : '';
    for (const b of [testBtn, round2Btn, round3Btn, round4Btn]) b.style.display = hide;
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
    pendingReport = null;
    confirm = null;
    revised.clear();
    storyTask = false;
    if (reports.includes('r2')) reports.splice(reports.indexOf('r2'), 1);
    probes.forEach((p) => { if (p.round === 2) p.done = false; });
    if (tablet.open) tablet.toggle(false);
    startRound2();
    controls.lock();
    round2Btn.blur();
  });
  // 第 2 轮测试按钮也要清掉第 3 轮状态
  round2Btn.addEventListener('click', () => { resetRound4(); resetRound3(); });
  syncTestBtns();

  function setMode(m) {
    mode = m;
    holdT = 0; holdKey = false; finishedAnalysis = null;
    fx.setFocus(false);
    ui.setAnalysis(null);
    clock.target = m === 'explore' || m === 'ending' || m === 'insert' ? 1 : 0;
    fx.setActive(m === 'recon');
    recon.root.visible = m === 'recon';
    ui.setMode(m, m === 'recon' ? '黑梦回放' : '现场调查');
    ui.setPrompt(null);
    ui.setCinema(m === 'ending');
    ui.setSolved(null);
    controls.enabled = m !== 'ending' && m !== 'insert';
    if (m === 'explore') {
      if (pendingReport) showReportTask();
      else if (storyTask) showTask();
      else {
        ui.setCounter(stageClues().filter((c) => c.done).length, stageClues().length);
        ui.setHint(reconReady());
      }
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
    // 假结局：鼠标未锁定，按 E 回到报告 02
    if (mode === 'ending') {
      if ((e.code === 'KeyE' || e.code === 'Enter') && !e.repeat && endingT > 4) returnFromArchive();
      return;
    }
    // 插卡：只有读取完成、平板停在车载数据时，TAB / Esc 收起并拔卡
    if (mode === 'insert') {
      if (ins.phase === 'data' && (e.code === 'Tab' || e.code === 'Escape') && !e.repeat) finishInsert(e.code === 'Tab');
      else if (ins.phase === 'data') tablet.nav(e.code);
      return;
    }
    // 测试：探索中按 F，完成当前轮下一条现场线索。暂停时也能按
    if (e.code === 'KeyF' && !e.repeat && mode === 'explore' && !tablet.open) {
      completeOneClue();
      return;
    }
    // 平板打开时鼠标已释放，按键照常处理
    if (!locked() && !tablet.open) return;

    // 报告页：待确认时按住 E 确认、TAB 暂不确认；没有确认或已挂起时 TAB / Esc 收起
    // 接入画面（根钥、对象索引）播放期间不响应
    if (mode === 'report') {
      if (tablet.hacking) return;
      const st = confirm?.state;
      const closable = !confirm || st === 'suspended';
      if (e.code === 'KeyE' && st === 'idle') holdConfirm = true;
      else if (e.code === 'Tab' && st === 'idle' && !e.repeat) declineReport();
      else if ((e.code === 'Tab' || e.code === 'Escape') && closable && !e.repeat) closeReport(e.code === 'Tab');
      else tablet.nav(e.code);
      return;
    }

    // 平板只在探索时可用；打开期间按键都交给平板
    if (e.code === 'Tab' && mode === 'explore') {
      if (!e.repeat) {
        // 第 1 轮黑梦结束后不自动打开：按 Tab 才进入报告页
        if (pendingReport && !tablet.open) {
          const key = pendingReport;
          pendingReport = null;
          setMode('report');
          setTablet(true);
          tablet.showReport(key);
          syncTablet();
          return;
        }
        const first = !tablet.open && guideTablet;
        const rootGuide = !tablet.open && round === 4 && !root.done;
        setTablet(!tablet.open);
        if (first) { guideTablet = false; tablet.showReport('initial'); }
        else if (rootGuide) tablet.showClue('dRaw');
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
      } else if (mode === 'explore' && !e.repeat && portAimed) { holdKey = false; startInsert(); }
      else if (mode === 'explore' && !e.repeat && aimed && aimed.done) ui.showClue(aimed, evIndex(aimed));
    }
    if (e.code === 'KeyR' && mode === 'explore' && reconReady() && !pendingReport) setMode('recon');
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

  // 分析做完后按 Q：回到现场，等玩家按 Tab 再打开本轮报告
  function advanceAfterDream() {
    if (!roundComplete() || roundDone[round]) return;
    const r = round;
    roundDone[r] = true;
    const key = ROUNDS[r].report;
    if (!reports.includes(key)) reports.push(key);
    confirm = makeConfirm(key);
    holdConfirm = false;
    reportT = 0;
    paintTask = r === 1;
    pendingReport = key;
    setMode('explore');
  }

  function showReportTask() {
    ui.setObjective('按 <b>TAB</b> 查看<small>终端报告</small>');
    ui.setHint(false);
  }

  // ---------- 复核报告 ----------
  function leaveRecon() {
    if (roundComplete()) advanceAfterDream();
    else setMode('explore');
  }

  function makeConfirm(key) {
    if (!REPORTS[key].confirm || revised.has(key)) return null;
    return { key, p: 0, state: 'idle', text: '', onDecline: declineReport };
  }

  // 收起报告：按剧情阶段决定下一步
  function closeReport(relock) {
    const key = confirm?.key;
    const suspended = confirm?.state === 'suspended';
    confirm = null;
    setTablet(false, relock);
    setMode('explore');
    if (paintTask) {
      paintTask = false;
      startRound2();
    } else if (key === 'r2' && suspended && !storyTask) {
      storyTask = true;
      pressureCall();
    } else if (key === 'r3' && suspended && !after3Said) {
      after3Said = true;
      setTimeout(() => ui.say(LINES.after3).then(() => {
        if (round !== 3) return;
        startRound4();
        ui.toast('新的疑点', 'TAB 打开平板 · 用根钥读取车辆 B 原始记录', 4500);
      }), 700);
    } else if (round === 4 && root.done && !root.told) {
      root.told = true;
      showTask();
      ui.toast('信息量达到重建要求', '黑梦已就绪 · 按 R 启动回放', 4000);
    } else if (round === 4 && roundDone[4] && !finale) {
      finale = 'index';
      setTimeout(() => ui.say(LINES.after4).then(showTargetIndex), 600);
    } else if (finale === 'index') {
      finale = 'done';
      showTask();
      setTimeout(() => ui.say(LINES.target), 600);
    }
  }

  function updateReport(dt) {
    reportT += dt;
    if (!confirm || confirm.state !== 'idle') return;
    const ready = reportT > 1.8;   // 报告逐行打完、确认按钮出现之后
    const before = confirm.p;
    confirm.p = holdConfirm && ready ? confirm.p + dt / CONFIRM_TIME : Math.max(0, confirm.p - dt * 2);
    if (confirm.p !== before) syncTablet();
    if (confirm.p >= 1) archiveReport();
  }

  // ---------- 暂不确认 → 质问仪器 → 报告改写（报告 02、03）----------
  function declineReport() {
    if (!confirm || confirm.state !== 'idle') return;
    const key = confirm.key;
    const cf = REPORTS[key].confirm;
    confirm.state = 'talking';
    confirm.text = '复核质询中…';
    holdConfirm = false;
    syncTablet();
    ui.say(LINES[cf.question]).then(() => {
      if (mode !== 'report' || confirm?.key !== key) return;
      revised.add(key);
      confirm.state = 'suspended';
      confirm.text = cf.suspended;
      tablet.glitch(0.45);
      tablet.showReport(key);
      syncTablet();
      return ui.say(LINES[cf.after]);
    });
  }

  // 收起挂起的报告 02：派单员催单，陈墨拒绝交单，给出第 3 轮目标
  function pressureCall() {
    setTimeout(() => {
      ui.say(LINES.call2, { radio: true }).then(() => {
        startRound3();
        ui.toast('新的疑点', '车门卡死 · 检查右后翼子板的检修卡槽', 4500);
      });
    }, 700);
  }
  // 第 3 轮起的 HUD 任务：按剧情阶段给出
  function showTask() {
    if (round < 3) ui.setObjective('查清<b>接触前</b>为什么转向');
    else if (round === 3 && !ins.done) ui.setObjective('检查右后翼子板<b>检修卡槽</b>');
    else if (round === 3 && !roundDone[3]) ui.setObjective('黑梦已就绪 · 按 <b>R</b> 启动回放');
    else if (round === 3) ui.setObjective('核实<b>零号保障</b>的来源');
    else if (!root.done) ui.setObjective('用<b>根钥</b>读取车辆 B 原始记录<small>TAB 打开平板</small>');
    else if (!roundDone[4]) ui.setObjective('黑梦已就绪 · 按 <b>R</b> 启动回放');
    else ui.setObjective('枢核在杀能核对它的人<small>结局待接入</small>');
    ui.setHint(round >= 3 && reconReady() && !roundDone[round]);
  }

  // ---------- 第 3 轮：插卡读取车载数据 ----------
  function startRound3() {
    round = 3;
    storyTask = true;
    ins.done = false; ins.phase = null;
    slot.setState('idle');
    if (mode === 'explore') setMode('explore');
    syncTablet();
  }
  function resetRound3() {
    storyTask = false;
    after3Said = false;
    roundDone[3] = false;
    ins.done = false; ins.phase = null;
    slot.setState('idle');
    clues.forEach((c) => { if (c.round === 3) { c.unlocked = false; c.done = false; } });
    probes.forEach((p) => { if (p.round === 3) p.done = false; });
    if (reports.includes('r3')) reports.splice(reports.indexOf('r3'), 1);
  }

  // ---------- 第 4 轮：根钥展开原始字段 ----------
  function startRound4() {
    round = 4;
    storyTask = true;
    root.done = false; root.told = false;
    finale = null;
    if (mode === 'explore') setMode('explore');
    syncTablet();
  }
  function resetRound4() {
    if (round === 4) round = 3;
    root.done = false; root.told = false;
    finale = null;
    roundDone[4] = false;
    clues.forEach((c) => { if (c.round === 4) { c.unlocked = false; c.done = false; } });
    probes.forEach((p) => { if (p.round === 4) p.done = false; });
    // 车辆 B 原始记录恢复成锁住的摘要
    const raw = clues.find((c) => c.id === 'dRaw'), def = CLUES.find((c) => c.id === 'dRaw');
    Object.assign(raw, { locked: true, lines: def.lines, result: def.result, prob: def.prob });
    if (reports.includes('r4')) reports.splice(reports.indexOf('r4'), 1);
  }
  // 平板里点「插入根钥」：切到报告模式（接入期间不能收起），播放接入画面
  function startRoot() {
    if (root.done || tablet.hacking) return;
    setMode('report');
    tablet.hack(ROOT_HACK, onRootDone);
  }
  function onRootDone() {
    const raw = clues.find((c) => c.id === 'dRaw');
    Object.assign(raw, { locked: false, ...raw.raw });
    clues.forEach((c) => { if (c.round === 4) { c.unlocked = true; c.done = true; } });
    root.done = true;
    syncTablet();
    tablet.showClue('rTime');
    ui.say(LINES.rootRead);
  }
  // 报告 04 收起后：对象索引，走完停住，TAB 收起
  function showTargetIndex() {
    if (mode !== 'explore' || finale !== 'index') return;
    setMode('report');
    setTablet(true);
    tablet.hack(TARGET_INDEX, null);
  }

  const CAM_IN = 0.6, CAM_OUT = 0.5;
  const _m = new THREE.Matrix4();
  // 镜头下蹲、正对卡槽：卡槽外 0.55 m，略高于卡槽、微微俯视
  function startInsert() {
    if (!slot.ready || ins.phase) return;
    setMode('insert');
    ui.setPrompt(null);
    ui.clearToast();
    ins.phase = 'camIn'; ins.t = 0;
    ins.camFrom.copy(camera.position);
    ins.quatFrom.copy(camera.quaternion);
    ins.saved = camera.position.clone();
    ins.savedQuat = camera.quaternion.clone();
    // 从卡槽斜后方看：卡面能看到，右手从画面右侧伸进来
    const back = new THREE.Vector3(-1, 0, 0).transformDirection(crash.carGroup.matrixWorld).setY(0).normalize();
    ins.camTo.copy(slot.world).addScaledVector(slot.normal, 0.46).addScaledVector(back, 0.26);
    ins.camTo.y += 0.12;
    _m.lookAt(ins.camTo, slot.world, camera.up);
    ins.quatTo.setFromRotationMatrix(_m);
  }
  // 卡插到底：指示灯开始闪，停一下让玩家看到卡插好了，再举起平板
  function onCardInserted() {
    slot.setState('reading');
    ins.phase = 'hack';
    setTimeout(() => {
      setTablet(true);
      tablet.hack(CARD_HACK, onHackDone);
    }, 450);
  }
  function onHackDone() {
    clues.forEach((c) => { if (c.round === 3) { c.unlocked = true; c.done = true; } });
    slot.setState('done');
    ins.phase = 'data';
    ins.done = true;
    syncTablet();
    tablet.showClue('dMode');
    ui.say(LINES.cardRead);
  }
  // 收起平板。合上之后立刻起身，拔卡和起身同时进行
  function finishInsert(relock) {
    ins.phase = 'out';
    tablet.toggle(false);
    if (relock) controls.lock();
    else controls.showPause();
  }
  // 锁定期间相机由这里控制（玩家更新仍会把高度拉回站姿，所以每帧覆盖）
  const _q = new THREE.Quaternion();
  function updateInsert(dt) {
    ins.t += dt;
    vm.setCardHidden(tablet.amount > 0.35);
    if (ins.phase === 'out' && tablet.amount <= 0) {
      ins.phase = 'camOut'; ins.t = 0;
      vm.removeCard(() => slot.setState('idle'));
    }
    if (ins.phase === 'camIn' || ins.phase === 'camOut') {
      const out = ins.phase === 'camOut';
      const u = THREE.MathUtils.smootherstep(Math.min(1, ins.t / (out ? CAM_OUT : CAM_IN)), 0, 1);
      const from = out ? ins.camTo : ins.camFrom, to = out ? ins.saved : ins.camTo;
      const qf = out ? ins.quatTo : ins.quatFrom, qt = out ? ins.savedQuat : ins.quatTo;
      camera.position.lerpVectors(from, to, u);
      camera.quaternion.slerpQuaternions(qf, qt, u);
      if (ins.t >= (out ? CAM_OUT : CAM_IN)) {
        if (out) {
          ins.phase = null;
          setMode('explore');
          if (ins.done) ui.toast('信息量达到重建要求', '黑梦已就绪 · 按 R 启动回放', 4000);
          return;
        }
        ins.phase = 'card';
        camera.updateMatrixWorld();
        _m.copy(camera.matrixWorld).invert();
        const target = slot.world.clone().applyMatrix4(_m);
        const dir = slot.normal.clone().negate().transformDirection(_m);
        const up = new THREE.Vector3(0, 1, 0).transformDirection(_m);
        vm.insertCard(target, dir, up, onCardInserted);
      }
    } else {
      camera.position.copy(ins.camTo);
      camera.quaternion.copy(ins.quatTo);
    }
  }

  // ---------- 真的确认（报告 02 归档 / 报告 03 移交）→ 假结局 ----------
  function archiveReport() {
    const key = confirm.key;
    const end = ENDINGS[key];
    endingKey = key;
    confirm.state = 'archived';
    confirm.p = 1;
    confirm.text = REPORTS[key].confirm.done;
    holdConfirm = false;
    syncTablet();
    setTimeout(() => {
      // 鼠标保持释放：假结局只需要按 E 返回
      endingT = -Infinity;
      tablet.toggle(false);
      setMode('ending');
      syncTestBtns();
      ui.say(LINES[end.radio], { radio: true }).then(() => {
        if (mode !== 'ending') return;
        ui.black(1, 1400);
        setTimeout(() => {
          if (mode !== 'ending') return;
          endingT = 0;
          ui.ending(end);
        }, 1500);
      });
    }, 900);
  }

  function returnFromArchive() {
    ui.ending(null);
    ui.black(0, 600);
    confirm = makeConfirm(endingKey);
    holdConfirm = false;
    reportT = 0;
    setMode('report');
    setTablet(true);
    tablet.showReport(endingKey);
    syncTablet();
    syncTestBtns();
  }

  const SCRAPE_ALPHA = 1;   // 第 2 轮车门残漆随双闪反光的可见度

  function startRound2() {
    round = 2;
    lead = false;
    glint = true;
    props.setTracks(true);
    clues.forEach((c) => { if (c.round === 2) c.unlocked = true; });
    setMode('explore');
    syncTablet();
    setTimeout(() => ui.say(LINES.after1), 700);
  }

  // 分析完车门残漆：只熄掉残漆反光。三处线索从这一轮开始就能查，不再插派单通话
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

  // 测试：按 F 直接完成一条，收尾和按住 E 分析完相同
  function finishClue(c) {
    ui.setCounter(stageClues().filter((x) => x.done).length, stageClues().length);
    if (c.lead) onLeadDone();
    else if (c.key && reconReady()) ui.toast('信息量达到重建要求', '黑梦已就绪 · 按 R 启动回放', 0);
    ui.setHint(reconReady());
  }
  function completeOneClue() {
    const c = fieldClues().find((x) => !x.done);
    if (!c) { ui.toast('本轮现场线索已完成', '', 1500); return; }
    c.done = true;
    finishedAnalysis = { clue: c, remaining: 0.45 };
    finishClue(c);
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
      const show = showClues && !c.data && c.unlocked && c.round === round && c !== analysisClue && s.front && (d < NEAR_RANGE || (!c.nearOnly && (c === aimed || (!c.done && c.reveal > 0))));
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
    const nextAim = aimAt(fieldClues(), AIM_RANGE);
    if (nextAim !== aimed) holdT = 0;
    aimed = nextAim;
    // 第 3 轮检修卡槽：瞄准后按 E 插卡（读过之后不再出现）
    const portOn = round === 3 && !ins.done && slot.ready;
    portAimed = portOn && !aimed && aimAt([portTarget()], 3) != null;
    tickFinished(dt);
    holdAnalyze(aimed, dt, finishClue);
    const analysisClue = showAnalysis(aimed);
    if (dbgAim >= 0) {
      vm.analyze(clues[dbgAim].p, 0.6);
      fx.analyze(clues[dbgAim].p, clues[dbgAim].radius, 0.6);
    }

    // 车门残漆和普通线索一样：走近出现菱形，没有远处方向标记
    if (glint) props.setScrape(SCRAPE_ALPHA, crash.hazardLit ? 1.2 : 0.1);
    ui.setPointer(null);

    if (analysisClue) ui.setPrompt(null);
    else if (portAimed) ui.setPrompt('按 E 插入取证卡', true);
    else if (aimed && aimed.done) ui.setPrompt(`按 E 查看：${aimed.name}`);
    else ui.setPrompt(null);

    const list = markerList(true, false, analysisClue);
    const pt = portTarget();
    const ps = project(pt.p);
    const pd = pt.p.distanceTo(camera.position);
    list.push({ id: 'port', x: ps.x, y: ps.y, front: ps.front, show: portOn && ps.front && pd < 8, done: false, aim: portAimed, label: portAimed ? '检修卡槽' : `${pd.toFixed(1)} m` });
    ui.updateMarkers(list);
  }
  const _port = { p: new THREE.Vector3(), radius: 0.25 };
  function portTarget() { _port.p.copy(slot.world); return _port; }

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
      if (c.id === 'p2gap') ui.say(LINES.dream2);
      if (c.id === 'p3halo') ui.say(LINES.dream3);
      if (c.id === 'p4halo') ui.say(LINES.dream4);
      if (c.id === 'p4cut') ui.say(LINES.dream4b);
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
    else ui.setPrompt(null);
    ui.updateMarkers(markerList(false, true, analysisClue));
  }

  return {
    fx,
    tablet,
    get moveScale() { return mode === 'report' || mode === 'ending' || mode === 'insert' || tablet.open ? 0 : mode === 'recon' ? 0.5 : 1; },
    update(realDt) {
      tablet.update(realDt);
      ui.setTabletOpen(tablet.amount > 0.05);
      if (mode === 'ending') endingT += realDt;
      slot.update(realDt);
      if (mode === 'insert') {
        updateInsert(realDt);
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
      tabletClue(id) { tablet.showClue(id); },
      aim(i) { dbgAim = i; },
      showClue(i) { clues[i].done = true; ui.showClue(clues[i], i); },
      recordAll() { events().forEach((ev) => { rt = ev.t; tryRecord(); }); },
      confirm(on = true) { holdConfirm = on; },
      decline() { declineReport(); },
      round3() { round3Btn.click(); },
      round4() { round4Btn.click(); },
      // 本轮黑梦分析点全部标完，按离开黑梦的流程生成本轮报告
      report() { probes.forEach((p) => { if (p.round === round) p.done = true; }); advanceAfterDream(); },
      root() { startRoot(); },
      insert() { startInsert(); },
      finishInsert() { finishInsert(false); },
      get insertPhase() { return ins.phase; },
      slot,
      returnFromArchive() { returnFromArchive(); },
      get confirmState() { return confirm?.state ?? null; },
      leadDone() { const c = clues.find((x) => x.lead); c.done = true; onLeadDone(); },
      get mode() { return mode; },
      get round() { return round; },
    },
  };
}
