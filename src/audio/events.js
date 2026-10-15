import { VOICE_LINES } from './voiceEvents.js';

// Bank 来自本仓库 Fmod/3DSyBer 工程。游戏和试听页共用；EVENTS 只给试听页列清单。
// BOOT_BANKS 最先加载：加载界面一有点击就能放菜单音乐和无效点击音，其余 Bank 随后补齐
export const BOOT_BANKS = ['Master.strings.bank', 'Master.bank', 'Frontend.bank'];
export const BANKS = [...BOOT_BANKS, 'Preview.bank', 'Main.bank', 'VoiceEN.bank'];

// Mixer 对象：Fmod/setup-mix.js、Fmod/scene-sfx.js 创建
export const SNAPSHOTS = {
  dream: 'snapshot:/Dream', tablet: 'snapshot:/Tablet',
  carInterior: 'snapshot:/CarInterior', pause: 'snapshot:/Pause', radar: 'snapshot:/Radar',
};
export const VCAS = { ambience: 'vca:/Ambience', sfx: 'vca:/SFX', ui: 'vca:/UI', dialogue: 'vca:/Dialogue', music: 'vca:/Music' };
export const FOLEY = { step: 'foley/FootStep', water: 'foley/FootStep_Water', cloth: 'foley/ClothFoley' };

// 单发素材的波形峰值（秒）。撞击类要提前这么久触发，峰值才落在画面撞击那一帧
export const PEAK = { hitBody: 0.181, hitRail: 0.326, doorClose: 0.028, pryOpen: 0.161 };

const e = (path, label, description, bank = 'Main.bank') => ({ path, label, description, bank, pitch: 1 });

