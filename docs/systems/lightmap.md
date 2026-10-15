# 预烘焙光照（GI）

静态物体的漫反射（直接光 + 间接光 + 阴影 + AO）离线用 Cycles 烘好，运行时只采样。桥面、路缘、护栏、龙门架、近景 KB3D 楼、招牌、事故车、程序楼放在**同一个**场景里烘，所以路灯在路面上的光斑、护栏和灯杆的投影、霓虹染在墙上和地上的颜色、车底的遮蔽，彼此都一致。

## 烘焙

```bash
npm run lightmap           # 导出 + 烘焙，全质量大约 25 分钟（M4 GPU）
npm run lightmap export    # 只导出静态场景
npm run lightmap bake      # 只跑 Blender
LM_QUICK=1 npm run lightmap bake   # 低采样、半分辨率试跑，3 分钟左右
```

1. `export`：起一个开发服务器，用无头 Chrome 打开 `bake.html`（`src/lightmap/export.js`）。它和游戏用同一份代码搭出静态场景，写到 `art/bake/`（不进 git）。
2. `bake`：Blender 在后台打开 `art/city.blend`（**不保存**），跑 `tools/blender/scene_bake.py`。KB3D 楼从「KB3D_楼体库」按 `cityLayout.json` 每栋复制一份。产出：
   - `public/assets/lightmap/bridge.exr`、`bldg.exr`：主光照图（半精度 EXR，DWAA 压缩，已经过 OIDN 降噪）
   - `bridge_sc.exr`、`bldg_sc.exr`：通道大屏，离玩家最近的 4 块广告屏各用白光单独烘一遍，存进 RGBA
   - `probes.bin`：封锁区的 L2 球谐探针（6×3×21）
   - `manifest.json`：图集 hash、每栋楼在图集里的位置、通道大屏的轮播参数、探针范围
   - `public/assets/bldg/<楼型>.glb`（带第二套 UV 和亮窗顶点色）、`src/data/buildings.json`

**什么时候要重烘：** 改了 `bridge.js` 的几何体、封锁区、事故车位置、招牌或楼的摆放（`city.blend` → `city_export.py`）、程序楼随机序列、烘焙脚本里的灯光参数。改了桥但没重烘时，控制台会提示 `[lightmap] 「bridge」几何体改过`，桥这部分会自动退回实时光照。

## 光照图 UV

- **代码生成的几何体**：`src/lightmap/charts.js` 按平面和每 10 m 一个 z 格分块，再用货架法装箱。导出页和游戏跑的是同一份代码，所以两边 `uv1` 逐顶点一致，不需要另存 UV。精度由 `bridge.js` 的 `bridgeDensity` 决定：封锁区及外扩 15 m 最高（实际约 18 px/m），越远越粗；朝下的面和被路面盖住的桥面顶只给一点。长条几何体（桥面、路面、路缘、护栏横杆）在代码里沿 z 每 10 m 分一段，方便按位置给精度。
- **KB3D 楼**：Blender 里先智能投影再重新装箱。小于 2 m² 的零件（空调、窗框）和展开后小于 1 m² 的碎块不占光照图，UV 收到最近一块大面的中心，取它所贴墙面的光照。每栋楼在 4096² 的图集里占一块正方形（约 2 px/m），位置写在 manifest 里，运行时通过 `userData.lmRect` 传给着色器。

## 运行时（`src/lightmap/index.js`）

- `applyLightmaps(scene)` 在 `main.js` 里场景搭好以后调用：加载光照图，把登记过的静态网格换成 `BakedLightingModel` 材质。
  - 漫反射 = 底色 × 光照图（单位和 three 的点光一致）。环境图只算高光。
  - `userData.lightmap = 'bake'`（路灯，烘焙时作为光源）和 `'spec'`（大屏补光点光）的灯，在静态表面上只算高光，保留湿路面上的亮斑。
  - 其余实时灯（车头火光、双闪、警灯、结局光束）照常算漫反射。
  - 屏幕空间 AO 在静态表面上减半，只用来补警车、道具这些动态物体的接触阴影。
- 大屏通道：`updateLightmaps(adGlowAt)` 每帧按当前广告颜色给四个通道上色。
- 动态物体（事故车、警车、碎片、道具）：`loadProbes` 把 `probes.bin` 装成 three 的 `LightProbeGrid`，探针外 8 m 渐隐；半球光降到 0.2，只给探针范围外的物体，月光关掉。
- 近景楼的材质在 `modelBuildings.js`，光照取 `buildingIrradiance()`。

开发态调试：`window.__lm.exposure.value` 调整体亮度；`window.__lm.clay.value = 1` 把静态表面换成灰色、去掉高光，只看光照。光源面板里有「烘焙光照图」「光照探针（动态物体）」两个开关。

## 单位

自发光两边相同（three 的颜色值 = Cycles 的发射强度）。点光：Blender 瓦数 = 4π × three 的 candela（实测 1 W、1 m 处的漫反射烘焙值是 1/(4π²)，three 是 I/(π d²)）。天空强度 `SKY`、街面上照光 `GROUND_GLOW`、亮窗比例这些参数都在 `scene_bake.py` 顶部。

## 不要做的事

- 不要给静态表面加吃漫反射的实时灯（会和烘焙重复）。
- 不要把警车放进烘焙：开场时它会开进来。
- 不要手改 `public/assets/lightmap/` 或 `public/assets/bldg/`，它们都是烘焙脚本的产物。
