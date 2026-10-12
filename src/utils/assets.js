const base = String(import.meta.env?.BASE_URL || '/').replace(/\/?$/, '/');

export function publicAsset(path) {
  if (!path) return '';
  const value = String(path);
  if (/^(?:data:|blob:|https?:\/\/)/i.test(value)) return value;
  if (value.startsWith(base)) return value;
  return `${base}${value.replace(/^\/+/, '')}`;
}
