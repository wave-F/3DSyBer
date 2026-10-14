// 英文配音稿，不替换 clues.js 的中文字幕。
// 这是已录音的那一版台词。游戏里的 LINES 可以改写；逐字相同才播放对应录音，见 recordedVoiceId。

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
  ['B1234', 'B one two three four'],
  ['P0', 'P zero'],
  ['Cheng Xu', 'Chung Shyu'],
  ['Lu Shicheng', 'Loo Shih-chung'],
];

export const GLOSSARY = {
  '陈墨': 'Chen Mo', '程叙': 'Cheng Xu', '陆世承': 'Lu Shicheng',
  '经纬': 'Meridian', '承岳': 'Chengyue', '公序': 'Civic Order',
  '根钥': 'Rootkey', '黑梦': 'Blackdream', '零号保障': 'Zero Priority',
};

const line = (source, text, direction, tag) => ({ source, text, direction, tag });
const silent = (source, text) => ({ source, text, silent: true, direction: 'Silence. Do not synthesize this narrative caption.' });

export const ENGLISH = {
  opening: [
    line('B1234，到场没有？', 'B1234, you on site yet?', 'Routine check-in. Brisk and familiar, not an emergency.', 'businesslike'),
    line('到了。', "I'm here.", 'Short, tired acknowledgement. No enthusiasm.', 'weary, matter-of-fact'),
    line('一场单车事故。核完赶紧交单，北岸还有两件。', "Single-vehicle crash. Verify it and close it out. You've got two more on the north bank.", 'Move straight to the next job; light deadline pressure, not anger.', 'brisk, businesslike'),
  ],
  dream1: [
    line('初判写的是他自己打偏了方向。', 'The initial report says he steered off course.', 'Recall the accepted explanation without believing it yet.', 'quiet, reflective'),
    line('可轮子在撞上护栏之前就转了。', 'But the wheels turned before he hit the barrier.', 'The contradiction is becoming clear. Stress before, not barrier.', 'thoughtful, skeptical'),
    line('这不是失控。有东西碰过这辆车。', "He didn't just lose control. Something made contact with this car.", 'A working theory, not a triumphant solution.', 'quiet, certain'),
  ],
  after1: [
    line('先回现场，把接触的痕迹找出来。', 'Back to the scene. Find the contact marks.', 'A practical instruction to himself, not a tutorial voice.', 'quiet, resolved'),
  ],
  // 备用通话：保留配音稿，默认不制作，也不恢复已删除的游戏触发。
  call: [
    line('报告漏了一辆车。', 'The report missed a car.', 'Plain statement of a serious discrepancy.', 'restrained, firm'),
    line('上传证据，重新回放。', 'Upload the evidence. Run the reconstruction again.', 'Routine procedure. Do not sound suspicious.', 'businesslike'),
    line('如果第二份也错呢？', "And if the next report's wrong too?", 'Dry challenge, not a philosophical speech.', 'skeptical'),
    line('那就上传下一份证据。你问我，我也没在桥上。', "Then upload more evidence. What do you want me to say? I'm not on that bridge.", 'Impatient and busy; not malicious.', 'impatient, conversational'),
  ],
  dream2: [
    line('轮子先动的。', 'The wheels moved first.', 'A small realization. Let first land.', 'quiet, focused'),
    line('那时候黄车还没碰到它。', "The yellow car hadn't even touched it yet.", 'Questioning the causal chain, not expressing shock.', 'quiet, skeptical'),
  ],
  question2: [
    line('你怎么知道是刮擦让它转向？', 'How do you know the sideswipe made it turn?', 'A pointed request for evidence, calm but probing.', 'questioning, controlled'),
    line('接触发生在偏转期间，离开方向与第二道胎痕一致。', 'Contact occurred during the turn. The departure direction matches the second set of tire marks.', 'Precise and helpful. Present correlation without a sinister inflection.', 'measured, neutral'),
    line('只有这个？', "That's all you've got?", 'Short, incredulous pressure. Do not shout.', 'skeptical, clipped'),
    line('另有行为关联分析支持。', 'Behavioral correlation analysis also supports the conclusion.', 'Same calm confidence as the previous reply.', 'measured, neutral'),
    line('接触前，它为什么转向？', 'Why did it turn before they touched?', 'Emphasize before. No raised voice.', 'firm, questioning'),
    line('……现有信息不足以确定。', 'There is insufficient information to determine that.', 'A brief processing beat before the answer, not human embarrassment.', 'brief pause, measured, neutral'),
  ],
  revised2: [
    line('它刚才可不是这样说的。', "That's not what it said a minute ago.", 'Private, dry disbelief. The distrust has begun.', 'quiet, skeptical'),
  ],
  call2: [
    line('B1234，逃逸案已经转追查科了。你这单可以结了。', "B1234, the hit-and-run's been passed to Investigations. You can close this one.", 'Trying to clear the queue, with ordinary workplace impatience.', 'brisk, businesslike'),
    line('再给我十分钟。', 'Give me ten more minutes.', 'A firm, economical request. No pleading.', 'low, firm'),
    line('十分钟以后道路恢复通行。别让我再催你。', "The road reopens in ten minutes. Don't make me chase you again.", 'Deadline pressure without foreshadowing murder.', 'impatient, matter-of-fact'),
    line('黄车撞了人，连刹车都没踩。', "That yellow car hit someone. Didn't even brake.", 'Preserve the current script: this is his present interpretation, not an added fact.', 'quiet, troubled'),
    line('像是根本不知道自己撞了人。', "Like it never knew it had hit anyone.", 'Testing a disturbing possibility, not narrating to an audience.', 'quiet, thoughtful'),
    line('右门被黄车撞得翘起来了，门尾露着一道缝。', "The yellow car buckled the right door. There's a gap at the back edge.", 'Observe the practical way into the car.', 'quiet, focused'),
    line('撬开它。转向柱下面有检修接口，插卡能读执行器缓存。', "Pry it open. Service port under the steering column. My card should read the actuator cache.", 'Work through the next action to himself; stay conversational.', 'quiet, resolved'),
  ],
  cardRead: [
    line('没有改装开关。也没有一次手动驾驶。', 'No modification switch. Not a single manual-driving entry.', 'Count off two findings, increasingly certain.', 'quiet, focused'),
    line('不是他打错了方向。是系统不让他把车开直。', "He didn't steer the wrong way. The system wouldn't let him go straight.", 'The accusation emerges from the evidence; restrained, not theatrical.', 'low, grave'),
  ],
  dream3: [
    line('白圈一直跟着它。', 'That white boundary was with it the whole time.', 'Accept the apparent protection status at this stage; do not reveal the later reversal.', 'quiet, reflective'),
    line('在这座城市，有些人的命排在前面。', 'In this city, some lives get priority.', 'Bitter recognition, not a grand political speech.', 'quiet, bitter'),
  ],
  question3: [
    line('这个 P0，是什么时候生效的？', 'When did this P0 status take effect?', 'Deliberate, testing the exact timing.', 'questioning, controlled'),
    line('回放范围内，保障状态持续有效。', 'Protection remained active throughout the reconstruction.', 'A smooth procedural answer. Do not emphasize the evasion.', 'measured, neutral'),
    line('我问的是什么时候写进去的。', "I'm asking when it was written into the record.", 'Correct the device with sharper diction, not volume.', 'firm, clipped'),
    line('该字段属于车辆 B 原始记录。', "That field is part of vehicle B's raw records.", 'Consistent service voice, no defensiveness.', 'measured, neutral'),
    line('当前账户权限不足。', 'Your current account has insufficient permissions.', 'A routine permissions notice, neither apologetic nor threatening.', 'measured, neutral'),
  ],
  revised3: [
    line('它不知道。或者，它不让我知道。', "It doesn't know. Or it won't let me know.", 'Small pause between the alternatives; distrust, not certainty.', 'quiet, wary'),
  ],
  after3: [
    line('报告终于承认，方向是系统转的。', 'The report finally admits the system made the turn.', 'Review the concession with restrained frustration.', 'quiet, dry'),
    line('然后把一切都推给了那个白圈。', 'Then pins it all on that white boundary.', 'Bitter observation, not smugness.', 'quiet, skeptical'),
    line('……黄车的原始记录还锁着。', "The yellow car's raw records are still locked.", 'Thinking forward. A slight pause, not a dramatic gasp.', 'thoughtful'),
    line('接口日志里，程叙的根钥在事故前两分钟登录过。', "The port log shows Cheng Xu's Rootkey signed in two minutes before the crash.", 'Remember a concrete lead; the key is not a shutdown device.', 'quiet, focused'),
    line('人飞出去了。钥匙未必。', "He was thrown clear. Doesn't mean the key was.", 'Dry, practical deduction. Slight emphasis on key.', 'quiet, resolved'),
  ],
  keyFound: [
    line('卡在座椅和中控之间。经纬的工程凭证，持有人程叙。', "Wedged between the seat and the console. Meridian engineering credential. Cheng Xu.", 'Read the found credential without adopting an announcer voice.', 'quiet, focused'),
    line('按规定应该上交。', "I'm supposed to hand this in.", 'An old rule he already knows he will break.', 'quiet, dry'),
    line('先借用一下。', "I'll borrow it first.", 'A trace of wry humor; no chuckle or comic punchline.', 'understated, wry'),
  ],
  rootRead: [
    line('接单时收到的那份初判，比特权早，比转向早，也比撞车早。', 'The initial report I got with the assignment came before the priority status. Before the turn. Before the crash.', 'Slow the final three beats as the chronology becomes impossible.', 'low, troubled'),
    line('为什么提前生成死亡报告？', 'Why generate a death report in advance?', 'A direct, controlled challenge. Do not shout.', 'low, questioning'),
    line('风险预测与报告预生成属于城市应急流程。', 'Risk forecasting and report pre-generation are part of the city emergency protocol.', 'The same reassuring service cadence as every earlier answer.', 'measured, neutral'),
    line('你预测他会死，所以提前告诉大家，是他自己的错？', "You predicted he'd die. So you told everyone it was his fault before it even happened?", 'Disbelief hardens into accusation; no screaming or melodrama.', 'controlled anger, incredulous'),
    silent('仪器没有再解释。', 'The device offers no further explanation.'),
  ],
  dream4: [
    line('白圈不是跟着它来的。', "That white boundary wasn't there when it arrived.", 'The earlier explanation is falling apart; keep it intimate.', 'quiet, unsettled'),
    line('是在这一刻，被写上去的。', 'It was written in. Right at this moment.', 'Emphasize the timing of the insertion, not a visual effect.', 'quiet, certain'),
  ],
  dream4b: [
    line('陆世承想停下来。车没听他的。', "Lu Shicheng tried to stop. The car wouldn't listen.", 'Recognize that the apparent perpetrator was also being controlled.', 'quiet, grave'),
    line('他的姓氏，替别人挡住了调查。', 'His family name kept the investigation looking the wrong way.', 'A sober revision of his own assumption, not sympathy invented for the character.', 'quiet, reflective'),
  ],
  after4: [
    line('报告先写好。特权随后授予。最后才是转向。', 'The report came first. Then the priority status. Then the turn.', 'Three evidence beats. Certainty with dread underneath.', 'low, deliberate'),
  ],
  target: [
    line('桥两端的灯、桥下的水泵，仍在各自规定的时间运行。', 'The lights at both ends of the bridge. The pumps below. Still running right on schedule.', 'He notices the ordinary city around him with new fear. No horror-narrator delivery.', 'quiet, uneasy'),
    line('这些都是同一个系统安排的。', 'All of it, run by the same system.', 'The danger has become personal. Do not whisper theatrically.', 'low, contained fear'),
    line('你在杀能核对你报告的人。', "You're killing the people who can check your reports.", 'An accusation spoken as a realization. Low and steady, with fear held down.', 'low, steady, controlled fear'),
    silent('仪器没有回答。', 'The device does not answer.'),
  ],
  transferred: [
    line('收到。特权争议转审查科，经纬和承岳那边会有人对接。', 'Received. Priority dispute referred to Review. Someone will follow up with Meridian and Chengyue.', 'Normal administrative handoff. Do not hint at a conspiracy.', 'businesslike'),
    line('B1234，这单你可以结了。', 'B1234, you can close this one.', 'Relieved to clear a job from the queue.', 'brisk, matter-of-fact'),
    line('知道了。', 'Understood.', 'Resigned, not satisfied. The doubt has not disappeared.', 'weary, subdued'),
    line('白圈会有人去吵。', 'Let someone else argue about that white boundary.', 'Rationalizing his decision to leave.', 'quiet, resigned'),
    line('至于它从什么时候开始跟着那辆车——', 'As for when it started following that car...', 'An unfinished thought he chooses not to pursue.', 'quiet, trailing off'),
    line('那不是我的单子了。', "Not my case anymore.", 'Self-dismissal, not a triumphant closing line.', 'quiet, resigned'),
  ],
  archived: [
    line('收到。肇事车辆转追查科。', 'Received. Suspect vehicle referred to Investigations.', 'Routine confirmation. No sinister undertone.', 'businesslike'),
    line('B1234，北岸还有两件，路上别耽误。', "B1234, you've still got two on the north bank. Keep moving.", 'Return immediately to the work queue.', 'brisk, businesslike'),
    line('知道了。', 'Understood.', 'Dismissing a doubt to get through the shift.', 'weary, subdued'),
    line('黄车会有人去追。', "Someone else will chase the yellow car.", 'A practical excuse to stop looking.', 'quiet, resigned'),
    line('至于它为什么先转了方向——', 'As for why the other car turned first...', 'Leave the contradiction hanging.', 'quiet, trailing off'),
    line('那不是我的单子了。', "Not my case anymore.", 'Same voice as the other ending, a separate take for this context.', 'quiet, resigned'),
  ],
};

