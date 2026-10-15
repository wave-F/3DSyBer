# 英文角色配音

## 当前状态

**当前已生成并接入 65 条英文配音，使用 Eleven v4，合计约 3 分 40 秒。** 用户确认按内部非商用用途使用 Free 额度，素材来源与限制保存在 `Fmod/voice-en-manifest.json`。这是可直接运行的内部初版；已做全量内容转写检查，剪辑修复了一条短句重复，记录见 `Fmod/voice-en-review.json`。三处中文姓名存在 ASR 拼写歧义，表演与发音仍待人工试听。内部传播并不自动授予商用许可，后续用途变化时须重新核验授权。

离线生成后通过 FMOD Event 播放，不在游戏内请求云接口，不用浏览器朗读。原有中文字幕、报告和剧情内容不变；字幕持续时间与 FMOD 结束状态同步。暂停/切后台会暂停声音和句间间隔，跳过会停声并取消旧剧情续接。

- Event：`event:/voice/en/<group>_<两位序号>`，例如 `event:/voice/en/opening_01`。
- Bank：`public/fmod/VoiceEN.bank`（约 1.98 MB），包含全部 65 条。
- 源 WAV：`Fmod/3DSyBer/Assets/voice/en/internal-v1/`。
- 游戏映射：`src/audio/voiceEvents.js`；试听：`npm run dev` 后打开 `/audio.html`。
- 配音：陈墨 Roger、派单员 Matilda、仪器 River；账号可用 ID 与选角理由见 `Fmod/voice-cast.en.json`。

- `src/audio/dialogue.en.js`：新版 36 组、60 条英文对应稿，逐句表演指导、角色方向、读音与 11 条试听，包含两个假结局和新增线索独白。原录音稿为 21 组、71 条，其中 65 条已发布。
- 新版稿尚未补录；`dialogueLines()` 检查当前中文原稿的分组、句数和 `source`，不混用旧稿快照。当前没有备用 `call` 或叙述性静默，也不会恢复它们的游戏触发。
- 游戏运行只按已发布的 `VOICE_LINES.source` 查录音，不按新版制作稿的编号套旧音频。字幕改写后，逐字相同的句子继续用原录音，改过的句子不套旧声音。

## 待补配音（台词已改、配音未跟上）

游戏运行不受影响：`voiceMap.js` 只在 `VOICE_LINES[id].source` 与当前中文原句完全一致时才播声音，其余只显示字幕，不会错配。下面三类在下次补录时一并处理（2026-10 统计，补录前用下方命令重新核对）。

- **没有配音**：线索独白 `clueFront` `clueRail` `clueDebris` `clueScrape` `clueSkidB` `clueTrim` `clueP2car` `clueP3override` `clueP4end` `clueDMode` `clueDReason` `clueDRaw` `clueDRawOpen` `clueRTime`（各 1 句），`ready1_01`、`ready2_01`。
- **中文改过、旧录音不再播放**：`dream1_01-02`、`call2_03`、`cardRead_01`、`dream3_01`、`question3_04`、`after3_01-02`、`keyFound_01-02`、`rootRead_01/02/04`、`dream4_01`、`target_01-03`、`transferred_04-05`。
- **孤立录音（台词已删或句数减少）**：`dream1_03`、`call2_04-07`、`cardRead_02`、`after3_03-05`、`keyFound_03`、`after4_01`。补录后从 FMOD 和 `voiceEvents.js` 清掉。

新版 `ENGLISH` 已与当前 `LINES` 同步：36 组、60 条，包含新增独白，已删掉 `call` 和 `after4`。`dialogueLines()` 仍要求两边分组的**名称和顺序**完全一致、句数一致、`source` 与中文原句一致，否则报错，阻止用旧稿生成。测试已拆开验证：新版稿检查当前中文台词及制作工具链；65 条旧录音按 `Fmod/voice-en-manifest.json` 和 `tests/fixtures/voice-source.zh.json` 验证来源、映射和时长，不再拿新稿与旧稿比较而整套失败。本次合并没有生成、发布或删除任何录音；上述待补清单是历史清单，补录前须按实际 `voiceMap` 结果重新核对（编号移动但原句未改的录音仍可复用）。

核对命令（只读，不联网）：

