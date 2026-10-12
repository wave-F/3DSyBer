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
| [investigation.md](investigation.md) | 探索、分析、重建、结案。报告表是占位 |
| [render.md](render.md) | WebGPU 夜景 |
| [../design/case.md](../design/case.md) | 脚本结论已接线，报告字段未定 |

```text
点击开始 → 探索
  走近或 Q 扫到线索 → 按住 E 分析（已完成再按 E 只回看）
  7 条关键线索完成 → R 重建（10 秒，空格暂停，滚轮拖时间，窗口内 E 记录）
  Q 离开重建或进入结案
  Tab 只在探索中打开平板
```

暂停时右上角「测试 · 直接重建」会标完全部线索并进入重建。
