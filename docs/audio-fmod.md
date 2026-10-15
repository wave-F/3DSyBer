# 3DSyBer · FMOD 音频

目标是写实：雨夜高架上的环境、角色的 Foley、克制的 UI 音，以及只给扫描 / 分析用的高科技音色。

65 条英文角色配音已通过 `event:/voice/en/...` 接入，独立 `VoiceEN` Bank 与 `DIALOGUE` 路由；当前素材按用户确认的内部非商用用途生成，来源与授权限制见 `Fmod/voice-en-manifest.json`，详细流程见 [voice-en.md](voice-en.md)。原有字幕文本与手工音效混音保留。

## 流水线

下图为首次制作流程；手工调音后的日常同步只运行 `audio:build`，不要重复执行素材、事件或混音生成。

```text
Freesound (CC0)  →  Fmod/source/*.mp3 + credits.json        npm run audio:fetch
   ↓ 剪辑 / 分层 / EQ / 回声 / 淡变 / 标准化（DAW 式 EDL）    npm run audio:design
Fmod/3DSyBer/Assets/{amb,foley,ui,scifi}/*.wav
   ↓ FMOD Studio 脚本建 Event / 总线 / Bank                    npm run audio:events
   ↓ 在手工 amb 事件上搭 3D / 子总线 / Snapshot / VCA          npm run audio:mix
   ↓ 第二批素材（Assets/26–48）建事件 / 总线 / Snapshot          npm run audio:scene
Fmod/3DSyBer/3DSyBer.fspro
   ↓ 构建 Desktop Bank 并同步                                  npm run audio:build
public/fmod/Main.bank …  →  src/audio/sound.js 在游戏里触发
```

- `Fmod/scene-sfx.js`（`npm run audio:scene`）：第二批音效（菜单音乐、车辆、场景、UI、撬门、水脚步）和 `CarInterior` / `Pause` / `Radar` Snapshot。**只新增缺失对象**：事件、总线、效果器、Snapshot 属性已存在就跳过，Studio 里调过的值不会被覆盖，可重复执行；四个旧 UI 事件只在仍用 `Assets/ui/` 旧素材时才换成新素材。

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
| `scan_pulse` | `20Scan_enter.wav`（已停用，Q 改播 `scifi/radar`） |
| `analyze_loop` | `21Scan_progress.wav` |
| `analyze_complete` | `22Scan_complete.wav` |
| `analyze_cancel` | `23Scan_cancel.wav` |
| `dream_enter` | `24dream_enter.wav` |
| `dream_exit` | `25dream_exit.wav` |

`npm run test:audio` 覆盖这组事件的路径、分析起停、音高以及不写音量的约束。当前分析素材由 Studio 定义为约 2.89 秒，游戏分析仍为 1.4 秒，完成或中断时照常停止；不为同步而重建 Loop Region 或包络。

## 混音结构

总线 `AMB` `FOLEY` `UI` `SCIFI` `MUSIC` `WORLD`（下分 `Vehicle` `Billboard`）`CABIN` 都接 Master，音量以 Studio 当前设置为准。`AMB` 下分 `Bed` `City` `Crowd` `RainHits`。`AMB` `FOLEY` `SCIFI` `WORLD` `CABIN` 各有一个平时全开的低通（Snapshot 只改它的截止频率），`AMB` `FOLEY` `SCIFI` `WORLD` 各有一路推后发送到 `Reverb` return（平时 -80 dB）。音效进 `Main` Bank；`Frontend` Bank（菜单音乐、进入游戏、无效点击）最先加载，加载界面就能出声；英文配音单独进 `VoiceEN`，测试音在 `Preview`；Snapshot、总线、VCA 自动进 `Master` Bank，**不要把 Snapshot 分配到 Main**：Studio 2.03.14 会在往这个 Bank 加事件时卡死。新增 `DIALOGUE/{spoken,inner,radio,device}` 与 `vca:/Dialogue` 仅控制配音，不改既有路由。

