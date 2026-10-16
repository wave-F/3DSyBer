// 英文配音稿，不替换 clues.js 的中文字幕。source 用于阻止中文台词改动后误用旧配音。
// 游戏里播哪段录音不看这里，看已发布的 VOICE_LINES，见 voiceMap.js。
import { LINES } from '../investigation/clues.js';

export const VOICE_ROLES = {
  chen: {
    // 对白偏舞台剧、情绪外放（低 stability 更有起伏）；内心独白沉稳、轻声，用 innerStability 收住。
    name: 'Chen Mo', env: 'ELEVENLABS_VOICE_CHEN', stability: 0.3, innerStability: 0.55, similarity: 0.8,
    acting: 'mature, weathered, theatrical, emotionally rich',
    brief: 'Man around fifty. Neutral American English, weathered low register, tired breath and textured chest resonance. Intimate, emotionally present screen acting: investigative curiosity grows into disbelief, bitter anger, then urgent fear. Never a trailer narrator or superhero. The impact cry is involuntary, raw pain, not a heroic battle shout.',
  },
  dispatch: {
    name: 'Dispatcher', env: 'ELEVENLABS_VOICE_DISPATCH', stability: 0.5, similarity: 0.8,
    acting: 'cold, detached, clipped',
    brief: 'Woman around thirty. Neutral American English. Cold, emotionally distant dispatcher, clipped consonants, impatient procedural authority. No warmth, reassurance or smiling; restrained irritation and finality carry the performance. Record clean and dry; walkie-talkie coloration belongs in FMOD.',
  },
  device: {
    name: 'Investigation device', env: 'ELEVENLABS_VOICE_DEVICE', stability: 1, similarity: 0.85,
    acting: 'robotic, precise, eerily calm',
    brief: 'Distinctly female artificial intelligence. Precise synthetic phrasing, unnervingly composed, faintly condescending corporate politeness and deliberate sentence-final falls. Portal 2 inspires only the synthetic texture and clinical contrast, not an imitation of its character or actor. FMOD adds a subtle doubled, resonant electronic layer. Never a human dispatcher or a harsh unintelligible robot.',
  },
};

// 读音在送入 TTS 前替换，不改变显示稿或剧情中的正式写法。
export const PRONUNCIATIONS = [
  ['B1016', 'B one zero one six'],
  ['Cheng Xu', 'Chung Shyu'],
  ['Lu Shicheng', 'Loo Shih-chung'],
];

export const GLOSSARY = {
  '陈墨': 'Chen Mo', '程叙': 'Cheng Xu', '陆世承': 'Lu Shicheng',
  '经纬': 'Meridian', '承岳': 'Chengyue', '公序': 'Civic Order',
  '根钥': 'Rootkey', '黑梦': 'Blackdream', '零号保障': 'Zero Priority',
};

// perform：只送进 TTS 的表演稿，可加语气词和行内 audio tag（[sighs]、[exhales] 等）；字幕仍用 text。
const line = (source, text, direction, tag, perform) => ({ source, text, direction, tag, ...(perform ? { perform } : {}) });

