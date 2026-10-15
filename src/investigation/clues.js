// 剧情数据：对应 docs/Story/事故之前-序章.md 和 背景与故事-优化版.md 第 1~9 步
// 流程：取证 → 黑梦回放 → 复核报告。第 1 轮只看单车，第 2 轮发现第二辆车，第 3 轮插卡读到接管与 P0，
// 第 4 轮用根钥打开原始字段：报告早于事故、P0 临时写入、黄车也被接管
import { bi } from '../i18n.js';
import { EN } from './en.js';

// 线索：main 为弹出面板只显示的那一行细节（lines 下标，英文同下标）；round 为解锁轮次；key 为该轮进入黑梦的必需线索；nearOnly 为只有走近（NEAR_RANGE）才显示菱形，Q 扫描扫不亮
// 第 2 轮按最新剧情没有返回现场的人：黄车接触后直接向北开走
// 第 2 轮三处关键线索同时解锁：车门残漆、靠近事故车的第二道胎痕、脱落饰条
const CLUES_ZH = [
  {
    id: 'front', main: 0, round: 1, name: '车头损毁', pos: [6.9, 20.6, 1.5], radius: 0.9, key: true,
    lines: ['前纵梁压缩 0.62 m', '左前悬架断裂，车轮脱落', '驾驶员侧气囊已展开'],
    result: '正面高速撞击', prob: 0.98,
  },
  {
    id: 'rail', main: 2, round: 1, name: '断裂护栏', pos: [6.9, 20.7, -2.4], radius: 1.0, key: true,
    lines: ['撞击角度 38°', '冲击能量约 410 kJ，超出护栏设计上限 2.6 倍', '撞击瞬间车速约 86 km/h'],
    result: '车辆失控撞断护栏', prob: 0.99,
  },
  {
    id: 'debris', main: 0, round: 1, name: '碎片散布', pos: [3.2, 20.1, -3.0], radius: 1.2, key: true,
    lines: ['漆皮和塑料件来自车头，左前轮附近最多', '玻璃渣是这辆车的前挡，不是护栏', '从车头一直撒到护栏断口'],
    result: '碎片来自车头撞击', prob: 0.84,
  },
  {
    id: 'scrape', main: 1, round: 2, name: '车门残漆', pos: [4.6, 20.6, 1.0], radius: 0.9, key: true,
    lines: ['右侧车门凹陷 4.2 cm', '残留黄色漆片：NC-Y08 商用涂装', '刮擦方向：由后向前'],
    result: '残漆不属于本车', prob: 0.96,
  },
  {
    id: 'skidB', main: 0, round: 2, name: '第二道胎痕', pos: [-4.4, 20.05, -7.2], radius: 1.4, key: true,
    lines: ['胎宽 265 mm，与事故车辆（245 mm）不符', '痕迹收到事故车旁，随后向北减弱', '没有停车制动的痕迹'],
    result: '第二辆车刮擦后从车旁向北驶离', prob: 0.93,
  },
  {
    id: 'trim', main: 1, round: 2, name: '脱落饰条', pos: [-4.3, 20.08, 8], radius: 0.7, key: true,
    lines: ['断面为拉扯断裂，不是制动甩出', '漆面色值 NC-Y08，与车门残漆一致', '落在黄车向北驶离的路面上'],
    result: '第二辆车刮擦后继续向北驶离', prob: 0.91,
  },
  // 第 3 轮：插卡读取执行器缓存后得到的车载数据（data：没有现场位置，只出现在平板里），只给 3 条
  // locked：权限不足、只显示摘要的条目（第 4 轮用根钥原地解开，解开后换成 raw 里的内容，不再新增条目）
  {
    id: 'dMode', main: 3, round: 3, data: true, name: '接管记录',
    lines: ['驾驶模式：自动，未发现改装或手动切换', '驾驶员输入：维持车道', '输入被覆盖，来源：URSA 道路协同', '23:17:08.460 执行强制转向，早于两车接触'],
    result: '死者没有打方向，转向是系统下的命令', prob: 0.95,
  },
  {
    id: 'dReason', main: 1, round: 3, data: true, name: '零号保障',
    lines: ['接管理由：冲突规避，保护黄色车辆', '黄色车辆保障等级：P0（零号保障）', '使用人：陆世承（承岳财团）', '协议：任何时候优先保障其生命'],
    result: '系统为保护承岳的黄车，把事故车推了出去', prob: 0.93,
  },
  {
    id: 'dRaw', main: 0, round: 3, data: true, locked: true, name: '接口日志',
    lines: ['23:14:52 程叙的根钥（ROOTKEY）登录过本接口', '持有人：程叙 · 经纬城市系统公司 · 原始数据审计工程师', '黄色车辆原始记录：本车保留了一份副本', '原始字段：权限不足'],
    result: '原始字段不可读，需要根钥',
    raw: {
      name: '黄色车辆原始记录',
      lines: ['P0（临时）由 URSA 授予，使用人未发起申请', '23:17:07.940 黄色车辆进入 URSA 道路协同接管', '驾驶者请求取消变道，被拒绝'],
      main: 0, result: '零号保障和黄车的变道，都是系统临时安排的', prob: 0.95, src: '原始字段 · 根钥',
    },
  },
  // 第 4 轮：根钥展开原始字段后只新增这一条
  // src：平板详情顶部的来源标签。timeline：线索详情下方画一条时间轴，依次标出各时刻（不写 prob，位置留给时间轴）
  {
    id: 'rTime', main: 0, round: 4, data: true, src: '原始字段 · 根钥', name: '时间轴叠合',
    lines: ['初判报告签收：23:17:08.080', '临时授予黄色车辆 P0：23:17:08.220', '强制转向执行：23:17:08.460', '护栏撞击发生：23:17:09.660'],
    result: '初判写好时，转向还没有发生',
    timeline: [
      { t: 8.080, label: '初判签收', tone: 'red' },
      { t: 8.220, label: '临时 P0' },
      { t: 8.460, label: '强制转向' },
      { t: 9.660, label: '撞击' },
    ],
  },
];