- 循环事件用时间线 + Loop Region：触发一次就一直循环。主轨上的 AHDSR 负责起播淡入，`stop(ALLOWFADEOUT)` 时淡出。没有参数。
- `amb/rain` `amb/traffic` → `AMB/Bed`。2D 立体声铺底，跟着头走。
- `amb/Amb_1` `Amb_2` `Amb_4` → `AMB/City`，`amb/Amb_3`（人群）→ `AMB/Crowd`。
- `amb/Amb_5_rain` `Amb_6_rain`（雨打物体）→ `AMB/RainHits`，范围 6–45 m。`city.js` 给每栋楼朝桥的立面外 1 m、桥面高度放一个声源点（立面超过 24 m 放两个），两种素材交替使用；每个实例随机起点、音高 ±6%，避免多个实例同相叠加。离玩家活动范围超过 45 m 的点不建实例，现在共 21 个。都是 3D 点声源，用 FMOD Spatializer（Inverse Tapered，User 包络），到最大距离时静音。位置写在 `src/audio/sound.js` 的 `EMITTERS`。听者每帧跟着相机的位置和朝向走；FMOD 用右手坐标系（`INIT_3D_RIGHTHANDED`），与 three.js 相同，单位米。
- Snapshot（Overriding，强度用 AHDSR 淡入淡出；下列为初始制作值，手工调整后以 Studio 当前值为准）：
  - `Dream`（黑梦，1.5 s）：Bed -8 dB、City -20 dB、Crowd -26 dB、RainHits -12 dB，AMB 低通降到 1.1 kHz。
  - `Dream` 追加：AMB / FOLEY / SCIFI / WORLD 送混响（-10 / -6 / -8 / -4 dB，`Reverb` 衰减 3.2 s），FOLEY（脚步）低通 1.8 kHz；原有设置不变。
  - `Tablet`（平板举起，0.4 / 0.5 s）：AMB -7 dB（比平时低 5 dB）。
  - `CarInterior`（开场坐在警车里，0 / 0.9 s）：AMB 低通 700 Hz、WORLD（车外声）900 Hz；车内引擎 `CABIN` 不动。
  - `Pause`（暂停层，0.25 / 0.3 s）：AMB / FOLEY / SCIFI / WORLD / CABIN 低通 600 Hz；UI 与音乐不受影响。
  - `Radar`（Q 发射瞬间）：AMB / FOLEY / WORLD / CABIN 低通 900 Hz；AHDSR 为 40 ms 起、保持 150 ms、900 ms 衰减到 0，自己恢复，游戏 2 秒后释放实例。雷达本身在 SCIFI，不被切。
- VCA：`Ambience`（AMB）、`SFX`（FOLEY + SCIFI + WORLD + CABIN）、`UI`、`Dialogue`（DIALOGUE）、`Music`（MUSIC）。游戏不覆盖 VCA 音量；试听页首次启用读取当前值，只有手动拖动推子才改变该页的播放增益，不回写 Studio。
- 多变体事件（脚步、衣物）用 Multi Instrument 随机播放，并加音高 / 音量随机器。
- 接线员广播：8 条派单员台词统一走 `DIALOGUE/radio`，窄带 400–3400 Hz、中频存在感、4:1 压缩与轻饱和；全部在 Studio 处理，不烘焙进源配音，不影响陈墨和仪器。参数与创作脚本见 [voice-en.md](voice-en.md)。

## 事件与触发点

