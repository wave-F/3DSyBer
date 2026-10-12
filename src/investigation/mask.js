import { mrt, float } from 'three/tsl';

// 分析模式下"保留原色"的遮罩：写入场景 MRT 的 keep 通道
// 线索物体和重建全息体使用，其余物体默认 0（被去饱和成灰蓝）
const KEEP = mrt({ keep: float(1) });

export function markKeep(material) {
  material.mrtNode = KEEP;
  material.needsUpdate = true;
  return material;
}
