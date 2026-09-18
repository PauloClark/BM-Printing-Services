import React, { useState, useEffect, useCallback } from 'react';
import { C } from '../../constants/colors';
import { showToast } from '../../utils/notifications';
import { Card } from '../Common/Card';
import { Btn } from '../Common/Btn';
import { Input } from '../Common/Input';
import { Badge } from '../Common/Badge';

const STATUS_LIST = ['Pending','Confirmed','Queued','In Production','Quality Check','Ready','Completed','Cancelled'];
const ORDER_STATUS_COLORS = {
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
const H = { 'x-user-role': 'admin', 'Content-Type': 'application/json' };
const api = async (url, opts = {}) => {
  const r = await fetch(url, { headers: H, ...opts });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

const SIDEBAR_ITEMS = [
  { id: 'dashboard', icon: '📊', label: 'Dashboard' },
  { id: 'orders', icon: '📋', label: 'Orders' },
  { id: 'products', icon: '📦', label: 'Products' },
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

export default function AdminPanel() {
  const [tab, setTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [summary, setSummary] = useState(null);
  const [orders, setOrders] = useState([]);
  const [orderFilter, setOrderFilter] = useState('All');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderFiles, setOrderFiles] = useState([]);
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
      products: async () => {
        try { const d = await api('/api/products'); if (d.products) setProducts(d.products); } catch {}
      },
      inventory: async () => {
        try { const d = await api('/api/inventory'); if (d.inventory) setInventory(d.inventory); } catch {}
        try { const d = await api('/api/inventory/low-stock'); if (d.inventory) setLowStock(d.inventory); } catch {}
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
    if (loaders[tab]) await loaders[tab]();
  }, [tab, searchQuery]);

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

  const updateOrderStatus = async (orderId, status) => {
    try {
      await api(`/api/orders/${orderId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      showToast(`Order ${orderId} updated to ${status}.`, 'success');
      loadData();
    } catch (e) { showToast(e.message || 'Failed to update order.', 'error'); }
  };

  const viewOrderFiles = async (orderId) => {
    try { const d = await api(`/api/files/${orderId}`); setOrderFiles(d.files || []); } catch { setOrderFiles([]); }
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

  const filteredOrders = orderFilter === 'All' ? orders : orders.filter(o => o.status === orderFilter);
  const statusCounts = {};
  orders.forEach(o => { statusCounts[o.status] = (statusCounts[o.status] || 0) + 1; });
  const lowStockProducts = products.filter(p => p.stock <= p.lowStockThreshold);
  const prodCounts = {};
  productions.forEach(p => { prodCounts[p.status] = (prodCounts[p.status] || 0) + 1; });

  const handleExport = async () => {
    try {
      const ds = reportDate instanceof Date
        ? `${reportDate.getFullYear()}-${String(reportDate.getMonth()+1).padStart(2,'0')}-${String(reportDate.getDate()).padStart(2,'0')}`
        : String(reportDate);
      const response = await fetch(`/api/admin/reports/orders/${ds}/download`, { headers: H });
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
      case 'orders': return renderOrders();
      case 'products': return renderProducts();
      case 'inventory': return renderInventory();
      case 'production': return renderProduction();
      case 'customers': return renderCustomers();
      case 'reports': return renderReports();
      case 'audit': return renderAudit();
      case 'system': return renderSystem();
      default: return renderDashboard();
    }
  };

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

  const renderOrders = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={sectionTitle}>Orders ({filteredOrders.length})</h3>
        <input
          placeholder="Search orders..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{ padding: '8px 12px', border: `1px solid ${C.gray200}`, borderRadius: 6, fontSize: 13, width: 220 }}
        />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {['All', ...STATUS_LIST].map(s => (
          <button key={s} onClick={() => setOrderFilter(s)} style={{
            padding: '5px 12px', fontSize: 12, fontWeight: 600, border: `1px solid ${orderFilter === s ? C.red : C.gray200}`,
            borderRadius: 20, background: orderFilter === s ? C.red : '#fff', color: orderFilter === s ? '#fff' : C.gray600, cursor: 'pointer'
          }}>{s}</button>
        ))}
      </div>
      <Card>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${C.gray200}` }}>
                {['Order ID','Customer','Email','Product','Qty','Total','Status','Date','Actions'].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: C.gray600, fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredOrders.slice(0, 50).map(o => {
                const item = o.items?.[0] || {};
                return (
                  <tr key={o.orderId} style={{ borderBottom: `1px solid ${C.gray100}` }}>
                    <td style={tdStyle}>{o.orderId}</td>
                    <td style={tdStyle}>{o.customer}</td>
                    <td style={tdStyle}>{o.email}</td>
                    <td style={tdStyle}>{item.productName || ''}</td>
                    <td style={tdStyle}>{item.quantity || 0}</td>
                    <td style={tdStyle}>{fmt(o.total)}</td>
                    <td style={tdStyle}><Badge status={o.status} /></td>
                    <td style={tdStyle}>{fmtDate(o.createdAt)}</td>
                    <td style={tdStyle}>
                      <select
                        value={o.status}
                        onChange={e => updateOrderStatus(o.orderId, e.target.value)}
                        style={{ padding: '4px 6px', fontSize: 11, border: `1px solid ${C.gray200}`, borderRadius: 4, background: '#fff' }}
                      >
                        {STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
              {filteredOrders.length === 0 && <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', color: C.gray400 }}>No orders found</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
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
                  {['Material','Type','Quantity','Min Level','Cost/Unit','Supplier','Actions'].map(h => (
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

  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 70px)' }}>
      <Sidebar tab={tab} setTab={setTab} sidebarOpen={sidebarOpen} />
      <div style={{ flex: 1, overflowY: 'auto', background: C.gray50 }}>
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
