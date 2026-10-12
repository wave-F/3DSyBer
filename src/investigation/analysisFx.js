import * as THREE from 'three/webgpu';
import {
  uniform, float, vec3, vec4, screenUV, getViewPosition, fract, fwidth, min, smoothstep, mix, luminance, step,
} from 'three/tsl';

// 分析模式后期：灰蓝去饱和 + 世界空间网格 + 以玩家为中心扩散的扫描波
// keep 通道为 1 的像素（线索、重建全息）保留原色
export function createAnalysisFx(camera) {
  const amount = uniform(0);
  const focus = uniform(0);
  const pulseR = uniform(0);
  const pulseA = uniform(0);
  const camPos = uniform(new THREE.Vector3());
  const pulseCenter = uniform(new THREE.Vector3());   // 扫描波中心（扫描设备位置）
  const camWorld = uniform(new THREE.Matrix4());
  const projInv = uniform(new THREE.Matrix4());
  const state = { target: 0, focus: false, pulsing: false };
  const PULSE_MAX = 70;

  // uiMask：第一人称手和设备所在像素，不做灰蓝化、不画网格
  function apply(hdr, depthNode, keepNode, uiMask = float(0)) {
    const depth = depthNode.r;
    const isGeo = step(depth, float(0.99999));
    const viewPos = getViewPosition(screenUV, depth, projInv);
    const wp = camWorld.mul(vec4(viewPos, 1)).xyz;
    const dist = wp.sub(camPos).length();

    // 每 1 m 一条线，按屏幕导数换算成像素距离，远近线宽一致
    const cell = wp;
    const d = fract(cell.sub(0.5)).sub(0.5).abs().div(fwidth(cell).max(1e-4));
    const line = float(1).sub(min(min(d.x, d.y), d.z).clamp(0, 1));
    const grid = line.mul(smoothstep(40, 6, dist)).mul(isGeo);

    const pd = wp.sub(pulseCenter).length();
    const ring = smoothstep(1.6, 0, pd.sub(pulseR).abs()).mul(pulseA).mul(isGeo);
    const wake = smoothstep(pulseR, pulseR.sub(12), pd).mul(step(pd, pulseR)).mul(pulseA).mul(0.25).mul(isGeo);

    const lum = luminance(hdr.rgb);
    const keep = keepNode.r.clamp(0, 1);
    const grey = vec3(lum.mul(0.85).add(0.008)).mul(vec3(0.62, 0.8, 1.0));
    // 线索保留原色并略微提亮、带一点琥珀色，黑色的胎痕也能看出来
    const base = mix(grey, hdr.rgb.mul(1.2).add(vec3(1.0, 0.55, 0.1).mul(0.05)), keep);
    const fx = base
      .add(vec3(0.12, 0.5, 1.0).mul(grid).mul(0.3))
      .add(vec3(0.35, 0.8, 1.0).mul(ring.mul(2.2).add(wake)));
    // E analysis only subdues the background; it does not enable the Q/reconstruction grid.
    const focused = mix(hdr.rgb, vec3(lum), 0.28).mul(0.86);
    const scene = mix(hdr.rgb, focused, focus.mul(float(1).sub(keep)).mul(float(1).sub(uiMask)));
    return mix(scene, fx, amount.mul(float(1).sub(uiMask)));
  }

  function update(dt) {
    focus.value += ((state.focus ? 1 : 0) - focus.value) * Math.min(1, dt * 8);
    camera.updateMatrixWorld();
    camWorld.value.copy(camera.matrixWorld);
    projInv.value.copy(camera.projectionMatrixInverse);
    camPos.value.copy(camera.position);
    // 扫描期间短暂进入灰蓝画面，随扫描波扩散逐渐淡出
    const scanAmt = state.pulsing ? Math.min(1, pulseR.value / 4) * Math.pow(pulseA.value, 0.6) * 0.85 : 0;
    const target = Math.max(state.target, scanAmt);
    amount.value += (target - amount.value) * Math.min(1, dt * (state.pulsing ? 12 : 5));
    if (state.pulsing) {
      pulseR.value += dt * 16;   // 扫描波扩散约 4.4 秒
      pulseA.value = 1 - pulseR.value / PULSE_MAX;
      if (pulseR.value >= PULSE_MAX) { state.pulsing = false; pulseA.value = 0; }
    }
  }

  return {
    apply,
    update,
    setActive(on) { state.target = on ? 1 : 0; },
    setFocus(on) { state.focus = on; },
    pulse(origin) {
      pulseCenter.value.copy(origin ?? camera.position);
      pulseR.value = 0; pulseA.value = 1; state.pulsing = true;
    },
    get pulseRadius() { return state.pulsing ? pulseR.value : Infinity; },
    get pulsing() { return state.pulsing; },
  };
}
