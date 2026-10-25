// Refresh mounted customer pages after restocks and when returning to the tab.
export function watchCatalog(refresh) {
  let stopped = false;
  let pending = false;
  const run = async () => {
    if (stopped || pending) return;
    pending = true;
    try { await refresh(); } finally { pending = false; }
  };
  const visible = () => { if (!document.hidden) run(); };
  run();
  const timer = window.setInterval(visible, 10000);
  window.addEventListener('focus', visible);
  document.addEventListener('visibilitychange', visible);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener('focus', visible);
    document.removeEventListener('visibilitychange', visible);
  };
}
