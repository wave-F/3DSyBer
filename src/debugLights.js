// 临时测试：按组开关光源，用来定位是哪一组在画面里发亮。
const groups = [];

export function addLightGroup(label, set, on = true) {
  groups.push({ label, on, set });
  if (!on) set(false);
  if (!import.meta.env.DEV) return;
  const row = panel.querySelector(`[data-label="${label}"]`);
  if (!row) appendRow(groups[groups.length - 1]);
}

const btn = import.meta.env.DEV ? document.createElement('button') : null;
if (btn) {
  btn.textContent = '测试 · 光源';
  btn.style.cssText = 'display:none;position:fixed;right:24px;top:68px;transform:scale(1.5);transform-origin:right top;z-index:10;padding:8px 16px;font:13px "PingFang SC",sans-serif;letter-spacing:.1em;color:#9ad7ff;background:rgba(5,12,20,.7);border:1px solid rgba(154,215,255,.6);cursor:pointer;';
  document.body.appendChild(btn);
}

const panel = document.createElement('div');
if (import.meta.env.DEV) {
  panel.style.cssText = 'display:none;position:fixed;right:24px;top:120px;z-index:10;padding:10px 12px;background:rgba(5,12,20,.82);border:1px solid rgba(154,215,255,.35);font:13px "PingFang SC",sans-serif;color:#d7ecff;';
  document.body.appendChild(panel);
}

function appendRow(g) {
  const row = document.createElement('label');
  row.dataset.label = g.label;
  row.style.cssText = 'display:flex;align-items:center;gap:8px;margin:6px 0;cursor:pointer;white-space:nowrap;';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = g.on;
  box.addEventListener('change', () => {
    g.on = box.checked;
    g.set(g.on);
  });
  row.append(box, document.createTextNode(g.label));
  panel.appendChild(row);
}

btn?.addEventListener('click', (e) => {
  e.stopPropagation();
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  btn.blur();
});
