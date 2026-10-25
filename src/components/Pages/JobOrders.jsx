import { useEffect, useState } from 'react';
import { orderApi } from '../../utils/orderApi';
import { Modal } from '../Common/Modal';
import { Btn } from '../Common/Btn';
import { OrderDesignFiles } from '../Common/OrderDesignFiles';
import './JobOrders.css';

const money = n => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n || 0);
const date = value => value ? new Date(value).toLocaleString('en-PH') : 'Not recorded';
const STATUSES = ['Assigned','Acknowledged','In Progress','Submitted for Review','Correction Required','Approved','Ready for Pickup'];
const STAFF_NEXT = { Assigned:'Acknowledged', Queueing:'Acknowledged', Acknowledged:'In Progress', 'Correction Required':'In Progress', 'In Progress':'Submitted for Review' };
const STAFF_LABEL = { Acknowledged:'Acknowledge Job', 'In Progress':'Start / Resume Job', 'Submitted for Review':'Complete & Submit for Review' };
const tone = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
const specificationRows = value => {
  const rows = String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const separator = line.indexOf(':');
    return separator > 0 ? { label: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() } : { label: 'Specification', value: line };
  });
  return rows.length ? rows : [{ label: 'Specifications', value: 'No specifications recorded.' }];
};

export function JobOrders({ user, refresh = 0 }) {
  const [jobs,setJobs]=useState([]), [eligible,setEligible]=useState([]), [error,setError]=useState('');
  const [selected,setSelected]=useState(null), [revision,setRevision]=useState(0), [filter,setFilter]=useState('All');
  const [busy,setBusy]=useState(false), [loading,setLoading]=useState(true);
  useEffect(() => { let active=true,pending=false; const load=async()=>{ if(pending)return; pending=true; try { const [a,b]=await Promise.all([orderApi('/api/job-orders',{},user),user.role==='admin'?orderApi('/api/job-orders/eligible',{},user):Promise.resolve({orders:[]})]); if(active){setJobs(a.jobs||[]);setEligible(b.orders||[]);setError('');} } catch(e){if(active)setError(e.message);} finally {pending=false;if(active)setLoading(false);} }; load(); const timer=setInterval(load,5000); window.addEventListener('focus',load); return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',load);}; },[user,refresh,revision]);
  const job=jobs.find(item=>item.jobOrderId===selected), shown=jobs.filter(item=>filter==='All'||item.status===filter); const exceptionActive=(job?.exceptionHistory||[]).some(item=>item.resolutionStatus==='ACTIVE');
  const request=async(path,options)=>{setBusy(true);setError('');try{await orderApi(path,options,user);setRevision(n=>n+1);setSelected(null);}catch(e){setError(e.message||'Unable to update this job order.');}finally{setBusy(false);}};
  const advance=()=>request(`/api/job-orders/${encodeURIComponent(job.jobOrderId)}/status`,{method:'PATCH',body:JSON.stringify({expectedStatus:job.status,status:STAFF_NEXT[job.status]})});
  const review=action=>{const notes=action==='return'?window.prompt('Correction instructions (required):'):'';if(action==='return'&&!notes?.trim())return;request(`/api/job-orders/${encodeURIComponent(job.jobOrderId)}/review`,{method:'POST',body:JSON.stringify({action,notes})});};
  return <section className="bm-jobs">
    {user.role==='admin'&&<section className="bm-jobs-queue"><h2>Verified Orders Awaiting Assignment</h2><div className="bm-jobs-table"><table><thead><tr>{['Order','Customer','Product / Qty','Total','Payment','Date','Assignment'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{eligible.map(order=><tr key={order.id}><td>{order.id}</td><td>{order.customer}</td><td>{order.product} · {order.quantity}</td><td>{money(order.total)}</td><td>{order.paymentStatus}</td><td>{date(order.createdAt)}</td><td><PrepareJobOrder order={order} user={user} onCreated={()=>setRevision(n=>n+1)}/></td></tr>)}{!eligible.length&&<tr><td colSpan={7}>{loading?'Loading eligible orders…':'No verified orders are awaiting assignment.'}</td></tr>}</tbody></table></div></section>}
    <div className="bm-jobs-toolbar"><h2>{user.role==='admin'?'Assigned Job Orders':'My Assigned Jobs'}</h2>{user.role==='admin'&&<label>Filter status <select value={filter} onChange={e=>setFilter(e.target.value)}><option>All</option>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></label>}<button className="bm-jobs-refresh" onClick={()=>{setLoading(true);setRevision(n=>n+1);}}>Refresh</button></div>
    {error&&<p role="alert">{error}</p>}<div className="bm-jobs-table"><table><thead><tr>{['Job Order','Order','Customer','Product / Qty','Employee','Priority','Due','Status','Action'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{shown.map(item=><tr key={item.jobOrderId}><td className="bm-jobs-id">{item.jobOrderId}</td><td className="bm-jobs-id">{item.orderId}</td><td>{item.order?.customer||'Not available'}</td><td className="bm-jobs-product">{item.order?`${item.order.product} · ${item.order.quantity}`:'Not available'}</td><td>{item.assignedEmployeeName||'Unknown employee'}</td><td><span className={`bm-job-priority is-${tone(item.priority)}`}>{item.priority||'normal'}</span></td><td>{date(item.dueDate)}</td><td><span className={`bm-job-status is-${tone(item.status)}`}>{item.status}</span></td><td><button className="bm-jobs-view" onClick={()=>setSelected(item.jobOrderId)}>View Job</button></td></tr>)}{!shown.length&&<tr><td className="bm-jobs-empty" colSpan={9}>{loading?'Loading job orders…':'No job orders in this status.'}</td></tr>}</tbody></table></div>
    <Modal open={Boolean(job)} onClose={()=>!busy&&setSelected(null)} title={`Job Order ${job?.jobOrderId||''}`} width={820}>{job&&<div className="bm-job-details"><div className="bm-job-details__status"><span>Current Status · Materials {job.materialOperationState||'legacy'}</span><strong>{job.status}</strong></div>{job.materialPlanMode==='NO_MANAGED_MATERIALS'&&<><p className="bm-job-details__active">No inventory-managed materials: {job.noMaterialsReason}</p>{user.role==='admin'&&job.materialOperationState==='PREPARING'&&<Btn disabled={busy} onClick={()=>request(`/api/job-orders/${encodeURIComponent(job.jobOrderId)}/material-reconcile`,{method:'POST'})}>Complete no-material assignment</Btn>}</>}<section><h3>Order & Assignment</h3><dl className="bm-job-details__grid"><div><dt>Order number</dt><dd>{job.orderId}</dd></div><div><dt>Customer</dt><dd>{job.order?.customer||'Not available'}</dd></div><div><dt>Product</dt><dd>{job.order?.product||'Not available'}</dd></div><div><dt>Quantity</dt><dd>{job.order?.quantity??'Not available'}</dd></div><div><dt>Assigned employee</dt><dd>{job.assignedEmployeeName||'Not assigned'}</dd></div><div><dt>Assignment version</dt><dd>{job.assignmentVersion||0}</dd></div><div><dt>Due date</dt><dd>{date(job.dueDate)}</dd></div></dl></section><ProductionExceptions key={`${job.jobOrderId}:${job.assignmentVersion||0}`} job={job} user={user} onSaved={()=>setRevision(n=>n+1)}/>{user.role==='admin'&&<AdminReassignmentPanel key={`${job.jobOrderId}:${job.assignmentVersion||0}`} job={job} user={user} onSaved={()=>setRevision(n=>n+1)}/>} {job.materialPlanVersion===1&&job.materialPlanMode==='MATERIALS'&&<section><h3>Reserved materials</h3>{(job.reservedMaterials||[]).map(row=><p key={row.reservationId}>{row.material}: {row.quantity} {row.unit} · {row.reservationStatus}</p>)}{job.materialOperationError&&<p role="alert">{job.materialOperationError}</p>}{user.role==='admin'&&['RECONCILIATION_REQUIRED','RESERVATION_PENDING','CONSUMPTION_PENDING'].includes(job.materialOperationState)&&<Btn disabled={busy} onClick={()=>request(`/api/job-orders/${encodeURIComponent(job.jobOrderId)}/material-reconcile`,{method:'POST'})}>Reconcile material operation</Btn>}{user.role==='admin'&&job.materialOperationState==='RESERVED'&&['Assigned','Acknowledged','In Progress'].includes(job.status)&&<AdditionalMaterialsEditor job={job} user={user} onSaved={()=>setRevision(n=>n+1)}/>}</section>}{user.role!=='admin'&&job.materialPlanVersion===1&&job.materialPlanMode==='MATERIALS'&&<MaterialUsageEditor key={(job.reservedMaterials||[]).length} job={job} user={user} onSaved={()=>setRevision(n=>n+1)}/>}<section><h3>Specifications</h3><dl className="bm-job-details__specs">{specificationRows(job.order?.specs).map((row,i)=><div key={`${row.label}-${i}`}><dt>{row.label}</dt><dd>{row.value||'Not specified'}</dd></div>)}</dl></section><section><h3>Instructions</h3><p className="bm-job-details__instructions">{job.jobInstructions||'No additional job instructions.'}</p></section>{job.order&&<OrderDesignFiles order={job.order} user={user}/>} {job.reviewNotes&&<section><h3>Review Notes</h3><p>{job.reviewNotes}</p></section>}<section><h3>Progress History</h3><ol className="bm-job-history">{(job.productionHistory||[]).map((entry,i)=><li key={i}><span className="bm-job-history__marker"/><div><strong>{entry.status}</strong><time>{date(entry.timestamp)}</time>{entry.notes&&<p>{entry.notes}</p>}</div></li>)}</ol>{!job.productionHistory?.length&&<p>No progress events recorded.</p>}</section><div className="bm-jobs-toolbar">{user.role!=='admin'&&exceptionActive&&<p role='alert'>Production is blocked while an issue remains unresolved.</p>}{user.role!=='admin'&&STAFF_NEXT[job.status]&&<Btn disabled={busy||exceptionActive} loading={busy} onClick={advance}>{STAFF_LABEL[STAFF_NEXT[job.status]]}</Btn>}{user.role==='admin'&&job.status==='Submitted for Review'&&<><Btn disabled={busy} onClick={()=>review('approve')}>Approve Work & Materials</Btn><Btn variant="ghost" disabled={busy} onClick={()=>review('return')}>Return for Correction</Btn></>}{user.role==='admin'&&job.status==='Approved'&&<Btn disabled={busy} onClick={()=>request(`/api/job-orders/${encodeURIComponent(job.jobOrderId)}/ready-for-pickup`,{method:'POST'})}>Mark Ready for Pickup</Btn>}</div>{error&&<p role="alert">{error}</p>}</div>}</Modal>
  </section>;
}

function ProductionExceptions({ job, user, onSaved }) {
  const [type, setType] = useState('BLOCKED'), [reason, setReason] = useState(''), [notes, setNotes] = useState('');
  const [requestId, setRequestId] = useState(() => globalThis.crypto?.randomUUID?.() || ''), [action, setAction] = useState('RESUME'), [resolutionNotes, setResolutionNotes] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const active = (job.exceptionHistory || []).find(item => item.resolutionStatus === 'ACTIVE');
  const canReport = ['Assigned', 'Acknowledged', 'In Progress', 'Correction Required'].includes(job.status) || (user.role === 'admin' && ['Submitted for Review', 'Approved'].includes(job.status));
  useEffect(() => { setAction(active?.type === 'FAILED' ? 'RETURN_FOR_CORRECTION' : 'RESUME'); }, [active?.exceptionId, active?.type]);
  const report = async () => {
    setBusy(true); setError('');
    try {
      await orderApi(`/api/job-orders/${encodeURIComponent(job.jobOrderId)}/exceptions`, { method: 'POST', body: JSON.stringify({ type, reason: reason.trim(), notes: notes.trim(), requestId, expectedAssignmentVersion: job.assignmentVersion || 0 }) }, user);
      setReason(''); setNotes(''); setRequestId(globalThis.crypto?.randomUUID?.() || ''); onSaved?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const resolve = async () => {
    setBusy(true); setError('');
    try {
      await orderApi(`/api/job-orders/${encodeURIComponent(job.jobOrderId)}/exceptions/${encodeURIComponent(active.exceptionId)}/resolve`, { method: 'PATCH', body: JSON.stringify({ action, notes: resolutionNotes.trim(), expectedAssignmentVersion: job.assignmentVersion || 0, expectedStatus: job.status }) }, user);
      setResolutionNotes(''); onSaved?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const history = [...(job.exceptionHistory || [])].reverse();
  return <section className="bm-exceptions"><h3>Production exceptions</h3>
    {active && <p className="bm-exceptions__active"><strong>Production blocked · {active.type}</strong><br />{active.reason}{active.notes ? ` · ${active.notes}` : ''}</p>}
    {!active && <p>No unresolved production exception.</p>}
    {user.role === 'admin' && history.length > 0 && <ol className="bm-job-history">{history.map(item => <li key={item.exceptionId}><span className="bm-job-history__marker"/><div><strong>{item.type} · {item.resolutionStatus}</strong><time>Reported by {item.reportedByName || item.reportedBy} · {date(item.reportedAt)} · status {item.previousStatus}</time><p>{item.reason}{item.notes ? ` · ${item.notes}` : ''}</p>{item.resolutionStatus === 'RESOLVED' && <p>Resolved by {item.resolvedByName || item.resolvedBy}: {item.resolutionAction} · {item.resolutionNotes} · {date(item.resolvedAt)}</p>}{(job.exceptionNotificationOutbox || []).filter(outbox => outbox.exceptionId === item.exceptionId).map(outbox => <p key={outbox.eventKey}>Notification to {outbox.recipientRole}: {outbox.state}{outbox.lastError ? ` · ${outbox.lastError}` : ''}</p>)}</div></li>)}</ol>}
    {user.role !== 'admin' && history.length > 0 && <ol className="bm-job-history">{history.map(item => <li key={item.exceptionId}><span className="bm-job-history__marker"/><div><strong>{item.type} · {item.resolutionStatus}</strong><time>{date(item.reportedAt)}</time><p>{item.reason}{item.notes ? ` · ${item.notes}` : ''}</p>{item.resolutionStatus === 'RESOLVED' && <p>Admin resolved: {item.resolutionAction} · {item.resolutionNotes}</p>}</div></li>)}</ol>}
    {active && user.role === 'admin' && <div className="bm-exceptions__resolve"><label>Resolution action<select value={action} onChange={e => setAction(e.target.value)}>{active.type !== 'FAILED' && <option value="RESUME">Resume at current production step</option>}<option value="RETURN_FOR_CORRECTION">Return for correction and Staff review</option></select></label><label>Resolution notes<textarea value={resolutionNotes} maxLength={2000} onChange={e => setResolutionNotes(e.target.value)} /></label><Btn disabled={busy || resolutionNotes.trim().length < 3} loading={busy} onClick={resolve}>Resolve exception</Btn></div>}
    {!active && canReport && <div className="bm-exceptions__report"><h4>Report a production issue</h4><label>Issue type<select value={type} onChange={e => setType(e.target.value)}>{['DELAYED', 'BLOCKED', 'PAUSED', 'FAILED'].map(value => <option key={value}>{value}</option>)}</select></label><label>Reason<input value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} /></label><label>Optional notes<textarea value={notes} maxLength={2000} onChange={e => setNotes(e.target.value)} /></label><Btn disabled={busy || reason.trim().length < 3 || !requestId} loading={busy} onClick={report}>Report Issue</Btn></div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

function AdminReassignmentPanel({ job, user, onSaved }) {
  const [staff, setStaff] = useState([]), [employeeId, setEmployeeId] = useState(''), [reason, setReason] = useState('');
  const [requestId, setRequestId] = useState(() => globalThis.crypto?.randomUUID?.() || ''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const canReassign = ['Assigned', 'Acknowledged', 'In Progress', 'Correction Required'].includes(job.status);
  useEffect(() => { let active = true; orderApi('/api/job-orders/staff', {}, user).then(data => { if (active) setStaff(data.staff || []); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [user]);
  const submit = async () => {
    if (!employeeId || reason.trim().length < 5 || !requestId) return;
    if (!window.confirm(`Reassign ${job.jobOrderId} from ${job.assignedEmployeeName || 'current Staff'} to the selected Staff member?`)) return;
    setBusy(true); setError('');
    try {
      const result = await orderApi(`/api/job-orders/${encodeURIComponent(job.jobOrderId)}/reassign`, { method: 'POST', body: JSON.stringify({ newAssignedEmployeeId: employeeId, reason: reason.trim(), requestId, expectedAssignmentVersion: job.assignmentVersion || 0 }) }, user);
      if (result.notifications?.some(item => item.state === 'PENDING')) setError('Assignment was saved. One or more notifications remain pending; use Retry below.');
      setRequestId(globalThis.crypto?.randomUUID?.() || ''); setReason(''); setEmployeeId(''); onSaved?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const retry = async id => {
    setBusy(true); setError('');
    try { const result = await orderApi(`/api/job-orders/${encodeURIComponent(job.jobOrderId)}/reassignment-notifications/retry`, { method: 'POST', body: JSON.stringify({ requestId: id }) }, user); if (result.notifications?.some(item => item.state === 'PENDING')) setError('Some notifications remain pending. Retry again after the notification service recovers.'); onSaved?.(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <section className="bm-reassignment"><h3>Staff reassignment</h3><p>Assignment version {job.assignmentVersion || 0}. Existing reservations and usage stay on this job; the new assignee must review saved usage.</p>
    {!canReassign && <p>Reassignment is unavailable for this job status.</p>}
    {canReassign && <><label>Replacement Staff<select value={employeeId} onChange={e => setEmployeeId(e.target.value)}><option value="">Select active linked Staff</option>{staff.filter(person => person.id !== job.assignedEmployee).map(person => <option key={person.id} value={person.id}>{person.name} ({person.email})</option>)}</select></label><label>Reason<textarea value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} /></label><Btn disabled={busy || !employeeId || reason.trim().length < 5 || !requestId} loading={busy} onClick={submit}>Reassign job</Btn></>}
    {(job.assignmentHistory || []).length > 0 && <div><h4>Assignment history</h4><ol className="bm-job-history">{[...job.assignmentHistory].reverse().map(entry => <li key={entry.requestId}><span className="bm-job-history__marker"/><div><strong>{entry.previousAssignedEmployeeName || entry.previousAssignedEmployee} → {entry.newAssignedEmployeeName || entry.newAssignedEmployee}</strong><time>{date(entry.timestamp)} · {entry.actorName || entry.actorId}</time><p>{entry.reason}</p>{entry.materialUsageSubmittedAt && <p>Prior material usage saved by {entry.materialUsageSubmittedBy || 'Staff'} at {date(entry.materialUsageSubmittedAt)}.</p>}{(job.reassignmentNotificationOutbox || []).filter(item => item.requestId === entry.requestId).map(item => <p key={item.eventKey}>{item.recipientKind} Staff notification: {item.state}{item.lastError ? ` · ${item.lastError}` : ''}</p>)}{(job.reassignmentNotificationOutbox || []).some(item => item.requestId === entry.requestId && item.state === 'PENDING') && <Btn variant="ghost" disabled={busy} onClick={() => retry(entry.requestId)}>Retry pending notifications</Btn>}</div></li>)}</ol></div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

function PrepareJobOrderLegacy({ order,user,onCreated }) {
  const [open,setOpen]=useState(false),[staff,setStaff]=useState([]),[employee,setEmployee]=useState(''),[instructions,setInstructions]=useState(''),[priority,setPriority]=useState('normal'),[dueDate,setDueDate]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[jobId,setJobId]=useState('');
  const load=async()=>{setBusy(true);setError('');try{const data=await orderApi('/api/job-orders/staff',{},user);setStaff(data.staff||[]);}catch(e){setError(e.message);}finally{setBusy(false);}};
  const create=async()=>{setBusy(true);setError('');try{const {job}=await orderApi('/api/job-orders',{method:'POST',body:JSON.stringify({orderId:order.id,assignedEmployeeId:employee,jobInstructions:instructions,priority,dueDate:dueDate||null})},user);setJobId(job.jobOrderId);onCreated?.();}catch(e){setError(e.message);}finally{setBusy(false);}};
  if(order.jobOrderId)return <span>Assigned: {order.jobOrderId}</span>;
  return <><button onClick={()=>{setOpen(true);load();}}>Assign Job</button><Modal open={open} onClose={()=>!busy&&setOpen(false)} title={`Assign Job · ${order.id}`} width={720}>{jobId?<p>Assigned successfully as <strong>{jobId}</strong>.</p>:<div className="bm-job-assign"><p><strong>{order.customer}</strong> · {order.product} · {order.quantity} pcs · {money(order.total)}</p><p className="bm-jobs-specs">{order.specs||'No specifications recorded.'}</p><OrderDesignFiles order={order} user={user}/><label>Assigned Employee<select value={employee} onChange={e=>setEmployee(e.target.value)}><option value="">Select active linked employee</option>{staff.map(person=><option key={person.id} value={person.id}>{person.name} ({person.email})</option>)}</select></label><label>Job Instructions<textarea value={instructions} maxLength={2000} onChange={e=>setInstructions(e.target.value)}/></label><label>Priority<select value={priority} onChange={e=>setPriority(e.target.value)}>{['low','normal','high','urgent'].map(value=><option key={value}>{value}</option>)}</select></label><label>Due Date (optional)<input type="datetime-local" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label>{!staff.length&&!busy&&<p>No active linked employees are available. Restore and link employee records first.</p>}<div className="bm-jobs-toolbar"><Btn variant="ghost" disabled={busy} onClick={()=>setOpen(false)}>Cancel</Btn><Btn disabled={busy||!employee} loading={busy} onClick={create}>Assign Job</Btn></div></div>}{error&&<p role="alert">{error}</p>}</Modal></>;
}

export function PrepareJobOrder({ order, user, onCreated }) {
  const [open, setOpen] = useState(false), [staff, setStaff] = useState([]), [inventory, setInventory] = useState([]);
  const [employee, setEmployee] = useState(''), [instructions, setInstructions] = useState(''), [priority, setPriority] = useState('normal'), [dueDate, setDueDate] = useState('');
  const [materials, setMaterials] = useState([]), [materialId, setMaterialId] = useState(''), [materialQuantity, setMaterialQuantity] = useState('');
  const [noMaterials, setNoMaterials] = useState(false), [noMaterialsReason, setNoMaterialsReason] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [jobId, setJobId] = useState('');
  const [assignmentRequestId, setAssignmentRequestId] = useState(() => globalThis.crypto?.randomUUID?.() || '');
  const load = async () => {
    setBusy(true); setError('');
    try {
      const [staffData, inventoryData] = await Promise.all([orderApi('/api/job-orders/staff', {}, user), orderApi('/api/inventory', {}, user)]);
      setStaff(staffData.staff || []); setInventory(inventoryData.inventory || []);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const addMaterial = () => {
    const item = inventory.find(row => row._id === materialId), quantity = Number(materialQuantity);
    if (!item || !Number.isFinite(quantity) || quantity <= 0) { setError('Select a material and enter a positive quantity.'); return; }
    if (materials.some(row => row.inventoryId === item._id)) { setError('Each material can only be selected once per job.'); return; }
    if (quantity > item.availableQuantity) { setError(`Only ${item.availableQuantity} ${item.unit} of ${item.material} is available.`); return; }
    setMaterials(rows => [...rows, { inventoryId: item._id, quantity, material: item.material, unit: item.unit, onHand: item.quantity, reserved: item.reservedQuantity, available: item.availableQuantity }]);
    setMaterialId(''); setMaterialQuantity(''); setError('');
  };
  const create = async () => {
    setBusy(true); setError('');
    try {
      if (!assignmentRequestId) throw new Error('This browser cannot create a safe assignment request ID. Update your browser before assigning this job.');
      if (noMaterials && materials.length) throw new Error('Remove selected materials before choosing a no-material reason.');
      if (!noMaterials && !materials.length) throw new Error('Select production materials or explicitly confirm no inventory-managed materials.');
      if (noMaterials && !noMaterialsReason) throw new Error('Choose a reason for this job having no inventory-managed materials.');
      const materialRows = materials.map(({ inventoryId, quantity }) => ({ inventoryId, quantity }));
      if (materialRows.length) {
        const check = await orderApi(`/api/orders/${encodeURIComponent(order.id)}/material-check`, { method: 'POST', body: JSON.stringify({ materials: materialRows }) }, user);
        if (!check.available) throw new Error('Available stock changed. Review the material quantities and try again.');
      }
      const { job } = await orderApi('/api/job-orders', { method: 'POST', body: JSON.stringify({
        assignmentRequestId, orderId: order.id, assignedEmployeeId: employee, jobInstructions: instructions,
        priority, dueDate: dueDate || null, materials: materialRows, noManagedMaterials: noMaterials,
        noMaterialsReason: noMaterials ? noMaterialsReason : ''
      }) }, user);
      setJobId(job.jobOrderId); onCreated?.();
    } catch (e) { setError(e.message); if (/prior attempt was safely rolled back/i.test(e.message)) setAssignmentRequestId(globalThis.crypto?.randomUUID?.() || ''); } finally { setBusy(false); }
  };
  if (order.jobOrderId) return <span>Assigned: {order.jobOrderId}</span>;
  return <><button onClick={() => { setOpen(true); load(); }}>Assign Job</button>
    <Modal open={open} onClose={() => !busy && setOpen(false)} title={`Assign Job · ${order.id}`} width={720}>
      {jobId ? <p>Assigned successfully as <strong>{jobId}</strong>.</p> : <div className="bm-job-assign">
        <p><strong>{order.customer}</strong> · {order.product} · {order.quantity} pcs · {money(order.total)}</p>
        <p className="bm-jobs-specs">{order.specs || 'No specifications recorded.'}</p><OrderDesignFiles order={order} user={user} />
        <label>Assigned Employee<select value={employee} onChange={e => setEmployee(e.target.value)}><option value="">Select active linked employee</option>{staff.map(person => <option key={person.id} value={person.id}>{person.name} ({person.email})</option>)}</select></label>
        <section className="bm-material-picker"><h3>Production materials</h3>
          <label><input type="checkbox" checked={noMaterials} onChange={e => { setNoMaterials(e.target.checked); setError(''); }} /> This job uses no inventory-managed materials</label>
          {noMaterials ? <label>Reason<select value={noMaterialsReason} onChange={e => setNoMaterialsReason(e.target.value)}><option value="">Choose a reason</option><option>Customer-supplied materials</option><option>Service-only work</option><option>Materials not yet tracked in inventory</option></select></label> : <>
            <div className="bm-material-picker__row"><label>Material<select value={materialId} onChange={e => setMaterialId(e.target.value)}><option value="">Select material</option>{inventory.map(item => <option key={item._id} value={item._id} disabled={materials.some(row => row.inventoryId === item._id)}>{item.material} · {item.availableQuantity} {item.unit} available</option>)}</select></label><label>Quantity<input type="number" min="0.001" step="0.001" value={materialQuantity} onChange={e => setMaterialQuantity(e.target.value)} /></label><Btn type="button" variant="ghost" onClick={addMaterial}>Add material</Btn></div>
            {materials.map(row => <div className="bm-material-picker__selected" key={row.inventoryId}><span>{row.material} · {row.quantity} {row.unit} requested · on hand {row.onHand}, reserved {row.reserved}, available {row.available}</span><button type="button" onClick={() => setMaterials(items => items.filter(item => item.inventoryId !== row.inventoryId))}>Remove</button></div>)}
            {!inventory.length && !busy && <p>No raw materials are listed in inventory.</p>}
          </>}
        </section>
        <label>Job Instructions<textarea value={instructions} maxLength={2000} onChange={e => setInstructions(e.target.value)} /></label>
        <label>Priority<select value={priority} onChange={e => setPriority(e.target.value)}>{['low', 'normal', 'high', 'urgent'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Due Date (optional)<input type="datetime-local" value={dueDate} onChange={e => setDueDate(e.target.value)} /></label>
        {!staff.length && !busy && <p>No active linked employees are available. Restore and link employee records first.</p>}
        <div className="bm-jobs-toolbar"><Btn variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</Btn><Btn disabled={busy || !employee} loading={busy} onClick={create}>Assign Job</Btn></div>
      </div>}
      {error && <p role="alert">{error}</p>}
    </Modal>
  </>;
}

function MaterialUsageEditor({ job, user, onSaved }) {
  const initial = (job.reservedMaterials || []).map(material => {
    const saved = (job.materialUsage || []).find(row => row.reservationId === material.reservationId);
    return { reservationId: material.reservationId, material: material.material, unit: material.unit, quantity: material.quantity,
      usedQuantity: saved?.usedQuantity ?? '', wastedQuantity: saved?.wastedQuantity ?? '', unusedQuantity: saved?.unusedQuantity ?? '',
      wasteReason: saved?.wasteReason || '', notes: saved?.notes || '' };
  });
  const [rows, setRows] = useState(initial), [reviewPreviousUsage, setReviewPreviousUsage] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const exceptionActive = (job.exceptionHistory || []).some(item => item.resolutionStatus === 'ACTIVE');
  const change = (id, key, value) => setRows(current => current.map(row => row.reservationId === id ? { ...row, [key]: value } : row));
  const save = async () => {
    setBusy(true); setError('');
    try {
      const materials = rows.map(row => ({ reservationId: row.reservationId, usedQuantity: Number(row.usedQuantity), wastedQuantity: Number(row.wastedQuantity), unusedQuantity: Number(row.unusedQuantity), wasteReason: row.wasteReason, notes: row.notes }));
      await orderApi(`/api/job-orders/${encodeURIComponent(job.jobOrderId)}/material-usage`, { method: 'PUT', body: JSON.stringify({ materials, reviewPreviousUsage }) }, user);
      onSaved?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <section className="bm-material-usage"><h3>Materials Used</h3><p>Record quantities for each reservation. Used + wasted + unused must equal the reserved amount.</p>
    {job.materialUsageReviewRequired && <div className="bm-job-details__active"><strong>Review required:</strong> a previous Staff member saved material usage. Compare the saved values below with actual usage before submitting your update.<label><input type="checkbox" checked={reviewPreviousUsage} onChange={e => setReviewPreviousUsage(e.target.checked)} /> I reviewed the previous saved material usage</label></div>}
    {rows.map(row => <div className="bm-material-usage__row" key={row.reservationId}><strong>{row.material} · reserved {row.quantity} {row.unit}</strong><div><label>Used<input type="number" min="0" step="0.001" value={row.usedQuantity} onChange={e => change(row.reservationId, 'usedQuantity', e.target.value)} /></label><label>Wasted<input type="number" min="0" step="0.001" value={row.wastedQuantity} onChange={e => change(row.reservationId, 'wastedQuantity', e.target.value)} /></label><label>Unused<input type="number" min="0" step="0.001" value={row.unusedQuantity} onChange={e => change(row.reservationId, 'unusedQuantity', e.target.value)} /></label></div><label>Waste reason (required when waste is above zero)<input maxLength="500" value={row.wasteReason} onChange={e => change(row.reservationId, 'wasteReason', e.target.value)} /></label><label>Usage notes (optional)<input maxLength="500" value={row.notes} onChange={e => change(row.reservationId, 'notes', e.target.value)} /></label></div>)}
    {job.materialUsageSubmittedAt && <p className="bm-job-details__active">Usage submitted for Admin review.</p>}
    {exceptionActive && <p className="bm-exceptions__active">Material usage updates are blocked until the production exception is resolved.</p>}
    {job.status === 'In Progress' && job.materialOperationState === 'RESERVED' && <Btn disabled={busy || exceptionActive || (job.materialUsageReviewRequired && !reviewPreviousUsage)} loading={busy} onClick={save}>Save Usage for Admin Review</Btn>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

function AdditionalMaterialsEditor({ job, user, onSaved }) {
  const [inventory, setInventory] = useState([]), [inventoryId, setInventoryId] = useState(''), [quantity, setQuantity] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [requestId, setRequestId] = useState(() => globalThis.crypto?.randomUUID?.() || '');
  useEffect(() => { orderApi('/api/inventory', {}, user).then(data => setInventory(data.inventory || [])).catch(e => setError(e.message)); }, [job.jobOrderId, user]);
  const add = async () => {
    setBusy(true); setError('');
    try {
      if (!requestId) throw new Error('This browser cannot create a safe material request ID.');
      await orderApi(`/api/job-orders/${encodeURIComponent(job.jobOrderId)}/materials`, { method: 'POST', body: JSON.stringify({ requestId, materials: [{ inventoryId, quantity: Number(quantity) }] }) }, user);
      setInventoryId(''); setQuantity(''); setRequestId(globalThis.crypto?.randomUUID?.() || ''); onSaved?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <div className="bm-additional-materials"><h4>Reserve additional material</h4><select aria-label="Additional material" value={inventoryId} onChange={e => setInventoryId(e.target.value)}><option value="">Choose material</option>{inventory.filter(item => !(job.reservedMaterials || []).some(row => String(row.inventoryId) === item._id)).map(item => <option key={item._id} value={item._id}>{item.material} · {item.availableQuantity} {item.unit} available</option>)}</select><input aria-label="Additional material quantity" type="number" min="0.001" step="0.001" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="Quantity"/><Btn disabled={busy || !inventoryId || !quantity} loading={busy} onClick={add}>Reserve additional material</Btn>{error && <p role="alert">{error}</p>}</div>;
}
