# 3DSyBer · FMOD 音频

目标是写实：雨夜高架上的环境、角色的 Foley、克制的 UI 音，以及只给扫描 / 分析用的高科技音色。

## 流水线

下图为首次制作流程；手工调音后的日常同步只运行 `audio:build`，不要重复执行素材、事件或混音生成。

```text
Freesound (CC0)  →  Fmod/source/*.mp3 + credits.json        npm run audio:fetch
   ↓ 剪辑 / 分层 / EQ / 回声 / 淡变 / 标准化（DAW 式 EDL）    npm run audio:design
Fmod/3DSyBer/Assets/{amb,foley,ui,scifi}/*.wav
   ↓ FMOD Studio 脚本建 Event / 总线 / Bank                    npm run audio:events
   ↓ 在手工 amb 事件上搭 3D / 子总线 / Snapshot / VCA          npm run audio:mix
Fmod/3DSyBer/3DSyBer.fspro
   ↓ 构建 Desktop Bank 并同步                                  npm run audio:build
public/fmod/Main.bank …  →  src/audio/sound.js 在游戏里触发
```

- `scripts/freesound.mjs`：`search` 检索 CC0 素材，`get <id> <name>` 下载并登记出处，`fetch` 按 `credits.json` 重新下载。原始 mp3 不入库。
- `scripts/sound-design.mjs`：编辑工程。每个输出是若干片段（素材、起点、长度、处理链、偏移、增益）的混音，再过母带链。脚步起点来自 onset 分析。环境声用尾部叠回开头做无缝循环，按 LUFS 标准化；单发音效按峰值标准化。传参只渲染名字匹配的文件，例如 `npm run audio:design -- step_walk`。
- `Fmod/build-events.js`：首次创作脚本，会重建 `ui` / `scifi` 并重设总线增益。**当前 `scifi` 已手工替换素材，不可用于日常同步**，否则会丢失替换和调音；手工制作的 `amb`、`foley/FootStep`、`foley/ClothFoley` 和 `test/ping` 不动。
- `Fmod/setup-mix.js`：只增改不重建，可重复执行。`amb` 是在 Studio 里手工做的，脚本只给它加路由、Spatializer、Snapshot、VCA；手工 Foley 仅接回 `FOLEY` 总线并分配到 `Main` Bank。跑完 `audio:events` 后要再跑一次。
- CLI 读的是磁盘内容，Studio 里改完要先保存。

### 手工调音后的同步（默认流程）

在 Studio 保存工程后，只运行 `npm run audio:build`，再运行 `npm run build` 更新 Web 产物。前者仅编译 / 复制 Bank，不重建事件、不改 Studio 音量；后者仅打包 Web。

游戏不设置事件、总线或 VCA 的额外增益，已移除衣物、UI、分析声的代码音量倍率。后续新增动作也只触发事件，不在代码里调音。音量、随机音量、Snapshot、距离衰减均由 Studio 控制；黑梦 / 平板仍正常切换已制作的 Snapshot。

`audio:events` / `audio:mix` 默认拒绝执行；只有重新创作事件 / 混音且明确接受覆盖风险时才用 `FMOD_ALLOW_REAUTHOR=1 npm run audio:events` 或 `FMOD_ALLOW_REAUTHOR=1 npm run audio:mix`。日常调音同步不要运行 `audio:design` / `audio:events` / `audio:mix`。

### 手工替换的 scifi 素材

以下替换已同步到 Web Bank；保持原事件路径、触发时机、分析进度音高与停止逻辑，不在 Web 中设置事件 / 总线 / VCA 音量。后续音量只在 Studio 调整，保存后运行 `audio:build` 和 `build`。

| Event（`event:/scifi/`） | Studio 素材 |
|------------------------|-------------|
| `scan_pulse` | `20Scan_enter.wav` |
| `analyze_loop` | `21Scan_progress.wav` |
| `analyze_complete` | `22Scan_complete.wav` |
| `analyze_cancel` | `23Scan_cancel.wav` |
| `dream_enter` | `24dream_enter.wav` |
| `dream_exit` | `25dream_exit.wav` |

`npm run test:audio` 覆盖这组事件的路径、分析起停、音高以及不写音量的约束。当前分析素材由 Studio 定义为约 2.89 秒，游戏分析仍为 1.4 秒，完成或中断时照常停止；不为同步而重建 Loop Region 或包络。

## 混音结构

总线 `AMB`（带低通）`FOLEY` `UI` `SCIFI` 都接 Master，音量以 Studio 当前设置为准。`AMB` 下分 `Bed` `City` `Crowd` `RainHits`。全部事件进 `Main` Bank；Snapshot、总线、VCA 自动进 `Master` Bank，**不要把 Snapshot 分配到 Main**：Studio 2.03.14 会在往这个 Bank 加事件时卡死。