| Event | 触发 |
|-------|------|
| `music/menu` | 加载界面上第一次点击 / 按键（浏览器要先有用户手势）时开始循环；一直没操作就不放。点击开始时淡出 |
| `ui/enter_game` | 点击开始 |
| `ui/deny`（加载界面） | 加载还没就绪时点击 |
| `amb/rain` `amb/traffic` `amb/Amb_1..4` `amb/Amb_5_rain` `amb/Amb_6_rain` | 点击开始、全部 Bank 装完后各触发一次，之后一直循环 |
| `vehicle/siren` | 已停用：事件保留在工程和 Bank 里，游戏不触发 |
| `vehicle/drive_out` | 开场跟车 + 停车阶段，3D 跟着警车走。切到驾驶座镜头时立即切断 |
| `vehicle/brake` | 停车阶段开始，跟着车滑进车位 |
| `vehicle/drive_in` + `snapshot:/CarInterior` | 切到驾驶座镜头的同一帧硬切进来（2D）；推门（开场 2.45 s）时两者一起淡出 |
| `vehicle/door_open` / `door_close` | 开场推门 / 关门落锁，3D 在驾驶门；关门按素材峰值提前，对准门板合上的一帧 |
| `vehicle/hit_rail` | 黑梦里 A 车撞断护栏：每轮黑梦第一次正向播放经过撞击时刻（`recon.js` 的 `IMPACT_T`）时响一次，按峰值提前触发；滚轮拖动、倒放和之后重播都不响 |
| `vehicle/hit_body` | 结局被撞：按峰值提前 0.181 s 触发，峰值落在撞击帧 |
| `world/billboard_update` | 离玩家活动范围 60 m 内的轮播大屏（现在 14 块）每次换图时在屏幕中心响，随机音高在 Studio；世界时间冻结（黑梦）时不换图也不响 |
| `snapshot:/Pause` + `ui/panel_open` / `panel_close` | 暂停层出现 / 消失 |
| `snapshot:/Dream` | 进入 / 离开黑梦 |
| `snapshot:/Tablet` | 平板打开期间 |
| `foley/FootStep` / `foley/FootStep_Water` | 脚下是水洼（`bridge.js` 的 `puddleAt`，读路面同一张水洼遮罩）时用水脚步代替普通脚步，约占活动范围 16%。与手持设备的 8 字行走晃动共用 `player.js` 的 `gait`；每次竖直下沉到最低点（`phase = π/2 + nπ`）单次触发。稳态走路约 0.403 s 一步；跑步共用步相频率乘 0.8（降低 20%，约 0.280 s 一步），移动速度不变。只改触发间隔，不改音量或素材音高。必须同时有方向输入和实际位移，原地转镜头（含按住 Shift）不触发脚步或衣物声；走 / 跑切换保留步相，撞墙 / 静止不落脚，暂停 / 平板 / 过场 / 相机跳点不补播 |
| `foley/ClothFoley` | 每一步与 FootStep 叠加；停步、扫描仪拿出 / 收起、Q 扫描举起 / 放下、分析举起 / 放下、平板拿出 / 收起时各单次触发；原地转身、抬头低头、静止待机、细小视角抖动和呼吸动画不触发 |
| `ui/panel_open` / `panel_close` | 打开 / 收起平板（含插卡读取后收起），与衣物声独立叠加 |
| `ui/hover` | 平板上指向新按钮；W/A/S/D 切页切条目 |
| `ui/click` / `ui/deny` | 平板上点到按钮 / 点到空白；点平板外能收起就收起（收起音），收不起（待确认、接入中、过场）是无效点击；测试按钮 |
| `ui/panel_open` / `panel_close` | 线索卡弹出 / 消失（4 秒自动消失或被其他操作收起） |
| `ui/warning` | 走近两端封锁屏障、出现「调查封锁区」提示时响一次；退到 3.5 m 外再靠近才重新响 |
| `ui/toast` / `ui/confirm` | 普通提示 / 常驻大提示 |
| `ui/radio_on` / `radio_off` | 无线电通话开始 / 结束 |
| `voice/en/<group>_<两位序号>` | `ui.say` 中对应的英文对白或独白，等待真实结束后进入下一句；暂停/取消与剧情队列同步 |
| `ui/record` | 黑梦里记录事件 |
| `scifi/radar` + `snapshot:/Radar` | Q 扫描。素材在事件时间线上后移 0.198 s，峰值落在举枪 0.5 s 后的发射瞬间；发射瞬间触发 Radar 高切 |
| `scifi/id_scan_loop` | 平板接入画面（第 3 轮插卡读取、第 4 轮根钥接入、对象索引）播放期间循环；插卡时 3D 在检修接口，其余在平板位置 |
| `foley/pry_insert` / `pry_open` | 撬棍捅进门缝 / 卡扣崩开（峰值对准 `PRY_POP`），3D 在车门门尾（1–25 m），取代原来 WebAudio 合成的金属声 |
| `scifi/analyze_loop` | 按住 E 分析期间循环，音高随进度从 0.85 升到 1.4 |
| `scifi/analyze_complete` / `analyze_cancel` | 分析完成 / 中途松开或移开准星 |
| `scifi/dream_enter` / `dream_exit` | 进入 / 离开黑梦 |

