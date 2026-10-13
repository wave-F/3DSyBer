// FMOD Studio 官方脚本 API。通过 npm run audio:create-test 执行。
// 已存在的事件保持原样，避免覆盖后续在 Studio 中的编辑。
var dir = studio.project.filePath.replace(/[^/]+$/, '');
var root = studio.project.workspace.masterEventFolder;
var folder = root.getItem('test');
if (!folder) {
    folder = studio.project.create('EventFolder');
    folder.name = 'test';
    folder.folder = root;
}
var bank = studio.project.lookup('bank:/Preview');
if (!bank) {
    bank = studio.project.create('Bank');
    bank.name = 'Preview';
    bank.folder = studio.project.workspace.masterBankFolder;
}
var event = studio.project.lookup('event:/test/ping');
if (!event) {
    var asset = studio.project.importAudioFile(dir + 'Assets/test/ping.wav');
    if (!asset) throw new Error('Cannot import test/ping.wav');
    event = studio.project.create('Event');
    event.name = 'ping';
    event.folder = folder;
    var sound = event.masterTrack.addSound(event.timeline, 'SingleSound', 0, asset.length);
    sound.audioFile = asset;
    sound.length = asset.length;
    sound.properties.looping = false;
    event.relationships.banks.add(bank);
}
studio.project.workspace.builtBanksOutputDirectory = '';
studio.project.save();
console.log('Ready: event:/test/ping -> Preview');