- 循环事件用时间线 + Loop Region：触发一次就一直循环。主轨上的 AHDSR 负责起播淡入，`stop(ALLOWFADEOUT)` 时淡出。没有参数。
- `amb/rain` `amb/traffic` → `AMB/Bed`。2D 立体声铺底，跟着头走。
- `amb/Amb_1` `Amb_2` `Amb_4` → `AMB/City`，`amb/Amb_3`（人群）→ `AMB/Crowd`。
- `amb/Amb_5_rain` `Amb_6_rain`（雨打物体）→ `AMB/RainHits`，范围 6–45 m。`city.js` 给每栋楼朝桥的立面外 1 m、桥面高度放一个声源点（立面超过 24 m 放两个），两种素材交替使用；每个实例随机起点、音高 ±6%，避免多个实例同相叠加。离玩家活动范围超过 45 m 的点不建实例，现在共 21 个。都是 3D 点声源，用 FMOD Spatializer（Inverse Tapered，User 包络），到最大距离时静音。位置写在 `src/audio/sound.js` 的 `EMITTERS`。听者每帧跟着相机的位置和朝向走；FMOD 用右手坐标系（`INIT_3D_RIGHTHANDED`），与 three.js 相同，单位米。
- Snapshot（Overriding，强度用 AHDSR 淡入淡出；下列为初始制作值，手工调整后以 Studio 当前值为准）：
  - `Dream`（黑梦，1.5 s）：Bed -8 dB、City -20 dB、Crowd -26 dB、RainHits -12 dB，AMB 低通降到 1.1 kHz。
  - `Tablet`（平板举起，0.4 / 0.5 s）：AMB -7 dB（比平时低 5 dB）。
- VCA：`Ambience`（AMB）、`SFX`（FOLEY + SCIFI）、`UI`。游戏不覆盖 VCA 音量；试听页首次启用读取当前值，只有手动拖动推子才改变该页的播放增益，不回写 Studio。
- 多变体事件（脚步、衣物）用 Multi Instrument 随机播放，并加音高 / 音量随机器。

## 事件与触发点

| Event | 触发 |
|-------|------|
| `amb/rain` `amb/traffic` `amb/Amb_1..4` `amb/Amb_5_rain` `amb/Amb_6_rain` | 第一次点击「点击开始」时各触发一次，之后一直循环 |
| `snapshot:/Dream` | 进入 / 离开黑梦 |
| `snapshot:/Tablet` | 平板打开期间 |
| `foley/FootStep` | `player.js` 按实际走过的距离单次触发：走 1.9 m、跑 3.0 m 一步；普通探索约 0.475 s / 0.375 s 一步。步频改变触发间隔，不额外改变素材音高；走 / 跑切换保留步相，撞墙不持续响，暂停 / 平板 / 过场不累积步数 |
| `foley/ClothFoley` | 每一步与 FootStep 叠加；停步、原地明显转身（约 20°，最短间隔 0.35 s）、扫描仪拿出 / 收起、Q 扫描举起 / 放下、分析举起 / 放下、平板拿出 / 收起时各单次触发；静止待机、细小视角抖动和呼吸动画不触发 |
| `ui/panel_open` / `panel_close` | 打开 / 收起平板，保留原有 UI 声，与衣物声独立叠加 |
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

角色动作统一使用 `sound.step()`（FootStep + ClothFoley）和 `sound.cloth()`（仅 ClothFoley）；新动作也走这两个入口。Foley 事件路径大小写与 Studio 完全一致，均为单次事件，不启动循环；素材、随机音高和混音由 Studio 保持控制。手工修改后保存工程并执行 `npm run audio:build` 同步浏览器 Bank。

## 试听

`npm run dev` 后打开 `/audio.html`，可以单独试听全部事件（清单在 `src/audio/events.js`），也可以显式推 VCA、开关 Snapshot；默认不写入音量，启用音频后才可拖动推子。循环事件会一直播，点「停止全部」停止。

## 素材出处

全部为 Freesound 上的 CC0 素材，ID、标题和链接见 `Fmod/source/credits.json`。下载的是 Freesound 的 HQ 预览（128 kbps mp3），不是原始文件。原始 WAV 要登录下载；以后需要更高音质，用同名文件替换后重跑 `audio:design`。

## 命令

```sh
npm run audio:fetch    # 按 credits.json 下载原始素材
npm run audio:design   # 渲染编辑后的 WAV
npm run audio:events   # 重新创作事件（默认阻止，须显式 FMOD_ALLOW_REAUTHOR=1）
npm run audio:mix      # 重建混音（默认阻止，须显式 FMOD_ALLOW_REAUTHOR=1）
npm run audio:build    # 构建 Bank 并同步到 public/fmod/
npm run test:audio     # Foley / scifi 触发与音量保护回归测试（无需浏览器 / 声卡）
```

默认使用 `/Applications/FMOD Studio.app/Contents/MacOS/fmodstudio`（2.03.14），可以用 `FMOD_STUDIO_BIN` 指定其他路径。浏览器端的 `fmodstudioL.js` / `.wasm` 要和 Studio 版本兼容。
