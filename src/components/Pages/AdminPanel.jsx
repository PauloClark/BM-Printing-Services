import { useState, useEffect } from "react";
import { C } from "../../constants/colors";
import { PRODUCTS, STATUS_LIST, STATUS_COLORS } from "../../constants/products";
import { store } from "../../utils/storage";
import { Card } from "../Common/Card";
import { Btn } from "../Common/Btn";
import { Badge } from "../Common/Badge";
import { Modal } from "../Common/Modal";
import { BMLogo } from "../Common/BMLogo";

export const AdminPanel = ({ orders, setOrders, showToast }) => {
  const [tab, setTab] = useState("dashboard");
  const [filterStatus, setFilterStatus] = useState("All");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [users, setUsers] = useState([]);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [reportSummary, setReportSummary] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setMessages((await store.get("messages")) || []);
      setReviews((await store.get("reviews")) || []);
      const keys = await store.list("user:");
      const us = [];
      for (const k of keys) {
        const u = await store.get(k);
        if (u) us.push(u);
      }
      setUsers(us);
    })();
  }, [tab]);

  useEffect(() => {
    (async () => {
      if (tab !== "dashboard") return;
      try {
        setReportLoading(true);
        const response = await fetch(`/api/admin/reports/orders?date=${reportDate}`, {
          headers: { "x-user-role": "admin" }
        });
        const data = await response.json();
        setReportSummary(data);
      } catch (error) {
        console.error("Report load failed:", error);
      } finally {
        setReportLoading(false);
      }
    })();
  }, [tab, reportDate]);

  const totalRev = orders
    .filter(o => o.status === "Completed")
    .reduce((s, o) => s + (o.total || 0), 0);
  const pending = orders.filter(o => o.status === "Pending").length;
  const inProd = orders.filter(o => o.status === "In Production").length;

  const updateStatus = async (id, status) => {
    const updated = orders.map(o =>
      o.id === id ? { ...o, status } : o
    );
    setOrders(updated);
    if (selected?.id === id) setSelected(prev => ({ ...prev, status }));

    try {
      await fetch(`/api/orders/${id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-user-role": "admin"
        },
        body: JSON.stringify({ status })
      });
    } catch (error) {
      console.error("Status sync failed:", error);
    }

    await store.set("orders", updated);
    showToast(`Status updated to "${status}"`, "success");
  };

  const deleteOrder = async (id) => {
    const updated = orders.filter(o => o.id !== id);
    setOrders(updated);
    await store.set("orders", updated);
    setSelected(null);
    setDeleteConfirm(null);

    try {
      await fetch(`/api/orders/${id}`, {
        method: "DELETE",
        headers: { "x-user-role": "admin" }
      });
    } catch (error) {
      console.error("Delete sync failed:", error);
    }

    showToast("Order deleted.", "info");
  };

  const filteredOrders = orders.filter(
    o =>
      (filterStatus === "All" || o.status === filterStatus) &&
      (search === "" ||
        o.customer?.toLowerCase().includes(search.toLowerCase()) ||
        o.id.toLowerCase().includes(search.toLowerCase()) ||
        o.product?.toLowerCase().includes(search.toLowerCase()))
  );

  const stats = [
    {
      label: "Total Orders",
      value: orders.length,
      icon: "📦",
      color: C.info
    },
    { label: "Pending", value: pending, icon: "⏳", color: C.warning },
    {
      label: "In Production",
      value: inProd,
      icon: "⚙️",
      color: "#0277bd"
    },
    {
      label: "Revenue (Completed)",
      value: `₱${totalRev.toLocaleString()}`,
      icon: "💰",
      color: C.success
    }
  ];

  const tabs = [
    ["dashboard", "📊 Dashboard"],
    ["orders", "📦 Orders"],
    ["products", "🛍️ Products"],
    ["customers", "👥 Customers"],
    ["messages", "📬 Messages"],
    ["reviews", "⭐ Reviews"]
  ];

  return (
    <div style={{ display: "flex", minHeight: "calc(100vh - 64px)" }}>
      <div
        style={{
          width: 220,
          background: C.black,
          flexShrink: 0,
          padding: "24px 0"
        }}
      >
        <div
          style={{
            padding: "0 20px 20px",
            borderBottom: "1px solid rgba(255,255,255,0.1)",
            marginBottom: 8
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <BMLogo size={32} />
            <div
              style={{
                color: "#fff",
                fontFamily: "Montserrat",
                fontWeight: 700,
                fontSize: 13
              }}
            >
              BM Admin
            </div>
          </div>
        </div>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              width: "100%",
              padding: "12px 20px",
              background: tab === id ? C.red : "transparent",
              color: tab === id ? "#fff" : "rgba(255,255,255,0.7)",
              border: "none",
              textAlign: "left",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "Montserrat",
              transition: "all 0.2s"
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        style={{
          flex: 1,
          padding: 28,
          background: C.gray50,
          overflow: "auto"
        }}
      >
        {/* DASHBOARD */}
        {tab === "dashboard" && (
          <div className="fade-in">
            <h2
              style={{
                fontFamily: "Montserrat",
                fontWeight: 800,
                fontSize: 24,
                marginBottom: 24
              }}
            >
              Dashboard Overview
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 16,
                marginBottom: 28
              }}
            >
              {stats.map(s => (
                <Card key={s.label}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start"
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 12,
                          color: C.gray400,
                          fontWeight: 600,
                          marginBottom: 4
                        }}
                      >
                        {s.label}
                      </div>
                      <div
                        style={{
                          fontFamily: "Montserrat",
                          fontWeight: 800,
                          fontSize: 26,
                          color: s.color
                        }}
                      >
                        {s.value}
                      </div>
                    </div>
                    <span style={{ fontSize: 28 }}>{s.icon}</span>
                  </div>
                </Card>
              ))}
            </div>

            <Card style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 12, color: C.gray400, fontWeight: 700, marginBottom: 4 }}>Daily Order Reports</div>
                  <div style={{ fontFamily: "Montserrat", fontWeight: 700, fontSize: 18 }}>
                    {reportLoading ? "Loading report..." : reportSummary ? `${reportSummary.date} • ${reportSummary.totalOrders} orders` : "No report loaded"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input
                    type="date"
                    value={reportDate}
                    onChange={e => setReportDate(e.target.value)}
                    style={{ border: `1px solid ${C.gray200}`, borderRadius: 8, padding: "8px 10px" }}
                  />
                  <button
                    onClick={async () => {
                      try {
                        const response = await fetch(`/api/admin/reports/orders/${reportDate}/regenerate`, {
                          method: "POST",
                          headers: { "x-user-role": "admin" }
                        });
                        const data = await response.json();
                        if (!response.ok) throw new Error(data.error || "Unable to regenerate report.");
                        setReportSummary(prev => prev ? { ...prev, exists: true, totalOrders: data.totalOrders, totalSales: data.totalSales } : data);
                        showToast("Excel report regenerated from MongoDB.", "success");
                      } catch (error) {
                        showToast(error.message || "Unable to regenerate report.", "error");
                      }
                    }}
                    style={{ background: C.red, color: "#fff", border: "none", borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontWeight: 700 }}
                  >
                    Regenerate Report
                  </button>
                  <a
                    href={reportSummary?.downloadUrl || "#"}
                    target="_blank"
                    rel="noreferrer"
                    style={{ background: C.black, color: "#fff", borderRadius: 8, padding: "8px 12px", textDecoration: "none", fontWeight: 700 }}
                  >
                    Download Excel
                  </a>
                </div>
              </div>
              {reportSummary && (
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 12, color: C.gray600 }}>
                  <span><strong>{reportSummary.totalOrders}</strong> orders</span>
                  <span><strong>₱{Number(reportSummary.totalSales || 0).toLocaleString()}</strong> total sales</span>
                  <span>{reportSummary.exists ? "Report file available" : "Report will be created on regenerate"}</span>
                </div>
              )}
            </Card>

            {/* Charts */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 20,
                marginBottom: 24
              }}
            >
              <Card>
                <h3
                  style={{
                    fontFamily: "Montserrat",
                    fontWeight: 700,
                    fontSize: 16,
                    marginBottom: 16
                  }}
                >
                  Orders by Status
                </h3>
                {STATUS_LIST.map(s => {
                  const count = orders.filter(o => o.status === s).length;
                  const pct = orders.length
                    ? Math.round((count / orders.length) * 100)
                    : 0;
                  return (
                    <div key={s} style={{ marginBottom: 10 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 12,
                          marginBottom: 4
                        }}
                      >
                        <span>{s}</span>
                        <span style={{ fontWeight: 700 }}>{count}</span>
                      </div>
                      <div
                        style={{
                          height: 6,
                          background: C.gray100,
                          borderRadius: 3
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${pct}%`,
                            background:
                              STATUS_COLORS[s]?.color || C.red,
                            borderRadius: 3,
                            transition: "width 0.5s ease"
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </Card>

              <Card>
                <h3
                  style={{
                    fontFamily: "Montserrat",
                    fontWeight: 700,
                    fontSize: 16,
                    marginBottom: 16
                  }}
                >
                  Top Products
                </h3>
                {(() => {
                  const counts = {};
                  orders.forEach(o => {
                    counts[o.product] = (counts[o.product] || 0) + 1;
                  });
                  return Object.entries(counts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([name, count]) => {
                      const prod = PRODUCTS.find(p => p.name === name);
                      return (
                        <div
                          key={name}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            marginBottom: 10
                          }}
                        >
                          <span style={{ fontSize: 20 }}>
                            {prod?.image || "📦"}
                          </span>
                          <div style={{ flex: 1 }}>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 600
                              }}
                            >
                              {name}
                            </div>
                            <div
                              style={{
                                height: 4,
                                background: C.gray100,
                                borderRadius: 2,
                                marginTop: 4
                              }}
                            >
                              <div
                                style={{
                                  height: "100%",
                                  width: `${(count / orders.length) * 100}%`,
                                  background: C.red,
                                  borderRadius: 2
                                }}
                              />
                            </div>
                          </div>
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: C.red
                            }}
                          >
                            {count}
                          </span>
                        </div>
                      );
                    });
                })()}
              </Card>
            </div>

            <h3
              style={{
                fontFamily: "Montserrat",
                fontWeight: 700,
                fontSize: 18,
                marginBottom: 16
              }}
            >
              Recent Orders
            </h3>
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: C.gray50,
                      borderBottom: `1px solid ${C.gray200}`
                    }}
                  >
                    {["Order ID", "Customer", "Product", "Total", "Status", "Date"].map(
                      h => (
                        <th
                          key={h}
                          style={{
                            padding: "12px 16px",
                            textAlign: "left",
                            fontWeight: 700,
                            color: C.gray600
                          }}
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {orders.slice(0, 8).map(o => (
                    <tr
                      key={o.id}
                      style={{
                        borderBottom: `1px solid ${C.gray100}`
                      }}
                    >
                      <td
                        style={{
                          padding: "12px 16px",
                          fontFamily: "Montserrat",
                          fontWeight: 700,
                          color: C.red,
                          fontSize: 12
                        }}
                      >
                        {o.id}
                      </td>
                      <td style={{ padding: "12px 16px" }}>{o.customer}</td>
                      <td
                        style={{
                          padding: "12px 16px",
                          color: C.gray600
                        }}
                      >
                        {o.product?.slice(0, 22)}...
                      </td>
                      <td
                        style={{
                          padding: "12px 16px",
                          fontWeight: 700
                        }}
                      >
                        ₱{o.total?.toLocaleString()}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <Badge status={o.status} />
                      </td>
                      <td
                        style={{
                          padding: "12px 16px",
                          color: C.gray400
                        }}
                      >
                        {o.date}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        )}

        {/* ORDERS - Large section, simplified for brevity */}
        {tab === "orders" && (
          <div className="fade-in">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 20
              }}
            >
              <h2
                style={{
                  fontFamily: "Montserrat",
                  fontWeight: 800,
                  fontSize: 24
                }}
              >
                Order Management
              </h2>
              <div
                style={{
                  fontSize: 13,
                  color: C.gray400
                }}
              >
                {filteredOrders.length} orders
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: 12,
                marginBottom: 20,
                flexWrap: "wrap"
              }}
            >
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="🔍 Search orders..."
                style={{
                  padding: "8px 14px",
                  border: `1.5px solid ${C.gray200}`,
                  borderRadius: 8,
                  fontSize: 13,
                  flex: 1,
                  minWidth: 200
                }}
              />
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                style={{
                  padding: "8px 14px",
                  border: `1.5px solid ${C.gray200}`,
                  borderRadius: 8,
                  fontSize: 13,
                  background: C.white
                }}
              >
                {["All", ...STATUS_LIST].map(s => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: selected
                  ? "1fr 380px"
                  : "1fr",
                gap: 20
              }}
            >
              <Card style={{ padding: 0, overflow: "hidden" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 13
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        background: C.gray50,
                        borderBottom: `1px solid ${C.gray200}`
                      }}
                    >
                      {["Order ID", "Customer", "Product", "Qty", "Total", "Status", "Date", "Actions"].map(
                        h => (
                          <th
                            key={h}
                            style={{
                              padding: "10px 14px",
                              textAlign: "left",
                              fontWeight: 700,
                              color: C.gray600,
                              whiteSpace: "nowrap"
                            }}
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.map(o => (
                      <tr
                        key={o.id}
                        onClick={() =>
                          setSelected(o === selected ? null : o)
                        }
                        style={{
                          borderBottom: `1px solid ${C.gray100}`,
                          cursor: "pointer",
                          background:
                            selected?.id === o.id
                              ? "#fff8f8"
                              : "white"
                        }}
                      >
                        <td
                          style={{
                            padding: "10px 14px",
                            fontFamily: "Montserrat",
                            fontWeight: 700,
                            color: C.red,
                            fontSize: 12
                          }}
                        >
                          {o.id}
                        </td>
                        <td
                          style={{
                            padding: "10px 14px",
                            fontWeight: 500
                          }}
                        >
                          {o.customer}
                        </td>
                        <td
                          style={{
                            padding: "10px 14px",
                            color: C.gray600,
                            maxWidth: 140,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap"
                          }}
                        >
                          {o.product}
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          {o.quantity}
                        </td>
                        <td
                          style={{
                            padding: "10px 14px",
                            fontWeight: 700
                          }}
                        >
                          ₱{o.total?.toLocaleString()}
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <Badge status={o.status} />
                        </td>
                        <td
                          style={{
                            padding: "10px 14px",
                            color: C.gray400
                          }}
                        >
                          {o.date}
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <select
                            value={o.status}
                            onChange={e => {
                              e.stopPropagation();
                              updateStatus(o.id, e.target.value);
                            }}
                            style={{
                              padding: "4px 8px",
                              border: `1px solid ${C.gray200}`,
                              borderRadius: 6,
                              fontSize: 12,
                              background: C.white
                            }}
                            onClick={e => e.stopPropagation()}
                          >
                            {STATUS_LIST.map(s => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredOrders.length === 0 && (
                  <div
                    style={{
                      textAlign: "center",
                      padding: 40,
                      color: C.gray400
                    }}
                  >
                    No orders found.
                  </div>
                )}
              </Card>
              {selected && (
                <Card className="fade-in">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 16
                    }}
                  >
                    <h3
                      style={{
                        fontFamily: "Montserrat",
                        fontWeight: 700,
                        fontSize: 15
                      }}
                    >
                      Order Details
                    </h3>
                    <button
                      onClick={() => setSelected(null)}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 18,
                        color: C.gray400
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                      fontSize: 13
                    }}
                  >
                    {[
                      ["ID", selected.id],
                      ["Customer", selected.customer],
                      ["Email", selected.email],
                      ["Phone", selected.phone],
                      ["Product", selected.product],
                      ["Quantity", `${selected.quantity} pcs`],
                      ["Payment", selected.payment],
                      ["Total", `₱${selected.total?.toLocaleString()}`],
                      ["Date", selected.date]
                    ].map(([k, v]) => (
                      <div
                        key={k}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          borderBottom: `1px solid ${C.gray100}`,
                          paddingBottom: 8
                        }}
                      >
                        <span style={{ color: C.gray400 }}>{k}</span>
                        <span
                          style={{
                            fontWeight: 500,
                            textAlign: "right",
                            maxWidth: 200,
                            wordBreak: "break-all"
                          }}
                        >
                          {v}
                        </span>
                      </div>
                    ))}
                    {selected.specs && (
                      <div
                        style={{
                          background: C.gray50,
                          borderRadius: 8,
                          padding: 10
                        }}
                      >
                        <strong style={{ fontSize: 12 }}>Specs:</strong>
                        <p
                          style={{
                            marginTop: 4,
                            color: C.gray600
                          }}
                        >
                          {selected.specs}
                        </p>
                      </div>
                    )}
                    {selected.design && (
                      <div
                        style={{
                          background: C.gray50,
                          borderRadius: 8,
                          padding: 10
                        }}
                      >
                        <strong style={{ fontSize: 12 }}>Design:</strong>
                        <p
                          style={{
                            marginTop: 4,
                            color: C.gray600
                          }}
                        >
                          {selected.design}
                        </p>
                      </div>
                    )}
                    {selected.notes && (
                      <div
                        style={{
                          background: C.warningBg,
                          borderRadius: 8,
                          padding: 10
                        }}
                      >
                        <strong style={{ fontSize: 12 }}>Notes:</strong>
                        <p
                          style={{
                            marginTop: 4,
                            color: C.warning
                          }}
                        >
                          {selected.notes}
                        </p>
                      </div>
                    )}
                    <div style={{ marginTop: 8 }}>
                      <label
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: C.gray600,
                          display: "block",
                          marginBottom: 6
                        }}
                      >
                        Update Status
                      </label>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 6
                        }}
                      >
                        {STATUS_LIST.map(s => (
                          <button
                            key={s}
                            onClick={() =>
                              updateStatus(selected.id, s)
                            }
                            style={{
                              padding: "5px 10px",
                              borderRadius: 6,
                              border: `1px solid ${
                                selected.status === s
                                  ? C.red
                                  : C.gray200
                              }`,
                              background:
                                selected.status === s
                                  ? C.red
                                  : "white",
                              color:
                                selected.status === s
                                  ? "#fff"
                                  : C.gray600,
                              fontSize: 11,
                              fontWeight: 600,
                              cursor: "pointer"
                            }}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                    <Btn
                      variant="danger"
                      size="sm"
                      onClick={() => setDeleteConfirm(selected.id)}
                      style={{ marginTop: 8 }}
                    >
                      🗑 Delete Order
                    </Btn>
                  </div>
                </Card>
              )}
            </div>
          </div>
        )}

        {/* PRODUCTS */}
        {tab === "products" && (
          <div className="fade-in">
            <h2
              style={{
                fontFamily: "Montserrat",
                fontWeight: 800,
                fontSize: 24,
                marginBottom: 20
              }}
            >
              Product Catalog
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: 16
              }}
            >
              {PRODUCTS.map(p => (
                <Card key={p.id}>
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "flex-start"
                    }}
                  >
                    <span style={{ fontSize: 32 }}>{p.image}</span>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: 10,
                          color: C.red,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: 0.5
                        }}
                      >
                        {p.category}
                      </div>
                      <div
                        style={{
                          fontFamily: "Montserrat",
                          fontWeight: 700,
                          fontSize: 14,
                          marginTop: 2
                        }}
                      >
                        {p.name}
                      </div>
                      <div
                        style={{
                          fontFamily: "Montserrat",
                          fontWeight: 800,
                          fontSize: 18,
                          color: C.red,
                          marginTop: 4
                        }}
                      >
                        ₱{p.price.toLocaleString()}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: C.gray400
                        }}
                      >
                        {p.unit} · min. {p.minQty}
                      </div>
                    </div>
                    {p.popular && (
                      <span
                        style={{
                          background: C.red,
                          color: "#fff",
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 10
                        }}
                      >
                        HOT
                      </span>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* CUSTOMERS */}
        {tab === "customers" && (
          <div className="fade-in">
            <h2
              style={{
                fontFamily: "Montserrat",
                fontWeight: 800,
                fontSize: 24,
                marginBottom: 20
              }}
            >
              Customer Management
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3,1fr)",
                gap: 16,
                marginBottom: 24
              }}
            >
              <Card>
                <div
                  style={{
                    fontSize: 12,
                    color: C.gray400,
                    marginBottom: 4
                  }}
                >
                  Registered Users
                </div>
                <div
                  style={{
                    fontFamily: "Montserrat",
                    fontWeight: 800,
                    fontSize: 28,
                    color: C.info
                  }}
                >
                  {users.length}
                </div>
              </Card>
              <Card>
                <div
                  style={{
                    fontSize: 12,
                    color: C.gray400,
                    marginBottom: 4
                  }}
                >
                  Unique Customers (Orders)
                </div>
                <div
                  style={{
                    fontFamily: "Montserrat",
                    fontWeight: 800,
                    fontSize: 28,
                    color: C.success
                  }}
                >
                  {new Set(orders.map(o => o.email)).size}
                </div>
              </Card>
              <Card>
                <div
                  style={{
                    fontSize: 12,
                    color: C.gray400,
                    marginBottom: 4
                  }}
                >
                  Avg Order Value
                </div>
                <div
                  style={{
                    fontFamily: "Montserrat",
                    fontWeight: 800,
                    fontSize: 28,
                    color: C.red
                  }}
                >
                  ₱
                  {orders.length
                    ? Math.round(
                        orders.reduce((s, o) => s + (o.total || 0), 0) /
                          orders.length
                      ).toLocaleString()
                    : 0}
                </div>
              </Card>
            </div>
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: C.gray50,
                      borderBottom: `1px solid ${C.gray200}`
                    }}
                  >
                    {["Customer", "Email", "Phone", "Orders", "Total Spent"].map(
                      h => (
                        <th
                          key={h}
                          style={{
                            padding: "12px 16px",
                            textAlign: "left",
                            fontWeight: 700,
                            color: C.gray600
                          }}
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {Object.values(
                    orders.reduce((acc, o) => {
                      if (!acc[o.email])
                        acc[o.email] = {
                          name: o.customer,
                          email: o.email,
                          phone: o.phone,
                          orders: 0,
                          total: 0
                        };
                      acc[o.email].orders++;
                      acc[o.email].total += o.total || 0;
                      return acc;
                    }, {})
                  )
                    .sort((a, b) => b.total - a.total)
                    .map(c => (
                      <tr
                        key={c.email}
                        style={{
                          borderBottom: `1px solid ${C.gray100}`
                        }}
                      >
                        <td
                          style={{
                            padding: "12px 16px",
                            fontWeight: 600
                          }}
                        >
                          {c.name}
                        </td>
                        <td
                          style={{
                            padding: "12px 16px",
                            color: C.gray600
                          }}
                        >
                          {c.email}
                        </td>
                        <td
                          style={{
                            padding: "12px 16px",
                            color: C.gray600
                          }}
                        >
                          {c.phone || "—"}
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          <span
                            style={{
                              background: C.infoBg,
                              color: C.info,
                              padding: "2px 8px",
                              borderRadius: 10,
                              fontSize: 12,
                              fontWeight: 700
                            }}
                          >
                            {c.orders}
                          </span>
                        </td>
                        <td
                          style={{
                            padding: "12px 16px",
                            fontFamily: "Montserrat",
                            fontWeight: 700,
                            color: C.success
                          }}
                        >
                          ₱{c.total.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </Card>
          </div>
        )}

        {/* MESSAGES */}
        {tab === "messages" && (
          <div className="fade-in">
            <h2
              style={{
                fontFamily: "Montserrat",
                fontWeight: 800,
                fontSize: 24,
                marginBottom: 20
              }}
            >
              Contact Messages ({messages.length})
            </h2>
            {messages.length === 0 ? (
              <Card
                style={{
                  textAlign: "center",
                  padding: 40,
                  color: C.gray400
                }}
              >
                No messages yet.
              </Card>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {messages
                  .slice()
                  .reverse()
                  .map((m, i) => (
                    <Card key={i}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          marginBottom: 8
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: 15
                            }}
                          >
                            {m.name}
                          </div>
                          <div
                            style={{
                              fontSize: 13,
                              color: C.gray600
                            }}
                          >
                            {m.email} · {m.date}
                          </div>
                        </div>
                        {m.subject && (
                          <div
                            style={{
                              background: C.infoBg,
                              color: C.info,
                              padding: "3px 10px",
                              borderRadius: 10,
                              fontSize: 12,
                              fontWeight: 600
                            }}
                          >
                            {m.subject}
                          </div>
                        )}
                      </div>
                      <p
                        style={{
                          fontSize: 14,
                          color: C.gray800,
                          lineHeight: 1.6
                        }}
                      >
                        {m.message}
                      </p>
                    </Card>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* REVIEWS */}
        {tab === "reviews" && (
          <div className="fade-in">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 20
              }}
            >
              <h2
                style={{
                  fontFamily: "Montserrat",
                  fontWeight: 800,
                  fontSize: 24
                }}
              >
                Customer Reviews ({reviews.length})
              </h2>
              {reviews.length > 0 && (
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#f59e0b"
                  }}
                >
                  {"★".repeat(
                    Math.round(
                      reviews.reduce((s, r) => s + r.rating, 0) /
                        reviews.length
                    )
                  )}{" "}
                  {(
                    reviews.reduce((s, r) => s + r.rating, 0) /
                    reviews.length
                  ).toFixed(1)}{" "}
                  avg
                </div>
              )}
            </div>
            {reviews.length === 0 ? (
              <Card
                style={{
                  textAlign: "center",
                  padding: 40,
                  color: C.gray400
                }}
              >
                No reviews yet.
              </Card>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: 16
                }}
              >
                {reviews
                  .slice()
                  .reverse()
                  .map((r, i) => (
                    <Card key={i}>
                      <div
                        style={{
                          display: "flex",
                          gap: 10,
                          alignItems: "center",
                          marginBottom: 10
                        }}
                      >
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: "50%",
                            background: C.red,
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 700
                          }}
                        >
                          {r.name[0]}
                        </div>
                        <div>
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: 14
                            }}
                          >
                            {r.name}
                          </div>
                          <div
                            style={{
                              color: "#f59e0b"
                            }}
                          >
                            {"★".repeat(r.rating)}
                            {"☆".repeat(5 - r.rating)}
                          </div>
                        </div>
                      </div>
                      <p
                        style={{
                          fontSize: 13,
                          color: C.gray600,
                          lineHeight: 1.6,
                          fontStyle: "italic"
                        }}
                      >
                        "{r.comment}"
                      </p>
                      <div
                        style={{
                          fontSize: 11,
                          color: C.gray400,
                          marginTop: 8
                        }}
                      >
                        {r.product} · {r.date}
                      </div>
                    </Card>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Delete confirm modal */}
      <Modal
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Delete Order"
        width={400}
      >
        <p style={{ color: C.gray600, marginBottom: 20 }}>
          Are you sure you want to delete order <strong>{deleteConfirm}</strong>?
          This cannot be undone.
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <Btn
            variant="danger"
            onClick={() => deleteOrder(deleteConfirm)}
          >
            Yes, Delete
          </Btn>
          <Btn
            variant="ghost"
            onClick={() => setDeleteConfirm(null)}
          >
            Cancel
          </Btn>
        </div>
      </Modal>
    </div>
  );
};
