// Storage helpers for window.storage API
export const store = {
  async get(key) {
    try {
      const r = await window.storage.get(key);
      if (r && r.value) {
        try {
          return JSON.parse(r.value);
        } catch {
          return null;
        }
      }
      return null;
    } catch {
      return null;
    }
  },
  async set(key, val) {
    try {
      await window.storage.set(key, JSON.stringify(val));
      return true;
    } catch {
      return false;
    }
  },
  async list(prefix) {
    try {
      const r = await window.storage.list(prefix);
      return r?.keys || [];
    } catch {
      return [];
    }
  },
  async del(key) {
    try {
      await window.storage.delete(key);
      return true;
    } catch {
      return false;
    }
  }
};
