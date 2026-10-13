# 3DSyBer · FMOD 音频工作台

## 打开

- **FMOD Studio 工程**：`Fmod/3DSyBer/3DSyBer.fspro`
- **独立试听页**：运行 `npm run dev`，访问终端地址的 `/audio.html`。
- **测试 Event**：`event:/test/ping`，位于 `Preview` Bank。

工程由 FMOD Studio **2.03.14** 新建，含完整 Metadata 和原创测试 WAV，可直接在 Studio 中编辑。测试音是 0.65 秒、660 / 990 Hz 双音电子 Ping（48 kHz / 16-bit / mono）。

游戏入口没有导入音频模块，也不会加载 Bank 或发声。试听页仅使用本工程新导出的 `Master.bank`、`Master.strings.bank`、`Preview.bank`；旧 SFX / Ambience Bank 已移除。`fmodstudioL.js` 与 `.wasm` 是参考工程提供的 FMOD 通用运行库，不含声音内容。

## 日常制作流程

1. 在 Studio 打开 `Fmod/3DSyBer/3DSyBer.fspro`。
2. 创建 / 编辑 Event，导入素材并分配到 Bank，然后保存。
3. 在 `src/audio/events.js` 登记预览事件（路径、名称、描述、Bank）；新增 Bank 时也更新 `BANKS` 数组。
4. 执行 `npm run audio:build`：使用本机 FMOD Studio 构建 Desktop Bank，并同步到 `public/fmod/`。
5. 刷新 `/audio.html`，点击「启用音频」或事件的「播放」。

本页支持主音量、停止全部、后台停止试听和加载错误提示。默认不自动播放，也不依赖游戏场景。

> CLI 构建读取磁盘内容，请先在 Studio 保存修改。FMOD Studio 升级时，浏览器 JS / WASM 也应保持版本兼容。

## 命令

```sh
npm run audio:create-test  # 生成测试 WAV 并创建测试 Event；已有素材和 Event 不覆盖
npm run audio:build        # 构建并同步 Bank
npm run dev               # 开发服务器，打开 /audio.html
npm run build             # 同时构建游戏和试听页，产物 dist/audio.html
npm run preview           # 预览生产构建
```

默认使用 macOS `/Applications/FMOD Studio.app/Contents/MacOS/fmodstudio`。可用 `FMOD_STUDIO_BIN` 环境变量指定其他安装位置。脚本使用 FMOD 官方脚本 API 与命令行模式，无需在 Studio 中启用 TCP 脚本服务。

## 目录

```text
Fmod/
  3DSyBer/
    3DSyBer.fspro       Studio 工程入口
    Metadata/          Event / Bank / Mixer 等源配置，纳入版本控制
    Assets/test/       原创 ping.wav，纳入版本控制
    Build/Desktop/     Studio 导出目录，忽略版本控制
  create-test-event.js  幂等测试事件创建脚本
scripts/
  generate-test-tone.mjs
  fmod.mjs             构建及 Bank 同步
public/fmod/           网页运行库与当前工程 Bank
src/audio/events.js    试听清单
src/audio/fmodRuntime.js
src/audio-bench.js
src/audio-bench.css
audio.html
```

`.cache`、`.user`、`.unsaved` 与 `Build` 都是本地工作文件，不提交。`public/fmod/*.bank` 是网页发布资源，纳入版本控制。整个目录可移动；Studio 使用默认的项目相对 `Build` 目录，脚本没有硬编码工程绝对路径。

## 检查

- 首次打开不自动发声；点击播放应听见一个短双音 Ping。
- 停止全部 / 切后台应停止当前事件；调音量后重新播放可比较响度。
- Network 中仅出现本工程的三个 Bank，无 CozyTavern 音效或 Bank。
- 游戏 `/` 页面不应请求 FMOD 运行库或 Bank。
