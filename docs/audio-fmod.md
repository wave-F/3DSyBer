# 3DSyBer · FMOD 音频

目标是写实：雨夜高架上的环境、角色的 Foley、克制的 UI 音，以及只给扫描 / 分析用的高科技音色。

59 条英文角色配音已按当前剧本全量重录，通过 `event:/voice/en/...` 接入，包含结局撞击痛呼；独立 `VoiceEN` Bank 与 `DIALOGUE` 路由。当前素材按用户确认的内部非商用用途生成，来源与授权限制见 `Fmod/voice-en-manifest.json`，详细流程见 [voice-en.md](voice-en.md)。原有双语字幕与其他手工音效混音保留。

## 流水线

下图为首次制作流程；手工调音后的日常同步只运行 `audio:build`，不要重复执行素材、事件或混音生成。

```text
Freesound (CC0)  →  Fmod/source/*.mp3 + credits.json        npm run audio:fetch
   ↓ 剪辑 / 分层 / EQ / 回声 / 淡变 / 标准化（DAW 式 EDL）    npm run audio:design
Fmod/3DSyBer/Assets/{amb,foley,ui,scifi}/*.wav
   ↓ FMOD Studio 脚本建 Event / 总线 / Bank                    npm run audio:events
   ↓ 在手工 amb 事件上搭 3D / 子总线 / Snapshot / VCA          npm run audio:mix
   ↓ 第二批素材（Assets/26–48）建事件 / 总线 / Snapshot          npm run audio:scene
   ↓ 场景基础混响 CityVerb + 各 3D 事件的距离 Send               npm run audio:reverb
Fmod/3DSyBer/3DSyBer.fspro
   ↓ 构建 Desktop Bank 并同步                                  npm run audio:build
public/fmod/Main.bank …  →  src/audio/sound.js 在游戏里触发
```

- `Fmod/city-reverb.js`（`npm run audio:reverb`）：场景基础混响，见下文「场景混响」。同样只补缺失对象，已有的 Send、曲线、效果器参数不改。
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
- VCA：`Ambience`（AMB）、`SFX`（FOLEY + SCIFI + WORLD + CABIN + CityVerb）、`UI`、`Dialogue`（DIALOGUE）、`Music`（MUSIC）。游戏不覆盖 VCA 音量；试听页首次启用读取当前值，只有手动拖动推子才改变该页的播放增益，不回写 Studio。
- 多变体事件（脚步、衣物）用 Multi Instrument 随机播放，并加音高 / 音量随机器。
- 接线员对讲机：7 条派单员台词走 `DIALOGUE/radio`，窄带 400–3400 Hz、中频存在感、4:1 压缩与轻饱和。女 AI 的 2 条对白走 `DIALOGUE/device`，独立 EQ、Flanger/Chorus 轻微倍音与压缩。全部在 Studio 处理，不烘焙源 WAV、不影响男主；参数见 [voice-en.md](voice-en.md)。

## 场景混响 CityVerb

目的：单声道 3D 点声源只有定位时像「贴」在场景上，加一层共享的街谷混响，让它们融进雨夜高架两侧的楼群并带出距离感。黑梦的 `Reverb` 是另一套，不受影响。

- 做法依据 FMOD 官方论坛员工的建议：不在每个事件里挂混响，而是在事件主轨加 Send 到共享 Return，按距离自动化 Send；城市街道用 50–200 ms、几乎无反馈的拍击延迟加短混响，加大 early / late delay，湿声低通。混响参数参考 FMOD 内置 City / Alley 预设（1.5 s，HighCut 4–8 kHz）。
- `bus:/CityVerb`（Return → Master，归 `vca:/SFX`），效果链：
  - Delay 120 ms、反馈 10 %、湿 -8 dB：两侧第一排楼面离桥中心约 19–25 m，往返 40–50 m，即楼面拍击回声。
  - SFX Reverb：1.6 s、Early 30 ms、Late 50 ms、HF Decay 50 %、Diffusion 70 %、Low Gain -6 dB @ 250 Hz、High Cut 4.5 kHz、Early/Late 60 %、湿 -8 dB、干 -80 dB。
  - Multiband EQ：A 高通 150 Hz；B 500 Hz 削 3 dB（减少对直达声的掩蔽）；C 低通平时全开，给 Snapshot 用。
