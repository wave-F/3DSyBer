# 英文角色配音

## 当前状态

**2026-10-20 按修订台词全量重录：57 条 Eleven v4 音频，take `chris-revised-20261020`，仅在 `chenn` 分支制作。** 包含当前 54 条有声对白、2 条回放引导、1 条结局撞击痛呼；终端 `...` 和回放后的文字提示保持无声。Free 素材仍限内部非商用，来源与限制保存在 `Fmod/voice-en-manifest.json`。表演、年龄听感及姓名发音仍须人工试听，不能把自动检查当作用户已听审。后续商用必须在付费计划下重新生成。

总时长约 3 分 18 秒。配音测试、内容转写、生产构建及真实 Chrome/FMOD 播放检查见 `Fmod/voice-en-review.json`。56 条语言对白中 55 条归一化转写一致；`clueDReason_01` 的陆世承／承岳仍有姓名转写差异，需要人工试听确认。真实浏览器播放通过，但仍有既存 NULL critical-section 警告，未在本轮隐藏或修复。`test:audio` 另有 4 个已有失败（3 个测试缺 `../gltf.js` mock，加载界面测试调用已不存在的 `showTitle`），本轮不修改这些无关模块。

**保持现有响度**：每条新 WAV 对照 `recast-20261015` 已发布的实际 WAV 测量并匹配，最大偏差 **0.14 LU**；全部真峰值不高于 **-2.09 dBTP**。不是只设置名义上的 -18 LUFS。保留 `bus:/DIALOGUE` 的 **+3 dB** 以及全部子总线、事件、instrument 的现有增益和效果链；Mixer/Group/Snapshot 元数据与制作前逐字节一致。匹配结果和参考 WAV 的 SHA-256 随每句写入 manifest，原始 API 音频、旧 take 和剪辑前素材均保留。

离线生成后通过 FMOD Event 播放，不在游戏内请求云接口，不用浏览器朗读。原有中文字幕、报告和剧情内容不变；字幕持续时间与 FMOD 结束状态同步。暂停/切后台会暂停声音和句间间隔，跳过会停声并取消旧剧情续接。

- Event：`event:/voice/en/<group>_<两位序号>`，例如 `event:/voice/en/opening_01`。
- Bank：`public/fmod/VoiceEN.bank`，本轮仅发布 57 条；旧事件保留在工程里，但不再打入 VoiceEN。
- 源 WAV：`Fmod/3DSyBer/Assets/voice/en/chris-revised-20261020/`（撞击痛呼使用带 `_edit_` 后缀的单声剪辑）。
- 游戏映射：`src/audio/voiceEvents.js`；试听：`npm run dev` 后打开 `/audio.html`。
- 配音：陈墨 **Chris - Charming, Down-to-Earth**（按 30～40 岁男性表演，有情绪与自然语气词）、派单员 **Sarah**（保持原有冷漠利落的音色、标签及参数）、女 AI **Alice**（加强机械、平直、无情绪的断句）；账号可用 ID 与选角理由见 `Fmod/voice-cast.en.json`。

- `src/audio/dialogue.en.js`：36 个数组组、56 条字幕，其中 54 条有声、2 条静默；另有 3 条 `PERFORMANCE_CUES`。`productionLines()` 返回全部 57 条制作清单，角色与逐句语气标签实际写入 TTS 输入。`CHEN_PERFORMANCES` 只给男主加入克制的 yeah / hm / huh / alright、呼吸及短暂停顿，不改变显示稿和派单员台词。实际表演文本、完整合成输入与音色参数记录在 manifest。
- `dialogueLines()` 检查当前中文原稿的分组、句数和 `source`，不混用旧稿快照；沉默不发送 TTS。
- 游戏运行只按已发布的 `VOICE_LINES.source` 查录音，不按新版制作稿的编号套旧音频。字幕改写后，逐字相同的句子继续用原录音，改过的句子不套旧声音。

## 覆盖与结局同步

当前有声台词已全部重录，包含新增线索独白与两个假结局。`voiceMap.js` 仍要求中文原文一致，防止剧本以后改动时套错录音。

