import React, { useState, useEffect } from 'react';
import { C } from '../../../../constants/colors';
import { showToast } from '../../../../utils/notifications';
import { Card, Btn, Input, Badge } from '../../../../components/Common';

const AdminPanel = () => {
  const [reportLoading, setReportLoading] = useState(false);
  const [reportSummary, setReportSummary] = useState(null);
  const [reportsExist, setReportsExist] = useState(false);
  const [reportDate, setReportDate] = useState(new Date());
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [inventoryVisible, setInventoryVisible] = useState(false);
  const [products, setProducts] = useState([]);
  const [editingProduct, setEditingProduct] = useState(null);
  const [newProduct, setNewProduct] = useState({
    name: '',
    category: '',
    description: '',
    price: '',
    stock: '',
    lowStockThreshold: '',
    status: 'Active',
    image: ''
  });
  const [newProductImage, setNewProductImage] = useState(null);

  const formatCurrency = (value) => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  useEffect(() => {
    fetchProducts();
    checkAdminRole();
  }, []);

  const checkAdminRole = async () => {
    try {
      const response = await fetch('/api/products', {
        headers: { "x-user-role": "admin" }
      });
      if (response.status === 403) {
        setInventoryVisible(false);
      } else {
        setInventoryVisible(true);
      }
    } catch (error) {
      setInventoryVisible(false);
    }
  };

  const fetchProducts = async () => {
    try {
      const response = await fetch('/api/products', {
        headers: { "x-user-role": "admin" }
      });
      if (!response.ok) throw new Error("Failed to fetch products.");
      const data = await response.json();
      setProducts(data.products);
    } catch (error) {
      console.error("Failed to fetch products:", error);
      showToast(error.message || "Failed to load products.", "error");
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setNewProduct(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const { name, category, description, price, stock, lowStockThreshold, status } = newProduct;
    if (!name || !category || !description || !price || stock === '' || lowStockThreshold === '') {
      showToast("All required fields must be filled.", "error");
      return;
    }
    if (isNaN(Number(price)) || Number(price) <= 0) {
      showToast("Price must be a positive number.", "error");
      return;
    }
    if (isNaN(Number(stock)) || Number(stock) < 0) {
      showToast("Stock must be a non-negative integer.", "error");
      return;
    }
    if (isNaN(Number(lowStockThreshold)) || Number(lowStockThreshold) < 0) {
      showToast("Low stock threshold must be a non-negative integer.", "error");
      return;
    }

    try {
      const response = await fetch('/api/products', {
        method: 'PATCH',
        headers: {
          "x-user-role": "admin",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          id: products.length > 0 ? Math.max(...products.map(p => p.id)) + 1 : 1,
          name,
          category,
          description,
          price: Number(price),
          stock: Number(stock),
          lowStockThreshold: Number(lowStockThreshold),
          status,
          image: newProduct.image
        })
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to add product.");
      }
      const data = await response.json();
      showToast("Product added successfully.", "success");
      fetchProducts();
      setNewProduct({
        name: '',
        category: '',
        description: '',
        price: '',
        stock: '',
        lowStockThreshold: '',
        status: 'Active'
      });
    } catch (error) {
      console.error("Add product failed:", error);
      showToast(error.message || "Failed to add product.", "error");
    }
  };

  const handleEdit = (productId) => {
    const product = products.find(p => p.id === Number(productId));
    if (!product) return;
    setEditingProduct(product.id);
    setNewProduct({
      name: product.name,
      category: product.category,
      description: product.description,
      price: product.price,
      stock: product.stock,
      lowStockThreshold: product.lowStockThreshold,
      status: product.status || 'Active',
      image: product.image || ''
    });
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingProduct) return;
    
    const product = products.find(p => p.id === editingProduct);
    if (!product) return;

    const { name, category, description, price, stock, lowStockThreshold, status, image } = newProduct;
    if (!name || !category || !description || !price || stock === '' || lowStockThreshold === '') {
      showToast("All required fields must be filled.", "error");
      return;
    }
    if (isNaN(Number(price)) || Number(price) <= 0) {
      showToast("Price must be a positive number.", "error");
      return;
    }
    if (isNaN(Number(stock)) || Number(stock) < 0) {
      showToast("Stock must be a non-negative integer.", "error");
      return;
    }
    if (isNaN(Number(lowStockThreshold)) || Number(lowStockThreshold) < 0) {
      showToast("Low stock threshold must be a non-negative integer.", "error");
      return;
    }

    try {
      const response = await fetch(`/api/products/${editingProduct}`, {
        method: 'PATCH',
        headers: {
          "x-user-role": "admin",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name,
          category,
          description,
          price: Number(price),
          stock: Number(stock),
          lowStockThreshold: Number(lowStockThreshold),
          status,
          image
        })
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to update product.");
      }
      const data = await response.json();
      showToast("Product updated successfully.", "success");
      fetchProducts();
      setEditingProduct(null);
      setNewProduct({
        name: '',
        category: '',
        description: '',
        price: '',
        stock: '',
        lowStockThreshold: '',
        status: 'Active',
        image: ''
      });
    } catch (error) {
      console.error("Edit product failed:", error);
      showToast(error.message || "Failed to update product.", "error");
    }
  };

  const handleDelete = async (productId) => {
    if (!confirm("Are you sure you want to delete this product?")) return;
    
    try {
      const response = await fetch(`/api/products/${productId}`, {
        method: 'PATCH',
        headers: {
          "x-user-role": "admin",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ active: false })
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to archive product.");
      }
      const data = await response.json();
      showToast("Product archived (set to inactive).", "success");
      fetchProducts();
    } catch (error) {
      console.error("Archive product failed:", error);
      showToast(error.message || "Failed to archive product.", "error");
    }
  };

  const handleStockIncrease = async (productId) => {
    try {
      const response = await fetch(`/api/products/${productId}/stock/increase`, {
        method: 'PATCH',
        headers: { "x-user-role": "admin" }
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to increase stock.");
      }
      const data = await response.json();
      showToast("Stock increased.", "success");
      fetchProducts();
    } catch (error) {
      console.error("Stock increase failed:", error);
      showToast(error.message || "Failed to increase stock.", "error");
    }
  };

  const handleStockDecrease = async (productId) => {
    try {
      const response = await fetch(`/api/products/${productId}/stock/decrease`, {
        method: 'PATCH',
        headers: { "x-user-role": "admin" }
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to decrease stock.");
      }
      const data = await response.json();
      showToast("Stock decreased.", "success");
      fetchProducts();
    } catch (error) {
      console.error("Stock decrease failed:", error);
      showToast(error.message || "Failed to decrease stock.", "error");
    }
  };

  return (
    <div className="admin-panel">
      <h2>Admin Dashboard</h2>
      
      <nav>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              cursor: 'pointer',
              flexShrink: 0
            }}
            onClick={() => setPage('home')}
          >
            <BMLogo size={44} />
            <div>
              <div
                style={{
                  fontFamily: 'Montserrat',
                  fontWeight: 800,
                  fontSize: 16,
                  color: C.red,
                  lineHeight: 1.1
                }}
              >
                BM PRINTING
              </div>
              <div style={{ fontSize: 10, color: C.gray600, letterSpacing: 1 }}>
                SERVICES
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            {user ? (
              <>
                {user.role === 'admin' && (
                  <button
                    onClick={() => setPage('admin')}
                    style={{
                      padding: '8px 12px',
                      background: page === 'admin' ? C.black : 'transparent',
                      color: page === 'admin' ? '#fff' : C.gray600,
                      border: `1px solid ${C.gray200}`,
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    ⚙ Admin
                  </button>
                )}
                <button
                  onClick={() => setPage('myorders')}
                  style={{
                    padding: '8px 12px',
                    background: 'transparent',
                    color: C.gray600,
                    border: `1px solid ${C.gray200}`,
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  📦 My Orders
                </button>
                <button
                  onClick={() => setPage('profile')}
                  style={{
                    padding: '8px 12px',
                    background: 'transparent',
                    color: C.gray600,
                    border: `1px solid ${C.gray200}`,
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  👤 {user.name.split(' ')[0]}
                </button>
                <Btn size='sm' variant='ghost' onClick={onLogout}>
                  Logout
                </Btn>
              </>
            ) : (
              <>
                <Btn size='sm' variant='ghost' onClick={() => setPage('login')}>
                  Login
                </Btn>
                <Btn size='sm' variant='primary' onClick={() => setPage('register')}>
                  Register
                </Btn>
              </>
            )}
          </div>
        </div>
      </nav>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 24px' }}>
        {/* Daily Report */}
        <Card>
          <h3 style={{ margin: '0 0 16px 0', fontFamily: 'Montserrat', fontWeight: 800, fontSize: 18, color: C.gray800 }}>
            Daily Report
          </h3>
          <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
            <label style={{ fontSize: 14, color: C.gray600 }}>
              Date
            </label>
            <input
              type="date"
              value={reportDate}
              onChange={(e) => setReportDate(new Date(e.target.value))}
              disabled={reportLoading}
              style={{
                padding: '8px 14px',
                border: `1.5px solid ${C.gray200}`,
                borderRadius: 8,
                fontSize: 14,
                minWidth: 200
              }}
            />
            <button onClick={() => loadReport(reportDate)} disabled={reportLoading}>
              {reportLoading ? "Loading..." : "Load Report"}
            </button>
          </div>
          
          {reportsExist && reportSummary && (
            <div style={{ background: C.gray50, borderRadius: 8, padding: 20 }}>
              <div className="summary-grid">
                <div className="summary-item">
                  <div className="summary-value">{reportSummary.totalOrders}</div>
                  <div className="summary-label">Total Orders</div>
                </div>
                <div className="summary-item">
                  <div className="summary-value">{formatCurrency(reportSummary.totalSales)}</div>
                  <div className="summary-label">Total Revenue</div>
                </div>
                <div className="summary-item">
                  <div className="summary-value">{reportSummary.completedOrders}</div>
                  <div className="summary-label">Completed</div>
                </div>
                <div className="summary-item">
                  <div className="summary-value">{reportSummary.pendingOrders}</div>
                  <div className="summary-label">Pending</div>
                </div>
                <div className="summary-item">
                  <div className="summary-value">{reportSummary.cancelledOrders}</div>
                  <div className="summary-label">Cancelled</div>
                </div>
              </div>
              
              <div className="detail-row">
                <div className="detail-label">Average Order Value</div>
                <div className="detail-value">{formatCurrency(reportSummary.averageOrderValue)}</div>
              </div>
              
              {reportSummary.topService && (
                <div className="detail-row">
                  <div className="detail-label">Top Service</div>
                  <div className="detail-value">{reportSummary.topService}</div>
                </div>
              )}
            </div>
          )}

          {!reportsExist && (
            <Card style={{ padding: 20, textAlign: 'center', color: C.gray600 }}>
              <p>No reports found for the selected date.</p>
            </Card>
          )}
        </Card>

        {/* System Status */}
        <Card>
          <h3 style={{ margin: '0 0 16px 0', fontFamily: 'Montserrat', fontWeight: 800, fontSize: 18, color: C.gray800 }}>
            System Status
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, textAlign: 'center' }}>
            <div style={{ 
              padding: '12px 8px', 
              borderRadius: 8, 
              background: C.gray50,
              minHeight: 50,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              Database
              <span style={{ marginLeft: 8, color: C.success, fontWeight: 700 }}>● OK</span>
            </div>
            <div style={{ 
              padding: '12px 8px', 
              borderRadius: 8, 
              background: C.gray50,
              minHeight: 50,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              API
              <span style={{ marginLeft: 8, color: C.success, fontWeight: 700 }}>● OK</span>
            </div>
            <div style={{ 
              padding: '12px 8px', 
              borderRadius: 8, 
              background: C.gray50,
              minHeight: 50,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              AI Service
              <span style={{ marginLeft: 8, color: C.success, fontWeight: 700 }}>● OK</span>
            </div>
            <div style={{ 
              padding: '12px 8px', 
              borderRadius: 8, 
              background: C.gray50,
              minHeight: 50,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              Payment Service
              <span style={{ marginLeft: 8, color: C.success, fontWeight: 700 }}>● OK</span>
            </div>
            <div style={{ 
              padding: '12px 8px', 
              borderRadius: 8, 
              background: C.gray50,
              minHeight: 50,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              Excel Generator
              <span style={{ marginLeft: 8, color: C.success, fontWeight: 700 }}>● OK</span>
            </div>
          </div>
        </Card>

        {/* Inventory Management */}
        <Card>
          <h3 style={{ margin: '0 0 20px 0', fontFamily: 'Montserrat', fontWeight: 800, fontSize: 18, color: C.gray800 }}>
            Inventory Management
          </h3>
          
          {inventoryVisible ? (
            <div>
              <h4>Add Product</h4>
              <form onSubmit={handleSubmit}>
                <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                  <Input
                    label="Product Name"
                    name="name"
                    value={newProduct.name}
                    onChange={handleChange}
                    required
                  />
                  <Input
                    label="Category"
                    name="category"
                    value={newProduct.category}
                    onChange={handleChange}
                    required
                  />
                </div>
                <Input
                  label="Description"
                  name="description"
                  value={newProduct.description}
                  onChange={handleChange}
                  required
                />
                <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                  <Input
                    label="Price"
                    name="price"
                    type="number"
                    value={newProduct.price}
                    onChange={handleChange}
                    required
                    min="0"
                  />
                  <Input
                    label="Initial Stock"
                    name="stock"
                    type="number"
                    value={newProduct.stock}
                    onChange={handleChange}
                    required
                    min="0"
                  />
                </div>
<div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                  <Input
                    label="Low Stock Threshold"
                    name="lowStockThreshold"
                    type="number"
                    value={newProduct.lowStockThreshold}
                    onChange={handleChange}
                    required
                    min="0"
                  />
                </div>

                {newProductImage && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, color: C.gray600, marginBottom: 4 }}>
                      Current image: {newProductImage.originalName}
                    </div>
                    <img
                      src={newProductImage.base64}
                      alt="Product preview"
                      style={{
                        maxWidth: 150,
                        maxHeight: 150,
                        borderRadius: 4,
                        objectFit: "contain",
                        border: `1px solid ${C.gray200}`
                      }}
                    />
                    <Btn
                      variant="ghost"
                      size="sm"
                      onClick={() => setNewProductImage(null)}
                      style={{ marginTop: 4, background: "none" }}
                    >
                      Remove
                    </Btn>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <Input
                    type="file"
                    name="image"
                    accept=".jpg,.jpeg,.png,.webp"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.readAsDataURL(file);
                      reader.onload = () => {
                        setNewProductImage({ base64: reader.result, originalName: file.name });
                        setNewProduct(prev => ({ ...prev, image: reader.result }));
                      };
                      reader.onerror = () => showToast("Failed to read file.", "error");
                    }}
                  />
                  <Btn
                    variant="ghost"
                    size="sm"
                    style={{ marginTop: 4, width: 120 }}
                  >
                    Upload Image
                  </Btn>
                </div>
                <select
                    name="status"
                    value={newProduct.status}
                    onChange={e => setNewProduct(prev => ({ ...prev, status: e.target.value }))}
                    style={{
                      padding: '10px 14px',
                      border: `1.5px solid ${C.gray200}`,
                      borderRadius: 8,
                      fontSize: 14,
                      background: C.white,
                      minWidth: 200
                    }}
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                  <Btn type="submit" variant="primary">
                    Add Product
                  </Btn>
                  <Btn variant="ghost" onClick={() => setNewProduct({
                    name: '',
                    category: '',
                    description: '',
                    price: '',
                    stock: '',
                    lowStockThreshold: '',
                    status: 'Active'
                  })}>
                    Cancel
                  </Btn>
                </div>
              </form>

              <h4>Inventory List</h4>
              {products.length === 0 ? (
                <Card style={{ padding: 30, textAlign: 'center', color: C.gray600 }}>
                  <p>No products in inventory.</p>
                  <Btn variant="primary" onClick={() => setPage('admin')}>
                    + Add Product
                  </Btn>
                </Card>
              ) : (
                <div style={{ 
                  maxHeight: 500, 
                  overflowY: 'auto',
                  marginTop: 20
                }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #dee2e6' }}>
                        <th style={{ padding: '8px', textAlign: 'left', color: C.gray800 }}><div style={{ fontWeight: 600 }}>Product</div></th>
                        <th style={{ padding: '8px', textAlign: 'left', color: C.gray800 }}><div style={{ fontWeight: 600 }}>Category</div></th>
                        <th style={{ padding: '8px', textAlign: 'left', color: C.gray800 }}><div style={{ fontWeight: 600 }}>Price</div></th>
                        <th style={{ padding: '8px', textAlign: 'left', color: C.gray800 }}><div style={{ fontWeight: 600 }}>Stock</div></th>
                        <th style={{ padding: '8px', textAlign: 'left', color: C.gray800 }}><div style={{ fontWeight: 600 }}>Low Stock</div></th>
                        <th style={{ padding: '8px', textAlign: 'left', color: C.gray800 }}><div style={{ fontWeight: 600 }}>Status</div></th>
                        <th style={{ padding: '8px', textAlign: 'left', color: C.gray800 }}><div style={{ fontWeight: 600 }}>Actions</div></th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.map((product) => (
                        <tr key={product.id} style={{ borderBottom: '1px solid #eee' }}>
<td style={{ padding: '8px' }}>
                          {product.image && (
                            <img
                              src={product.image}
                              alt="Product"
                              style={{
                                width: 40,
                                height: 40,
                                borderRadius: 4,
                                objectFit: "contain",
                                marginRight: 8
                              }}
                            />
                          )}
                          {product.name}
                        </td>
                           <td style={{ padding: '8px' }}>{product.category}</td>
                          <td style={{ padding: '8px' }}>{formatCurrency(product.price)}</td>
                          <td style={{ padding: '8px' }}>
                            {product.stock}
                            <div style={{ marginTop: '4px', fontSize: '0.8em', color: '#666' }}>
                              Threshold: {product.lowStockThreshold}
                            </div>
                          </td>
                          <td style={{ padding: '8px' }}>
                            <Badge status={product.status || 'In Stock'} />
                          </td>
                          <td style={{ padding: '8px' }}>
                            <button
                              onClick={() => handleStockIncrease(product.id)}
                              style={{ marginRight: '4px', padding: '4px 8px' }}
                            >
                              +
                            </button>
                            <button
                              onClick={() => handleStockDecrease(product.id)}
                              style={{ marginRight: '4px', padding: '4px 8px' }}
                            >
                              -
                            </button>
                            <button
                              onClick={() => handleEdit(product.id)}
                              style={{ marginRight: '4px', padding: '4px 8px' }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(product.id)}
                              style={{ padding: '4px 8px' }}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <p>Only administrators can access inventory management.</p>
          )}
        </Card>
      </div>
    </div>
  );
};

export default AdminPanel;