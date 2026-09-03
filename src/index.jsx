import { useState, useEffect, useCallback } from "react";
import { C } from "./constants/colors";
import { globalStyles } from "./constants/styles";
import { PRODUCTS } from "./constants/products";
import { store } from "./utils/storage";
import { Navbar } from "./components/Widgets/Navbar";
import { HomePage } from "./components/Pages/HomePage";
import { ProductsPage } from "./components/Pages/ProductsPage";
import { OrderPage } from "./components/Pages/OrderPage";
import { TrackPage } from "./components/Pages/TrackPage";
import { MyOrdersPage } from "./components/Pages/MyOrdersPage";
import { ProfilePage } from "./components/Pages/ProfilePage";
import { ContactPage } from "./components/Pages/ContactPage";
import { LoginPage } from "./components/Pages/LoginPage";
import { RegisterPage } from "./components/Pages/RegisterPage";
import { AdminPanel } from "./components/Pages/AdminPanel";
import { Toast } from "./components/Common/Toast";
import { Spinner } from "./components/Common/Spinner";
import { BMLogo } from "./components/Common/BMLogo";

export default function App() {
  const [page, setPage] = useState("home");
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [toast, setToast] = useState(null);
  const [loadingApp, setLoadingApp] = useState(true);

  const showToast = useCallback(
    (message, type = "info") => setToast({ message, type }),
    []
  );

  // Load persisted data on mount
  useEffect(() => {
    (async () => {
      try {
        // Restore session
        const session = await store.get("session");
        if (session) setUser(session);

        // Load orders from MongoDB backend first
        try {
          const response = await fetch("/api/orders");
          if (!response.ok) throw new Error("Backend error");
          const text = await response.text();
          if (!text) throw new Error("Empty response");
          const data = JSON.parse(text);
          if (response.ok && Array.isArray(data.orders) && data.orders.length > 0) {
            setOrders(data.orders);
          } else {
            throw new Error("No backend orders");
          }
        } catch {
          let storedOrders = await store.get("orders");
          if (!storedOrders || storedOrders.length === 0) {
            const sampleOrders = [
              {
                id: "ORD-SAMPLE01",
                customer: "Maria Santos",
                email: "maria@email.com",
                phone: "09171234567",
                product: "Custom T-Shirt Printing",
                productId: 1,
                quantity: 10,
                specs: "White XL, front logo, red print",
                payment: "GCash",
                total: 1800,
                status: "In Production",
                date: "2025-05-08",
                notes: "Rush order — needed by May 15",
                userId: null,
                createdAt: Date.now() - 86400000 * 3
              },
              {
                id: "ORD-SAMPLE02",
                customer: "Juan dela Cruz",
                email: "juan@email.com",
                phone: "09281234567",
                product: "School ID with Lanyard",
                productId: 4,
                quantity: 50,
                specs: "Grade 7-10 IDs, school logo",
                payment: "Bank Transfer (BDO/BPI)",
                total: 3250,
                status: "Confirmed",
                date: "2025-05-07",
                notes: "",
                userId: null,
                createdAt: Date.now() - 86400000 * 4
              },
              {
                id: "ORD-SAMPLE03",
                customer: "Anna Reyes",
                email: "anna@email.com",
                phone: "09391234567",
                product: "Mug Printing",
                productId: 9,
                quantity: 12,
                specs: "White mugs, personalized photo each",
                payment: "PayMaya",
                total: 1800,
                status: "Completed",
                date: "2025-05-03",
                notes: "Gift set for anniversary",
                userId: null,
                createdAt: Date.now() - 86400000 * 8
              },
              {
                id: "ORD-SAMPLE04",
                customer: "Pedro Garcia",
                email: "pedro@email.com",
                phone: "09501234567",
                product: "Tarpaulin Printing (per sqm)",
                productId: 7,
                quantity: 8,
                specs: "4x2 meters each, election streamers",
                payment: "GCash",
                total: 360,
                status: "Pending",
                date: "2025-05-09",
                notes: "",
                userId: null,
                createdAt: Date.now() - 86400000 * 2
              }
            ];
            storedOrders = sampleOrders;
            await store.set("orders", sampleOrders);
          }
          setOrders(storedOrders);
        }

        // Load reviews
        const storedReviews = (await store.get("reviews")) || [];
        setReviews(storedReviews);
      } catch (e) {
        console.error("Storage load error:", e);
      }
      setLoadingApp(false);
    })();
  }, []);

  const addOrder = useCallback(async (order) => {
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(order)
      });
      if (!response.ok) throw new Error("Server error");
      const text = await response.text();
      if (!text) throw new Error("Empty response");
      const data = JSON.parse(text);
      if (response.ok && data.order) {
        setOrders(prev => [data.order, ...prev]);
        return data.order;
      }
    } catch (error) {
      console.error("Order sync failed:", error);
    }

    setOrders(prev => {
      const updated = [order, ...prev];
      store.set("orders", updated);
      return updated;
    });
    return order;
  }, []);

  const handleLogout = useCallback(async () => {
    await store.del("session");
    setUser(null);
    setPage("home");
    showToast("Logged out successfully.", "info");
  }, [showToast]);

  if (loadingApp) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 16,
          background: C.gray50
        }}
      >
        <BMLogo size={64} />
        <Spinner size={40} />
        <div
          style={{
            color: C.gray400,
            fontFamily: "Montserrat",
            fontSize: 14
          }}
        >
          Loading BM Printing Services...
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        fontFamily: "'Open Sans', sans-serif"
      }}
    >
      <style>{globalStyles}</style>
      <Navbar
        page={page}
        setPage={setPage}
        user={user}
        onLogout={handleLogout}
      />

      {page === "home" && <HomePage setPage={setPage} reviews={reviews} />}
      {page === "products" && (
        <ProductsPage setPage={setPage} setSelectedProduct={setSelectedProduct} />
      )}
      {page === "order" && (
        <OrderPage
          user={user}
          selectedProduct={selectedProduct}
          setPage={setPage}
          addOrder={addOrder}
          showToast={showToast}
        />
      )}
      {page === "track" && <TrackPage orders={orders} user={user} />}
      {page === "myorders" && user && (
        <MyOrdersPage
          orders={orders}
          user={user}
          setPage={setPage}
          showToast={showToast}
        />
      )}
      {page === "myorders" && !user && (
        <div style={{ textAlign: "center", padding: 80 }}>
          <p style={{ marginBottom: 16, color: C.gray400 }}>
            Please login to view your orders.
          </p>
          <button
            onClick={() => setPage("login")}
            style={{
              background: C.red,
              color: "#fff",
              border: "none",
              padding: "10px 22px",
              borderRadius: 8,
              cursor: "pointer",
              fontWeight: 600
            }}
          >
            Login
          </button>
        </div>
      )}
      {page === "contact" && <ContactPage showToast={showToast} />}
      {page === "login" && (
        <LoginPage setPage={setPage} onLogin={setUser} showToast={showToast} />
      )}
      {page === "register" && (
        <RegisterPage setPage={setPage} onLogin={setUser} showToast={showToast} />
      )}
      {page === "profile" && user && (
        <ProfilePage user={user} setUser={setUser} showToast={showToast} />
      )}
      {page === "admin" && user?.role === "admin" && (
        <AdminPanel orders={orders} setOrders={setOrders} showToast={showToast} />
      )}
      {page === "admin" && user?.role !== "admin" && (
        <div
          style={{
            textAlign: "center",
            padding: 80,
            color: C.gray400
          }}
        >
          <h2 style={{ fontFamily: "Montserrat" }}>Access Denied</h2>
          <p style={{ marginTop: 8 }}>Admin login required.</p>
        </div>
      )}

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
