import { useState } from 'react';
import { orderApi } from '../../utils/orderApi';
import { PAYMENT_METHODS } from '../../constants/paymentMethods';
import { Btn } from '../Common/Btn';
import { Modal } from '../Common/Modal';
import './PaymentWorkflow.css';

const MAX_RECEIPT_SIZE = 10 * 1024 * 1024;
const RECEIPT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const RECEIPT_EXTENSIONS = /\.(jpe?g|png|webp)$/i;
const money = amount => `₱${Number(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fileToDataUrl = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Unable to read the selected receipt.'));
  reader.readAsDataURL(file);
});

export function PaymentSubmissionModal({ order, user, onClose, onSubmitted, showToast }) {
  const [paymentMethod, setPaymentMethod] = useState('');
  const [amount, setAmount] = useState(String(Number(order?.total || 0)));
  const [referenceNumber, setReferenceNumber] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handlePaymentMethodSelect = methodId => {
    setPaymentMethod(methodId);
    setError('');
  };

  const submit = async event => {
    event.preventDefault();
    setError('');
    const selectedMethod = PAYMENT_METHODS.find(method => method.id === paymentMethod);
    const numericAmount = Number(amount);
    const exactTotal = Number(order?.total || 0);

    if (!selectedMethod) return setError('Choose a payment method.');
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return setError('Enter an amount greater than zero.');
    if (Math.round(numericAmount * 100) !== Math.round(exactTotal * 100)) return setError('Amount paid must match the full order total exactly.');
    if (!referenceNumber.trim()) return setError('Enter the payment reference number.');
    if (!receipt) return setError('Upload a payment receipt or proof of payment.');
    if (!RECEIPT_TYPES.has(receipt.type) || !RECEIPT_EXTENSIONS.test(receipt.name)) return setError('Choose a JPG, JPEG, PNG, or WEBP receipt.');
    if (receipt.size > MAX_RECEIPT_SIZE) return setError('The receipt must be 10 MB or smaller.');

    setSubmitting(true);
    try {
      const data = await orderApi(`/api/orders/${encodeURIComponent(order.id)}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          paymentMethod: selectedMethod.backendValue,
          amount: numericAmount,
          referenceNumber: referenceNumber.trim(),
          receipt: { filename: receipt.name, base64: await fileToDataUrl(receipt) }
        })
      }, user);
      onSubmitted(data.order);
      showToast?.('Payment proof submitted successfully. Waiting for BM team verification.', 'success');
    } catch (requestError) {
      setError(requestError.message || 'Unable to submit payment. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={Boolean(order)} onClose={() => !submitting && onClose()} title="Submit Payment Proof" width={620}>
      <form className="bm-payment-form" onSubmit={submit}>
        <div className="bm-payment-summary">
          <span>Order #{order.id}</span>
          <strong>Full total: {money(order.total)}</strong>
        </div>
        <p className="bm-payment-helper">Upload proof of payment for the full order total. BM Printing will review it before approving the order.</p>

        <div className="bm-payment-methods-section">
          <h3 className="bm-payment-methods-title">Select Payment Method <span>*</span></h3>
          <div className="bm-payment-grid">
            {PAYMENT_METHODS.map(method => (
              <button
                key={method.id}
                type="button"
                className={paymentMethod === method.id ? 'bm-payment-method is-selected' : 'bm-payment-method'}
                onClick={() => handlePaymentMethodSelect(method.id)}
                aria-pressed={paymentMethod === method.id}
              >
                <div className="bm-payment-method__icon" aria-hidden="true">
                  <img src={method.logo} alt="" onError={event => { event.currentTarget.hidden = true; }} />
                </div>
                <div className="bm-payment-method__content">
                  <strong>{method.name}</strong>
                  <span>Account Name: {method.accountName}</span>
                  <small>Account Number: {method.accountNumber}</small>
                </div>
              </button>
            ))}
          </div>
        </div>

        <label className="bm-payment-field">
          <span>Amount Paid <b>*</b></span>
          <input type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} required />
          <small>Enter the exact full amount. Total due: {money(order.total)}.</small>
        </label>
        <label className="bm-payment-field">
          <span>Reference Number / Transfer Note <b>*</b></span>
          <input type="text" maxLength={100} value={referenceNumber} onChange={event => setReferenceNumber(event.target.value)} required />
        </label>
        <label className="bm-payment-field">
          <span>Payment Receipt Screenshot <b>*</b></span>
          <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={event => setReceipt(event.target.files?.[0] || null)} required />
          <small>Accepted formats: JPG, JPEG, PNG, WEBP.</small>
          {receipt && <small>Selected: {receipt.name}</small>}
        </label>
        {error && <p className="bm-payment-error" role="alert">{error}</p>}
        <div className="bm-payment-form__actions">
          <Btn variant="ghost" disabled={submitting} onClick={event => { event.preventDefault(); onClose(); }}>Cancel</Btn>
          <Btn loading={submitting}>Submit Payment Proof</Btn>
        </div>
      </form>
    </Modal>
  );
}
