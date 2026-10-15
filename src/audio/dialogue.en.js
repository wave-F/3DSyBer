// 英文配音稿，不替换 clues.js 的中文字幕。source 用于阻止中文台词改动后误用旧配音。
// 游戏里播哪段录音不看这里，看已发布的 VOICE_LINES，见 voiceMap.js。
import { LINES } from '../investigation/clues.js';

export const VOICE_ROLES = {
  chen: {
    name: 'Chen Mo', env: 'ELEVENLABS_VOICE_CHEN', stability: 0.5, similarity: 0.8,
    brief: 'Male, late thirties to mid-forties. Neutral American English. Grounded mid-low register, lightly rough, lived-in and tired. Understated screen acting, never a trailer narrator, superhero growl or slurred drunk. Curiosity sharpens into controlled accusation; fear stays contained.',
  },
  dispatch: {
    name: 'Dispatcher', env: 'ELEVENLABS_VOICE_DISPATCH', stability: 0.5, similarity: 0.8,
    brief: 'Mature female voice, neutral American English. Brisk, practical and overworked. A familiar shift dispatcher chasing deadlines, not a military commander or a villain. Impatience is ordinary, not threatening. Record clean and dry; radio coloration belongs in FMOD.',
  },
  device: {
    name: 'Investigation device', env: 'ELEVENLABS_VOICE_DEVICE', stability: 1, similarity: 0.85,
    brief: 'Clean, neutral service voice in American English, distinct from the dispatcher. Precise, even and professionally courteous. No sinister undertone, taunting, panic, metallic robot performance or dramatic emotional arc. The same calm delivery persists as the evidence becomes disturbing.',
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
    line('B1016，到场没有？', 'B1016, are you on scene?', 'Routine check-in. Brisk and familiar, not an emergency.', 'businesslike'),
    line('到了。', 'I’m here.', 'Short, tired acknowledgement. No enthusiasm.', 'weary, matter-of-fact'),
    line('一场单车事故。核完赶紧交单，北岸还有两件。', 'A single-car crash. File it and move. Two more on the north bank.', 'Move straight to the next job; light deadline pressure, not anger.', 'brisk, businesslike'),
  ],
  start1: [
    line('先看撞哪儿了。', 'Check the impact first.', 'To himself, after putting the terminal away. Short, ready to work.', 'quiet, matter-of-fact'),
  ],
  clueFront: [
    line('车头都压进去了。', 'The whole front end is crushed in.', 'Observe the damage plainly.', 'quiet, focused'),
  ],
  clueRail: [
    line('不是擦过去，是对着护栏冲的。', 'It did not graze the barrier. It went straight at it.', 'Trace the impact path to himself.', 'quiet, focused'),
  ],
  clueDebris: [
    line('这几块都是车头掉的。', 'These pieces all came off the front end.', 'Identify the debris without drama.', 'quiet, matter-of-fact'),
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
    line('饰条也是黄的，漆对得上。', 'Yellow trim too. The paint matches.', 'Confirm the connection plainly.', 'quiet, certain'),
  ],
  ready2: [
    line('把黄车加进去，再放一遍。', 'Add the yellow car. Run it again.', 'A practical next step to himself.', 'quiet, resolved'),
  ],
  clueP2car: [
    line('交换过数据。怎么只能看摘要？', 'They exchanged data. Why can I only see the summary?', 'Curiosity catches on the access limit.', 'quiet, questioning'),
  ],
  clueP3override: [
    line('就在这儿，方向被接过去了。', 'Right here. That is when it took over the steering.', 'Pinpoint the takeover without raising his voice.', 'quiet, focused'),
  ],
  clueP4end: [
    line('两辆车，都归它开。', 'Both cars. It was driving both.', 'Let the implication settle between the two beats.', 'low, grave'),
  ],
  clueDMode: [
    line('一直是自动驾驶。初判里的手动操作哪儿来的？', 'Automatic the whole time. Where did the report get manual driving from?', 'Evidence contradicts the report; controlled skepticism.', 'quiet, skeptical'),
  ],
  clueDReason: [
    line('陆世承，承岳的人。零号保障……保的是他。', 'Lu Shicheng. Chengyue. Zero Priority... so he is the one it protects.', 'Connect the name to the protection, not a political speech.', 'quiet, reflective'),
  ],
  clueDRaw: [
    line('程叙是经纬的审计工程师？出事前还在用这个接口。', 'Cheng Xu was an audit engineer at Meridian? He was using this port just before the crash.', 'Register his profession and the recent port access as a concrete lead.', 'quiet, curious'),
  ],
  clueDRawOpen: [
    line('临时给的？他都没申请。', 'A temporary grant? He never even applied.', 'Question the new evidence, not a shocked outburst.', 'quiet, skeptical'),
  ],
  clueRTime: [
    line('早了 0.38 秒。那时候车还没转。', '0.38 seconds early. The car had not turned yet.', 'Read the timing precisely; contained unease.', 'low, troubled'),
  ],
  dream1: [
    line('还没撞护栏，轮子就转了。', 'The wheel turned before it hit the barrier.', 'The contradiction is becoming clear. Stress before, not barrier.', 'thoughtful, skeptical'),
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
    line('你说刮擦让它转向。可胎痕在刮擦点之前就弯了。', 'You said the scrape made it turn. But the tire marks curve before the contact point.', 'Point out the timing contradiction calmly.', 'questioning, controlled'),
    line('接触可能影响了后续轨迹。', 'Contact may have affected the subsequent trajectory.', 'Same neutral service voice; do not emphasize the retreat in certainty.', 'measured, neutral'),
    line('可能？', 'May have?', 'Catch the changed certainty. Short and restrained.', 'skeptical, clipped'),
  ],
  revised2: [],
  call2: [
    line('B1016，逃逸案已经转追查科了。你这单可以结了。', 'B1016, the hit-and-run is with Pursuit. You can close this.', 'Trying to clear the queue, with ordinary workplace impatience.', 'brisk, businesslike'),
    line('再给我十分钟。', 'Give me ten more minutes.', 'A firm, economical request. No pleading.', 'low, firm'),
    line('右门翘着，应该撬得开。检修接口在转向柱下面。', 'The right door is bent out. Should be able to pry it open. Service port is under the steering column.', 'Work through the next action to himself; stay conversational.', 'quiet, resolved'),
  ],
  cardRead: [
    line('不是他打错了方向。是系统不让他把车开直。', 'He did not miss the wheel. The system would not let him hold it straight.', 'The accusation emerges from the evidence; restrained, not theatrical.', 'low, grave'),
  ],
  dream3: [
    line('他倒是安全了。', 'At least he is safe.', 'Understated, bitter irony. No relief or theatrical sarcasm.', 'quiet, bitter'),
  ],
  question3: [
    line('原始记录还锁着，你怎么知道这条道从一开始就有？', 'The raw records are still locked. How do you know that lane was there from the start?', 'Question the evidence behind the reconstruction, not a theory he already knows.', 'questioning, controlled'),
    line('回放依据现有摘要生成。', 'The reconstruction is based on the available summary.', 'A smooth procedural answer. Do not emphasize the evasion.', 'measured, neutral'),
    line('我要看零号保障的生效时间。', 'I want to see when Zero Priority took effect.', 'Ask for the underlying record without raising his voice.', 'firm, clipped'),
    line('当前权限不足。', 'Current permissions are insufficient.', 'A routine permissions notice, neither apologetic nor threatening.', 'measured, neutral'),
  ],
  revised3: [],
  after3: [
    line('我的权限不够，程叙的呢？', 'My clearance is not enough. What about Cheng Xu’s?', 'Recall the audit engineer’s credential as a possibility, not a guaranteed solution.', 'quiet, thoughtful'),
    line('去车里找找。', 'Check inside the car.', 'A practical next step to himself.', 'quiet, resolved'),
  ],
  keyFound: [
    line('程叙的根钥。按规定应该上交。', 'Cheng Xu’s root key. Procedure says turn it in.', 'An old rule he already knows he will break.', 'quiet, dry'),
    line('先借用一下。', 'I’ll borrow it.', 'A trace of wry humor; no chuckle or comic punchline.', 'understated, wry'),
  ],
  rootRead: [
    line('为什么提前写好初判？', 'Why was the preliminary written early?', 'A direct, controlled challenge. Do not shout.', 'low, questioning'),
    line('风险预测与报告预生成属于城市应急流程。', 'Risk prediction and pre-written reports are city emergency procedure.', 'The same reassuring service cadence as every earlier answer.', 'measured, neutral'),
    line('可他根本没切手动。报告里为什么写他切了？', 'But he never switched to manual. Why does the report say he did?', 'Disbelief hardens into accusation; no screaming or melodrama.', 'controlled anger, incredulous'),
  ],
  dream4: [
    line('停。这时候才有让行道。', 'Stop. That is when the yield lane appears.', 'Pinpoint the moment; firm but not shouted.', 'quiet, certain'),
  ],
  dream4b: [
    line('他想取消变道。系统没让。', 'He tried to cancel the lane change. The system refused.', 'Recognize that the apparent perpetrator was also being controlled.', 'quiet, grave'),
  ],
  target: [
    line('就因为他能查原始记录？', 'Just because he could check the raw records?', 'Spoken to the terminal. A contained, accusatory question.', 'low, questioning'),
    line('得把这些带回去。', 'I need to take this back.', 'A decision, already moving. No panic.', 'low, urgent'),
  ],
  transferred: [
    line('收到。特权争议转审查科，经纬和承岳那边会有人对接。', 'Received. Privilege dispute goes to Review. Jingwei and Chengyue will send someone.', 'Normal administrative handoff. Do not hint at a conspiracy.', 'businesslike'),
    line('B1016，这单你可以结了。', 'B1016, you can close this.', 'Relieved to clear a job from the queue.', 'brisk, matter-of-fact'),
    line('知道了。', 'Understood.', 'Resigned, not satisfied. The doubt has not disappeared.', 'weary, subdued'),
    line('特权会有人去吵。', 'Someone will argue about the privilege.', 'Rationalizing his decision to leave.', 'quiet, resigned'),
    line('至于那条让行道是什么时候铺上的——', 'When that yield lane was laid down —', 'An unfinished thought he chooses not to pursue.', 'quiet, trailing off'),
    line('那不是我的单子了。', 'That is no longer my file.', 'Self-dismissal, not a triumphant closing line.', 'quiet, resigned'),
  ],
  archived: [
    line('收到。肇事车辆转追查科。', 'Received. The other vehicle goes to Pursuit.', 'Routine confirmation. No sinister undertone.', 'businesslike'),
    line('B1016，北岸还有两件，路上别耽误。', 'B1016, two more on the north bank. Don’t linger.', 'Return immediately to the work queue.', 'brisk, businesslike'),
    line('知道了。', 'Understood.', 'Dismissing a doubt to get through the shift.', 'weary, subdued'),
    line('黄车会有人去追。', 'Someone will chase the yellow car.', 'A practical excuse to stop looking.', 'quiet, resigned'),
    line('至于它为什么先转了方向——', 'Why it turned first —', 'Leave the contradiction hanging.', 'quiet, trailing off'),
    line('那不是我的单子了。', 'That is no longer my file.', 'Self-dismissal, not a triumphant closing line.', 'quiet, resigned'),
  ],
};

export const AUDITION_IDS = [
  'opening_01', 'opening_02', 'opening_03',
  'question2_01', 'question2_02', 'question2_03',
  'cardRead_01', 'dream3_01', 'keyFound_02', 'rootRead_03', 'target_02',
];

// script 默认是游戏里当前的中文台词；台词改过而配音稿没跟上时会报错，防止用旧稿生成。
// 测试用录音时的中文快照（tests/fixtures/voice-source.zh.json）检查工具链本身。
export function dialogueLines({ includeReserve = false, includeSilent = false, script = LINES } = {}) {
  const live = Object.fromEntries(Object.entries(script).filter(([, v]) => Array.isArray(v)));   // dreamGuide 等函数型台词不配音
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
  const inner = l.channel === 'inner' ? '[quiet, close, internal monologue] ' : '';
  return `${inner}[${l.tag}] ${spokenText(l.text)}`;
}
