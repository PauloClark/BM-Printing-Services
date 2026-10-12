import { Modal } from './Modal';
import { Btn } from './Btn';
import { Badge } from './Badge';
import './PickupConfirmationModal.css';

const money = value => new Intl.NumberFormat('en-PH', {
  style: 'currency', currency: 'PHP', minimumFractionDigits: 2
}).format(Number(value) || 0);

const dateTime = value => value
  ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
  : 'Not recorded';

const Field = ({ label, children, wide = false }) => (
  <div className={`bm-pickup-field${wide ? ' bm-pickup-field--wide' : ''}`}>
    <dt>{label}</dt><dd>{children || 'Not recorded'}</dd>
  </div>
);

export function PickupConfirmationModal({
  open, detail, loading, error, receiverName, onReceiverChange,
  confirming, onClose, onConfirm
}) {
  const materials = detail?.job?.reservedMaterials || [];
  const receiverValid = receiverName.trim().length >= 2;
  const payment = detail?.order?.latestPayment;

  return (
    <Modal open={open} onClose={() => !confirming && onClose()} title="Confirm Pickup" width={760}>
      <div className="bm-pickup-modal">
        {loading && <div className="bm-pickup-state" role="status"><span />Loading pickup details…</div>}
        {error && <p className="bm-pickup-error" role="alert">{error}</p>}
        {detail && <>
          <div className="bm-pickup-heading">
            <div><span>Order number</span><strong>{detail.order.id}</strong></div>
            <Badge status="Ready for Pickup" />
          </div>

          <section className="bm-pickup-section" aria-labelledby="pickup-summary-heading">
            <h4 id="pickup-summary-heading">Order summary</h4>
            <dl className="bm-pickup-grid">
              <Field label="Customer">{detail.order.customer}</Field>
              <Field label="Product & quantity">{detail.order.product} · {detail.order.quantity}</Field>
              <Field label="Total order amount">{money(detail.order.total)}</Field>
              <Field label="Verified payment">{payment ? `${money(payment.amount)} · ${payment.method || detail.order.payment || 'Method not recorded'}` : detail.order.paymentStatus}</Field>
              <Field label="Assigned employee" wide>{detail.job.assignedEmployeeName || detail.job.assignedEmployee}</Field>
            </dl>
          </section>

          <section className="bm-pickup-section" aria-labelledby="pickup-production-heading">
            <h4 id="pickup-production-heading">Production</h4>
            <dl className="bm-pickup-grid bm-pickup-grid--three">
              <Field label="Job order number">{detail.job.jobOrderId}</Field>
              <Field label="Completed">{dateTime(detail.job.productionCompletedAt)}</Field>
              <Field label="Ready for pickup">{dateTime(detail.job.readyForPickupAt)}</Field>
            </dl>
          </section>

          <section className="bm-pickup-section" aria-labelledby="pickup-materials-heading">
            <h4 id="pickup-materials-heading">Reserved materials</h4>
            {materials.length ? <div className="bm-pickup-materials">
              {materials.map((material, index) => <div key={material.inventoryId || `${material.material}-${index}`}>
                <span>{material.material}</span><strong>{material.quantity} {material.unit}</strong>
              </div>)}
            </div> : <p className="bm-pickup-empty">No materials reserved. No inventory deduction will be recorded.</p>}
          </section>

          <section className="bm-pickup-receiver">
            <label htmlFor="pickup-received-by">Received By <span aria-hidden="true">*</span></label>
            <p>Enter the full name of the person physically collecting this order.</p>
            <input id="pickup-received-by" name="receivedByName" type="text" required minLength={2} maxLength={100}
              autoComplete="name" value={receiverName} onChange={event => onReceiverChange(event.target.value)}
              placeholder="Collector's full name" aria-describedby="pickup-receiver-help" />
            <small id="pickup-receiver-help">Required for the pickup record. This may differ from the customer name.</small>
          </section>

          <div className="bm-pickup-warning" role="note">
            <strong>Confirm release of order {detail.order.id}?</strong>
            <span>{materials.length
              ? 'This records pickup and finalizes the reserved inventory deduction. This action cannot be undone.'
              : 'This records pickup without an inventory deduction. This action cannot be undone.'}</span>
          </div>

          <footer className="bm-pickup-actions">
            <Btn variant="ghost" disabled={confirming} onClick={onClose}>Cancel</Btn>
            <Btn variant="primary" loading={confirming} disabled={confirming || !receiverValid} onClick={onConfirm}>
              {confirming ? 'Confirming…' : 'Confirm Pickup'}
            </Btn>
          </footer>
        </>}
      </div>
    </Modal>
  );
}
