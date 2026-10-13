import * as THREE from 'three/webgpu';

// 过场镜头：接管相机，按镜头列表硬切播放，结束后还原玩家视角
// 镜头：{ dur, from, to, lookFrom, lookTo, fov, onStart, update(u, t) }，坐标为世界坐标
export function createCutscene(camera) {
  let shots = null, i = 0, t = 0, onDone = null;
  const saved = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 65 };
  const pos = new THREE.Vector3(), look = new THREE.Vector3();
  const ease = (u) => u * u * (3 - 2 * u);

  function play(list, done) {
    saved.pos.copy(camera.position);
    saved.quat.copy(camera.quaternion);
    saved.fov = camera.fov;
    shots = list; i = 0; t = 0; onDone = done;
    shots[0].onStart?.();
  }

  function restore() {
    camera.position.copy(saved.pos);
    camera.quaternion.copy(saved.quat);
    camera.fov = saved.fov;
    camera.updateProjectionMatrix();
  }

  // 返回 true 表示仍在播放
  function update(dt) {
    if (!shots) return false;
    t += dt;
    let s = shots[i];
    while (t >= s.dur) {
      t -= s.dur;
      s.update?.(1, s.dur);
      i++;
      if (i >= shots.length) {
        shots = null;
        restore();
        const d = onDone; onDone = null;
        d?.();
        return false;
      }
      s = shots[i];
      s.onStart?.();
    }
    const u = t / s.dur;
    pos.lerpVectors(s.from, s.to ?? s.from, ease(u));
    look.lerpVectors(s.lookFrom, s.lookTo ?? s.lookFrom, ease(u));
    camera.position.copy(pos);
    camera.lookAt(look);
    if (camera.fov !== s.fov) { camera.fov = s.fov; camera.updateProjectionMatrix(); }
    s.update?.(u, t);
    return true;
  }

  return { play, update, get playing() { return !!shots; } };
}
