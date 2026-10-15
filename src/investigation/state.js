import * as THREE from 'three/webgpu';
import { clock } from './clock.js';
import { createAnalysisFx } from './analysisFx.js';
import { createUI, preloadClueImages } from './ui.js';
import { createRecon } from './recon.js';
import { buildTwistProps } from './props.js';
import { createTablet } from './tablet.js';
import { createViewmodel } from './viewmodel.js';
import { createPryArm, PRY_INSERT, PRY_HIT } from './pryArm.js';
import { createCardArm, CARD_HIT, CARD_INSERT_END, CARD_PULL0, CARD_PULL_END } from './cardArm.js';
import { CLUES, CLUES_ZH, PROBES_ZH, clueEN, probeEN, ROUNDS, REPORTS, LINES, ENDINGS, CARD_HACK, ROOT_HACK, TARGET_INDEX } from './clues.js';
import { buildCardSlot, buildRootKey } from './cardSlot.js';
import { DOOR_AJAR, CAR_POS } from '../crash.js';
import { createFinale } from './finale.js';
import { sound } from '../audio/sound.js';
import { PEAK } from '../audio/events.js';
import { IMPACT_T } from './recon.js';
import { bi, onLang, tx } from '../i18n.js';
import { loading } from '../loading.js';

const HOLD_TIME = 1.4;      // Includes raising the instrument and one readable scan pass.
const AIM_RANGE = 6;        // 准星可分析距离
const PROBE_RANGE = 8;      // 黑梦分析点要走近到这个距离内才能瞄准（更远时只显示菱形和距离）
const NEAR_RANGE = 5;       // 走近到此距离内自动发现线索
const SCAN_RANGE = 40;      // Q 扫描可发现的范围
const SCAN_SHOW = 2;        // 扫描出的标记显示秒数，之后隐藏
const SCAN_COOLDOWN = 5;    // 扫描冷却
const PROBE_WINDOW = 0.25;  // 带时间点 t 的分析点：回放时间在 t ± 此值内才出现
const CONFIRM_TIME = 1.8;   // 按住确认走满所需时间
const SKIP_TIME = 1.0;      // 质询对话按住 TAB 跳过所需时间
// 黑梦分析点完成后的独白（LINES 的键）
const DREAM_LINES = { p1turn: 'dream1', p2gap: 'dream2', p3halo: 'dream3', p4halo: 'dream4', p4cut: 'dream4b' };
// 其余线索分析完的独白（LINES 的键）：现场线索、黑梦分析点按住 E 完成时播；
// 车载数据（data）没有分析动作，第一次在平板上看完详情时播。dRaw 解锁前后各一句
const CLUE_LINES = {
  front: 'clueFront', rail: 'clueRail', debris: 'clueDebris',
  scrape: 'clueScrape', skidB: 'clueSkidB', trim: 'clueTrim',
  p2car: 'clueP2car', p3override: 'clueP3override', p4end: 'clueP4end',
  dReason: 'clueDReason', dRaw: 'clueDRaw', dRawOpen: 'clueDRawOpen', rTime: 'clueRTime',
};
const READY_LINES = { 1: 'ready1', 2: 'ready2' };   // 第 1、2 轮现场线索标完、还没进黑梦
const LINE_DELAY = 1.3;          // 分析完成到独白开口（秒）：结果面板 0.45 秒弹出，结论行再约 0.8 秒淡入
const DREAM_EXIT_DELAY = 5450;   // 结果面板在完成 0.45 秒后弹出，停留 5 秒。等它关掉再自动打开终端
// 进入黑梦：按住 R 读满 → 回放立即开始播放，同时镜头缓慢转向 A 车起点（转向期间不能操作）
// 只有第一次进入有标题 + 扫描波，之后只转镜头
const DREAM_HOLD = 1.0;          // 按住 R 读满所需时间（秒）
const DREAM_TURN = 1.8;          // 镜头转向时长（秒）
const DREAM_RITE = 2.6;          // 第一次进入：标题显示总时长（秒）
// 第一次黑梦的引导（秒）
const GUIDE_WAIT = 0.8;          // 镜头转到 A 车起点后，等这么久再开车
const GUIDE_FOLLOW = 4;          // 跟车镜头的跟随速度（越大越紧）
const GUIDE_END = 0.8;           // 播完后停这么久，陈墨开口
const TIP_TIME = 15;             // 操作说明最长显示时间

