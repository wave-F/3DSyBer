# 文件职责

行为见 [`../systems/`](../systems/)。这里只写每个文件做什么。

## 入口

| 路径 | 职责 |
|------|------|
| `index.html` | 启动壳、点击开始层、准星 |
| `src/main.js` | 唯一编排：WebGPU、雾、灯光、后期、每帧更新 |
| `package.json` | `dev` / `build` / `preview` |

## 场景

| 路径 | 职责 |
|------|------|
| `src/bridge.js` | 桥面、护栏、路面、`DECK_Y` / `HALF_W` / 撞断区间 |
| `src/cordon.js` | 龙门与全息封锁，导出玩家 z 限制 |
| `src/player.js` | 指针锁定、WASD、护栏与封锁夹紧、事故车碰撞 |
| `src/crash.js` | 事故超跑、脱落轮、`CAR_POS`、碰撞盒 |
| `src/rain.js` | 跟随相机的雨线 |
| `src/sky.js` | 雾色、远景巨楼、全息广告、飞行器光点 |
| `src/city.js` | 程序化街区与近处屏幕点光 |
| `src/buildings.js` | 程序楼样式套件 |
| `src/modelBuildings.js` | 四栋 GLB 摆放、脚印、招牌霓虹覆盖 |
| `src/data/buildings.json` | 导入楼描述 |
| `src/signs.js` | 霓虹字与广告牌套件 |
| `src/textures.js` | 程序贴图与磁盘贴图加载 |
| `src/merge.js` | 按材质合并静态网格 |

## 调查

| 路径 | 职责 |
|------|------|
| `src/investigation/state.js` | 模式机、输入、标记、调试「直接重建」 |
| `src/investigation/clues.js` | 9 条线索、5 个重建事件、报告字段、结论文案 |
| `src/investigation/ui.js` | HUD、线索卡、时间轴、结论层 |
| `src/investigation/recon.js` | 重建回放与全息车 |
| `src/investigation/tablet.js` | 平板 UI 场景与结案盖章 |
| `src/investigation/viewmodel.js` | 第一人称手与袖 |
| `src/investigation/analysisFx.js` | 按住分析的扫描表现 |
| `src/investigation/props.js` | 现场道具（胎痕、血迹等） |
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
