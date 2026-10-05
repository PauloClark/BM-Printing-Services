import { JobOrders, PrepareJobOrder } from './JobOrders';
import { OrderDesignFiles } from '../Common/OrderDesignFiles';
import { StaffMessages } from './StaffMessages';
import { useEffect, useState } from 'react';
import { orderApi } from '../../utils/orderApi';
import { ORDER_STATUSES, displayOrderStatus, nextOrderStatus, ORDER_ACTIONS } from '../../../shared/orderWorkflow';
import { Card } from '../Common/Card';
import { Btn } from '../Common/Btn';
import { Badge } from '../Common/Badge';
import { Modal } from '../Common/Modal';
import './StaffOrders.css';

const money = amount => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount || 0);
const date = value => value ? new Date(value).toLocaleString('en-PH') : 'Not recorded';

export function StaffOrders({ user, showToast }) {
  const [orders, setOrders] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [pickupOrder, setPickupOrder] = useState(null);
  const [pickupDetails, setPickupDetails] = useState(null);
  const [pickupLoading, setPickupLoading] = useState(false);
  const [pickupError, setPickupError] = useState('');
  const [confirmingPickup, setConfirmingPickup] = useState(false);
  const [receivedByName, setReceivedByName] = useState('');

  useEffect(() => {
    let active = true, pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const data = await orderApi('/api/staff/orders', {}, user);
        if (active) { setOrders(data.orders); setError(''); }
      } catch (e) { if (active) setError(e.message); }
      finally { pending = false; if (active) setLoading(false); }
    };
    load();
    const timer = setInterval(load, 5000);
    window.addEventListener('focus', load);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', load); };
  }, [user, refresh]);

  const selected = orders.find(o => o.id === selectedId);

  const update = async status => {
    if (busy || !selected) return;
    if (status === 'Cancelled' && !window.confirm(`Cancel order ${selected.id}? This cannot be undone.`)) return;
    if (status === 'Completed' && !window.confirm(`Mark order ${selected.id} as completed? Confirm the customer has received the order. This cannot be undone.`)) return;
    setBusy(true); setActionError('');
    try {
      const { order } = await orderApi(`/api/orders/${encodeURIComponent(selected.id)}/status`, {
        method: 'PATCH', body: JSON.stringify({ status, expectedStatus: selected.status })
      }, user);
      setOrders(list => list.map(o => o.id === order.id ? order : o));
      setRefresh(n => n + 1);
      showToast?.(`Order ${order.id}: ${order.status}`, 'success');
    } catch (e) { setActionError(e.message); setRefresh(n => n + 1); }
    finally { setBusy(false); }
  };
  const archiveSelected = async () => {
    if (user.role !== 'admin' || !selected || archiving || selected.archived || selected.status !== 'Picked Up') return;
    const confirmed = window.confirm(`Archive Order #${selected.id}?\n\nThis order has been completed and picked up. It will be moved to the completed order archive.`);
    if (!confirmed) return;
    setArchiving(true);
    setActionError('');
    try {
      const data = await orderApi(`/api/admin/orders/${encodeURIComponent(selected.id)}/archive`, { method: 'POST' }, user);
      setOrders(current => current.map(order => order.id === data.order.id ? { ...order, ...data.order } : order));
      setSelectedId(null);
      setRefresh(value => value + 1);
      showToast?.(`Order ${data.order.id} archived.`, 'success');
    } catch (e) {
      setActionError(e.message || 'Unable to archive this order.');
    } finally {
      setArchiving(false);
    }
  };

  const openPickupDetails = async (order) => {
    setPickupOrder(order);
    setPickupDetails(null);
    setPickupError('');
    setPickupLoading(true);
    setReceivedByName('');
    try {
      const data = await orderApi(`/api/orders/${encodeURIComponent(order.id)}/pickup-details`, {}, user);
      setPickupDetails(data);
    } catch (e) {
      setPickupError(e.message);
    } finally {
      setPickupLoading(false);
    }
  };

  const confirmPickup = async () => {
    if (!pickupOrder || confirmingPickup) return;
    setConfirmingPickup(true);
    setPickupError('');
    try {
      const data = await orderApi(`/api/orders/${encodeURIComponent(pickupOrder.id)}/confirm-pickup`, {
        method: 'POST',
        body: JSON.stringify({ receivedByName: receivedByName || undefined })
      }, user);
      setOrders(list => list.map(o => o.id === data.order.id ? data.order : o));
      setRefresh(n => n + 1);
      setPickupOrder(null);
      setPickupDetails(null);
      showToast?.(`Order ${data.order.id} confirmed as Picked Up. Inventory deducted.`, 'success');
    } catch (e) {
      setPickupError(e.message);
      setRefresh(n => n + 1);
    } finally {
      setConfirmingPickup(false);
    }
  };

  const shown = orders.filter(o => (filter === 'All' || displayOrderStatus(o.status) === filter) &&
    [o.id, o.customer, o.product].some(value => String(value || '').toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => Number(displayOrderStatus(b.status) === 'Pending') - Number(displayOrderStatus(a.status) === 'Pending') || new Date(b.createdAt) - new Date(a.createdAt));

  const readyForPickupCount = orders.filter(o => displayOrderStatus(o.status) === 'Ready for Pickup').length;

  return <section className="bm-staff-orders">
    {user.role === 'staff' && <JobOrders user={user} refresh={refresh} />}
    <div className="bm-order-summary">
      {[['New Orders', 'Pending'], ['Confirmed', 'Confirmed'], ['Processing', 'Processing'], ['Ready for Pickup', 'Ready for Pickup'], ['Completed', 'Completed']].map(([label, status]) =>
        <Card key={status}><strong>{orders.filter(o => displayOrderStatus(o.status) === status).length}</strong><span>{label}</span></Card>)}
    </div>
    {readyForPickupCount > 0 && (
      <div style={{ background: '#f3e5f5', border: '1px solid #ce93d8', borderRadius: 8, padding: '10px 16px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#6a1b9a' }}>
          {readyForPickupCount} order{readyForPickupCount > 1 ? 's' : ''} ready for pickup
        </span>
        <Btn size="sm" variant="primary" onClick={() => setFilter('Ready for Pickup')}>View Ready for Pickup</Btn>
      </div>
    )}
    <div className="bm-order-toolbar">
      <h2>Incoming Orders</h2>
      <input aria-label="Search orders" placeholder="Order ID, customer or product" value={search} onChange={e => setSearch(e.target.value)} />
      <select aria-label="Filter by status" value={filter} onChange={e => setFilter(e.target.value)}>{['All', ...ORDER_STATUSES].map(s => <option key={s}>{s}</option>)}</select>
      <Btn onClick={() => setRefresh(n => n + 1)}>Refresh</Btn>
    </div>
    <p>Saved orders refresh automatically every 5 seconds.</p>
    {error && <p role="alert" className="bm-order-error">{error} Use Refresh to retry.</p>}
    <Card><div className="bm-order-table"><table><thead><tr>
      {['Order ID', 'Customer', 'Date / Time', 'Product', 'Quantity', 'Total', 'Payment', 'Status', 'Action'].map(h => <th key={h}>{h}</th>)}
    </tr></thead><tbody>
      {shown.map(o => <tr key={o.id} className={displayOrderStatus(o.status) === 'Pending' ? 'bm-order-pending' : undefined}><td>{o.id}</td><td>{o.customer}</td><td>{date(o.createdAt)}</td><td>{o.product}</td><td>{o.quantity}</td><td>{money(o.total)}</td><td>{o.payment}</td><td><Badge status={displayOrderStatus(o.status)} /></td><td><div style={{ display: 'flex', gap: 4 }}><Btn size="sm" onClick={() => { setSelectedId(o.id); setActionError(''); }}>View Order</Btn>{displayOrderStatus(o.status) === 'Ready for Pickup' && <Btn size="sm" variant="primary" onClick={() => openPickupDetails(o)}>Confirm Pickup</Btn>}</div></td></tr>)}
      {!shown.length && <tr><td colSpan={9}>{loading ? 'Loading orders…' : error ? 'Orders could not be loaded.' : 'No orders found.'}</td></tr>}
    </tbody></table></div></Card>

    {/* Order Detail Modal */}
    <Modal open={Boolean(selected)} onClose={() => !busy && setSelectedId(null)} title={`Order ${selected?.id}`} width={760}>
      {selected && <>
        <h4>Customer information</h4><dl className="bm-order-details">{[['Name', selected.customer], ['Email', selected.email], ['Phone', selected.phone], ['Fulfillment / Address', selected.address]].map(([k,v]) => <div key={k}><dt>{k}</dt><dd>{v || 'Not provided'}</dd></div>)}</dl>
        <h4>Order information</h4>
        {(selected.items || []).map((item, i) => <p key={i}><strong>{item.productName}</strong> · {item.quantity} pcs · {money(item.subtotal)}</p>)}
        <dl className="bm-order-details">{[['Product specifications', selected.specs], ...(selected.designNotes && selected.designNotes !== selected.specs ? [['Design instructions', selected.designNotes]] : []), ['Customer notes', selected.notes], ['Total price', money(selected.total)], ['Date ordered', date(selected.createdAt)]].map(([k,v]) => <div key={k}><dt>{k}</dt><dd>{v || 'None provided'}</dd></div>)}</dl>
        <OrderDesignFiles order={selected} user={user} />
        <h4>Payment</h4><p>{selected.payment || 'Not recorded'}</p><p>Payment status: {selected.paymentStatus || 'Not recorded — confirm payment separately.'}</p>
        {user.role === 'admin' && <PrepareJobOrder key={selected.id} order={selected} user={user} onCreated={() => setRefresh(n => n + 1)} />}
        <h4>Processing status</h4><Badge status={displayOrderStatus(selected.status)} />
        {selected.archived && <p>Archived {date(selected.archivedAt)} by {selected.archivedByName || selected.archivedBy}</p>}
        {(error || actionError) && <p role="alert" className="bm-order-error">{actionError || error}</p>}
        <div className="bm-order-toolbar">
          {user.role === 'admin' && selected.status === 'Picked Up' && !selected.archived && <Btn disabled={archiving} loading={archiving} onClick={archiveSelected}>Archive Order</Btn>}
          {!selected.jobOrderId && nextOrderStatus(selected.status) && <><Btn disabled={busy || Boolean(error)} loading={busy} onClick={() => update(nextOrderStatus(selected.status))}>{ORDER_ACTIONS[nextOrderStatus(selected.status)]}</Btn><Btn variant="ghost" disabled={busy || Boolean(error)} onClick={() => update('Cancelled')}>Cancel Order</Btn></>}
        </div>
      </>}
    </Modal>

    {/* Pickup Details & Confirmation Modal */}
    <Modal open={Boolean(pickupOrder)} onClose={() => !confirmingPickup && !pickupLoading && setPickupOrder(null)} title={`Confirm Pickup — ${pickupOrder?.id || ''}`} width={700}>
      {pickupOrder && <>
        {pickupLoading && <p style={{ textAlign: 'center', padding: 20, color: '#666' }}>Loading pickup details...</p>}
        {pickupError && <p role="alert" className="bm-order-error">{pickupError}</p>}
        {pickupDetails && <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Order Information</h4>
              <dl className="bm-order-details">
                <div><dt>Order Number</dt><dd>{pickupDetails.order.id}</dd></div>
                <div><dt>Customer</dt><dd>{pickupDetails.order.customer}</dd></div>
                <div><dt>Product</dt><dd>{pickupDetails.order.product}</dd></div>
                <div><dt>Quantity</dt><dd>{pickupDetails.order.quantity}</dd></div>
                <div><dt>Total Price</dt><dd>{money(pickupDetails.order.total)}</dd></div>
                <div><dt>Specifications</dt><dd>{pickupDetails.order.specs || 'None'}</dd></div>
              </dl>
            </div>
            <div>
              <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Payment</h4>
              <dl className="bm-order-details">
                <div><dt>Payment Status</dt><dd>{pickupDetails.order.paymentStatus}</dd></div>
                <div><dt>Payment Method</dt><dd>{pickupDetails.order.payment || 'Not recorded'}</dd></div>
                {pickupDetails.order.latestPayment && <>
                  <div><dt>Amount Paid</dt><dd>{money(pickupDetails.order.latestPayment.amount)}</dd></div>
                  <div><dt>Reference</dt><dd>{pickupDetails.order.latestPayment.referenceNumber}</dd></div>
                </>}
              </dl>
            </div>
          </div>

          <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Production</h4>
          <dl className="bm-order-details" style={{ marginBottom: 16 }}>
            <div><dt>Job Order Number</dt><dd>{pickupDetails.job.jobOrderId || 'N/A'}</dd></div>
            <div><dt>Assigned Employee</dt><dd>{pickupDetails.job.assignedEmployeeName || 'N/A'}</dd></div>
            <div><dt>Production Completed</dt><dd>{date(pickupDetails.job.productionCompletedAt)}</dd></div>
            <div><dt>Ready for Pickup</dt><dd>{date(pickupDetails.job.readyForPickupAt)}</dd></div>
          </dl>

          <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Reserved Materials</h4>
          <div style={{ background: '#f8f9fa', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
            {(pickupDetails.job.reservedMaterials || []).map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #e0e0e0', fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{m.material}</span>
                <span>Reserved: {m.quantity} {m.unit}</span>
              </div>
            ))}
            {(!pickupDetails.job.reservedMaterials || pickupDetails.job.reservedMaterials.length === 0) && (
              <p style={{ fontSize: 13, color: '#666', margin: 0 }}>No reserved materials found.</p>
            )}
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Received by (optional — if someone other than the customer collects)
            </label>
            <input
              type="text"
              value={receivedByName}
              onChange={e => setReceivedByName(e.target.value)}
              placeholder="Name of person receiving the order"
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }}
            />
          </div>

          <div style={{ background: '#fff3e0', border: '1px solid #ffb74d', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: '#e65100' }}>
              <strong>Confirm that Order #{pickupDetails.order.id} has been released/picked up by the customer?</strong>
            </p>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: '#e65100' }}>
              This will finalize the reserved inventory deduction. This action cannot be undone.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn variant="ghost" disabled={confirmingPickup} onClick={() => { setPickupOrder(null); setPickupDetails(null); setPickupError(''); }}>
              Cancel
            </Btn>
            <Btn variant="primary" loading={confirmingPickup} disabled={confirmingPickup} onClick={confirmPickup}>
              {confirmingPickup ? 'Confirming...' : 'Confirm Pickup'}
            </Btn>
          </div>
        </>}
      </>}
    </Modal>

    {/* Contact Us inquiries. Reuses the same authenticated staff session. */}
    <StaffMessages user={user} showToast={showToast} />
  </section>;
}