export const EVENTS = [
  e('event:/music/menu', '菜单音乐（循环）', '26Music_menu · 加载界面第一次点击 / 按键后开始，点击开始时淡出 · MUSIC', 'Frontend.bank'),
  e('event:/ui/enter_game', '进入游戏', '27UI_Entergame · 点击开始进入开场过场', 'Frontend.bank'),
  e('event:/amb/rain', '雨声（循环）', '2D 立体声铺底 · AMB/Bed · 黑梦里压低并闷掉'),
  e('event:/amb/traffic', '车流（循环）', '2D 立体声铺底 · AMB/Bed'),
  e('event:/amb/Amb_1', '城市低频轰鸣（循环 · 3D）', '桥下街面点声源 · AMB/City · 12–160 m'),
  e('event:/amb/Amb_2', '街面活动（循环 · 3D）', '楼脚点声源 · AMB/City · 8–110 m'),
  e('event:/amb/Amb_3', '人群（循环 · 3D）', '街口点声源 · AMB/Crowd · 10–130 m'),
  e('event:/amb/Amb_4', '远处城市（循环 · 3D）', '远处楼群点声源 · AMB/City · 30–300 m'),
  e('event:/amb/Amb_5_rain', '雨打楼体 A（循环 · 3D）', '每栋楼朝桥立面一个点声源，与 B 交替 · AMB/RainHits · 6–45 m'),
  e('event:/amb/Amb_6_rain', '雨打楼体 B（循环 · 3D）', '每栋楼朝桥立面一个点声源，与 A 交替 · AMB/RainHits · 6–45 m'),
  e('event:/vehicle/drive_out', '警车行驶 · 车外（循环 · 3D）', '28car_drive_out · 开场跟车 / 停车，跟着警车走 · WORLD/Vehicle'),
  e('event:/vehicle/drive_in', '警车行驶 · 车内（循环）', '29car_drive_in · 切到驾驶座镜头时硬切进来，开门时淡出 · CABIN'),
  e('event:/vehicle/siren', '警笛（已停用 · 循环 · 3D）', '30police_alarm · 游戏不再触发，事件保留在 Bank 里 · WORLD/Vehicle'),
  e('event:/vehicle/brake', '刹车（3D）', '31car_brake · 开场停车阶段开始'),
  e('event:/vehicle/door_open', '开车门（3D）', '32car_open · 开场下车推门'),
  e('event:/vehicle/door_close', '关车门（3D）', '33car_close · 开场下车关门落锁'),
  e('event:/vehicle/hit_rail', '车撞护栏（3D）', '34Car_Hit_bridge · 每轮黑梦第一次正向播过撞击时刻'),
  e('event:/vehicle/hit_body', '车撞人（3D）', '35Car_hit_body · 结局被撞，峰值对齐撞击帧'),
  e('event:/world/billboard_update', '广告牌刷新（3D）', '43SciFi_Billboard_update · 桥两侧近处大屏换图时 · 随机音高'),
  e(`event:/${FOLEY.step}`, '脚步', '走 / 跑共用 · 跟随手持设备每次行走下沉触发，每一步叠加衣物声'),
  e(`event:/${FOLEY.water}`, '水洼脚步', '46–48footstep_water · 踩在水洼上时代替普通脚步'),
  e(`event:/${FOLEY.cloth}`, '衣物动作', '每一步、停步、扫描仪拿放 / 举落、平板拿放 · 转身不触发 · 单次播放'),
  e('event:/foley/pry_insert', '撬棍插入车门（3D）', '44Pry_insert · 撬棍插进门缝，声源在门尾'),
  e('event:/foley/pry_open', '车门撬开（3D）', '45Pry_open · 卡扣崩开，声源在门尾'),
  e('event:/ui/panel_open', 'UI 面板出现', '36UI_show · 平板开机 / 线索卡弹出 / 暂停层'),
  e('event:/ui/panel_close', 'UI 面板关闭', '37ui_hide · 平板收起 / 线索卡消失 / 暂停层'),
  e('event:/ui/click', 'UI 成功点击', '38UI_Click_confirm · 点到可交互区域'),
  e('event:/ui/hover', 'UI 悬停 / 切换', '指向新按钮、键盘切页'),
  e('event:/ui/deny', 'UI 无效点击', '39UI_Click_normal · 点到平板空白、收不起时点平板外、加载未就绪时点击', 'Frontend.bank'),
  e('event:/ui/warning', 'UI 警告', '40UI_alarm · 走近两端封锁屏障、出现禁止通过提示时'),
  e('event:/ui/toast', 'UI 提示', '普通提示条'),
  e('event:/ui/confirm', 'UI 重要提示', '常驻大提示（如黑梦就绪）'),
  e('event:/ui/record', '记录事件', '黑梦里记录时间节点'),
  e('event:/ui/radio_on', '无线电接通', '派单员通话开始'),
  e('event:/ui/radio_off', '无线电挂断', '通话结束'),
  e('event:/scifi/radar', 'Q 雷达扫描', '42radar_scan · 按 Q；峰值落在 0.5 秒发射瞬间，同时触发 Radar 高切'),
  e('event:/scifi/scan_pulse', '旧 Q 扫描（已停用）', '20Scan_enter · 已由 scifi/radar 取代，游戏不再触发'),
  e('event:/scifi/id_scan_loop', '接入扫描（循环 · 3D）', '41UI_Scan_Loop · 插卡读取 / 根钥接入 / 对象索引期间循环'),
  e('event:/scifi/analyze_loop', '按住分析', '21Scan_progress · 游戏内音高随进度上升，完成 / 中断时停止'),
  e('event:/scifi/analyze_complete', '分析完成', '22Scan_complete · 分析完成时单次触发'),
  e('event:/scifi/analyze_cancel', '分析中断', '23Scan_cancel · 分析中途松开 / 移开准星时单次触发'),
  e('event:/scifi/dream_enter', '进入黑梦', '24dream_enter · 进入黑梦时单次触发'),
  e('event:/scifi/dream_exit', '离开黑梦', '25dream_exit · 离开黑梦时单次触发'),
  e('event:/test/ping', '测试提示音', '原创双音电子 Ping · 0.65 秒', 'Preview.bank'),
  ...Object.entries(VOICE_LINES).map(([id, clip]) => e(clip.path, `${clip.speaker} · ${id}`, clip.text, 'VoiceEN.bank')),
];
