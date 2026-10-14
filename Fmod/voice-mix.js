// 只首次创作新增 DIALOGUE 的混音，不改现有 AMB / FOLEY / UI / SCIFI 或 Snapshot。
(function () {
    if (studio.project.lookup('vca:/Dialogue')) {
        console.log('Dialogue mix already authored; keeping manual settings.');
        return;
    }
    var parent = studio.project.lookup('bus:/DIALOGUE');
    if (!parent) throw new Error('Import voice events before authoring the dialogue mix.');
    var inner = studio.project.lookup('bus:/DIALOGUE/inner');
    var radio = studio.project.lookup('bus:/DIALOGUE/radio');
    var device = studio.project.lookup('bus:/DIALOGUE/device');
    inner.volume = -2;
    device.volume = -1;
    // FMOD Multiband EQ: 5 = HP24, 2 = LP24, 4 = HP12, 1 = LP12。
    function eq(bus, highpass, lowpass, highType, lowType) {
        var effect = bus.effectChain.addEffect('MultibandEqEffect');
        effect.filterTypeA = highType;
        effect.frequencyA = highpass;
        effect.filterTypeB = lowType;
        effect.frequencyB = lowpass;
        effect.filterTypeC = 0;
        effect.filterTypeD = 0;
        effect.filterTypeE = 0;
    }
    eq(radio, 280, 4400, 5, 2); // 通讯质感，不叠噪声，不牺牲关键台词清晰度。
    eq(device, 100, 10000, 4, 1); // 轻设备感，不做反派变声。
    var v = studio.project.create('MixerVCA');
    v.name = 'Dialogue';
    v.mixer = studio.project.workspace.mixer;
    parent.relationships.masters.add(v);
    studio.project.save();
    console.log('New DIALOGUE mix ready; existing mix unchanged.');
})();