// 流程（下车后自动弹出系统初判，收起后交还控制）：
// 每轮黑梦：分析点全部完成 → 独白说完后自动离开黑梦、直接弹出本轮报告（Q 可提前离开）
// 第 1 轮：取证（单车线索）→ 黑梦 1 → 复核报告 01 → 收起后进入第 2 轮
// 第 2 轮：三处线索同时出现 → 黑梦 2（A 车前轮：先转向后接触）→ 复核报告 02
//   按住 E 归档 → 假结局 → 按 E 回到报告 02
//   TAB 暂不归档 → 陈墨质问仪器（按住 TAB 跳过）→ 报告改写为「复核挂起」→ 收起平板 → 派单员施压 → 第 3 轮
// 第 3 轮：撬开右侧车门（门尾已被撞得外翻）→ 驾驶舱转向柱下方检修接口 → 按 E 插卡（镜头下蹲、扫描枪换成取证卡）→ 平板接入画面 → 车载数据线索
//   → TAB 收起平板 → 倒放拔卡、换回扫描枪 → 按住 R 黑梦 3（A 车接管 / 零号保障通道）→ 复核报告 03（特权保护）
//   按住 E 移交审查 → 假结局 → 按 E 回到报告 03
//   TAB 暂不移交 → 追问零号保障何时写入（按住 TAB 跳过）→ 报告改写为「移交暂缓」→ 收起后独白（接口日志：根钥登录过）→ 第 4 轮
// 第 4 轮：驾驶舱里拾取程叙的根钥（驾驶座与中控通道之间）→ 平板自动举起、根钥接入
//   → 原始字段、零号保障授予、时间轴叠合 → 陈墨质问仪器 → 按住 R 黑梦 4（通道生成 / 黄车切入 / A 车去向）→ 复核报告 04（系统主动制造事故）
//   → 报告页按 TAB：平板不收起，直接播对象索引（处置目标：注销）→ 再按 TAB 收起 → 独白 → 结局动画
// 结局（src/investigation/finale.js）：跑车撞飞陈墨 → 地上的终端自动写报告并归档 → 黑屏
export function createInvestigation(scene, camera, crash, controls, gait) {
  const props = buildTwistProps(scene, crash);
  const fx = createAnalysisFx(scene, camera);
  const ui = createUI();
  preloadClueImages(CLUES);
  const recon = createRecon(scene, crash);
  const tablet = createTablet(camera);
  tablet.onBlank = closeTabletFromBlank;
  const vm = createViewmodel(tablet.uiScene, camera, gait);
  const slot = buildCardSlot(crash);
  const rootKey = buildRootKey(crash);
  // 右侧车门：开局外翻 7°，第 3 轮撬到 55°
  const DOOR_OPEN = 55 * Math.PI / 180;
  const door = { node: null, handle: new THREE.Vector3(), out: new THREE.Vector3() };
  let pryArm = null;   // 撬门的手和撬棍（挂在车模根节点下）
  let cardArm = null;  // 插卡 / 拔卡的手和取证卡（挂在车模根节点下）
  crash.onCarReady(({ door: node }) => {
    door.node = node;
    pryArm = createPryArm(node.parent);
    cardArm = createCardArm(node.parent);
    // 把手点：门尾上部外侧（车门本地坐标，原点在前铰链，车尾 -Z、外侧 -X）
    const box = new THREE.Box3().setFromBufferAttribute(node.geometry.attributes.position);
    door.box = box;
    door.handleLocal = new THREE.Vector3(box.min.x + 0.03, box.min.y + (box.max.y - box.min.y) * 0.62, box.min.z + 0.1);
  });
  const setDoor = (a) => { if (door.node) door.node.rotation.y = a; };
  function doorHandle() {
    if (!door.node) return door.handle;
    door.node.updateMatrixWorld(true);
    return door.handle.copy(door.handleLocal).applyMatrix4(door.node.matrixWorld);
  }
  const death = createFinale({ scene, camera, tablet, ui });
  let deathForce = false;   // 开发调试：鼠标没锁定也继续播放
  const emitter = new THREE.Vector3();

  // reveal：扫描后剩余显示时间；hit：本次扫描是否已扫到
  const clues = CLUES_ZH.map((c) => bi({ ...c, p: c.pos ? new THREE.Vector3(...c.pos) : new THREE.Vector3(), done: false, reveal: 0, hit: false, unlocked: c.round === 1 }, clueEN(c.id)));
  const probes = PROBES_ZH.map((c) => bi({ ...c, probe: true, p: c.pos ? new THREE.Vector3(...c.pos) : new THREE.Vector3(), done: false, visible: false }, probeEN(c.id)));
  const reports = ['initial'];
  let guideTablet = true;   // 下车后第一次按 Tab，直接落在系统初判
  let arrivalClosed = false; // 开场初判被收起，结束开场后说一句开始搜证
  const roundDone = { 1: false, 2: false, 3: false, 4: false };
  let round = 1;
  let glint = false;           // 残漆随双闪反光
  let paintTask = false;       // 第 1 次黑梦的报告收起后，进入第 2 轮
  let dreamExit = 0;           // 自动离开黑梦的计时器
  // { key, p, state: 'idle' | 'talking' | 'suspended' | 'archived', text, onDecline }
  let confirm = null;
  let holdConfirm = false;
  let rootHold = false;        // 按住 E 插入根钥
  let rootP = 0;               // 插入根钥的读条 0~1
  let holdSkip = false, skipP = 0;   // 质询对话：按住 TAB 跳过
  let reportT = 0;
  const revised = new Set();   // 已被质疑改写的报告
  let storyTask = false;       // 报告 02 挂起、派单施压之后：左侧任务改由 showTask 按剧情阶段给出
  // 左侧任务的先后顺序：新任务排在上一个后面才算「完成 → 新目标」，同一个任务只原地刷新（计数、换语言）
  const TASK_ORDER = ['clues1', 'dream1', 'clues2', 'dream2', 'why', 'pry', 'card', 'dream3', 'zero', 'findKey', 'readKey', 'dream4', 'car'];
  let lastTask = null;         // 上一次给出的现场任务 key；跳关时清空，不播完成
  let after3Said = false;      // 收起报告 03 后的独白只播一次
  const readySaid = new Set();   // 第 1、2 轮搜证满了以后的独白只播一次
  const dataSaid = new Set();    // 已播过独白的车载数据（CLUE_LINES 的键）
  let endingKey = null;        // 当前假结局对应的报告
  // 第 4 轮根钥：picked 为已从驾驶舱拾取，done 为原始字段已展开，told 为收起平板后已提示黑梦就绪
  const root = { picked: false, done: false, told: false };
  let keyAimed = false;
  // 第 3 轮撬门：phase 为 null | camIn | brace（举撬棍插进门缝）| pry | camOut
  const pry = { phase: null, t: 0, done: false, popped: false, camFrom: new THREE.Vector3(), quatFrom: new THREE.Quaternion(), camTo: new THREE.Vector3(), quatTo: new THREE.Quaternion() };
  let doorAimed = false;
  let finale = null;           // 报告 04 之后：null | 'index'（对象索引已显示）| 'done'
  let endingT = 0;             // 假结局黑场文字出现后的计时，防止误按立刻返回
  // 第 3 轮插卡：phase 为 null | camIn | card | hack | data | out | pull | camOut
  // animT：插卡动画的时间（-1 未开始），和 phase 分开走：卡插到底后进入 hack，松手收回的动画还要继续播
  const ins = { phase: null, t: 0, animT: -1, hit: false, done: false, camFrom: new THREE.Vector3(), quatFrom: new THREE.Quaternion(), camTo: new THREE.Vector3(), quatTo: new THREE.Quaternion() };
  let portAimed = false;

  let mode = 'explore';        // explore | recon | report | ending | insert | death
  let holdT = 0, holdKey = false, aimed = null, aimedProbe = null;
  let finishedAnalysis = null;
  let rt = 0, playing = false;
  let scanCd = 0;
  let dbgAim = -1;
  let started = false;
  let intro = false;   // 开场下车镜头播放中（src/intro.js 控制）
  let holdR = false, dreamHold = 0;   // 按住 R 构建黑梦的进度（0~1）
  let firstDream = true;              // 第 1 轮黑梦还没走过引导。跳到后面的黑梦不消耗它，也不播引导
  // 进入黑梦的过场：on 期间锁定视角与操作，镜头从 (yaw0, pitch0) 转到 A 车起点
  // phase：turn | wait | watch | end | talk | scrub（后五个只在第一次黑梦的引导里出现）
  const enter = { on: false, phase: null, guide: false, t: 0, yaw0: 0, pitch0: 0, dYaw: 0, pitch1: 0, back1: 0 };
  const rite = { on: false, t: 0 };   // 第一次进入黑梦的标题
  let tipT = 0;                       // 黑梦操作说明剩余显示时间
  const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const _look = new THREE.Vector3();
  let wasHolding = false, analysisDone = false;   // 分析音效：是否正在按住 / 本次是否已完成

  const R = () => ROUNDS[round];
  const unlocked = () => clues.filter((c) => c.unlocked);
  const stageClues = () => unlocked().filter((c) => c.round === round);
  const fieldClues = () => stageClues().filter((c) => !c.data);   // 有现场位置、能瞄准的线索
  const evIndex = (c) => unlocked().indexOf(c);
  const roundKeys = () => clues.filter((c) => c.round === round && c.key);
  // 第 3、4 轮没有现场线索：读完车载数据 / 根钥展开原始字段才能进黑梦
  const gates = { 3: () => ins.done, 4: () => root.done };
  const rootPending = () => round === 4 && root.picked && !root.done;   // 根钥已拾取、还没插入
  const reconReady = () => !!ROUNDS[round] && !roundDone[round] && roundKeys().every((c) => c.done) && (gates[round]?.() ?? true);
  const locked = () => document.pointerLockElement != null;

  function clockText(t) {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
  }
  const frac = (t) => t / R().duration;

  // 打开平板：释放鼠标用来点击界面，视角固定；收起：重新锁定鼠标
  // relock = false 时（Esc 收起）不重新锁定，回到暂停层
  function setTablet(on, relock = true) {
    if (on !== tablet.open) {
      sound.play(on ? 'ui/panel_open' : 'ui/panel_close');
    }
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
    // 第 4 轮根钥已拾取未用：锁住的车辆 B 原始记录下方出现「插入根钥」按钮
    const rootAction = rootPending() ? {
      label: tx('按住 E 插入根钥', 'Hold E to insert the root key'),
      holding: tx('正在接入…', 'Linking…'),
      p: rootP,
    } : null;
    tablet.setData({
      // 只直接列出本轮的线索；之前轮次标 old，平板里收进「之前的线索」折叠项
      // 原始记录被根钥解开后算第 4 轮（showRound）
      clues: [...unlocked(), ...probes.filter((p) => p.done)]
        .map((c) => {
          const old = (c.showRound ?? c.round) < round;
          const action = rootAction && c.id === 'dRaw' ? rootAction : undefined;
          return old || action ? { ...c, old, action } : c;
        }),
      reports: reports.map((k) => ({ key: k, ...REPORTS[k], revisedOn: revised.has(k) })),
      confirm,
      status: statusText(),
    });
  }
  function statusText() {
    if (round >= 4) return roundDone[4] ? tx('复核未结', 'REVIEW OPEN') : tx('第 4 轮复核', 'REVIEW 4');
    if (round === 3) return revised.has('r3') ? tx('移交暂缓', 'HANDOVER HELD') : tx('第 3 轮复核', 'REVIEW 3');
    return revised.has('r2') ? tx('复核挂起', 'REVIEW HELD') : roundDone[2] ? tx('待归档', 'TO ARCHIVE') : tx(`第 ${round} 轮复核`, `REVIEW ${round}`);
  }

  setMode('explore');

  // ---------- 开发测试：跳关 ----------
  // 本轮线索全部标完，直接进入黑梦
  function skipToDream() {
    if (!ROUNDS[round]) return;
    clues.forEach((c) => { if (c.round === round) c.done = true; });
    if (tablet.open) tablet.toggle(false);
    enterDream();
  }
  // 第 1 轮做完，停在第 2 轮开头
  function skipToRound2() {
    lastTask = null;
    clues.forEach((c) => {
      if (c.round === 1) { c.unlocked = true; c.done = true; }
      if (c.round === 2) { c.unlocked = false; c.done = false; }
    });
    probes.forEach((p) => { if (p.round === 1) p.done = true; if (p.round === 2) p.done = false; });
    roundDone[1] = true;
    roundDone[2] = false;
    if (!reports.includes('r1')) reports.push('r1');
    paintTask = false;
    confirm = null;
    revised.clear();
    storyTask = false;
    if (reports.includes('r2')) reports.splice(reports.indexOf('r2'), 1);
    if (tablet.open) tablet.toggle(false);
    resetRound4();
    resetRound3();
    startRound2();
  }
  // 前两轮做完、报告 02 挂起，停在第 3 轮开头
  function skipToRound3() {
    lastTask = null;
    clues.forEach((c) => { if (c.round <= 2) { c.unlocked = true; c.done = true; } });
    probes.forEach((p) => { if (p.round <= 2) p.done = true; });
    roundDone[1] = roundDone[2] = true;
    for (const k of ['r1', 'r2']) if (!reports.includes(k)) reports.push(k);
    revised.add('r2');
    paintTask = false; glint = false;
    confirm = null;
    if (tablet.open) tablet.toggle(false);
    resetRound4();
    resetRound3();
    startRound3();
  }
  // 第 3 轮做完、报告 03 暂不移交，停在第 4 轮开头（根钥未拾取）
  function skipToRound4() {
    skipToRound3();
    clues.forEach((c) => { if (c.round === 3) { c.unlocked = true; c.done = true; } });
    probes.forEach((p) => { if (p.round === 3) p.done = true; });
    ins.done = true;
    pry.done = true; setDoor(DOOR_OPEN);
    slot.setState('done');
    roundDone[3] = true;
    after3Said = true;
    if (!reports.includes('r3')) reports.push('r3');
    revised.add('r3');
    startRound4();
  }

  // 测试按钮只在开发态出现：鼠标未锁定时（暂停画面、平板打开时）显示在右上角
  let syncTestBtns = () => {};
  if (import.meta.env.DEV) {
    const btns = [
      [() => tx('测试 · 直接进黑梦', 'TEST · dream'), skipToDream],
      [() => tx('测试 · 第二轮搜证', 'TEST · round 2'), skipToRound2],
      [() => tx('测试 · 第三轮插卡', 'TEST · card'), skipToRound3],
      [() => tx('测试 · 第四轮根钥', 'TEST · root key'), skipToRound4],
      [() => tx('测试 · 结局被撞', 'TEST · ending'), () => startDeath()],
    ].map(([label, fn], i) => {
      const b = document.createElement('button');
      b.textContent = label();
      b._label = label;
      b.style.cssText = `position:fixed;right:24px;top:${76 + i * 48}px;transform:scale(1.5);transform-origin:right top;z-index:10;padding:8px 16px;font:13px "PingFang SC",sans-serif;letter-spacing:.1em;color:#ffcf6a;background:rgba(5,12,20,.7);border:1px solid rgba(255,207,106,.6);cursor:pointer;`;
      document.body.appendChild(b);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        sound.play('ui/click');
        fn();
        controls.lock();
        b.blur();
      });
      return b;
    });
    syncTestBtns = () => {
      const hide = locked() || mode === 'report' || mode === 'ending' || mode === 'insert' || mode === 'death' ? 'none' : '';
      for (const b of btns) b.style.display = hide;
    };
    document.addEventListener('pointerlockchange', syncTestBtns);
    syncTestBtns();
  }

  function setMode(m) {
    if (m === 'recon' && mode !== 'recon') sound.play('scifi/dream_enter');
    if (m !== 'recon' && mode === 'recon') sound.play('scifi/dream_exit');
    sound.setDream(m === 'recon');
    mode = m;
    holdT = 0; holdKey = false; finishedAnalysis = null;
    fx.setFocus(false);
    ui.setAnalysis(null);
    clock.target = m === 'explore' || m === 'ending' || m === 'insert' || m === 'death' ? 1 : 0;
    fx.setActive(m === 'recon');
    recon.root.visible = m === 'recon';
    ui.setMode(m, m === 'recon' ? tx('黑梦回放 · 找出异常', 'BLACK DREAM · FIND THE BREAK') : tx('现场调查', 'SCENE'));
    ui.setPrompt(null);
    ui.setCinema(m === 'ending');
    controls.enabled = m !== 'ending' && m !== 'insert' && m !== 'death';
    if (m !== 'recon') clearTimeout(dreamExit);
    holdR = false; setDreamHold(0);
    enter.on = false; enter.phase = null;
    if (rite.on) { rite.on = false; ui.setRite(0); }
    hideTip();
    ui.setGuide(null);
    if (m === 'explore') showTask();
    if (m === 'recon') {
      ui.clearToast();
      rt = 0; playing = true;
      recon.setRound(round);
      ui.buildTimeline(timeMarks(), frac);
      showProbeTask();
    }
  }

  // ---------- 进入黑梦 ----------
  // 按住 R 的进度：世界随进度变慢、画面逐渐灰蓝化；松手回落
  function setDreamHold(p) {
    const was = dreamHold;
    dreamHold = p;
    ui.setDreamHold(p);
    if (mode === 'explore' && (p > 0 || was > 0)) {
      clock.target = 1 - p * 0.9;
      fx.setActive(p * 0.7);
    }
  }
  function updateDreamHold(dt) {
    const can = holdR && reconReady() && !tablet.open && locked();
    if (!can && dreamHold === 0) return;
    const p = can ? Math.min(1, dreamHold + dt / DREAM_HOLD) : Math.max(0, dreamHold - dt * 3);
    setDreamHold(p);
    if (p >= 1) { holdR = false; enterDream(); }
  }

  // 切到黑梦，镜头缓慢转向 A 车起点
  // 之后的黑梦：回放立即开始播放，转完交还操作
  // 第 1 轮黑梦（引导）：转向 → 稍等 → 播放，镜头全程跟车 → 播完陈墨说有问题 → 玩家滚滚轮倒回第一个异常时刻 → 暂停、弹出操作说明、交还操作
  // 测试跳到第 2 轮及以后再进黑梦：和正常后续黑梦一样，回放立刻播放，转完交还操作
  function enterDream() {
    setMode('recon');
    const first = firstDream && round === 1;
    rt = 0; playing = !first;
    recon.setTime(0);
    recon.startPos(_look).sub(camera.position).normalize();
    _euler.setFromQuaternion(camera.quaternion, 'YXZ');
    const yaw1 = Math.atan2(-_look.x, -_look.z);
    enter.yaw0 = _euler.y;
    enter.pitch0 = _euler.x;
    enter.dYaw = THREE.MathUtils.euclideanModulo(yaw1 - _euler.y + Math.PI, Math.PI * 2) - Math.PI;
    enter.pitch1 = Math.asin(THREE.MathUtils.clamp(_look.y, -1, 1));
    enter.t = 0;
    enter.on = true;
    enter.phase = 'turn';
    enter.guide = first;
    controls.enabled = false;
    // 第一次进入：扫描波 + 标题
    if (first) {
      rite.t = 0; rite.on = true;
      ui.setRite(0, 0, `RECONSTRUCTION ${String(round).padStart(2, '0')}`);
      fx.pulse(camera.position);
    }
    if (first) firstDream = false;
  }

  function endEnter() {
    enter.on = false;
    enter.phase = null;
    controls.enabled = true;
  }

  // 镜头跟车：平滑地把视线拉向 A 车全息（撞击后换成变形车）
  function followCar(dt) {
    if (!recon.targetPos('carA', _look)) return;
    _look.sub(camera.position).normalize();
    _euler.setFromQuaternion(camera.quaternion, 'YXZ');
    const yaw1 = Math.atan2(-_look.x, -_look.z);
    const pitch1 = Math.asin(THREE.MathUtils.clamp(_look.y, -1, 1));
    const dYaw = THREE.MathUtils.euclideanModulo(yaw1 - _euler.y + Math.PI, Math.PI * 2) - Math.PI;
    const k = 1 - Math.exp(-dt * GUIDE_FOLLOW);
    _euler.set(_euler.x + (pitch1 - _euler.x) * k, _euler.y + dYaw * k, 0, 'YXZ');
    camera.quaternion.setFromEuler(_euler);
  }

  function updateEnter(dt) {
    enter.t += dt;
    const dur = R().duration;
    const advance = () => {
      if (!playing) return;
      const before = rt;
      rt = Math.min(dur, rt + dt);
      if (rt >= dur) playing = false;
      railHit(before);
    };
    switch (enter.phase) {
      // 转向 A 车起点：前后都缓，中段也不快
      case 'turn': {
        const u = Math.min(1, enter.t / DREAM_TURN);
        const e = u * u * u * (u * (u * 6 - 15) + 10);
        _euler.set(enter.pitch0 + (enter.pitch1 - enter.pitch0) * e, enter.yaw0 + enter.dYaw * e, 0, 'YXZ');
        camera.quaternion.setFromEuler(_euler);
        advance();
        if (u >= 1) {
          if (enter.guide) { enter.phase = 'wait'; enter.t = 0; } else endEnter();
        }
        break;
      }
      // 镜头停稳后再开车
      case 'wait':
        if (enter.t >= GUIDE_WAIT) { enter.phase = 'watch'; enter.t = 0; playing = true; }
        break;
      // 完整看一遍，镜头跟车
      case 'watch':
        advance();
        recon.setTime(rt);
        followCar(dt);
        if (!playing) { enter.phase = 'end'; enter.t = 0; }
        break;
      // 播完停一下，陈墨说有问题，要倒回去看
      case 'end':
        followCar(dt);
        if (enter.t >= GUIDE_END) {
          const target = timedProbes().find((c) => !c.done);
          if (!target) { endEnter(); break; }
          enter.phase = 'talk';
          enter.back1 = target.t;
          const r = round;
          // 这段过场不能操作。对白被打断也要进入倒回，否则会停在 talk。
          ui.say(LINES.dreamGuide(clockText(target.t))).then(() => {
            if (mode === 'recon' && round === r && enter.phase === 'talk') { enter.phase = 'scrub'; enter.t = 0; }
          });
        }
        break;
      case 'talk':
        followCar(dt);
        break;
      // 玩家自己滚滚轮倒回异常时刻（只响应滚轮），车跟着倒退，镜头继续跟。进入异常时段即暂停、交还操作
      case 'scrub': {
        recon.setTime(rt);
        followCar(dt);
        const hit = Math.abs(rt - enter.back1) <= PROBE_WINDOW;
        const goal = timedProbes().findIndex((c) => c.t === enter.back1);
        ui.setGuide(hit ? null : tx(`滚动<b>滚轮</b>，把时间倒回 <b class="inv-mono">${clockText(enter.back1)}</b>`, `Scroll the <b>wheel</b> back to <b class="inv-mono">${clockText(enter.back1)}</b>`), goal);
        if (hit) { playing = false; endEnter(); showTip(); }
        break;
      }
    }
    recon.setTime(rt);
    const tp = timedProbes();
    ui.updateTimeline(rt, clockText(rt), tp.map((c) => c.done), tp.findIndex((c) => Math.abs(rt - c.t) <= PROBE_WINDOW), '');
    ui.updateMarkers(markerList(false, false, null));   // 过场里不显示任何菱形
  }

  // 操作说明：第一次黑梦倒回后弹出；开始分析或 TIP_TIME 秒后收起
  function showTip() { tipT = TIP_TIME; ui.setTip(true); }
  function hideTip() { tipT = 0; ui.setTip(false); }

  // 第一次进入的标题：淡入、停留、淡出，字距逐渐拉开
  function updateRite(dt) {
    if (!rite.on) return;
    rite.t = Math.min(DREAM_RITE, rite.t + dt);
    const a = Math.min(1, rite.t / 0.4) * Math.min(1, (DREAM_RITE - rite.t) / 0.6);
    ui.setRite(a, rite.t / DREAM_RITE);
    if (rite.t >= DREAM_RITE) { rite.on = false; ui.setRite(0); }
  }

  // ---------- 输入 ----------
  addEventListener('keydown', (e) => {
    if (e.code === 'Tab') e.preventDefault();
    if (intro) return;   // 开场下车镜头期间不响应调查操作
    if (mode === 'death') return;   // 结局动画：玩家不能操作
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
    // 开发测试：探索中按 F，完成当前轮下一条现场线索。暂停时也能按
    if (import.meta.env.DEV && e.code === 'KeyF' && !e.repeat && mode === 'explore' && !tablet.open) {
      completeOneClue();
      return;
    }
    // 平板打开时鼠标已释放，按键照常处理
    if (!locked() && !tablet.open) return;

    // 报告页：待确认时按住 E 确认、TAB 暂不确认；质询对话中 TAB 跳过；没有确认或已挂起时 TAB / Esc 收起
    // 接入画面（根钥、对象索引）播放期间不响应
    if (mode === 'report') {
      if (tablet.hacking) return;
      const st = confirm?.state;
      const closable = !confirm || st === 'suspended';
      if (e.code === 'KeyE' && st === 'idle') holdConfirm = true;
      else if (e.code === 'Tab' && st === 'idle' && !e.repeat) declineReport();
      else if (e.code === 'Tab' && st === 'talking' && !e.repeat) holdSkip = true;
      else if ((e.code === 'Tab' || e.code === 'Escape') && closable && !e.repeat) closeReport(e.code === 'Tab');
      else tablet.nav(e.code);
      return;
    }

    // 平板只在探索时可用；打开期间按键都交给平板
    if (e.code === 'Tab' && mode === 'explore') {
      if (!e.repeat) {
        const first = !tablet.open && guideTablet;
        setTablet(!tablet.open);
        if (first) { guideTablet = false; tablet.showReport('initial'); }
        else if (tablet.open && rootPending()) tablet.showClue('dRaw');
      }
      return;
    }
    if (tablet.open) {
      if (e.code === 'KeyE' && rootPending()) rootHold = true;
      if (!tablet.nav(e.code) && e.code === 'Escape') setTablet(false, false);
      return;
    }
    if (enter.on) return;   // 进入黑梦的过场：不响应操作
    if (e.code === 'KeyQ' && mode === 'explore') scan();
    if (e.code === 'KeyR' && mode === 'recon' && !e.repeat) leaveRecon();
    if (e.code === 'KeyE') {
      holdKey = true;
      if (mode === 'recon' && !e.repeat) {
        if (aimedProbe && aimedProbe.done) ui.showClue(aimedProbe, 0);
      } else if (mode === 'explore' && !e.repeat && doorAimed) { holdKey = false; startPry(); }
      else if (mode === 'explore' && !e.repeat && portAimed) { holdKey = false; startInsert(); }
      else if (mode === 'explore' && !e.repeat && keyAimed) { holdKey = false; startKeyGrab(); }
      else if (mode === 'explore' && !e.repeat && aimed && aimed.done) ui.showClue(aimed, evIndex(aimed));
    }
    if (e.code === 'KeyR' && mode === 'explore' && !e.repeat) holdR = true;
    if (e.code === 'Space' && mode === 'recon') {
      if (rt >= R().duration) rt = 0;
      playing = !playing;
    }
  });
  addEventListener('keyup', (e) => {
    if (e.code === 'KeyE') { holdKey = false; holdConfirm = false; rootHold = false; }
    if (e.code === 'KeyR') holdR = false;
    if (e.code === 'Tab') holdSkip = false;
  });
  document.addEventListener('pointerlockchange', () => {
    if (!locked()) {
      holdR = false;
      holdKey = false; holdT = 0; finishedAnalysis = null;
      fx.setFocus(false); vm.analyze(null, 0); ui.setAnalysis(null);
    }
  });
  // 开场通话在跟车镜头里播，不在下车之后
  function beginOpening() {
    if (started) return;
    started = true;
    ui.setCinema(true);
    // 黑幕淡出 3.6 秒，完全揭开前 2 秒开始字幕
    const left = loading.fadeLeft;
    const delay = left == null ? 1600 : Math.max(0, left - 2000);
    setTimeout(() => { if (intro) ui.say(LINES.opening, { radio: true }); }, delay);
  }
  addEventListener('wheel', (e) => {
    if (mode !== 'recon' || (enter.on && enter.phase !== 'scrub')) return;
    playing = false;
    rt = THREE.MathUtils.clamp(rt + e.deltaY * 0.0025, 0, R().duration);
  }, { passive: true });

  // ---------- 黑梦：分析点 ----------
  // 本轮黑梦完成：key 分析点全部分析
  const keyProbes = () => probes.filter((c) => c.round === round && c.key);
  // 带时间点的分析点，在进度条上显示为黄块
  const timedProbes = () => probes.filter((c) => c.round === round && c.t != null);
  // 黄块覆盖可分析的整段：分析点时刻前后各 PROBE_WINDOW
  const timeMarks = () => timedProbes().map((m) => ({
    t0: Math.max(0, m.t - PROBE_WINDOW),
    t1: Math.min(R().duration, m.t + PROBE_WINDOW),
  }));
  const roundComplete = () => keyProbes().every((c) => c.done);

  // 最后一个分析点完成：等结果面板关闭，独白没说完就再等它说完，然后自动离开黑梦并打开终端
  function scheduleDreamExit(said) {
    const r = round;
    const wait = new Promise((res) => { dreamExit = setTimeout(res, DREAM_EXIT_DELAY); });
    Promise.all([said, wait]).then(([completed]) => {
      if (completed === false) return;
      if (mode === 'recon' && round === r) advanceAfterDream();
    });
  }

  // 黑梦分析完：直接打开本轮报告
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
    setMode('report');
    setTablet(true);
    tablet.showReport(key);
    syncTablet();
  }

  // ---------- 复核报告 ----------
  // R 离开黑梦：分析已完成就直接出报告，否则回到现场
  function leaveRecon() {
    if (roundComplete() && !roundDone[round]) advanceAfterDream();
    else setMode('explore');
  }

  function makeConfirm(key) {
    if (!REPORTS[key].confirm || revised.has(key)) return null;
    return { key, p: 0, state: 'idle', text: '', onDecline: declineReport };
  }

  // 点在终端画面外面：和 Tab / Esc 能收起时一样收起。返回 false 表示这次点击没有作用（无效点击音）
  function closeTabletFromBlank() {
    if (intro || mode === 'death' || mode === 'ending') return false;
    if (mode === 'insert') {
      if (ins.phase !== 'data') return false;
      finishInsert(false);
      return true;
    }
    if (mode === 'report') {
      if (tablet.hacking) return false;
      const closable = !confirm || confirm.state === 'suspended';
      if (closable) closeReport(false);
      return closable;
    }
    if (tablet.open) setTablet(false, true);
    return true;
  }

  // 收起报告：按剧情阶段决定下一步
  function closeReport(relock) {
    // 报告 04：平板不收起，直接接着播对象索引，走完停住再按 TAB 收起
    if (round === 4 && roundDone[4] && !finale) {
      finale = 'index';
      tablet.hack(TARGET_INDEX, null);
      return;
    }
    const key = confirm?.key;
    const suspended = confirm?.state === 'suspended';
    confirm = null;
    if (key === 'r2' && suspended && !storyTask) storyTask = true;
    setTablet(false, relock);
    setMode('explore');
    if (paintTask) {
      paintTask = false;
      startRound2();
    } else if (key === 'r2' && suspended && round === 2) {
      pressureCall();
    } else if (key === 'r3' && suspended && !after3Said) {
      after3Said = true;
      setTimeout(() => ui.say(LINES.after3).then((completed) => {
        if (!completed) return;
        if (round === 3) startRound4();
      }), 700);
    } else if (round === 4 && root.done && !root.told) {
      root.told = true;
      showTask();
    } else if (finale === 'index') {
      finale = 'done';
      showTask();
      setTimeout(() => ui.say(LINES.target).then(() => {
        if (finale !== 'done' || mode !== 'explore') return;
        setTimeout(() => {
          if (finale !== 'done' || mode !== 'explore') return;
          startDeath();
        }, 1500);
      }), 600);
    }
  }

  function updateReport(dt) {
    reportT += dt;
    // 质询对话：按住 TAB 读条，走满跳过；松开回退
    if (confirm?.state === 'talking') {
      skipP = holdSkip ? skipP + dt / SKIP_TIME : Math.max(0, skipP - dt * 2);
      ui.setSkip(true, skipP);
      if (skipP >= 1) skipQuestion();
      return;
    }
    if (!confirm || confirm.state !== 'idle') return;
    const ready = reportT > 1.8;   // 报告逐行打完、确认按钮出现之后
    const before = confirm.p;
    confirm.p = holdConfirm && ready ? confirm.p + dt / CONFIRM_TIME : Math.max(0, confirm.p - dt * 2);
    if (confirm.p !== before) syncTablet();
    if (confirm.p >= 1) archiveReport();
  }

  // ---------- 暂不确认 → 质问仪器 → 报告改写（报告 02、03）----------
  // 质询对话中右下角提示「按住 TAB 跳过」（读条走满才跳），跳过后直接改写报告
  function declineReport() {
    if (!confirm || confirm.state !== 'idle') return;
    const key = confirm.key;
    confirm.state = 'talking';
    confirm.text = tx('复核质询中…', 'Questioning the report…');
    holdConfirm = false;
    syncTablet();
    holdSkip = false; skipP = 0;
    ui.setSkip(true);
    // 被跳过时 skipQuestion 已经改写，这里收到 false 不再重复
    ui.say(LINES[REPORTS[key].confirm.question]).then((completed) => {
      if (!completed) return;
      finishQuestion(key);
    });
  }
  function skipQuestion() {
    if (confirm?.state !== 'talking') return;
    ui.hush();
    finishQuestion(confirm.key);
  }
  function finishQuestion(key) {
    if (mode !== 'report' || confirm?.key !== key || confirm.state !== 'talking') return;
    const cf = REPORTS[key].confirm;
    holdSkip = false; skipP = 0;
    ui.setSkip(false);
    revised.add(key);
    confirm.state = 'suspended';
    confirm.text = cf.suspended;
    tablet.glitch(0.45);
    tablet.showReport(key);
    syncTablet();
    ui.say(LINES[cf.after]);
  }

  // 收起挂起的报告 02：派单员催单，陈墨拒绝交单，给出第 3 轮目标
  function pressureCall() {
    setTimeout(() => {
      ui.say(LINES.call2, { radio: true }).then((completed) => {
        if (!completed) return;
        if (round === 2) startRound3();
      });
    }, 700);
  }
  // 左侧现场任务：第 1、2 轮是线索计数（满了切成「按住 R 构建黑梦」），报告 02 挂起后按剧情阶段给出
  function exploreTask() {
    const dream = (key) => ({ key, html: tx('按住 <b>R</b> 构建<small>黑梦</small>', 'Hold <b>R</b> to build<small>the dream</small>'), ready: true });
    const goal = (key, zh, en) => ({ key, html: tx(zh, en) });
    if (!storyTask) {
      const list = stageClues();
      const done = list.filter((c) => c.done).length, total = list.length;
      if (total > 0 && done >= total) return dream(`dream${round}`);
      return { key: `clues${round}`, html: `${done} / ${total}<small>${tx('线索', 'CLUES')}</small>`, bar: total ? done / total : 0, search: total > 0 };
    }
    if (round < 3) return goal('why', '查清<b>接触前</b>为什么转向', 'Find why it turned <b>before contact</b>');
    if (round === 3 && !pry.done) return goal('pry', '撬开<b>右侧车门</b><small>门尾已经翘起</small>', 'Pry the <b>right door</b><small>the tail is sprung</small>');
    if (round === 3 && !ins.done) return goal('card', '在转向柱下方<b>检修接口</b>插卡', 'Card the <b>service port</b> under the column');
    if (round === 3 && !roundDone[3]) return dream('dream3');
    if (round === 3) return goal('zero', '核实<b>零号保障</b>的来源', 'Check where <b>Zero Priority</b> came from');
    if (!root.picked) return goal('findKey', '在驾驶舱里找<b>程叙的根钥</b>', 'Find <b>Cheng Xu’s root key</b> in the cabin');
    if (!root.done) return goal('readKey', '用<b>根钥</b>读取黄色车辆原始记录<small>TAB 打开平板</small>', 'Read the yellow car with the <b>root key</b><small>TAB opens the tablet</small>');
    if (!roundDone[4]) return dream('dream4');
    return goal('car', '回到<b>警车</b>', 'Return to the <b>police car</b>');
  }
  // 刷新左侧任务：排在上一个任务后面就播「完成 → 新目标」，否则原地刷新
  function showTask() {
    const t = exploreTask();
    const advance = lastTask !== null && TASK_ORDER.indexOf(t.key) > TASK_ORDER.indexOf(lastTask);
    lastTask = t.key;
    ui.setTask(t, { advance });
  }
  // 黑梦里的左侧计数：异常分析满了只播完成，回到现场时直接出新目标
  function showProbeTask() {
    const list = keyProbes();
    const done = list.filter((c) => c.done).length, total = list.length;
    ui.setTask({ key: `probe${round}`, html: `${done} / ${total}<small>${tx('异常已分析', 'ANOMALIES')}</small>`, bar: total ? done / total : 0 });
    if (total > 0 && done >= total) ui.completeTask();
  }

  // ---------- 第 3 轮：插卡读取车载数据 ----------
  function startRound3() {
    round = 3;
    storyTask = true;
    ins.done = false; ins.phase = null; ins.animT = -1; cardArm?.hide();
    pry.done = false; pry.phase = null; setDoor(DOOR_AJAR); pryArm?.hide();
    slot.setState('idle');
    if (mode === 'explore') setMode('explore');
    syncTablet();
  }
  function resetRound3() {
    storyTask = false;
    after3Said = false;
    roundDone[3] = false;
    ins.done = false; ins.phase = null; ins.animT = -1; cardArm?.hide();
    pry.done = false; pry.phase = null; setDoor(DOOR_AJAR); pryArm?.hide();
    slot.setState('idle');
    clues.forEach((c) => { if (c.round === 3) { c.unlocked = false; c.done = false; } });
    probes.forEach((p) => { if (p.round === 3) p.done = false; });
    if (reports.includes('r3')) reports.splice(reports.indexOf('r3'), 1);
  }

  // ---------- 第 4 轮：根钥展开原始字段 ----------
  function startRound4() {
    round = 4;
    storyTask = true;
    root.picked = false; root.done = false; root.told = false;
    rootKey.setVisible(true);
    finale = null;
    if (mode === 'explore') setMode('explore');
    syncTablet();
  }
  function resetRound4() {
    if (round === 4) round = 3;
    root.picked = false; root.done = false; root.told = false;
    rootKey.setVisible(false);
    finale = null;
    roundDone[4] = false;
    clues.forEach((c) => { if (c.round === 4) { c.unlocked = false; c.done = false; } });
    probes.forEach((p) => { if (p.round === 4) p.done = false; });
    // 车辆 B 原始记录恢复成锁住的摘要
    const raw = clues.find((c) => c.id === 'dRaw'), def = CLUES_ZH.find((c) => c.id === 'dRaw');
    Object.assign(raw, { locked: true, name: def.name, lines: def.lines, main: def.main, result: def.result, prob: def.prob, src: undefined, showRound: undefined });
    if (reports.includes('r4')) reports.splice(reports.indexOf('r4'), 1);
  }
  // 拾取根钥后自动举起平板，停在锁住的车辆 B 原始记录上，等玩家点「插入根钥」
  // said：拾取独白的 Promise，说完才接着播读取后的质问
  let keySaid = Promise.resolve();
  function openRootTablet(said = Promise.resolve()) {
    keySaid = said;
    setTablet(true);
    tablet.showClue('dRaw');
  }
  // 按住读条走满：切到报告模式（接入期间不能收起），播放接入画面
  function updateRootHold(dt) {
    const active = rootPending() && tablet.open && !tablet.hacking && mode === 'explore' && tablet.actionVisible;
    if (!active) {
      rootHold = false;
      if (rootP !== 0) { rootP = 0; syncTablet(); }
      return;
    }
    const holding = rootHold || tablet.actionHeld;
    const before = rootP;
    rootP = holding ? Math.min(1, rootP + dt / CONFIRM_TIME) : Math.max(0, rootP - dt * 2);
    if (rootP !== before) syncTablet();
    if (rootP >= 1) startRoot();
  }
  function startRoot() {
    if (!rootPending() || tablet.hacking) return;
    setMode('report');
    if (!tablet.open) setTablet(true);
    tablet.showClue('dRaw');
    tablet.hack(ROOT_HACK, onRootDone);
  }
  function onRootDone() {
    const raw = clues.find((c) => c.id === 'dRaw');
    Object.assign(raw, { locked: false, showRound: 4, ...CLUES_ZH.find((c) => c.id === 'dRaw').raw });
    clues.forEach((c) => { if (c.round === 4) { c.unlocked = true; c.done = true; } });
    root.done = true;
    syncTablet();
    tablet.showClue('rTime');
    keySaid.then((completed) => {
      if (completed === false) return;
      if (round !== 4 || mode === 'death') return;
      // 先说原始记录和时间差，再说质问。这两句不再在翻看详情时重复。
      dataSaid.add('dRawOpen');
      dataSaid.add('rTime');
      ui.say([...LINES.clueDRawOpen, ...LINES.clueRTime, ...LINES.rootRead]);
    });
  }

  const CAM_IN = 0.9, CAM_OUT = 0.7;
  const _m = new THREE.Matrix4();
  const _hack = new THREE.Vector3(), _type = new THREE.Vector3();
  const hackSource = () => (ins.phase ? slot.world : camera.getWorldDirection(_hack).multiplyScalar(0.45).add(camera.position));

  // ---------- 进出驾驶舱的镜头路径（第 3 轮插卡、第 4 轮拿根钥共用） ----------
  // 不能从站姿直线插进车里（会从车顶穿进去）：先蹲到右门门洞外侧、门框顶以下，再横着从门洞钻进驾驶舱
  const CABIN_OUTSIDE = 0.55;            // 门洞外侧的过渡点离门线多远（米）
  const CABIN_HEADROOM = 0.15;           // 车内机位至少比门框顶低这么多（米）
  const _zAxis = new THREE.Vector3(0, 0, 1);
  const _cp = new THREE.Vector3(), _cq = new THREE.Quaternion(), _cr = new THREE.Quaternion();
  // 车门关上时的位置（门本地坐标 → 世界）：门洞就在这里。门绕本地 Y 转开，去掉 Y 旋转即关闭姿态
  function doorClosedMatrix() {
    const n = door.node;
    const m = new THREE.Matrix4().compose(n.position, new THREE.Quaternion().setFromEuler(new THREE.Euler(n.rotation.x, 0, n.rotation.z, n.rotation.order)), n.scale);
    if (n.parent) { n.parent.updateMatrixWorld(true); m.premultiply(n.parent.matrixWorld); }
    return m;
  }
  // start：站姿镜头位置；camTo：车内机位（高度会被压到门框顶以下，原地修改）。返回 0 站姿 → 1 车内 的曲线
  function cabinPath(start, camTo) {
    if (!door.node) return new THREE.CatmullRomCurve3([start.clone(), camTo.clone()]);
    const out = new THREE.Vector3(0, 0, 1).transformDirection(crash.carGroup.matrixWorld).setY(0).normalize();   // 副驾一侧（右门）
    const b = door.box, dm = doorClosedMatrix();
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    const opening = new THREE.Vector3(cx, b.min.y + (b.max.y - b.min.y) * 0.55, cz).applyMatrix4(dm);
    const top = new THREE.Vector3(cx, b.max.y, cz).applyMatrix4(dm).y;
    camTo.y = Math.min(camTo.y, top - CABIN_HEADROOM);
    // 门洞外侧的过渡点：和门洞同一前后位置、在门线外，高度与车内机位一致（已经蹲下）
    const outside = opening.addScaledVector(out, CABIN_OUTSIDE);
    outside.y = camTo.y;
    return new THREE.CatmullRomCurve3([start.clone(), outside, camTo.clone()], false, 'centripetal');
  }
  // 沿路径第 v 处摆镜头：位置在路径上；朝向前段从站姿视线转向 look，之后一直盯着 look，roll（歪头）随 v 逐渐加上
  // v = 1 时与 lookAt(camTo, look) × roll 一致
  function poseCabin(path, v, quatFrom, look, roll = 0) {
    path.getPointAt(v, _cp);
    camera.position.copy(_cp);
    _m.lookAt(_cp, look, camera.up);
    _cq.setFromRotationMatrix(_m);
    if (roll) _cq.multiply(_cr.setFromAxisAngle(_zAxis, roll * v));
    camera.quaternion.slerpQuaternions(quatFrom, _cq, THREE.MathUtils.smoothstep(v, 0, 0.35));
  }
  // 镜头探进驾驶舱、正对转向柱下方的接口，微微俯视
  function startInsert() {
    if (!slot.ready || ins.phase) return;
    setMode('insert');
    ui.setPrompt(null);
    ui.clearToast();
    ins.phase = 'camIn'; ins.t = 0;
    ins.animT = -1; ins.hit = false;
    ins.camFrom.copy(camera.position);
    ins.quatFrom.copy(camera.quaternion);
    ins.saved = camera.position.clone();
    ins.savedQuat = camera.quaternion.clone();
    // 从副驾一侧探身进驾驶舱：镜头在接口外侧偏后、略高，右手从画面右侧伸进来
    // 插卡动画加载好后，终点机位用 Blender 里摆好的 CardCam（与下面算法的结果一致，保证手和卡槽对齐）
    const back = new THREE.Vector3(-1, 0, 0).transformDirection(crash.carGroup.matrixWorld).setY(0).normalize();
    ins.camTo.copy(slot.world).addScaledVector(slot.normal, 0.42).addScaledVector(back, 0.18);
    ins.camTo.y += 0.16;
    if (cardArm?.ready) cardArm.camPose(ins.camTo, ins.quatTo);
    ins.path = cabinPath(ins.saved, ins.camTo);
    if (!cardArm?.ready) {
      _m.lookAt(ins.camTo, slot.world, camera.up);
      ins.quatTo.setFromRotationMatrix(_m);
    }
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
  }
  // 收起平板。合上之后先拔卡（镜头停在车里），拔完再起身
  function finishInsert(relock) {
    ins.phase = 'out';
    sound.play('ui/panel_close');
    tablet.toggle(false);
    if (relock) controls.lock();
    else controls.showPause();
  }
  // 锁定期间相机由这里控制（玩家更新仍会把高度拉回站姿，所以每帧覆盖）
  const _q = new THREE.Quaternion();
  const PULL_OUT = 0.4 + 0.15 + 0.15;   // 拔卡段里卡离开卡槽的时刻（指示灯回到待机）
  function updateInsert(dt) {
    ins.t += dt;
    // 插卡动画：推到底时读卡；之后松手、手收出画面，卡留在槽里（不管 phase 走到哪一步都播完）
    if (ins.animT >= 0 && ins.animT < CARD_INSERT_END) {
      ins.animT = Math.min(CARD_INSERT_END, ins.animT + dt);
      cardArm.set(ins.animT);
      if (!ins.hit && ins.animT >= CARD_HIT) { ins.hit = true; onCardInserted(); }
    }
    // 平板合上：先拔卡，拔完再起身（插卡动画没播完就等它播完）
    if (ins.phase === 'out' && tablet.amount <= 0 && (ins.animT < 0 || ins.animT >= CARD_INSERT_END)) {
      if (cardArm?.ready && ins.animT >= 0) { ins.phase = 'pull'; ins.t = 0; ins.pulled = false; }
      else { ins.phase = 'camOut'; ins.t = 0; slot.setState('idle'); }
    }
    if (ins.phase === 'pull') {
      cardArm.set(CARD_PULL0 + ins.t);
      if (ins.t >= PULL_OUT && !ins.pulled) { ins.pulled = true; slot.setState('idle'); }
      if (ins.t >= CARD_PULL_END - CARD_PULL0) {
        cardArm.hide();
        slot.setState('idle');
        ins.phase = 'camOut'; ins.t = 0;
      }
    }
    if (ins.phase === 'camIn' || ins.phase === 'camOut') {
      const out = ins.phase === 'camOut';
      const u = THREE.MathUtils.smootherstep(Math.min(1, ins.t / (out ? CAM_OUT : CAM_IN)), 0, 1);
      poseCabin(ins.path, out ? 1 - u : u, ins.quatFrom, slot.world);
      if (ins.t >= (out ? CAM_OUT : CAM_IN)) {
        if (out) {
          ins.phase = null;
          setMode('explore');
          return;
        }
        // 镜头到位：开始插卡动画（模型没加载好就直接读卡）
        ins.phase = 'card';
        if (cardArm?.ready) { ins.animT = 0; ins.hit = false; cardArm.set(0); }
        else onCardInserted();
      }
    } else {
      camera.position.copy(ins.camTo);
      camera.quaternion.copy(ins.quatTo);
    }
  }

  // ---------- 第 3 轮：撬开右侧车门 ----------
  // 关键帧（秒, 度）：两次拽不动 → 卡扣崩开猛地弹开一截 → 吱嘎着拉到 55°，回弹一点停住
  const PRY_KEYS = [[0, 7], [0.25, 11], [0.45, 9], [0.8, 14], [1.05, 12.5], [1.25, 13], [1.38, 24], [1.55, 27], [2.5, 54], [2.75, 57], [3.0, 55]];
  const PRY_END = 3.3;
  const PRY_POP = 1.36;   // 卡扣崩开、车门猛地弹开一截的时刻；撬开声的峰值对准这里
  function pryAngle(t) {
    if (t <= 0) return PRY_KEYS[0][1];
    for (let i = 1; i < PRY_KEYS.length; i++) {
      const [t1, a1] = PRY_KEYS[i], [t0, a0] = PRY_KEYS[i - 1];
      if (t <= t1) return a0 + (a1 - a0) * THREE.MathUtils.smoothstep(t, t0, t1);
    }
    return PRY_KEYS[PRY_KEYS.length - 1][1];
  }
  // 镜头走到门尾斜后方、站在门的外侧：门向外张开时从画面前方扫过，不会撞到镜头
  // 撬棍模型加载好后，机位用 Blender 里摆好的 PryCam（和手、撬棍的动画对齐）
  function startPry() {
    if (!door.node || pry.phase || pry.done) return;
    setMode('insert');
    ui.setPrompt(null);
    ui.clearToast();
    pry.phase = 'camIn'; pry.t = 0;
    pry.camFrom.copy(camera.position);
    pry.quatFrom.copy(camera.quaternion);
    pry.saved = camera.position.clone();
    pry.savedQuat = camera.quaternion.clone();
    const m = crash.carGroup.matrixWorld;
    const out = new THREE.Vector3(0, 0, 1).transformDirection(m).setY(0).normalize();
    const back = new THREE.Vector3(-1, 0, 0).transformDirection(m).setY(0).normalize();
    const h = doorHandle().clone();
    pry.camTo.copy(h).addScaledVector(out, 1.15).addScaledVector(back, 0.55);
    pry.camTo.y = camera.position.y - 0.15;
    const look = h.clone().addScaledVector(back, -0.35);
    look.y -= 0.1;
    _m.lookAt(pry.camTo, look, camera.up);
    pry.quatTo.setFromRotationMatrix(_m);
    if (pryArm?.ready) pryArm.camPose(pry.camTo, pry.quatTo);
  }
  function updatePry(dt) {
    pry.t += dt;
    if (pry.phase === 'camIn' || pry.phase === 'camOut') {
      const out = pry.phase === 'camOut';
      const dur = out ? CAM_OUT : CAM_IN;
      const u = THREE.MathUtils.smootherstep(Math.min(1, pry.t / dur), 0, 1);
      camera.position.lerpVectors(out ? pry.camTo : pry.camFrom, out ? pry.saved : pry.camTo, u);
      camera.quaternion.slerpQuaternions(out ? pry.quatTo : pry.quatFrom, out ? pry.savedQuat : pry.quatTo, u);
      if (pry.t < dur) return;
      if (out) {
        pry.phase = null;
        setMode('explore');
        showTask();
        ui.toast(tx('车门已撬开', 'Door open'), tx('转向柱下方有检修接口 · 瞄准按 E 插卡', 'Service port under the column · aim and press E'), 4000);
        return;
      }
      // 镜头到位：右手举起撬棍插进门缝，插稳后开始撬（模型没加载好就直接撬）
      // 撬棍插进门缝时响插入声（模型没加载好、直接开撬时立刻响）
      if (pryArm?.ready) { pry.phase = 'brace'; pry.hit = false; pryArm.set(0); }
      else { pry.phase = 'pry'; sound.play('foley/pry_insert', { position: doorHandle() }); }
      pry.t = 0;
      pry.popped = false;
      return;
    }
    if (pry.phase === 'brace') {
      camera.position.copy(pry.camTo);
      camera.quaternion.copy(pry.quatTo);
      pryArm.set(pry.t);
      if (!pry.hit && pry.t >= PRY_HIT) { pry.hit = true; sound.play('foley/pry_insert', { position: doorHandle() }); }
      if (pry.t >= PRY_INSERT) { pry.phase = 'pry'; pry.t = 0; }
      return;
    }
    // pry：车门按关键帧张开，镜头跟着用力的节奏晃
    if (!pry.popped && pry.t >= PRY_POP - PEAK.pryOpen) { pry.popped = true; sound.play('foley/pry_open', { position: doorHandle() }); }
    const deg = pryAngle(pry.t);
    setDoor(deg * Math.PI / 180);
    pryArm?.set(PRY_INSERT + pry.t);
    const tug = pry.t < 1.3 ? Math.max(0, Math.sin(pry.t * 9)) * 0.012 : 0;
    const jolt = Math.max(0, 1 - Math.abs(pry.t - 1.4) / 0.25) * 0.03;
    camera.position.copy(pry.camTo);
    camera.position.x += (Math.random() - 0.5) * jolt;
    camera.position.y += (Math.random() - 0.5) * jolt - tug;
    camera.quaternion.copy(pry.quatTo);
    if (pry.t >= PRY_END) {
      pry.done = true;
      setDoor(DOOR_OPEN);
      pryArm?.hide();
      pry.phase = 'camOut'; pry.t = 0;
    }
  }

  // ---------- 第 4 轮：驾驶舱里拾取根钥 ----------
  // 按 E：从副驾门探身进驾驶舱，俯视座椅和中控之间的缝，往前一够把根钥拿走，再退出来
  // 只做镜头，不显示手。镜头退回站姿后播独白，同时平板自动举起接入根钥（pickRootKey）
  // 镜头路径同插卡：先蹲到门洞外侧，再从门洞钻进去（cabinPath）
  const GRAB_IN = 1.0, GRAB_REACH = 0.3, GRAB_HOLD = 0.35, GRAB_OUT = 0.8;
  const GRAB_DIP = 0.07;                 // 「够」一下时镜头朝根钥前探的距离（米）
  const GRAB_ROLL = THREE.MathUtils.degToRad(6); // 身体压在副驾座上，头略歪
  const grab = { phase: null, t: 0, path: null, quatFrom: new THREE.Quaternion(), camTo: new THREE.Vector3(), quatTo: new THREE.Quaternion(), dir: new THREE.Vector3() };
  function startKeyGrab() {
    if (root.picked || grab.phase || !rootKey.ready || !door.node) return;
    setMode('insert');
    ui.setPrompt(null);
    ui.clearToast();
    grab.phase = 'camIn'; grab.t = 0;
    grab.quatFrom.copy(camera.quaternion);
    const m = crash.carGroup.matrixWorld;
    const out = new THREE.Vector3(0, 0, 1).transformDirection(m).setY(0).normalize();   // 副驾一侧（右门）
    const back = new THREE.Vector3(-1, 0, 0).transformDirection(m).setY(0).normalize();
    const key = rootKey.world;
    // 头在中控通道上方偏副驾一侧、略靠后，往下斜看那条缝（高度由 cabinPath 压到门框顶以下）
    grab.camTo.copy(key).addScaledVector(out, 0.5).addScaledVector(back, 0.12);
    grab.camTo.y = key.y + 0.38;
    grab.path = cabinPath(camera.position, grab.camTo);
    _m.lookAt(grab.camTo, key, camera.up);
    grab.quatTo.setFromRotationMatrix(_m);
    grab.quatTo.multiply(_q.setFromAxisAngle(_zAxis, GRAB_ROLL));
    grab.dir.copy(key).sub(grab.camTo).normalize();
  }
  function updateKeyGrab(dt) {
    grab.t += dt;
    const P = grab.phase;
    if (P === 'camIn' || P === 'camOut') {
      const out = P === 'camOut';
      const dur = out ? GRAB_OUT : GRAB_IN;
      const u = THREE.MathUtils.smootherstep(Math.min(1, grab.t / dur), 0, 1);
      poseCabin(grab.path, out ? 1 - u : u, grab.quatFrom, rootKey.world, GRAB_ROLL);
      if (grab.t >= dur) {
        grab.t = 0;
        if (out) {
          grab.phase = null;
          setMode('explore');
          if (round === 4) pickRootKey();   // 期间被测试按钮重置过就不再拾取
        } else grab.phase = 'reach';
      }
      return;
    }
    // reach：往前一探，到最深处拿走根钥，再收回；hold：停一下再退出
    let dip = 0;
    if (P === 'reach') {
      dip = Math.sin(Math.min(1, grab.t / GRAB_REACH) * Math.PI);
      if (grab.t >= GRAB_REACH * 0.5) rootKey.setVisible(false);
      if (grab.t >= GRAB_REACH) { grab.phase = 'hold'; grab.t = 0; }
    } else if (P === 'hold' && grab.t >= GRAB_HOLD) {
      grab.phase = 'camOut'; grab.t = 0;
    }
    camera.position.copy(grab.camTo).addScaledVector(grab.dir, GRAB_DIP * dip);
    camera.quaternion.copy(grab.quatTo);
  }
  function pickRootKey() {
    if (root.picked) return;
    root.picked = true;
    rootKey.setVisible(false);
    syncTablet();
    showTask();
    openRootTablet(ui.say(LINES.keyFound));
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

  // ---------- 结局：被跑车撞飞 → 终端自动归档 → 黑屏 ----------
  function startDeath() {
    if (mode === 'death') return;
    if (tablet.open) tablet.toggle(false);
    confirm = null; holdConfirm = false; ui.setSkip(false);
    ui.hush(); ui.clearToast(); ui.hidePanel(); ui.ending(null);
    setMode('death');
    ui.setMode('cut', '');
    syncTestBtns();
    death.play(() => {
      // 游戏结束：停在黑屏，释放鼠标但不弹暂停层
      controls.keepOverlayHidden = true;
      controls.unlock();
      // 黑屏停一会儿，再淡入「序章 · 完」，停在这一屏
      setTimeout(() => ui.fin(true), 1200);
    });
  }

  const SCRAPE_ALPHA = 1;   // 第 2 轮车门残漆随双闪反光的可见度

  function startRound2() {
    round = 2;
    glint = true;
    props.setTracks(true);
    clues.forEach((c) => { if (c.round === 2) c.unlocked = true; });
    setMode('explore');
    syncTablet();
    setTimeout(() => ui.say(LINES.after1), 700);
  }

  // 分析完车门残漆：熄掉残漆反光
  function onScrapeDone() {
    glint = false;
    props.setScrape(SCRAPE_ALPHA, 0);
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
    // 发射瞬间世界声音高切一下（Radar Snapshot）
    if (!vm.scan((origin) => { clues.forEach((c) => { c.hit = false; }); fx.pulse(origin); sound.radarDuck(); })) return;
    sound.play('scifi/radar');   // Studio 里素材后移 0.198 秒，峰值落在举枪 0.5 秒后的发射瞬间
    scanCd = SCAN_COOLDOWN;
  }

  // 现场线索分析完：线索计数满了以后 HUD 自己切成「按住 R 构建黑梦」
  function finishClue(c) {
    showTask();
    if (c.id === 'scrape') onScrapeDone();
    // 这条线索的独白；本轮现场线索都标完时接上「去构建黑梦」，连成一段播
    const lines = CLUE_LINES[c.id] ? [...LINES[CLUE_LINES[c.id]]] : [];
    const ready = READY_LINES[round];
    if (ready && !readySaid.has(round) && reconReady()) {
      readySaid.add(round);
      lines.push(...LINES[ready]);
    }
    if (lines.length) sayAfterPanel(lines);
  }

  // 分析完成后的独白：等结果面板弹出、结论那一行出来再开口（面板 0.45 秒后弹出，结论再晚约 0.8 秒）。
  // 返回说完时 resolve 的 Promise；等待期间离开当前模式（提前出黑梦等）就不说了
  let pendingSay = null;   // { lines, t, mode, resolve }
  function sayAfterPanel(lines) {
    pendingSay?.resolve(false);
    return new Promise((resolve) => { pendingSay = { lines, t: LINE_DELAY, mode, resolve }; });
  }
  function tickPendingSay(dt) {
    if (!pendingSay) return;
    const p = pendingSay;
    if (mode !== p.mode) { pendingSay = null; p.resolve(false); return; }
    p.t -= dt;
    if (p.t > 0) return;
    pendingSay = null;
    ui.say(p.lines).then(p.resolve);
  }

  // 接管记录的结论打出之后才说。接入画面结束时先停在这一页，不提前开口。
  let cardReadSaid = false;
  function tickCardRead() {
    if (cardReadSaid || ui.talking) return;
    if (tablet.viewing?.id !== 'dMode') return;
    cardReadSaid = true;
    ui.say(LINES.cardRead);
  }

  // 车载数据没有按住 E 的分析：平板上第一次看完某条详情（结论已打出）时播独白。
  // 正在播别的台词（读卡、根钥、质询）时先不播，等说完、玩家还停在这条上再播
  function tickDataLine() {
    const c = tablet.viewing;
    if (!c?.data || !c.done || ui.talking || pendingSay || mode === 'death') return;
    const key = c.id === 'dRaw' && !c.locked ? 'dRawOpen' : c.id;
    if (!CLUE_LINES[key] || dataSaid.has(key)) return;
    dataSaid.add(key);
    ui.say(LINES[CLUE_LINES[key]]);
  }
  // 开发测试：按 F 直接完成一条，收尾和按住 E 分析完相同
  function completeOneClue() {
    const c = fieldClues().find((x) => !x.done);
    if (!c) { ui.toast(tx('本轮现场线索已完成', 'This round’s scene clues are done'), '', 1500); return; }
    c.done = true;
    finishedAnalysis = { clue: c, remaining: 0.45 };
    finishClue(c);
  }

  // 分析持续音：按住期间音高随进度上升；中途松开 / 移开准星时播放断电声
  function syncAnalyzeSound() {
    if (holdT > 0) { sound.analyze(holdT / HOLD_TIME); wasHolding = true; analysisDone = false; }
    else if (wasHolding) {
      wasHolding = false;
      sound.analyze(null);
      if (!analysisDone) sound.play('scifi/analyze_cancel');
    }
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
        analysisDone = true;
        sound.play('scifi/analyze_complete');
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
      const flash = !!c.scanFlash;
      c.scanFlash = false;
      return {
        id: c.id, x: s.x, y: s.y, front: s.front, show, done: c.done, aim: c === aimed, flash,
        label: c.done ? (c === aimed ? c.name : '') : (c === aimed || d < 8 ? `${d.toFixed(1)} m` : ''),
      };
    });
    // 黑梦分析点：时间窗内就显示（不论远近），走远时标名称和距离，瞄准时只标名称
    for (const c of probes) {
      const s = project(c.p);
      const d = c.p.distanceTo(camera.position);
      const show = showProbes && c.inTime && c !== analysisClue && s.front && (!c.done || c === aimedProbe);
      const label = c === aimedProbe ? c.name : `${c.name} ${d.toFixed(0)} m`;
      list.push({ id: c.id, x: s.x, y: s.y, front: s.front, show, done: c.done, aim: c === aimedProbe, label });
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
      if (fx.pulsing && !c.nearOnly && !c.hit && d < SCAN_RANGE && d < fx.pulseRadius) { c.hit = true; c.reveal = SCAN_SHOW; c.scanFlash = true; }
    }
    const nextAim = aimAt(fieldClues(), AIM_RANGE);
    if (nextAim !== aimed) holdT = 0;
    aimed = nextAim;
    // 第 3 轮：先撬门，再瞄准转向柱下方的接口按 E 插卡（读过之后不再出现）
    const doorOn = round === 3 && !pry.done && !!door.node;
    doorAimed = doorOn && !aimed && aimAt([doorTarget()], AIM_RANGE) != null;
    const portOn = round === 3 && pry.done && !ins.done && slot.ready;
    portAimed = portOn && !aimed && aimAt([portTarget()], AIM_RANGE) != null;
    // 第 4 轮：驾驶舱里的根钥
    const keyOn = round === 4 && !root.picked && rootKey.ready;
    keyAimed = keyOn && !aimed && aimAt([keyTarget()], AIM_RANGE) != null;
    tickFinished(dt);
    holdAnalyze(aimed, dt, finishClue);
    const analysisClue = showAnalysis(aimed);
    if (dbgAim >= 0) {
      vm.analyze(clues[dbgAim].p, 0.6);
      fx.analyze(clues[dbgAim].p, clues[dbgAim].radius, 0.6);
    }

    // 车门残漆和普通线索一样：走近出现菱形，没有远处方向标记
    if (glint) props.setScrape(SCRAPE_ALPHA, crash.hazardLit ? 1.2 : 0.1);

    const tap = doorAimed ? { ...project(doorTarget().p), name: tx('右侧车门', 'Right door') }
      : portAimed ? { ...project(portTarget().p), name: tx('检修接口', 'Service port') }
      : keyAimed ? { ...project(keyTarget().p), name: tx('根钥', 'Root key') }
      : null;
    if (!analysisClue && tap) ui.setAnalysis(tap, 0, 'tap');
    if (analysisClue || tap || ui.panelOn) ui.setPrompt(null);
    else if (aimed && aimed.done) ui.setPrompt(tx(`按 E 查看：${aimed.name}`, `Press E to review: ${aimed.name}`));
    else ui.setPrompt(null);

    const list = markerList(true, false, analysisClue);
    const pt = portTarget();
    const ps = project(pt.p);
    const pd = pt.p.distanceTo(camera.position);
    const portName = tx('检修接口', 'Service port');
    const doorName = tx('右侧车门', 'Right door');
    const keyName = tx('根钥', 'Root key');
    list.push({ id: 'port', x: ps.x, y: ps.y, front: ps.front, show: portOn && ps.front && pd < 18, done: false, aim: portAimed, label: portAimed ? portName : `${portName} ${pd.toFixed(0)} m` });
    const dt_ = doorTarget(), ds = project(dt_.p), dd = dt_.p.distanceTo(camera.position);
    list.push({ id: 'door', x: ds.x, y: ds.y, front: ds.front, show: doorOn && ds.front && dd < 22, done: false, aim: doorAimed, label: doorAimed ? doorName : `${doorName} ${dd.toFixed(0)} m` });
    const kt = keyTarget(), ks = project(kt.p), kd = kt.p.distanceTo(camera.position);
    list.push({ id: 'rootkey', x: ks.x, y: ks.y, front: ks.front, show: keyOn && ks.front && kd < 18, done: false, aim: keyAimed, label: keyAimed ? keyName : `${keyName} ${kd.toFixed(0)} m` });
    ui.updateMarkers(list);
  }
  const _port = { p: new THREE.Vector3(), radius: 0.55 };
  function portTarget() { _port.p.copy(slot.world); return _port; }
  const _door = { p: new THREE.Vector3(), radius: 0.8 };
  function doorTarget() { _door.p.copy(doorHandle()); return _door; }
  const _key = { p: new THREE.Vector3(), radius: 0.5 };
  function keyTarget() { _key.p.copy(rootKey.world); return _key; }

  // ---------- 黑梦 ----------
  // A 车撞断护栏：每轮第一次正向播过撞击时刻时响一次（拖动 / 倒放 / 之后重播都不响），素材峰值对准撞击
  const RAIL_AT = IMPACT_T - PEAK.hitRail;
  const RAIL_POS = { x: CAR_POS.x, y: CAR_POS.y + 0.6, z: CAR_POS.z };
  const railHeard = new Set();
  function railHit(before) {
    if (before >= RAIL_AT || rt < RAIL_AT || railHeard.has(round)) return;
    railHeard.add(round);
    sound.play('vehicle/hit_rail', { position: RAIL_POS });
  }

  function updateRecon(dt) {
    const r = R();
    if (playing) {
      const before = rt;
      rt += dt;
      if (rt >= r.duration) { rt = r.duration; playing = false; }
      railHit(before);
    }
    recon.setTime(rt);

    // 分析点：回放到自己的时间窗内，菱形就出现并标距离（inTime）；走到 PROBE_RANGE 内才能瞄准（visible）
    for (const c of probes) {
      const inTime = c.t == null || Math.abs(rt - c.t) <= PROBE_WINDOW;
      const placed = c.pos ? true : recon.targetPos(c.target, c.p);
      c.inTime = c.round === round && inTime && placed;
      c.visible = c.inTime && c.p.distanceTo(camera.position) < PROBE_RANGE;
    }
    const nextAim = aimAt(probes.filter((c) => c.visible), PROBE_RANGE);
    if (nextAim !== aimedProbe) holdT = 0;
    aimedProbe = nextAim;
    tickFinished(dt);
    holdAnalyze(aimedProbe, dt, (c) => {
      const line = DREAM_LINES[c.id] ?? CLUE_LINES[c.id];
      const said = line ? sayAfterPanel(LINES[line]) : Promise.resolve();
      if (c.key) showProbeTask();
      if (roundComplete()) scheduleDreamExit(said);
    });
    if (holdT > 0) playing = false;
    if (tipT > 0) { tipT -= dt; if (tipT <= 0 || holdT > 0) hideTip(); }
    const analysisClue = showAnalysis(aimedProbe);

    // 进度条黄块：带时间点的分析点（已分析的高亮）
    const tp = timedProbes();
    const markNear = tp.findIndex((c) => Math.abs(rt - c.t) <= PROBE_WINDOW);
    const countText = tx(`已分析 ${tp.filter((c) => c.done).length}/${tp.length}`, `READ ${tp.filter((c) => c.done).length}/${tp.length}`);
    ui.updateTimeline(rt, clockText(rt), tp.map((c) => c.done), markNear, countText);
    if (analysisClue || ui.panelOn) ui.setPrompt(null);
    else if (aimedProbe && aimedProbe.done) ui.setPrompt(tx(`按 E 查看：${aimedProbe.name}`, `Press E to review: ${aimedProbe.name}`));
    else ui.setPrompt(null);
    ui.updateMarkers(markerList(false, true, analysisClue));
  }

  onLang(() => {
    document.querySelectorAll('button').forEach((b) => { if (b._label) b.textContent = b._label(); });
    if (mode === 'explore' || mode === 'recon') {
      ui.relabel(mode === 'recon' ? tx('黑梦回放 · 找出异常', 'BLACK DREAM · FIND THE BREAK') : tx('现场调查', 'SCENE'));
      if (mode === 'explore') {
        showTask();
      } else {
        ui.buildTimeline(timeMarks(), frac);
        showProbeTask();
      }
    }
    syncTablet();
  });

  return {
    fx,
    tablet,
    // 开场镜头：隐藏界面与扫描枪、屏蔽输入
    startIntro() {
      intro = true;
      ui.setMode('cut', '');
    },
    // 下车结束后打开系统初判。收起后交还控制
    beginOpening,
    openArrival() {
      setTablet(true);
      tablet.showReport('initial');
      ui.setCinema(false);
    },
    closeArrival() {
      if (!tablet.open) return;
      setTablet(false);
      arrivalClosed = true;
    },
    endIntro() {
      if (!intro) return;
      intro = false;
      ui.setCinema(false);
      if (mode === 'explore') setMode('explore');   // 测试按钮已切到别的阶段时不覆盖
      ui.hush();
      if (arrivalClosed) ui.say(LINES.start1);
    },
    // 加载界面期间预热结局跑车的材质（见 finale.warm）
    warmFinale(on) { death.warm(on); },
    get moveScale() { return intro || enter.on ? 0 : mode === 'report' || mode === 'ending' || mode === 'insert' || mode === 'death' || tablet.open ? 0 : mode === 'recon' ? 0.5 : 1; },
    update(realDt) {
      ui.updateDialogue(realDt);
      tablet.update(realDt);
      if (!intro) { updateRootHold(realDt); tickCardRead(); tickDataLine(); tickPendingSay(realDt); }
      ui.setTabletOpen(tablet.amount > 0.05);
      ui.updateHud(realDt);
      sound.setTablet(tablet.open);
      // 接入画面（插卡读取 / 根钥 / 对象索引）期间循环科技扫描声：插卡时在检修接口，其余在平板位置
      sound.follow('scifi/id_scan_loop', tablet.open && tablet.hacking ? hackSource() : null);
      // 平板上文字正在打出时循环打字声，跟着平板（结局时在地上）；暂停时打字停住，声音也停
      sound.follow('ui/typewrite_loop', tablet.typing && realDt > 0 ? tablet.screenWorld(_type) : null);
      if (mode === 'ending') endingT += realDt;
      slot.update(realDt);
      rootKey.update(realDt);
      if (intro) {
        vm.analyze(null, 0);
        fx.analyze(null);
        syncAnalyzeSound();
        vm.update(realDt, false);
        fx.update(realDt, vm.emitterWorld(emitter));
        return;
      }
      if (mode === 'death') {
        death.update(realDt, locked() || deathForce || !death.playing);
        vm.analyze(null, 0);
        fx.analyze(null);
        syncAnalyzeSound();
        vm.update(realDt, false);
        fx.update(realDt, null);
        return;
      }
      if (mode === 'insert') {
        if (pry.phase) updatePry(realDt);
        else if (grab.phase) updateKeyGrab(realDt);
        else updateInsert(realDt);
        vm.analyze(null, 0);
        fx.analyze(null);
        syncAnalyzeSound();
        vm.update(realDt, false);
        fx.update(realDt, null);
        return;
      }
      const available = !tablet.open && tablet.amount <= 0.05;
      if (mode === 'recon' && enter.on) {
        vm.analyze(null, 0);
        fx.analyze(null);
        updateEnter(realDt);
      } else if (mode === 'explore' && available) updateExplore(realDt);
      else if (mode === 'recon' && available) updateRecon(realDt);
      else {
        vm.analyze(null, 0);
        fx.analyze(null);
        if (mode === 'report') updateReport(realDt);
      }
      if (mode === 'explore') updateDreamHold(realDt);
      updateRite(realDt);
      syncAnalyzeSound();
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
      confirm(on = true) { holdConfirm = on; },
      decline() { declineReport(); },
      round2() { skipToRound2(); },
      round3() { skipToRound3(); },
      round4() { skipToRound4(); },
      // 本轮黑梦分析点全部标完，按离开黑梦的流程生成本轮报告
      report() { probes.forEach((p) => { if (p.round === round) p.done = true; }); advanceAfterDream(); },
      root() { startRoot(); },
      insert() { startInsert(); },
      pry() { startPry(); },
      pickKey() { pickRootKey(); },
      get pryPhase() { return pry.phase; },
      door,
      finishInsert() { finishInsert(false); },
      get insertPhase() { return ins.phase; },
      slot,
      returnFromArchive() { returnFromArchive(); },
      get confirmState() { return confirm?.state ?? null; },
      get mode() { return mode; },
      // 结局：death() 直接播放；force 为 true 时鼠标没锁定也播放；deathSeek(秒) 跳到某一秒
      death(force = false) { deathForce = force; startDeath(); },
      deathSeek(t) { death.seek(t); },
      deathResume() { death.resume(); },
      deathT: death.T,
      get round() { return round; },
    },
  };
}
