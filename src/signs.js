import * as THREE from 'three/webgpu';
import { gameTime } from './investigation/clock.js';
import { texture, uv, vec2, sin, floor, hash, step } from 'three/tsl';
import { neonSignTexture, lightboxTexture, tickerTexture, logoTexture } from './textures.js';
import { mergeStatic } from './merge.js';
import { addLightGroup } from './debugLights.js';
import { adSlot, adGeometry, adScreenMaterial, adHoloMaterial } from './ads.js';
import { fadeWithDistance } from './fog.js';

const UP = new THREE.Vector3(0, 1, 0);

export const NEON_HEX = ['#20f0ff', '#ff2a9a', '#ffd23a', '#a060ff', '#ff3040', '#40ff90'];
export const NEON = { cyan: '#20f0ff', pink: '#ff2a9a', yellow: '#ffd23a', violet: '#a060ff', red: '#ff3040', green: '#40ff90' };
const V_WORDS = ['居酒屋', '拉面', '义体诊所', '夜城', '寿司', '烧肉', '网咖', '旅馆', '按摩', '药', '酒', 'カラオケ', 'ホテル', '珈琲', '電脳', '整形', '麻雀', '当铺', '龍神', '赤鬼', '新星', '白'];
const H_WORDS = ['NEOTEK', 'SYNAPSE+', 'RAMEN 24H', 'HOTEL LUNA', 'BAR 66', 'HAMADA', 'KARAOKE', '電脳街', 'NIGHT MARKET', 'BRAINDANCE', '新宿', 'PACHINKO', 'VOLTA', 'KIROKU', 'CLUB ECLIPSE', 'GHOSTNET'];
const BOX_COLORS = [['#ffe14a', '#1a1208'], ['#f4f4ee', '#c01020'], ['#ff5a2a', '#ffffff'], ['#2ad4ff', '#04121a'], ['#ff3a8a', '#ffffff']];
// 楼顶企业标志 / 跑马灯文字（与广告图集里的虚构品牌一致）
export const BRANDS = [
  ['MIRAI BANK', '#ffd23a', 'YOUR FUTURE, SECURED'], ['KIROKU', '#ff3040', 'OPTICS'], ['HAMADA', '#20f0ff', 'CHROME'],
  ['OKAMI ARMS', '#ff3040', ''], ['TETSU', '#ffd23a', 'MOTORS'], ['DREAMLINK', '#a060ff', ''], ['SYNAPSE+', '#20f0ff', ''],
  ['SKYLINE AIR', '#40ff90', ''], ['VOLTA', '#ffd23a', 'NRG'],
];
const TICKER_TEXT = [
  ['MIRAI BANK ▸ YOUR FUTURE, SECURED ▸ 夜城证券 +3.2% ▸ ', '#ffd23a'],
  ['VOLTA NRG ▸ STAY WIRED ▸ 新品上市 ▸ HAMADA CHROME ▸ UPGRADE YOURSELF ▸ ', '#20f0ff'],
  ['NC NEWS ▸ 高架事故调查中 ▸ 请绕行 ▸ TRAFFIC ALERT ▸ ', '#ff3040'],
  ['CLUB ECLIPSE ▸ OPEN TILL DAWN ▸ DREAMLINK ▸ LIVE ANOTHER LIFE ▸ ', '#ff2a9a'],
];