`src/audio/sound.js` 是游戏侧入口：页面加载时下载全部 Bank；加载界面第一次点击 / 按键（`unlock`）或点击开始（`start`）时初始化，先装 `BOOT_BANKS`（Master、Frontend），其余 Bank 下载完依次装入（`fmod.loaded`），场景声要等全部装完才启动；在主循环里 `update`。3D 单发用 `sound.play(name, { position })`，跟着物体走的声源用 `sound.follow(name, position)`（每帧传位置，`null` 停止），2D 循环用 `sound.loop(name, on)`。撞击类素材的峰值时刻记在 `events.js` 的 `PEAK`，换素材后要同步改。FMOD 没就绪或出错时，所有调用都是空操作，只在控制台警告，不影响游戏。切到后台时静音。

角色动作统一使用 `sound.step()`（FootStep + ClothFoley）和 `sound.cloth()`（仅 ClothFoley）；新动作也走这两个入口。Foley 事件路径大小写与 Studio 完全一致，均为单次事件，不启动循环；素材、随机音高和混音由 Studio 保持控制。手工修改后保存工程并执行 `npm run audio:build` 同步浏览器 Bank。

`main.js` 每帧先以真实帧时长更新玩家（移动倍率单独传入，黑梦减速也保持实际速度），再把同一份 `updatePlayer.gait` 经调查状态传给 `viewmodel.js` 渲染。不要在设备里再建独立的走路计时器，也不要重新按步长定时播放脚步；设备隐藏时步相仍正常工作。静止呼吸、视角弹簧和分析动作不触发脚步。

## 试听

`npm run dev` 后打开 `/audio.html`，可以单独试听全部事件（清单在 `src/audio/events.js`），也可以显式推 VCA、开关 Snapshot；默认不写入音量，启用音频后才可拖动推子。循环事件会一直播，点「停止全部」停止。

## 素材出处

现有环境 / Foley / UI / scifi 来源为 Freesound 上的 CC0 素材，ID、标题和链接见 `Fmod/source/credits.json`。下载的是 Freesound 的 HQ 预览（128 kbps mp3），不是原始文件。原始 WAV 要登录下载；以后需要更高音质，用同名文件替换后重跑 `audio:design`。新制作的 ElevenLabs 配音不属于这份 CC0 清单，商用与音色授权须单独核验。

`Assets/` 根目录的 26–48 号 WAV（菜单音乐、车辆、UI、雷达、广告牌、撬门、水脚步）是在 Reaper 里制作的成品，导出目录 `/Volumes/Data/Reaper/CyberBridge/Out/1`。替换时保持文件名不变，覆盖后在 Studio 里刷新素材、运行 `audio:build`。

## 命令

```sh
npm run audio:fetch    # 按 credits.json 下载原始素材
npm run audio:design   # 渲染编辑后的 WAV
npm run audio:events   # 重新创作事件（默认阻止，须显式 FMOD_ALLOW_REAUTHOR=1）
npm run audio:mix      # 重建混音（默认阻止，须显式 FMOD_ALLOW_REAUTHOR=1）
npm run audio:scene    # 第二批音效 / Snapshot：只补缺失对象，不覆盖手工调音
npm run audio:build    # 构建 Bank 并同步到 public/fmod/
npm run test:audio     # Foley / scifi 触发与音量保护回归测试（无需浏览器 / 声卡）
```

默认使用 `/Applications/FMOD Studio.app/Contents/MacOS/fmodstudio`（2.03.14），可以用 `FMOD_STUDIO_BIN` 指定其他路径。浏览器端的 `fmodstudioL.js` / `.wasm` 要和 Studio 版本兼容。