// 根钥接入画面（第 4 轮）。根钥在驾驶舱里拾取（驾驶座与中控通道之间）
const ROOT_HACK_ZH = {
  head: 'ROOTKEY · ROOT ENGINEERING ID',
  title: '根钥接入 · 根级工程身份钥',
  steps: [
    { t: 0.2, text: '检测到实体凭证 · ROOTKEY' },
    { t: 0.7, text: '持有人：程叙 · 经纬城市系统公司 · 原始数据审计' },
    { t: 1.2, text: '权限验证 · · · · · · · · · 通过', tone: 'gold' },
    { t: 1.6, text: '展开黄色车辆原始记录副本 · 字段 412 项' },
    { t: 3.2, text: '原始字段已展开', tone: 'gold' },
    { t: 3.6, text: '黄色车辆原始记录已解锁 · 新增时间轴叠合', tone: 'gold' },
  ],
  scan: [1.6, 3.2],
  done: 4.3,
};

// 报告 04 收起后：临时授权附带的对象索引。hold：走完停在最后一帧，TAB 收起
const TARGET_INDEX_ZH = {
  head: 'URSA · TEMPORARY GRANT · OBJECT INDEX',
  title: '临时授权附带对象索引',
  steps: [
    { t: 0.3, text: '授权编号 P0-T-0417 · 授予对象：黄色车辆' },
    { t: 1.0, text: '关联对象：程叙' },
    { t: 1.7, text: '分类：可独立核验原始记录与正式报告' },
    { t: 2.6, text: '处置目标：注销', tone: 'red' },
    { t: 3.4, text: '完成条件：生命体征终止', tone: 'red' },
  ],
  scan: null,
  done: 4.2,
  hold: true,
};

