// Bank 来自本仓库 Fmod/3DSyBer 工程。游戏和试听页共用；EVENTS 只给试听页列清单。
export const BANKS = ['Master.strings.bank', 'Master.bank', 'Preview.bank', 'Main.bank'];

// Mixer 对象：Fmod/setup-mix.js 创建
export const SNAPSHOTS = { dream: 'snapshot:/Dream', tablet: 'snapshot:/Tablet' };
export const VCAS = { ambience: 'vca:/Ambience', sfx: 'vca:/SFX', ui: 'vca:/UI' };
export const FOLEY = { step: 'foley/FootStep', cloth: 'foley/ClothFoley' };

const e = (path, label, description, bank = 'Main.bank') => ({ path, label, description, bank, pitch: 1 });

export const EVENTS = [
  e('event:/amb/rain', '雨声（循环）', '2D 立体声铺底 · AMB/Bed · 黑梦里压低并闷掉'),
  e('event:/amb/traffic', '车流（循环）', '2D 立体声铺底 · AMB/Bed'),
  e('event:/amb/Amb_1', '城市低频轰鸣（循环 · 3D）', '桥下街面点声源 · AMB/City · 12–160 m'),
  e('event:/amb/Amb_2', '街面活动（循环 · 3D）', '楼脚点声源 · AMB/City · 8–110 m'),
  e('event:/amb/Amb_3', '人群（循环 · 3D）', '街口点声源 · AMB/Crowd · 10–130 m'),
  e('event:/amb/Amb_4', '远处城市（循环 · 3D）', '远处楼群点声源 · AMB/City · 30–300 m'),
  e('event:/amb/Amb_5_rain', '雨打楼体 A（循环 · 3D）', '每栋楼朝桥立面一个点声源，与 B 交替 · AMB/RainHits · 6–45 m'),
  e('event:/amb/Amb_6_rain', '雨打楼体 B（循环 · 3D）', '每栋楼朝桥立面一个点声源，与 A 交替 · AMB/RainHits · 6–45 m'),
  e(`event:/${FOLEY.step}`, '脚步', '走 / 跑共用 · 游戏按实际步频逐步触发，每一步叠加衣物声'),
  e(`event:/${FOLEY.cloth}`, '衣物动作', '每一步、停步、转身、扫描仪拿放 / 举落、平板拿放 · 单次播放'),
  e('event:/ui/panel_open', 'UI 面板出现', '平板开机 / 线索卡弹出'),
  e('event:/ui/panel_close', 'UI 面板关闭', '平板收起'),
  e('event:/ui/click', 'UI 点击', '点到可交互区域'),
  e('event:/ui/hover', 'UI 悬停 / 切换', '指向新按钮、键盘切页'),
  e('event:/ui/deny', 'UI 无效点击', '点到平板空白处或平板外'),
  e('event:/ui/toast', 'UI 提示', '普通提示条'),
  e('event:/ui/confirm', 'UI 重要提示', '常驻大提示（如黑梦就绪）'),
  e('event:/ui/record', '记录事件', '黑梦里记录时间节点'),
  e('event:/ui/radio_on', '无线电接通', '派单员通话开始'),
  e('event:/ui/radio_off', '无线电挂断', '通话结束'),
  e('event:/scifi/scan_pulse', 'Q 扫描', '20Scan_enter · 扫描举枪时触发，保持原有发射时序'),
  e('event:/scifi/analyze_loop', '按住分析', '21Scan_progress · 游戏内音高随进度上升，完成 / 中断时停止'),
  e('event:/scifi/analyze_complete', '分析完成', '22Scan_complete · 分析完成时单次触发'),
  e('event:/scifi/analyze_cancel', '分析中断', '23Scan_cancel · 分析中途松开 / 移开准星时单次触发'),
  e('event:/scifi/dream_enter', '进入黑梦', '24dream_enter · 进入黑梦时单次触发'),
  e('event:/scifi/dream_exit', '离开黑梦', '25dream_exit · 离开黑梦时单次触发'),
  e('event:/test/ping', '测试提示音', '原创双音电子 Ping · 0.65 秒', 'Preview.bank'),
];
