// 英文配音稿，不替换 clues.js 的中文字幕。source 用于阻止中文台词改动后误用旧配音。
// 游戏里播哪段录音不看这里，看已发布的 VOICE_LINES，见 voiceMap.js。
import { LINES } from '../investigation/clues.js';

export const VOICE_ROLES = {
  chen: {
    name: 'Chen Mo', env: 'ELEVENLABS_VOICE_CHEN', stability: 0.3, similarity: 0.8,
    acting: 'natural, emotionally engaged, conversational',
    brief: 'Chris, man aged thirty to forty. Natural American English with a grounded adult register, not artificially aged or gravelly. Intimate screen acting: curiosity grows into unease, disbelief, restrained anger and urgent fear. Brief hm, yeah, oh and breaths support specific discoveries without turning every line into a sigh. Inner thoughts stay close and audible, not whispered. Never a trailer narrator. One short involuntary impact cry, no second groan.',
  },
  dispatch: {
    name: 'Dispatcher', env: 'ELEVENLABS_VOICE_DISPATCH', stability: 0.5, similarity: 0.8,
    acting: 'cold, detached, clipped',
    brief: 'Woman around thirty. Neutral American English. Cold, emotionally distant dispatcher, clipped consonants, impatient procedural authority. No warmth, reassurance or smiling; restrained irritation and finality carry the performance. Record clean and dry; walkie-talkie coloration belongs in FMOD.',
  },
  device: {
    name: 'URSA', env: 'ELEVENLABS_VOICE_DEVICE', stability: 1, similarity: 0.85,
    acting: 'robotic, monotone, mechanical, emotionless',
    brief: 'Female machine intelligence, not a reassuring human. Level pitch, evenly timed words, discrete phrase boundaries and abrupt sentence endings. No breaths, hesitation, interjections, sympathy or conversational warmth. Preserve clear diction and intelligibility. Electronic texture is isolated to the FMOD device bus; never imitate a specific character or actor.',
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

const line = (source, text, direction, tag) => ({ source, text, direction, tag });

export const ENGLISH = {
  opening: [
     line('B1016，到场没有？', 'B1016, are you on scene?', 'Cold check-in, a clipped question with no personal interest.', 'cold, questioning'),
    line('到了。', 'I’m here.', 'Short, tired acknowledgement. No enthusiasm.', 'weary, matter-of-fact'),
     line('一场简单的事故。审核完赶紧交单，北岸还有两件。', 'A simple accident. Finish the review and file it. Two more on the north bank.', 'Dismiss the incident. Cut off each instruction; impatient, emotionally uninvolved.', 'cold, impatient, authoritative'),
  ],
  start1: [
    line('先看看撞哪儿了。', 'Let’s see where it hit first.', 'To himself, after putting the terminal away. Short, ready to work.', 'quiet, matter-of-fact'),
  ],
  // 倒回完成后的字幕。还没有录音，不送去合成。
  afterRewind: [
    { ...line('过去看看有什么新线索', 'Go over and see if there is a new lead.', 'After the rewind stops on the anomaly. A short nudge to walk over and look.', 'quiet, focused'), silent: true },
  ],
  clueFront: [
    line('车头都压进去了。', 'The whole front end is crushed in.', 'Observe the damage plainly.', 'quiet, focused'),
  ],
  clueRail: [
    line('不是擦过去，是对着护栏撞过去的。', 'It didn’t scrape past. It crashed straight into the rail.', 'Trace the impact path to himself.', 'quiet, focused'),
  ],
  clueDebris: [
    line('这几块都是车头掉下来的。', 'These pieces all came off the front end.', 'Identify the debris without drama.', 'quiet, matter-of-fact'),
  ],
  ready1: [
    line('构建黑梦，看看发生了什么。', 'Build Blackdream. See what happened.', 'A quiet decision to himself after the last scene clue. Not a tutorial.', 'quiet, curious'),
  ],
  clueScrape: [
    line('黄漆。这辆车可不是黄的。', 'Yellow paint. This car is not yellow.', 'Notice the mismatch; restrained curiosity.', 'quiet, curious'),
  ],
  clueSkidB: [
    line('还有另一辆车的痕迹。', 'There are tracks from another car too.', 'Notice the second set of tracks without jumping to a conclusion.', 'quiet, focused'),
  ],
  clueTrim: [
    line('装饰条也是黄的，颜色对得上。', 'The trim is yellow too. The color matches.', 'Confirm the connection plainly.', 'quiet, certain'),
  ],
  ready2: [
    line('把黄车加进去，再构建一次。', 'Add the yellow car. Rebuild it again.', 'A practical next step to himself.', 'quiet, resolved'),
  ],
  clueP2car: [
    line('碰撞时产生了新数据。', 'The collision produced new data.', 'Notice the new record without raising his voice.', 'quiet, certain'),
  ],
  clueP3override: [
    line('就是在这儿，控制权被夺过去了。', 'This is exactly where control was taken away.', 'Pinpoint the takeover without raising his voice.', 'quiet, focused'),
  ],
  clueP4end: [
    line('这辆车，已经不受控制了。', 'This car is no longer under control.', 'Let the implication settle between the two beats.', 'low, grave'),
  ],
  clueDReason: [
    line('陆世承，承岳集团的继承人。', 'Lu Shicheng. The heir to the Chengyue Group.', 'Name the person and identify him as the group’s heir, then stop.', 'quiet, reflective'),
  ],
  clueDRaw: [
    line('程叙是经纬的工程师？', 'Cheng Xu was an engineer at Meridian?', 'Register his employer and profession as a concrete lead.', 'quiet, curious'),
  ],
  clueDRawOpen: [
    line('临时添加的？', 'Added temporarily?', 'Question the new evidence, not a shocked outburst.', 'quiet, skeptical'),
  ],
  clueRTime: [
    line('早了 0.38 秒。那时候车还没有发生碰撞。', '0.38 seconds early. The collision hadn’t happened yet.', 'Read the time difference precisely, then note that the collision had not happened; contained unease.', 'low, troubled'),
  ],
  dream1: [
    line('轮子现在就转向了。', 'The wheel is turning now.', 'Watching the replay. The turn is happening at this moment. Keep it short.', 'quiet, focused'),
    line('像是发生了碰撞。', 'Looks like there was a collision.', 'A tentative working theory, not a solution.', 'quiet, curious'),
  ],
  after1: [
    line('看看车身，有没有别的碰痕。', 'Check the body for other impact marks.', 'A practical instruction to himself, not a tutorial voice.', 'quiet, resolved'),
  ],
  dream2: [
    line('轮子先动的。', 'The wheel moved first.', 'A small realization. Let first land.', 'quiet, focused'),
    line('那时候黄车还没碰到它。', 'The yellow car had not touched it yet.', 'Questioning the causal chain, not expressing shock.', 'quiet, skeptical'),
  ],
  question2: [
     line('你说碰撞让它转向。可胎痕在碰撞点之前就弯了。', 'You said the collision made it turn. But the tire marks curve before the collision point.', 'Challenge the lie. Frustration builds; stress BEFORE, then leave a pointed silence.', 'accusing, frustrated, controlled'),
      line('接触可能影响了判断轨迹。', 'Contact may have affected the assessed trajectory.', 'Machine-generated assessment. Flat pitch, evenly separated phrases, no breath or reassuring human inflection; an impersonal, evasive conclusion.', 'robotic, monotone, evenly paced'),
     line('可能？', 'May have?', 'A sharp incredulous echo, containing anger rather than an innocent question.', 'incredulous, bitter, clipped'),
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
      line('当前权限不足。', 'Current permissions are insufficient.', 'An automated access-denied response. Discrete, evenly timed words, flat pitch and an abrupt final stop. No apology or human emotion.', 'robotic, monotone, cold, final'),
  ],
  revised3: [],
  after3: [
    line('如果我的权限不够，那程叙的呢？', 'If my clearance isn’t enough, what about Cheng Xu’s?', 'Recall the engineer’s credential as a possibility, not a guaranteed solution.', 'quiet, thoughtful'),
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
    line('他想取消变道。系统拒绝了。', 'He tried to cancel the lane change. The system refused.', 'Recognize that the apparent perpetrator was also being controlled.', 'quiet, grave'),
  ],
  target: [
      line('得把这些带回去。', 'I need to take this back.', 'Urgent resolve with fear underneath. A quick breath, then the decision to move.', 'tense, urgent, determined'),
  ],
  transferred: [
     line('收到。特权争议转审查科，经纬集团那边会有人对接。', 'Received. The privilege dispute goes to Review. The Meridian Group will send someone.', 'Cold bureaucratic handoff; the group is just another administrative contact.', 'cold, businesslike'),
     line('B1016，这单你可以结了。', 'B1016, you can close this.', 'Curt, final dismissal. No relief or friendliness.', 'cold, clipped, final'),
    line('知道了。', 'Understood.', 'Resigned, not satisfied. The doubt has not disappeared.', 'weary, subdued'),
    line('零号保障是什么时候生效的？ 这里还有疑点', 'When did Zero Priority take effect? There are still questions here.', 'Recognize that the timing remains unresolved, even as he prepares to leave.', 'quiet, doubtful'),
    line('但那不是我的单子了。', 'But that is no longer my file.', 'Self-dismissal despite the remaining doubts, not a triumphant closing line.', 'quiet, resigned'),
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
  { ...line('[撞击痛呼]', 'Aah!', 'One short involuntary cry as a car strikes him. Raw shock and pain, then stop. No second cry, trailing groan, spoken words or heroic battle shout.', 'screams in pain, shocked'), id: 'fatalImpact_01', group: 'fatalImpact', index: 0, speaker: 'chen', channel: 'spoken', nonverbal: true },
];

// 仅制作时使用：语气词与呼吸不改写中英文显示稿，也不影响派单员。
export const CHEN_PERFORMANCES = {
  opening_02: '[exhales] Yeah. I’m here.',
  start1_01: 'Alright... let’s see where it hit first.',
  clueFront_01: 'Hm. The whole front end is crushed in.',
  clueRail_01: 'No... it didn’t scrape past. It crashed straight into the rail.',
  ready1_01: 'Okay. Build Blackdream... see what happened.',
  clueScrape_01: 'Huh... yellow paint. This car is not yellow.',
  clueSkidB_01: 'Wait... there are tracks from another car too.',
  clueTrim_01: 'Yeah. The trim is yellow too. The color matches.',
  ready2_01: 'Alright. Add the yellow car. Rebuild it again.',
  clueP3override_01: 'There... this is exactly where control was taken away.',
  clueP4end_01: '[breathes in] This car... is no longer under control.',
  clueDRaw_01: 'Huh. Cheng Xu was an engineer at Meridian?',
  clueDRawOpen_01: 'Hm... added temporarily?',
  clueRTime_01: 'Wait. Zero point three eight seconds early. The collision hadn’t happened yet.',
  dream2_01: 'Wait... the wheel moved first.',
  dream2_02: 'But... the yellow car had not touched it yet.',
  question2_01: 'You said the collision made it turn. [short pause] But the tire marks curve before the collision point.',
  question2_03: 'May have? [scoffs]',
  call2_02: '[breathes in] Give me ten more minutes.',
  call2_03: 'Okay... the right door is bent out. Should pry open. Check the service port.',
  cardRead_01: 'No... it was not a manual input. [short pause] The wheel was forced.',
  dream3_01: '[exhales] Zero Priority... a talisman for the rich.',
  question3_02: 'I want to see the port log.',
  after3_01: 'Hm. If my clearance isn’t enough... what about Cheng Xu’s?',
  keyFound_01: 'Cheng Xu’s root key. [short pause] Procedure says turn it in.',
  keyFound_02: 'Well... I’ll borrow it.',
  rootRead_01: '[breathes in] Why was Zero Priority added temporarily?',
  dream4b_01: 'Oh... he tried to cancel the lane change. The system refused.',
  target_02: '[breathes in] I need to take this back.',
  transferred_03: '[exhales] Yeah. Understood.',
  transferred_05: 'But... when did Zero Priority take effect? There are still questions here.',
  transferred_06: '[sighs] But that is no longer my file.',
  archived_03: '[exhales] Yeah. Understood.',
  archived_05: 'But... why it turned first —',
  archived_06: '[sighs] That is no longer my file.',
};

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
      // 删句后保留幸存台词的原配音 ID，不能让下一句占用已删除台词的编号。
      const id = original.voiceId ?? `${group}_${String(index + 1).padStart(2, '0')}`;
      if (english.source !== original.text) throw new Error(`Stale English voice script: ${id}. Review the changed source before generating.`);
      const speaker = original.who === '派单员' ? 'dispatch' : original.who === 'URSA' || original.who === '仪器' || original.who === '终端' ? 'device' : 'chen';
      const channel = !original.who ? 'inner' : speaker === 'dispatch' ? 'radio' : speaker === 'device' ? 'device' : 'spoken';
      return { ...english, ...(speaker === 'chen' && CHEN_PERFORMANCES[id] ? { perform: CHEN_PERFORMANCES[id] } : {}), id, group, index, speaker, channel, reserve: group === 'call' };
    });
  }).filter((l) => (includeReserve || !l.reserve) && (includeSilent || !l.silent));
}

export function spokenText(text) {
  return PRONUNCIATIONS.reduce((result, [word, pronunciation]) => result.replaceAll(word, pronunciation), text);
}

export function synthesisText(l) {
  if (l.silent) throw new Error(`Do not synthesize narrative silence: ${l.id}`);
  const inner = l.channel === 'inner' ? '[quiet, close, internal monologue] ' : '';
  return `[${VOICE_ROLES[l.speaker].acting}] ${inner}[${l.tag}] ${spokenText(l.perform || l.text)}`;
}
