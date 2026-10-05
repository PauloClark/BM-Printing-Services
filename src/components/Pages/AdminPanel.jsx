import { JobOrders } from './JobOrders';
import { ArchivedOrders, CompletedOrdersReport } from './AdminOrderArchive';
import { InventoryMaterials } from './InventoryMaterials';
import { ORDER_STATUSES, displayOrderStatus } from '../../../shared/orderWorkflow';
import { orderApi } from '../../utils/orderApi';
import { store } from '../../utils/storage';
import { StaffOrders } from './StaffOrders';
import { AdminPayments } from './AdminPayments';
import React, { useState, useEffect, useCallback } from 'react';
import { C } from '../../constants/colors';
import { showToast } from '../../utils/notifications';
import { Card } from '../Common/Card';
import { Btn } from '../Common/Btn';
import { Input } from '../Common/Input';
import { Badge } from '../Common/Badge';

const STATUS_LIST = ORDER_STATUSES;
const ORDER_STATUS_COLORS = {
  Processing: { bg: '#e8f5ff', color: '#0277bd' },
  'Ready for Pickup': { bg: '#f3e5f5', color: '#6a1b9a' },
  'Picked Up': { bg: '#e6f5ec', color: '#1a7a3a' },
  Pending: { bg: '#fef3e2', color: '#b45309' },
  Quoted: { bg: '#e3f0fc', color: '#1565c0' },
  Confirmed: { bg: '#e3f0fc', color: '#1565c0' },
  'Payment Pending': { bg: '#fef3e2', color: '#b45309' },
  Paid: { bg: '#e6f5ec', color: '#1a7a3a' },
  Queued: { bg: '#f0f0f0', color: '#555' },
  'In Production': { bg: '#fef3e2', color: '#b45309' },
  'Quality Check': { bg: '#f3e5f5', color: '#7b1fa2' },
  Ready: { bg: '#e6f5ec', color: '#1a7a3a' },
  Completed: { bg: '#e6f5ec', color: '#1a7a3a' },
  Cancelled: { bg: '#fdecea', color: '#c62828' }
};

