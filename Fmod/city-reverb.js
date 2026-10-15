// FMOD Studio 脚本：场景基础混响 CityVerb（npm run audio:reverb）。只新增缺失的对象，可重复执行，不覆盖手工调整。
// 让单独的 3D 点声源融进雨夜高架两侧的楼群，并带出距离感：
//   - Return：Delay（楼面拍击回声）→ SFX Reverb（短街谷混响）→ EQ（高通 + 削中频减少掩蔽 + Snapshot 用的低通）
//   - 每个 3D 事件主轨加一路 Send，位置在 Fader 之后、Spatializer 之前：送进混响的量不随距离衰减，
//     电平按内置参数 Distance (Normalized) 自动化——近处偏干、中远处湿声比例升高，到最大距离淡出。
//     直达声随距离衰减而混响场大致不变，这就是距离感的来源。
// 参考：FMOD 论坛员工建议（事件内 Send 到共享 Return、按距离自动化 Send；城市街道用 50–200 ms 无反馈拍击延迟 +
// 短混响、加大 early / late delay、湿声低通），以及 FMOD 内置 City / Alley 预设（1.5 s、HighCut 约 4–8 kHz）。
(function () {
    var project = studio.project;
    var mixer = project.workspace.mixer;
    var changed = [];

    function need(path) {
        var obj = project.lookup(path);
        if (!obj) throw new Error('Missing ' + path);
        return obj;
    }
    function same(a, b) { return !!a && !!b && a.id === b.id; }
    function find(chain, type) { return chain.effects.filter(function (e) { return e.isOfExactType(type); })[0]; }

    // ---------- Return ----------
    var verb = project.lookup('bus:/CityVerb');
    if (!verb) {
        verb = project.create('MixerReturn');
        verb.name = 'CityVerb';
        verb.output = mixer.masterBus;
        changed.push('bus:/CityVerb');
    }
    var chain = verb.effectChain;

    // 楼面拍击回声：两侧第一排楼面离桥中心约 19–25 m，往返 40–50 m ≈ 120–145 ms；少量反馈模拟两侧楼面来回反射
    if (!find(chain, 'DelayEffect')) {
        var slap = chain.addEffect('DelayEffect');
        slap.delay = 120;
        slap.feedback = 10;
        slap.level = -8;      // 回声（湿）
        slap.dryLevel = 0;    // 原信号继续进混响
    }
    // 短街谷混响：介于 FMOD City（Diffusion 50、HighCut 4 kHz）与 Alley（Diffusion 100）之间；
    // 雨天空气 + 远处吸收：高频衰减更快、湿声低通；低频收一点，避免车声 / 城市低频糊成一片
    if (!find(chain, 'SFXReverbEffect')) {
        var rv = chain.addEffect('SFXReverbEffect');
        rv.decayTime = 1600;
        rv.earlyDelay = 30;
        rv.lateDelay = 50;
        rv.HFReference = 5000;
        rv.HFDecayRatio = 50;
        rv.diffusion = 70;
        rv.density = 100;
        rv.lowShelfFrequency = 250;
        rv.lowShelfGain = -6;
        rv.highCut = 4500;
        rv.earlyLateMix = 60;
        rv.wetLevel = -8;
        rv.dryLevel = -80;    // Return 只出湿声
    }
    // 返回轨 EQ：A 高通 150 Hz、B 500 Hz 削 3 dB（减少对直达声的掩蔽，定位更清楚）、C 低通平时全开（Snapshot 用）
    var eq = find(chain, 'MultibandEqEffect');
    if (!eq) {
        eq = chain.addEffect('MultibandEqEffect');
        eq.filterTypeA = 4;   // HP 12 dB
        eq.frequencyA = 150;
        eq.filterTypeB = 9;   // Peaking
        eq.frequencyB = 500;
        eq.qualityB = 0.8;
        eq.gainB = -3;
        eq.filterTypeC = 2;   // LP 24 dB
        eq.frequencyC = 22000;
        eq.filterTypeD = 0;
        eq.filterTypeE = 0;
    }

    var sfx = project.lookup('vca:/SFX');
    if (sfx && !verb.masters.some(function (m) { return same(m, sfx); })) verb.relationships.masters.add(sfx);

    // ---------- 每个 3D 事件的 Send ----------
    // 所有事件共用一个 Distance (Normalized) 参数预设（第一次调用时创建）
    var distance = project.lookup('parameter:/Distance (Normalized)');
    function distanceParam(e) {
        if (distance) {
            var has = e.getParameterPresets().some(function (p) { return same(p, distance.parameter); });
            if (!has) e.addGameParameter(distance);
        } else {
            e.addGameParameter({ name: 'Distance (Normalized)', type: project.parameterType.DistanceNormalized, min: 0, max: 1 });
            distance = need('parameter:/Distance (Normalized)');
        }
        return distance.parameter;
    }

    // 送混响电平（dB）随归一化距离（0 = 事件最小距离，1 = 最大距离）
    var CURVE = [[0, -10], [0.15, -8], [0.5, -6], [0.85, -9], [1, -40]];

    // 新加的 effect 在链尾：把 before 及其后的效果器依次挪到它后面，其余顺序不变
    function insertBefore(c, effect, before) {
        var after = [], seen = false;
        c.effects.forEach(function (x) {
            if (same(x, before)) seen = true;
            if (seen && !same(x, effect)) after.push(x);
        });
        after.forEach(function (x) { c.relationships.effects.remove(x); c.relationships.effects.add(x); });
    }

    function send(path, offset) {
        var e = project.lookup('event:/' + path);
        if (!e) return;
        var c = e.masterTrack.mixerGroup.effectChain;
        if (c.effects.some(function (x) { return x.isOfExactType('MixerSend') && same(x.mixerReturn, verb); })) return;
        var sp = find(c, 'SpatialiserEffect');
        if (!sp) throw new Error(path + ' is not 3D');
        var s = c.addEffect('MixerSend');
        s.mixerReturn = verb;
        insertBefore(c, s, sp);
        var curve = s.addAutomator('level').addAutomationCurve(distanceParam(e));
        CURVE.forEach(function (p) { curve.addAutomationPoint(p[0], Math.max(-80, p[1] + offset)); });
        changed.push(path);
    }

    // 车辆、撞击、门、撬门、广告牌：标准曲线
    ['vehicle/drive_out', 'vehicle/siren', 'vehicle/brake', 'vehicle/door_open', 'vehicle/door_close',
        'vehicle/hit_rail', 'vehicle/hit_body', 'world/billboard_update', 'foley/pry_insert', 'foley/pry_open']
        .forEach(function (p) { send(p, 0); });
    // 城市环境点声源本身已是连续纹理，送少一点免得糊
    ['amb/Amb_1', 'amb/Amb_2', 'amb/Amb_3', 'amb/Amb_4', 'amb/Amb_5_rain', 'amb/Amb_6_rain']
        .forEach(function (p) { send(p, -6); });
    // 手里的接入扫描声：只带一点空间
    send('scifi/id_scan_loop', -8);

    // ---------- Snapshot ----------
    // 事件 Send 直接进 Return，不经过 AMB / WORLD 总线，所以各 Snapshot 要单独处理混响返回
    function scope(name, target, property, value) {
        var s = project.lookup('snapshot:/' + name);
        if (!s) return;
        var has = s.snapshotProperties.some(function (p) { return same(p.automatableObject, target) && p.propertyName === property; });
        if (has) return;
        if (!s.snapshotTracks.some(function (t) { return same(t.mixerStrip, verb); })) {
            var t = project.create('SnapshotTrack');
            t.snapshot = s;
            t.mixerStrip = verb;
        }
        var p = project.create('SnapshotProperty');
        p.snapshot = s;
        p.automatableObject = target;
        p.propertyName = property;
        p.value = value;
        changed.push('snapshot:/' + name + ' ' + property);
    }
    scope('CarInterior', eq, 'frequencyC', 700);
    scope('Pause', eq, 'frequencyC', 600);
    scope('Radar', eq, 'frequencyC', 900);
    scope('Dream', verb, 'volume', -10);   // 黑梦里城市退远，由 Dream 自己的 Reverb 接管
    scope('Dream', eq, 'frequencyC', 1100);
    scope('Tablet', verb, 'volume', -5);

    project.save();
    console.log('City reverb ready. Changed: ' + (changed.length ? changed.join(', ') : 'nothing (all present)'));
})();
