import { useEffect, useState } from 'react';
import { orderApi } from '../../utils/orderApi';
import { Card } from '../Common/Card';
import { Btn } from '../Common/Btn';
import { Modal } from '../Common/Modal';
import './StaffMessages.css';

const date = value => (value ? new Date(value).toLocaleString('en-PH') : 'Not recorded');

const SENDER_LABELS = { guest: 'Guest', customer: 'Customer' };
const STATUS_LABELS = { new: 'New', read: 'Read', resolved: 'Resolved' };

const SenderBadge = ({ type }) => (
  <span className={`bm-msg-badge bm-msg-badge--${type === 'customer' ? 'customer' : 'guest'}`}>
    {SENDER_LABELS[type] || 'Guest'}
  </span>
);

const StatusBadge = ({ status }) => (
  <span className={`bm-msg-badge bm-msg-badge--${status}`}>{STATUS_LABELS[status] || status}</span>
);

export function StaffMessages({ user, showToast }) {
  const [messages, setMessages] = useState([]);
  const [unread, setUnread] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true, pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const data = await orderApi('/api/staff/messages', {}, user);
        if (!active) return;
        setMessages(Array.isArray(data.messages) ? data.messages : []);
        setUnread(Number(data.unread) || 0);
        setError('');
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        pending = false;
        if (active) setLoading(false);
      }
    };
    load();
    // Supabase Realtime does not subscribe to MongoDB, so poll like Staff Orders.
    const timer = setInterval(load, 10000);
    window.addEventListener('focus', load);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', load); };
  }, [user, refresh]);

  const selected = messages.find(m => m.id === selectedId);

  const setStatus = async status => {
    if (busy || !selected) return;
    setBusy(true);
    setActionError('');
    try {
      const data = await orderApi(`/api/staff/messages/${encodeURIComponent(selected.id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      }, user);
      setMessages(list => list.map(m => (m.id === data.message.id ? data.message : m)));
      setRefresh(n => n + 1);
      showToast?.(`Message marked as ${STATUS_LABELS[status]}.`, 'success');
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const shown = messages
    .filter(m => (statusFilter === 'All' || m.status === statusFilter)
      && [m.senderName, m.senderEmail, m.subject, m.message]
        .some(value => String(value || '').toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return (
    <section className="bm-staff-messages">
      <div className="bm-order-toolbar">
        <h2>
          Customer Inquiries
          {unread > 0 && <span className="bm-msg-count">Messages ({unread})</span>}
        </h2>
        <input
          aria-label="Search messages"
          placeholder="Name, email, subject or text"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select aria-label="Filter by status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          {['All', 'new', 'read', 'resolved'].map(s => (
            <option key={s} value={s}>{s === 'All' ? 'All' : STATUS_LABELS[s]}</option>
          ))}
        </select>
        <Btn onClick={() => setRefresh(n => n + 1)}>Refresh</Btn>
      </div>
      <p>New inquiries appear automatically every 10 seconds.</p>
      {error && <p role="alert" className="bm-order-error">{error} Use Refresh to retry.</p>}
      <Card>
        <div className="bm-order-table">
          <table>
            <thead>
              <tr>{['Sender', 'Email', 'Subject', 'Message', 'User Type', 'Date / Time', 'Status', 'Action'].map(h => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {shown.map(m => (
                <tr key={m.id} className={m.status === 'new' ? 'bm-msg-unread-row' : undefined}>
                  <td>{m.senderName}</td>
                  <td>{m.senderEmail}</td>
                  <td>{m.subject}</td>
                  <td className="bm-msg-preview">{m.message}</td>
                  <td><SenderBadge type={m.senderType} /></td>
                  <td>{date(m.createdAt)}</td>
                  <td><StatusBadge status={m.status} /></td>
                  <td>
                    <Btn size="sm" onClick={() => { setSelectedId(m.id); setActionError(''); }}>View Message</Btn>
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr><td colSpan={8}>{loading ? 'Loading messages…' : error ? 'Messages could not be loaded.' : 'No inquiries found.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={Boolean(selected)} onClose={() => !busy && setSelectedId(null)} title="Inquiry detail" width={680}>
        {selected && (
          <>
            <dl className="bm-order-details">
              <div><dt>Name</dt><dd>{selected.senderName}</dd></div>
              <div><dt>Email</dt><dd>{selected.senderEmail}</dd></div>
              <div><dt>Sender type</dt><dd><SenderBadge type={selected.senderType} /></dd></div>
              <div><dt>Registered customer</dt><dd>{selected.isRegisteredCustomer ? 'Yes — linked to an existing account' : 'No — guest sender'}</dd></div>
              <div><dt>Subject</dt><dd>{selected.subject}</dd></div>
              <div><dt>Date received</dt><dd>{date(selected.createdAt)}</dd></div>
              <div><dt>Status</dt><dd><StatusBadge status={selected.status} /></dd></div>
              {selected.readAt && <div><dt>Read at</dt><dd>{date(selected.readAt)}</dd></div>}
              {selected.resolvedAt && <div><dt>Resolved at</dt><dd>{date(selected.resolvedAt)}</dd></div>}
            </dl>
            {/* Rendered as a text node. Customer HTML is never interpreted. */}
            <h4>Message</h4>
            <p className="bm-msg-full">{selected.message}</p>
            {actionError && <p role="alert" className="bm-order-error">{actionError}</p>}
            <div className="bm-order-toolbar">
              {selected.status === 'new' && <Btn disabled={busy} loading={busy} onClick={() => setStatus('read')}>Mark as Read</Btn>}
              {selected.status !== 'resolved' && <Btn variant="secondary" disabled={busy} loading={busy} onClick={() => setStatus('resolved')}>Mark as Resolved</Btn>}
              {selected.status === 'resolved' && <Btn variant="ghost" disabled={busy} loading={busy} onClick={() => setStatus('read')}>Reopen as Read</Btn>}
              <Btn variant="ghost" disabled={busy} onClick={() => setSelectedId(null)}>Close</Btn>
            </div>
          </>
        )}
      </Modal>
    </section>
  );
}

export default StaffMessages;