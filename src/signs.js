import * as THREE from 'three/webgpu';
import { gameTime } from './investigation/clock.js';
import { texture, uv, vec2, float, sin, fract, floor, hash, step } from 'three/tsl';
import { neonSignTexture, lightboxTexture, loadTexture } from './textures.js';

const UP = new THREE.Vector3(0, 1, 0);

const NEON_HEX = ['#20f0ff', '#ff2a9a', '#ffd23a', '#a060ff', '#ff3040', '#40ff90'];
const V_WORDS = ['居酒屋', '拉面', '义体诊所', '夜城', '寿司', '烧肉', '网咖', '旅馆', '按摩', '药', '酒', 'カラオケ', 'ホテル', '珈琲', '電脳', '整形', '麻雀', '当铺'];
const H_WORDS = ['NEOTEK', 'SYNAPSE', 'RAMEN 24H', 'HOTEL LUNA', 'BAR 66', 'CHROME', 'KARAOKE', '電脳街', 'NIGHT MARKET', 'BRAINDANCE', '新宿', 'PACHINKO'];
const BOX_COLORS = [['#ffe14a', '#1a1208'], ['#f4f4ee', '#c01020'], ['#ff5a2a', '#ffffff'], ['#2ad4ff', '#04121a'], ['#ff3a8a', '#ffffff']];
const ADS_H = [['ad_drink.jpg', 1], ['ad_ramen.jpg', 1], ['ad_whisky.jpg', 860 / 480]];
const ADS_V = [['ad_idol.jpg', 1], ['ad_arm.jpg', 1]];

