import { JobOrders } from './JobOrders';
import { ArchivedOrders, CompletedOrdersReport } from './AdminOrderArchive';
import { InventoryMaterials } from './InventoryMaterials';
import { ORDER_STATUSES, displayOrderStatus } from '../../../shared/orderWorkflow';
import { orderApi } from '../../utils/orderApi';
import { publicAsset } from '../../utils/assets';
import { store } from '../../utils/storage';
import { StaffOrders } from './StaffOrders';
import { AdminPayments } from './AdminPayments';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { C } from '../../constants/colors';
import { showToast } from '../../utils/notifications';
import { NotificationBell } from '../Common/NotificationBell';
import { Card } from '../Common/Card';
import { Btn } from '../Common/Btn';
import { Input } from '../Common/Input';
import { Badge } from '../Common/Badge';
import { BMLogo } from '../Common/BMLogo';
import { PickupConfirmationModal } from '../Common/PickupConfirmationModal';
import { EmployeeManagement } from './EmployeeManagement';
import './AdminPanel.css';

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

const SIDEBAR_GROUPS = [
  { label: 'Overview', items: [{ id: 'dashboard', icon: 'dashboard', label: 'Dashboard' }] },
  { label: 'Management', items: [
    { id: 'products', icon: 'box', label: 'Products' },
    { id: 'orders', icon: 'orders', label: 'Orders' },
    { id: 'customers', icon: 'users', label: 'Customers' },
    { id: 'employees', icon: 'badge', label: 'Staff / Employees' }
  ]},
  { label: 'Operations', items: [
    { id: 'payments', icon: 'card', label: 'Payments for Verification' },
    { id: 'jobs', icon: 'clipboard', label: 'Job Orders' },
    { id: 'inventory', icon: 'layers', label: 'Inventory' },
    { id: 'production', icon: 'settings', label: 'Production' },
    { id: 'pickup', icon: 'package', label: 'Ready for Pickup' },
    { id: 'archive', icon: 'archive', label: 'Archived Orders' }
  ]},
  { label: 'Analytics', items: [
    { id: 'reports', icon: 'chart', label: 'Reports' },
    { id: 'audit', icon: 'file', label: 'Audit Logs' }
  ]},
  { label: 'System', items: [{ id: 'system', icon: 'sliders', label: 'System Settings' }] }
];
const SIDEBAR_ITEMS = SIDEBAR_GROUPS.flatMap(group => group.items);

const Icon = ({ name, size = 18 }) => {
  const paths = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    box: <><path d="M21 8l-9 5-9-5"/><path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M12 13v8"/></>,
    orders: <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/></>,
    users: <><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></>,
    badge: <><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.8-2 5.2-2 6 0M14 9h4M14 13h4"/></>,
    card: <><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h2"/></>,
    clipboard: <><rect x="4" y="4" width="16" height="18" rx="2"/><path d="M9 4V2h6v2M8 10h8M8 14h8M8 18h5"/></>,
    layers: <><path d="M12 2l10 5-10 5L2 7zM2 12l10 5 10-5M2 17l10 5 10-5"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.6v.2h-4V21a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 00.3-1.9A1.7 1.7 0 003 14H2v-4h1a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 009 4.6 1.7 1.7 0 0010 3V2h4v1a1.7 1.7 0 001 1.6 1.7 1.7 0 001.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 00-.3 1.9 1.7 1.7 0 001.6 1h1v4h-1a1.7 1.7 0 00-1.6 1z"/></>,
    package: <><path d="M21 8l-9 5-9-5M3 8l9-5 9 5v8l-9 5-9-5zM12 13v8"/><path d="M16 6l-9 5"/></>,
    archive: <><path d="M3 5h18v4H3zM5 9v11h14V9M9 13h6"/></>,
    chart: <><path d="M3 3v18h18M7 16l4-5 4 3 5-7"/></>,
    file: <><path d="M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6"/></>,
    sliders: <><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16"/>
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.file}</svg>;
};

