# 文件职责

行为见 [`../systems/`](../systems/)。这里只写每个文件做什么。

## 入口

| 路径 | 职责 |
|------|------|
| `index.html` | 启动壳、加载界面（`#loading`）、Esc 暂停层、准星 |
| `src/loading.js` | 加载进度、画面预热、点击开始和黑场淡出 |
| `src/main.js` | 唯一编排：WebGPU、接雾、灯光、后期、每帧更新 |
| `package.json` | `dev` / `build` / `preview` |

## 场景

| 路径 | 职责 |
|------|------|
| `src/bridge.js` | 桥面、护栏、路面、`DECK_Y` / `HALF_W` / 撞断区间 |
| `src/cordon.js` | 龙门与全息封锁，导出玩家 z 限制 |
| `src/player.js` | 指针锁定、WASD、护栏与封锁夹紧、事故车碰撞 |
| `src/crash.js` | 事故超跑、脱落轮、`CAR_POS`、碰撞盒 |
| `src/rain.js` | 跟随相机的雨线，导出风向 `WIND` |
| `src/smoke.js` | GPU 粒子：车头浓烟与火星、桥面风雾、桥下蒸汽（独立场景，`main.js` 半分辨率叠回） |
| `src/fog.js` | 雾色与全部雾参数、距离雾、自发光随距离变暗、体积雾后期、开发态调雾面板 |
| `src/sky.js` | 夜空天空盒（`public/assets/sky_overcast.jpg`）与低空碎云、远景巨楼、全息广告、飞行器光点 |
| `src/city.js` | 程序化街区与近处屏幕点光 |
| `src/buildings.js` | 程序楼样式套件 |
| `src/modelBuildings.js` | 近景 GLB 楼摆放、脚印、招牌摆放；墙面光照取光照图 `bldg` 图集 |
| `src/lightmap/` | 预烘焙光照：`charts.js` 光照图 UV 分块装箱，`index.js` 加载光照图、静态材质替换、探针，`export.js` 烘焙导出页（`bake.html`） |
| `scripts/lightmap.mjs` | `npm run lightmap`：导出静态场景 → Blender 烘焙 |
| `tools/blender/scene_bake.py` | 统一场景 Cycles 烘焙：光照图、通道大屏、探针、近景楼 GLB |
| `public/assets/lightmap/` | 烘焙产物（`manifest.json`、`*.exr`、`probes.bin`） |
| `src/data/buildings.json` | 导入楼描述 |
| `src/signs.js` | 霓虹字与广告牌套件 |
| `src/textures.js` | 程序贴图与磁盘贴图加载 |
| `src/merge.js` | 按材质合并静态网格 |

## 调查

| 路径 | 职责 |
|------|------|
| `src/investigation/state.js` | 轮次与模式机、输入、标记、确认打断、撬门 / 插卡 / 拿根钥镜头 |
| `src/investigation/clues.js` | 线索、黑梦全息分析、四轮回放、报告、台词 |
| `src/investigation/ui.js` | HUD、线索卡、时间轴、字幕、跳过提示、黑边 |
| `src/investigation/recon.js` | 黑梦回放、全息车与人，按轮次切换出场物体 |
| `src/investigation/tablet.js` | 平板 UI：线索、报告与确认归档、接入画面 |
| `src/investigation/finale.js` | 结局：陈墨被撞、终端自动写报告并归档、黑屏 |
| `src/investigation/viewmodel.js` | 第一人称手与袖 |
| `src/investigation/pryArm.js` | 第 3 轮撬门的手和撬棍（`public/assets/pry-arm.glb`，Blender 做的动画 + 撬门机位）；源脚本 `tools/blender/build_pry_anim.py`、`export_pry_anim.py` |
| `src/investigation/analysisFx.js` | 按住分析的扫描表现 |
| `src/investigation/props.js` | 第 2 轮道具（第二道胎痕、车门残漆贴花） |
| `src/investigation/actors.js` | 重建人形 |
| `src/investigation/hologram.js` | 全息材质与外壳遮罩 |
| `src/investigation/mask.js` | 把材质标进 MRT `keep` |
| `src/investigation/clock.js` | `gameTime` / `uiTime` / 暂停 |

## 资产与 Blender

| 路径 | 职责 |
|------|------|
| `public/assets/` | 进 git 的模型、贴图、线索图、HDR |
| `public/draco/` | Draco 解码器 |
| `tools/blender/build_city.py` | 从 KB3D 源 blend 搭 `art/city.blend` |
| `tools/blender/kb3d_prep.py` · `kb3d_bake.py` | 楼体准备与光照烘焙 |
| `art/` | 本地 blend 与贴图，gitignore |

## 表现管线锚点

后期、SSR、辉光、SMAA、胶片颗粒都在 `src/main.js`，没有单独的 render 目录。
