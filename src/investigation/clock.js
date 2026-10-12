import { uniform } from 'three/tsl';

// 游戏时钟：分析/重建时世界时间冻结（带约 0.4 秒慢动作过渡），界面和全息时间照常走
export const gameTime = uniform(0);   // 世界动画用（大屏、全息广告、航空灯、跑马灯、云）
export const uiTime = uniform(0);     // 不受冻结影响（重建全息的扫描线等）

export const clock = {
  scale: 1,
  target: 1,
  dt: 0,        // 世界 dt（冻结时为 0）
  realDt: 0,
  elapsed: 0,   // 世界累计时间
};

export function tick(realDt) {
  clock.realDt = realDt;
  clock.scale += (clock.target - clock.scale) * Math.min(1, realDt * 6);
  if (clock.target === 0 && clock.scale < 0.01) clock.scale = 0;
  clock.dt = realDt * clock.scale;
  clock.elapsed += clock.dt;
  gameTime.value = clock.elapsed;
  uiTime.value += realDt;
}