```sh
node -e "Promise.all([import('./src/investigation/clues.js'),import('./src/audio/voiceEvents.js'),import('./src/i18n.js')]).then(([{LINES},{VOICE_LINES},{RAW}])=>{const n=[],s=[],u=new Set();for(const[g,l]of Object.entries(LINES[RAW])){if(!Array.isArray(l))continue;l.forEach((x,i)=>{const id=g+'_'+String(i+1).padStart(2,'0'),c=VOICE_LINES[id];if(!c)n.push(id);else{u.add(id);if(c.source!==x.text)s.push(id)}})}console.log('无配音',n.join(' '));console.log('已过期',s.join(' '));console.log('孤立',Object.keys(VOICE_LINES).filter(k=>!u.has(k)).join(' '))})"
```

## 角色与术语

中性美式英语。陈墨：成熟、稍沙哑、疲惫克制，怀疑逐渐变成压住恐惧的质问；内心与外部对白共用同一音色，内心更轻、更近。派单员：干练成熟女声，催工单而非威胁玩家。仪器：独立的中性服务声线，始终平静，不提前暴露反派意味。三者都录干声；无线电与设备质感留给 Studio。

正式名称：Chen Mo / Cheng Xu / Lu Shicheng / Meridian / Chengyue / Rootkey / Blackdream / Zero Priority。`B1016` 按 B + 单个数字读。剧情里不再出现 P0，保障一律说 Zero Priority。中文姓名在合成输入中使用英语近似读音，正式英文稿不改拼写；这些读音必须实听验收。

## 本机配置

Node.js 22+（使用内置 `loadEnvFile`）、`ffprobe`；暂存 WAV 时另需 `ffmpeg`。不安装浏览器端 SDK。项目根目录新建被 git 忽略的 `.env.local`：

```dotenv
ELEVENLABS_API_KEY=你的密钥
ELEVENLABS_VOICE_CHEN=选定的陈墨音色ID
ELEVENLABS_VOICE_DISPATCH=选定的派单员音色ID
ELEVENLABS_VOICE_DEVICE=选定的仪器音色ID
```

不要给变量加 `VITE_` 前缀，不要把密钥发进聊天或提交 git。三个音色变量可省略，默认读取已选定的 `Fmod/voice-cast.en.json`。换音色前用 `npm run voice:voices`（可加 `-- --search American`）读取账号可用的标准费率音色。克隆真人声音必须有明确授权。已有 WAV / Bank 的运行与构建不需要 API 密钥。

## 制作

```sh
npm run voice:plan                                      # 无联网、无扣费：英文稿与待生成试听页
npm run voice:voices                                    # 有密钥后，只读列出账号音色
npm run voice:audition -- --confirm-cost                 # 12 条代表台词，消耗 credits
npm run voice:generate -- --approved-cast --confirm-cost --max-characters 10000
npm run test:voice
```

默认模型 `eleven_v4`，会先检查账号、额度、模型和全部角色音色是否可用，不自动换演员或降级模型。默认商用流程要求付费账号；只有显式 `--non-commercial` 才允许 Free，授权属性进入指纹和来源记录，不能把免费缓存改标商用。若确需对比 v3，显式用 `--model eleven_v3 --take v3`，不要把不同模型混进同一 take。v4 不发送不存在的 speed/style 控件；语气由逐句英文 audio tags 指导。模型并不能保证每次都按标签正确表演。

所有草稿、原始 API 响应和试听页保存在 `Fmod/voice-work.local/en/<take>/`，被现有 `*.local` 规则忽略。浏览器直接打开其中 `index.html` 可试听原始生成音频；剪辑和 Studio 滤波后的最终效果以游戏或 `/audio.html` 为准。没有真实音频的行标为待生成，不假装可播放。`script.en.md` / `script.en.json` 是全量制作清单。素材不会自动发布到 `public/`。

