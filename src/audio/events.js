// Bank 来自本仓库 Fmod/3DSyBer 工程。游戏和试听页共用；EVENTS 只给试听页列清单。
export const BANKS = ['Master.strings.bank', 'Master.bank', 'Preview.bank', 'Main.bank'];

const e = (path, label, description, bank = 'Main.bank') => ({ path, label, description, bank, volume: 1, pitch: 1 });

export const EVENTS = [
  e('event:/amb/rain', '雨声（循环）', '城市稳定雨声 + 近处密雨层 · 60 秒无缝循环 · 黑梦里压低', 'Main.bank'),
  e('event:/amb/traffic', '远处车流（循环）', '夜间高架远景车流，低通去近场细节'),
  e('event:/amb/crowd', '远处人群（循环）', '车站人声低通 + 早期反射，退到桥下街区'),
  e('event:/amb/restaurant', '远处餐馆（循环）', '室内餐馆录音强低通，像从街边飘上来'),
  e('event:/foley/step_walk', '脚步 · 走', '11 条湿靴脚步 + 雨衣摩擦层 · 随机不重复 · 音高 / 音量随机'),
  e('event:/foley/step_run', '脚步 · 跑', '12 条跑步脚步，衣物层更重'),
  e('event:/foley/cloth_move', '衣物摆动', '停步 / 转身 · 5 条随机'),
  e('event:/foley/scanner_draw', '掏出扫描仪', '外套摆动 → 皮套抽出'),
  e('event:/foley/scanner_holster', '收起扫描仪', '皮套扣合 + 衣物落下'),
  e('event:/foley/tablet_raise', '拿出平板', '口袋翻找 + 雨衣摩擦'),
  e('event:/foley/tablet_lower', '收起平板', '雨衣摩擦 + 放回口袋'),
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
  e('event:/scifi/scan_pulse', 'Q 扫描', '0.5 秒充能（与举枪同步）→ 脉冲 + 全息扫掠'),
  e('event:/scifi/analyze_loop', '按住分析（循环）', '扫描器 + 低频嗡声，游戏内音高随进度上升；再点停止前会一直循环'),
  e('event:/scifi/analyze_complete', '分析完成', '扫描收尾 + 确认音'),
  e('event:/scifi/analyze_cancel', '分析中断', '充能声倒放降调 · 断电下滑'),
  e('event:/scifi/dream_enter', '进入黑梦', '降调充能 + 全息扫掠 + 长回声'),
  e('event:/scifi/dream_exit', '离开黑梦', '倒放扫掠'),
  e('event:/test/ping', '测试提示音', '原创双音电子 Ping · 0.65 秒', 'Preview.bank'),
];
