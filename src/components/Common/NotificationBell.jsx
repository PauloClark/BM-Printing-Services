import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { orderApi } from '../../utils/orderApi';
import './NotificationBell.css';

const when = value => value ? new Date(value).toLocaleString('en-PH') : '';

export function NotificationBell({ user, onNavigate, dark = false }) {
  const [items, setItems] = useState([]), [unread, setUnread] = useState(0), [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [panelStyle, setPanelStyle] = useState({});
  const root = useRef(null), panel = useRef(null), bell = useRef(null);
  const panelId = useId();
  const load = async silent => {
    if (!silent) setLoading(true);
    try {
      const data = await orderApi('/api/notifications?limit=40', {}, user);
      setItems(data.notifications || []); setUnread(data.unreadCount || 0); setError('');
    } catch (e) { setError(e.message || 'Unable to load notifications.'); }
    finally { if (!silent) setLoading(false); }
  };
  const positionPanel = useCallback(() => {
    if (!bell.current) return;
    const rect = bell.current.getBoundingClientRect(), gutter = 12;
    const width = Math.min(390, window.innerWidth - gutter * 2);
    const preferredLeft = rect.left + width <= window.innerWidth - gutter ? rect.left : rect.right - width;
    const left = Math.min(Math.max(gutter, preferredLeft), window.innerWidth - width - gutter);
    setPanelStyle({ top: rect.bottom + 8, left, width });
  }, []);
  useEffect(() => {
    let active = true;
    const poll = async () => { if (active) await load(true); };
    load(false);
    const timer = setInterval(poll, 15000), focus = () => poll();
    window.addEventListener('focus', focus);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [user]);
  useEffect(() => {
    if (!open) return undefined;
    positionPanel();
    const close = event => { if (!root.current?.contains(event.target) && !panel.current?.contains(event.target)) setOpen(false); };
    const keyboard = event => { if (event.key === 'Escape') { setOpen(false); bell.current?.focus(); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', keyboard);
    window.addEventListener('resize', positionPanel); window.addEventListener('scroll', positionPanel, true);
    return () => {
      document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', keyboard);
      window.removeEventListener('resize', positionPanel); window.removeEventListener('scroll', positionPanel, true);
    };
  }, [open, positionPanel]);
  const read = async item => {
    if (!item.read) {
      try {
        const data = await orderApi(`/api/notifications/${item.id}/read`, { method: 'PATCH' }, user);
        setItems(current => current.map(row => row.id === item.id ? data.notification : row));
        setUnread(value => Math.max(0, value - 1));
      } catch (e) { setError(e.message); return; }
    }
    setOpen(false); onNavigate?.(item);
  };
  const readAll = async () => {
    try {
      await orderApi('/api/notifications/read-all', { method: 'PATCH' }, user);
      const now = new Date().toISOString();
      setItems(current => current.map(item => ({ ...item, read: true, readAt: item.readAt || now })));
      setUnread(0);
    } catch (e) { setError(e.message); }
  };
  const notificationPanel = open && createPortal(
    <section ref={panel} id={panelId} className={`bm-notifications__panel${dark ? ' bm-notifications__panel--dark' : ''}`} style={panelStyle} role="dialog" aria-label="Notifications">
      <header><strong>Notifications</strong>{unread > 0 && <button type="button" onClick={readAll}>Mark all as read</button>}</header>
      <div className="bm-notifications__list">{loading ? <p>Loading notifications…</p> : error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => load(false)}>Retry</button></div> : !items.length ? <p>No notifications yet.</p> : items.map(item => <button type="button" key={item.id} className={item.read ? '' : 'is-unread'} onClick={() => read(item)}><strong>{item.title}</strong><span>{item.message}</span><small>{when(item.createdAt)}</small></button>)}</div>
    </section>, document.body
  );
  return <div className={`bm-notifications${dark ? ' bm-notifications--dark' : ''}`} ref={root}>
    <button ref={bell} className="bm-notifications__bell" type="button" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(value => !value)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>{unread > 0 && <span>{unread > 99 ? '99+' : unread}</span>}
    </button>
    {notificationPanel}
  </div>;
}
