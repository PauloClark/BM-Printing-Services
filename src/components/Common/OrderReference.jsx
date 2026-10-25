import { Btn } from './Btn';
const money = value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value || 0);
export function OrderReference({ order, compact = false }) {
  const cash = (order.paymentMethod || order.payment) === 'cash';
  const rows = [['Order ID', order.id || order.orderId], ['Customer', order.customer || order.customerName], ['Product', order.product], ['Specifications', order.specs || 'None recorded'], ['Quantity', order.quantity], ['Total price', money(order.total ?? order.totalAmount)], ['Payment method', cash ? 'Cash — Pay at Shop' : order.payment], ['Payment status', order.paymentStatus === 'Verified' ? 'Paid — verified by Admin' : cash ? 'Pending Payment' : order.paymentStatus || 'Unpaid']];
  const instruction = cash ? 'Present this reference at BM Printing Services. Production starts only after Admin verifies full payment.' : 'Payment requires Admin verification before production.';
  const print = () => {
    const popup = window.open('', '_blank', 'width=720,height=800');
    if (!popup) return;
    popup.opener = null;
    popup.document.title = `BM Printing Services — ${order.id}`;
    const heading = popup.document.createElement('h1'); heading.textContent = 'BM Printing Services — Order Reference'; popup.document.body.append(heading);
    for (const [label, value] of rows) { const p = popup.document.createElement('p'); p.textContent = `${label}: ${value ?? ''}`; p.style.whiteSpace = 'pre-wrap'; popup.document.body.append(p); }
    const p = popup.document.createElement('p'); p.textContent = instruction; popup.document.body.append(p);
    popup.focus(); popup.print();
  };
  return <section className="bm-order-reference">{!compact && <><h3>Order Reference</h3><dl>{rows.map(([label,value]) => <div key={label}><dt>{label}</dt><dd style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{value}</dd></div>)}</dl><p>{instruction}</p></>}<Btn size="sm" variant="ghost" onClick={print}>Print / Save Order Reference</Btn></section>;
}
