// 线索数据：位置（世界坐标）、检测半径、分析结果文案、概率
// key: true 为必需线索，全部分析后才能开始重建
export const CLUES = [
  {
    id: 'skidA', name: '刹车痕', pos: [-0.9, 20.05, -22], radius: 1.6, key: true,
    lines: ['制动距离 29.4 m', '推算初速度 112 km/h（限速 80）', '制动后约 0.4 秒方向突然向左偏转'],
    result: '死者车辆紧急制动', prob: 0.97,
  },
  {
    id: 'skidB', name: '第二道胎痕', pos: [-3.9, 20.05, -21], radius: 1.6, key: true,
    lines: ['胎宽 265 mm，与死者车辆（245 mm）不符', '轨迹由右侧车道向左切入', '与死者刹车痕在同一时段形成'],
    result: '现场存在第二辆车', prob: 0.93,
  },
  {
    id: 'scrape', name: '车身刮漆', pos: [4.6, 20.6, 1.0], radius: 0.9, key: true,
    lines: ['右侧车门凹陷 4.2 cm', '残留黄色漆片：NC-Y08 商用车涂装', '刮擦方向：由后向前'],
    result: '两车发生侧面碰撞', prob: 0.96,
  },
  {
    id: 'rail', name: '断裂护栏', pos: [6.9, 20.7, -2.4], radius: 1.0, key: true,
    lines: ['撞击角度 38°', '冲击能量约 410 kJ，超出护栏设计上限 2.6 倍', '撞击瞬间车速约 86 km/h'],
    result: '车辆失控撞断护栏', prob: 0.99,
  },
  {
    id: 'front', name: '车头损毁', pos: [6.9, 20.6, 1.5], radius: 0.9, key: false,
    lines: ['前纵梁压缩 0.62 m', '左前悬架断裂，车轮脱落', '驾驶员侧气囊已展开'],
    result: '正面高速撞击', prob: 0.98,
  },
  {
    id: 'debris', name: '碎片散布', pos: [3.2, 20.1, -3.0], radius: 1.2, key: false,
    lines: ['散布方向 NE 41°，与最终车头朝向一致', '玻璃碎片来自驾驶员侧车窗', '乘员可能经由该车窗被甩出'],
    result: '车窗破碎', prob: 0.84,
  },
  {
    id: 'victim', name: '遇难者', pos: [1.8, 20.25, 5.1], radius: 1.0, key: true,
    lines: ['男性，约 30 岁，义体化比例 12%', '颈椎骨折，当场死亡', '未系安全带，被甩出车外约 5.8 m'],
    result: '死者被甩出车外', prob: 0.95,
  },
  {
    id: 'hazard', name: '双闪灯', pos: [4.0, 20.65, -1.2], radius: 0.8, key: true,
    lines: ['双闪处于开启状态', '开关上检出非死者的部分指纹', '开启时间晚于撞击约 64 秒'],
    result: '事后有人接触过车辆', prob: 0.88,
  },
  {
    id: 'footprints', name: '血脚印', pos: [0.4, 20.05, 10.6], radius: 1.3, key: true,
    lines: ['鞋码 43，鞋底纹路与死者不符', '步幅 0.9 m，向北离开现场', '血迹已半干：留下时间约为事故后 1 分钟'],
    result: '有人离开了现场', prob: 0.91,
  },
];

// 重建：事件节点（时间轴 0~10 秒；4 秒处之后为时间跳跃，代表约 1 分钟后）
export const RECON_DURATION = 10;
export const TIME_JUMP = 4;
export const EVENTS = [
  { t: 1.0, label: '紧急制动', fact: '黄色车辆从右侧切入，死者车辆紧急制动' },
  { t: 1.4, label: '侧面碰撞', fact: '黄色车辆刮擦死者车辆右侧，致其向左偏转' },
  { t: 2.6, label: '撞击护栏', fact: '死者车辆打滑失控，以约 86 km/h 撞断护栏' },
  { t: 2.85, label: '乘员甩出', fact: '死者未系安全带，从破碎车窗被甩出' },
  { t: 7.0, label: '有人返回', fact: '约 1 分钟后，一名人员返回现场并打开双闪，随后向北离开' },
];

// 结案报告（平板「结论」页）：玩家根据线索填写，盖章结案
// type：text 打字（确定信息）、radio 勾选、choice 下拉选择（需要描述的信息）
// 剧情未定，以下选项均为占位，后续随剧情修改
export const REPORT = [
  {
    title: '基础信息',
    fields: [
      { id: 'name', label: '姓名', type: 'text', max: 10 },
      { id: 'gender', label: '性别', type: 'radio', options: ['男', '女'] },
      { id: 'age', label: '年龄', type: 'text', max: 3 },
      { id: 'idType', label: '身份证明', type: 'radio', options: ['身份证', '护照', '驾驶证', '无'] },
      { id: 'idNo', label: '证件号码', type: 'text', max: 18 },
    ],
  },
  {
    title: '事件',
    fields: [
      { id: 'date', label: '日期', type: 'text', max: 16 },
      { id: 'place', label: '地点', type: 'text', max: 14 },
      { id: 'category', label: '事故类别', type: 'radio', options: ['交通事故', '刑事案件', '意外', '自杀'] },
      { id: 'cause', label: '引起原因', type: 'choice', options: ['超速行驶', '路面湿滑', '车辆故障', '被他车刮擦后失控', '驾驶员疲劳驾驶'] },
      { id: 'casualty', label: '伤亡情况', type: 'choice', options: ['1 人死亡', '1 人重伤', '1 死 1 伤', '无人员伤亡'] },
      { id: 'injury', label: '受伤位置', type: 'choice', options: ['头部', '颈椎', '胸腔', '四肢'] },
    ],
  },
];

export const CONCLUSION = {
  title: '事故重建完成',
  verdict: '非意外事故 · 肇事逃逸',
  prob: 0.94,
  summary: '一辆黄色车辆从右侧强行切入并刮擦死者车辆，致其失控撞断护栏。死者被甩出车外，当场死亡。约 1 分钟后，肇事者返回现场，打开双闪后离开。',
};
