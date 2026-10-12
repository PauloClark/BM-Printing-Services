import './ProductionProgress.css';

const STAGES = [
  { key: 'assigned', label: 'Assigned', statuses: ['Assigned', 'Acknowledged'], timestamp: 'dateAssigned' },
  { key: 'production', label: 'In Production', statuses: ['In Progress'], timestamp: 'productionStartedAt' },
  { key: 'review', label: 'Submitted for Review', statuses: ['Submitted for Review', 'Correction Required'], history: 'Submitted for Review' },
  { key: 'approved', label: 'Approved', statuses: ['Approved'], timestamp: 'reviewedAt', history: 'Approved' },
  { key: 'pickup', label: 'Ready for Pickup', statuses: ['Ready for Pickup'], timestamp: 'readyForPickupAt' },
  { key: 'picked-up', label: 'Picked Up', statuses: ['Picked Up'], timestamp: 'pickedUpAt' }
];
const date = value => value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '';

export function ProductionProgress({ production, orderStatus, pickedUpAt }) {
  if (!production) return null;
  if (orderStatus === 'Cancelled') return <section className="bm-production-progress" aria-label="Production progress">
    <div className="bm-production-progress__heading"><strong>Production Progress</strong><span>Cancelled</span></div>
    <p className="bm-production-progress__attention">This order was cancelled. Later production stages are not shown as completed.</p>
  </section>;

  const history = production.productionHistory || [];
  const eventFor = stage => stage.history ? [...history].reverse().find(event => event.status === stage.history) : null;
  const timestamps = STAGES.map(stage => stage.key === 'picked-up' ? pickedUpAt : production[stage.timestamp] || eventFor(stage)?.timestamp || null);
  const statusLabel = orderStatus === 'Picked Up' ? 'Picked Up' : production.status;
  const currentKey = orderStatus === 'Picked Up' ? 'picked-up' : production.status === 'Correction Required' ? 'review' : STAGES.find(stage => stage.statuses.includes(production.status))?.key;
  const currentIndex = STAGES.findIndex(stage => stage.key === currentKey);

  return <section className="bm-production-progress" aria-label="Production progress">
    <div className="bm-production-progress__heading"><strong>Production Progress</strong><span>{statusLabel}</span></div>
    {production.status === 'Correction Required' && <p className="bm-production-progress__attention">Corrections are in progress following Admin review.</p>}
    {production.status === 'Ready for Pickup' && orderStatus !== 'Picked Up' && <p className="bm-production-progress__ready">Your order is ready for pickup.</p>}
    {orderStatus === 'Picked Up' && <p className="bm-production-progress__ready">Your order has been picked up. Thank you!</p>}
    <ol className="bm-production-progress__steps">
      {STAGES.map((stage, index) => {
        const timestamp = timestamps[index];
        const current = currentKey === stage.key;
        const complete = index < currentIndex || (!current && Boolean(timestamp) && index <= currentIndex);
        return <li className={`${complete ? 'is-complete' : ''}${current ? ' is-current' : ''}`} key={stage.key}>
          <span className="bm-production-progress__marker" aria-hidden="true">{complete ? '\u2713' : String(index + 1).padStart(2, '0')}</span>
          <span className="bm-production-progress__label">{stage.label}</span>
          {timestamp && <time dateTime={timestamp}>{date(timestamp)}</time>}
        </li>;
      })}
    </ol>
  </section>;
}
