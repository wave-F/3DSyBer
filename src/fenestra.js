import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, texture, uniform, positionWorld, normalWorld, cameraPosition,
  vertexColor, min, max, mix, clamp, step, floor, fract, abs, normalize, dot,
} from 'three/tsl';

// Interior mapping from three-fenestra (MIT, codedgar), rewritten in TSL for WebGPU.
// The original ships GLSL for MeshStandardMaterial; this scene is WebGPU/TSL, so only
// the public room-box math is ported: imHash / imAtlasUV / imRoomBoxUV.

const COLS = 4;
const ROWS = 4;

function loadAtlas(url) {
  const tex = new THREE.TextureLoader().load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  return tex;
}

export const fenestra = {
  on: uniform(1),
  depth: uniform(1.15),
  backScale: uniform(0.62),
  gain: uniform(0.25),
  floor: uniform(0.85),
  cellX: uniform(3.0),
  cellY: uniform(3.0),
  cellZ: uniform(3.4),
  litLo: uniform(0.012),
  litHi: uniform(0.05),
  warm: uniform(1.7),
  cool: uniform(1.25),
};

const rooms = loadAtlas(`${import.meta.env.BASE_URL}assets/fenestra/rooms.webp`);

const imHash = Fn(([p, seed]) => {
  const q = fract(p.mul(0.3183099).add(vec3(0.1, 0.2, 0.3)).add(seed)).mul(17.0);
  return fract(q.x.mul(q.y).mul(q.z).mul(q.x.add(q.y).add(q.z)));
});

const imAtlasUV = Fn(([cellUV, id, cols, rows, seed]) => {
  const total = cols.mul(rows);
  const idx = floor(imHash(id, seed).mul(total));
  const col = idx.mod(cols);
  const row = floor(idx.div(cols));
  const cellSize = vec2(float(1).div(cols), float(1).div(rows));
  const inset = cellSize.mul(0.001);
  const cellOrigin = vec2(col.mul(cellSize.x), float(1).sub(row.add(1).mul(cellSize.y))).add(inset);
  return cellOrigin.add(clamp(cellUV, 0, 1).mul(cellSize.sub(inset.mul(2))));
});

const imRoomBoxUV = Fn(([camLocal, localXY, depth, backScale]) => {
  const origin = vec3(localXY.x, localXY.y, 0);
  const dir = normalize(origin.sub(camLocal));
  const invDir = float(1).div(dir);
  const tNear = vec3(-0.5, -0.5, depth.negate()).sub(origin).mul(invDir);
  const tFar = vec3(0.5, 0.5, 0).sub(origin).mul(invDir);
  const tMax = max(tNear, tFar);
  const t = min(min(tMax.x, tMax.y), tMax.z);
  const hit = origin.add(dir.mul(t));
  const bs = clamp(backScale, 0.05, 0.999);
  const camDist = bs.mul(depth).div(float(1).sub(bs));
  const scale = camDist.div(camDist.sub(hit.z));
  return hit.xy.mul(scale).add(0.5);
});

// 模型楼玻璃是整面，窗格跟烘焙亮窗同一套格子（city_bake.py CELL）。
// 每格中心当一扇窗，后面一个房间。
export function fenestraRoom(tint) {
  const p = positionWorld;
  const n = normalize(normalWorld);
  const facingX = step(abs(n.z), abs(n.x));
  const along = mix(p.x, p.z, facingX);
  const up = p.y;
  const alongSize = mix(fenestra.cellX, fenestra.cellZ, facingX);
  const upSize = fenestra.cellY;
  const depthSize = mix(fenestra.cellZ, fenestra.cellX, facingX);
  const cellAlong = floor(along.div(alongSize));
  const cellUp = floor(up.div(upSize));
  const centerAlong = cellAlong.add(0.5).mul(alongSize);
  const centerUp = cellUp.add(0.5).mul(upSize);
  const localXY = vec2(along.sub(centerAlong).div(alongSize), up.sub(centerUp).div(upSize));
  const cam = cameraPosition;
  const camAlong = mix(cam.x, cam.z, facingX);
  const camZ = dot(cam.sub(p), n);
  const camLocal = vec3(camAlong.sub(centerAlong).div(alongSize), cam.y.sub(centerUp).div(upSize), camZ.div(depthSize));
  const side = floor(mix(p.z, p.x, facingX).mul(0.05));
  const id = vec3(cellAlong, cellUp, side).add(100);
  const cellUV = imRoomBoxUV(camLocal, localXY, fenestra.depth, fenestra.backScale);
  const roomUV = imAtlasUV(cellUV, id, float(COLS), float(ROWS), float(0));
  const room = texture(rooms, roomUV).rgb;
  const warm = step(vertexColor().g, vertexColor().r);
  const warmTone = vec3(fenestra.warm, fenestra.warm.mul(0.74), fenestra.warm.mul(0.42));
  const coolTone = vec3(fenestra.cool.mul(0.58), fenestra.cool.mul(0.72), fenestra.cool);
  const tone = mix(coolTone, warmTone, warm);
  const roomLit = room.mul(tone).mul(max(tint, fenestra.floor)).mul(fenestra.gain);
  return mix(tint, roomLit, fenestra.on);
}

export const FENESTRA_PANEL = [
  ['窗格', null],
  ['cellX', '横向格', 1, 8, 0.05],
  ['cellY', '纵向格', 1, 8, 0.05],
  ['cellZ', '层高格', 1, 8, 0.05],
  ['litLo', '亮窗起', 0, 0.3, 0.002],
  ['litHi', '亮窗满', 0.002, 0.5, 0.002],
  ['房间', null],
  ['depth', '深度', 0.2, 4, 0.01],
  ['backScale', '后墙占比', 0.05, 0.99, 0.01],
  ['gain', '亮度', 0, 4, 0.01],
  ['floor', '亮度下限', 0, 2, 0.01],
  ['warm', '暖色', 0, 3, 0.01],
  ['cool', '冷色', 0, 3, 0.01],
];
