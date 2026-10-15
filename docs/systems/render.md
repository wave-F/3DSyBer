# 渲染

低照度是永久设定。`lightMode.js` 已删，没有照明对比键。

`main.js`：`WebGPURenderer`，像素比上限 1.5，ACES，曝光 1.15。`ClusteredLighting(64, 32, 24, 16)`。半球光强度 0.55，月光方向光 0.3。`shanghai_bund_1k.hdr` 只做反射：场景 0.12，平板手部场景 0.35。

雾是远景灰绿雨霾（上限 0.9）加贴地低雾，色值 `sky.js` 的 `FOG_HEX`。

天空两层，都在 `sky.js`：
- 天空盒 `sky_overcast.jpg`：Poly Haven `overcast_soil_puresky`（CC0），白天阴天全景只存上半球，按非 sRGB 读入后在 `backgroundNode` 里压成夜色。原图亮处当被霓虹从下方照亮的紫红云底，暗处是黑云；越近地平线城市光越强，视线高度 0.35 以下过渡到 `FOG_HEX`。横向随 `gameTime` 慢慢转动。固定采第 0 级 mip，否则经度接缝处有竖线。最亮处远低于 bloom 阈值。
- 低空碎云：240 m 高的噪声面片，不透明度上限 0.4，比天空盒飘得快，造前后层次。

MRT 有 `output`、`normal`、`metalrough`、`keep`。`keep = 1` 的像素在分析模式保留原色。

顺序：SSR → 平板虚化并叠 `uiScene` → bloom（强度 0.5，阈值 1.3）→ 分析去饱和 → 调色 → SMAA、色差、暗角、胶片。阈值 1.3 让地面高光不出晕。护栏霓虹 `0x20f0ff` 再乘 0.9，故意留在阈值下。路面金属度在 `bridge.js` 里 `mix(0.15, 0.5)`。近处屏幕点光强度 100。

雨是 `rain.js` 里跟随相机的 6000 根线段。桥和招牌用 `mergeStatic` 按材质合并。

导入楼不要改成实时受光还同时靠顶点色烘焙。无头 `--disable-gpu` 不能验收画面。