export function createSignKit(scene, r) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const group = new THREE.Group(); // 所有招牌先放这里，finish() 时按材质合批
  scene.add(group);
  const signMat = (tex, k = 1.8) => {
    const m = new THREE.MeshBasicMaterial({ map: tex });
    m.color.setScalar(k);
    return m;
  };
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.4, metalness: 0.8 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.55, metalness: 0.7 });

  // 预生成并复用的招牌材质（暗版给旧招牌：亮度参差是 2077 街面的感觉）
  const vNeonTex = V_WORDS.map((w, i) => neonSignTexture(w, NEON_HEX[i % NEON_HEX.length], true));
  const hNeonTex = H_WORDS.map((w, i) => neonSignTexture(w, NEON_HEX[(i + 2) % NEON_HEX.length], false));
  const vBoxTex = V_WORDS.slice(0, 12).map((w, i) => { const [b, t] = BOX_COLORS[i % BOX_COLORS.length]; return lightboxTexture(w, b, t, true); });
  const hBoxTex = H_WORDS.slice(0, 8).map((w, i) => { const [b, t] = BOX_COLORS[(i + 1) % BOX_COLORS.length]; return lightboxTexture(w, b, t, false); });
  const vNeon = vNeonTex.map((t) => signMat(t)), vNeonDim = vNeonTex.map((t) => signMat(t, 0.8));
  const hNeon = hNeonTex.map((t) => signMat(t)), hNeonDim = hNeonTex.map((t) => signMat(t, 0.8));
  const vBox = vBoxTex.map((t) => signMat(t, 1.2)), hBox = hBoxTex.map((t) => signMat(t, 1.2));
  const vBoxDim = vBoxTex.map((t) => signMat(t, 0.55)), hBoxDim = hBoxTex.map((t) => signMat(t, 0.55));
  const edgeMats = NEON_HEX.map((h) => { const m = new THREE.MeshBasicMaterial({ color: h }); m.color.multiplyScalar(4); return m; });
  const edgeOf = (hex) => edgeMats[Math.max(0, NEON_HEX.indexOf(hex))];

  // 跑马灯：uv.x 随时间滚动（几何的 uv 已按长宽比拉开，材质可共享）
  const tickerMats = TICKER_TEXT.map(([text, color], i) => {
    const m = new THREE.MeshBasicNodeMaterial();
    const t = gameTime.mul(0.045 + i * 0.006);
    m.colorNode = texture(tickerTexture(text, color), vec2(uv().x.add(t), uv().y)).rgb.mul(2.2);
    return m;
  });
  // 楼顶标志：黑底加法混合 + 偶发掉电闪烁
  const logoMats = BRANDS.map(([text, color, sub], i) => {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const t = gameTime.add(i * 7.3);
    const blink = step(0.035, hash(floor(t.mul(9)))).mul(0.85).add(0.15);
    const off = step(0.92, hash(floor(t.mul(0.4))));   // 偶尔几秒整体闪
    const tex = logoTexture(text, color, sub);
    m.colorNode = texture(tex, uv()).rgb.mul(blink.mul(off).add(step(off, 0.5))).mul(2.6);
    m.fog = false;
    fadeWithDistance(m);
    return { m, color, aspect: tex.image.width / tex.image.height };
  });

  const box = new THREE.BoxGeometry(1, 1, 1);
  const plane = new THREE.PlaneGeometry(1, 1);
  // 轮播广告屏的中心与换图相位（广告牌刷新音效用）
  const screens = [];
  const addScreen = (panel, slot) => { screens.push({ x: panel.position.x, y: panel.position.y, z: panel.position.z, phase: slot.phase }); };
  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();

  function place(mesh, face, u, y, out, basis) {
    _p.copy(face.c).addScaledVector(face.t, u).addScaledVector(face.n, out);
    _p.y = y;
    _m.makeBasis(...basis).setPosition(_p);
    mesh.applyMatrix4(_m);
    group.add(mesh);
    return mesh;
  }
  // 局部坐标盒子：(u 沿立面, y 高度, d 离开立面方向) 的中心与尺寸
  function boxAt(face, mat, u, y, d, su, sy, sd) {
    const mesh = new THREE.Mesh(box, mat);
    mesh.scale.set(su, sy, sd);
    return place(mesh, face, u, y, d, [face.t, UP, face.n]);
  }
  // 撑杆：从 d0 到 d1（d 是离立面的距离）
  function struts(face, us, ys, d0, d1, s = 0.14) {
    if (d1 - d0 < 0.05) return;
    for (const u of us) for (const y of ys) boxAt(face, steelMat, u, y, (d0 + d1) / 2, s, s, d1 - d0);
  }

  // 指定颜色时只从该色的霓虹字里挑
  const byHex = (mats, offset, hex) => {
    const l = mats.filter((_, i) => NEON_HEX[(i + offset) % NEON_HEX.length] === hex);
    return l.length ? l : mats;
  };

  // 竖向挑牌：垂直于立面伸出，两面发光，侧边是霓虹色灯管
  function blade(face, u, y, w, h, hex, opt = {}) {
    const list = opt.box ? (opt.dim ? vBoxDim : vBox) : (opt.dim ? vNeonDim : vNeon);
    const mat = hex && !opt.box ? pick(byHex(list, 0, hex)) : (r() < 0.7 ? pick(list) : pick(r() < 0.65 ? vNeon : vBox));
    const img = mat.map.image;
    const hh = Math.min(h, w * (img.height / img.width) * 1.0);
    const edge = hex ? edgeOf(hex) : pick(edgeMats);
    const mesh = new THREE.Mesh(box, [edge, edge, edge, edge, mat, mat]);
    mesh.scale.set(w, hh, 0.35);
    const z = new THREE.Vector3().crossVectors(face.n, UP);
    place(mesh, face, u, y, face.dep + 0.4 + w / 2, [face.n, UP, z]);
    // 支架：上下两根横杆（gap = 安装面到墙的距离，横杆往墙里加长）
    const g = opt.gap ?? 0;
    for (const dy of [hh / 2 - 0.3, -hh / 2 + 0.3]) {
      const arm = new THREE.Mesh(box, frameMat);
      arm.scale.set(0.5 + g, 0.12, 0.12);
      place(arm, face, u, y + dy, face.dep + 0.2 - g / 2, [face.n, UP, z]);
    }
    return hh;
  }

  // 平贴招牌：底板 + 发光面（+ 撑杆，gap 是底板背面到墙的距离）
  function flat(face, u, y, maxW, maxH, vertical, hex, opt = {}) {
    let mat;
    if (opt.box) mat = pick(vertical ? (opt.dim ? vBoxDim : vBox) : (opt.dim ? hBoxDim : hBox));
    else {
      const list = vertical ? (opt.dim ? vNeonDim : vNeon) : (opt.dim ? hNeonDim : hNeon);
      mat = hex ? pick(byHex(list, vertical ? 0 : 2, hex)) : vertical ? pick(r() < 0.5 ? vNeon : vBox) : pick(hNeon);
    }
    const img = mat.map.image;
    let w = maxW, h = w * img.height / img.width;
    if (h > maxH) { h = maxH; w = h * img.width / img.height; }
    const panel = new THREE.Mesh(plane, mat);
    panel.scale.set(w, h, 1);
    place(panel, face, u, y, face.dep + 0.22, [face.t, UP, face.n]);
    boxAt(face, frameMat, u, y, face.dep + 0.1, w + 0.3, h + 0.3, 0.2);
    if (opt.gap) struts(face, [u - w * 0.35, u + w * 0.35], [y], face.dep - opt.gap, face.dep, 0.1);
    return { w, h };
  }

  // LED 大屏（墙面）：图集轮播 + 底板 + 底边灯条（+ 撑杆）
  function screen(face, u, y, w, h, opt = {}) {
    const slot = opt.slot ?? adSlot(h > w ? 1 : 0);
    const panel = new THREE.Mesh(adGeometry(w, h, slot), adScreenMaterial());
    place(panel, face, u, y, face.dep + 0.32, [face.t, UP, face.n]);
    addScreen(panel, slot);
    boxAt(face, frameMat, u, y, face.dep + 0.15, w + 0.6, h + 0.6, 0.3);
    boxAt(face, opt.edge ? edgeOf(opt.edge) : pick(edgeMats), u, y - h / 2 - 0.35, face.dep + 0.17, w + 0.7, 0.12, 0.34);
    if (opt.gap) {
      const us = w > 8 ? [u - w * 0.4, u, u + w * 0.4] : [u - w * 0.35, u + w * 0.35];
      struts(face, us, [y - h * 0.35, y + h * 0.35], face.dep - opt.gap, face.dep);
    }
    return slot;
  }

  // 竖向巨型 LED：钢架立在墙外（gap = 钢架背面到墙），四周框梁 + 横撑 + 顶部灯条
  function vscreen(face, u, y, w, h, gap, edgeHex) {
    const slot = adSlot(1);
    const panel = new THREE.Mesh(adGeometry(w, h, slot), adScreenMaterial());
    place(panel, face, u, y, face.dep + 0.62, [face.t, UP, face.n]);
    addScreen(panel, slot);
    boxAt(face, frameMat, u, y, face.dep + 0.3, w + 0.5, h + 0.5, 0.6);            // 箱体
    for (const s of [-1, 1]) boxAt(face, steelMat, u + s * (w / 2 + 0.35), y, face.dep + 0.3, 0.3, h + 1.6, 0.3);   // 立柱
    boxAt(face, edgeOf(edgeHex), u, y + h / 2 + 0.45, face.dep + 0.62, w + 0.9, 0.14, 0.12);
    boxAt(face, edgeOf(edgeHex), u, y - h / 2 - 0.45, face.dep + 0.62, w + 0.9, 0.14, 0.12);
    const ys = []; for (let k = 0; k <= Math.max(2, Math.round(h / 6)); k++) ys.push(y - h / 2 + (h * k) / Math.max(2, Math.round(h / 6)));
    struts(face, [u - w / 2 - 0.35, u + w / 2 + 0.35], ys, face.dep - gap, face.dep, 0.22);
    return slot;
  }

  // 投影式全息广告：墙上投影器 + 悬在立面前的半透明画面（gap = 画面到墙的距离）
  function holo(face, u, y, w, h, gap) {
    const slot = adSlot(h > w ? 1 : 0);
    const panel = new THREE.Mesh(adGeometry(w, h, slot), adHoloMaterial());
    place(panel, face, u, y, face.dep, [face.t, UP, face.n]);
    addScreen(panel, slot);
    // 投影器：画面下方的墙上，伸出的短臂 + 发光镜头
    const py = y - h / 2 - 0.8;
    boxAt(face, frameMat, u, py, face.dep - gap + 0.5, 1.6, 0.7, 1.0);
    boxAt(face, steelMat, u, py, face.dep - gap * 0.5, 0.25, 0.25, gap);
    boxAt(face, edgeMats[0], u, py + 0.36, face.dep - gap + 0.5, 1.0, 0.06, 0.6);
    return slot;
  }

  // LED 跑马灯带：沿楼层一整条（uv 按长宽比拉开，文字比例正确）
  function ticker(face, u, y, w, h, gap, idx) {
    const g = plane.clone();
    const uvs = g.attributes.uv;
    for (let k = 0; k < uvs.count; k++) uvs.setX(k, uvs.getX(k) * (w / h) / 32);
    const mesh = new THREE.Mesh(g, tickerMats[idx % tickerMats.length]);
    mesh.scale.set(w, h, 1);
    place(mesh, face, u, y, face.dep + 0.22, [face.t, UP, face.n]);
    boxAt(face, frameMat, u, y, face.dep + 0.1, w + 0.3, h + 0.3, 0.2);
    const n = Math.max(2, Math.round(w / 6));
    const us = []; for (let k = 0; k < n; k++) us.push(u - w / 2 + 0.5 + ((w - 1) * k) / (n - 1));
    struts(face, us, [y], face.dep - gap, face.dep, 0.1);
    return TICKER_TEXT[idx % TICKER_TEXT.length][1];
  }

  // 楼顶企业标志：立体霓虹字 + 下方桁架 + 腿（gap = 腿长）
  function logo(face, u, y, w, h, gap, idx) {
    const { m, color, aspect } = logoMats[idx % logoMats.length];
    // 在 w×h 框内按字的比例放，底边对齐
    const fw = Math.min(w, h * aspect), fh = fw / aspect;
    y = y - h / 2 + fh / 2; w = fw; h = fh;
    const panel = new THREE.Mesh(plane, m);
    panel.scale.set(w, h, 1);
    place(panel, face, u, y, face.dep + 0.3, [face.t, UP, face.n]);
    const by = y - h / 2 - 0.4;
    boxAt(face, steelMat, u, by, face.dep, w, 0.4, 0.5);          // 桁架
    boxAt(face, steelMat, u, y + h * 0.1, face.dep - 0.2, w * 0.9, 0.15, 0.15);   // 背后横梁
    const n = Math.max(2, Math.round(w / 5));
    for (let k = 0; k < n; k++) {
      const uu = u - w * 0.45 + (w * 0.9 * k) / (n - 1);
      boxAt(face, steelMat, uu, by - gap / 2, face.dep, 0.25, gap, 0.25);
      boxAt(face, steelMat, uu, y, face.dep - 0.2, 0.15, h, 0.15);
    }
    return color;
  }

  // 楼顶广告牌：钢架 + 大屏（procedural 城市也用）
  function rooftop(cx, y, cz, normal, w, h, legs = 3) {
    const n = normal.clone();
    const t = new THREE.Vector3().crossVectors(UP, n);
    const face = { c: new THREE.Vector3(cx, 0, cz), t, n, dep: 0 };
    const slot = adSlot(0);
    const panel = new THREE.Mesh(adGeometry(w, h, slot), adScreenMaterial());
    place(panel, face, 0, y + legs + h / 2, 0.2, [t, UP, n]);
    addScreen(panel, slot);
    boxAt(face, frameMat, 0, y + legs + h / 2, 0, w + 0.5, h + 0.5, 0.3);
    for (const k of [-0.4, 0, 0.4]) boxAt(face, frameMat, k * w, y + legs / 2, -0.3, 0.3, legs + 0.2, 0.3);
    return slot;
  }

  const finish = () => {
    mergeStatic(group);
    addLightGroup('灯牌（自己发光，不靠灯光）', (on) => { group.visible = on; });
  };

  return { blade, flat, screen, vscreen, holo, ticker, logo, rooftop, finish, screens, neonHex: NEON_HEX };
}
