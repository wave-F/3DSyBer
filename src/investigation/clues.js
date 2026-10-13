// 剧情数据：对应 docs/Story/事故之前-序章.md 的前两轮
// 流程：取证 → 黑梦回放 → 复核报告。第 1 轮只看单车，第 2 轮发现第二辆车

// 线索：round 为解锁轮次；key 为该轮进入黑梦的必需线索；nearOnly 为只有走近（NEAR_RANGE）才显示菱形，Q 扫描扫不亮
// 第 2 轮按最新剧情没有返回现场的人：黄车接触后直接向北开走
// 第 2 轮三处关键线索同时解锁：车门残漆、靠近事故车的第二道胎痕、脱落饰条
export const CLUES = [
  {
    id: 'front', round: 1, name: '车头损毁', pos: [6.9, 20.6, 1.5], radius: 0.9, key: true,
    lines: ['前纵梁压缩 0.62 m', '左前悬架断裂，车轮脱落', '驾驶员侧气囊已展开'],
    result: '正面高速撞击', prob: 0.98,
  },
  {
    id: 'rail', round: 1, name: '断裂护栏', pos: [6.9, 20.7, -2.4], radius: 1.0, key: true,
    lines: ['撞击角度 38°', '冲击能量约 410 kJ，超出护栏设计上限 2.6 倍', '撞击瞬间车速约 86 km/h'],
    result: '车辆失控撞断护栏', prob: 0.99,
  },
  {
    id: 'debris', round: 1, name: '碎片散布', pos: [3.2, 20.1, -3.0], radius: 1.2, key: true,
    lines: ['散布方向 NE 41°，与最终车头朝向一致', '玻璃碎片来自驾驶员侧车窗', '乘员可能经由该车窗被甩出'],
    result: '车窗破碎', prob: 0.84,
  },
  {
    id: 'scrape', round: 2, lead: true, name: '车门残漆', pos: [4.6, 20.6, 1.0], radius: 0.9, key: true,
    lines: ['右侧车门凹陷 4.2 cm', '残留黄色漆片：NC-Y08 商用涂装', '刮擦方向：由后向前'],
    result: '残漆不属于本车', prob: 0.96,
  },
  {
    id: 'skidB', round: 2, name: '第二道胎痕', pos: [-4.4, 20.05, -7.2], radius: 1.4, key: true,
    lines: ['胎宽 265 mm，与死者车辆（245 mm）不符', '痕迹收到事故车旁，随后向北减弱', '没有停车制动的痕迹'],
    result: '第二辆车刮擦后从车旁向北驶离', prob: 0.93,
  },
  {
    id: 'trim', round: 2, name: '脱落饰条', pos: [-4.3, 20.08, 8], radius: 0.7, key: true,
    lines: ['断面为拉扯断裂，不是制动甩出', '漆面色值 NC-Y08，与车门残漆一致', '落在黄车向北驶离的路面上'],
    result: '第二辆车刮擦后继续向北驶离', prob: 0.91,
  },
];

// 黑梦内可分析的对象（按住 E）。target 对应 recon.js 里的全息物体；或用 pos 指定固定位置
export const PROBES = [
  // 黑梦 1 唯一的分析点：跟随 A 车全息。t 为开始偏航的时刻，进度条黄块，回放时间在 ±0.25 s 内才能分析
  {
    id: 'p1turn', round: 1, key: true, t: 1.4, target: 'carA', name: 'A 车转向', radius: 1.8,
    lines: ['航向在没有对应操作记录时向左偏转', '偏转发生在撞击护栏之前', '单凭制动解释不了这次转向'],
    result: '推断：发生了碰撞', prob: 0.9,
  },
  // 和第一轮同一套：key 必须分析，t 在进度条上标黄块，回放时间在 ±0.25 s 且走近 5 m 才能瞄准
  {
    id: 'p2car', round: 2, key: true, t: 1.4, target: 'carB', name: '黄色车辆', radius: 1.8,
    lines: ['外形依据：胎宽 265 mm、NC-Y08 商用涂装', '接触瞬间交换碰撞数据包：摘要已同步，原始字段不可读', '未减速，向北驶出重建范围'],
    result: '第二辆车参与事故后驶离', prob: 0.9,
  },
  {
    id: 'p2why', round: 2, key: true, t: 1.9, target: 'carA', name: 'A 车偏转', radius: 1.8,
    lines: ['接触发生在偏转期间', '离开方向与第二道胎痕一致', '另有行为关联分析支持'],
    result: '系统判定：刮擦导致 A 车失控', prob: 0.86,
  },
];

// 每轮黑梦：时长、时间跳跃、事件节点、出场的全息物体、回放后生成的报告
export const ROUNDS = {
  1: {
    duration: 4, jump: null,
    actors: { carB: false },
    // 黑梦 1 不记录事件：进度条上唯一的黄块是 A 车转向分析点的时间，分析完生成报告 01
    events: [],
    report: 'r1',
  },
  2: {
    duration: 4, jump: null,
    actors: { carB: true },
    events: [],
    report: 'r2',
  },
};

// 报告：initial 为接单时已有的系统初判；r1、r2 为黑梦回放后仪器生成的复核报告
export const REPORTS = {
  initial: {
    tag: '系统初判', source: 'URSA / 枢核 · 自动生成',
    lines: ['涉事车辆非法改装。', '驾驶员违规切换手动驾驶。', '操作失误导致车辆撞击护栏，驾驶员当场死亡。'],
    verdict: '初步判定：单方责任事故',
    note: '完成现场取证及黑梦回放后，可生成复核报告。',
  },
  r1: {
    tag: '复核报告 01', source: '黑梦回放 · 第 1 次重建',
    lines: ['回放中车辆发生非正常转向。', '转向发生在撞击护栏之前，单凭制动无法解释。', '推断：可能发生了碰撞。'],
    verdict: '建议：返回现场核查接触痕迹',
  },
  r2: {
    tag: '复核报告 02', source: '黑梦回放 · 第 2 次重建',
    lines: ['B 车从右侧切入，与 A 车发生刮擦。', '肇事车辆未停车，向北驶离。'],
    verdict: '判定：肇事逃逸',
    note: '— 未完待续 —',
  },
};

// 字幕台词：who 为空表示陈墨的内心独白
export const LINES = {
  opening: [
    { who: '派单员', text: 'B1234，到场没有？' },
    { who: '陈墨', text: '到了。' },
    { who: '派单员', text: '一场单车事故。核完赶紧交单，北岸还有两件。' },
  ],
  dream1: [
    { text: '初判写的是他自己打偏了方向。' },
    { text: '可轮子在撞上护栏之前就转了。' },
    { text: '这不是失控。有东西碰过这辆车。' },
  ],
  call: [
    { who: '陈墨', text: '报告漏了一辆车。' },
    { who: '派单员', text: '上传证据，重新回放。' },
    { who: '陈墨', text: '如果第二份也错呢？' },
    { who: '派单员', text: '那就上传下一份证据。你问我，我也没在桥上。' },
  ],
};