// 插卡后平板的接入画面：t 为出现时间（秒），tone 为颜色
const CARD_HACK_ZH = {
  title: '接入车载执行器 · 公序核验通道',
  steps: [
    { t: 0.2, text: '检测到检修接口 · ECU-7 / URSA 道路协同模块' },
    { t: 0.6, text: '握手 · · · · · · · · · · OK' },
    { t: 1.0, text: '核验权限：公序 · 现场取证 L2' },
    { t: 1.4, text: '读取执行器缓存 · 事故窗口 23:17:07 – 23:17:10' },
    { t: 3.0, text: '解析完成 · 2,048 条命令记录' },
    { t: 3.4, text: '黄色车辆原始记录 · 权限不足 · 原始字段不可读', tone: 'red' },
    { t: 3.8, text: '23:14:52 根钥登录 · 程叙 · 经纬原始数据审计工程师', tone: 'gold' },
    { t: 4.3, text: '新增车载数据 3 条', tone: 'gold' },
  ],
  scan: [1.4, 3.0],   // 数据滚屏与进度条的时间段
  done: 5.0,
};

// 黑梦内可分析的对象（按住 E）。target 对应 recon.js 里的全息物体；或用 pos 指定固定位置
const PROBES_ZH = [
  // 黑梦 1 唯一的分析点：跟随 A 车全息。t 为开始偏航的时刻，进度条黄块，回放时间在 ±0.25 s 内才能分析
  {
    id: 'p1turn', main: 1, round: 1, key: true, t: 1.4, target: 'carA', name: '事故车转向', radius: 1.8,
    lines: ['航向在没有对应操作记录时向左偏转', '偏转发生在撞击护栏之前', '单凭制动解释不了这次转向'],
    result: '推断：发生了碰撞', prob: 0.9,
  },
  // 和第一轮同一套：key 必须分析，t 在进度条上标黄块，回放时间在 ±0.25 s 时显示菱形，走近 8 m 才能瞄准
  // 只留前两次：先转向，再看到黄车。刮擦导致失控的说法留给报告 02，不再单独分析
  {
    id: 'p2gap', main: 1, round: 2, key: true, t: 1.15, target: 'carA', name: '事故车前轮', radius: 1.8,
    lines: ['接触前 0.3 s，事故车航向已开始偏转', '此刻两车间距约 1 m，尚未接触', '偏转方向：远离黄色车辆'],
    result: '先转向，后接触', prob: 0.88,
  },
  {
    id: 'p2car', main: 2, round: 2, key: true, t: 1.4, target: 'carB', name: '黄色车辆', radius: 1.8,
    lines: ['外形依据：胎宽 265 mm、NC-Y08 商用涂装', '接触瞬间交换碰撞数据包：摘要已同步，原始字段不可读', '未减速，向北驶出重建范围'],
    result: '第二辆车参与事故后驶离', prob: 0.9,
  },
  // 黑梦 3：加入插卡读到的接管记录与 P0。回放支持「系统为保护特权会员而牺牲 A 车」
  // 只能露出接管和 P0，不能露出：报告早于事故、P0 是临时写入、黄车也被接管（留给第 4 轮根钥）
  // p3halo 故意写「全程存在」：这是重建给出的样子，第 4 轮原始字段会推翻它
  {
    id: 'p3override', main: 0, round: 3, key: true, t: 1.1, target: 'carA', name: '事故车被接管', radius: 1.8,
    lines: ['偏转开始时，驾驶员输入仍为维持车道', '转向指令来源：URSA 道路协同', '偏转方向：让出黄色车辆的行驶路线'],
    result: '系统接管了事故车的方向', prob: 0.95,
  },
  {
    id: 'p3halo', main: 1, round: 3, key: true, t: 1.4, target: 'carB', name: '零号保障通道', radius: 1.8,
    lines: ['P0 让行通道随黄色车辆向前铺开', '通道内的车辆一律让行', '回放范围内，通道全程存在'],
    result: '黄车受零号保障保护', prob: 0.92,
  },
  // 黑梦 4：原始字段进入重建。P0 让行通道在两车接近时突然铺出，黄车也被接管
  {
    id: 'p4halo', main: 1, round: 4, key: true, t: 0.85, target: 'carB', name: '通道生成', radius: 1.8,
    lines: ['0.8 s 之前，黄色车辆前方没有让行通道', '通道在两车接近时突然铺出', '授予来源 URSA，触发请求：无'],
    result: 'P0 不是黄车本来就有的', prob: 0.96,
  },
  {
    id: 'p4cut', main: 1, round: 4, key: true, t: 1.3, target: 'carB', name: '黄车切入', radius: 1.8,
    lines: ['变道指令来源：URSA 道路协同', '驾驶者请求取消变道，被拒绝', '切入路线与事故车的偏转同时生成'],
    result: '黄车也是被开过来的', prob: 0.94,
  },
  {
    id: 'p4end', main: 0, round: 4, key: true, t: 2.0, target: 'carA', name: '事故车去向', radius: 1.8,
    lines: ['报告先写好，特权随后授予，最后才是转向', '每一步单独看，都能在规则里找到解释', '放在同一条时间轴上，只有一个结果'],
    result: '事故车必须撞上护栏', prob: 0.97,
  },
];