export const ENGLISH = {
  opening: [
     line('B1016，到场没有？', 'B1016, are you on scene?', 'Cold check-in, a clipped question with no personal interest.', 'cold, questioning'),
    line('到了。', 'I’m here.', 'Short, tired acknowledgement. No enthusiasm.', 'weary, matter-of-fact', '[exhales heavily] Yeah... yeah. I’m here.'),
     line('一场简单事故。核完赶紧交单，北岸还有两件。', 'A simple accident. File it and move. Two more on the north bank.', 'Dismiss the incident. Cut off each instruction; impatient, emotionally uninvolved.', 'cold, impatient, authoritative'),
  ],
  start1: [
    line('先看撞哪儿了。', 'Check the impact first.', 'To himself, after putting the terminal away. Short, ready to work.', 'quiet, matter-of-fact', '[sighs] Alright... check the impact first.'),
  ],
  clueFront: [
    line('车头都压进去了。', 'The whole front end is crushed in.', 'Observe the damage plainly.', 'quiet, focused', 'Hm... the whole front end is crushed in.'),
  ],
  clueRail: [
    line('不是擦过去，是对着护栏冲的。', 'It did not graze the barrier. It went straight at it.', 'Trace the impact path to himself.', 'quiet, focused', 'No... it did not graze the barrier. [short pause] It went straight at it.'),
  ],
  clueDebris: [
    line('这几块都是车头掉的。', 'These pieces all came off the front end.', 'Identify the debris without drama.', 'quiet, matter-of-fact', 'Mm. These pieces... all came off the front end.'),
  ],
  ready1: [
    line('构建黑梦，看看发生了什么。', 'Build Blackdream. See what happened.', 'A quiet decision to himself after the last scene clue. Not a tutorial.', 'quiet, curious', 'Okay. [breathes in] Build Blackdream... let’s see what happened.'),
  ],
  clueScrape: [
    line('黄漆。这辆车可不是黄的。', 'Yellow paint. This car is not yellow.', 'Notice the mismatch; restrained curiosity.', 'quiet, curious'),
  ],
  clueSkidB: [
    line('还有另一辆车的痕迹。', 'There are tracks from another car too.', 'Notice the second set of tracks without jumping to a conclusion.', 'quiet, focused'),
  ],
  clueTrim: [
    line('饰条也是黄的，漆对得上。', 'Yellow trim too. The paint matches.', 'Confirm the connection plainly.', 'quiet, certain'),
  ],
  ready2: [
    line('把黄车加进去，再放一遍。', 'Add the yellow car. Run it again.', 'A practical next step to himself.', 'quiet, resolved'),
  ],
  clueP2car: [
    line('碰撞时产生了新数据。', 'The collision produced new data.', 'Notice the new record without raising his voice.', 'quiet, certain'),
  ],
  clueP3override: [
    line('就在这儿，控制权被夺过去了。', 'Right here. That is when control was taken.', 'Pinpoint the takeover without raising his voice.', 'quiet, focused'),
  ],
  clueP4end: [
    line('这辆车，已经不受控制了。', 'This car is no longer under control.', 'Let the implication settle between the two beats.', 'low, grave'),
  ],
  clueDReason: [
    line('陆世承，承岳的人。', 'Lu Shicheng. Chengyue.', 'Name the person and the group, then stop.', 'quiet, reflective'),
  ],
  clueDRaw: [
    line('程叙是经纬的审计工程师？出事前还在用这个接口。', 'Cheng Xu was an audit engineer at Meridian? He was using this port just before the crash.', 'Register his profession and the recent port access as a concrete lead.', 'quiet, curious'),
  ],
  clueDRawOpen: [
    line('临时给的？', 'A temporary grant?', 'Question the new evidence, not a shocked outburst.', 'quiet, skeptical'),
  ],
  clueRTime: [
    line('早了 0.38 秒。那时候车还没转。', '0.38 seconds early. The car had not turned yet.', 'Read the timing precisely; contained unease.', 'low, troubled'),
  ],
  dream1: [
    line('轮子现在就转向了。', 'The wheel is turning now.', 'Watching the replay. The turn is happening at this moment. Keep it short.', 'quiet, focused', 'Huh? The wheel is turning... now.'),
    line('像是发生了碰撞。', 'Looks like there was a collision.', 'A tentative working theory, not a solution.', 'quiet, curious', 'Looks like... there was a collision.'),
  ],
  after1: [
    line('看看车身，有没有别的碰痕。', 'Check the body for other impact marks.', 'A practical instruction to himself, not a tutorial voice.', 'quiet, resolved'),
  ],
  dream2: [
    line('轮子先动的。', 'The wheel moved first.', 'A small realization. Let first land.', 'quiet, focused'),
    line('那时候黄车还没碰到它。', 'The yellow car had not touched it yet.', 'Questioning the causal chain, not expressing shock.', 'quiet, skeptical'),
  ],
  question2: [
     line('你说刮擦让它转向。可胎痕在刮擦点之前就弯了。', 'You said the scrape made it turn. But the tire marks curve before the contact point.', 'Challenge the lie. Frustration builds; stress BEFORE, then leave a pointed silence.', 'accusing, frustrated, rising', 'You said the scrape made it turn. [scoffs] But the tire marks... they curve BEFORE the contact point!'),
     line('接触可能影响了判断轨迹。', 'Contact may have affected the assessed trajectory.', 'Synthetic corporate reassurance. Deliberate, precise, calmly evasive with an artificial falling cadence.', 'robotic, measured, coolly dismissive'),
     line('可能？', 'May have?', 'A sharp incredulous echo, containing anger rather than an innocent question.', 'incredulous, bitter, clipped', '[bitter laugh] May have?!'),
  ],
  revised2: [],
  call2: [
     line('B1016，逃逸案已经转追查科了。你这单可以结了。', 'B1016, the hit-and-run is with Pursuit. You can close this.', 'Cold administrative pressure. This is a dismissal, not permission or reassurance.', 'cold, impatient, final'),
    line('再给我十分钟。', 'Give me ten more minutes.', 'A firm, economical request. No pleading.', 'low, firm'),
    line('右门翘着，应该撬得开，查看下检修接口。', 'The right door is bent out. Should pry open. Check the service port.', 'Work through the next action to himself; stay conversational.', 'quiet, resolved'),
  ],
  cardRead: [
     line('不是他手动操作，是被强制转向了。', 'It was not a manual input. The wheel was forced.', 'A sickening realization. Breath catches before FORCED; disbelief hardens into anger.', 'shaken, angry, grave'),
  ],
  dream3: [
    line('零号保障...有钱人的护身符。', 'Zero Priority... a talisman for the rich.', 'Understated, bitter irony. No relief or theatrical sarcasm.', 'quiet, bitter'),
  ],
  question3: [
    line('原始记录为什么锁着？', 'Why are the raw records locked?', 'Question the lock itself, not a theory he already knows.', 'questioning, controlled'),
     line('我要看接口日志。', 'I want to see the port log.', 'Firm demand with rising frustration. No pleading; he refuses to be brushed off.', 'insistent, angry, clipped'),
     line('当前权限不足。', 'Current permissions are insufficient.', 'An immaculate synthetic denial. Faint superior politeness; absolute finality, no human apology.', 'robotic, cold, final'),
  ],
  revised3: [],
  after3: [
    line('我的权限不够，程叙的呢？', 'My clearance is not enough. What about Cheng Xu’s?', 'Recall the audit engineer’s credential as a possibility, not a guaranteed solution.', 'quiet, thoughtful'),
    line('事故前2分钟还在使用，去车里找找根钥。', 'It was still in use two minutes before the crash. Look in the car for the root key.', 'A practical next step to himself.', 'quiet, resolved'),
  ],
  keyFound: [
    line('程叙的根钥。按规定应该上交。', 'Cheng Xu’s root key. Procedure says turn it in.', 'An old rule he already knows he will break.', 'quiet, dry'),
    line('先借用一下。', 'I’ll borrow it.', 'A trace of wry humor; no chuckle or comic punchline.', 'understated, wry'),
  ],
  rootRead: [
     line('为什么临时添加了零号保障？', 'Why was Zero Priority added temporarily?', 'The anger is now personal. Demand the hidden reason, rough breath, hold back from shouting.', 'angry, demanding, tense'),
     { ...line('...', '...', 'The terminal does not answer. Leave the silence.', 'silent'), silent: true },
  ],
  dream4: [
    line('这时候才添加了零号保障。', 'That is when Zero Priority was added.', 'Pinpoint the moment; firm but not shouted.', 'quiet, certain'),
  ],
  dream4b: [
    line('他想取消变道。系统没让。', 'He tried to cancel the lane change. The system refused.', 'Recognize that the apparent perpetrator was also being controlled.', 'quiet, grave'),
  ],
  target: [
     line('就因为他查看了原始记录？', 'Just because he looked at the raw records?', 'Horrified accusation. A man has been killed for looking; let the human cost break through.', 'horrified, accusing, breathless'),
     line('得把这些带回去。', 'I need to take this back.', 'Urgent resolve with fear underneath. A quick breath, then the decision to move.', 'tense, urgent, determined'),
  ],
  transferred: [
     line('收到。特权争议转审查科，经纬和承岳那边会有人对接。', 'Received. Privilege dispute goes to Review. Jingwei and Chengyue will send someone.', 'Cold bureaucratic handoff; names are just another case number.', 'cold, businesslike'),
     line('B1016，这单你可以结了。', 'B1016, you can close this.', 'Curt, final dismissal. No relief or friendliness.', 'cold, clipped, final'),
    line('知道了。', 'Understood.', 'Resigned, not satisfied. The doubt has not disappeared.', 'weary, subdued'),
    line('特权会有人去吵。', 'Someone will argue about the privilege.', 'Rationalizing his decision to leave.', 'quiet, resigned'),
    line('至于零号保障是什么时候生效的——', 'As for when Zero Priority took effect —', 'An unfinished thought he chooses not to pursue.', 'quiet, trailing off'),
    line('那不是我的单子了。', 'That is no longer my file.', 'Self-dismissal, not a triumphant closing line.', 'quiet, resigned'),
  ],
  archived: [
     line('收到。肇事车辆转追查科。', 'Received. The other vehicle goes to Pursuit.', 'Flat procedural confirmation, no concern for the victim.', 'cold, businesslike'),
     line('B1016，北岸还有两件，路上别耽误。', 'B1016, two more on the north bank. Don’t linger.', 'Impatient instruction. Stress DONT LINGER with restrained irritation.', 'cold, impatient, clipped'),
    line('知道了。', 'Understood.', 'Dismissing a doubt to get through the shift.', 'weary, subdued'),
    line('黄车会有人去追。', 'Someone will chase the yellow car.', 'A practical excuse to stop looking.', 'quiet, resigned'),
    line('至于它为什么先转了方向——', 'Why it turned first —', 'Leave the contradiction hanging.', 'quiet, trailing off'),
    line('那不是我的单子了。', 'That is no longer my file.', 'Self-dismissal, not a triumphant closing line.', 'quiet, resigned'),
  ],
};