export const AUDITION_IDS = [
  'opening_01', 'opening_02', 'opening_03',
  'question2_01', 'question2_02', 'question2_03', 'question2_06',
  'cardRead_02', 'dream3_02', 'keyFound_03', 'rootRead_04', 'target_03',
];

// 录音时每句的说话人。跟着 ENGLISH 的分组和顺序，不跟着后来改写过的 LINES。
const WHO = {
  opening: ['派单员', '陈墨', '派单员'],
  dream1: ['', '', ''],
  after1: [''],
  call: ['陈墨', '派单员', '陈墨', '派单员'],
  dream2: ['', ''],
  question2: ['陈墨', '仪器', '陈墨', '仪器', '陈墨', '仪器'],
  revised2: [''],
  call2: ['派单员', '陈墨', '派单员', '', '', '', ''],
  cardRead: ['', ''],
  dream3: ['', ''],
  question3: ['陈墨', '仪器', '陈墨', '仪器', '仪器'],
  revised3: [''],
  after3: ['', '', '', '', ''],
  keyFound: ['', '', ''],
  rootRead: ['', '陈墨', '仪器', '陈墨', ''],
  dream4: ['', ''],
  dream4b: ['', ''],
  after4: [''],
  target: ['', '', '陈墨', ''],
  transferred: ['派单员', '派单员', '陈墨', '', '', ''],
  archived: ['派单员', '派单员', '陈墨', '', '', ''],
};

