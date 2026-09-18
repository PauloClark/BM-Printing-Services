// Storage helpers with window.storage (Tauri) and localStorage fallback
export const store = {
  async get(key) {
    try {
      if (window.storage) {
        const r = await window.storage.get(key);
        if (r && r.value) {
          try { return JSON.parse(r.value); } catch { return null; }
        }
        return null;
      }
    } catch {}
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  async set(key, val) {
    const json = JSON.stringify(val);
    try {
      if (window.storage) {
        await window.storage.set(key, json);
        return true;
      }
    } catch {}
    try {
      localStorage.setItem(key, json);
      return true;
    } catch { return false; }
  },
  async list(prefix) {
    try {
      if (window.storage) {
        const r = await window.storage.list(prefix);
        return r?.keys || [];
      }
    } catch {}
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix || '')) keys.push(k);
      }
      return keys;
    } catch { return []; }
  },
  async del(key) {
    try {
      if (window.storage) {
        await window.storage.delete(key);
        return true;
      }
    } catch {}
    try {
      localStorage.removeItem(key);
      return true;
    } catch { return false; }
  }
};