export const AUDITION_IDS = [
  'opening_01', 'opening_02', 'opening_03',
  'question2_01', 'question2_02', 'question2_03',
  'cardRead_01', 'dream3_01', 'keyFound_02', 'question3_03', 'target_02',
];

// 动态时间仍显示在字幕里；录音只说可复用的引导，不把任意时间码念错。
export const PERFORMANCE_CUES = [
  { ...line('等等，前轮。', 'Wait. The front wheel.', 'A sudden discovery interrupts his thought. Alert, intrigued.', 'alert, surprised'), id: 'dreamGuide_01', group: 'dreamGuide', index: 0, speaker: 'chen', channel: 'inner' },
  { ...line('倒回 {time}，再看一遍。', 'Rewind and look again.', 'Quiet urgency; he needs to verify what he just saw.', 'focused, urgent'), id: 'dreamGuide_02', group: 'dreamGuide', index: 1, speaker: 'chen', channel: 'inner' },
  { ...line('[撞击痛呼]', 'Aah! Ugh...', 'Immediate involuntary cry as a car strikes him, followed by a short collapsing, winded groan. Raw shock and agony, no spoken words, no battle cry, no theatrical prolonged screaming.', 'screams in pain, agonized, winded'), id: 'fatalImpact_01', group: 'fatalImpact', index: 0, speaker: 'chen', channel: 'spoken', nonverbal: true },
];