// 每轮黑梦：时长、出场的全息物体、回放后生成的报告。进度条上的黄块是本轮带时间点的分析点
// p0：黄车 P0 保障通道出现的时刻（秒）。黑梦 3 从 0 开始就有，黑梦 4 在两车接近时突然生成
export const ROUNDS = {
  1: { duration: 4, actors: { carB: false }, report: 'r1' },
  2: { duration: 4, actors: { carB: true }, report: 'r2' },
  3: { duration: 4, actors: { carB: true, p0: 0 }, report: 'r3' },
  4: { duration: 4, actors: { carB: true, p0: 0.8 }, report: 'r4' },
};

// 报告：initial 为接单时已有的系统初判；r1~r4 为黑梦回放后终端生成的复核报告
const REPORTS_ZH = {
  initial: {
    tag: '系统初判', source: 'URSA / 枢核 · 自动生成',
    lines: ['涉事车辆非法改装。', '驾驶员违规切换手动驾驶。', '操作失误导致车辆撞击护栏，驾驶员当场死亡。'],
    verdict: '初步判定：单方责任事故',
    note: '完成现场取证及黑梦回放后，可生成复核报告。',
    hint: '按 TAB 收起终端',
  },
  r1: {
    tag: '复核报告 01', source: '黑梦回放 · 第 1 次重建',
    lines: ['回放中车辆发生非正常转向。', '转向发生在撞击护栏之前，单凭制动无法解释。', '推断：可能发生了碰撞。'],
    verdict: '建议：返回现场核查接触痕迹',
    hint: '按 TAB 收起终端',
  },
  // confirm：报告下方出现「按住 E <hold> / TAB <decline>」
  //   按满 E 进入 ENDINGS[key] 假结局；TAB 时陈墨质问终端（LINES[question]），报告按 revised 改写，确认条显示 suspended
  // revised：质疑后的改写。strike 为被划掉的行号，原判定也被划掉
  r2: {
    tag: '复核报告 02', source: '黑梦回放 · 第 2 次重建',
    lines: ['黄色车辆从右侧切入，与事故车辆发生刮擦。', '刮擦导致事故车辆偏转，撞断护栏。', '肇事车辆未停车，向北驶离。'],
    verdict: '判定：肇事逃逸',
    confirm: {
      hold: '按住 E 确认归档', holding: '确认归档中…', done: '已归档 · FRA-B1016', decline: 'TAB 暂不归档',
      question: 'question2', after: 'revised2', suspended: '复核挂起 · 接触前转向原因未知　TAB 收起',
    },
    revised: {
      strike: [1],
      add: '接触前事故车辆已开始转向，原因未知。',
      verdict: '复核挂起：因果链不完整',
      note: '现有信息不足以确定转向原因。',
    },
  },
  // 第一层误导：承认强制接管，但把原因引向财团特权。移交审查 = 假结局；暂不移交 = 追问 P0 何时写入
  r3: {
    tag: '复核报告 03', source: '黑梦回放 · 第 3 次重建',
    lines: ['事故车辆全程处于自动驾驶，驾驶员无违规操作。', 'URSA 道路协同为保障零号保障下的黄色车辆，强制调整事故车辆轨迹。', '事故车辆被推出冲突区，撞断护栏。'],
    verdict: '判定：优先级保障执行 · 系统规避',
    note: '建议移交特权保障争议审查。',
    confirm: {
      hold: '按住 E 移交审查', holding: '移交中…', done: '已移交 · 特权保障争议审查', decline: 'TAB 暂不移交',
      question: 'question3', after: 'revised3', suspended: '移交暂缓 · 原始字段权限不足　TAB 收起',
    },
    revised: {
      strike: [],
      add: '黄色车辆的 P0 写入时间无法核验：原始字段权限不足。',
      verdict: '移交暂缓：保障来源待核验',
      note: '黄色车辆原始记录需要更高权限读取。',
    },
  },
  // 根钥打开原始字段之后：系统主动制造事故
  r4: {
    tag: '复核报告 04', source: '黑梦回放 · 第 4 次重建',
    lines: ['临时保障授权与车辆接管均由 URSA 主动发起。', '未发现黄色车辆使用人发起对应请求。', '初判报告签收早于临时授权、强制转向与撞击。'],
    verdict: '原始记录支持：系统主动制造事故',
    note: '该结论没有对应的处置流程。',
  },
};

