import { useCallback, useEffect, useState } from 'react';
import { orderApi } from '../../utils/orderApi';
import { Card } from '../Common/Card';
import { Btn } from '../Common/Btn';
import './NotificationDeliveryAdmin.css';

const when = value => value ? new Date(value).toLocaleString('en-PH') : 'Not attempted';
const label = value => String(value || '').replaceAll('_', ' ').toLowerCase();

export function NotificationDeliveryAdmin({ user, showToast }) {
  const [data, setData] = useState({ totals: {}, events: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');

  const load = useCallback(async () => {
    try { setData(await orderApi('/api/admin/notification-delivery', {}, user)); setError(''); }
    catch (issue) { setError(issue.message || 'Unable to load delivery status.'); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [load]);

  const retry = async item => {
    const key = `${item.sourceType}:${item.eventKey}`;
    if (busyKey) return;
    setBusyKey(key); setError('');
    try {
      await orderApi('/api/admin/notification-delivery/retry', { method: 'POST', body: JSON.stringify({ sourceType: item.sourceType, sourceId: item.sourceId, eventKey: item.eventKey }) }, user);
      showToast?.('Notification retry scheduled.', 'success');
      await load();
    } catch (issue) { setError(issue.message || 'Unable to schedule retry.'); }
    finally { setBusyKey(''); }
  };

  return <section className="bm-notification-delivery">
    <header><div><span>System operations</span><h2>Notification Delivery</h2><p>Monitor durable notification intents and retry failed deliveries.</p></div><Btn onClick={load}>Refresh</Btn></header>
    <div className="bm-notification-delivery__totals">{['PENDING', 'PROCESSING', 'DELIVERED', 'FAILED'].map(state => <Card key={state}><span>{state.toLowerCase()}</span><strong>{Number(data.totals?.[state]) || 0}</strong></Card>)}</div>
    {error && <p role="alert" className="bm-notification-delivery__error">{error}</p>}
    <Card><div className="bm-notification-delivery__table-wrap"><table><thead><tr>{['Status', 'Event', 'Recipient', 'Attempts', 'Last attempt', 'Next retry', 'Error', 'Action'].map(item => <th key={item}>{item}</th>)}</tr></thead>
      <tbody>{(data.events || []).map(item => <tr key={`${item.sourceType}-${item.sourceId}-${item.eventKey}`}>
        <td><span className={`bm-notification-delivery__state is-${String(item.state).toLowerCase()}`}>{item.state}</span></td>
        <td><strong>{item.title || label(item.type)}</strong><small>{label(item.type)} · {item.sourceType}</small></td>
        <td>{item.recipientRole === 'admin' && item.sourceType !== 'production-reassignment' && item.sourceType !== 'production-exception' ? 'Admin group' : label(item.recipientRole)}</td>
        <td>{Number(item.attempts) || 0} auto / {Number(item.manualRetryCount) || 0} manual</td><td>{when(item.lastAttemptAt)}</td><td>{when(item.nextAttemptAt)}</td>
        <td className="bm-notification-delivery__error-summary">{item.lastError || '—'}</td>
        <td>{item.state === 'FAILED' && Number(item.manualRetryCount || 0) < 3 ? <Btn size="sm" disabled={Boolean(busyKey)} loading={busyKey === `${item.sourceType}:${item.eventKey}`} onClick={() => retry(item)}>Retry</Btn> : item.state === 'FAILED' ? 'Retry limit reached' : '—'}</td>
      </tr>)}
      {!data.events?.length && <tr><td colSpan={8}>{loading ? 'Loading delivery events…' : 'No notification delivery events recorded.'}</td></tr>}</tbody></table></div></Card>
    <p className="bm-notification-delivery__footnote">Successful events are retained with their delivery history. Automatic retries use bounded exponential backoff; manual retries are recorded in the event history.</p>
  </section>;
}

export default NotificationDeliveryAdmin;
