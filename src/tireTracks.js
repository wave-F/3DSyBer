import * as THREE from 'three/webgpu';
import { rng } from './textures.js';
import { DECK_Y } from './bridge.js';
import { markKeep } from './investigation/mask.js';

export function addTireTracks(scene, curve, { offsets, width, seed, opacity = 0.65, slide = 0, fadeOut = 0.06, keep = true }) {
  const meshes = [];
  const steps = 160;
  const points = curve.getSpacedPoints(steps);
  for (const [track, offset] of offsets.entries()) {
    const random = rng(seed + track * 97);
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 2048;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(canvas.width, canvas.height);
    const ribs = Array.from({ length: canvas.width }, () => 0.35 + random() * 0.65);
    for (let y = 0; y < canvas.height; y++) {
      // Canvas top maps to v=1; keep the faint entry at the start of the path.
      const t = 1 - y / (canvas.height - 1);
      const fade = THREE.MathUtils.smoothstep(t, 0, 0.15)
        * (1 - THREE.MathUtils.smoothstep(t, 1 - fadeOut, 1));
      const pressure = (0.3 + 0.7 * THREE.MathUtils.smoothstep(t, 0.1, 0.8))
        * (0.68 + 0.2 * Math.sin(t * 59 + track * 2) + 0.12 * Math.sin(t * 143));
      const center = 0.035 * Math.sin(t * 83 + track);
      const edge = 0.82 + 0.08 * Math.sin(t * 127) + random() * 0.08;
      for (let x = 0; x < canvas.width; x++) {
        const u = x / (canvas.width - 1);
        const feather = 1 - THREE.MathUtils.smoothstep(Math.abs((u - 0.5 - center) * 2), edge - 0.25, edge);
        const groove = Math.pow(Math.abs(Math.sin(u * Math.PI * 5)), 0.35);
        const grain = random() < 0.12 ? 0.05 : 0.45 + random() * 0.55;
        const i = (y * canvas.width + x) * 4;
        image.data[i] = image.data[i + 1] = image.data[i + 2] = 255;
        image.data[i + 3] = Math.round(255 * fade * pressure * feather * ribs[x] * groove * grain);
      }
    }
    ctx.putImageData(image, 0, 0);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    const material = new THREE.MeshStandardMaterial({
      map, color: 0x111316, roughness: 0.72, metalness: 0,
      transparent: true, opacity, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    if (keep) markKeep(material);
    const positions = [], uvs = [], indices = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const tangent = points[Math.min(steps, i + 1)].clone().sub(points[Math.max(0, i - 1)]).normalize();
      const normal = new THREE.Vector3(tangent.z, 0, -tangent.x);
      const slip = slide * THREE.MathUtils.smoothstep(t, 0.65, 1);
      const halfWidth = width * (1 + slip * 1.6) * 0.5;
      const drift = slip * Math.sin(t * 15 + track) * 0.12;
      for (const side of [-1, 1]) {
        const p = points[i].clone().addScaledVector(normal, offset + drift + side * halfWidth);
        positions.push(p.x, DECK_Y + 0.016 + track * 0.0002, p.z);
        uvs.push((side + 1) / 2, t);
      }
      if (i < steps) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}