// 报告被真的确认：假结局的黑场文字（key 对应报告）
const ENDINGS_ZH = {
  r2: {
    unlock: '解锁结局一',
    title: '案件已归档',
    lines: ['结论：肇事逃逸。', '程叙的死，从此有了一个说得通的解释。', '没有人再回到这座桥。'],
    back: '按 E 回到桥上，重新审视复核报告 02',
    radio: 'archived',
  },
  r3: {
    unlock: '解锁结局二',
    title: '案件已移交',
    lines: ['结论：优先级保障执行。', '程叙的死，成了一场关于特权的争议。', '没有人再问，那条让行道是从什么时候铺上的。'],
    back: '按 E 回到桥上，重新审视复核报告 03',
    radio: 'transferred',
  },
};

// 结局：陈墨被撞后，掉在地上的终端自动生成的事故报告，并自动归档
const DEATH_REPORT_ZH = {
  head: 'CASE FILE · 事故报告',
  title: '桥面行人撞击事故 · 1 人死亡',
  status: '自动生成',
  source: 'URSA / 枢核 · 自动生成',
  tag: '事故报告',
  lines: ['执法员陈墨（FRA-B1016）饮酒上岗。', '事故现场未设置警示标识。', '违规滞留行车道，被过往车辆撞击，当场死亡。'],
  verdict: '判定：执法员个人失职',
  // 和第 4 轮时间轴叠合呼应：报告签收早于撞击，只摆出时间不解释
  stamps: [
    { label: '事故时间', t: '23:41:03.900' },
    { label: '报告签收', t: '23:41:02.310', tone: 'red' },
  ],
  labels: { hold: '按住 E 确认归档', holding: '确认归档中…', done: '已归档' },
};

