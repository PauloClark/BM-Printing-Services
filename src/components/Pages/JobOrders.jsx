import { useEffect, useState } from 'react';
import { orderApi } from '../../utils/orderApi';
import { Modal } from '../Common/Modal';
import { Btn } from '../Common/Btn';
import { OrderDesignFiles } from '../Common/OrderDesignFiles';
import './JobOrders.css';

const money = n => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n || 0);
const date = value => value ? new Date(value).toLocaleString('en-PH') : 'Not recorded';
const daysInQueue = value => value ? Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000)) : 0;
const JOB_STATUSES = ['Queueing', 'In Progress', 'Completed', 'Ready for Pickup'];
const NEXT_STATUS = { Queueing: 'In Progress', 'In Progress': 'Completed', Completed: 'Ready for Pickup' };

export function JobOrders({ user, refresh = 0 }) {
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState('All');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true, pending = false;
    const load = async () => { if (pending) return; pending = true; try { const data = await orderApi('/api/job-orders', {}, user); if (active) { setJobs(data.jobs || []); setError(''); } } catch (e) { if (active) setError(e.message); } finally { pending = false; if (active) setLoading(false); } };
    load(); const timer = setInterval(load, 5000); window.addEventListener('focus', load);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', load); };
  }, [user, refresh, revision]);
  const job = jobs.find(j => j.jobOrderId === selected);
  const shown = jobs.filter(item => filter === 'All' || item.status === filter);
  const transition = async () => {
    if (!job || busy || !NEXT_STATUS[job.status]) return;
    const status = NEXT_STATUS[job.status];
    if (status === 'Ready for Pickup' && !window.confirm(`Mark ${job.jobOrderId} ready for pickup?`)) return;
    setBusy(true);
    setError('');
    try {
      const data = await orderApi(`/api/job-orders/${encodeURIComponent(job.jobOrderId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ expectedStatus: job.status, status })
      }, user);
      setJobs(current => current.map(item => item.jobOrderId === job.jobOrderId ? data.job : item));
    } catch (requestError) {
      setError(requestError.message || 'Unable to update this Job Order.');
      setRevision(value => value + 1);
    } finally {
      setBusy(false);
    }
  };
  return <section className="bm-jobs">
    <div className="bm-jobs-toolbar">
      <h2>{user.role === 'admin' ? 'Job Order Monitoring' : 'My Job Orders'}</h2>
      {user.role === 'admin' && <label className="bm-jobs-filter">Filter status<select aria-label="Filter job orders by status" value={filter} onChange={event => setFilter(event.target.value)}><option>All</option>{JOB_STATUSES.map(status => <option key={status}>{status}</option>)}</select></label>}
      <button onClick={() => { setLoading(true); setRevision(n => n + 1); }}>Refresh jobs</button>
    </div>
    {error && <p role="alert">{error}</p>}
    <p>Job assignments and production status refresh automatically every 5 seconds.</p>
    <div className="bm-jobs-table"><table><thead><tr>{['Job Order', 'Order', 'Customer', 'Product / Qty', 'Assigned Employee', 'Date Queued', 'Days in Queue', 'Status', 'Action'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
      {shown.map(item => <tr key={item.jobOrderId}><td>{item.jobOrderId}</td><td>{item.orderId}</td><td>{item.order?.customer || 'Not available'}</td><td>{item.order ? `${item.order.product} · ${item.order.quantity} pcs` : 'Not available'}</td><td>{item.assignedEmployeeName}</td><td>{date(item.dateAssigned)}</td><td>{daysInQueue(item.dateAssigned)} days</td><td>{item.status}</td><td><button onClick={() => setSelected(item.jobOrderId)}>View Job</button></td></tr>)}
      {!shown.length && <tr><td colSpan={9}>{loading ? 'Loading job orders…' : error ? 'Job orders could not be loaded.' : 'No job orders in this status.'}</td></tr>}
    </tbody></table></div>
    <Modal open={Boolean(job)} onClose={() => !busy && setSelected(null)} title={`Job Order ${job?.jobOrderId || ''}`} width={820}>
      {job && <div className="bm-job-details">
        <div className="bm-job-details__status"><span>Current Status</span><strong>{job.status}</strong></div>
        <section><h3>Order Information</h3>
          <dl className="bm-job-details__grid">
            <div><dt>Order Number</dt><dd>{job.orderId}</dd></div>
            <div><dt>Customer</dt><dd>{job.order?.customer || 'Not available'}</dd></div>
            <div><dt>Product</dt><dd>{job.order?.product || 'Not available'}</dd></div>
            <div><dt>Quantity</dt><dd>{job.order?.quantity ?? 'Not available'} pcs</dd></div>
            <div><dt>Order Total</dt><dd>{money(job.order?.total)}</dd></div>
            <div><dt>Payment</dt><dd>{job.order?.paymentStatus || 'Not recorded'}</dd></div>
          </dl>
        </section>
        {job.order && <section><h3>Specifications &amp; Instructions</h3><p className="bm-jobs-specs">{job.order.specs || 'No specifications recorded.'}</p>{job.order.notes && <p>{job.order.notes}</p>}<OrderDesignFiles order={job.order} user={user} /></section>}
        <section><h3>Assignment &amp; Queue</h3>
          <dl className="bm-job-details__grid">
            <div><dt>Assigned To</dt><dd>{job.assignedEmployeeName}</dd></div>
            <div><dt>Date Assigned / Queued</dt><dd>{date(job.dateAssigned)}</dd></div>
            <div><dt>Days in Queue</dt><dd>{daysInQueue(job.dateAssigned)} days</dd></div>
            <div><dt>Assigned By</dt><dd>{job.assignedByName || job.assignedBy || 'Not recorded'}</dd></div>
          </dl>
        </section>
        <section><h3>Materials: Reserved</h3><ul>{(job.reservedMaterials || []).map(material => <li key={material.inventoryId}>{material.material}: {material.quantity} {material.unit} reserved</li>)}</ul></section>
        <section><h3>Production History</h3>
          <dl className="bm-job-details__grid">
            <div><dt>Production Started</dt><dd>{date(job.productionStartedAt)}</dd></div>
            <div><dt>Started By</dt><dd>{job.productionStartedBy || 'Not recorded'}</dd></div>
            <div><dt>Production Completed</dt><dd>{date(job.productionCompletedAt)}</dd></div>
            <div><dt>Completed By</dt><dd>{job.productionCompletedBy || 'Not recorded'}</dd></div>
            <div><dt>Ready for Pickup</dt><dd>{date(job.readyForPickupAt)}</dd></div>
            <div><dt>Marked Ready By</dt><dd>{job.readyForPickupBy || 'Not recorded'}</dd></div>
          </dl>
        </section>
        {job.status === 'In Progress' && <p className="bm-job-details__active">STATUS: IN PROGRESS · Started {date(job.productionStartedAt)}</p>}
        {error && <p role="alert">{error}</p>}
        {NEXT_STATUS[job.status] && <div className="bm-jobs-toolbar"><Btn disabled={busy} loading={busy} onClick={transition}>{job.status === 'Queueing' ? 'Start Production' : job.status === 'In Progress' ? 'Mark Production Completed' : 'Mark Ready for Pickup'}</Btn></div>}
      </div>}
    </Modal>
  </section>;
}

export function PrepareJobOrder({ order, user, onCreated }) {
  const [open, setOpen] = useState(false), [inventory, setInventory] = useState([]), [staff, setStaff] = useState([]), [employee, setEmployee] = useState('');
  const [rows, setRows] = useState([{ inventoryId: '', quantity: 1 }]), [check, setCheck] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [jobId, setJobId] = useState('');
  const load = async () => {
    setBusy(true); setError(''); setCheck(null);
    try { const [materials, people] = await Promise.all([orderApi('/api/inventory', {}, user), orderApi('/api/job-orders/staff', {}, user)]); setInventory(materials.inventory); setStaff(people.staff); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const update = (index, field, value) => { setCheck(null); setRows(current => current.map((r, i) => i === index ? { ...r, [field]: value } : r)); };
  const verify = async () => {
    setBusy(true); setError(''); setCheck(null);
    try { setCheck(await orderApi(`/api/orders/${encodeURIComponent(order.id)}/material-check`, { method: 'POST', body: JSON.stringify({ materials: rows }) }, user)); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const create = async () => {
    setBusy(true); setError('');
    try { const { job } = await orderApi('/api/job-orders', { method: 'POST', body: JSON.stringify({ orderId: order.id, materials: rows, assignedEmployeeId: employee }) }, user); setJobId(job.jobOrderId); onCreated?.(); }
    catch (e) { setError(e.message); setCheck(null); } finally { setBusy(false); }
  };
  if (order.jobOrderId) return <p>Job Order already created: <strong>{order.jobOrderId}</strong></p>;
  if (order.paymentStatus !== 'Verified' || order.status !== 'Confirmed') return <p>Job preparation requires admin-verified payment and a Confirmed order.</p>;
  return <div className="bm-jobs">
    <button onClick={() => { setOpen(true); load(); }}>Prepare Job Order</button>
    <Modal open={open} onClose={() => !busy && setOpen(false)} title={`Prepare Job Order · ${order.id}`} width={800}>
      {jobId ? <p>Created {jobId} · Queueing · Materials reserved</p> : <>
        <p>{order.customer} · {order.product} · {order.quantity} pcs</p><p className="bm-jobs-specs">{order.specs}</p><p>{money(order.total)} · Payment: {order.paymentStatus}</p>
        <h4>Required materials</h4><p>Select actual quantities for this job. On-hand stock is not deducted.</p>
        {rows.map((row, i) => <div className="bm-jobs-material" key={i}>
          <label>Material<select aria-label={`Material ${i + 1}`} value={row.inventoryId} disabled={busy} onChange={e => update(i, 'inventoryId', e.target.value)}><option value="">Select material</option>{inventory.map(item => <option key={item._id} value={item._id}>{item.material} — available {item.availableQuantity} {item.unit}</option>)}</select></label>
          <label>Required quantity<input aria-label={`Required quantity ${i + 1}`} type="number" min="0.001" step="0.001" value={row.quantity} disabled={busy} onChange={e => update(i, 'quantity', Number(e.target.value))} /></label>
          <button disabled={busy || rows.length === 1} onClick={() => { setRows(rows.filter((_, n) => n !== i)); setCheck(null); }}>Remove</button>
        </div>)}
        <div className="bm-jobs-toolbar"><button disabled={busy || rows.length >= 50} onClick={() => { setRows([...rows, { inventoryId: '', quantity: 1 }]); setCheck(null); }}>Add material</button><button disabled={busy} onClick={verify}>Check availability</button><button disabled={busy} onClick={load}>Refresh materials / staff</button></div>
        {check && <div role="status"><strong>{check.available ? 'AVAILABLE' : 'INSUFFICIENT STOCK'}</strong><ul>{check.materials.map(m => <li key={m.inventoryId}>{m.material}: Required {m.quantity} · Available {m.available} · Shortage {m.shortage} {m.unit}</li>)}</ul></div>}
        <label>Assigned Employee<select aria-label="Assigned Employee" value={employee} disabled={busy} onChange={e => setEmployee(e.target.value)}><option value="">Select existing staff</option>{staff.map(person => <option key={person.id} value={person.id}>{person.name} ({person.email})</option>)}</select></label>
        {!staff.length && !busy && <p>No assignable staff loaded. Refresh or ask the administrator to check staff-directory configuration.</p>}
        <button className="bm-jobs-primary" disabled={busy || !check?.available || !employee} onClick={create}>{busy ? 'Please wait…' : 'Create Job Order'}</button>
      </>}
      {error && <p role="alert">{error}</p>}
    </Modal>
  </div>;
}
