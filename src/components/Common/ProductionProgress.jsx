import './ProductionProgress.css';

const STAGES = [
  { status: 'Queueing', label: 'Order Confirmed', timestamp: 'dateAssigned' },
  { status: 'In Progress', label: 'Production Started', timestamp: 'productionStartedAt' },
  { status: 'Completed', label: 'Production Completed', timestamp: 'productionCompletedAt' },
  { status: 'Ready for Pickup', label: 'Ready for Pickup', timestamp: 'readyForPickupAt' },
  { status: 'Picked Up', label: 'Picked Up', timestamp: 'pickedUpAt' }
];
const date = value => value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '';

export function ProductionProgress({ production, orderStatus, pickedUpAt }) {
  if (!production) return null;
  // When the order is Picked Up, all stages including the final one are complete
  const isPickedUp = orderStatus === 'Picked Up';
  const current = STAGES.findIndex(stage => stage.status === production.status);
  const currentIndex = isPickedUp ? STAGES.length - 1 : (current < 0 ? 0 : current);
  const statusLabel = isPickedUp ? 'Picked Up' : production.status;
  return (
    <section className="bm-production-progress" aria-label="Production progress">
      <div className="bm-production-progress__heading">
        <strong>Production Progress</strong>
        <span>{statusLabel}</span>
      </div>
      {production.status === 'Ready for Pickup' && !isPickedUp && <p className="bm-production-progress__ready">Your order is ready for pickup.</p>}
      {isPickedUp && <p className="bm-production-progress__ready">Your order has been picked up. Thank you!</p>}
      <ol className="bm-production-progress__steps">
        {STAGES.map((stage, index) => {
          const complete = index <= currentIndex;
          const timestamp = stage.timestamp === 'pickedUpAt' ? pickedUpAt : production[stage.timestamp];
          return <li className={complete ? 'is-complete' : ''} key={stage.status}>
            <span className="bm-production-progress__marker" aria-hidden="true">{complete ? '✓' : String(index + 1).padStart(2, '0')}</span>
            <span className="bm-production-progress__label">{stage.label}</span>
            {complete && timestamp && <time dateTime={timestamp}>{date(timestamp)}</time>}
          </li>;
        })}
      </ol>
    </section>
  );
}
