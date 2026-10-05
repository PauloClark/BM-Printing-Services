import { useEffect, useState } from 'react';
import { orderApi } from '../../utils/orderApi';
import './JobOrders.css';
const categories = ['Paper', 'Ink', 'Tarpaulin', 'Vinyl', 'T-shirts', 'Sticker material', 'Card stock', 'Packaging', 'Other'];
const empty = { material: '', type: 'Other', unit: 'pcs', quantity: 0, minimumStockLevel: 10 };
export function InventoryMaterials({ user }) {
  const [items, setItems] = useState([]), [form, setForm] = useState(empty), [editing, setEditing] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [restock, setRestock] = useState({});
  const load = async () => { try { const data = await orderApi('/api/inventory', {}, user); setItems(data.inventory); setError(''); } catch(e) { setError(e.message); } };
  useEffect(() => { load(); }, [user]);
  const save = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const { quantity, ...metadata } = form;
      // A reserved unit/category cannot be redefined; backend enforces this too.
      const changes = editing ? Object.fromEntries(Object.entries(metadata).filter(([key,value]) => value !== editing[key])) : form;
      await orderApi(editing ? `/api/inventory/${editing._id}` : '/api/inventory', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(changes) }, user);
      setEditing(null); setForm(empty); await load();
    } catch(e) { setError(e.message); } finally { setBusy(false); }
  };
  const addStock = async item => {
    setBusy(true); setError('');
    try { await orderApi('/api/inventory/stock-in', { method: 'POST', body: JSON.stringify({ inventoryId: item._id, quantity: Number(restock[item._id]) }) }, user); setRestock(v => ({ ...v, [item._id]: '' })); await load(); }
    catch(e) { setError(e.message); } finally { setBusy(false); }
  };
  return <section className="bm-jobs"><div className="bm-jobs-toolbar"><h2>Inventory / Materials</h2><button onClick={load}>Refresh inventory</button></div>
    {error && <p role="alert">{error}</p>}
    <form onSubmit={save} className="bm-jobs-form">
      <h3>{editing ? 'Edit material' : 'Add material'}</h3>
      <label>Material name<input required value={form.material} onChange={e => setForm({ ...form, material: e.target.value })} /></label>
      <label>Category<select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
      <label>Unit<input required value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} /></label>
      {!editing && <label>On-hand quantity<input type="number" min="0" step="0.001" required value={form.quantity} onChange={e => setForm({ ...form, quantity: Number(e.target.value) })} /></label>}
      <label>Low-stock level<input type="number" min="0" step="0.001" required value={form.minimumStockLevel} onChange={e => setForm({ ...form, minimumStockLevel: Number(e.target.value) })} /></label>
      <button disabled={busy} type="submit" className="bm-jobs-primary">{editing ? 'Save material' : 'Add material'}</button>
      {editing && <button type="button" onClick={() => { setEditing(null); setForm(empty); }}>Cancel edit</button>}
    </form>
    <div className="bm-jobs-table"><table><thead><tr>{['Material', 'Category', 'On hand', 'Reserved', 'Available', 'Unit', 'Stock level', 'Actions'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>
      {items.map(item => <tr key={item._id}><td>{item.material}</td><td>{item.type}</td><td style={{ fontWeight: 600 }}>{item.quantity}</td><td style={{ color: item.reservedQuantity > 0 ? '#6a1b9a' : undefined, fontWeight: item.reservedQuantity > 0 ? 600 : undefined }}>{item.reservedQuantity}</td><td style={{ fontWeight: 600, color: item.availableQuantity <= 0 ? '#c62828' : undefined }}>{item.availableQuantity}</td><td>{item.unit}</td><td>{item.availableQuantity <= item.minimumStockLevel ? 'Low stock' : 'Available'}</td><td><button disabled={busy} onClick={() => { setEditing(item); setForm({ ...item, unit: item.unit || 'pcs' }); }}>Edit</button><input className="bm-jobs-restock" aria-label={`Restock ${item.material}`} type="number" min="0.001" step="0.001" placeholder="Quantity" value={restock[item._id] || ''} onChange={e => setRestock({ ...restock, [item._id]: e.target.value })} /><button disabled={busy} onClick={() => addStock(item)}>Restock</button></td></tr>)}
      {!items.length && <tr><td colSpan={8}>No inventory materials. Add the materials your shop actually uses.</td></tr>}
    </tbody></table></div>
  </section>;
}