const recordedSource = new Map();
for (const [group, lines] of Object.entries(ENGLISH)) {
  if (WHO[group]?.length !== lines.length) throw new Error(`Speaker map mismatch: ${group}`);
  lines.forEach((line, index) => recordedSource.set(`${group}_${String(index + 1).padStart(2, '0')}`, line.source));
}

// 已录音的句子。游戏字幕改写后，这里仍然描述原来的 71 条，避免把旧英文套到新中文上再生成。
export function dialogueLines({ includeReserve = false, includeSilent = false } = {}) {
  return Object.entries(ENGLISH).flatMap(([group, translations]) => translations.map((english, index) => {
    const id = `${group}_${String(index + 1).padStart(2, '0')}`;
    if (english.source !== recordedSource.get(id)) throw new Error(`Stale English voice script: ${id}. Review the changed source before generating.`);
    const who = WHO[group][index];
    const speaker = who === '派单员' ? 'dispatch' : who === '仪器' ? 'device' : 'chen';
    const channel = !who ? 'inner' : speaker === 'dispatch' ? 'radio' : speaker === 'device' ? 'device' : 'spoken';
    return { ...english, id, group, index, speaker, channel, reserve: group === 'call' };
  })).filter((l) => (includeReserve || !l.reserve) && (includeSilent || !l.silent));
}

// 当前字幕能用的录音。同一组里逐字相同优先；否则只在全局唯一时才用，避免两句相同的字配错段。
export function recordedVoiceId(group, text) {
  const bank = ENGLISH[group];
  if (bank) {
    const index = bank.findIndex((l) => !l.silent && l.source === text);
    if (index >= 0) return `${group}_${String(index + 1).padStart(2, '0')}`;
  }
  const hits = [];
  for (const [name, lines] of Object.entries(ENGLISH)) {
    lines.forEach((l, index) => {
      if (!l.silent && l.source === text) hits.push(`${name}_${String(index + 1).padStart(2, '0')}`);
    });
  }
  return hits.length === 1 ? hits[0] : null;
}

export function spokenText(text) {
  return PRONUNCIATIONS.reduce((result, [word, pronunciation]) => result.replaceAll(word, pronunciation), text);
}

export function synthesisText(l) {
  if (l.silent) throw new Error(`Do not synthesize narrative silence: ${l.id}`);
  const inner = l.channel === 'inner' ? '[quiet, close, internal monologue] ' : '';
  return `${inner}[${l.tag}] ${spokenText(l.text)}`;
}