- Send：每个 3D 事件主轨在 Fader 之后、Spatializer 之前加一路 Send，所以送进去的量不随距离衰减；电平按内置参数 `Distance (Normalized)`（0 为事件最小距离，1 为最大距离，全工程共用一个参数预设）自动化。直达声随距离衰减，混响场基本不变，越远越「湿」，到最大距离淡出：

  | 归一化距离 | 0 | 0.15 | 0.5 | 0.85 | 1 |
  |---|---|---|---|---|---|
  | 车辆 / 撞击 / 门 / 撬门 / 广告牌（dB） | -10 | -8 | -6 | -9 | -40 |
  | `amb/Amb_1..6`（本身是连续纹理） | -16 | -14 | -12 | -15 | -46 |
  | `scifi/id_scan_loop`（手里的设备） | -18 | -16 | -14 | -17 | -48 |

  浏览器实测刹车（5–90 m）：6 m 处混响峰值约 -30 dB（直达声约 -2 dB），60 m 处约 -28 dB（直达声约 -24 dB，干湿接近），超出最大距离后约 -61 dB。整体太湿或太干先推 `CityVerb` 推子，再改曲线。
- 事件 Send 直接进 Return、不经过 AMB / WORLD 总线，所以 Snapshot 单独处理返回：`CarInterior` / `Pause` / `Radar` 把返回 EQ 的低通 C 降到 700 / 600 / 900 Hz；`Dream` 把 CityVerb -10 dB、低通 1.1 kHz；`Tablet` 把 CityVerb -5 dB。
- 2D 声音（雨 / 车流铺底、脚步、衣物、UI、配音）不送 CityVerb。

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
| `vehicle/hit_rail` | 黑梦里 A 车撞断护栏：每轮黑梦第一次正向播放经过撞击时刻（`recon.js` 的 `IMPACT_T`）时响一次，按峰值（0.224 s）提前触发；滚轮拖动、倒放和之后重播都不响。事件里自带一路送黑梦 `Reverb` 的 Send（Spatializer 之前，-12 dB），Studio 里单独试听也带黑梦空间；黑梦 Snapshot 打开的 WORLD 总线发送照常叠加 |
| `vehicle/hit_body` | 结局被撞：按峰值提前 0.167 s 触发，峰值落在撞击帧 |
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
| `ui/typewrite_loop` | 平板上有文字正在打出时循环（`tablet.typing`）：报告逐字打出、线索详情逐行出现、接入画面日志逐字打出、结局终端自动写报告；开机扫描线期间和暂停时不响。3D 跟着平板（`tablet.screenWorld`，结局时在地上） |
| `scifi/id_scan_loop` | 平板接入画面（第 3 轮插卡读取、第 4 轮根钥接入、对象索引）播放期间循环；插卡时 3D 在检修接口，其余在平板位置 |
| `foley/pry_insert` / `pry_open` | 撬棍捅进门缝 / 卡扣崩开（峰值对准 `PRY_POP`），3D 在车门门尾（1–25 m），取代原来 WebAudio 合成的金属声 |
| `scifi/analyze_loop` | 按住 E 分析期间循环，音高随进度从 0.85 升到 1.4 |
| `scifi/analyze_complete` / `analyze_cancel` | 分析完成 / 中途松开或移开准星 |
| `scifi/dream_enter` / `dream_exit` | 进入 / 离开黑梦 |