export function createSignKit(scene, r) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const signMat = (tex, k = 1.8) => {
    const m = new THREE.MeshBasicMaterial({ map: tex });
    m.color.setScalar(k);
    return m;
  };
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.4, metalness: 0.8 });

  // 预生成并复用的招牌材质
  const vNeon = V_WORDS.map((w, i) => signMat(neonSignTexture(w, NEON_HEX[i % NEON_HEX.length], true)));
  const hNeon = H_WORDS.map((w, i) => signMat(neonSignTexture(w, NEON_HEX[(i + 2) % NEON_HEX.length], false)));
  const vBox = V_WORDS.slice(0, 10).map((w, i) => { const [b, t] = BOX_COLORS[i % BOX_COLORS.length]; return signMat(lightboxTexture(w, b, t, true), 1.2); });
  const edgeMats = NEON_HEX.map((h) => { const m = new THREE.MeshBasicMaterial({ color: h }); m.color.multiplyScalar(4); return m; });

  const adsH = ADS_H.map(([f, a]) => ({ tex: loadTexture(`gen/${f}`), aspect: a }));
  const adsV = ADS_V.map(([f, a]) => ({ tex: loadTexture(`gen/${f}`), aspect: a }));

  const box = new THREE.BoxGeometry(1, 1, 1);
  const plane = new THREE.PlaneGeometry(1, 1);
  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();

  function place(mesh, face, u, y, out, basis) {
    _p.copy(face.c).addScaledVector(face.t, u).addScaledVector(face.n, out);
    _p.y = y;
    _m.makeBasis(...basis).setPosition(_p);
    mesh.applyMatrix4(_m);
    scene.add(mesh);
    return mesh;
  }

  // 竖向挑牌：垂直于立面伸出，两面发光，侧边是霓虹色灯管
  function blade(face, u, y, w, h) {
    const vertical = r() < 0.7 ? (r() < 0.65 ? vNeon : vBox) : null;
    const mat = vertical ? pick(vertical) : pick(vNeon);
    const img = mat.map.image;
    const hh = Math.min(h, w * (img.height / img.width) * 1.0);
    const edge = pick(edgeMats);
    const mesh = new THREE.Mesh(box, [edge, edge, edge, edge, mat, mat]);
    mesh.scale.set(w, hh, 0.35);
    const z = new THREE.Vector3().crossVectors(face.n, UP);
    place(mesh, face, u, y, face.dep + 0.4 + w / 2, [face.n, UP, z]);
    // 支架
    const arm = new THREE.Mesh(box, frameMat);
    arm.scale.set(0.5, 0.12, 0.12);
    place(arm, face, u, y + hh / 2 - 0.3, face.dep + 0.2, [face.n, UP, z]);
    return hh;
  }

  // 平贴招牌：底板 + 发光面 + 外框灯管
  function flat(face, u, y, maxW, maxH, vertical) {
    const mat = vertical ? pick(r() < 0.5 ? vNeon : vBox) : pick(hNeon);
    const img = mat.map.image;
    let w = maxW, h = w * img.height / img.width;
    if (h > maxH) { h = maxH; w = h * img.width / img.height; }
    const panel = new THREE.Mesh(plane, mat);
    panel.scale.set(w, h, 1);
    place(panel, face, u, y, face.dep + 0.22, [face.t, UP, face.n]);
    const back = new THREE.Mesh(box, frameMat);
    back.scale.set(w + 0.3, h + 0.3, 0.2);
    place(back, face, u, y, face.dep + 0.1, [face.t, UP, face.n]);
    return { w, h };
  }

  // LED 大屏：广告图 + 扫描线 + 轻微闪烁 + 偶发故障条纹
  function screenMaterial(ad, aspect) {
    const phase = r() * 100;
    let tuv = uv();
    // 居中裁切到屏幕比例
    if (aspect > ad.aspect) tuv = vec2(tuv.x, tuv.y.sub(0.5).mul(ad.aspect / aspect).add(0.5));
    else tuv = vec2(tuv.x.sub(0.5).mul(aspect / ad.aspect).add(0.5), tuv.y);
    const t = gameTime.add(phase);
    const glitchOn = step(fract(t.mul(0.13)), float(0.025));
    const band = hash(floor(tuv.y.mul(24)).add(floor(t.mul(30))));
    const guv = vec2(tuv.x.add(band.sub(0.5).mul(0.08).mul(glitchOn)), tuv.y);
    const scan = sin(uv().y.mul(700)).mul(0.1).add(0.9);
    const flick = sin(t.mul(41)).mul(0.025).add(0.975);
    const m = new THREE.MeshBasicNodeMaterial();
    m.colorNode = texture(ad.tex, guv).rgb.mul(scan).mul(flick).mul(2.4);
    return m;
  }

  function screen(face, u, y, w, h) {
    const vertical = h > w;
    const ad = pick(vertical ? adsV : adsH);
    const panel = new THREE.Mesh(plane, screenMaterial(ad, w / h));
    panel.scale.set(w, h, 1);
    place(panel, face, u, y, face.dep + 0.32, [face.t, UP, face.n]);
    const back = new THREE.Mesh(box, frameMat);
    back.scale.set(w + 0.6, h + 0.6, 0.3);
    place(back, face, u, y, face.dep + 0.15, [face.t, UP, face.n]);
    const edge = new THREE.Mesh(box, pick(edgeMats));
    edge.scale.set(w + 0.7, 0.12, 0.34);
    place(edge, face, u, y - h / 2 - 0.35, face.dep + 0.17, [face.t, UP, face.n]);
    return panel;
  }

  // 楼顶广告牌：钢架 + 大屏
  function rooftop(cx, y, cz, normal, w, h) {
    const n = normal.clone();
    const t = new THREE.Vector3().crossVectors(UP, n);
    const face = { c: new THREE.Vector3(cx, 0, cz), t, n, dep: 0 };
    const ad = pick(adsH);
    const panel = new THREE.Mesh(plane, screenMaterial(ad, w / h));
    panel.scale.set(w, h, 1);
    place(panel, face, 0, y + 3 + h / 2, 0.2, [t, UP, n]);
    const back = new THREE.Mesh(box, frameMat);
    back.scale.set(w + 0.5, h + 0.5, 0.3);
    place(back, face, 0, y + 3 + h / 2, 0, [t, UP, n]);
    for (const k of [-0.4, 0, 0.4]) {
      const leg = new THREE.Mesh(box, frameMat);
      leg.scale.set(0.3, 3.2, 0.3);
      place(leg, face, k * w, y + 1.6, -0.3, [t, UP, n]);
    }
  }

  return { blade, flat, screen, rooftop, neonHex: NEON_HEX };
}
