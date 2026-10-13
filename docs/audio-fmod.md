# 3DSyBer · FMOD 音频

目标是写实：雨夜高架上的环境、角色的 Foley、克制的 UI 音，以及只给扫描 / 分析用的高科技音色。

## 流水线

```text
Freesound (CC0)  →  Fmod/source/*.mp3 + credits.json        npm run audio:fetch
   ↓ 剪辑 / 分层 / EQ / 回声 / 淡变 / 标准化（DAW 式 EDL）    npm run audio:design
Fmod/3DSyBer/Assets/{amb,foley,ui,scifi}/*.wav
   ↓ FMOD Studio 脚本建 Event / 总线 / Bank                    npm run audio:events
Fmod/3DSyBer/3DSyBer.fspro
   ↓ 构建 Desktop Bank 并同步                                  npm run audio:build
public/fmod/Main.bank …  →  src/audio/sound.js 在游戏里触发
```

- `scripts/freesound.mjs`：`search` 检索 CC0 素材，`get <id> <name>` 下载并登记出处，`fetch` 按 `credits.json` 重新下载。原始 mp3 不入库。
- `scripts/sound-design.mjs`：编辑工程。每个输出是若干片段（素材、起点、长度、处理链、偏移、增益）的混音，再过母带链。脚步起点来自 onset 分析。环境声用尾部叠回开头做无缝循环，按 LUFS 标准化；单发音效按峰值标准化。传参只渲染名字匹配的文件，例如 `npm run audio:design -- step_walk`。
- `Fmod/build-events.js`：每次重建 `amb` `foley` `ui` `scifi` 四个文件夹（`test/ping` 不动）。要在 Studio 里手工精修的事件，放到别的文件夹，否则下次会被覆盖。
- CLI 读的是磁盘内容，Studio 里改完要先保存。

## 混音结构

总线 `AMB`(-2 dB) `FOLEY`(0) `UI`(-3) `SCIFI`(-1) 都接 Master。全部事件为 2D，进 `Main` Bank。

- 循环事件（`amb/*`、`scifi/analyze_loop`）放在用户参数 `level` 的参数页上，实例活着就一直循环。主轨有 AHDSR：起播淡入、`stop(ALLOWFADEOUT)` 时淡出。
- 多变体事件（脚步、衣物）用 Multi Instrument 随机播放，并加音高 / 音量随机器。

## 事件与触发点

| Event | 触发 |
|-------|------|
| `amb/rain` `amb/traffic` `amb/crowd` `amb/restaurant` | 第一次点击「点击开始」时启动。黑梦里压低（雨保留 35%，人群和餐馆几乎听不到） |
| `foley/step_walk` / `step_run` | `player.js` 按走过的距离触发：走 1.9 m、跑 3.0 m 一步 |
| `foley/cloth_move` | 停下脚步时 |
| `foley/scanner_draw` / `scanner_holster` | 手持扫描仪出现 / 收起（打开平板、黑梦、过场） |
| `foley/tablet_raise` / `tablet_lower` + `ui/panel_open` / `panel_close` | 打开 / 收起平板 |
| `ui/hover` | 平板上指向新按钮；W/A/S/D 切页切条目 |
| `ui/click` / `ui/deny` | 平板上点到按钮 / 点到空白或平板外；测试按钮 |
| `ui/panel_open` | 线索卡弹出 |
| `ui/toast` / `ui/confirm` | 普通提示 / 常驻大提示 |
| `ui/radio_on` / `radio_off` | 无线电通话开始 / 结束 |
| `ui/record` | 黑梦里记录事件 |
| `scifi/scan_pulse` | Q 扫描。前 0.5 秒充能，与举枪同长，脉冲落在发射那一刻 |
| `scifi/analyze_loop` | 按住 E 分析期间循环，音高随进度从 0.85 升到 1.4 |
| `scifi/analyze_complete` / `analyze_cancel` | 分析完成 / 中途松开或移开准星 |
| `scifi/dream_enter` / `dream_exit` | 进入 / 离开黑梦 |

`src/audio/sound.js` 是游戏侧入口：页面加载时预载 Bank，在开始点击里初始化，在主循环里 `update`。FMOD 没就绪或出错时，所有调用都是空操作，只在控制台警告，不影响游戏。切到后台时静音。

## 试听

`npm run dev` 后打开 `/audio.html`，可以单独试听全部事件（清单在 `src/audio/events.js`）。循环事件会一直播，点「停止全部」停止。

## 素材出处

全部为 Freesound 上的 CC0 素材，ID、标题和链接见 `Fmod/source/credits.json`。下载的是 Freesound 的 HQ 预览（128 kbps mp3），不是原始文件。原始 WAV 要登录下载；以后需要更高音质，用同名文件替换后重跑 `audio:design`。

## 命令

```sh
npm run audio:fetch    # 按 credits.json 下载原始素材
npm run audio:design   # 渲染编辑后的 WAV
npm run audio:events   # 在 FMOD 工程里重建事件
npm run audio:build    # 构建 Bank 并同步到 public/fmod/
```

默认使用 `/Applications/FMOD Studio.app/Contents/MacOS/fmodstudio`（2.03.14），可以用 `FMOD_STUDIO_BIN` 指定其他路径。浏览器端的 `fmodstudioL.js` / `.wasm` 要和 Studio 版本兼容。
