// FMOD Studio 官方脚本：根据 Assets/ 下编辑好的 WAV 生成游戏 Event、混音总线和 Main Bank。
// 通过 npm run audio:events 执行。脚本管理的文件夹（ui / scifi）会被整体重建，
// amb 和 foley（FootStep / ClothFoley）是手工制作的，这里不碰；
// 它的 3D 定位、子总线、Snapshot、VCA 由 setup-mix.js 搭（重建后要再跑 npm run audio:mix）。
var dir = studio.project.filePath.replace(/[^/]+$/, '') + 'Assets/';
var ws = studio.project.workspace;

// ---------- 总线：AMB / FOLEY / UI / SCIFI ----------
var BUSES = { AMB: -2, FOLEY: 0, UI: -3, SCIFI: -1 };
var buses = {};
Object.keys(BUSES).forEach(function (name) {
    var bus = studio.project.lookup('bus:/' + name);
    if (!bus) {
        bus = studio.project.create('MixerGroup');
        bus.name = name;
        bus.output = ws.mixer.masterBus;
    }
    bus.volume = BUSES[name];
    buses[name] = bus;
});

var bank = studio.project.lookup('bank:/Main');
if (!bank) {
    bank = studio.project.create('Bank');
    bank.name = 'Main';
    bank.folder = ws.masterBankFolder;
}

function folder(name) {
    var old = ws.masterEventFolder.getItem(name);
    if (old) studio.project.deleteObject(old);
    var f = studio.project.create('EventFolder');
    f.name = name;
    f.folder = ws.masterEventFolder;
    return f;
}

function asset(path) {
    var a = studio.project.importAudioFile(dir + path + '.wav');
    if (!a) throw new Error('Cannot import ' + path);
    return a;
}

function randomize(sound, pitch, volume) {
    if (pitch) sound.addModulator('RandomizerModulator', 'pitch').amount = pitch;       // 半音
    if (volume) sound.addModulator('RandomizerModulator', 'volume').amount = volume;    // dB
}

function newEvent(f, name, bus) {
    var e = studio.project.create('Event');
    e.name = name;
    e.folder = f;
    e.mixerInput.output = buses[bus];
    e.relationships.banks.add(bank);
    return e;
}

// 一次性事件：一个或多个文件（多个时用 Multi Instrument 随机、不重复上一条）
function oneShot(f, name, bus, files, opts) {
    opts = opts || {};
    var e = newEvent(f, name, bus);
    var assets = files.map(asset);
    var len = Math.max.apply(null, assets.map(function (a) { return a.length; }));
    var sound;
    if (assets.length === 1) {
        sound = e.masterTrack.addSound(e.timeline, 'SingleSound', 0, len);
        sound.audioFile = assets[0];
    } else {
        sound = e.masterTrack.addSound(e.timeline, 'MultiSound', 0, len);
        sound.playlistMode = 1; // 打乱
        assets.forEach(function (a) {
            var s = studio.project.create('SingleSound');
            s.audioFile = a;
            sound.relationships.sounds.add(s);
        });
    }
    sound.looping = false;
    randomize(sound, opts.pitch, opts.volume);
    if (opts.max) { e.maxVoices = opts.max; }
    return e;
}

// 循环事件：时间线 + Loop Region，触发一次后一直循环，停止时淡出
function loop(f, name, bus, file, fade) {
    var e = newEvent(f, name, bus);
    var a = asset(file);
    var sound = e.masterTrack.addSound(e.timeline, 'SingleSound', 0, a.length);
    sound.audioFile = a;
    var region = studio.project.create('LoopRegion');
    region.position = 0;
    region.length = a.length;
    region.timeline = e.timeline;
    region.markerTrack = e.markerTracks[0];
    var adsr = e.masterTrack.mixerGroup.addModulator('ADSRModulator', 'volume');
    adsr.initialValue = -80;
    adsr.attackTime = fade;
    adsr.releaseTime = fade;
    return e;
}

var ui = folder('ui');
oneShot(ui, 'click', 'UI', ['ui/click'], { pitch: 0.5 });
oneShot(ui, 'hover', 'UI', ['ui/hover'], { pitch: 0.8, max: 2 });
oneShot(ui, 'deny', 'UI', ['ui/deny'], { max: 1 });
oneShot(ui, 'panel_open', 'UI', ['ui/panel_open']);
oneShot(ui, 'panel_close', 'UI', ['ui/panel_close']);
oneShot(ui, 'toast', 'UI', ['ui/toast']);
oneShot(ui, 'confirm', 'UI', ['ui/confirm']);
oneShot(ui, 'record', 'UI', ['ui/record']);
oneShot(ui, 'radio_on', 'UI', ['ui/radio_on']);
oneShot(ui, 'radio_off', 'UI', ['ui/radio_off']);

var scifi = folder('scifi');
oneShot(scifi, 'scan_pulse', 'SCIFI', ['scifi/scan_pulse'], { pitch: 0.6 });
loop(scifi, 'analyze_loop', 'SCIFI', 'scifi/analyze_loop', 120);
oneShot(scifi, 'analyze_complete', 'SCIFI', ['scifi/analyze_complete']);
oneShot(scifi, 'analyze_cancel', 'SCIFI', ['scifi/analyze_cancel']);
oneShot(scifi, 'dream_enter', 'SCIFI', ['scifi/dream_enter']);
oneShot(scifi, 'dream_exit', 'SCIFI', ['scifi/dream_exit']);

ws.builtBanksOutputDirectory = '';
studio.project.save();
console.log('Ready: ui / scifi -> Main bank; manual amb / foley preserved');