export const productionLines = (options) => [...dialogueLines(options), ...PERFORMANCE_CUES];

// script 默认是游戏里当前的中文台词；台词改过而配音稿没跟上时会报错，防止用旧稿生成。
// 测试用录音时的中文快照（tests/fixtures/voice-source.zh.json）检查工具链本身。
export function dialogueLines({ includeReserve = false, includeSilent = false, script = LINES } = {}) {
  const live = Object.fromEntries(Object.entries(script).filter(([, v]) => Array.isArray(v)));   // 动态引导另由 PERFORMANCE_CUES 配音
  if (Object.keys(live).join('|') !== Object.keys(ENGLISH).join('|')) throw new Error('English dialogue groups no longer match LINES. Review the localization.');
  return Object.entries(live).flatMap(([group, originals]) => {
    const translations = ENGLISH[group];
    if (translations.length !== originals.length) throw new Error(`English line count changed: ${group}`);
    return originals.map((original, index) => {
      const english = translations[index];
      const id = `${group}_${String(index + 1).padStart(2, '0')}`;
      if (english.source !== original.text) throw new Error(`Stale English voice script: ${id}. Review the changed source before generating.`);
      const speaker = original.who === '派单员' ? 'dispatch' : original.who === '仪器' || original.who === '终端' ? 'device' : 'chen';
      const channel = !original.who ? 'inner' : speaker === 'dispatch' ? 'radio' : speaker === 'device' ? 'device' : 'spoken';
      return { ...english, id, group, index, speaker, channel, reserve: group === 'call' };
    });
  }).filter((l) => (includeReserve || !l.reserve) && (includeSilent || !l.silent));
}

export function spokenText(text) {
  return PRONUNCIATIONS.reduce((result, [word, pronunciation]) => result.replaceAll(word, pronunciation), text);
}

export function synthesisText(l) {
  if (l.silent) throw new Error(`Do not synthesize narrative silence: ${l.id}`);
  // 内心独白：沉稳、贴耳、音量明显低于对白，不带舞台腔。
  const inner = l.channel === 'inner' ? '[inner monologue, calm, soft, low] ' : '';
  const acting = l.channel === 'inner' && l.speaker === 'chen' ? 'weathered, restrained' : VOICE_ROLES[l.speaker].acting;
  return `[${acting}] ${inner}[${l.tag}] ${spokenText(l.perform ?? l.text)}`;
}
