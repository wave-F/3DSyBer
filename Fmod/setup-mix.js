// FMOD Studio 官方脚本：在手工制作的 amb 事件上搭混音（npm run audio:mix）。
// 只增改、不重建事件，可以重复执行：
//   - AMB 下分出 Bed / City / Crowd / RainHits 子总线，并把 amb 事件路由过去
//   - Amb_1..6 加 FMOD Spatializer（3D 定位），rain / traffic 保持 2D 立体声铺底
//   - Snapshot：Dream（黑梦）、Tablet（举起平板）；AHDSR 调制强度做淡入淡出
//   - VCA：Ambience / SFX / UI，游戏运行时调音量
//   - scifi/analyze_loop 没有声音时补回循环
var ws = studio.project.workspace;
var mixer = ws.mixer;
var dir = studio.project.filePath.replace(/[^/]+$/, '') + 'Assets/';

function need(path) {
    var obj = studio.project.lookup(path);
    if (!obj) throw new Error('Missing ' + path);
    return obj;
}

var bank = need('bank:/Main');
var amb = need('bus:/AMB');

// ---------- 子总线 ----------
function subBus(parent, name) {
    var bus = studio.project.lookup(parent.getPath() + '/' + name);
    if (!bus) {
        bus = studio.project.create('MixerGroup');
        bus.name = name;
        bus.output = parent;
    }
    return bus;
}
var bed = subBus(amb, 'Bed');       // rain / traffic：2D 立体声，跟头走
var city = subBus(amb, 'City');     // Amb_1 / 2 / 4：城市点声源
var crowd = subBus(amb, 'Crowd');   // Amb_3：人群点声源
var rainHits = subBus(amb, 'RainHits');   // Amb_5_rain / Amb_6_rain：雨打在楼体立面上，每栋楼一个点声源

// AMB 总线上的低通（平时全开），黑梦 Snapshot 把它压下来
function ambLowpass() {
    var effects = amb.effectChain.effects;
    for (var i = 0; i < effects.length; i++) if (effects[i].isOfExactType('MultibandEqEffect')) return effects[i];
    var eq = amb.effectChain.addEffect('MultibandEqEffect');
    eq.filterTypeA = 2;       // LP 24 dB
    eq.frequencyA = 22000;
    eq.filterTypeB = 0;
    eq.filterTypeC = 0;
    eq.filterTypeD = 0;
    eq.filterTypeE = 0;
    return eq;
}
var lowpass = ambLowpass();

// ---------- amb 事件 ----------
function route(path, bus) {
    var e = need(path);
    e.mixerInput.output = bus;
    if (e.banks.indexOf(bank) < 0) e.relationships.banks.add(bank);
    return e;
}
route('event:/amb/rain', bed);
route('event:/amb/traffic', bed);

// 手工 Foley：保留事件和素材，仅确保路由与 Bank 分配。
var foley = need('bus:/FOLEY');
route('event:/foley/FootStep', foley);
route('event:/foley/ClothFoley', foley);

// 3D 点声源：距离单位是米（与 three.js 场景一致），Inverse Tapered 衰减，到 max 静音
function spatial(path, bus, o) {
    var e = route(path, bus);
    var chain = e.masterTrack.mixerGroup.effectChain;
    var sp = null;
    for (var i = 0; i < chain.effects.length; i++) if (chain.effects[i].isOfExactType('SpatialiserEffect')) sp = chain.effects[i];
    if (!sp) sp = chain.addEffect('SpatialiserEffect');
    sp.overrideRange = false;          // 用事件宏的 min / max
    sp.distanceRolloffType = 3;        // Inverse Tapered
    sp.extentMode = 1;                 // User：近处声场展开、远处收成点
    sp.soundSize = o.size;
    sp.minimumExtent = 0;
    e.automatableProperties.minimumDistance = o.min;
    e.automatableProperties.maximumDistance = o.max;
    e.automatableProperties.dopplerEnabled = false;
}
spatial('event:/amb/Amb_1', city, { min: 12, max: 160, size: 30 });   // 桥下低频城市轰鸣
spatial('event:/amb/Amb_2', city, { min: 8, max: 110, size: 12 });    // 街面零碎活动
spatial('event:/amb/Amb_3', crowd, { min: 10, max: 130, size: 18 });  // 人群
spatial('event:/amb/Amb_4', city, { min: 30, max: 300, size: 60 });   // 远处城市整体
// 雨打楼体：近处细节，最大距离与 src/audio/sound.js 的 RAIN_HIT_RANGE 一致
spatial('event:/amb/Amb_5_rain', rainHits, { min: 6, max: 45, size: 8 });
spatial('event:/amb/Amb_6_rain', rainHits, { min: 6, max: 45, size: 8 });