- 回放引导使用显式 `voiceId` 与原文模板双校验。时间码仍显示在双语字幕中，录音说 “Rewind and look again”，不念错误的固定时间。
- `event:/voice/en/fatalImpact_01` 与男主其他对白共用 Chris。`finale.js` 在 `T.hit = 2.3 s` 首次跨帧时触发；原有撞人音效保留。新版素材虽只要求一声，模型仍输出多段；按原有要求只保留第一声 **0–0.780 s**，在第二段 0.993 s 前结束，淡出并重新匹配旧版痛呼响度。`createImpactVoice` 每次结局仅允许触发一次，暂停、重复跨帧、seek 倒带都不会再次喊叫；只有重新播放结局才重置。暂停沿用 Dialogue 机制，seek 和结束会清理句柄。之前的 +3 dB 保持不变。
- 本轮保留全部 57 个同名事件的 GUID；已删台词 `target_01`、`transferred_04` 只退出 Bank，不删除工程对象、GUID 或旧 WAV。其他游戏音效与混音不修改。

`ENGLISH` 与当前 `LINES` 的组名、顺序、句数、原文必须一致，否则制作会停止。`tests/fixtures/voice-source.zh.json` 仅用于证明旧稿会被拒绝，不再作为当前发布素材的真值。

核对命令（只读，不联网；覆盖、指纹和静默均由测试验证）：

```sh
npm run test:voice
```

## 角色与术语

