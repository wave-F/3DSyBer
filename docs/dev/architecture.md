# 架构

`main.js` 编排。场景模块只搭景。`investigation/` 管案件。没有经济层，也没有 `domain/`。

| 层 | 加功能时 |
|----|----------|
| `src/main.js` | 挂 update。不新开 `requestAnimationFrame` |
| `bridge.js` `player.js` `cordon.js` `crash.js` | 可走空间。新障碍从 `DECK_Y` 这些常量派生 |
| `city.js` `modelBuildings.js` `signs.js` `sky.js` | 不读调查模式 |
| `src/investigation/` | 新交互放这里，不塞进 `main.js` |
| `clues.js` | 文案和节拍 |
| `public/assets/` | 运行时资产，进 git。`art/` 不进 |
| `tools/blender/` | 离线，运行时不 import |

不要做的事：

- 从 Blender 再导一份桥。桥在 `bridge.js`。
- 世界动画改回 TSL `time`。
- 恢复已删的 `src/lightMode.js`。
- 为还没做的系统留空模块。
- 做手机布局或触控。目标是桌面网页。

程序楼和四栋 GLB 并存是当前状态。整段「导出_近景楼」要换掉手写摆放时，先约定再改 `modelBuildings.js` 和 `city.js` 的脚印。封锁和事故点留在代码里。