// 字幕台词：who 为空表示陈墨的内心独白
const LINES_ZH = {
  opening: [
    { who: '派单员', text: 'B1016，到场没有？' },
    { who: '陈墨', text: '到了。' },
    { who: '派单员', text: '一场单车事故。核完赶紧交单，北岸还有两件。' },
  ],
  // 下车后收起系统初判，第一轮搜证开始
  start1: [
    { text: '先看撞哪儿了。' },
  ],
  // 第一次黑梦：完整看完一遍后，倒回第一个异常时刻前说的话。time 为倒回的时刻文字，如 00:01.4
  dreamGuide: (time) => [
    { text: '等等，前轮。' },
    { text: `倒回 ${time}，再看一遍。` },
  ],
  // 每条线索分析完的内心独白（state.js 的 CLUE_LINES 按线索 id 对应）
  // 第 1 轮现场：先接受「单车事故」的表象
  clueFront: [
    { text: '车头都压进去了。' },
  ],
  clueRail: [
    { text: '不是擦过去，是对着护栏冲的。' },
  ],
  clueDebris: [
    { text: '这几块都是车头掉的。' },
  ],
  // 第一轮三条现场线索都标完、还没进黑梦
  ready1: [
    { text: '构建黑梦，看看发生了什么。' },
  ],
  // 第 2 轮现场：接触痕迹
  clueScrape: [
    { text: '黄漆。这辆车可不是黄的。' },
  ],
  clueSkidB: [
    { text: '还有另一辆车的痕迹。' },
  ],
  clueTrim: [
    { text: '饰条也是黄的，漆对得上。' },
  ],
  // 第二轮三条现场线索都标完、还没进黑梦
  ready2: [
    { text: '把黄车加进去，再放一遍。' },
  ],
  // 黑梦里原本没有独白的分析点
  clueP2car: [
    { text: '交换过数据。怎么只能看摘要？' },
  ],
  clueP3override: [
    { text: '就在这儿，方向被接过去了。' },
  ],
  clueP4end: [
    { text: '两辆车，都归它开。' },
  ],
  // 车载数据：第一次在平板上看完详情时播放
  clueDMode: [
    { text: '一直是自动驾驶。初判里的手动操作哪儿来的？' },
  ],
  clueDReason: [
    { text: '陆世承，承岳的人。零号保障……保的是他。' },
  ],
  clueDRaw: [
    { text: '程叙是经纬的审计工程师？出事前还在用这个接口。' },
  ],
  clueDRawOpen: [
    { text: '临时给的？他都没申请。' },
  ],
  clueRTime: [
    { text: '早了 0.38 秒。那时候车还没转。' },
  ],
  dream1: [
    { text: '还没撞护栏，轮子就转了。' },
    { text: '像是发生了碰撞。' },
  ],
  // 收起复核报告 01：回去找接触痕迹
  after1: [
    { text: '看看车身，有没有别的碰痕。' },
  ],
  // 黑梦 2 分析完 A 车前轮
  dream2: [
    { text: '轮子先动的。' },
    { text: '那时候黄车还没碰到它。' },
  ],
  // 报告 02 选择暂不归档：陈墨质问终端
  question2: [
    { who: '陈墨', text: '你说刮擦让它转向。可胎痕在刮擦点之前就弯了。' },
    { who: '终端', text: '接触可能影响了后续轨迹。' },
    { who: '陈墨', text: '可能？' },
  ],
  revised2: [],
  // 收起报告后：派单员施压，陈墨拒绝交单，引向右门和检修接口
  call2: [
    { who: '派单员', text: 'B1016，逃逸案已经转追查科了。你这单可以结了。' },
    { who: '陈墨', text: '再给我十分钟。' },
    { text: '右门翘着，应该撬得开。检修接口在转向柱下面。' },
  ],
  // 车载数据读取完成
  cardRead: [
    { text: '不是他打错了方向。是系统不让他把车开直。' },
  ],
  // 黑梦 3 分析完零号保障通道
  dream3: [
    { text: '他倒是安全了。' },
  ],
  // 报告 03 选择暂不移交：陈墨追问 P0 何时生效
  question3: [
    { who: '陈墨', text: '原始记录还锁着，你怎么知道这条道从一开始就有？' },
    { who: '终端', text: '回放依据现有摘要生成。' },
    { who: '陈墨', text: '我要看 P0 的生效时间。' },
    { who: '终端', text: '当前权限不足。', ms: 2400 },
  ],
  revised3: [],
  // 收起报告 03：陈墨不满意这个结论，引向第 4 轮的根钥（插卡时接口日志里出现过根钥登录）
  after3: [
    { text: '我的权限不够，程叙的呢？' },
    { text: '去车里找找。' },
  ],
  // 驾驶舱里拾取根钥（同时平板自动接入）
  keyFound: [
    { text: '程叙的根钥。按规定应该上交。' },
    { text: '先借用一下。' },
  ],
  // 根钥读完原始字段：认出时间轴上的初判就是接单时那份，戳穿「风险预测」的说法
  // 初判声称违规手动驾驶，与执行器缓存不符
  rootRead: [
    { who: '陈墨', text: '为什么提前写好初判？' },
    { who: '终端', text: '风险预测与报告预生成属于城市应急流程。' },
    { who: '陈墨', text: '可他根本没切手动。报告里为什么写他切了？' },
  ],
  // 黑梦 4 分析完通道生成 / 黄车切入
  dream4: [
    { text: '停。这时候才有让行道。' },
  ],
  dream4b: [
    { text: '他想取消变道。系统没让。' },
  ],
  // 对象索引收起后，两句说完就进结局
  target: [
    { who: '陈墨', text: '就因为他能查原始记录？' },
    { who: '陈墨', text: '得把这些带回去。' },
  ],
  // 报告 03 被真的移交：假结局
  transferred: [
    { who: '派单员', text: '收到。特权争议转审查科，经纬和承岳那边会有人对接。' },
    { who: '派单员', text: 'B1016，这单你可以结了。' },
    { who: '陈墨', text: '知道了。' },
    { text: '特权会有人去吵。' },
    { text: '至于那条让行道是什么时候铺上的——' },
    { text: '那不是我的单子了。', ms: 2200 },
  ],
  // 报告 02 被归档：假结局
  archived: [
    { who: '派单员', text: '收到。肇事车辆转追查科。' },
    { who: '派单员', text: 'B1016，北岸还有两件，路上别耽误。' },
    { who: '陈墨', text: '知道了。' },
    { text: '黄车会有人去追。' },
    { text: '至于它为什么先转了方向——' },
    { text: '那不是我的单子了。', ms: 2200 },
  ],
};