// ---------- VCA ----------
function vca(name, strips) {
    var v = studio.project.lookup('vca:/' + name);
    if (!v) {
        v = studio.project.create('MixerVCA');
        v.name = name;
        v.mixer = mixer;
    }
    strips.forEach(function (s) { if (s.masters.indexOf(v) < 0) s.relationships.masters.add(v); });
    return v;
}
vca('Ambience', [amb]);
vca('SFX', [need('bus:/FOLEY'), need('bus:/SCIFI')]);
vca('UI', [need('bus:/UI')]);

// ---------- Snapshot ----------
// Overriding：数值是绝对值（总线默认 0 dB，AMB 默认 -2 dB）
// Snapshot 和总线、VCA 一样自动进 Master Bank，不要再分配到其它 Bank：
// 分配到 Main 后，Studio 2.03.14 往这个 Bank 里加任何事件都会卡死（Bank 浏览器排序死循环）
function snapshot(name, scoped, fadeIn, fadeOut) {
    var s = studio.project.lookup('snapshot:/' + name);
    if (s) {
        s.banks.forEach(function (b) { s.relationships.banks.remove(b); });
        studio.project.deleteObject(s);
    }
    s = studio.project.create('Snapshot');
    s.name = name;
    s.folder = mixer.snapshotList;
    s.mixer = mixer;
    var tracked = [];
    scoped.forEach(function (it) {
        if (tracked.indexOf(it.strip) < 0) {
            var t = studio.project.create('SnapshotTrack');
            t.snapshot = s;
            t.mixerStrip = it.strip;
            tracked.push(it.strip);
        }
        var p = studio.project.create('SnapshotProperty');
        p.snapshot = s;
        p.automatableObject = it.target || it.strip;
        p.propertyName = it.property;
        p.value = it.value;
    });
    var adsr = s.automatableProperties.addModulator('ADSRModulator', 'snapshotIntensity');
    adsr.initialValue = 0;
    adsr.peakValue = 100;
    adsr.sustainValue = 100;
    adsr.finalValue = 0;
    adsr.attackTime = fadeIn;
    adsr.holdTime = 0;
    adsr.decayTime = 0;
    adsr.releaseTime = fadeOut;
    return s;
}
// 黑梦：城市退远，只剩闷住的雨
snapshot('Dream', [
    { strip: bed, property: 'volume', value: -8 },
    { strip: city, property: 'volume', value: -20 },
    { strip: crowd, property: 'volume', value: -26 },
    { strip: rainHits, property: 'volume', value: -12 },
    { strip: amb, target: lowpass, property: 'frequencyA', value: 1100 },
], 1500, 1500);
// 举起平板：环境让一点位置给 UI
snapshot('Tablet', [
    { strip: amb, property: 'volume', value: -7 },
], 400, 500);

// ---------- scifi/analyze_loop：去掉 level 参数后没有声音，补回时间线循环 ----------
var analyze = studio.project.lookup('event:/scifi/analyze_loop');
if (analyze && analyze.masterTrack.modules.length === 0 && analyze.groupTracks.length === 0) {
    var file = studio.project.importAudioFile(dir + 'scifi/analyze_loop.wav');
    var sound = analyze.masterTrack.addSound(analyze.timeline, 'SingleSound', 0, file.length);
    sound.audioFile = file;
    var loop = studio.project.create('LoopRegion');
    loop.position = 0;
    loop.length = file.length;
    loop.timeline = analyze.timeline;
    loop.markerTrack = analyze.markerTracks[0];
}

studio.project.save();
console.log('Mix ready: AMB/Bed|City|Crowd|RainHits, 3D Amb_1..6, snapshot:/Dream|Tablet, vca:/Ambience|SFX|UI');