const fmt = (v) => `₱${Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '';

const getToken = async () => {
  const session = await store.get('session');
  if (session?.token) return session.token;
  const { supabase } = await import('../../utils/supabaseClient');
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || '';
};
const api = async (url, opts = {}) => orderApi(url, opts, await store.get('session'));

const SIDEBAR_ITEMS = [
  { id: 'dashboard', icon: '📊', label: 'Dashboard' },
  { id: 'orders', icon: '📋', label: 'Orders' },
  { id: 'pickup', icon: '📤', label: 'Ready for Pickup' },
  { id: 'payments', icon: '💳', label: 'Payments for Verification' },
  { id: 'products', icon: '📦', label: 'Products' },
  { id: 'jobs', icon: '??', label: 'Job Orders' },
  { id: 'archive', icon: '🗄️', label: 'Archived Orders' },
  { id: 'inventory', icon: '🏭', label: 'Inventory' },
  { id: 'production', icon: '⚙', label: 'Production' },
  { id: 'customers', icon: '👥', label: 'Customers' },
  { id: 'reports', icon: '📈', label: 'Reports' },
  { id: 'audit', icon: '📝', label: 'Audit Logs' },
  { id: 'system', icon: '🔧', label: 'System' },
];

const Sidebar = ({ tab, setTab, sidebarOpen }) => {
  return (
    <aside style={{
      width: sidebarOpen ? 220 : 0,
      minWidth: sidebarOpen ? 220 : 0,
      background: C.black,
      color: '#fff',
      overflowY: 'auto',
      overflowX: 'hidden',
      transition: 'width 0.2s, min-width 0.2s',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0
    }}>
      {sidebarOpen && (
        <div style={{ padding: '20px 16px 8px', borderBottom: '1px solid #333' }}>
          <div style={{ fontWeight: 800, fontSize: 15, fontFamily: 'Montserrat', color: C.red }}>BM ADMIN</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Printing Services</div>
        </div>
      )}
      {sidebarOpen && SIDEBAR_ITEMS.map(item => (
        <button
          key={item.id}
          onClick={() => setTab(item.id)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '11px 16px',
            background: tab === item.id ? C.red : 'transparent',
            color: tab === item.id ? '#fff' : '#aaa',
            border: 'none',
            width: '100%',
            textAlign: 'left',
            fontSize: 13,
            fontWeight: tab === item.id ? 700 : 500,
            fontFamily: 'Montserrat',
            cursor: 'pointer',
            borderRadius: '0 8px 8px 0',
            marginRight: 8
          }}
        >
          <span style={{ fontSize: 16, width: 22 }}>{item.icon}</span>
          {item.label}
        </button>
      ))}
    </aside>
  );
};

const StatCard = ({ label, value, color = C.info }) => (
  <Card style={{ padding: '14px 18px', textAlign: 'center', minWidth: 0 }}>
    <div style={{ fontSize: 26, fontWeight: 800, fontFamily: 'Montserrat', color }}>{value}</div>
    <div style={{ fontSize: 11, color: C.gray600, marginTop: 2 }}>{label}</div>
  </Card>
);

const StatusRow = ({ label, count, total, color }) => {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
      <span style={{ fontSize: 13, color: C.gray800, width: 120, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 8, background: C.gray100, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color: C.gray600, width: 30, textAlign: 'right' }}>{count}</span>
    </div>
  );
};

export default function AdminPanel({ user, showToast: notify }) {
  const [tab, setTab] = useState('orders');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [summary, setSummary] = useState(null);
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [productions, setProductions] = useState([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportSummary, setReportSummary] = useState(null);
  const [reportsExist, setReportsExist] = useState(false);
  const [reportDate, setReportDate] = useState(new Date());
  const [analytics, setAnalytics] = useState(null);
  const [systemHealth, setSystemHealth] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [editingProduct, setEditingProduct] = useState(null);
  const [newProduct, setNewProduct] = useState({ name: '', category: '', description: '', price: '', stock: '', lowStockThreshold: '', status: 'Active', image: '' });
  const [newProductImage, setNewProductImage] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pickupOrders, setPickupOrders] = useState([]);
  const [pickupLoading, setPickupLoading] = useState(false);
  const [pickupError, setPickupError] = useState('');
  const [pickupDetail, setPickupDetail] = useState(null);
  const [pickupDetailLoading, setPickupDetailLoading] = useState(false);
  const [pickupConfirming, setPickupConfirming] = useState(false);
  const [pickupReceivedBy, setPickupReceivedBy] = useState('');
  const [stockMovements, setStockMovements] = useState([]);
  const [movementsLoading, setMovementsLoading] = useState(false);

  const loadData = useCallback(async () => {
    const loaders = {
      dashboard: async () => {
        try { const d = await api('/api/dashboard/summary'); if (d.success) setSummary(d.data); } catch {}
        try { const d = await api('/api/admin/orders'); if (d.orders) setOrders(d.orders); } catch {}
        try { const d = await api('/api/products'); if (d.products) setProducts(d.products); } catch {}
      },
      orders: async () => {
        try { const d = await api('/api/admin/orders'); if (d.orders) setOrders(d.orders); } catch {}
      },
      pickup: async () => {
        setPickupLoading(true);
        try { const d = await api('/api/orders/ready-for-pickup'); if (d.orders) setPickupOrders(d.orders); setPickupError(''); }
        catch (e) { setPickupError(e.message); }
        finally { setPickupLoading(false); }
      },
      products: async () => {
        try { const d = await api('/api/products'); if (d.products) setProducts(d.products); } catch {}
      },
      inventory: async () => {
        try { const d = await api('/api/inventory'); if (d.inventory) setInventory(d.inventory); } catch {}
        try { const d = await api('/api/inventory/low-stock'); if (d.inventory) setLowStock(d.inventory); } catch {}
        try { const d = await api('/api/inventory/movements'); if (d.movements) setStockMovements(d.movements); } catch {}
      },
      production: async () => {
        try { const d = await api('/api/production'); if (d.productions) setProductions(d.productions); } catch {}
      },
      customers: async () => {
        try { const d = await api('/api/search/customers?query=' + encodeURIComponent(searchQuery)); if (d.customers) setCustomers(d.customers); } catch {}
      },
      reports: async () => {
        try { const d = await api('/api/bi/analytics'); if (d.success) setAnalytics(d.data); } catch {}
      },
      audit: async () => {
        try { const d = await api('/api/security/audit-logs'); if (d.success) setAuditLogs(d.data || []); } catch {}
      },
      system: async () => {
        try { const d = await api('/api/system/health'); if (d.success) setSystemHealth(d.data); } catch {}
      }
    };
    if (tab !== 'orders' && user?.role === 'admin' && loaders[tab]) await loaders[tab]();
  }, [tab, searchQuery, user]);

  useEffect(() => { loadData(); }, [loadData]);

  const loadReport = async (date) => {
    setReportLoading(true);
    setReportsExist(false);
    setReportSummary(null);
    try {
      const ds = date instanceof Date
        ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
        : String(date);
      const d = await api(`/api/admin/reports/orders/${ds}/summary`);
      if (d && (d.totalOrders > 0 || d.totalSales > 0)) { setReportSummary(d); setReportsExist(true); }
    } catch (e) { showToast(e.message || 'Failed to load report.', 'error'); }
    finally { setReportLoading(false); }
  };

  const handleProductSubmit = async (e) => {
    e.preventDefault();
    const { name, category, description, price, stock, lowStockThreshold, status } = newProduct;
    if (!name || !category || !description || !price || stock === '' || lowStockThreshold === '') {
      showToast('All required fields must be filled.', 'error'); return;
    }
    try {
      await api('/api/products', {
        method: 'POST',
        body: JSON.stringify({
          name, category, description, price: Number(price), stock: Number(stock),
          lowStockThreshold: Number(lowStockThreshold), status, image: newProduct.image
        })
      });
      showToast('Product added.', 'success');
      setNewProduct({ name: '', category: '', description: '', price: '', stock: '', lowStockThreshold: '', status: 'Active', image: '' });
      setNewProductImage(null);
      loadData();
    } catch (e) { showToast(e.message || 'Failed.', 'error'); }
  };

  const handleProductEdit = async (e) => {
    e.preventDefault();
    if (!editingProduct) return;
    try {
      await api(`/api/products/${editingProduct}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: newProduct.name, category: newProduct.category, description: newProduct.description,
          price: Number(newProduct.price), stock: Number(newProduct.stock),
          lowStockThreshold: Number(newProduct.lowStockThreshold), status: newProduct.status, image: newProduct.image
        })
      });
      showToast('Product updated.', 'success');
      setEditingProduct(null);
      setNewProduct({ name: '', category: '', description: '', price: '', stock: '', lowStockThreshold: '', status: 'Active', image: '' });
      loadData();
    } catch (e) { showToast(e.message || 'Failed.', 'error'); }
  };

  const handleDelete = async (productId) => {
    if (!confirm('Archive this product?')) return;
    try { await api(`/api/products/${productId}`, { method: 'PATCH', body: JSON.stringify({ active: false }) }); showToast('Archived.', 'success'); loadData(); }
    catch (e) { showToast(e.message || 'Failed.', 'error'); }
  };

  const handleStock = async (productId, dir) => {
    try { await api(`/api/products/${productId}/stock/${dir}`, { method: 'PATCH' }); showToast(dir === 'increase' ? 'Stock increased.' : 'Stock decreased.', 'success'); loadData(); }
    catch (e) { showToast(e.message || 'Failed.', 'error'); }
  };

  const handleInventory = async (action, body) => {
    try { await api(`/api/inventory/${action}`, { method: 'POST', body: JSON.stringify(body) }); showToast('Updated.', 'success'); loadData(); }
    catch (e) { showToast(e.message || 'Failed.', 'error'); }
  };

  const statusCounts = {};
  orders.forEach(o => { statusCounts[displayOrderStatus(o.status)] = (statusCounts[displayOrderStatus(o.status)] || 0) + 1; });
  const lowStockProducts = products.filter(p => p.stock <= p.lowStockThreshold);
  const prodCounts = {};
  productions.forEach(p => { prodCounts[p.status] = (prodCounts[p.status] || 0) + 1; });

  const handleExport = async () => {
    try {
      const ds = reportDate instanceof Date
        ? `${reportDate.getFullYear()}-${String(reportDate.getMonth()+1).padStart(2,'0')}-${String(reportDate.getDate()).padStart(2,'0')}`
        : String(reportDate);
      const token = await getToken();
      const response = await fetch(`/api/admin/reports/orders/${ds}/download`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Download failed (HTTP ${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `BM-Report-${ds}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast(e.message || 'Download failed.', 'error');
    }
  };

  const renderTab = () => {
    switch (tab) {
      case 'dashboard': return renderDashboard();
      case 'orders': return <StaffOrders user={user} showToast={notify} />;
      case 'pickup': return renderPickup();
      case 'payments': return <AdminPayments user={user} showToast={notify} />;
      case 'products': return renderProducts();
      case 'inventory': return <><InventoryMaterials user={user} />{renderInventoryMovements()}</>;
      case 'jobs': return <JobOrders user={user} />;
      case 'archive': return <ArchivedOrders user={user} />;
      case 'production': return renderProduction();
      case 'customers': return renderCustomers();
      case 'reports': return <><CompletedOrdersReport user={user} />{renderReports()}</>;
      case 'audit': return renderAudit();
      case 'system': return renderSystem();
      default: return renderDashboard();
    }
  };

  const loadPickupDetail = async (orderId) => {
    setPickupDetailLoading(true);
    setPickupDetail(null);
    setPickupReceivedBy('');
    try {
      const d = await api(`/api/orders/${encodeURIComponent(orderId)}/pickup-details`);
      setPickupDetail(d);
    } catch (e) {
      showToast(e.message || 'Failed to load pickup details.', 'error');
    } finally {
      setPickupDetailLoading(false);
    }
  };

  const confirmPickup = async () => {
    if (!pickupDetail || pickupConfirming) return;
    setPickupConfirming(true);
    try {
      const d = await api(`/api/orders/${encodeURIComponent(pickupDetail.order.id)}/confirm-pickup`, {
        method: 'POST',
        body: JSON.stringify({ receivedByName: pickupReceivedBy || undefined })
      });
      showToast(`Order ${d.order.id} confirmed as Picked Up. Inventory deducted.`, 'success');
      setPickupDetail(null);
      loadData();
    } catch (e) {
      showToast(e.message || 'Failed to confirm pickup.', 'error');
    } finally {
      setPickupConfirming(false);
    }
  };

  const renderPickup = () => (
    <div>
      <h3 style={sectionTitle}>Ready for Pickup ({pickupOrders.length})</h3>
      {pickupLoading && <p style={{ color: C.gray400 }}>Loading orders...</p>}
      {pickupError && <p role="alert" style={{ color: C.red }}>{pickupError}</p>}
      {!pickupLoading && !pickupError && pickupOrders.length === 0 && (
        <Card><p style={{ textAlign: 'center', color: C.gray400, padding: 20 }}>No orders ready for pickup.</p></Card>
      )}
      {pickupOrders.length > 0 && (
        <Card>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${C.gray200}` }}>
                  {['Order #', 'Customer', 'Product', 'Qty', 'Status', 'Ready Date', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: C.gray600, fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pickupOrders.map(o => (
                  <tr key={o.id} style={{ borderBottom: `1px solid ${C.gray100}` }}>
                    <td style={tdStyle}>{o.id}</td>
                    <td style={tdStyle}>{o.customer}</td>
                    <td style={tdStyle}>{o.product}</td>
                    <td style={tdStyle}>{o.quantity}</td>
                    <td style={tdStyle}><Badge status={o.status} /></td>
                    <td style={tdStyle}>{fmtDate(o.readyForPickupAt)}</td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <Btn size="sm" onClick={() => loadPickupDetail(o.id)} loading={pickupDetailLoading}>View</Btn>
                        <Btn size="sm" variant="primary" onClick={() => loadPickupDetail(o.id)}>Confirm Pickup</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Pickup Detail Modal */}
      {pickupDetail && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => !pickupConfirming && setPickupDetail(null)}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 680, width: '90%', maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px', fontFamily: 'Montserrat', fontSize: 18 }}>Confirm Pickup — {pickupDetail.order.id}</h3>
            {pickupDetailLoading && <p style={{ textAlign: 'center', color: '#666' }}>Loading...</p>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div>
                <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Order Information</h4>
                <dl style={{ margin: 0, fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><dt style={{ color: C.gray600 }}>Customer</dt><dd style={{ margin: 0, fontWeight: 600 }}>{pickupDetail.order.customer}</dd></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><dt style={{ color: C.gray600 }}>Product</dt><dd style={{ margin: 0, fontWeight: 600 }}>{pickupDetail.order.product}</dd></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><dt style={{ color: C.gray600 }}>Quantity</dt><dd style={{ margin: 0, fontWeight: 600 }}>{pickupDetail.order.quantity}</dd></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><dt style={{ color: C.gray600 }}>Total Price</dt><dd style={{ margin: 0, fontWeight: 600 }}>{fmt(pickupDetail.order.total)}</dd></div>
                </dl>
              </div>
              <div>
                <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Production</h4>
                <dl style={{ margin: 0, fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><dt style={{ color: C.gray600 }}>Job Order</dt><dd style={{ margin: 0, fontWeight: 600 }}>{pickupDetail.job.jobOrderId || 'N/A'}</dd></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><dt style={{ color: C.gray600 }}>Employee</dt><dd style={{ margin: 0, fontWeight: 600 }}>{pickupDetail.job.assignedEmployeeName || 'N/A'}</dd></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><dt style={{ color: C.gray600 }}>Completed</dt><dd style={{ margin: 0, fontWeight: 600 }}>{fmtDate(pickupDetail.job.productionCompletedAt)}</dd></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><dt style={{ color: C.gray600 }}>Ready for Pickup</dt><dd style={{ margin: 0, fontWeight: 600 }}>{fmtDate(pickupDetail.job.readyForPickupAt)}</dd></div>
                </dl>
              </div>
            </div>
            <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Reserved Materials</h4>
            <div style={{ background: '#f8f9fa', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
              {(pickupDetail.job.reservedMaterials || []).map((m, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #e0e0e0', fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>{m.material}</span>
                  <span>Reserved: {m.quantity} {m.unit}</span>
                </div>
              ))}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Received by (optional)</label>
              <input type="text" value={pickupReceivedBy} onChange={e => setPickupReceivedBy(e.target.value)} placeholder="Name of person receiving the order" style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }} />
            </div>
            <div style={{ background: '#fff3e0', border: '1px solid #ffb74d', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
              <p style={{ margin: 0, fontSize: 13, color: '#e65100' }}>
                <strong>Confirm that Order #{pickupDetail.order.id} has been released/picked up by the customer?</strong>
              </p>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: '#e65100' }}>
                This will finalize the reserved inventory deduction. This action cannot be undone.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Btn variant="ghost" disabled={pickupConfirming} onClick={() => setPickupDetail(null)}>Cancel</Btn>
              <Btn variant="primary" loading={pickupConfirming} disabled={pickupConfirming} onClick={confirmPickup}>
                {pickupConfirming ? 'Confirming...' : 'Confirm Pickup'}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderInventoryMovements = () => (
    <Card style={{ marginTop: 20 }}>
      <h4 style={cardTitle}>Inventory Movements</h4>
      {movementsLoading && <p style={{ color: C.gray400 }}>Loading movements...</p>}
      {!movementsLoading && stockMovements.length === 0 && (
        <p style={{ fontSize: 13, color: C.gray400, textAlign: 'center', padding: 20 }}>No stock movements recorded yet.</p>
      )}
      {stockMovements.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${C.gray200}` }}>
                {['Date', 'Item', 'Type', 'Qty', 'Order', 'Reason', 'Performed By'].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: C.gray600, fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stockMovements.map((m, i) => (
                <tr key={m._id || i} style={{ borderBottom: `1px solid ${C.gray100}` }}>
                  <td style={tdStyle}>{fmtDate(m.createdAt)}</td>
                  <td style={tdStyle}>{m.material}</td>
                  <td style={tdStyle}><Badge status={m.movementType === 'OUT' ? 'Cancelled' : 'Completed'} /></td>
                  <td style={tdStyle} style={{ color: m.movementType === 'OUT' ? '#c62828' : '#1a7a3a', fontWeight: 600 }}>{m.movementType === 'OUT' ? '-' : '+'}{m.quantity}</td>
                  <td style={tdStyle}>{m.orderId}</td>
                  <td style={tdStyle}>{m.reason === 'ORDER_PICKUP' ? 'Order Pickup' : m.reason === 'RESTOCK' ? 'Restock' : m.reason}</td>
                  <td style={tdStyle}>{m.performedByName || m.performedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );

  const renderDashboard = () => (
    <div>
      <h3 style={sectionTitle}>Dashboard Overview</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 28 }}>
        <StatCard label="Total Orders" value={summary?.totalOrders || 0} color={C.info} />
        <StatCard label="Total Revenue" value={fmt(summary?.totalRevenue)} color={C.success} />
        <StatCard label="Pending Orders" value={summary?.pendingOrders || 0} color={C.warning} />
        <StatCard label="Completed Orders" value={summary?.completedOrders || 0} color={C.success} />
        <StatCard label="In Production" value={summary?.inProduction || 0} color="#e65100" />
        <StatCard label="Ready for Pickup" value={summary?.readyForPickup || 0} color={C.info} />
      </div>

      {lowStockProducts.length > 0 && (
        <Card style={{ marginBottom: 20, borderColor: C.warning, background: C.warningBg }}>
          <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, color: C.warning }}>⚠ Inventory Alerts</h4>
          {lowStockProducts.slice(0, 5).map(p => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', color: C.gray800 }}>
              <span>{p.name}</span>
              <span style={{ fontWeight: 600, color: p.stock === 0 ? '#c62828' : C.warning }}>
                {p.stock === 0 ? 'Out of Stock' : `${p.stock} remaining`}
              </span>
            </div>
          ))}
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <Card>
          <h4 style={cardTitle}>Orders by Status</h4>
          {STATUS_LIST.map(s => (
            <StatusRow key={s} label={s} count={statusCounts[s] || 0} total={orders.length || 1} color={ORDER_STATUS_COLORS[s]?.color || '#666'} />
          ))}
        </Card>
        <Card>
          <h4 style={cardTitle}>Top Products</h4>
          {summary?.topServices?.length > 0 ? summary.topServices.map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: `1px solid ${C.gray100}`, fontSize: 13 }}>
              <span style={{ color: C.gray800 }}>{s.name}</span>
              <span style={{ fontWeight: 600, color: C.gray600 }}>{s.count} orders</span>
            </div>
          )) : <p style={{ fontSize: 13, color: C.gray400 }}>No data available</p>}
        </Card>
      </div>

      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h4 style={cardTitle}>Recent Orders</h4>
          <Btn variant="ghost" size="sm" onClick={() => setTab('orders')}>View All</Btn>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${C.gray200}` }}>
                {['Order ID','Customer','Product','Qty','Total','Status','Date'].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: C.gray600, fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.slice(0, 8).map(o => {
                const item = o.items?.[0] || {};
                return (
                  <tr key={o.orderId} style={{ borderBottom: `1px solid ${C.gray100}` }}>
                    <td style={tdStyle}>{o.orderId}</td>
                    <td style={tdStyle}>{o.customer}</td>
                    <td style={tdStyle}>{item.productName || ''}</td>
                    <td style={tdStyle}>{item.quantity || 0}</td>
                    <td style={tdStyle}>{fmt(o.total)}</td>
                    <td style={tdStyle}><Badge status={o.status} /></td>
                    <td style={tdStyle}>{fmtDate(o.createdAt)}</td>
                  </tr>
                );
              })}
              {orders.length === 0 && <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: C.gray400 }}>No orders found</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <Card>
          <h4 style={cardTitle}>Production Overview</h4>
          {['Queued','In Production','Quality Check','Ready','Completed','Delayed'].map(s => (
            <StatusRow key={s} label={s} count={prodCounts[s] || 0} total={productions.length || 1} color={ORDER_STATUS_COLORS[s]?.color || '#666'} />
          ))}
        </Card>
        <Card>
          <h4 style={cardTitle}>System Status</h4>
          {['Database','API','Storage','Payment','Excel'].map((s, i) => (
            <div key={s} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${C.gray100}`, fontSize: 13 }}>
              <span style={{ color: C.gray800 }}>{s}</span>
              <span style={{ color: C.success, fontWeight: 600 }}>● OK</span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );

  const renderProducts = () => (
    <div>
      <h3 style={sectionTitle}>Product Management</h3>
      <Card style={{ marginBottom: 20 }}>
        <h4 style={cardTitle}>{editingProduct ? 'Edit Product' : 'Add Product'}</h4>
        <form onSubmit={editingProduct ? handleProductEdit : handleProductSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input label="Product Name" name="name" value={newProduct.name} onChange={v => setNewProduct(p => ({ ...p, name: v }))} required />
            <Input label="Category" name="category" value={newProduct.category} onChange={v => setNewProduct(p => ({ ...p, category: v }))} required />
          </div>
          <Input label="Description" name="description" value={newProduct.description} onChange={v => setNewProduct(p => ({ ...p, description: v }))} required />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
            <Input label="Price" name="price" type="number" value={newProduct.price} onChange={v => setNewProduct(p => ({ ...p, price: v }))} required min="0" />
            <Input label="Stock" name="stock" type="number" value={newProduct.stock} onChange={v => setNewProduct(p => ({ ...p, stock: v }))} required min="0" />
            <Input label="Low Stock Threshold" name="lowStockThreshold" type="number" value={newProduct.lowStockThreshold} onChange={v => setNewProduct(p => ({ ...p, lowStockThreshold: v }))} required min="0" />
            <div>
              <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: C.gray600 }}>Status</label>
              <select value={newProduct.status} onChange={e => setNewProduct(p => ({ ...p, status: e.target.value }))} style={{ width: '100%', padding: '10px', border: `1px solid ${C.gray200}`, borderRadius: 6, fontSize: 14 }}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          </div>
          {newProductImage && (
            <div style={{ margin: '10px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
              <img src={newProductImage.base64} alt="" style={{ width: 60, height: 60, objectFit: 'contain', borderRadius: 4, border: `1px solid ${C.gray200}` }} />
              <span style={{ fontSize: 12, color: C.gray600 }}>{newProductImage.originalName}</span>
              <button type="button" onClick={() => { setNewProductImage(null); setNewProduct(p => ({ ...p, image: '' })); }} style={{ fontSize: 12, color: '#c62828', background: 'none', border: 'none', cursor: 'pointer' }}>Remove</button>
            </div>
          )}
          <input type="file" name="image" accept=".jpg,.jpeg,.png,.webp" style={{ display: 'none' }} onChange={e => {
            const file = e.target.files?.[0]; if (!file) return;
            const reader = new FileReader(); reader.readAsDataURL(file);
            reader.onload = () => { setNewProductImage({ base64: reader.result, originalName: file.name }); setNewProduct(p => ({ ...p, image: reader.result })); };
          }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Btn type="submit" variant="primary">{editingProduct ? 'Save Changes' : 'Add Product'}</Btn>
            <Btn variant="ghost" onClick={() => { setEditingProduct(null); setNewProduct({ name: '', category: '', description: '', price: '', stock: '', lowStockThreshold: '', status: 'Active', image: '' }); setNewProductImage(null); }}>
              {editingProduct ? 'Cancel Edit' : 'Clear'}
            </Btn>
          </div>
        </form>
      </Card>

      <Card>
        <h4 style={cardTitle}>Product List ({products.length})</h4>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${C.gray200}` }}>
                {['Product','Category','Price','Stock','Threshold','Status','Actions'].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: C.gray600, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map(p => (
                <tr key={p.id} style={{ borderBottom: `1px solid ${C.gray100}` }}>
                  <td style={tdStyle}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{p.image && <img src={p.image} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'contain' }} />}{p.name}</div></td>
                  <td style={tdStyle}>{p.category}</td>
                  <td style={tdStyle}>{fmt(p.price)}</td>
                  <td style={tdStyle}><span style={{ color: p.stock <= p.lowStockThreshold ? '#c62828' : C.gray800 }}>{p.stock}</span></td>
                  <td style={tdStyle}>{p.lowStockThreshold}</td>
                  <td style={tdStyle}><Badge status={p.status || (p.active ? 'Active' : 'Inactive')} /></td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => handleStock(p.id, 'increase')} style={actionBtn}>+</button>
                      <button onClick={() => handleStock(p.id, 'decrease')} style={actionBtn}>-</button>
                      <button onClick={() => { setEditingProduct(p.id); setNewProduct({ name: p.name, category: p.category, description: p.description, price: p.price, stock: p.stock, lowStockThreshold: p.lowStockThreshold, status: p.status || 'Active', image: p.image || '' }); }} style={actionBtn}>Edit</button>
                      <button onClick={() => handleDelete(p.id)} style={{ ...actionBtn, color: '#c62828' }}>Del</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );

  const renderInventory = () => (
    <div>
      <h3 style={sectionTitle}>Inventory Management</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 24 }}>
        <StatCard label="Total Products" value={products.length} color={C.info} />
        <StatCard label="In Stock" value={products.filter(p => p.stock > p.lowStockThreshold).length} color={C.success} />
        <StatCard label="Low Stock" value={lowStockProducts.length} color={C.warning} />
        <StatCard label="Out of Stock" value={products.filter(p => p.stock === 0).length} color="#c62828" />
      </div>

      {lowStock.length > 0 && (
        <Card style={{ marginBottom: 20, borderColor: C.warning, background: C.warningBg }}>
          <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, color: C.warning }}>⚠ Raw Material Alerts</h4>
          {lowStock.map((item, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13, borderBottom: `1px solid ${C.warningBg}` }}>
              <span style={{ color: C.gray800 }}>{item.material} <span style={{ fontSize: 11, color: C.gray400 }}>({item.type})</span></span>
              <span style={{ fontWeight: 600, color: item.quantity === 0 ? '#c62828' : C.warning }}>{item.quantity} / min {item.minimumStockLevel}</span>
            </div>
          ))}
        </Card>
      )}

      <Card style={{ marginBottom: 20 }}>
        <h4 style={cardTitle}>Raw Materials Stock</h4>
        {inventory.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${C.gray200}` }}>
                  {['Material','Type','On Hand','Reserved','Available','Min Level','Cost/Unit','Supplier','Actions'].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: C.gray600, fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inventory.map((item, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.gray100}` }}>
                    <td style={tdStyle}>{item.material}</td>
                    <td style={tdStyle}>{item.type}</td>
                    <td style={tdStyle}><span style={{ color: item.quantity <= item.minimumStockLevel ? '#c62828' : C.gray800, fontWeight: 600 }}>{item.quantity}</span></td>
                    <td style={tdStyle}>{item.reservedQuantity}</td>
                    <td style={tdStyle}><span style={{ fontWeight: 600, color: item.availableQuantity <= 0 ? '#c62828' : C.gray800 }}>{item.availableQuantity}</span></td>
                    <td style={tdStyle}>{item.minimumStockLevel}</td>
                    <td style={tdStyle}>{fmt(item.costPerUnit)}</td>
                    <td style={tdStyle}>{item.supplier || '-'}</td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => handleInventory('stock-in', { material: item.material, quantity: 10, notes: 'Admin restock' })} style={actionBtn}>+10</button>
                        <button onClick={() => handleInventory('stock-out', { material: item.material, quantity: 1, notes: 'Admin usage' })} style={actionBtn}>-1</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ fontSize: 13, color: C.gray400, padding: 16, textAlign: 'center' }}>No raw materials tracked yet. Use stock-in to add materials.</p>
        )}
      </Card>
      {renderInventoryMovements()}
    </div>
  );

  const renderProduction = () => (
    <div>
      <h3 style={sectionTitle}>Production Overview ({productions.length})</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 24 }}>
        {['Queued','In Production','Quality Check','Ready','Completed','Delayed'].map(s => (
          <Card key={s} style={{ padding: '12px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'Montserrat', color: ORDER_STATUS_COLORS[s]?.color || '#666' }}>{prodCounts[s] || 0}</div>
            <div style={{ fontSize: 11, color: C.gray600 }}>{s}</div>
          </Card>
        ))}
      </div>
      <Card>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${C.gray200}` }}>
                {['Order ID','Status','Priority','Employee','Notes','Start Time','Completed'].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: C.gray600, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {productions.map((p, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.gray100}` }}>
                  <td style={tdStyle}>{p.orderId}</td>
                  <td style={tdStyle}><Badge status={p.status} /></td>
                  <td style={tdStyle}>{p.priority || 'normal'}</td>
                  <td style={tdStyle}>{p.assignedEmployee || '-'}</td>
                  <td style={tdStyle}>{p.productionNotes || p.delayReason || '-'}</td>
                  <td style={tdStyle}>{fmtDate(p.startTime)}</td>
                  <td style={tdStyle}>{fmtDate(p.actualCompletion)}</td>
                </tr>
              ))}
              {productions.length === 0 && <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: C.gray400 }}>No production records found</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );

  const renderCustomers = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={sectionTitle}>Customers ({customers.length})</h3>
        <input
          placeholder="Search customers..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') loadData(); }}
          style={{ padding: '8px 12px', border: `1px solid ${C.gray200}`, borderRadius: 6, fontSize: 13, width: 220 }}
        />
      </div>
      <Card>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${C.gray200}` }}>
                {['Name','Email','Phone','Role','Joined'].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: C.gray600, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {customers.map((c, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.gray100}` }}>
                  <td style={tdStyle}>{c.name}</td>
                  <td style={tdStyle}>{c.email}</td>
                  <td style={tdStyle}>{c.phone || '-'}</td>
                  <td style={tdStyle}><Badge status={c.role || 'customer'} /></td>
                  <td style={tdStyle}>{fmtDate(c.createdAt)}</td>
                </tr>
              ))}
              {customers.length === 0 && <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: C.gray400 }}>No customers found. Try searching above.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );

  const renderReports = () => (
    <div>
      <h3 style={sectionTitle}>Reports</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <Card>
          <h4 style={cardTitle}>Daily Report</h4>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
            <input type="date" value={`${reportDate.getFullYear()}-${String(reportDate.getMonth()+1).padStart(2,'0')}-${String(reportDate.getDate()).padStart(2,'0')}`}
              onChange={e => setReportDate(new Date(e.target.value))} disabled={reportLoading}
              style={{ padding: '8px 12px', border: `1px solid ${C.gray200}`, borderRadius: 6, fontSize: 13 }} />
            <Btn variant="primary" size="sm" onClick={() => loadReport(reportDate)} loading={reportLoading}>Load Report</Btn>
            {reportsExist && <Btn variant="ghost" size="sm" onClick={handleExport}>Download Excel</Btn>}
          </div>
          {reportSummary && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                ['Total Orders', reportSummary.totalOrders || 0],
                ['Total Sales', fmt(reportSummary.totalSales)],
                ['Completed', reportSummary.completedOrders || 0],
                ['Pending', reportSummary.pendingOrders || 0],
                ['Cancelled', reportSummary.cancelledOrders || 0],
                ['Avg Order Value', fmt(reportSummary.averageOrderValue)],
              ].map(([l, v]) => (
                <div key={l} style={{ padding: '8px 12px', background: C.gray50, borderRadius: 6, fontSize: 13 }}>
                  <div style={{ color: C.gray600, fontSize: 11 }}>{l}</div>
                  <div style={{ fontWeight: 700, color: C.gray800 }}>{v}</div>
                </div>
              ))}
            </div>
          )}
          {!reportsExist && !reportSummary && <p style={{ fontSize: 13, color: C.gray400 }}>Select a date and click Load Report.</p>}
          {reportsExist === false && reportSummary === null && !reportLoading && <p style={{ fontSize: 13, color: C.gray400 }}>No report found for this date.</p>}
        </Card>
        <Card>
          <h4 style={cardTitle}>Analytics</h4>
          {analytics?.serviceDistribution?.length > 0 ? (
            <div>
              <p style={{ fontSize: 12, color: C.gray600, marginBottom: 10 }}>Service Distribution</p>
              {analytics.serviceDistribution.map((s, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                    <span style={{ color: C.gray800 }}>{s.name}</span>
                    <span style={{ fontWeight: 600, color: C.gray600 }}>{s.count} ({s.percentage}%)</span>
                  </div>
                  <div style={{ height: 6, background: C.gray100, borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${s.percentage}%`, height: '100%', background: C.red, borderRadius: 3 }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: C.gray400 }}>Analytics data will appear here once orders are processed.</p>
          )}
        </Card>
      </div>
    </div>
  );

  const renderAudit = () => (
    <div>
      <h3 style={sectionTitle}>Audit Logs</h3>
      <Card>
        <p style={{ fontSize: 13, color: C.gray400, marginBottom: 12 }}>
          Audit logs record system actions. Note: Current backend logs entries to console only; persistent database storage is not yet implemented.
        </p>
        {auditLogs.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${C.gray200}` }}>
                  {['Timestamp','Action','Module','Result'].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: C.gray600, fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.gray100}` }}>
                    <td style={tdStyle}>{fmtDate(log.timestamp)}</td>
                    <td style={tdStyle}>{log.action}</td>
                    <td style={tdStyle}>{log.module}</td>
                    <td style={tdStyle}><Badge status={log.result || 'Success'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ fontSize: 13, color: C.gray400, textAlign: 'center', padding: 20 }}>
            Audit logs are generated during system use and displayed here when available.
          </p>
        )}
      </Card>
    </div>
  );

  const renderSystem = () => (
    <div>
      <h3 style={sectionTitle}>System Status</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        {[
          ['Database', systemHealth?.database || 'OK'],
          ['API', systemHealth?.api || 'OK'],
          ['Storage', systemHealth?.storage || 'OK'],
          ['AI Service', systemHealth?.aiService || 'OK'],
          ['Payment Service', systemHealth?.paymentService || 'OK'],
          ['Excel Generator', systemHealth?.excelGenerator || 'OK'],
        ].map(([name, status]) => (
          <Card key={name} style={{ padding: '16px 18px', textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.gray800, marginBottom: 6 }}>{name}</div>
            <span style={{
              display: 'inline-block', padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700,
              background: status === 'OK' ? C.successBg : '#fdecea',
              color: status === 'OK' ? C.success : '#c62828'
            }}>
              {status === 'OK' ? '● Operational' : `● ${status}`}
            </span>
          </Card>
        ))}
      </div>
    </div>
  );

  if (user?.role !== 'admin') return <div style={{ padding: 24 }}><StaffOrders user={user} showToast={notify} /></div>;

  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 70px)' }}>
      <Sidebar tab={tab} setTab={setTab} sidebarOpen={sidebarOpen} />
      <div className="bm-admin-surface" style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '20px 28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: C.gray600 }}>☰</button>
            <h2 style={{ margin: 0, fontFamily: 'Montserrat', fontSize: 20, fontWeight: 800, color: C.gray800 }}>
              {SIDEBAR_ITEMS.find(i => i.id === tab)?.label || 'Dashboard'}
            </h2>
          </div>
          {renderTab()}
        </div>
      </div>
    </div>
  );
}

const sectionTitle = { margin: '0 0 18px', fontFamily: 'Montserrat', fontWeight: 800, fontSize: 18, color: C.gray800 };
const cardTitle = { margin: '0 0 12px', fontFamily: 'Montserrat', fontWeight: 700, fontSize: 15, color: C.gray800 };
const tdStyle = { padding: '8px 10px', color: C.gray800 };
const actionBtn = { padding: '4px 8px', fontSize: 11, border: `1px solid ${C.gray200}`, borderRadius: 4, background: '#fff', cursor: 'pointer', color: C.gray600 };
