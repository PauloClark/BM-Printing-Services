import { useEffect, useState } from 'react';
import { orderApi, orderFileApi } from '../../utils/orderApi';
import { C } from '../../constants/colors';
import { Card } from '../Common/Card';
import { Btn } from '../Common/Btn';
import { Modal } from '../Common/Modal';
import './PaymentWorkflow.css';

const money = amount => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(amount) || 0);
const date = value => value ? new Date(value).toLocaleString('en-PH') : 'Not recorded';
const needsReconciliation = item => Boolean(item.archived) || ['Cancelled', 'Completed', 'Picked Up'].includes(item.orderStatus);

export function AdminPayments({ user, showToast }) {
  const [payments, setPayments] = useState([]);
  const [selected, setSelected] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [reconciliationNote, setReconciliationNote] = useState('');
  const [transactionConfirmed, setTransactionConfirmed] = useState(false);
  const [receiptPreview, setReceiptPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    orderApi('/api/admin/payments/verification', {}, user)
      .then(data => { if (active) { setPayments(data.payments || []); setError(''); } })
      .catch(requestError => { if (active) setError(requestError.message || 'Unable to load payments.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user, refresh]);

  useEffect(() => () => {
    if (receiptPreview?.url) URL.revokeObjectURL(receiptPreview.url);
  }, [receiptPreview]);

  const review = async action => {
    if (!selected || busy) return;
    const reason = rejectionReason.trim();
    if (action === 'reject' && !reason) {
      setError('Enter a rejection reason for the customer.');
      return;
    }
    if (action === 'approve' && !selected.amountMatchesOrderTotal) {
      setError('This payment cannot be verified because the submitted amount does not match the stored order total. Reject it with a reason.');
      return;
    }
    if (action === 'approve' && !transactionConfirmed) {
      setError('Confirm that you checked the actual transaction in the payment provider before approving.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await orderApi(`/api/admin/orders/${encodeURIComponent(selected.orderId)}/payments/${encodeURIComponent(selected.payment.id)}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ action, rejectionReason: reason, transactionConfirmed: action === 'approve' && transactionConfirmed })
      }, user);
      setPayments(current => current.filter(payment => payment.orderId !== selected.orderId));
      setSelected(null);
      setRejectionReason('');
      setReceiptPreview(null);
      showToast?.(action === 'approve' ? `Payment for ${selected.orderId} verified. Order status was not changed.` : `Payment for ${selected.orderId} rejected.`, 'success');
    } catch (requestError) {
      setError(requestError.message || 'Unable to review this payment.');
    } finally {
      setBusy(false);
    }
  };

  const flagForReconciliation = async () => {
    if (!selected || busy) return;
    const note = reconciliationNote.trim();
    if (!note) {
      setError('Add a note describing why this finalized order needs financial reconciliation.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await orderApi(`/api/admin/orders/${encodeURIComponent(selected.orderId)}/payments/${encodeURIComponent(selected.payment.id)}/reconcile`, {
        method: 'POST',
        body: JSON.stringify({ note })
      }, user);
      const nextItem = { ...selected, payment: result.payment };
      setSelected(nextItem);
      setPayments(current => current.map(item => item.orderId === selected.orderId ? nextItem : item));
      setReconciliationNote('');
      showToast?.(`Financial reconciliation recorded for ${selected.orderId}. Payment and order statuses are unchanged.`, 'success');
    } catch (requestError) {
      setError(requestError.message || 'Unable to record financial reconciliation.');
    } finally {
      setBusy(false);
    }
  };

  const openReceipt = async () => {
    if (!selected || receiptBusy) return;
    setReceiptBusy(true);
    setError('');
    setReceiptPreview(null);
    try {
      const blob = await orderFileApi(`/api/admin/orders/${encodeURIComponent(selected.orderId)}/payments/${encodeURIComponent(selected.payment.id)}/receipt`, user);
      const url = URL.createObjectURL(blob);
      if (['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) {
        setReceiptPreview({ url, name: selected.payment.receiptOriginalName });
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.download = selected.payment.receiptOriginalName || 'payment-receipt.pdf';
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
    } catch (requestError) {
      setError(requestError.message || 'Unable to open the payment receipt.');
    } finally {
      setReceiptBusy(false);
    }
  };

  if (user?.role !== 'admin') return <Card role="alert">Admin access is required to review payments.</Card>;

  return (
    <section className="bm-admin-payments">
      <div className="bm-admin-payments__toolbar">
        <div>
          <h3 style={{ margin: 0, color: C.gray800, fontFamily: 'Montserrat', fontSize: 18 }}>Payments for Verification</h3>
          <p style={{ margin: '5px 0 0', color: C.gray600, fontSize: 13 }}>Review customer payment details and receipt before confirming an order.</p>
        </div>
        <Btn variant="ghost" onClick={() => { setLoading(true); setRefresh(value => value + 1); }}>Refresh</Btn>
      </div>
      {error && <p className="bm-payment-error" role="alert">{error}</p>}
      {!payments.length
        ? <div className="bm-admin-payments__empty" role="status">{loading ? 'Loading payments…' : 'No payments are waiting for verification.'}</div>
        : <Card className="bm-admin-payments__table-card">
        <p className="bm-admin-payments__scroll-hint" id="admin-payment-table-scroll-hint">Scroll within this table to view all payment details and actions.</p>
        <div className="bm-admin-payments__table-wrap" role="region" aria-label="Payments awaiting verification" aria-describedby="admin-payment-table-scroll-hint" tabIndex={0}>
          <table className="bm-admin-payments__table">
            <thead><tr>{['Order', 'Customer', 'Amount Submitted', 'Payment Status', 'Actions', 'Order Status', 'Product', 'Order Total', 'Method', 'Reference', 'Date Submitted'].map((heading, index) => <th key={`${heading}-${index}`}>{heading}</th>)}</tr></thead>
            <tbody>
              {payments.map(item => (
                <tr key={`${item.orderId}-${item.payment.id}`}>
                  <td className="bm-admin-payments__order-id" title={item.orderId}>{item.orderId}</td>
                  <td className="bm-admin-payments__customer">{item.customerName}</td>
                  <td className="bm-admin-payments__amount-submitted">
                    <span className="bm-admin-payments__amount">{money(item.payment.amount)}</span>
                    <span className={`bm-payment-match ${item.amountMatchesOrderTotal ? 'is-match' : 'is-mismatch'}`}>{item.amountMatchesOrderTotal ? 'Matches' : 'Mismatch'}</span>
                  </td>
                  <td className="bm-admin-payments__payment-status"><span className="bm-admin-payment-status">{item.payment.status}</span></td>
                  <td className="bm-admin-payments__review"><Btn size="sm" onClick={() => { setSelected(item); setError(''); setRejectionReason(''); setReconciliationNote(''); setTransactionConfirmed(false); setReceiptPreview(null); }}>Review</Btn></td>
                  <td className="bm-admin-payments__status">{item.archived ? 'Archived' : item.orderStatus || 'Unknown'}</td>
                  <td className="bm-admin-payments__product">{item.product} · {item.quantity} pcs</td>
                  <td className="bm-admin-payments__amount">{money(item.orderTotal)}</td>
                  <td className="bm-admin-payments__method">{item.payment.paymentMethod}</td>
                  <td className="bm-admin-payments__reference">{item.payment.referenceNumber}</td>
                  <td className="bm-admin-payments__date">{date(item.payment.submittedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>}

      <Modal open={Boolean(selected)} onClose={() => !busy && setSelected(null)} title={`Review Payment · ${selected?.orderId}`} width={920}>
        {selected && <div className="bm-admin-payment-review">
          {needsReconciliation(selected) && <p className="bm-payment-error" role="alert">
            This order is {selected.archived ? 'archived' : selected.orderStatus}. Standard payment approval and rejection are blocked. Reconciliation records an Admin audit note only; it does not confirm funds, change payment status, or reopen the order.
          </p>}
          <div className="bm-admin-payment-review__info-grid">
          <section className="bm-admin-payment-review__info-card">
            <h4>Order Information</h4>
            <dl className="bm-admin-payment-review__details">
              <div><dt>Order Number</dt><dd>{selected.orderId}</dd></div>
              <div><dt>Order Status</dt><dd>{selected.archived ? 'Archived' : selected.orderStatus || 'Unknown'}</dd></div>
              <div><dt>Customer</dt><dd>{selected.customerName}</dd></div>
              <div><dt>Product</dt><dd>{selected.product}</dd></div>
              <div><dt>Quantity</dt><dd>{selected.quantity} pcs</dd></div>
              <div><dt>Order Total</dt><dd>{money(selected.orderTotal)}</dd></div>
            </dl>
          </section>
          <section className="bm-admin-payment-review__info-card">
            <h4>Payment Information</h4>
            <dl className="bm-admin-payment-review__details">
              <div><dt>Amount Submitted</dt><dd>{money(selected.payment.amount)}</dd></div>
              <div><dt>Payment Method</dt><dd>{selected.payment.paymentMethod}</dd></div>
              <div><dt>Reference Number</dt><dd>{selected.payment.referenceNumber}</dd></div>
              <div><dt>Submitted Date</dt><dd>{date(selected.payment.submittedAt)}</dd></div>
              <div><dt>Payment Status</dt><dd>{selected.payment.status}</dd></div>
              <div><dt>Amount Check</dt><dd><span className={`bm-payment-match ${selected.amountMatchesOrderTotal ? 'is-match' : 'is-mismatch'}`}>{selected.amountMatchesOrderTotal ? 'Matches order total' : 'Does not match order total'}</span></dd></div>
            </dl>
            {selected.payment.reconciliationAt && <p role="status">Reconciliation flagged {date(selected.payment.reconciliationAt)}. {selected.payment.reconciliationNote}</p>}
          </section>
          </div>
          <section className="bm-admin-payment-review__receipt-card">
            <div className="bm-admin-payment-review__section-heading">
              <div><h4>Receipt</h4><p>{selected.payment.receiptOriginalName}</p></div>
              <Btn variant="secondary" disabled={receiptBusy} loading={receiptBusy} onClick={openReceipt}>View Receipt</Btn>
            </div>
            {receiptPreview && <div className="bm-admin-payment-review__receipt-frame"><img className="bm-admin-payment-receipt" src={receiptPreview.url} alt={receiptPreview.name || 'Payment receipt'} /></div>}
          </section>
          {needsReconciliation(selected)
            ? !selected.payment.reconciliationAt && <label className="bm-payment-field">
              <span>Financial Reconciliation Note</span>
              <textarea value={reconciliationNote} maxLength={1000} onChange={event => setReconciliationNote(event.target.value)} placeholder="Record why this outstanding payment needs manual reconciliation. Do not enter an approval unless the transaction has been independently confirmed." />
            </label>
            : <>
              <label className="bm-payment-field">
                <span>Rejection Reason</span>
                <textarea value={rejectionReason} maxLength={500} onChange={event => setRejectionReason(event.target.value)} placeholder="Explain what the customer should correct before resubmitting." />
              </label>
              {!selected.amountMatchesOrderTotal && <p className="bm-payment-error" role="alert">Verification is blocked. Full payment must exactly match the stored order total. You may reject this proof and explain the correction required.</p>}
              <label className="bm-payment-field bm-admin-payment-review__confirmation">
                <input type="checkbox" checked={transactionConfirmed} onChange={event => setTransactionConfirmed(event.target.checked)} />
                <span>I independently confirmed the actual transaction in the payment provider using the method, amount, and reference shown above.</span>
              </label>
            </>}
          {error && <p className="bm-payment-error" role="alert">{error}</p>}
          <div className="bm-admin-payment-review__actions">
            {needsReconciliation(selected)
              ? <div><Btn variant="ghost" disabled={busy} onClick={() => setSelected(null)}>Close</Btn>{!selected.payment.reconciliationAt && <Btn variant="secondary" disabled={busy || !reconciliationNote.trim()} loading={busy} onClick={flagForReconciliation}>Flag for Reconciliation</Btn>}</div>
              : <>
                <Btn variant="danger" disabled={busy} loading={busy} onClick={() => review('reject')}>Reject Payment</Btn>
                <div><Btn variant="ghost" disabled={busy} onClick={() => setSelected(null)}>Close</Btn><Btn variant="success" disabled={busy || !selected.amountMatchesOrderTotal || !transactionConfirmed} loading={busy} onClick={() => review('approve')}>Verify Payment</Btn></div>
              </>}
          </div>
        </div>}
      </Modal>
    </section>
  );
}
