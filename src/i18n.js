// 全局语言。剧情对象用 bi() 包一层，读 name / lines / text 时按当前语言返回。
// 玩家选的语言存在 localStorage，刷新后沿用；隐私模式等读写失败时退回中文
const KEY = 'zero-priority.lang';
const load = () => { try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'zh'; } catch { return 'zh'; } };
let lang = load();
if (typeof document !== 'undefined') document.documentElement.dataset.lang = lang;
const listeners = new Set();

export function getLang() { return lang; }
export function isEn() { return lang === 'en'; }
export function isPlayer(who) { return who === '陈墨' || who === 'Chen Mo'; }

export function tx(zh, en) { return lang === 'en' ? en : zh; }

export function onLang(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function setLang(next) {
  const v = next === 'en' ? 'en' : 'zh';
  if (v === lang) return;
  lang = v;
  try { localStorage.setItem(KEY, v); } catch { /* 存不了就只在本次生效 */ }
  document.documentElement.dataset.lang = v;
  for (const fn of listeners) fn(v);
}

function localize(zh, en) {
  if (lang !== 'en' || en == null) return zh;
  if (Array.isArray(zh) && Array.isArray(en)) {
    return zh.map((item, i) => {
      const alt = en[i];
      if (item && typeof item === 'object') return bi(item, alt);
      return alt ?? item;
    });
  }
  if (zh && typeof zh === 'object' && typeof en === 'object' && !Array.isArray(en)) return bi(zh, en);
  return en;
}

// zh 仍是可变原对象（done、unlocked 写在上面）。英文只覆盖文案字段。
// en 也可以是函数 (target) => 英文对象，用于文案随状态变化的对象（如解锁前后的原始记录）
export function bi(zh, en) {
  if (!zh || typeof zh !== 'object') return lang === 'en' && en != null ? en : zh;
  const bagOf = typeof en === 'function' ? en : () => en;
  return new Proxy(zh, {
    get(target, prop) {
      if (prop === 'then') return undefined;
      const value = target[prop];
      const en = bagOf(target);
      if (typeof value === 'function') {
        const alt = en?.[prop];
        return (...args) => {
          const base = value.apply(target, args);
          if (lang !== 'en' || typeof alt !== 'function') return base;
          return localize(base, alt(...args));
        };
      }
      if (lang === 'en' && en && prop in en) return localize(value, en[prop]);
      return value;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
    has(target, prop) { return prop in target; },
    ownKeys(target) { return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, prop) {
      const desc = Reflect.getOwnPropertyDescriptor(target, prop);
      if (!desc) return desc;
      desc.configurable = true;
      const en = bagOf(target);
      if (lang === 'en' && en && prop in en && desc.enumerable) desc.value = localize(target[prop], en[prop]);
      return desc;
    },
  });
}
