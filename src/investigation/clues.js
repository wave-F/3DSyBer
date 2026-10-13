// 剧情数据：对应 docs/Story/事故之前-序章.md 的前两轮
// 流程：取证 → 黑梦回放 → 复核报告。第 1 轮只看单车，第 2 轮发现第二辆车

// 线索：round 为解锁轮次；key 为该轮进入黑梦的必需线索；nearOnly 为只有走近（NEAR_RANGE）才显示菱形，Q 扫描扫不亮
// 第 2 轮按最新剧情没有返回现场的人：黄车接触后直接向北开走
// 第 2 轮中 scrape 是转折入口，单独先解锁，分析后才解锁同轮其余线索
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
    id: 'skidB', round: 2, nearOnly: true, name: '第二道胎痕', pos: [-3.9, 20.05, -21], radius: 1.6, key: true,
    lines: ['胎宽 265 mm，与死者车辆（245 mm）不符', '由右侧切入，随后向北延伸', '没有停车制动的痕迹'],
    result: '第二辆车未停车，已经开走', prob: 0.93,
  },
];

// 黑梦内可分析的对象（按住 E）。target 对应 recon.js 里的全息物体；或用 pos 指定固定位置
export const PROBES = [
  // 黑梦 1 唯一的分析点：现场真实存在、但重建没有收录的另一道车辙。和报告「未发现其他涉事车辆」对不上
  // pos 为固定位置（不跟随全息物体）；nearOnly 为走近 NEAR_RANGE 才显示菱形、才能分析；key 为生成本轮报告的必需分析
  // t 为时间点：进度条上显示黄块，回放时间在 t 附近（±0.25 s）才出现。1.4 s 是黄车切入、留下这道车辙的时刻
  {
    id: 'p1skid', round: 1, key: true, t: 1.4, pos: [-3.9, 20.05, -21], nearOnly: true, name: '另一道车辙', radius: 1.6,
    lines: ['胎宽 265 mm，与死者车辆（245 mm）不符', '由右侧切入，随后向北延伸', '重建模型未收录这道车辙'],
    result: '与「未发现其他涉事车辆」矛盾', prob: 0.9,
  },
  {
    id: 'p2car', round: 2, target: 'carB', name: '黄色车辆', radius: 1.8,
    lines: ['外形依据：胎宽 265 mm、NC-Y08 商用涂装', '接触瞬间交换碰撞数据包：摘要已同步，原始字段不可读', '未减速，向北驶出重建范围'],
    result: '第二辆车参与事故后驶离', prob: 0.9,
  },
  {
    id: 'p2why', round: 2, target: 'carA', name: 'A 车偏转', radius: 1.8,
    lines: ['接触发生在偏转期间', '离开方向与第二道胎痕一致', '另有行为关联分析支持'],
    result: '系统判定：刮擦导致 A 车失控', prob: 0.86,
  },
];

// 每轮黑梦：时长、时间跳跃、事件节点、出场的全息物体、回放后生成的报告
export const ROUNDS = {
  1: {
    duration: 5, jump: null,
    actors: { carB: false },
    // 黑梦 1 不记录事件：进度条上唯一的黄块是车辙分析点 p1skid 的时间点，分析完生成报告 01
    events: [],
    report: 'r1',
  },
  2: {
    duration: 5, jump: null,
    actors: { carB: true },
    events: [
      { t: 1.0, label: '紧急制动', fact: '黄色车辆从右侧切入，死者车辆紧急制动' },
      { t: 1.4, label: '侧面碰撞', fact: '黄色车辆刮擦死者车辆右侧；两车交换碰撞数据包，原始字段不可读' },
      { t: 2.6, label: '撞击护栏', fact: '死者车辆打滑失控，以约 86 km/h 撞断护栏' },
      { t: 2.85, label: '乘员坠桥', fact: '侧窗破碎，死者被甩出车外，越过护栏缺口坠落桥下' },
      { t: 3.5, label: '黄车驶离', track: 'B', fact: '黄色车辆没有减速，向北驶出重建范围' },
    ],
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
    lines: ['违规手动驾驶导致车辆失控。', '未发现其他涉事车辆。'],
    verdict: '建议：维持初判，确认归档',
    confirm: true,
  },
  r2: {
    tag: '复核报告 02', source: '黑梦回放 · 第 2 次重建',
    lines: ['B 车强行切入并刮擦 A 车，导致 A 车失控。', '肇事车辆未停车，向北驶离。'],
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
  doubt: [
    { text: '车头撞的是护栏。这道伤在侧面，方向由后向前。' },
    { text: '护栏是灰的。这辆车是蓝的。' },
    { text: '黄色从哪里来？' },
  ],
  call: [
    { who: '陈墨', text: '报告漏了一辆车。' },
    { who: '派单员', text: '上传证据，重新回放。' },
    { who: '陈墨', text: '如果第二份也错呢？' },
    { who: '派单员', text: '那就上传下一份证据。你问我，我也没在桥上。' },
  ],
};
