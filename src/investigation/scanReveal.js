// 非证据交互物的扫描提示：独立于线索计数，每次扫描波只触发一次。
export function createScanReveal({ range, showTime }) {
  let remaining = 0, hit = false, flash = false;
  return {
    beginScan() { hit = false; },
    update(dt, distance, pulsing, pulseRadius, available = true) {
      if (!available) { this.clear(); return; }
      remaining = Math.max(0, remaining - dt);
      if (pulsing && !hit && distance < range && distance < pulseRadius) {
        hit = true;
        remaining = showTime;
        flash = true;
      }
    },
    clear() { remaining = 0; hit = false; flash = false; },
    get visible() { return remaining > 0; },
    takeFlash() { const value = flash; flash = false; return value; },
  };
}
