import { uniform } from 'three/tsl';

// 降光对比开关（按 L 切换）：0 = 原版，1 = 降光版
// 降光版只改三处：路面反射（金属度）、辉光阈值/强度、大屏投光强度
// 材质里用 uniform 混合，切换时不需要重新编译着色器
export const lowLight = uniform(0);

const lights = [];
const listeners = [];

// 登记一盏需要在降光版里换强度的灯
export function registerLight(light, lowIntensity) {
  lights.push({ light, normal: light.intensity, low: lowIntensity });
}

// 后期等非灯光参数在这里挂回调
export function onLightMode(fn) {
  listeners.push(fn);
  fn(lowLight.value === 1);
}

const label = document.createElement('div');
label.style.cssText = 'position:fixed;left:12px;top:10px;padding:4px 10px;border-radius:4px;'
  + 'background:rgba(0,0,0,0.5);color:#bff;font:13px "PingFang SC",sans-serif;pointer-events:none;z-index:10';
document.body.appendChild(label);

export function setLightMode(low) {
  lowLight.value = low ? 1 : 0;
  for (const l of lights) l.light.intensity = low ? l.low : l.normal;
  for (const fn of listeners) fn(low);
  label.textContent = `灯光：${low ? '降光版' : '原版'}  [L 切换]`;
}

addEventListener('keydown', (e) => {
  if (e.code === 'KeyL' && !e.repeat) setLightMode(lowLight.value !== 1);
});

setLightMode(false);
if (import.meta.env.DEV) window.__setLightMode = setLightMode; // 截图对比用
