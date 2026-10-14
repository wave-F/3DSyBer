# 系统地图

桌面浏览器一局。没有手机操作。

```text
index.html → src/main.js
  buildBridge / buildCity / buildCrash / buildSky / buildRain / buildCordon
  createPlayer
  createInvestigation(scene, camera, crash, controls)

每帧：tick → updatePlayer(dt * inv.moveScale) → 雨 / 天 / 封锁 → inv.update
后期：SSR → 平板虚化 → bloom → 分析去饱和 → 调色 → SMAA / 色差 / 暗角 / 胶片
```

循环只在 `main.js`。世界动画用 `clock.gameTime`，这样重建时能停。景色模块不改调查状态。

| 文档 | 现网 |
|------|------|
| [scene.md](scene.md) | 桥、封锁、玩家、事故车 |
| [city.md](city.md) | 程序楼 + 四栋 GLB。整段 Blender 街区还没导 |
| [investigation.md](investigation.md) | 四轮复核：取证、黑梦、报告、结局 |
| [render.md](render.md) | WebGPU 夜景 |
| [../design/case.md](../design/case.md) | 四份复核报告、对象索引与结局 |

```text
点击开始 → 派单字幕 → 探索
  走近或 Q 扫到线索 → 按住 E 分析（已完成再按 E 只回看）
  本轮关键线索完成 → 按住 R 黑梦（镜头转向 A 车起点后开始播放）（空格暂停，滚轮拖时间，窗口内 E 记录，按住 E 分析全息）
  节点记满 → 平板举起看复核报告
  第 1 轮：按住 E 确认归档 → 双闪打断 → 特写过场 → 第 2 轮
  Tab 只在探索中打开平板
```

暂停时右上角「测试 · 直接进黑梦」会标完本轮线索并进入黑梦。
