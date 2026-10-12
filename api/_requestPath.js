export function restoreApiPath(req) {
  const routedPath = req.query?.__api_path;
  if (typeof routedPath !== 'string' || !routedPath) return;
  delete req.query.__api_path;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query || {})) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) query.append(key, String(item));
    }
  }
  req.url = `/api/${routedPath}${query.size ? `?${query}` : ''}`;
}