`src/audio/sound.js` 是游戏侧入口，在主循环里 `update`。3D 单发用 `sound.play(name, { position })`，跟着物体走的声源用 `sound.follow(name, position)`（每帧传位置，`null` 停止），2D 循环用 `sound.loop(name, on)`。撞击类素材的峰值时刻记在 `events.js` 的 `PEAK`，换素材后要同步改。FMOD 没就绪或出错时，所有调用都是空操作，只在控制台警告，不影响游戏。切到后台时静音。

### 预加载与防卡顿

当前使用官方 **FMOD 2.03.14 单线程日志版** `fmodstudioL.js` / `fmodstudioL.wasm`，这样没有跨源隔离响应头的网站也能出声。混音在主线程：画面卡顿时声音可能重复一小段，控制台会有 `NULL critical section`。同版本 pthread 文件 `fmodstudioPL.js` / `.wasm` 仍留在 `public/fmod/`，网站加上隔离头后可以把 `fmodRuntime.js` 的脚本改回去。Studio 使用 `STUDIO_INIT_SYNCHRONOUS_UPDATE`。仍应避免在转场时做主线程重活：

- **网页一打开**（`sound.preload()`，`main.js` 第一时间调用）：下载全部 Bank（`BOOT_BANKS` 即 Master / Frontend 高优先级），WASM 和 `BOOT_BANKS` 一到就初始化 FMOD（不需要用户手势，浏览器音频输出先挂起），菜单音乐预备好；其余 Bank 每个单独一个任务依次装入，再等全部采样数据解码完（`fmod.loaded` / `fmod.complete`）。
- **预备循环**：全部事件描述先查好缓存；雨 / 车流铺底、城市点声源、21 个雨打楼体、开场车内外行驶声先以暂停状态创建。仅 `start + setPaused(true)` **不会打开流**，`Bank.loadSampleData()` 也不包含流式素材。`streamsLoaded()` 会先静音底层 ChannelGroup，再短暂运行，轮询真实 Channel 的 `Sound.getOpenState` / 缺数据状态；就绪后重新暂停并还原静音，失败 / 超时也还原。不改事件增益、Studio 混音或素材，不重置时间线（重置会关闭已开的流）。虚拟声源无需真实 Channel。之后 `startLoop` / `moveLoop` 只取消暂停。
- **加载界面等声音**：`loading.waitFor(sound.preload(), '声音')`，声音全部就绪才进入画面预热、出现「点击开始」。声音失败或超过 30 秒也放行，不卡住游戏。
- **第一次点击 / 按键**：`unlock` 只在手势里恢复音频输出，不播菜单音乐。加载会卡，音乐会跟着断。**点击开始**：`start` 停掉已预备的菜单音乐、播进入音效、取消暂停环境循环。
- **画面侧**：转场第一帧现场编译材质同样会卡住主线程。加载界面期间 `main.js` 的 `warmTransitions` 轮流把镜头摆到开场跟车起点 / 终点（`intro.warm`），并把结局跑车放到视线与桥面的交点（`finale.warm`），让这些物体在加载时就编译好。实测开场第一帧（原 214 ms）和结局开始（原 157 ms）都已没有 50 ms 以上的长任务；进出黑梦、切车内本来就没有。以后新增「第一次才出现」的物体，也要加进预热。
- **空临界区报警根因**：旧的无线程 `fmodstudioL` 在不加载任何 Bank 的最小 Studio 场景中，10 次 `update` 就产生 60 条 `NULL critical section`；仅 Core 不产生。改为同版本官方 pthread 日志版后，同样测试及真实 Bank / 29 个循环预热均不再产生该报警。保留原生全部日志，没有 `console` 拦截或降低 `Debug_Initialize` 等级；不是用非日志版隐藏问题。SDK 文件直接来自官方 HTML5 包 `api/studio/lib/wasm/`，JS / WASM 必须配套替换，不能改二进制或混用 L / PL。

### 部署要求（pthread / SharedArrayBuffer）

必须通过 HTTPS（本地可用 localhost）访问，并在 HTML、SDK JS / Worker 和 WASM 响应上配置：

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