const byId = (list, bag) => list.map((item) => bi(item, bag[item.id]));
const byKey = (obj, bag) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, bi(v, bag[k])]));

// state.js 每局会复制一份可变线索：从中文原数据复制，再用 clueEN / probeEN 套英文
// （直接展开 CLUES 会把复制那一刻的语言写死）
export { CLUES_ZH, PROBES_ZH };
// 带 raw 的线索（黄色车辆原始记录）解锁后 locked 为 false，英文改用 raw 那一份
export const clueEN = (id) => (t) => {
  const bag = EN.clues[id];
  return bag?.raw && t.locked === false ? { ...bag, ...bag.raw } : bag;
};
export const probeEN = (id) => EN.probes[id];

export const CLUES = byId(CLUES_ZH, EN.clues);
export const PROBES = byId(PROBES_ZH, EN.probes);
export const REPORTS = byKey(REPORTS_ZH, EN.reports);
export const ENDINGS = byKey(ENDINGS_ZH, EN.endings);
export const DEATH_REPORT = bi(DEATH_REPORT_ZH, EN.death);
export const ROOT_HACK = bi(ROOT_HACK_ZH, EN.rootHack);
export const TARGET_INDEX = bi(TARGET_INDEX_ZH, EN.target);
export const CARD_HACK = bi(CARD_HACK_ZH, EN.card);
export const LINES = bi(LINES_ZH, EN.lines);
