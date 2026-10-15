// voice:stage --update-existing 提供 voiceEntries。只更新明确列出的对白，保留事件 GUID、增益、效果器和其他游戏混音。
(function () {
    var project = studio.project;
    var ws = project.workspace;
    var bank = project.lookup('bank:/VoiceEN');
    if (!bank) throw new Error('Missing VoiceEN bank; use the add-only importer for a new project.');
    var active = {};
    // FMOD 每次读取关系可能返回不同 JS 包装对象，不能用 indexOf 做对象身份比较。
    function inBank(event) { return event.banks.some(function (b) { return b.id === bank.id; }); }
    // 在导入/修改前检查全部事件结构和路由；不猜测复杂的手工时间线。
    voiceEntries.forEach(function (line) {
        if (!/^[A-Za-z0-9_]+$/.test(line.id) || active[line.id]) throw new Error('Invalid or duplicate voice ID.');
        active[line.id] = true;
        if (!project.lookup('bus:/DIALOGUE/' + line.channel)) throw new Error('Missing dialogue route: ' + line.channel);
        var event = project.lookup('event:/voice/en/' + line.id);
        if (event && (event.timeline.modules.length !== 1 || !event.timeline.modules[0].isOfExactType('SingleSound'))) {
            throw new Error('Inspect manually authored voice timeline before replacement: ' + line.id);
        }
    });
    var files = voiceEntries.map(function (line) {
        var file = project.importAudioFile(line.file);
        if (!file || !(file.length > 0)) throw new Error('Missing or empty voice file: ' + line.file);
        return file;
    });
    function folder(parent, name) {
        var f = parent.getItem(name);
        if (!f) { f = project.create('EventFolder'); f.name = name; f.folder = parent; }
        return f;
    }
    var target = folder(folder(ws.masterEventFolder, 'voice'), 'en');
    var created = 0, updated = 0, retired = 0;
    voiceEntries.forEach(function (line, i) {
        var event = project.lookup('event:/voice/en/' + line.id);
        var sound;
        if (event) { sound = event.timeline.modules[0]; updated++; }
        else {
            event = project.create('Event');
            event.name = line.id;
            event.folder = target;
            sound = event.masterTrack.addSound(event.timeline, 'SingleSound', 0, files[i].length);
            created++;
        }
        sound.audioFile = files[i];
        sound.start = 0;
        sound.startOffset = 0;
        sound.timelockedOffset = 0;
        sound.length = files[i].length;
        sound.looping = false;
        event.mixerInput.output = project.lookup('bus:/DIALOGUE/' + line.channel);
        if (!inBank(event)) event.relationships.banks.add(bank);
    });
    // 旧对白不删除：保留工程、旧 WAV 和 GUID，只从本轮发布 Bank 移出，防止游戏继续携带旧演员。
    project.model.Event.findInstances().forEach(function (event) {
        if (event.getPath().indexOf('event:/voice/en/') !== 0 || active[event.name]) return;
        if (inBank(event)) { event.relationships.banks.remove(bank); retired++; }
    });
    project.save();
    console.log('Voice recast: ' + updated + ' updated, ' + created + ' created, ' + retired + ' retired from VoiceEN (not deleted).');
})();
