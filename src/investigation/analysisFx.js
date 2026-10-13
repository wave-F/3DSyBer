import * as THREE from 'three/webgpu';
import {
  uniform, float, vec3, vec4, screenUV, getViewPosition, fract, fwidth, min, smoothstep, mix, luminance, step,
  uv, normalView, positionViewDirection,
} from 'three/tsl';

// 分析模式后期：灰蓝去饱和 + 世界空间网格 + 以玩家为中心扩散的扫描波
// keep 通道为 1 的像素（线索、重建全息）保留原色
export function createAnalysisFx(scene, camera) {
  const amount = uniform(0);
  const focus = uniform(0);
  const pulseR = uniform(0);
  const pulseA = uniform(0);
  const camPos = uniform(new THREE.Vector3());
  const pulseCenter = uniform(new THREE.Vector3());   // 扫描波中心（扫描设备位置）
  const camWorld = uniform(new THREE.Matrix4());
  const projInv = uniform(new THREE.Matrix4());
  const readCenter = uniform(new THREE.Vector3());
  const readAxis = uniform(new THREE.Vector3(1, 0, 0));
  const readRadius = uniform(1);
  const readProgress = uniform(0);
  const readPower = uniform(0);
  const readConfirm = uniform(0);
  const state = { target: 0, focus: false, pulsing: false, reading: false, complete: false, confirmT: 0 };
  const PULSE_MAX = 70;

  // A depth-tested haze, not a solid laser or a light that washes out the evidence.
  const beamPower = uniform(0);
  const beamMat = new THREE.MeshBasicNodeMaterial({
    color: 0x9edeea, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const beamEdge = normalView.dot(positionViewDirection).abs().pow(1.4);
  beamMat.opacityNode = beamEdge.mul(uv().y.mul(uv().y.oneMinus()).mul(4)).mul(beamPower);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.006, 1, 16, 1, true), beamMat);
  beam.name = 'Analysis_Scan_Beam';
  beam.visible = false;
  scene.add(beam);
  const beamEnd = new THREE.Vector3(), beamDir = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

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
    const baseScene = mix(scene, fx, amount.mul(float(1).sub(uiMask)));

    // Depth reconstruction puts the scan on visible surfaces, never through the car or on the sky.
    const local = wp.sub(readCenter);
    const region = float(1).sub(smoothstep(readRadius.mul(0.72), readRadius, local.length()));
    const sweep = readProgress.mul(2).sub(1).mul(readRadius);
    const offset = local.dot(readAxis).sub(sweep);
    const band = float(1).sub(smoothstep(0.006, 0.035, offset.abs()));
    const trail = smoothstep(-0.3, 0, offset).mul(float(1).sub(step(0, offset)));
    const fineCell = wp.mul(8);
    const fineD = fract(fineCell.sub(0.5)).sub(0.5).abs().div(fwidth(fineCell).max(1e-4));
    const fineGrid = float(1).sub(min(min(fineD.x, fineD.y), fineD.z).clamp(0, 1));
    const scan = band.mul(0.32).add(trail.mul(fineGrid).mul(0.065)).mul(readPower);
    const confirmation = fineGrid.mul(0.12).add(0.035).mul(readConfirm);
    const signal = scan.add(confirmation).mul(region).mul(isGeo).mul(float(1).sub(uiMask));
    return baseScene.add(vec3(0.35, 0.7, 0.76).mul(signal));
  }

  function update(dt, emitter) {
    focus.value += ((state.focus ? 1 : 0) - focus.value) * Math.min(1, dt * 8);
    camera.updateMatrixWorld();
    camWorld.value.copy(camera.matrixWorld);
    projInv.value.copy(camera.projectionMatrixInverse);
    camPos.value.copy(camera.position);
    const reading = state.reading && !state.complete;
    // Stop immediately on release/target change; only the instrument light has a soft decay.
    readPower.value = reading ? THREE.MathUtils.smoothstep(readProgress.value, 0, 0.12) : 0;
    if (state.complete) state.confirmT += dt;
    readConfirm.value = state.complete ? Math.max(0, 1 - state.confirmT / 0.35) : 0;
    beam.visible = reading && readPower.value > 0.01 && !!emitter;
    if (beam.visible) {
      beamEnd.copy(readCenter.value).addScaledVector(readAxis.value, (readProgress.value * 2 - 1) * readRadius.value);
      beamDir.subVectors(beamEnd, emitter);
      const length = beamDir.length();
      beam.position.copy(emitter).add(beamEnd).multiplyScalar(0.5);
      beam.scale.set(1, length, 1);
      beam.quaternion.setFromUnitVectors(up, beamDir.normalize());
      beamPower.value = 0.045 * readPower.value;
    }
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
    setFocus(on) {
      state.focus = on;
      if (!on) { state.reading = false; state.complete = false; }
    },
    analyze(target, radius, progress) {
      if (!target) { state.reading = false; state.complete = false; return; }
      if (!state.reading || !readCenter.value.equals(target)) {
        readAxis.value.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
        state.complete = false;
      }
      readCenter.value.copy(target);
      readRadius.value = radius;
      // Allow the hand to raise before the single left-to-right sweep begins.
      readProgress.value = THREE.MathUtils.clamp((progress - 0.3) / 0.7, 0, 1);
      if (progress >= 1 && !state.complete) state.confirmT = 0;
      state.complete = progress >= 1;
      state.reading = true;
    },
    pulse(origin) {
      pulseCenter.value.copy(origin ?? camera.position);
      pulseR.value = 0; pulseA.value = 1; state.pulsing = true;
    },
    get pulseRadius() { return state.pulsing ? pulseR.value : Infinity; },
    get pulsing() { return state.pulsing; },
  };
}
