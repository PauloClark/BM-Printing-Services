import { useEffect, useState } from 'react';
import { orderApi, orderFileApi } from '../../utils/orderApi';
import { Card } from '../Common/Card';
import { Btn } from '../Common/Btn';
import { Modal } from '../Common/Modal';
import './AdminOrderArchive.css';

const money = value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value) || 0);
const date = value => value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'Not recorded';
const todayInManila = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const monthStart = () => `${todayInManila().slice(0, 8)}01`;

export function ArchivedOrders({ user }) {
  const [orders, setOrders] = useState([]);
  const [query, setQuery] = useState('');
  const [product, setProduct] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set('q', query.trim());
        if (product.trim()) params.set('product', product.trim());
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        const data = await orderApi(`/api/admin/archived-orders?${params}`, {}, user);
        if (active) setOrders(data.orders || []);
      } catch (requestError) {
        if (active) setError(requestError.message || 'Unable to load archived orders.');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [user, query, product, from, to, refresh]);

  const openOrder = async orderId => {
    setSelected({ loading: true, orderId });
    setDetailLoading(true);
    setError('');
    try {
      const data = await orderApi(`/api/admin/archived-orders/${encodeURIComponent(orderId)}`, {}, user);
      setSelected(data);
    } catch (requestError) {
      setError(requestError.message || 'Unable to load archived order details.');
      setSelected(null);
    } finally {
      setDetailLoading(false);
    }
  };

  if (user?.role !== 'admin') return <Card role="alert">Admin access is required to view archived orders.</Card>;
  return <section className="bm-archive-page">
    <div className="bm-archive-toolbar">
      <div><h3>Archived Orders</h3><p>Historical orders remain available for review and reporting.</p></div>
      <Btn variant="ghost" onClick={() => setRefresh(value => value + 1)}>Refresh</Btn>
    </div>
    <div className="bm-archive-filters">
      <label>Order / customer<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search order, name, or email" /></label>
      <label>Product<input value={product} onChange={event => setProduct(event.target.value)} placeholder="Product name" /></label>
      <label>Completed from<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>Completed to<input type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
      <Btn variant="ghost" onClick={() => { setQuery(''); setProduct(''); setFrom(''); setTo(''); }}>Clear filters</Btn>
    </div>
    {error && <p className="bm-archive-error" role="alert">{error}</p>}
    <Card><div className="bm-archive-table-wrap"><table className="bm-archive-table">
      <thead><tr>{['Order #', 'Customer', 'Product', 'Qty', 'Total', 'Completed', 'Picked Up', ''].map((label, index) => <th key={`${label}-${index}`}>{label}</th>)}</tr></thead>
      <tbody>
        {orders.map(order => <tr key={order.id}>
          <td>{order.id}</td><td>{order.customer}</td><td>{order.product}</td><td>{order.quantity}</td><td>{money(order.total)}</td>
          <td>{date(order.production?.productionCompletedAt)}</td><td>{date(order.pickedUpAt)}</td><td><Btn size="sm" onClick={() => openOrder(order.id)}>View</Btn></td>
        </tr>)}
        {!orders.length && <tr><td colSpan={8} className="bm-archive-empty">{loading ? 'Loading archived orders…' : 'No archived orders match these filters.'}</td></tr>}
      </tbody>
    </table></div></Card>

    <Modal open={Boolean(selected)} onClose={() => !detailLoading && setSelected(null)} title={`Archived Order #${selected?.order?.id || selected?.orderId || ''}`} width={820}>
      {detailLoading ? <p>Loading archived order…</p> : selected?.order && <div className="bm-archive-detail">
        <section><h4>Customer</h4><dl className="bm-archive-detail__grid">
          <div><dt>Name</dt><dd>{selected.order.customer}</dd></div><div><dt>Email</dt><dd>{selected.order.email}</dd></div>
          <div><dt>Phone</dt><dd>{selected.order.phone}</dd></div><div><dt>Address</dt><dd>{selected.order.address || 'Not recorded'}</dd></div>
        </dl></section>
        <section><h4>Order</h4><dl className="bm-archive-detail__grid">
          <div><dt>Product</dt><dd>{selected.order.product}</dd></div><div><dt>Quantity</dt><dd>{selected.order.quantity}</dd></div>
          <div><dt>Specifications</dt><dd className="bm-archive-prewrap">{selected.order.specs || 'Not recorded'}</dd></div>
          <div><dt>Total</dt><dd>{money(selected.order.total)}</dd></div><div><dt>Order Status</dt><dd>{selected.order.status}</dd></div>
        </dl></section>
        <section><h4>Payment</h4>
          <p>Payment Method: {selected.order.payment || 'Not recorded'} · Status: {selected.order.paymentStatus || 'Not recorded'}</p>
          {selected.payments?.map((payment, index) => <p key={`${payment.referenceNumber}-${index}`}>{money(payment.amount)} · {payment.status} · Ref {payment.referenceNumber || 'Not recorded'} · Verified {date(payment.verifiedAt)}</p>)}
        </section>
        <section><h4>Job Order &amp; Production</h4><dl className="bm-archive-detail__grid">
          <div><dt>Job Order Number</dt><dd>{selected.job?.jobOrderId || 'Not recorded'}</dd></div><div><dt>Assigned Employee</dt><dd>{selected.job?.assignedEmployeeName || 'Not recorded'}</dd></div>
          <div><dt>Date Assigned</dt><dd>{date(selected.job?.dateAssigned)}</dd></div><div><dt>Production Started</dt><dd>{date(selected.job?.productionStartedAt)}</dd></div>
          <div><dt>Production Completed</dt><dd>{date(selected.job?.productionCompletedAt)}</dd></div><div><dt>Ready for Pickup</dt><dd>{date(selected.job?.readyForPickupAt)}</dd></div>
        </dl></section>
        <section><h4>Pickup</h4><p>Picked Up: {date(selected.pickup?.pickedUpAt)} · Released By: {selected.pickup?.releasedByName || 'Not recorded'} · Received By: {selected.pickup?.receivedByName || 'Customer'}</p></section>
        <section><h4>Inventory Movements</h4><div className="bm-archive-table-wrap"><table className="bm-archive-table"><thead><tr>{['Material', 'Quantity', 'Type', 'Reason', 'Recorded'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
          {selected.movements?.map((movement, index) => <tr key={`${movement.material}-${index}`}><td>{movement.material}</td><td>{movement.quantity} {movement.unit}</td><td>{movement.movementType}</td><td>{movement.reason}</td><td>{date(movement.createdAt)}</td></tr>)}
        </tbody></table></div></section>
        <section><h4>Archive</h4><p>Archived {date(selected.order.archivedAt)} by {selected.order.archivedByName || selected.order.archivedBy}</p></section>
      </div>}
    </Modal>
  </section>;
}

export function CompletedOrdersReport({ user }) {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayInManila);
  const [product, setProduct] = useState('');
  const [query, setQuery] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const generate = async event => {
    event?.preventDefault();
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ from, to });
      if (query.trim()) params.set('q', query.trim());
      if (product.trim()) params.set('product', product.trim());
      setReport(await orderApi(`/api/admin/reports/completed-orders?${params}`, {}, user));
    } catch (requestError) {
      setError(requestError.message || 'Unable to generate completed orders report.');
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  const exportReport = async () => {
    if (!report || exporting) return;
    setExporting(true);
    setError('');
    try {
      const params = new URLSearchParams({ from: report.from, to: report.to });
      if (query.trim()) params.set('q', query.trim());
      if (product.trim()) params.set('product', product.trim());
      const blob = await orderFileApi(`/api/admin/reports/completed-orders/export?${params}`, user);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `BM_Printing_Completed_Orders_${report.from}_to_${report.to}.xlsx`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (requestError) {
      setError(requestError.message || 'Unable to export report.');
    } finally {
      setExporting(false);
    }
  };

  if (user?.role !== 'admin') return <Card role="alert">Admin access is required to generate completed order reports.</Card>;
  return <section className="bm-completed-report">
    <div className="bm-archive-toolbar"><div><h3>Completed Orders Report</h3><p>Reports use the saved production completion date and include only picked-up orders with finalized inventory.</p></div></div>
    <form className="bm-report-filters" onSubmit={generate}>
      <label>From<input required type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>To<input required type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
      <label>Product<input value={product} onChange={event => setProduct(event.target.value)} placeholder="Any product" /></label>
      <label>Order / customer<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search order or customer" /></label>
      <Btn loading={loading}>Generate Report</Btn>
    </form>
    {error && <p className="bm-archive-error" role="alert">{error}</p>}
    {report && <>
      <div className="bm-report-summary"><Card><span>Reporting Period</span><strong>{report.reportingPeriod}</strong></Card><Card><span>Completed Orders</span><strong>{report.completedOrders}</strong></Card><Card><span>Total Sales</span><strong>{money(report.totalSales)}</strong></Card></div>
      <div className="bm-archive-toolbar"><p>{report.completedOrders === 0 ? 'No completed orders found for this period.' : `${report.completedOrders} completed order${report.completedOrders === 1 ? '' : 's'} found.`}</p><Btn variant="secondary" disabled={exporting} loading={exporting} onClick={exportReport}>Export Spreadsheet</Btn></div>
      {report.rows.length > 0 && <Card><div className="bm-archive-table-wrap"><table className="bm-archive-table bm-report-table">
        <thead><tr>{['Order Number', 'Client', 'Product / Service', 'Qty', 'Total Amount', 'Payment Method', 'Amount Paid', 'Assigned Employee', 'Production Started', 'Production Completed / Manufacture Date', 'Ready for Pickup', 'Picked Up'].map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{report.rows.map(row => <tr key={row.orderId}><td>{row.orderId}</td><td>{row.customerName}</td><td>{row.product}</td><td>{row.quantity}</td><td>{money(row.totalAmount)}</td><td>{row.paymentMethod}</td><td>{money(row.amountPaid)}</td><td>{row.assignedEmployee}</td><td>{date(row.productionStartedAt)}</td><td>{date(row.productionCompletedAt)}</td><td>{date(row.readyForPickupAt)}</td><td>{date(row.pickedUpAt)}</td></tr>)}</tbody>
      </table></div></Card>}
    </>}
  </section>;
}