const Sidebar = ({ tab, onNavigate, sidebarOpen }) => {
  return (
    <aside className={`bm-admin-sidebar${sidebarOpen ? ' is-open' : ''}`}>
      {sidebarOpen && (
        <div className="bm-admin-brand">
          <BMLogo size={42} />
          <div><strong>BM Printing</strong><span>Admin workspace</span></div>
        </div>
      )}
      {sidebarOpen && <nav className="bm-admin-nav">{SIDEBAR_GROUPS.map(group => (
        <div className="bm-admin-nav-group" key={group.label}>
          <div className="bm-admin-nav-label">{group.label}</div>
          {group.items.map(item => <button key={item.id} className={tab === item.id ? 'is-active' : ''} onClick={() => onNavigate(item.id)} aria-current={tab === item.id ? 'page' : undefined}>
            <Icon name={item.icon} /><span>{item.label}</span>
          </button>)}
        </div>
      ))}</nav>}
    </aside>
  );
};

const StatCard = ({ label, value, icon = 'orders' }) => (
  <Card className="bm-admin-stat">
    <span className="bm-admin-stat-icon"><Icon name={icon} /></span>
    <div><div className="bm-admin-stat-value">{value}</div><div className="bm-admin-stat-label">{label}</div></div>
  </Card>
);

const StatusRow = ({ label, count, total, color }) => {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="bm-admin-status-row">
      <span className="bm-admin-status-label">{label}</span>
      <div className="bm-admin-status-track" aria-hidden="true">
        <div className="bm-admin-status-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="bm-admin-status-count">{count}</span>
    </div>
  );
};

