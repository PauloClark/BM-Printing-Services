import { useEffect, useState } from 'react';
import { orderApi, orderFileApi } from '../../utils/orderApi';
import { C } from '../../constants/colors';
import { Card } from '../Common/Card';
import { Btn } from '../Common/Btn';
import { Modal } from '../Common/Modal';
import './PaymentWorkflow.css';

const money = amount => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(amount) || 0);
const date = value => value ? new Date(value).toLocaleString('en-PH') : 'Not recorded';

export function AdminPayments({ user, showToast }) {
  const [payments, setPayments] = useState([]);
  const [selected, setSelected] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
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
    setBusy(true);
    setError('');
    try {
      await orderApi(`/api/admin/orders/${encodeURIComponent(selected.orderId)}/payments/${encodeURIComponent(selected.payment.id)}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ action, rejectionReason: reason })
      }, user);
      setPayments(current => current.filter(payment => payment.orderId !== selected.orderId));
      setSelected(null);
      setRejectionReason('');
      setReceiptPreview(null);
      showToast?.(action === 'approve' ? `Payment for ${selected.orderId} verified. Order confirmed.` : `Payment for ${selected.orderId} rejected.`, 'success');
    } catch (requestError) {
      setError(requestError.message || 'Unable to review this payment.');
    } finally {
      setBusy(false);
    }
  };

  const openReceipt = async () => {
    if (!selected || receiptBusy) return;
    setReceiptBusy(true);
    setError('');
    try {
      const blob = await orderFileApi(`/api/admin/orders/${encodeURIComponent(selected.orderId)}/payments/${encodeURIComponent(selected.payment.id)}/receipt`, user);
      const url = URL.createObjectURL(blob);
      if (blob.type.startsWith('image/')) {
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
      <Card>
        <div className="bm-admin-payments__table-wrap">
          <table className="bm-admin-payments__table">
            <thead><tr>{['Order', 'Customer', 'Product', 'Order Total', 'Amount Submitted', 'Method', 'Reference', 'Date Submitted', 'Payment Status', ''].map((heading, index) => <th key={`${heading}-${index}`}>{heading}</th>)}</tr></thead>
            <tbody>
              {payments.map(item => (
                <tr key={`${item.orderId}-${item.payment.id}`}>
                  <td>{item.orderId}</td>
                  <td>{item.customerName}</td>
                  <td>{item.product} · {item.quantity} pcs</td>
                  <td>{money(item.orderTotal)}</td>
                  <td>{money(item.payment.amount)}</td>
                  <td>{item.payment.paymentMethod}</td>
                  <td>{item.payment.referenceNumber}</td>
                  <td>{date(item.payment.submittedAt)}</td>
                  <td><span className="bm-admin-payment-status">{item.payment.status}</span></td>
                  <td><Btn size="sm" onClick={() => { setSelected(item); setError(''); setRejectionReason(''); setReceiptPreview(null); }}>Review</Btn></td>
                </tr>
              ))}
              {!payments.length && <tr><td colSpan={10} style={{ padding: 22, color: C.gray600, textAlign: 'center' }}>{loading ? 'Loading payments…' : 'No payments are waiting for verification.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={Boolean(selected)} onClose={() => !busy && setSelected(null)} title={`Review Payment · ${selected?.orderId}`} width={700}>
        {selected && <div className="bm-admin-payment-review">
          <section>
            <h4>Order Information</h4>
            <dl className="bm-admin-payment-review__details">
              <div><dt>Order Number</dt><dd>{selected.orderId}</dd></div>
              <div><dt>Customer</dt><dd>{selected.customerName}</dd></div>
              <div><dt>Product</dt><dd>{selected.product}</dd></div>
              <div><dt>Quantity</dt><dd>{selected.quantity} pcs</dd></div>
              <div><dt>Order Total</dt><dd>{money(selected.orderTotal)}</dd></div>
            </dl>
          </section>
          <section>
            <h4>Payment Information</h4>
            <dl className="bm-admin-payment-review__details">
              <div><dt>Amount Submitted</dt><dd>{money(selected.payment.amount)}</dd></div>
              <div><dt>Payment Method</dt><dd>{selected.payment.paymentMethod}</dd></div>
              <div><dt>Reference Number</dt><dd>{selected.payment.referenceNumber}</dd></div>
              <div><dt>Submitted Date</dt><dd>{date(selected.payment.submittedAt)}</dd></div>
              <div><dt>Payment Status</dt><dd>{selected.payment.status}</dd></div>
              <div><dt>Receipt</dt><dd>{selected.payment.receiptOriginalName}</dd></div>
            </dl>
            <Btn variant="secondary" disabled={receiptBusy} loading={receiptBusy} onClick={openReceipt}>View Receipt</Btn>
            {receiptPreview && <img className="bm-admin-payment-receipt" src={receiptPreview.url} alt={receiptPreview.name || 'Payment receipt'} />}
          </section>
          <label className="bm-payment-field">
            <span>Rejection Reason</span>
            <textarea value={rejectionReason} maxLength={500} onChange={event => setRejectionReason(event.target.value)} placeholder="Explain what the customer should correct before resubmitting." />
          </label>
          {error && <p className="bm-payment-error" role="alert">{error}</p>}
          <div className="bm-admin-payment-review__actions">
            <Btn variant="danger" disabled={busy} loading={busy} onClick={() => review('reject')}>Reject Payment</Btn>
            <div><Btn variant="ghost" disabled={busy} onClick={() => setSelected(null)}>Close</Btn><Btn variant="success" disabled={busy} loading={busy} onClick={() => review('approve')}>Confirm Payment</Btn></div>
          </div>
        </div>}
      </Modal>
    </section>
  );
}
