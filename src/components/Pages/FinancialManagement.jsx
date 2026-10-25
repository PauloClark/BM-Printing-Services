import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiUrl, orderApi } from '../../utils/orderApi';
import { store } from '../../utils/storage';
import './FinancialManagement.css';

const tabs = ['Overview', 'Order history', 'Expenses', 'Inventory purchases', 'Material costs'];
const expenseCategories = ['Utilities', 'Rent', 'Payroll', 'Delivery', 'Maintenance', 'Supplies', 'Marketing', 'Other'];
const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const php = value => `PHP ${(Number(value || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateText = value => value ? new Date(value).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const queryString = values => new URLSearchParams(values).toString();
const blankExpense = date => ({ expenseDate: date, paidAt: date, category: 'Other', description: '', amount: '', paymentStatus: 'Paid', paymentMethod: '', reference: '', reason: '' });

async function downloadExport(dataset, range) {
  const session = await store.get('session');
  let token = session?.token || '';
  if (!token) {
    const { supabase } = await import('../../utils/supabaseClient');
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token || '';
  }
  const response = await fetch(apiUrl(`/api/admin/financial/export/${dataset}?${queryString(range)}`), { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Unable to download the selected financial export.');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `bm-printing-${dataset}-${range.from}-${range.to}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function FinancialManagement({ user }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [range, setRange] = useState({ from: `${today.slice(0, 8)}01`, to: today });
  const [tab, setTab] = useState('Overview');
  const [period, setPeriod] = useState('daily');
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [movements, setMovements] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [historyFilters, setHistoryFilters] = useState({ q: '', status: '', paymentStatus: '', source: '' });
  const [expenseForm, setExpenseForm] = useState(blankExpense(today));
  const [editingExpenseId, setEditingExpenseId] = useState('');
  const [voidReasons, setVoidReasons] = useState({});
  const [costInputs, setCostInputs] = useState({});
  const [costReasons, setCostReasons] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (selectedRange = range, filters = historyFilters) => {
    setBusy(true);
    setError('');
    try {
      const query = queryString(selectedRange);
      const filteredHistory = queryString({ ...selectedRange, ...filters });
      const [summaryData, historyData, expenseData, purchaseData, movementData, inventoryData] = await Promise.all([
        orderApi(`/api/admin/financial/summary?${query}`, {}, user),
        orderApi(`/api/admin/financial/history?${filteredHistory}`, {}, user),
        orderApi(`/api/admin/financial/expenses?${query}`, {}, user),
        orderApi(`/api/admin/financial/purchases?${query}`, {}, user),
        orderApi(`/api/admin/financial/material-costs?${query}`, {}, user),
        orderApi('/api/inventory', {}, user)
      ]);
      setSummary(summaryData);
      setHistory(historyData.orders || []);
      setExpenses(expenseData.expenses || []);
      setPurchases(purchaseData.purchases || []);
      setMovements(movementData.movements || []);
      setInventory(inventoryData.inventory || []);
    } catch (loadError) {
      setError(loadError.message || 'Unable to load financial records.');
    } finally {
      setBusy(false);
    }
  }, [range, historyFilters, user]);

  useEffect(() => { load(); }, []);

  const selectedPeriods = summary?.periods?.[period] || [];
  const chartMax = useMemo(() => Math.max(1, ...selectedPeriods.flatMap(row => [row.bookedOrderValueCents, row.revenueCents, row.paymentsReceivedCents, row.refundsPaidCents, row.creditsIssuedCents, row.directCostsCents, row.expensesCents])), [selectedPeriods]);
  const totals = summary?.totals || {};
  const updateExpense = async event => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const body = {
        ...expenseForm,
        amount: Number(expenseForm.amount),
        paidAmount: expenseForm.paymentStatus === 'Paid' ? Number(expenseForm.amount) : 0
      };
      const editing = Boolean(editingExpenseId);
      await orderApi(editing ? `/api/admin/financial/expenses/${editingExpenseId}` : '/api/admin/financial/expenses', {
        method: editing ? 'PATCH' : 'POST', body: JSON.stringify(body)
      }, user);
      setEditingExpenseId('');
      setExpenseForm(blankExpense(range.to));
      setNotice(editing ? 'Expense correction recorded in the audit history.' : 'Expense recorded.');
      await load();
    } catch (saveError) {
      setError(saveError.message || 'Unable to save the expense.');
    } finally { setBusy(false); }
  };
  const startEdit = expense => {
    setEditingExpenseId(expense.id);
    setExpenseForm({
      expenseDate: localDate(new Date(expense.expenseDate)), paidAt: expense.paidAt ? localDate(new Date(expense.paidAt)) : '',
      category: expense.category, description: expense.description, amount: (expense.amountCents / 100).toFixed(2),
      paymentStatus: expense.paymentStatus, paymentMethod: expense.paymentMethod || '', reference: expense.reference || '', reason: ''
    });
    setTab('Expenses');
  };
  const voidExpense = async expense => {
    const reason = voidReasons[expense.id] || '';
    if (reason.trim().length < 5) { setError('Enter at least five characters explaining why this expense should be voided.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await orderApi(`/api/admin/financial/expenses/${expense.id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }, user);
      setNotice('Expense voided and retained in the audit history.');
      await load();
    } catch (voidError) { setError(voidError.message || 'Unable to void expense.'); }
    finally { setBusy(false); }
  };
  const setInventoryCost = async item => {
    const input = costInputs[item._id] || {};
    const reason = costReasons[item._id] || '';
    if (reason.trim().length < 5) { setError('A cost-basis reason of at least five characters is required.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await orderApi(`/api/inventory/${item._id}/cost-basis`, {
        method: 'PATCH', body: JSON.stringify({ unitCost: Number(input.unitCost), reason })
      }, user);
      setNotice(`Cost basis updated for ${item.material}; no purchase or cash payment was created.`);
      await load();
    } catch (costError) { setError(costError.message || 'Unable to update material cost basis.'); }
    finally { setBusy(false); }
  };
  const correctMaterialCost = async row => {
    const input = costInputs[row._id] || {};
    const reason = costReasons[row._id] || '';
    if (input.unitCost === '' || input.unitCost == null || reason.trim().length < 5) { setError('Enter the corrected unit cost and a reason of at least five characters.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await orderApi(`/api/admin/financial/material-cost/${encodeURIComponent(row.jobOrderId)}`, {
        method: 'PATCH', body: JSON.stringify({ inventoryId: row.inventoryId, unitCost: Number(input.unitCost), reason })
      }, user);
      setNotice('Material cost corrected with a financial audit record.');
      await load();
    } catch (costError) { setError(costError.message || 'Unable to correct the material cost.'); }
    finally { setBusy(false); }
  };
  const exportFile = async dataset => {
    setError('');
    try { await downloadExport(dataset, range); }
    catch (downloadError) { setError(downloadError.message); }
  };

  return <section className="bm-financial">
    <header className="bm-financial__heading">
      <div><h2>Financial Management</h2><p>Recorded cash, fulfilled sales, inventory costs and operating expenses. Currency: PHP.</p></div>
      <button type="button" disabled={busy} onClick={() => load()}>Refresh records</button>
    </header>
    <div className="bm-financial__filters">
      <label>From<input type="date" value={range.from} onChange={event => setRange(value => ({ ...value, from: event.target.value }))} /></label>
      <label>To<input type="date" value={range.to} onChange={event => setRange(value => ({ ...value, to: event.target.value }))} /></label>
      <button type="button" disabled={busy || !range.from || !range.to || range.from > range.to} onClick={() => load()}>Apply date range</button>
    </div>
    {error && <p className="bm-financial__alert" role="alert">{error}</p>}
    {notice && <p className="bm-financial__notice" role="status">{notice}</p>}
    {summary?.completeness?.notes?.length > 0 && <aside className="bm-financial__caveat">
      <strong>{summary.completeness.isComplete ? 'Accounting basis' : 'Historical data incomplete'}</strong>
      <ul>{summary.completeness.notes.map(note => <li key={note}>{note}</li>)}</ul>
      {!summary.refundsSupported && <p>Refunds: unsupported in current records; no refund amount is assumed.</p>}
    </aside>}
    <nav className="bm-financial__tabs" aria-label="Financial management sections">
      {tabs.map(name => <button type="button" key={name} className={tab === name ? 'is-active' : ''} onClick={() => setTab(name)}>{name}</button>)}
    </nav>

    {tab === 'Overview' && <>
      <div className="bm-financial__cards">
        {[
          ['Booked order value', totals.bookedOrderValueCents],
          ['Verified payments received', totals.verifiedPaymentsReceivedCents],
          ['Fulfilled sales revenue', totals.fulfilledSalesRevenueCents],
          ['Refunds actually paid', totals.refundsPaidCents],
          ['Outstanding refund liabilities', totals.outstandingRefundLiabilityCents],
          ['Customer credits issued', totals.customerCreditsIssuedCents],
          ['Direct material costs', totals.directMaterialCostsCents],
          ['Wastage cost (included above)', totals.wastageCostCents],
          ['Gross profit', totals.grossProfitCents],
          ['Inventory valuation', totals.inventoryValuationCents],
          ['Operating expenses', totals.operatingExpensesCents],
          ['Estimated net profit', totals.estimatedNetProfitCents],
          ['Net cash movement', totals.netCashMovementCents],
          ['Inventory purchases', totals.inventoryPurchasesCents],
          ['Outstanding customer balances', totals.outstandingBalanceCents]
        ].map(([label, value]) => <article className="bm-financial__metric" key={label}><span>{label}</span><strong>{php(value)}</strong></article>)}
      </div>
      <div className="bm-financial__section"><h3>Fulfilled job profitability</h3><div className="bm-financial__table-wrap"><table><thead><tr>{['Order', 'Job', 'Product', 'Fulfilled revenue', 'Material cost', 'Gross profit', 'Cost status'].map(name => <th key={name}>{name}</th>)}</tr></thead><tbody>
        {(summary?.jobProfitability || []).map(row => <tr key={row.orderId}><td>{row.orderId}</td><td>{row.jobOrderId || 'No production job'}</td><td>{row.product}</td><td>{php(row.fulfilledRevenueCents)}</td><td>{php(row.directMaterialCostsCents)}</td><td>{php(row.grossProfitCents)}</td><td>{row.costDataComplete ? 'Complete' : 'Incomplete'}</td></tr>)}
        {!summary?.jobProfitability?.length && <tr><td colSpan="7">No fulfilled jobs in this date range.</td></tr>}
      </tbody></table></div><p className="bm-financial__muted">Wastage cost is a subset of direct material cost and is not deducted twice.</p></div>
      <div className="bm-financial__chart">
        <div className="bm-financial__chart-head"><h3>Financial trends</h3><select aria-label="Chart period" value={period} onChange={event => setPeriod(event.target.value)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>
        <div className="bm-financial__legend"><span>Booked order value</span><span>Fulfilled revenue</span><span>Payments received</span><span>Refunds paid</span><span>Credits issued</span><span>Direct materials</span><span>Operating expenses</span></div>
        <div className="bm-financial__bars">{selectedPeriods.map(row => <div className="bm-financial__bar-row" key={row.period}>
          <b>{row.period}</b><div className="bm-financial__bar-set">
            {[[row.bookedOrderValueCents, 'booked'], [row.revenueCents, 'revenue'], [row.paymentsReceivedCents, 'payments'], [row.refundsPaidCents, 'refunds'], [row.creditsIssuedCents, 'credits'], [row.directCostsCents, 'materials'], [row.expensesCents, 'expenses']].map(([value, kind]) => <div key={kind} className={`bm-financial__bar bm-financial__bar--${kind}`} style={{ width: `${Math.max(value ? 1 : 0, (value / chartMax) * 100)}%` }} title={`${kind}: ${php(value)}`} />)}
          </div><span>{php(row.revenueCents)}</span>
        </div>)}
        {!selectedPeriods.length && <p>No financial events in this date range.</p>}</div>
      </div>
      <div className="bm-financial__chart">
        <h3>Operating expenses by category</h3>
        <div className="bm-financial__categories">{(summary?.expenseByCategory || []).map(row => {
          const maximum = Math.max(1, ...(summary?.expenseByCategory || []).map(item => item.amountCents));
          return <div className="bm-financial__category" key={row.category}><span>{row.category}</span><div><i style={{ width: `${Math.max(2, row.amountCents / maximum * 100)}%` }} /></div><strong>{php(row.amountCents)}</strong></div>;
        })}{!summary?.expenseByCategory?.length && <p>No operating expenses recorded in this date range.</p>}</div>
      </div>
      <div className="bm-financial__export"><strong>Export records</strong>{[['orders', 'Order history'], ['expenses', 'Expenses'], ['purchases', 'Inventory purchases'], ['materials', 'Material costs']].map(([key, label]) => <button key={key} type="button" onClick={() => exportFile(key)}>{label} CSV</button>)}</div>
      <p className="bm-financial__muted">As of the selected range: {summary?.counts?.outstandingOrders || 0} orders have a balance, totaling {php(totals.outstandingBalanceCents)}.</p>
    </>}

    {tab === 'Order history' && <div className="bm-financial__section">
      <div className="bm-financial__filters bm-financial__filters--history">
        <label>Search orders/customer/product<input value={historyFilters.q} onChange={event => setHistoryFilters(v => ({ ...v, q: event.target.value }))} /></label>
        <label>Order status<select value={historyFilters.status} onChange={event => setHistoryFilters(v => ({ ...v, status: event.target.value }))}><option value="">All</option>{['Pending', 'Quoted', 'Confirmed', 'Payment Pending', 'Paid', 'Queued', 'In Production', 'Quality Check', 'Ready', 'Processing', 'Ready for Pickup', 'Picked Up', 'Completed', 'Cancelled'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Payment status<select value={historyFilters.paymentStatus} onChange={event => setHistoryFilters(v => ({ ...v, paymentStatus: event.target.value }))}><option value="">All</option>{['Unpaid', 'pending', 'For Verification', 'Verified', 'Rejected', 'Unknown'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Source<select value={historyFilters.source} onChange={event => setHistoryFilters(v => ({ ...v, source: event.target.value }))}><option value="">All</option><option value="online">Online</option><option value="walk_in">Walk-in</option></select></label>
        <button type="button" disabled={busy} onClick={() => load()}>Search</button>
      </div>
      <div className="bm-financial__table-wrap"><table><thead><tr>{['Order', 'Customer', 'Products', 'Order date', 'Fulfilled', 'Source', 'Order status', 'Payment status', 'Method', 'Order total', 'Verified paid', 'Balance'].map(name => <th key={name}>{name}</th>)}</tr></thead><tbody>
        {history.map(row => <tr key={row.orderId}><td>{row.orderId}</td><td>{row.customerName}</td><td>{row.products || '—'}</td><td>{dateText(row.orderDate)}</td><td>{dateText(row.fulfilledAt)}</td><td>{row.source}</td><td>{row.orderStatus}{row.archived ? ' (archived)' : ''}</td><td>{row.paymentStatus}</td><td>{row.paymentMethod || '—'}</td><td>{php(row.orderTotalCents)}</td><td>{php(row.verifiedPaidCents)}</td><td>{php(row.balanceCents)}</td></tr>)}
        {!history.length && <tr><td colSpan="12">{busy ? 'Loading…' : 'No matching orders in this date range.'}</td></tr>}
      </tbody></table></div>
      <p className="bm-financial__muted">Showing up to 500 records. Export to CSV for the complete date-range set (up to 10,000 rows).</p>
    </div>}

    {tab === 'Expenses' && <div className="bm-financial__section">
      <form className="bm-financial__form" onSubmit={updateExpense}>
        <h3>{editingExpenseId ? 'Correct expense' : 'Record operating expense'}</h3>
        <label>Date incurred<input type="date" required value={expenseForm.expenseDate} onChange={event => setExpenseForm(v => ({ ...v, expenseDate: event.target.value }))} /></label>
        <label>Category<select value={expenseForm.category} onChange={event => setExpenseForm(v => ({ ...v, category: event.target.value }))}>{expenseCategories.map(category => <option key={category}>{category}</option>)}</select></label>
        <label>Description<input required maxLength="500" value={expenseForm.description} onChange={event => setExpenseForm(v => ({ ...v, description: event.target.value }))} /></label>
        <label>Amount (PHP)<input type="number" min="0.01" step="0.01" required value={expenseForm.amount} onChange={event => setExpenseForm(v => ({ ...v, amount: event.target.value }))} /></label>
        <label>Payment status<select value={expenseForm.paymentStatus} onChange={event => setExpenseForm(v => ({ ...v, paymentStatus: event.target.value, paidAt: event.target.value === 'Paid' ? v.expenseDate : '' }))}><option>Paid</option><option>Unpaid</option></select></label>
        {expenseForm.paymentStatus === 'Paid' && <label>Paid date<input type="date" required value={expenseForm.paidAt} onChange={event => setExpenseForm(v => ({ ...v, paidAt: event.target.value }))} /></label>}
        <label>Payment method<input maxLength="50" value={expenseForm.paymentMethod} onChange={event => setExpenseForm(v => ({ ...v, paymentMethod: event.target.value }))} placeholder="Cash, bank, etc." /></label>
        <label>Reference<input maxLength="100" value={expenseForm.reference} onChange={event => setExpenseForm(v => ({ ...v, reference: event.target.value }))} /></label>
        {editingExpenseId && <label>Correction reason (required)<input required minLength="5" value={expenseForm.reason} onChange={event => setExpenseForm(v => ({ ...v, reason: event.target.value }))} /></label>}
        <div className="bm-financial__form-actions"><button disabled={busy} type="submit">{editingExpenseId ? 'Save correction' : 'Record expense'}</button>{editingExpenseId && <button type="button" onClick={() => { setEditingExpenseId(''); setExpenseForm(blankExpense(range.to)); }}>Cancel correction</button>}</div>
      </form>
      <div className="bm-financial__table-wrap"><table><thead><tr>{['Date', 'Category', 'Description', 'Amount', 'Paid', 'Paid date', 'Method / reference', 'Status', 'Actions'].map(name => <th key={name}>{name}</th>)}</tr></thead><tbody>
        {expenses.map(expense => <tr key={expense.id}><td>{dateText(expense.expenseDate)}</td><td>{expense.category}</td><td>{expense.description}</td><td>{php(expense.amountCents)}</td><td>{php(expense.paidAmountCents)}</td><td>{dateText(expense.paidAt)}</td><td>{[expense.paymentMethod, expense.reference].filter(Boolean).join(' / ') || '—'}</td><td>{expense.status} / {expense.paymentStatus}</td><td>{expense.status === 'Active' && <><button type="button" disabled={busy} onClick={() => startEdit(expense)}>Correct</button><input aria-label={`Void reason for ${expense.description}`} placeholder="Void reason" value={voidReasons[expense.id] || ''} onChange={event => setVoidReasons(v => ({ ...v, [expense.id]: event.target.value }))} /><button type="button" disabled={busy} onClick={() => voidExpense(expense)}>Void</button></>}</td></tr>)}
        {!expenses.length && <tr><td colSpan="9">No expenses recorded in this date range.</td></tr>}
      </tbody></table></div>
    </div>}

    {tab === 'Inventory purchases' && <div className="bm-financial__section">
      <h3>Inventory purchase history</h3>
      <p className="bm-financial__muted">Record new purchases from Inventory / Materials using actual invoice costs and amounts actually paid. Opening cost basis changes do not create purchase or cash-flow records.</p>
      <div className="bm-financial__table-wrap"><table><thead><tr>{['Purchase date', 'Material', 'Quantity', 'Total cost', 'Paid', 'Paid date', 'Supplier', 'Reference', 'Recorded by'].map(name => <th key={name}>{name}</th>)}</tr></thead><tbody>
        {purchases.map(row => <tr key={row.purchaseId}><td>{dateText(row.purchasedAt)}</td><td>{row.material}</td><td>{row.quantity} {row.unit}</td><td>{php(row.totalCostCents)}</td><td>{php(row.paidAmountCents)}</td><td>{dateText(row.paidAt)}</td><td>{row.supplier || '—'}</td><td>{row.reference || '—'}</td><td>{row.recordedByName || row.recordedBy}</td></tr>)}
        {!purchases.length && <tr><td colSpan="9">No inventory purchases recorded in this date range.</td></tr>}
      </tbody></table></div>
      <h3>Current inventory valuation basis</h3>
      <div className="bm-financial__table-wrap"><table><thead><tr>{['Material', 'On hand', 'Current unit cost', 'Basis', 'Set/adjust basis'].map(name => <th key={name}>{name}</th>)}</tr></thead><tbody>
        {inventory.map(item => <tr key={item._id}><td>{item.material}</td><td>{item.quantity} {item.unit}</td><td>{item.costBasisKnown ? `PHP ${Number(item.costPerUnit).toFixed(6)}` : 'Unknown'}</td><td>{item.costBasisKnown ? 'Recorded' : 'Incomplete'}</td><td><input type="number" min="0" step="0.000001" aria-label={`Unit cost for ${item.material}`} value={costInputs[item._id]?.unitCost ?? ''} onChange={event => setCostInputs(v => ({ ...v, [item._id]: { ...v[item._id], unitCost: event.target.value } }))} /><input aria-label={`Cost basis reason for ${item.material}`} placeholder="Reason / source" value={costReasons[item._id] || ''} onChange={event => setCostReasons(v => ({ ...v, [item._id]: event.target.value }))} /><button type="button" disabled={busy || costInputs[item._id]?.unitCost === '' || costInputs[item._id]?.unitCost == null} onClick={() => setInventoryCost(item)}>Save cost basis</button></td></tr>)}
        {!inventory.length && <tr><td colSpan="5">No inventory materials.</td></tr>}
      </tbody></table></div>
    </div>}

    {tab === 'Material costs' && <div className="bm-financial__section">
      <h3>Material use and wastage cost history</h3>
      <p className="bm-financial__muted">Costs are snapshotted when Admin approves production. Waste is shown separately but is already included in the job’s total direct material cost. Cost corrections preserve an audit record and require replica-set transactions.</p>
      <div className="bm-financial__table-wrap"><table><thead><tr>{['Date', 'Order', 'Job', 'Material', 'Event', 'Quantity', 'Unit cost', 'Direct cost', 'Cost status', 'Correction'].map(name => <th key={name}>{name}</th>)}</tr></thead><tbody>
        {movements.map(row => <tr key={row._id}><td>{dateText(row.createdAt)}</td><td>{row.orderId}</td><td>{row.jobOrderId}</td><td>{row.material}</td><td>{row.movementType === 'WASTE' ? 'Waste' : 'Consumed'}</td><td>{row.quantity} {row.unit}</td><td>{row.costDataComplete ? `PHP ${Number(row.unitCostSnapshot).toFixed(6)}` : 'Unknown'}</td><td>{row.costDataComplete ? php(row.directCostCents) : 'Incomplete'}</td><td>{row.costDataComplete ? 'Recorded' : 'Unknown historical cost'}</td><td>{row.movementType === 'OUT' ? <><input type="number" min="0" step="0.000001" aria-label={`Correct unit cost for ${row.material}`} value={costInputs[row._id]?.unitCost ?? ''} onChange={event => setCostInputs(v => ({ ...v, [row._id]: { unitCost: event.target.value } }))} /><input aria-label={`Correction reason for ${row.material}`} placeholder="Reason / source" value={costReasons[row._id] || ''} onChange={event => setCostReasons(v => ({ ...v, [row._id]: { reason: event.target.value } }))} /><button type="button" disabled={busy || !row.jobOrderId || !row.inventoryId} onClick={() => correctMaterialCost(row)}>Correct cost</button></> : 'Use consumed material correction'}</td></tr>)}
        {!movements.length && <tr><td colSpan="9">No material consumption records in this date range.</td></tr>}
      </tbody></table></div>
    </div>}
  </section>;
}