这两个头只是 pthread 版才需要。当前单线程版不依赖它们。Vite 开发和 `npm run preview` 仍配置了这两个头，`public/_headers` 也会进 `dist/`，给以后改回 `fmodstudioPL` 用。

回归：`npm run test:audio`，以及 `node scripts/verify-voice-browser.mjs`（真实 Chrome，原生日志全开；验证流式预热、主线程阻塞、配音播放 / 暂停 / 取消及零空锁 / 加载延迟报警）。

角色动作统一使用 `sound.step()`（FootStep + ClothFoley）和 `sound.cloth()`（仅 ClothFoley）；新动作也走这两个入口。Foley 事件路径大小写与 Studio 完全一致，均为单次事件，不启动循环；素材、随机音高和混音由 Studio 保持控制。手工修改后保存工程并执行 `npm run audio:build` 同步浏览器 Bank。

`main.js` 每帧先以真实帧时长更新玩家（移动倍率单独传入，黑梦减速也保持实际速度），再把同一份 `updatePlayer.gait` 经调查状态传给 `viewmodel.js` 渲染。不要在设备里再建独立的走路计时器，也不要重新按步长定时播放脚步；设备隐藏时步相仍正常工作。静止呼吸、视角弹簧和分析动作不触发脚步。

## 试听

`npm run dev` 后打开 `/audio.html`，可以单独试听全部事件（清单在 `src/audio/events.js`），也可以显式推 VCA、开关 Snapshot；默认不写入音量，启用音频后才可拖动推子。循环事件会一直播，点「停止全部」停止。

## 素材出处

现有环境 / Foley / UI / scifi 来源为 Freesound 上的 CC0 素材，ID、标题和链接见 `Fmod/source/credits.json`。下载的是 Freesound 的 HQ 预览（128 kbps mp3），不是原始文件。原始 WAV 要登录下载；以后需要更高音质，用同名文件替换后重跑 `audio:design`。新制作的 ElevenLabs 配音不属于这份 CC0 清单，商用与音色授权须单独核验。

`Assets/` 根目录的 26–49 号 WAV（49 为打字循环；28 / 29 / 34 / 35 已用 `Out/2` 的重做版同名覆盖）（菜单音乐、车辆、UI、雷达、广告牌、撬门、水脚步）是在 Reaper 里制作的成品，导出目录 `/Volumes/Data/Reaper/CyberBridge/Out/1`、`Out/2`。替换时保持文件名不变，覆盖后在 Studio 里刷新素材、运行 `audio:build`；撞击类素材的峰值变了要同步改 `events.js` 的 `PEAK`。**运行任何 `audio:*` 脚本前先关闭 FMOD Studio**，脚本直接改磁盘上的工程，Studio 开着时保存会用内存里的旧状态覆盖。

## 命令

```sh
npm run audio:fetch    # 按 credits.json 下载原始素材
npm run audio:design   # 渲染编辑后的 WAV
npm run audio:events   # 重新创作事件（默认阻止，须显式 FMOD_ALLOW_REAUTHOR=1）
npm run audio:mix      # 重建混音（默认阻止，须显式 FMOD_ALLOW_REAUTHOR=1）
npm run audio:scene    # 第二批音效 / Snapshot：只补缺失对象，不覆盖手工调音
npm run audio:reverb   # 场景混响 CityVerb 与 3D 事件距离 Send：只补缺失对象
npm run audio:build    # 构建 Bank 并同步到 public/fmod/
npm run test:audio     # Foley / scifi 触发与音量保护回归测试（无需浏览器 / 声卡）
```

默认使用 `/Applications/FMOD Studio.app/Contents/MacOS/fmodstudio`（2.03.14），可以用 `FMOD_STUDIO_BIN` 指定其他路径。浏览器端的 `fmodstudioPL.js` / `.wasm` 要和 Studio 版本兼容。
