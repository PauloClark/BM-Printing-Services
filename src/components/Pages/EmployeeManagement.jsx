import React, { useCallback, useEffect, useState } from 'react';
import { orderApi } from '../../utils/orderApi';
import { store } from '../../utils/storage';

const emptyForm = { name: '', email: '', phone: '', position: 'Production Staff', supabaseUserId: '', active: true, mustChangePassword: false, permissions: ['view_assigned_jobs', 'update_job_progress'] };
const callApi = async (url, options = {}) => orderApi(url, options, await store.get('session'));

export function EmployeeManagement({ showToast }) {
  const [employees, setEmployees] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [accountsError, setAccountsError] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await callApi('/api/employees');
      setEmployees(data.employees || []);
    } catch (error) { showToast(error.message || 'Unable to load employees.', 'error'); }
    try {
      const data = await callApi('/api/employees/auth-accounts');
      setAccounts(data.accounts || []); setAccountsError('');
    } catch (error) { setAccountsError(error.message || 'Staff authentication directory is unavailable.'); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const openForm = employee => {
    setEditing(employee || { id: null });
    setForm(employee ? { name: employee.name, email: employee.email, phone: employee.phone || '', position: employee.position || 'Production Staff', supabaseUserId: employee.supabaseUserId || '', active: employee.active, mustChangePassword: Boolean(employee.mustChangePassword), permissions: employee.permissions || [] } : emptyForm);
  };
  const save = async event => {
    event.preventDefault(); setSaving(true);
    try {
      await callApi(editing.id ? `/api/employees/${editing.id}` : '/api/employees', { method: editing.id ? 'PATCH' : 'POST', body: JSON.stringify(form) });
      showToast(editing.id ? 'Employee updated.' : 'Employee added.', 'success'); setEditing(null); await load();
    } catch (error) { showToast(error.message || 'Unable to save employee.', 'error'); }
    finally { setSaving(false); }
  };
  const deactivate = async employee => {
    if (!window.confirm(`Deactivate ${employee.name}? They will no longer be eligible for new job assignments.`)) return;
    try { await callApi(`/api/employees/${employee.id}`, { method: 'PATCH', body: JSON.stringify({ active: false }) }); showToast('Employee deactivated.', 'success'); await load(); }
    catch (error) { showToast(error.message || 'Unable to deactivate employee.', 'error'); }
  };
  const togglePermission = permission => setForm(current => ({ ...current, permissions: current.permissions.includes(permission) ? current.permissions.filter(item => item !== permission) : [...current.permissions, permission] }));
  const selectableAccounts = accounts.filter(account => !account.linkedEmployee || account.id === form.supabaseUserId);

  return <section className="bm-employees">
    <div className="bm-employees-toolbar"><div><h3>Staff / Employees</h3><p>Manage employee records and link them to verified staff authentication accounts.</p></div><button className="bm-employee-primary" onClick={() => openForm(null)}>Add Employee</button></div>
    {accountsError && <div className="bm-employee-notice" role="status">{accountsError} Employee records remain available, but account linking requires the backend Supabase service role configuration.</div>}
    <div className="bm-employee-summary"><div><strong>{employees.length}</strong><span>Total employees</span></div><div><strong>{employees.filter(item => item.active).length}</strong><span>Active</span></div><div><strong>{employees.filter(item => item.linked).length}</strong><span>Accounts linked</span></div><div><strong>{employees.filter(item => item.active && item.linked).length}</strong><span>Assignable</span></div></div>
    <div className="bm-employee-table-wrap"><table><thead><tr><th>Employee</th><th>Position</th><th>Account</th><th>Access</th><th>Jobs</th><th>Status</th><th></th></tr></thead><tbody>
      {employees.map(employee => <tr key={employee.id}><td><strong>{employee.name}</strong><small>{employee.email}{employee.phone ? ` · ${employee.phone}` : ''}</small></td><td>{employee.position}</td><td><span className={`bm-link-state ${employee.linked ? 'is-linked' : ''}`}>{employee.linked ? 'Linked' : 'Not linked'}</span>{employee.mustChangePassword && <small>Password change required</small>}</td><td>{employee.permissions.length === 2 ? 'Assigned jobs + updates' : employee.permissions.length ? 'Limited' : 'No job access'}</td><td>{employee.assignedJobs}</td><td><span className={`bm-employee-status ${employee.active ? 'is-active' : ''}`}>{employee.active ? 'Active' : 'Inactive'}</span></td><td><div className="bm-employee-actions"><button onClick={() => openForm(employee)}>Edit</button>{employee.active && <button onClick={() => deactivate(employee)}>Deactivate</button>}</div></td></tr>)}
      {!loading && employees.length === 0 && <tr><td colSpan="7" className="bm-employee-empty">No employee records yet. Add an employee, then link an existing staff account.</td></tr>}
      {loading && <tr><td colSpan="7" className="bm-employee-empty">Loading employees…</td></tr>}
    </tbody></table></div>
    {editing && <div className="bm-employee-modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && !saving && setEditing(null)}><div className="bm-employee-modal" role="dialog" aria-modal="true" aria-labelledby="employee-dialog-title"><div className="bm-employee-modal-head"><div><span>{editing.id ? 'Employee profile' : 'New employee'}</span><h4 id="employee-dialog-title">{editing.id ? 'Edit employee' : 'Add employee'}</h4></div><button type="button" aria-label="Close" disabled={saving} onClick={() => setEditing(null)}><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><form onSubmit={save}>
      <div className="bm-employee-fields"><label>Full name<input required maxLength="120" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })}/></label><label>Email address<input required type="email" maxLength="254" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })}/></label><label>Phone<input maxLength="30" value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })}/></label><label>Position<input maxLength="100" value={form.position} onChange={event => setForm({ ...form, position: event.target.value })}/></label></div>
      <label className="bm-employee-account">Staff authentication account<select value={form.supabaseUserId} onChange={event => setForm({ ...form, supabaseUserId: event.target.value })}><option value="">Not linked</option>{selectableAccounts.map(account => <option value={account.id} key={account.id}>{account.name} — {account.email}</option>)}</select><small>This only links an existing confirmed Supabase staff account. It never creates credentials.</small></label>
      <fieldset><legend>Staff access</legend><label><input type="checkbox" checked={form.permissions.includes('view_assigned_jobs')} onChange={() => togglePermission('view_assigned_jobs')}/> View assigned jobs</label><label><input type="checkbox" checked={form.permissions.includes('update_job_progress')} onChange={() => togglePermission('update_job_progress')}/> Update job progress</label></fieldset>
      <div className="bm-employee-settings" aria-label="Employee settings">
        <label className="bm-employee-check"><input type="checkbox" disabled={!form.supabaseUserId} checked={form.mustChangePassword} onChange={event => setForm({ ...form, mustChangePassword: event.target.checked })}/><span>Require password change before staff operations</span></label>
        {editing.id && <label className="bm-employee-check"><input type="checkbox" checked={form.active} onChange={event => setForm({ ...form, active: event.target.checked })}/><span>Employee is active and eligible for assignment</span></label>}
      </div>
      <div className="bm-employee-modal-actions"><button type="button" disabled={saving} onClick={() => setEditing(null)}>Cancel</button><button className="bm-employee-primary" disabled={saving}>{saving ? 'Saving…' : 'Save employee'}</button></div>
    </form></div></div>}
  </section>;
}
