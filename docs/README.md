# Cyber Bridge

雨夜高架上的第一人称车祸现场调查。`three/webgpu`，桌面浏览器。

**只做电脑网页。** 键鼠、指针锁定、宽屏 HUD。不做手机页面、触控、竖屏或响应式布局。改 UI 和操作时按桌面 Chrome 验收。

```bash
npm install
npm run dev       # http://localhost:5173/
npm run build
```

加载完成后点击任意位置开始，锁定鼠标。开发态有 `window.__cam`、`window.__inv`、`window.__renderer`、`window.__scene`。

无头 Chrome 加 `--disable-gpu` 画不出本场景。

## 读哪份

| 要改什么 | 文档 |
|----------|------|
| 先看整局怎么串 | [systems/README.md](systems/README.md) |
| 加载界面、主视觉、开始 | [systems/loading.md](systems/loading.md) |
| 桥、人、封锁、事故车 | [systems/scene.md](systems/scene.md) |
| 楼和招牌 | [systems/city.md](systems/city.md) |
| 线索、重建、平板 | [systems/investigation.md](systems/investigation.md) |
| 雾、光、后期、雨 | [systems/render.md](systems/render.md) |
| 文件一句职责 | [reference/file-map.md](reference/file-map.md) |
| 声音、FMOD | [audio-fmod.md](audio-fmod.md) |
| 英文角色配音稿、试听制作 | [voice-en.md](voice-en.md) |
| 剧情哪句已定、哪句是占位 | [design/case.md](design/case.md) |
| 新功能该动哪层 | [dev/architecture.md](dev/architecture.md) |

行为以代码为准。`systems/` 只写现网。没接线的想法放 `design/`。空间常量在 `src/bridge.js`，线索文案在 `src/investigation/clues.js`。改了公共行为就改对应专页，不要在文档里抄整张线索表。
