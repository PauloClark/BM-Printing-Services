import { OrderPage } from './OrderPage';
import { OrderReference } from '../Common/OrderReference';
import { JobOrders, PrepareJobOrder } from './JobOrders';
import { OrderDesignFiles } from '../Common/OrderDesignFiles';
import { StaffMessages } from './StaffMessages';
import { useEffect, useState } from 'react';
import { orderApi } from '../../utils/orderApi';
import { ORDER_STATUSES, displayOrderStatus } from '../../../shared/orderWorkflow';
import { Card } from '../Common/Card';
import { Btn } from '../Common/Btn';
import { Badge } from '../Common/Badge';
import { Modal } from '../Common/Modal';
import { PickupConfirmationModal } from '../Common/PickupConfirmationModal';
import './StaffOrders.css';

const money = amount => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount || 0);
const date = value => value ? new Date(value).toLocaleString('en-PH') : 'Not recorded';

export function StaffOrders({ user, showToast, onReviewPayment, walkInOnly = false }) {
  const [walkIn, setWalkIn] = useState(walkInOnly);
  const [cashAmount, setCashAmount] = useState('');
  const [cashReceived, setCashReceived] = useState(false);
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
  const [resolutionAction, setResolutionAction] = useState('require_refund');
  const [resolutionReason, setResolutionReason] = useState('');
  const [resolutionAmount, setResolutionAmount] = useState('');
  const [resolutionReference, setResolutionReference] = useState('');
  const [resolutionDate, setResolutionDate] = useState(new Date().toISOString().slice(0, 10));
  const [resolutionConfirmed, setResolutionConfirmed] = useState(false);

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

  useEffect(() => {
    setWalkIn(walkInOnly);
  }, [walkInOnly]);

  const selected = orders.find(o => o.id === selectedId);
  const currentResolutionState = selected?.financialResolution?.status || 'NONE';
  const hasVerifiedReceipt = Boolean(selected && (selected.paymentStatus === 'Verified' || selected.cashPayment?.verifiedAt || selected.latestPayment?.status === 'Verified'));
  const resolutionActions = currentResolutionState === 'NONE'
    ? [['require_refund', 'Record refund required'], ['no_refund_applicable', 'Record no-refund exception']]
    : currentResolutionState === 'REFUND_REQUIRED'
      ? [['refund_pending', 'Mark refund pending'], ['refund_completed', 'Confirm refund completed'], ['credit_issued', 'Issue customer credit'], ['no_refund_applicable', 'Record no-refund exception']]
      : currentResolutionState === 'REFUND_PENDING'
        ? [['refund_completed', 'Confirm refund completed'], ['credit_issued', 'Issue customer credit'], ['no_refund_applicable', 'Record no-refund exception']]
        : [];

  const update = async (status, cancellationReason = '') => {
    if (busy || !selected) return;
    if (status === 'Cancelled' && user.role !== 'admin') return;
    if (status === 'Cancelled' && selected.status !== 'Cancelled' && !window.confirm(`Cancel order ${selected.id}? A verified payment must already have a completed financial resolution. This cannot be undone.`)) return;
    if (status === 'Completed' && !window.confirm(`Mark order ${selected.id} as completed? Confirm the customer has received the order. This cannot be undone.`)) return;
    setBusy(true); setActionError('');
    try {
      const { order } = await orderApi(`/api/orders/${encodeURIComponent(selected.id)}/status`, {
        method: 'PATCH', body: JSON.stringify({ status, expectedStatus: selected.status, ...(status === 'Cancelled' ? { cancellationReason } : {}) })
      }, user);
      setOrders(list => list.map(o => o.id === order.id ? order : o));
      setRefresh(n => n + 1);
      showToast?.(`Order ${order.id}: ${order.status}`, 'success');
    } catch (e) { setActionError(e.message); setRefresh(n => n + 1); }
    finally { setBusy(false); }
  };
  const recordFinancialResolution = async () => {
    if (user.role !== 'admin' || !selected || busy) return;
    setBusy(true); setActionError('');
    try {
      const body = {
        action: resolutionAction,
        reason: resolutionReason,
        amount: Number(resolutionAmount || selected.total),
        referenceNumber: resolutionReference,
        resolutionDate,
        transactionConfirmed: resolutionAction === 'refund_completed' && resolutionConfirmed,
        customerAgreed: resolutionAction === 'credit_issued' && resolutionConfirmed,
        exceptionApproved: resolutionAction === 'no_refund_applicable' && resolutionConfirmed
      };
      const result = await orderApi(`/api/admin/orders/${encodeURIComponent(selected.id)}/financial-resolution`, {
        method: 'POST', body: JSON.stringify(body)
      }, user);
      setOrders(current => current.map(order => order.id === selected.id ? { ...order, financialResolution: result.financialResolution } : order));
      setResolutionAction(result.financialResolution.status === 'REFUND_REQUIRED' ? 'refund_pending' : result.financialResolution.status === 'REFUND_PENDING' ? 'refund_completed' : 'require_refund');
      setResolutionReason(''); setResolutionReference(''); setResolutionConfirmed(false);
      setRefresh(value => value + 1);
      showToast?.(`Financial resolution recorded: ${result.financialResolution.status}.`, 'success');
    } catch (e) { setActionError(e.message || 'Unable to record financial resolution.'); }
    finally { setBusy(false); }
  };
  const requestCancellation = async () => {
    const paymentPending = selected?.paymentStatus === 'For Verification' || selected?.latestPayment?.status === 'For Verification';
    if (paymentPending) { setActionError('Payment proof is awaiting review. Review or reject it before cancellation.'); onReviewPayment?.(); return; }
    if (hasVerifiedReceipt && !['REFUND_COMPLETED', 'CREDIT_ISSUED', 'NO_REFUND_APPLICABLE'].includes(currentResolutionState)) {
      setActionError('This order has verified payment. Complete a financial resolution below before cancellation.'); return;
    }
    const reason = window.prompt('Enter the reason for cancelling this order:')?.trim();
    if (!reason) { setActionError('A cancellation reason is required.'); return; }
    await update('Cancelled', reason);
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
    if (receivedByName.trim().length < 2) {
      setPickupError('Enter the full name of the person collecting the order.');
      return;
    }
    setConfirmingPickup(true);
    setPickupError('');
    try {
      const data = await orderApi(`/api/orders/${encodeURIComponent(pickupOrder.id)}/confirm-pickup`, {
        method: 'POST',
        body: JSON.stringify({ receivedByName: receivedByName.trim() })
      }, user);
      setOrders(list => list.map(o => o.id === data.order.id ? data.order : o));
      setRefresh(n => n + 1);
      setPickupOrder(null);
      setPickupDetails(null);
      showToast?.(`Order ${data.order.id} confirmed as Picked Up.`, 'success');
    } catch (e) {
      setPickupError(e.message);
      setRefresh(n => n + 1);
    } finally {
      setConfirmingPickup(false);
    }
  };

  const verifyCash = async () => {
    if (busy || !selected || !cashReceived) return;
    setBusy(true); setActionError('');
    try { const { order } = await orderApi('/api/admin/orders/' + encodeURIComponent(selected.id) + '/cash', { method: 'POST', body: JSON.stringify({ amount: cashAmount, received: cashReceived }) }, user); setOrders(list => list.map(o => o.id === order.id ? order : o)); setCashAmount(''); setCashReceived(false); }
    catch (e) { setActionError(e.message); } finally { setBusy(false); setRefresh(n => n + 1); }
  };
  const shown = orders.filter(o => (!walkInOnly || o.orderSource === 'walk_in') && (filter === 'All' || displayOrderStatus(o.status) === filter) &&
    [o.id, o.customer, o.product, o.orderSource === 'walk_in' ? 'Walk-in' : 'Online'].some(value => String(value || '').toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => Number(displayOrderStatus(b.status) === 'Pending') - Number(displayOrderStatus(a.status) === 'Pending') || new Date(b.createdAt) - new Date(a.createdAt));

  const readyForPickupCount = orders.filter(o => displayOrderStatus(o.status) === 'Ready for Pickup').length;

  if (user.role === 'staff') return <section className="bm-staff-orders">
    <JobOrders user={user} refresh={refresh} />
    <StaffMessages user={user} showToast={showToast} />
  </section>;

  if (walkIn && user.role === 'admin') return <section className="bm-walk-in"><Btn variant="ghost" onClick={() => { setWalkIn(false); setRefresh(n => n + 1); }}>Back to {walkInOnly ? 'Walk-In Orders' : 'Orders'}</Btn><OrderPage user={user} walkIn showToast={showToast || (() => {})} setPage={() => { setWalkIn(false); setRefresh(n => n + 1); }}/></section>;
  return <section className="bm-staff-orders">
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
      <h2>{walkInOnly ? 'Walk-In Orders' : 'Incoming Orders'}</h2>{user.role === "admin" && <Btn onClick={() => setWalkIn(true)}>Create Walk-in Order</Btn>}
      <input aria-label="Search orders" placeholder="Order ID, customer, product or source" value={search} onChange={e => setSearch(e.target.value)} />
      <select aria-label="Filter by status" value={filter} onChange={e => setFilter(e.target.value)}>{['All', ...ORDER_STATUSES].map(s => <option key={s}>{s}</option>)}</select>
      <Btn onClick={() => setRefresh(n => n + 1)}>Refresh</Btn>
    </div>
    <p>Saved orders refresh automatically every 5 seconds.</p>
    {error && <p role="alert" className="bm-order-error">{error} Use Refresh to retry.</p>}
    <Card><div className="bm-order-table"><table><thead><tr>
      {['Order ID', 'Customer', 'Date / Time', 'Product', 'Quantity', 'Total', 'Payment', 'Status', 'Action'].map(h => <th key={h}>{h}</th>)}
    </tr></thead><tbody>
      {shown.map(o => <tr key={o.id} className={displayOrderStatus(o.status) === 'Pending' ? 'bm-order-pending' : undefined}><td>{o.id}<small style={{display:'block'}}>{o.orderSource === 'walk_in' ? 'Walk-in' : 'Online'}</small></td><td>{o.customer}</td><td>{date(o.createdAt)}</td><td>{o.product}</td><td>{o.quantity}</td><td>{money(o.total)}</td><td>{o.payment}</td><td><Badge status={displayOrderStatus(o.status)} /></td><td><div style={{ display: 'flex', gap: 4 }}><Btn size="sm" onClick={() => { setSelectedId(o.id); setActionError(''); setCashAmount(''); setCashReceived(false); }}>View Order</Btn>{displayOrderStatus(o.status) === 'Ready for Pickup' && <Btn size="sm" variant="primary" onClick={() => openPickupDetails(o)}>Confirm Pickup</Btn>}</div></td></tr>)}
      {!shown.length && <tr><td colSpan={9}>{loading ? 'Loading orders…' : error ? 'Orders could not be loaded.' : 'No orders found.'}</td></tr>}
    </tbody></table></div></Card>

    {/* Order Detail Modal */}
    <Modal open={Boolean(selected)} onClose={() => !busy && setSelectedId(null)} title={`Order Details · ${selected?.id || ''}`} width={860}>
      {selected && <div className="bm-admin-order-modal">
        <section className="bm-admin-order-section">
          <div className="bm-admin-order-section__heading"><div><span>Order summary</span><h4>{selected.product}</h4></div><Badge status={displayOrderStatus(selected.status)} /></div>
          <dl className="bm-admin-order-grid">{[
            ['Order number', selected.id], ['Customer', selected.customer], ['Quantity', `${selected.quantity} pcs`],
            ['Total price', money(selected.total)], ['Order date', date(selected.createdAt)], ['Contact', selected.phone || selected.email]
          ].map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value || 'Not provided'}</dd></div>)}</dl>
          <div className="bm-admin-order-copy"><strong>Product specifications</strong><p>{selected.specs || selected.designNotes || 'No specifications recorded.'}</p></div>
          {selected.designNotes && selected.designNotes !== selected.specs && <div className="bm-admin-order-copy"><strong>Design instructions</strong><p>{selected.designNotes}</p></div>}
          {selected.notes && selected.notes !== selected.specs && selected.notes !== selected.designNotes && <div className="bm-admin-order-copy"><strong>Customer notes</strong><p>{selected.notes}</p></div>}
        </section>

        <OrderReference order={selected} compact/><section className="bm-admin-order-section"><OrderDesignFiles order={selected} user={user} /></section>

        <section className="bm-admin-order-section">
          <div className="bm-admin-order-section__heading"><div><span>Payment</span><h4>Payment information</h4></div><span className={`bm-admin-order-payment is-${String(selected.paymentStatus || 'unpaid').toLowerCase().replace(/\s+/g, '-')}`}>{selected.paymentStatus || 'Unpaid'}</span></div>
          <dl className="bm-admin-order-grid bm-admin-order-payment-grid">
            <div><dt>Payment method</dt><dd>{selected.latestPayment?.paymentMethod || selected.payment || 'Not recorded'}</dd></div>
            <div><dt>Submitted amount</dt><dd>{selected.latestPayment ? money(selected.latestPayment.amount) : 'No payment submitted'}</dd></div>
            <div><dt>Reference</dt><dd>{selected.latestPayment?.referenceNumber || 'Not available'}</dd></div>
            <div><dt>Submitted</dt><dd>{selected.latestPayment ? date(selected.latestPayment.submittedAt) : 'Not available'}</dd></div>
          </dl>
          {selected.payment === 'cash' && selected.paymentStatus !== 'Verified' && !['Cancelled', 'Completed'].includes(selected.status) && <div className="bm-admin-order-cash-confirm"><label className="bm-admin-order-cash-amount">Amount received (excluding change)<input aria-label="Cash amount received" type="number" min="0.01" step="0.01" value={cashAmount} onChange={e => setCashAmount(e.target.value)}/></label><label className="bm-admin-order-cash-check"><input type="checkbox" checked={cashReceived} onChange={e => setCashReceived(e.target.checked)}/> <span>I have received the full cash payment</span></label><div className="bm-admin-order-cash-action"><Btn disabled={busy || !cashReceived || !cashAmount} onClick={verifyCash}>Confirm Cash Payment</Btn></div></div>}
          {selected.cashPayment?.verifiedAt && <p>Received {money(selected.cashPayment.amount)} — Admin {selected.cashPayment.verifiedBy} — {date(selected.cashPayment.verifiedAt)}</p>}
          {selected.paymentStatus === 'For Verification' && <div className="bm-admin-order-callout"><p>Payment proof requires Admin review. After verification, confirm the order separately to make it eligible for production.</p><Btn onClick={onReviewPayment}>Review Payment</Btn></div>}
          {['Unpaid', 'Rejected'].includes(selected.paymentStatus || 'Unpaid') && <p className="bm-admin-order-muted">Awaiting full payment from the customer. This order cannot be confirmed or assigned.</p>}
        </section>

        {user.role === 'admin' && hasVerifiedReceipt && <section className="bm-admin-order-section bm-financial-resolution">
          <div className="bm-admin-order-section__heading"><div><span>Financial resolution</span><h4>Paid order cancellation</h4></div><span className="bm-admin-order-payment">{currentResolutionState}</span></div>
          <p className="bm-admin-order-muted">A verified payment of {money(selected.total)} must be fully accounted for before this order can be cancelled. Refund pending is not a completed refund.</p>
          {selected.financialResolution?.reason && <p className="bm-admin-order-muted">Resolution note: {selected.financialResolution.reason}</p>}
          {resolutionActions.length > 0 ? <div className="bm-financial-resolution__form">
            <label>Action<select value={resolutionAction} onChange={event => { setResolutionAction(event.target.value); setResolutionConfirmed(false); }}>{resolutionActions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label>Reason / Admin note<textarea value={resolutionReason} maxLength={1000} onChange={event => setResolutionReason(event.target.value)} /></label>
            {['refund_completed', 'credit_issued'].includes(resolutionAction) && <>
              <label>Amount (PHP)<input type="number" min="0.01" step="0.01" value={resolutionAmount || Number(selected.total || 0).toFixed(2)} onChange={event => setResolutionAmount(event.target.value)} /></label>
              <label>Refund or credit reference<input maxLength={120} value={resolutionReference} onChange={event => setResolutionReference(event.target.value)} /></label>
              <label>Actual refund / credit date<input type="date" value={resolutionDate} onChange={event => setResolutionDate(event.target.value)} /></label>
            </>}
            {['refund_completed', 'credit_issued', 'no_refund_applicable'].includes(resolutionAction) && <label className="bm-financial-resolution__confirmation">
              <input type="checkbox" checked={resolutionConfirmed} onChange={event => setResolutionConfirmed(event.target.checked)} />
              <span>{resolutionAction === 'refund_completed' ? 'I confirm the money was actually returned to the customer.' : resolutionAction === 'credit_issued' ? 'I confirm the customer agreed to this credit.' : 'I approve this documented no-refund exception.'}</span>
            </label>}
            <Btn disabled={busy || !resolutionReason.trim() || (['refund_completed', 'credit_issued'].includes(resolutionAction) && (!resolutionReference.trim() || !resolutionConfirmed)) || (resolutionAction === 'no_refund_applicable' && (!resolutionConfirmed || resolutionReason.trim().length < 20))} loading={busy} onClick={recordFinancialResolution}>Record Financial Resolution</Btn>
          </div> : <p className="bm-admin-order-muted">Financial resolution is final. Cancellation is available only after the full verified payment has been accounted for.</p>}
          {selected.financialResolution?.referenceNumber && <p className="bm-admin-order-muted">Reference: {selected.financialResolution.referenceNumber} · Amount accounted: {money((selected.financialResolution.accountedAmountCents || 0) / 100)}</p>}
        </section>}

        <section className="bm-admin-order-section">
          <div className="bm-admin-order-section__heading"><div><span>Production</span><h4>Processing status</h4></div><Badge status={selected.production?.status || displayOrderStatus(selected.status)} /></div>
          {selected.production ? <>
            <dl className="bm-admin-order-grid"><div><dt>Job order</dt><dd>{selected.production.jobOrderId}</dd></div><div><dt>Assigned employee</dt><dd>{selected.production.assignedEmployeeName || 'Not assigned'}</dd></div><div><dt>Assigned</dt><dd>{date(selected.production.dateAssigned)}</dd></div><div><dt>Due date</dt><dd>{date(selected.production.dueDate)}</dd></div></dl>
            {selected.production.productionHistory?.length > 0 && <ol className="bm-admin-order-history">{selected.production.productionHistory.map((event, index) => <li key={`${event.status}-${event.timestamp}-${index}`}><span /><div><strong>{event.status}</strong><time>{date(event.timestamp)}</time>{event.notes && <p>{event.notes}</p>}</div></li>)}</ol>}
          </> : selected.status === 'Confirmed' && selected.paymentStatus === 'Verified' ? <p className="bm-admin-order-muted">Payment is verified. This order is ready for job assignment.</p> : <p className="bm-admin-order-muted">No production job has been assigned.</p>}
          {user.role === 'admin' && selected.status === 'Confirmed' && selected.paymentStatus === 'Verified' && !selected.jobOrderId && <PrepareJobOrder key={selected.id} order={selected} user={user} onCreated={() => setRefresh(n => n + 1)} />}
        </section>

        {selected.archived && <p>Archived {date(selected.archivedAt)} by {selected.archivedByName || selected.archivedBy}</p>}
        {(error || actionError) && <p role="alert" className="bm-order-error">{actionError || error}</p>}
        <div className="bm-admin-order-actions">
          {user.role === 'admin' && selected.status === 'Pending' && selected.paymentStatus === 'Verified' && <Btn disabled={busy || Boolean(error)} onClick={() => update('Confirmed')}>Confirm Order</Btn>}
          {user.role === 'admin' && selected.status === 'Picked Up' && !selected.archived && <Btn disabled={archiving} loading={archiving} onClick={archiveSelected}>Archive Order</Btn>}
          {user.role === 'admin' && selected.status === 'Cancelled' && selected.stockReleaseStatus === 'PENDING' && <Btn disabled={busy} loading={busy} onClick={() => update('Cancelled', selected.cancellationAudit?.at(-1)?.reason || 'Retry pending stock release.')}>Retry Stock Release</Btn>}
          {user.role === 'admin' && !selected.jobOrderId && ['Pending', 'Confirmed'].includes(selected.status) && <Btn variant="ghost" disabled={busy || Boolean(error)} onClick={requestCancellation}>Cancel Order</Btn>}
        </div>
      </div>}
    </Modal>

    {/* Pickup Details & Confirmation Modal */}
    {false && <Modal open={Boolean(pickupOrder)} onClose={() => !confirmingPickup && !pickupLoading && setPickupOrder(null)} title={`Confirm Pickup — ${pickupOrder?.id || ''}`} width={700}>
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
    </Modal>}
    <PickupConfirmationModal open={Boolean(pickupOrder)} detail={pickupDetails} loading={pickupLoading} error={pickupError}
      receiverName={receivedByName} onReceiverChange={value => { setReceivedByName(value); setPickupError(''); }} confirming={confirmingPickup}
      onClose={() => { setPickupOrder(null); setPickupDetails(null); setPickupError(''); }} onConfirm={confirmPickup} />

    {/* Contact Us inquiries. Reuses the same authenticated staff session. */}
    <StaffMessages user={user} showToast={showToast} />
  </section>;
}