export default function AdminPanel({ user, showToast: notify, onLogout }) {
  const [tab, setTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 720);
  const [summary, setSummary] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState('');
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
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customersError, setCustomersError] = useState('');
  const [customersWarning, setCustomersWarning] = useState('');
  const [auditLogs, setAuditLogs] = useState([]);
  const [editingProduct, setEditingProduct] = useState(null);
  const emptyProduct = { name: '', category: '', description: '', price: '', minQty: 1, unit: 'per piece', image: '', imageFit: 'contain', specificationType: 'general', popular: false, active: true, trackStock: false, stock: 0, lowStockThreshold: 0 };
  const [newProduct, setNewProduct] = useState(emptyProduct);
  const [newProductImage, setNewProductImage] = useState(null);
  const [productLoading, setProductLoading] = useState(false);
  const [productError, setProductError] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [pickupOrders, setPickupOrders] = useState([]);
  const [pickupLoading, setPickupLoading] = useState(false);
  const [pickupError, setPickupError] = useState('');
  const [pickupDetail, setPickupDetail] = useState(null);
  const [pickupDetailLoading, setPickupDetailLoading] = useState(false);
  const [pickupConfirming, setPickupConfirming] = useState(false);
  const [pickupReceivedBy, setPickupReceivedBy] = useState('');
  const [pickupActionError, setPickupActionError] = useState('');
  const [stockMovements, setStockMovements] = useState([]);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountMenuRef = useRef(null);

  useEffect(() => {
    if (!accountOpen) return undefined;
    const closeOnOutsideClick = event => {
      if (!accountMenuRef.current?.contains(event.target)) setAccountOpen(false);
    };
    const closeOnEscape = event => {
      if (event.key === 'Escape') {
        setAccountOpen(false);
        accountMenuRef.current?.querySelector('.bm-admin-account-trigger')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [accountOpen]);

  const loadData = useCallback(async () => {
    const loaders = {
      dashboard: async () => {
        setDashboardLoading(true);
        setDashboardError('');
        try {
          const [summaryResult, ordersResult] = await Promise.all([
            api('/api/dashboard/summary'),
            api('/api/admin/orders')
          ]);
          if (!summaryResult?.success || !summaryResult.data || !Array.isArray(ordersResult?.orders)) {
            throw new Error('The dashboard API returned an invalid response.');
          }
          setSummary(summaryResult.data);
          setOrders(ordersResult.orders);
          const [productResult, inventoryResult] = await Promise.allSettled([
            api('/api/products'), api('/api/inventory/low-stock')
          ]);
          setProducts(productResult.status === 'fulfilled' && Array.isArray(productResult.value?.products) ? productResult.value.products : []);
          setLowStock(inventoryResult.status === 'fulfilled' && Array.isArray(inventoryResult.value?.inventory) ? inventoryResult.value.inventory : []);
        } catch (error) {
          setSummary(null);
          setOrders([]);
          setDashboardError(error.message || 'Unable to load dashboard data.');
        } finally {
          setDashboardLoading(false);
        }
      },
      orders: async () => {
        try { const d = await api('/api/admin/orders'); if (d.orders) setOrders(d.orders); } catch {}
      },
      pickup: async () => {
        setPickupLoading(true);
        try { const d = await api('/api/pickup/orders'); if (d.orders) setPickupOrders(d.orders); setPickupError(''); }
        catch (e) { setPickupError(e.message); }
        finally { setPickupLoading(false); }
      },
      products: async () => {
        setProductLoading(true); setProductError('');
        try { const d = await api('/api/admin/products'); if (Array.isArray(d.products)) setProducts(d.products); }
        catch (error) { setProducts([]); setProductError(error.message || 'Unable to load product management.'); }
        finally { setProductLoading(false); }
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
        setCustomersLoading(true); setCustomersError('');
        try {
          const d = await api('/api/search/customers?query=' + encodeURIComponent(searchQuery));
          setCustomers(Array.isArray(d.customers) ? d.customers : []);
          setCustomersWarning(d.warnings?.map(warning => warning.message).join(' ') || '');
        } catch (error) {
          setCustomers([]); setCustomersWarning(''); setCustomersError(error.message || 'Customer directory could not be loaded.');
        } finally { setCustomersLoading(false); }
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

  const navigateAdmin = useCallback((nextTab) => {
    setAccountOpen(false);
    setTab(nextTab);
    if (window.innerWidth <= 720) setSidebarOpen(false);
  }, []);

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
    const { name, category, description, price } = newProduct;
    if (!name || !category || !description || !price) {
      showToast('All required fields must be filled.', 'error'); return;
    }
    const numericPrice = Number(price);
    if (!Number.isInteger(numericPrice) || numericPrice < 1) {
      showToast('Price must be a positive whole PHP amount.', 'error'); return;
    }
    try {
      await api('/api/products', {
        method: 'POST',
        body: JSON.stringify({
          ...newProduct, price: numericPrice, minQty: Number(newProduct.minQty),
          stock: Number(newProduct.stock), lowStockThreshold: Number(newProduct.lowStockThreshold)
        })
      });
      showToast('Product added.', 'success');
      setNewProduct(emptyProduct);
      setNewProductImage(null);
      loadData();
    } catch (e) { showToast(e.message || 'Failed.', 'error'); }
  };

  const handleProductEdit = async (e) => {
    e.preventDefault();
    if (!editingProduct) return;
    const numericPrice = Number(newProduct.price);
    if (!Number.isInteger(numericPrice) || numericPrice < 1) {
      showToast('Price must be a positive whole PHP amount.', 'error'); return;
    }
    try {
      await api(`/api/products/${editingProduct}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...newProduct, price: numericPrice, minQty: Number(newProduct.minQty),
          stock: Number(newProduct.stock), lowStockThreshold: Number(newProduct.lowStockThreshold)
        })
      });
      showToast('Product updated.', 'success');
      setEditingProduct(null);
      setNewProduct(emptyProduct);
      loadData();
    } catch (e) { showToast(e.message || 'Failed.', 'error'); }
  };

  const handleDelete = async (productId) => {
    const product = products.find(item => item.id === productId);
    const active = !product?.active;
    if (!confirm(`${active ? 'Activate' : 'Deactivate'} ${product?.name || 'this product'}?`)) return;
    try { await api(`/api/products/${productId}`, { method: 'PATCH', body: JSON.stringify({ active }) }); showToast(active ? 'Product activated.' : 'Product deactivated.', 'success'); loadData(); }
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
  const lowStockProducts = products.filter(p => p.trackStock === true && p.stock <= p.lowStockThreshold);
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
      case 'orders': return <StaffOrders user={user} showToast={notify} onReviewPayment={() => navigateAdmin('payments')} />;
      case 'pickup': return renderPickup();
      case 'payments': return <AdminPayments user={user} showToast={notify} />;
      case 'products': return renderProducts();
      case 'inventory': return <><InventoryMaterials user={user} />{renderInventoryMovements()}</>;
      case 'jobs': return <JobOrders user={user} />;
      case 'archive': return <ArchivedOrders user={user} />;
      case 'production': return renderProduction();
      case 'customers': return renderCustomers();
      case 'employees': return <EmployeeManagement showToast={notify || showToast} />;
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
    setPickupActionError('');
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
    if (pickupReceivedBy.trim().length < 2) {
      setPickupActionError('Enter the full name of the person collecting the order.');
      return;
    }
    setPickupConfirming(true);
    setPickupActionError('');
    try {
      const d = await api(`/api/orders/${encodeURIComponent(pickupDetail.order.id)}/confirm-pickup`, {
        method: 'POST',
        body: JSON.stringify({ receivedByName: pickupReceivedBy.trim() })
      });
      showToast(`Order ${d.order.id} confirmed as Picked Up.`, 'success');
      setPickupDetail(null);
      loadData();
    } catch (e) {
      setPickupActionError(e.message || 'Failed to confirm pickup.');
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
        <Card className="bm-admin-chart-card">
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
      {false && pickupDetail && (
        <div className="bm-admin-dialog-backdrop" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => !pickupConfirming && setPickupDetail(null)}>
          <div className="bm-admin-dialog" style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 680, width: '90%', maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
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
      <PickupConfirmationModal open={Boolean(pickupDetail)} detail={pickupDetail} loading={pickupDetailLoading}
        error={pickupActionError} receiverName={pickupReceivedBy}
        onReceiverChange={value => { setPickupReceivedBy(value); setPickupActionError(''); }} confirming={pickupConfirming}
        onClose={() => { setPickupDetail(null); setPickupActionError(''); }} onConfirm={confirmPickup} />
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
                  <td style={{ ...tdStyle, color: m.movementType === 'OUT' ? '#c62828' : '#1a7a3a', fontWeight: 600 }}>{m.movementType === 'OUT' ? '-' : '+'}{m.quantity}</td>
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

  const renderDashboard = () => {
    if (dashboardLoading) return (
      <div className="bm-admin-dashboard">
        <div className="bm-admin-heading"><div><span>Overview</span><h3>Dashboard</h3><p>Live operational data from your order system.</p></div></div>
        <Card className="bm-admin-state" role="status"><div className="bm-admin-state-spinner" /><h4>Loading dashboard</h4><p>Retrieving current order metrics.</p></Card>
      </div>
    );
    if (dashboardError) return (
      <div className="bm-admin-dashboard">
        <div className="bm-admin-heading"><div><span>Overview</span><h3>Dashboard</h3><p>Live operational data from your order system.</p></div></div>
        <Card className="bm-admin-state is-error" role="alert"><Icon name="file" size={24} /><h4>Dashboard data is unavailable</h4><p>{dashboardError}</p><button type="button" className="bm-admin-retry" onClick={loadData}>Retry</button></Card>
      </div>
    );
    return (
    <div className="bm-admin-dashboard">
      <div className="bm-admin-heading"><div><span>Overview</span><h3>Dashboard</h3><p>Live operational data from your order system.</p></div><div className="bm-admin-date">{new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })}</div></div>
      <div className="bm-admin-stat-grid">
        <StatCard label="Total Orders" value={summary.totalOrders ?? 0} icon="orders" />
        <StatCard label="Pending Orders" value={summary.pendingOrders ?? 0} icon="clipboard" />
        <StatCard label="Orders Processing" value={summary.inProduction ?? 0} icon="settings" />
        <StatCard label="Ready for Pickup" value={summary.readyForPickup ?? 0} icon="package" />
        <StatCard label="Completed Orders" value={summary.completedOrders ?? 0} icon="archive" />
        <StatCard label="Payments Awaiting Verification" value={summary.paymentsAwaitingVerification ?? 0} icon="card" />
      </div>

      {(lowStockProducts.length > 0 || lowStock.length > 0) && <Card className="bm-admin-inventory-alerts">
        <div className="bm-admin-inventory-alerts__heading"><div><span>Inventory</span><h4>Stock Alerts</h4></div><strong>{lowStockProducts.length + lowStock.length}</strong></div>
        <div className="bm-admin-inventory-alerts__list">
          {lowStockProducts.slice(0, 5).map(product => <div key={`product-${product.id}`}><span><strong>{product.name}</strong><small>Tracked finished product</small></span><b>{product.stock === 0 ? 'Out of stock' : `${product.stock} remaining`}</b></div>)}
          {lowStock.slice(0, 5).map(item => <div key={`material-${item.id || item._id || item.material}`}><span><strong>{item.material}</strong><small>Raw material</small></span><b>{Number(item.availableQuantity) <= 0 ? 'Out of stock' : `${item.availableQuantity} ${item.unit || ''} available`}</b></div>)}
        </div>
      </Card>}

      <div className="bm-admin-dashboard-grid">
        <Card>
          <h4 style={cardTitle}>Orders by Status</h4>
          {orders.length ? STATUS_LIST.map(s => (
            <StatusRow key={s} label={s} count={statusCounts[s] || 0} total={orders.length || 1} color={ORDER_STATUS_COLORS[s]?.color || '#666'} />
          )) : <div className="bm-admin-chart-empty"><Icon name="chart" size={22} /><span>No orders to summarize yet.</span></div>}
        </Card>
        <Card className="bm-admin-trend-card">
          <h4 style={cardTitle}>Orders Over Time</h4>
          <div className="bm-admin-bars" aria-label="Orders created over the last seven days">
            {(summary?.ordersOverTime || []).map(point => {
              const max = Math.max(1, ...(summary?.ordersOverTime || []).map(row => row.count));
              const height = point.count > 0 ? Math.max(4, point.count / max * 100) : 0;
              return <div className="bm-admin-bar-column" key={point.date} title={`${point.count} orders on ${point.date}`}><span>{point.count}</span><div style={{ height: `${height}%` }} /><small>{new Date(`${point.date}T00:00:00`).toLocaleDateString('en-PH', { weekday: 'short' })}</small></div>;
            })}
            {!summary?.ordersOverTime?.length && <p className="bm-admin-muted">No order activity available.</p>}
          </div>
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
              {orders.length === 0 && <tr><td colSpan={7} style={{ padding: 28, textAlign: 'center', color: C.gray400 }}>No orders have been recorded in this database.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

    </div>
    );
  };

  const renderProducts = () => {
    const filteredProducts = products.filter(product => `${product.name} ${product.category}`.toLowerCase().includes(productSearch.toLowerCase()));
    const edit = product => {
      setEditingProduct(product.id);
      setNewProduct({ ...emptyProduct, ...product });
      setNewProductImage(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    return <div className="bm-products-admin">
      <div className="bm-products-heading"><div><h3 style={sectionTitle}>Product Management</h3><p>Manage the catalog customers can browse and order.</p></div></div>
      <Card className="bm-product-editor" style={{ marginBottom: 20 }}>
        <h4 style={cardTitle}>{editingProduct ? `Edit Product #${editingProduct}` : 'Add Product'}</h4>
        <form onSubmit={editingProduct ? handleProductEdit : handleProductSubmit}>
          <div className="bm-product-form-grid">
            <Input label="Product Name" value={newProduct.name} onChange={name => setNewProduct(p => ({ ...p, name }))} required />
            <Input label="Category" value={newProduct.category} onChange={category => setNewProduct(p => ({ ...p, category }))} required />
            <Input label="Price (PHP)" type="number" value={newProduct.price} onChange={price => setNewProduct(p => ({ ...p, price }))} required min="1" step="1" />
            <Input label="Minimum Quantity" type="number" value={newProduct.minQty} onChange={minQty => setNewProduct(p => ({ ...p, minQty }))} required min="1" />
            <Input label="Unit Label" value={newProduct.unit} onChange={unit => setNewProduct(p => ({ ...p, unit }))} required />
            <Input label="Image Path or URL" value={newProduct.image} onChange={image => setNewProduct(p => ({ ...p, image }))} />
            <label>Specification type<select value={newProduct.specificationType} onChange={e => setNewProduct(p => ({ ...p, specificationType: e.target.value }))}>{['general','clothing','hoodie','schoolId','banner','mug','sticker','backdrop'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <label>Image fit<select value={newProduct.imageFit} onChange={e => setNewProduct(p => ({ ...p, imageFit: e.target.value }))}><option value="contain">Contain</option><option value="cover">Cover</option></select></label>
          </div>
          <label className="bm-product-description">Description<textarea required value={newProduct.description} onChange={e => setNewProduct(p => ({ ...p, description: e.target.value }))}/></label>
          <div className="bm-product-flags">
            <label><input type="checkbox" checked={newProduct.active} onChange={e => setNewProduct(p => ({ ...p, active: e.target.checked }))}/> Available to customers</label>
            <label><input type="checkbox" checked={newProduct.popular} onChange={e => setNewProduct(p => ({ ...p, popular: e.target.checked }))}/> Featured as popular</label>
            <label><input type="checkbox" checked={newProduct.trackStock} onChange={e => setNewProduct(p => ({ ...p, trackStock: e.target.checked }))}/> Track finished-product stock</label>
          </div>
          {newProduct.trackStock && <div className="bm-product-form-grid bm-product-stock-fields"><Input label="Stock" type="number" value={newProduct.stock} onChange={stock => setNewProduct(p => ({ ...p, stock }))} min="0"/><Input label="Low Stock Threshold" type="number" value={newProduct.lowStockThreshold} onChange={lowStockThreshold => setNewProduct(p => ({ ...p, lowStockThreshold }))} min="0"/></div>}
          <div className="bm-product-form-actions"><Btn type="submit" variant="primary">{editingProduct ? 'Save Changes' : 'Add Product'}</Btn><Btn variant="ghost" onClick={() => { setEditingProduct(null); setNewProduct(emptyProduct); setNewProductImage(null); }}>{editingProduct ? 'Cancel Edit' : 'Clear'}</Btn></div>
        </form>
      </Card>
      <Card className="bm-product-list-card">
        <div className="bm-product-list-head"><div><h4 style={cardTitle}>Product List ({products.length})</h4><p>Inactive products remain visible here but are excluded from customer ordering.</p></div><input type="search" value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder="Search products" aria-label="Search managed products"/></div>
        {productLoading ? <div className="bm-product-state">Loading products…</div> : productError ? <div className="bm-product-state is-error" role="alert">{productError}<button type="button" onClick={loadData}>Retry</button></div> : !products.length ? <div className="bm-product-state"><strong>No managed products yet.</strong><span>The seven legacy catalog products are ready for dry-run migration, pending approval.</span></div> : !filteredProducts.length ? <div className="bm-product-state">No products match this search.</div> : <div className="bm-product-table-wrap"><table><thead><tr>{['Product','Category','Price','Availability','Stock model','Actions'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{filteredProducts.map(product => <tr key={product.id}>
          <td><div className="bm-product-identity">{product.image ? <img src={publicAsset(product.image)} alt=""/> : <span className="bm-product-placeholder" aria-hidden="true"/>}<div><strong>{product.name}</strong><small>#{product.id} · min. {product.minQty} {product.unit}</small></div></div></td>
          <td>{product.category}</td><td><strong>{fmt(product.price)}</strong></td><td><Badge status={product.active ? 'Active' : 'Inactive'}/></td><td>{product.trackStock ? `${product.stock} available` : 'Made to order'}</td>
          <td><div className="bm-product-row-actions"><button type="button" onClick={() => edit(product)}>Edit</button><button type="button" onClick={() => handleDelete(product.id)}>{product.active ? 'Deactivate' : 'Activate'}</button>{product.trackStock && <><button type="button" aria-label={`Increase ${product.name} stock`} onClick={() => handleStock(product.id, 'increase')}>+</button><button type="button" aria-label={`Decrease ${product.name} stock`} onClick={() => handleStock(product.id, 'decrease')}>−</button></>}</div></td>
        </tr>)}</tbody></table></div>}
      </Card>
    </div>;
  };

  const renderInventory = () => (
    <div>
      <h3 style={sectionTitle}>Inventory Management</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 24 }}>
        <StatCard label="Total Products" value={products.length} color={C.info} />
        <StatCard label="In Stock" value={products.filter(p => p.trackStock === true && p.stock > p.lowStockThreshold).length} color={C.success} />
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
      <div className="bm-production-summary">
        {['Queued','In Production','Quality Check','Ready','Completed','Delayed'].map(s => (
          <Card className="bm-production-stat" key={s} style={{ '--production-color': ORDER_STATUS_COLORS[s]?.color || '#d8798a' }}>
            <div className="bm-production-stat__value">{prodCounts[s] || 0}</div>
            <div className="bm-production-stat__label">{s}</div>
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
                  <td style={tdStyle}>{p.assignedEmployeeName || (p.assignedEmployee ? 'Unknown employee' : 'Unassigned')}</td>
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

  const renderCustomers = () => <div className="bm-customer-directory">
    <div className="bm-customer-directory__heading"><div><span>Accounts</span><h3>Customers ({customersLoading ? '…' : customers.length})</h3><p>Registered and authenticated customers linked by account ID.</p></div>
      <div className="bm-customer-directory__tools"><input aria-label="Search customers" placeholder="Search name or email" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') loadData(); }}/><Btn variant="ghost" onClick={loadData}>Refresh</Btn></div>
    </div>
    {customersWarning && <p className="bm-customer-directory__warning" role="status">{customersWarning}</p>}
    {customersError && <div className="bm-product-state is-error" role="alert"><strong>Customer directory unavailable</strong><span>{customersError}</span><button type="button" onClick={loadData}>Retry</button></div>}
    {!customersError && <Card><div className="bm-customer-directory__table"><table><thead><tr>{['Customer','Contact','Account type','Role','Joined','Orders','Status'].map(heading => <th key={heading}>{heading}</th>)}</tr></thead><tbody>
      {customers.map(customer => <tr key={customer.id}><td><strong>{customer.name}</strong><small>{customer.id}</small></td><td><span>{customer.email || 'No email'}</span><small>{customer.phone || 'No phone recorded'}</small></td><td>{customer.accountType}</td><td><Badge status={customer.role || 'customer'} /></td><td>{fmtDate(customer.createdAt) || 'Not available'}</td><td>{customer.totalOrders}</td><td><span className={`bm-customer-status is-${String(customer.status || 'active').toLowerCase().replace(/\s+/g, '-')}`}>{customer.status || 'Active'}</span></td></tr>)}
      {!customersLoading && customers.length === 0 && <tr><td className="bm-customer-directory__empty" colSpan={7}>{searchQuery ? 'No customers match this search.' : 'No registered or order-linked customers exist.'}</td></tr>}
      {customersLoading && <tr><td className="bm-customer-directory__empty" colSpan={7}>Loading customer directory…</td></tr>}
    </tbody></table></div></Card>}
  </div>;

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
      <div className="bm-system-grid">
        {[
          ['Database', systemHealth?.database],
          ['API', systemHealth?.api],
          ['Storage', systemHealth?.storage],
          ['AI Service', systemHealth?.aiService],
          ['Payment Service', systemHealth?.paymentService],
          ['Excel Generator', systemHealth?.excelGenerator],
        ].map(([name, status]) => (
          <Card className="bm-system-card" key={name}>
            <div className="bm-system-card__name">{name}</div>
            <span className={`bm-system-status ${status === 'OK' ? 'is-ok' : status === 'Error' || status === 'Degraded' || status === 'disconnected' || status === 'Not configured' ? 'is-error' : status ? 'is-info' : 'is-loading'}`}>
              <i aria-hidden="true" />{status === 'OK' ? 'Operational' : status || 'Checking…'}
            </span>
          </Card>
        ))}
      </div>
    </div>
  );

  if (user?.role !== 'admin') return <div style={{ padding: 24 }}><StaffOrders user={user} showToast={notify} /></div>;

  return (
    <div className="bm-admin-shell">
      {sidebarOpen && <button className="bm-admin-sidebar-backdrop" type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <Sidebar tab={tab} onNavigate={navigateAdmin} sidebarOpen={sidebarOpen} />
      <div className="bm-admin-surface">
        <header className="bm-admin-topbar">
            <button className="bm-admin-menu" aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'} onClick={() => setSidebarOpen(!sidebarOpen)}><Icon name="menu" /></button>
            <h2>
              {SIDEBAR_ITEMS.find(i => i.id === tab)?.label || 'Dashboard'}
            </h2>
            <NotificationBell user={user} dark onNavigate={item => navigateAdmin(item.type === 'payment_submitted' ? 'payments' : item.relatedJobId ? 'jobs' : item.relatedOrderId ? 'orders' : 'dashboard')} />
            <div className="bm-admin-account" ref={accountMenuRef}>
              <button type="button" className="bm-admin-account-trigger" aria-haspopup="menu" aria-expanded={accountOpen} onClick={() => setAccountOpen(open => !open)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setAccountOpen(true); requestAnimationFrame(() => accountMenuRef.current?.querySelector('[role=menuitem]')?.focus()); } }}>
                <span className="bm-admin-avatar" aria-hidden="true">{user?.name?.[0] || user?.email?.[0] || 'A'}</span>
                <span className="bm-admin-account-copy"><strong>{user?.name || 'Administrator'}</strong><small>Administrator</small></span>
                <svg className="bm-admin-account-chevron" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 9l6 6 6-6"/></svg>
              </button>
              {accountOpen&&<div className="bm-admin-account-menu" role="menu"><button type="button" role="menuitem" onClick={() => { setAccountOpen(false); onLogout(); }}><svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H4V3h5M9 12h12m-4-4 4 4-4 4"/></svg>Logout</button></div>}
            </div>
        </header>
        <main className="bm-admin-content">
          {renderTab()}
        </main>
      </div>
    </div>
  );
}

const sectionTitle = { margin: '0 0 18px', fontFamily: 'Montserrat', fontWeight: 800, fontSize: 18, color: C.gray800 };
const cardTitle = { margin: '0 0 12px', fontFamily: 'Montserrat', fontWeight: 700, fontSize: 15, color: C.gray800 };
const tdStyle = { padding: '8px 10px', color: C.gray800 };
const actionBtn = { padding: '4px 8px', fontSize: 11, border: `1px solid ${C.gray200}`, borderRadius: 4, background: '#fff', cursor: 'pointer', color: C.gray600 };