陈墨：Chris，30～40 岁男性，自然、有情绪，不刻意压成老年沙哑声；怀疑逐渐转为愤怒、惊骇与急迫。内心和外部对白共用同一音色，内心更轻、更近但不耳语。派单员：保持 Sarah 约 30 岁女声、冷淡、短促、不耐烦；不添加主角式语气词，stability 0.5 / similarity 0.8 不变。女 AI：Alice，stability 1，机械平直、均匀断句、无呼吸及安慰式语调。三者录干声，现有 radio/device 效果保留，不通过加大总线音量制造情绪或机器感。

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
npm run voice:audition -- --confirm-cost                 # 11 条代表台词，消耗 credits
npm run voice:generate -- --approved-cast --confirm-cost --max-characters 10000
npm run test:voice
```

本次用户已明确要求直接制作的内部草稿流程：

```sh
node scripts/voice.mjs generate --take chris-revised-20261020 --non-commercial --direct-production --confirm-cost --max-characters 8000
node scripts/voice.mjs stage --take chris-revised-20261020 --non-commercial --allow-unreviewed --update-existing --match-published-loudness
# 本轮另剪辑 fatalImpact_01 的 0–0.78 s，并更新 import-fmod.js 的剪辑路径。
# 执行生成的 import-fmod.js；不重跑混音/效果创作脚本。
npm run audio:build
node scripts/voice.mjs publish --take chris-revised-20261020 --non-commercial
npm run build
```

`--direct-production` 仅明确允许内部非商用草稿跳过试听步骤，不代表用户已听过成品。本轮合成输入共 7,578 字符（含标签），有缓存重跑不重复生成。旧的本机 `chris-*` / `expressive-chris-*` 缓存包含旧稿和不同派单员表演，本轮不覆盖、不冒充新稿复用。

默认模型 `eleven_v4`，会先检查账号、额度、模型和全部角色音色是否可用，不自动换演员或降级模型。默认商用流程要求付费账号；只有显式 `--non-commercial` 才允许 Free，授权属性进入指纹和来源记录，不能把免费缓存改标商用。若确需对比 v3，显式用 `--model eleven_v3 --take v3`，不要把不同模型混进同一 take。v4 不发送不存在的 speed/style 控件；语气由逐句英文 audio tags 指导。模型并不能保证每次都按标签正确表演。

所有草稿、原始 API 响应和试听页保存在 `Fmod/voice-work.local/en/<take>/`，被现有 `*.local` 规则忽略。浏览器直接打开其中 `index.html` 可试听原始生成音频；剪辑和 Studio 滤波后的最终效果以游戏或 `/audio.html` 为准。没有真实音频的行标为待生成，不假装可播放。`script.en.md` / `script.en.json` 是全量制作清单。素材不会自动发布到 `public/`。

- 默认只一条一条生成；默认最多 2000 个**新增合成输入字符**，含语气标签。`--max-characters` 是输入量护栏，不是美元费用上限；准确额度扣除以账号与模型账单为准。
- 成功的单句有请求指纹、音色、模型、seed、音频 SHA-256 和真实时长；重跑复用缓存，不重复收费。
- 选角或台词改动用新的 `--take b`，保留旧 take，不覆盖。
- 单句补录：`npm run voice:generate -- --take b --id question2_03 --approved-cast --confirm-cost`。
- 网络断开会留下 `<id>.pending.json` 并阻止盲目重试。先查 ElevenLabs 历史是否已收费/有结果；不要为了续跑直接删掉全部记录。API 响应已保存而本地处理失败时，会从响应恢复，不重调 TTS。

## 验收与 FMOD

正常流程先确认 11 条试听中的三套音色与情绪，再全量制作。逐句检查漏字/加字、姓名读音、意外背景声、情绪和衔接。当前内部草稿保留 `unreviewed-internal-draft`，自动生成成功不代表表演合格。

全部音频听过并通过后（商用默认流程）：

```sh
npm run voice:stage -- --approved-audio
```

内部非商用、尚未人工听审的素材可显式使用 `--non-commercial --allow-unreviewed`，仍保留 `unreviewed-internal-draft` 标签，不伪称用户已试听认可。

这一步**不联网、不启动 Studio、不改现有 Bank**：验证完整 take 和音频指纹，再做双遍 -18 LUFS / -2 dBTP 响度处理。`--match-published-loudness` 额外验证并匹配当前 manifest 对应的真实参考 WAV，偏差须 ≤0.15 LU，不能拿名义目标代替测量。缺少旧 staged.json、原文件或指纹不符就停止，不猜测参考。输出 `Fmod/3DSyBer/Assets/voice/en/<take>/*.wav`（单声道，48 kHz / 24-bit），生成本地 `import-fmod.js`。API 原始素材为 44.1 kHz / 128 kbps MP3；转 WAV 不会补出原本不存在的音质，保留原始文件供后续高质量替换。

默认导入脚本仍为只新增；同名事件已存在就停止。明确重配音时加 `--update-existing`，生成 `Fmod/recast-events.js` 的受限更新脚本：先检查全部时间线必须只有一个 SingleSound，保留 GUID、增益与效果，更新素材、长度和角色路由。复杂手工时间线会停止。执行前保存并备份 Studio 工程。

- 派单员 7 条走 `DIALOGUE/radio`，`Fmod/dispatcher-radio.js`：HP24/400 Hz + LP24/3.4 kHz，中频 1.9 kHz / Q1.1 / +2 dB；压缩 -20 dB、4:1、attack 4 ms、release 90 ms、补偿 +2.5 dB；Distortion 0.05。无持续底噪或混响。
- 女 AI 2 条走 `DIALOGUE/device`，`Fmod/device-ai.js`：HP12/140 Hz + LP12/8.5 kHz、1.7 kHz +2 dB；Flanger 0.13 Hz / 2.2 ms / 24%，Chorus 0.35 Hz / 1.8 ms / 18%；压缩 -22 dB、3:1、8/100 ms、补偿 +1 dB。保留可懂度，不给男主加机器人效果。
- 两个创作脚本仅改对应效果链，重复执行不叠加效果器、不改总线推子。手工调音后日常只执行 `audio:build`，不要重建环境混音。

新 take 导入并在 Studio 保存后，`npm run audio:build` 编译并同步 Bank。再运行 `npm run voice:publish -- --take <take>`（非商用追加 `--non-commercial`），验证素材及指纹、生成映射和来源记录，最后 `npm run build`。本轮剪辑后素材以 `staged.json` 的实际 WAV 路径为准，不要拿剪辑前路径覆盖。

自动验证：`npm run test:voice`、`npm run test:audio`；真实浏览器 / WASM 冒烟测试：`node scripts/verify-voice-browser.mjs`（macOS Chrome，可用 `CHROME_BIN` 指定）。读取真实 Bank 的全部发布时长并与 WAV 比较，验证结束、取消、暂停/恢复，以及派单员、女 AI 和痛呼播放；不调用云接口。

内容转写检查：`node scripts/verify-voice-content.mjs --take chris-revised-20261020 --confirm-cost`，会消耗 ASR 额度；相同音频批次命中缓存不重复请求。检查 56 条语言对白（以包含语气词的实际表演稿为预期），非语言痛呼另做技术检查。转写不是人工听审，姓名拼写差异不能证明发音正确或错误。`scripts/voice-edit.mjs` 支持原始 API 音频绝对时间 `--start` / `--end`，以及 `--match-published-loudness` 保持参考响度，有记录地裁剪并生成新 WAV，不覆盖原始音频；随后更新对应 FMOD instrument，再构建发布。

## 官方资料

- [Eleven v4 与当前控件](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4)
- [带时间对齐的 TTS API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps)
- [账号音色列表](https://elevenlabs.io/docs/api-reference/voices/search)
- [定价与商用许可](https://elevenlabs.io/pricing)
