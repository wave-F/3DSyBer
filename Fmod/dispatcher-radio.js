// 接线员广播效果：只编辑 bus:/DIALOGUE/radio，不处理陈墨、仪器或原始 WAV。
// 显式创作脚本；手工调音后的日常同步仍只运行 audio:build。
(function () {
    var path = 'bus:/DIALOGUE/radio';
    var radio = studio.project.lookup(path);
    if (!radio) throw new Error('Missing dispatcher route: ' + path);
    var ids = ['opening_01', 'opening_03', 'call2_01', 'call2_03', 'transferred_01', 'transferred_02', 'archived_01', 'archived_02'];
    ids.forEach(function (id) {
        var event = studio.project.lookup('event:/voice/en/' + id);
        if (!event || event.mixerInput.output.getPath() !== path) throw new Error('Dispatcher routing must be checked before editing: ' + id);
    });

    function effect(type) {
        var found = radio.effectChain.effects.filter(function (e) { return e.isOfExactType(type); });
        if (found.length > 1) throw new Error('Multiple ' + type + ' effects; inspect the manual chain before authoring.');
        return found[0] || radio.effectChain.addEffect(type);
    }

    // 窄带无线电 + 轻微中频存在感，不叠持续噪声、不加会糊字的混响。
    var eq = effect('MultibandEqEffect');
    eq.filterTypeA = 5; // HP24
    eq.frequencyA = 400;
    eq.filterTypeB = 2; // LP24
    eq.frequencyB = 3400;
    eq.filterTypeC = 9; // Peaking
    eq.frequencyC = 1900;
    eq.qualityC = 1.1;
    eq.gainC = 2;

    // 通讯压缩：靠近的语气、稳定的可懂度，不改变原总线推子。
    var compressor = effect('CompressorEffect');
    compressor.threshold = -20;
    compressor.ratio = 4;
    compressor.attackTime = 4;
    compressor.releaseTime = 90;
    compressor.gain = 2.5;

    // 少量发射链路饱和，远低于 FMOD 默认 0.5；避免明显破音。
    var saturation = effect('DistortionEffect');
    saturation.level = 0.05;

    studio.project.save();
    console.log('Dispatcher broadcast ready: 400–3400 Hz, presence +2 dB, 4:1 compression, subtle saturation. Only DIALOGUE/radio changed; 8 dispatcher events covered.');
})();