- 默认只一条一条生成；默认最多 2000 个**新增合成输入字符**，含语气标签。`--max-characters` 是输入量护栏，不是美元费用上限；准确额度扣除以账号与模型账单为准。
- 成功的单句有请求指纹、音色、模型、seed、音频 SHA-256 和真实时长；重跑复用缓存，不重复收费。
- 选角或台词改动用新的 `--take b`，保留旧 take，不覆盖。
- 单句补录：`npm run voice:generate -- --take b --id question2_03 --approved-cast --confirm-cost`。
- 网络断开会留下 `<id>.pending.json` 并阻止盲目重试。先查 ElevenLabs 历史是否已收费/有结果；不要为了续跑直接删掉全部记录。API 响应已保存而本地处理失败时，会从响应恢复，不重调 TTS。

## 验收与 FMOD

先确认 12 条试听中的三套音色与情绪，再全量制作。逐句检查：没有漏字/加字/读出标签，姓名读音一致，没有多余笑声/喘息/背景声，仪器没有情绪泄露，开场对白能放进镜头时长，整段问答衔接自然。所有生成文件初始标为 `unreviewed`，自动生成成功不代表表演合格。

全部音频听过并通过后（商用默认流程）：

```sh
npm run voice:stage -- --approved-audio
```

内部非商用、尚未人工听审的素材可显式使用 `--non-commercial --allow-unreviewed`，仍保留 `unreviewed-internal-draft` 标签，不伪称用户已试听认可。

这一步**不联网、不启动 Studio、不改现有 Bank**：验证完整 take 和音频指纹，再做双遍 -18 LUFS / -2 dBTP 响度处理，输出 `Fmod/3DSyBer/Assets/voice/en/<take>/*.wav`（单声道，48 kHz / 24-bit），生成本地 `import-fmod.js`。API 原始素材为 44.1 kHz / 128 kbps MP3；转 WAV 不会补出原本不存在的音质，保留原始文件供后续高质量替换。

导入脚本只新增 `event:/voice/en/<id>`、`VoiceEN` Bank 和 `DIALOGUE/{spoken,inner,radio,device}` 路由；若同名配音事件已存在会停止，不重建旧事件、不改现有增益、Snapshot 或环境声。执行前先保存 Studio 当前工作。`Fmod/voice-mix.js` 仅首次创作新路由：内心 -2 dB、仪器 -1 dB，仪器 HP12/100 Hz + LP12/10 kHz；新增 `vca:/Dialogue`。接线员的 8 条台词统一走 `bus:/DIALOGUE/radio`，已通过 `Fmod/dispatcher-radio.js` 增强广播效果：HP24/400 Hz + LP24/3.4 kHz，中频 1.9 kHz / Q1.1 / +2 dB；压缩阈值 -20 dB、4:1、attack 4 ms、release 90 ms、补偿 +2.5 dB；Distortion 0.05 轻饱和。没有持续底噪或混响，不改变总线推子、源 WAV 或其他角色。手工调音后不要重跑创作脚本，只执行 `audio:build`。不要用 `audio:events` / `audio:mix` 重建现有混音。

新 take 导入并在 Studio 保存后，`npm run audio:build` 会编译并同步包括 VoiceEN 在内的 Bank。然后运行 `npm run voice:publish -- --take <take>`（非商用追加 `--non-commercial`），验证完整素材及指纹并生成映射和来源记录；最后 `npm run build`。更新已存在的配音事件需要在 Studio 手工替换对应素材，不重复新增。

自动验证：`npm run test:voice`、`npm run test:audio`；真实浏览器 / WASM 冒烟测试：`node scripts/verify-voice-browser.mjs`（默认使用 macOS Chrome，可用 `CHROME_BIN` 指定路径）。该测试读取真实 Bank 的全部 65 个时长，并验证播放结束、取消、暂停与恢复；不会调用云接口或消耗额度。

内容转写检查：`node scripts/verify-voice-content.mjs --take internal-v1 --confirm-cost`，会消耗 ASR 额度；同一批音频有缓存时不重复请求。单句可用 `--id opening_02`。转写不是人工听审，也不能据 ASR 的姓名拼写认定发音一定有错。`scripts/voice-edit.mjs` 可有记录地裁剪意外重复的尾句，生成新 WAV 文件名，不覆盖原始音频；更新对应 Studio instrument 后再构建和发布。

## 官方资料

- [Eleven v4 与当前控件](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4)
- [带时间对齐的 TTS API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps)
- [账号音色列表](https://elevenlabs.io/docs/api-reference/voices/search)
- [定价与商用许可](https://elevenlabs.io/pricing)
