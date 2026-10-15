// 只对女 AI 的 DIALOGUE/device 加合成质感；不影响派单员无线电和男主。
(function () {
    var device = studio.project.lookup('bus:/DIALOGUE/device');
    if (!device) throw new Error('Missing DIALOGUE/device.');
    ['question2_02', 'question3_03'].forEach(function (id) {
        var event = studio.project.lookup('event:/voice/en/' + id);
        if (!event || event.mixerInput.output.getPath() !== 'bus:/DIALOGUE/device') throw new Error('Check AI routing: ' + id);
    });
    function effect(type) {
        var found = device.effectChain.effects.filter(function (e) { return e.isOfExactType(type); });
        if (found.length > 1) throw new Error('Inspect duplicate AI effects: ' + type);
        return found[0] || device.effectChain.addEffect(type);
    }
    var eq = effect('MultibandEqEffect');
    eq.filterTypeA = 4; eq.frequencyA = 140;
    eq.filterTypeB = 1; eq.frequencyB = 8500;
    eq.filterTypeC = 9; eq.frequencyC = 1700; eq.qualityC = 1.3; eq.gainC = 2;
    // 轻微共振和不自然的倍音，不做强失真，不牺牲对白可懂度。
    var flange = effect('FlangerEffect');
    flange.rate = 0.13; flange.delay = 2.2; flange.mix = 24;
    var chorus = effect('ChorusEffect');
    chorus.rate = 0.35; chorus.depth = 1.8; chorus.mix = 18;
    var compressor = effect('CompressorEffect');
    compressor.threshold = -22; compressor.ratio = 3;
    compressor.attackTime = 8; compressor.releaseTime = 100; compressor.gain = 1;
    studio.project.save();
    console.log('Female AI texture: clinical EQ, subtle flanger/chorus doubling and controlled dynamics. Bus fader unchanged.');
})();
