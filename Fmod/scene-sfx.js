// FMOD Studio 脚本：第二批音效（开场音乐 / 车辆 / 场景 / UI / 撬门 / 水脚步）与 CarInterior、Pause、Radar Snapshot。
// npm run audio:scene 执行。只新增缺失的对象，可重复执行：已存在的事件、总线、效果器、Snapshot 属性一律不改，
// Studio 里手工调过的值都会保留。素材是 Assets/ 根目录下 26–48 号 WAV。
(function () {
    var project = studio.project;
    var ws = project.workspace;
    var mixer = ws.mixer;
    var dir = project.filePath.replace(/[^/]+$/, '') + 'Assets/';

    function need(path) {
        var obj = project.lookup(path);
        if (!obj) throw new Error('Missing ' + path);
        return obj;
    }
    function same(a, b) { return !!a && !!b && a.id === b.id; }

    // ---------- Bank ----------
    function bank(name) {
        var b = project.lookup('bank:/' + name);
        if (!b) {
            b = project.create('Bank');
            b.name = name;
            b.folder = ws.masterBankFolder;
        }
        return b;
    }
    var main = need('bank:/Main');
    var frontend = bank('Frontend');   // 加载界面最先加载：菜单音乐、进入游戏、无效点击

    // ---------- 总线 ----------
    function bus(name, parent) {
        var b = project.lookup((parent ? parent.getPath() : 'bus:') + '/' + name);
        if (!b) {
            b = project.create('MixerGroup');
            b.name = name;
            b.output = parent || mixer.masterBus;
        }
        return b;
    }
    var MUSIC = bus('MUSIC');
    var WORLD = bus('WORLD');                 // 场景里的车辆、撞击、广告牌（3D）
    var VEHICLE = bus('Vehicle', WORLD);
    var BILLBOARD = bus('Billboard', WORLD);
    var CABIN = bus('CABIN');                 // 车内引擎声：车内 Snapshot 不切它
    var AMB = need('bus:/AMB');
    var FOLEY = need('bus:/FOLEY');
    var SCIFI = need('bus:/SCIFI');
    var UI = need('bus:/UI');
    var reverb = need('bus:/Reverb');

    // 每条世界总线一个低通（平时全开），Snapshot 只改它的截止频率
    function lowpass(strip) {
        var found = strip.effectChain.effects.filter(function (e) { return e.isOfExactType('MultibandEqEffect'); });
        if (found.length) return found[0];
        var eq = strip.effectChain.addEffect('MultibandEqEffect');
        eq.filterTypeA = 2;   // LP 24 dB
        eq.frequencyA = 22000;
        eq.filterTypeB = 0;
        eq.filterTypeC = 0;
        eq.filterTypeD = 0;
        eq.filterTypeE = 0;
        return eq;
    }
    var lp = { AMB: lowpass(AMB), FOLEY: lowpass(FOLEY), SCIFI: lowpass(SCIFI), WORLD: lowpass(WORLD), CABIN: lowpass(CABIN) };

    // 混响发送：平时 -80 dB，黑梦 Snapshot 打开
    function send(strip) {
        var found = strip.effectChain.effects.filter(function (e) { return e.isOfExactType('MixerSend') && same(e.mixerReturn, reverb); });
        if (found.length) return found[0];
        var s = strip.effectChain.addEffect('MixerSend');
        s.mixerReturn = reverb;
        s.level = -80;
        return s;
    }
    var sends = { AMB: send(AMB), FOLEY: send(FOLEY), SCIFI: send(SCIFI), WORLD: send(WORLD) };

    // Reverb return 原来没有任何发送，仍是默认值时才改成黑梦用的大空间
    var rv = reverb.effectChain.effects.filter(function (e) { return e.isOfExactType('SFXReverbEffect'); })[0];
    if (rv && rv.decayTime === 1500 && rv.earlyDelay === 20) {
        rv.decayTime = 3200;
        rv.earlyDelay = 30;
        rv.lateDelay = 50;
        rv.HFDecayRatio = 40;
    }

    // ---------- VCA ----------
    function vca(name, strips) {
        var v = project.lookup('vca:/' + name);
        if (!v) {
            v = project.create('MixerVCA');
            v.name = name;
            v.mixer = mixer;
        }
        strips.forEach(function (s) {
            if (!s.masters.some(function (m) { return same(m, v); })) s.relationships.masters.add(v);
        });
    }
    vca('Music', [MUSIC]);
    vca('SFX', [WORLD, CABIN]);

    // ---------- 事件 ----------
    function folder(name) {
        var f = ws.masterEventFolder.getItem(name);
        if (!f) {
            f = project.create('EventFolder');
            f.name = name;
            f.folder = ws.masterEventFolder;
        }
        return f;
    }
    function asset(file) {
        var a = project.lookup('asset:/' + file) || project.importAudioFile(dir + file);
        if (!a) throw new Error('Cannot import ' + file);
        return a;
    }

    // o: { bus, files, bank, loop, offset, fadeIn, fadeOut, pitch, volume, max, spatial: { min, max, size } }
    var created = [];
    // 3D 定位：已有 Spatializer 就不动（保留手工调过的距离）
    function spatialize(e, o) {
        var chain = e.masterTrack.mixerGroup.effectChain;
        if (chain.effects.some(function (x) { return x.isOfExactType('SpatialiserEffect'); })) return false;
        var sp = chain.addEffect('SpatialiserEffect');
        sp.overrideRange = false;          // 用事件宏的 min / max（米）
        sp.distanceRolloffType = 3;        // Inverse Tapered，到 max 静音
        sp.extentMode = 1;                 // User：近处展开、远处收成点
        sp.soundSize = o.size || 2;
        sp.minimumExtent = 0;
        e.automatableProperties.minimumDistance = o.min;
        e.automatableProperties.maximumDistance = o.max;
        e.automatableProperties.dopplerEnabled = false;
        return true;
    }
    function event(path, o) {
        var old = project.lookup('event:/' + path);
        if (old) {   // 已有：保留手工设置，只补上后来要求的 3D 定位
            if (o.spatial && spatialize(old, o.spatial)) created.push(path + ' (3D)');
            return;
        }
        var parts = path.split('/');
        var e = project.create('Event');
        e.name = parts[1];
        e.folder = folder(parts[0]);
        e.mixerInput.output = o.bus;
        e.relationships.banks.add(o.bank || main);

        var assets = o.files.map(asset);
        var len = Math.max.apply(null, assets.map(function (a) { return a.length; }));
        var start = o.offset || 0;
        var sound;
        if (assets.length === 1) {
            sound = e.masterTrack.addSound(e.timeline, 'SingleSound', start, len);
            sound.audioFile = assets[0];
        } else {
            sound = e.masterTrack.addSound(e.timeline, 'MultiSound', start, len);
            sound.playlistMode = 1;   // 打乱，不重复上一条
            assets.forEach(function (a) {
                var s = project.create('SingleSound');
                s.audioFile = a;
                sound.relationships.sounds.add(s);
            });
        }
        if (o.pitch) sound.addModulator('RandomizerModulator', 'pitch').amount = o.pitch;     // 半音
        if (o.volume) sound.addModulator('RandomizerModulator', 'volume').amount = o.volume;  // dB

        if (o.loop) {
            var region = project.create('LoopRegion');
            region.position = start;
            region.length = len;
            region.timeline = e.timeline;
            region.markerTrack = e.markerTracks[0];
        }
        if (o.fadeIn !== undefined || o.fadeOut !== undefined) {
            var adsr = e.masterTrack.mixerGroup.addModulator('ADSRModulator', 'volume');
            adsr.initialValue = o.fadeIn ? -80 : 0;
            adsr.attackTime = o.fadeIn || 0;
            adsr.releaseTime = o.fadeOut || 0;
        }
        if (o.spatial) spatialize(e, o.spatial);
        if (o.max) e.automatableProperties.maxVoices = o.max;
        created.push(path);
    }

    event('music/menu', { bus: MUSIC, bank: frontend, files: ['26Music_menu.wav'], loop: true, fadeIn: 800, fadeOut: 1600 });
    event('ui/enter_game', { bus: UI, bank: frontend, files: ['27UI_Entergame.wav'] });
    event('ui/warning', { bus: UI, files: ['40UI_alarm.wav'], max: 1 });

    event('vehicle/drive_out', { bus: VEHICLE, files: ['28car_drive_out_loop.wav'], loop: true, fadeIn: 600, fadeOut: 200, spatial: { min: 6, max: 90, size: 6 } });
    event('vehicle/drive_in', { bus: CABIN, files: ['29car_drive_loop_in.wav'], loop: true, fadeOut: 900 });
    // 警笛已停用：游戏不触发，事件保留
    event('vehicle/siren', { bus: VEHICLE, files: ['30police_alarm_loop.wav'], loop: true, fadeOut: 500, spatial: { min: 6, max: 150, size: 4 } });
    event('vehicle/brake', { bus: VEHICLE, files: ['31car_brake.wav'], spatial: { min: 5, max: 90, size: 5 } });
    event('vehicle/door_open', { bus: VEHICLE, files: ['32car_open.wav'], spatial: { min: 1, max: 30, size: 1 } });
    event('vehicle/door_close', { bus: VEHICLE, files: ['33car_close.wav'], spatial: { min: 1, max: 30, size: 1 } });
    event('vehicle/hit_rail', { bus: VEHICLE, files: ['34Car_Hit_bridge.wav'], spatial: { min: 5, max: 120, size: 6 } });
    event('vehicle/hit_body', { bus: VEHICLE, files: ['35Car_hit_body.wav'], spatial: { min: 3, max: 80, size: 4 } });
    event('world/billboard_update', { bus: BILLBOARD, files: ['43SciFi_Billboard_update.wav'], pitch: 2, max: 4, spatial: { min: 4, max: 60, size: 6 } });

    event('scifi/id_scan_loop', { bus: SCIFI, files: ['41UI_Scan_Loop.wav'], loop: true, fadeIn: 80, fadeOut: 250, spatial: { min: 0.5, max: 12, size: 1 } });
    // 雷达素材峰值在 0.302 s；放在时间线 0.198 s，按 Q 后峰值正好落在 0.5 s 的发射瞬间
    event('scifi/radar', { bus: SCIFI, files: ['42radar_scan.wav'], offset: 0.198 });

    event('foley/FootStep_Water', { bus: FOLEY, files: ['46footstep_water_1.wav', '47footstep_water_2.wav', '48footstep_water_3.wav'], pitch: 1, volume: 2 });
    // 撬门：3D 在车门门尾（镜头离门约 1.2 m）
    event('foley/pry_insert', { bus: FOLEY, files: ['44Pry_insert.wav'], spatial: { min: 1, max: 25, size: 1 } });
    event('foley/pry_open', { bus: FOLEY, files: ['45Pry_open.wav'], spatial: { min: 1, max: 25, size: 1.5 } });
    // 科幻 UI 打字：平板（手持或结局摔在地上）上文字正在打出时循环，3D 跟着平板
    event('ui/typewrite_loop', { bus: UI, files: ['49typewrite_loop.wav'], loop: true, fadeIn: 30, fadeOut: 120, spatial: { min: 0.3, max: 10, size: 0.5 } });

    // 黑梦里的撞护栏只在黑梦播放：事件自带一路送黑梦 Reverb 的 Send（Spatializer 之前，固定电平），
    // Studio 里单独试听也带黑梦空间；黑梦 Snapshot 打开的 WORLD 总线发送照常叠加
    (function dreamSend(path, level) {
        var e = need('event:/' + path);
        var c = e.masterTrack.mixerGroup.effectChain;
        if (c.effects.some(function (x) { return x.isOfExactType('MixerSend') && same(x.mixerReturn, reverb); })) return;
        var s = c.addEffect('MixerSend');
        s.mixerReturn = reverb;
        s.level = level;
        var after = [], seen = false;
        c.effects.forEach(function (x) {
            if (x.isOfExactType('SpatialiserEffect')) seen = true;
            if (seen && !same(x, s)) after.push(x);
        });
        after.forEach(function (x) { c.relationships.effects.remove(x); c.relationships.effects.add(x); });
        created.push(path + ' -> Reverb');
    })('vehicle/hit_rail', -12);

    // ---------- 已有 UI 事件换素材：路径与触发不变，只换仍是旧生成素材（Assets/ui/）的 ----------
    function swap(path, file) {
        var s = need(path).masterTrack.modules[0];
        if (!s.audioFile || s.audioFile.assetPath.indexOf('ui/') !== 0) return;
        var a = asset(file);
        s.audioFile = a;
        s.length = a.length;
        created.push(path + ' <- ' + file);
    }
    swap('event:/ui/panel_open', '36UI_show.wav');
    swap('event:/ui/panel_close', '37ui_hide.wav');
    swap('event:/ui/click', '38UI_Click_confirm.wav');
    swap('event:/ui/deny', '39UI_Click_normal.wav');
    // 无效点击在加载界面就要能响：移到 Frontend
    var deny = need('event:/ui/deny');
    if (!deny.banks.some(function (b) { return same(b, frontend); })) {
        deny.banks.forEach(function (b) { if (same(b, main)) deny.relationships.banks.remove(b); });
        deny.relationships.banks.add(frontend);
    }

    // ---------- Snapshot ----------
    // Overriding，强度用 AHDSR。和 setup-mix.js 一样不分配 Bank（自动进 Master）
    function snapshot(name, env) {
        var s = project.lookup('snapshot:/' + name);
        if (s) return s;
        s = project.create('Snapshot');
        s.name = name;
        s.folder = mixer.snapshotList;
        s.mixer = mixer;
        var adsr = s.automatableProperties.addModulator('ADSRModulator', 'snapshotIntensity');
        adsr.initialValue = 0;
        adsr.peakValue = 100;
        adsr.attackTime = env.attack;
        adsr.holdTime = env.hold || 0;
        adsr.decayTime = env.decay || 0;
        adsr.sustainValue = env.sustain === undefined ? 100 : env.sustain;
        adsr.releaseTime = env.release;
        adsr.finalValue = 0;
        created.push('snapshot:/' + name);
        return s;
    }
    // 同一属性已存在就不改（保留手工值）
    function scope(s, strip, target, property, value) {
        target = target || strip;
        var has = s.snapshotProperties.some(function (p) { return same(p.automatableObject, target) && p.propertyName === property; });
        if (has) return;
        if (!s.snapshotTracks.some(function (t) { return same(t.mixerStrip, strip); })) {
            var t = project.create('SnapshotTrack');
            t.snapshot = s;
            t.mixerStrip = strip;
        }
        var p = project.create('SnapshotProperty');
        p.snapshot = s;
        p.automatableObject = target;
        p.propertyName = property;
        p.value = value;
    }

    // 车内：环境和车外声音高切；车内引擎（CABIN）不动。切进车内瞬间生效，开门 0.9 s 内放开
    var car = snapshot('CarInterior', { attack: 0, release: 900 });
    scope(car, AMB, lp.AMB, 'frequencyA', 700);
    scope(car, WORLD, lp.WORLD, 'frequencyA', 900);

    // 暂停：整个游戏世界高切，UI 与音乐不受影响
    var pause = snapshot('Pause', { attack: 250, release: 300 });
    scope(pause, AMB, lp.AMB, 'frequencyA', 600);
    scope(pause, FOLEY, lp.FOLEY, 'frequencyA', 600);
    scope(pause, SCIFI, lp.SCIFI, 'frequencyA', 600);
    scope(pause, WORLD, lp.WORLD, 'frequencyA', 600);
    scope(pause, CABIN, lp.CABIN, 'frequencyA', 600);

    // Q 雷达：快速高切一下，sustain 0 自己恢复（游戏 2 秒后释放实例）；雷达本身在 SCIFI，不受影响
    var radar = snapshot('Radar', { attack: 40, hold: 150, decay: 900, sustain: 0, release: 200 });
    scope(radar, AMB, lp.AMB, 'frequencyA', 900);
    scope(radar, FOLEY, lp.FOLEY, 'frequencyA', 900);
    scope(radar, WORLD, lp.WORLD, 'frequencyA', 900);
    scope(radar, CABIN, lp.CABIN, 'frequencyA', 900);

    // 黑梦：保留现有设置；世界声音送混响，脚步（FOLEY）高切
    var dream = need('snapshot:/Dream');
    scope(dream, AMB, sends.AMB, 'level', -10);
    scope(dream, FOLEY, sends.FOLEY, 'level', -6);
    scope(dream, SCIFI, sends.SCIFI, 'level', -8);
    scope(dream, WORLD, sends.WORLD, 'level', -4);
    scope(dream, FOLEY, lp.FOLEY, 'frequencyA', 1800);

    project.save();
    console.log('Scene SFX ready. New: ' + (created.length ? created.join(', ') : 'nothing (all present)'));
})();
