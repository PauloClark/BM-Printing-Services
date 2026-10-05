import { orderApi, rememberGuestOrder } from './utils/orderApi';
import { rememberOrderReturn, consumeAuthDestination } from './utils/authReturn';
import { canOpenDashboard, dashboardForRole, supabaseAppUser } from '../shared/roles';
import { ProtectedDashboard } from './components/Pages/ProtectedDashboard';
import { StaffOrders } from './components/Pages/StaffOrders';
import { useState, useEffect, useCallback, useRef } from "react";
import { C } from "./constants/colors";
import { globalStyles } from "./constants/styles";
import "./constants/internalPages.css";
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
import AdminPanel from "./components/Pages/AdminPanel";
import { Toast } from "./components/Common/Toast";
import { Spinner } from "./components/Common/Spinner";
import { BMLogo } from "./components/Common/BMLogo";
import { Chatbot } from "./components/Chatbot";

const PAGES = ['home', 'products', 'order', 'track', 'myorders', 'profile', 'contact', 'login', 'register', 'staff', 'admin'];
const STAFF_CUSTOMER_PAGES = new Set(['home', 'products', 'order', 'track', 'myorders', 'contact']);
const initialPage = () => {
  if (typeof window === 'undefined') return 'home';
  const hash = window.location.hash.replace(/^#\/?/, '');
  const path = window.location.pathname.replace(/^\/|\/$/g, '');
  const pathPage = ({ 'track-order': 'track', 'my-orders': 'myorders' })[path] || path;
  return PAGES.includes(hash) ? hash : PAGES.includes(pathPage) ? pathPage : 'home';
};
export default function App() {
  const [page, setCurrentPage] = useState(initialPage);
  const userRef = useRef(null);
  const setPage = useCallback(next => {
    if (!PAGES.includes(next)) return;
    if (userRef.current?.role === 'staff' && STAFF_CUSTOMER_PAGES.has(next)) next = 'staff';
    if (initialPage() === "order" && ["login", "register"].includes(next)) rememberOrderReturn();
    setCurrentPage(next);
    window.history.replaceState(null, '', '#' + next);
  }, []);
  const identity = useRef(null);
  const [user, setUser] = useState(null);
  userRef.current = user;
  const [orders, setOrders] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [toast, setToast] = useState(null);
  const [loadingApp, setLoadingApp] = useState(true);
  const protectedPageRedirect = !loadingApp && ['staff', 'admin'].includes(page) &&
    (!user || !canOpenDashboard(user.role, page));
  const renderedPage = user?.role === 'staff' && STAFF_CUSTOMER_PAGES.has(page)
    ? 'staff'
    : protectedPageRedirect
      ? dashboardForRole(user?.role)
      : page;

  const completeSignIn = useCallback(next => {
    const shouldNavigate = identity.current !== next.id || ['login', 'register'].includes(initialPage());
    identity.current = next.id;
    setUser(next);
    if (shouldNavigate) {
      const destination = consumeAuthDestination(next.role);
      const checkoutReturn = new URLSearchParams(window.location.search).get('payment_return');
      setPage(next.role === 'customer' && /^[A-Z0-9-]{1,50}$/.test(checkoutReturn || '') ? 'myorders' : destination);
    }
  }, [setPage]);

  const showToast = useCallback(
    (message, type = "info") => setToast({ message, type }),
    []
  );

  useEffect(() => {
    const changed = () => {
      const nextPage = initialPage();
      if (userRef.current?.role === 'staff' && STAFF_CUSTOMER_PAGES.has(nextPage)) {
        setPage('staff');
        return;
      }
      setCurrentPage(nextPage);
    };
    window.addEventListener('hashchange', changed);
    window.addEventListener('popstate', changed);
    return () => { window.removeEventListener('hashchange', changed); window.removeEventListener('popstate', changed); };
  }, [setPage]);

  useEffect(() => {
    if (renderedPage !== page) setPage(renderedPage);
  }, [page, renderedPage, setPage]);

  useEffect(() => {
    let active = true, revision = 0, subscription;
    const sync = async (session, event) => {
      const currentRevision = ++revision;
      try {
        let next = null;
        if (session?.access_token) {
          const { supabase } = await import('./utils/supabaseClient');
          const { data, error } = await supabase.auth.getUser(session.access_token);
          if (error || !data.user) throw error || new Error('Unable to verify your session.');
          next = supabaseAppUser(data.user);
          await store.del('session');
        } else if (event !== 'SIGNED_OUT') {
          const legacy = await store.get('session');
          if (legacy?.token) {
            const { user: verified } = await orderApi('/api/auth/me', {}, legacy);
            next = { ...legacy, ...verified };
          }
        }
        if (!active || currentRevision !== revision) return;
        const newlySignedIn = next && identity.current !== next.id;
        identity.current = next?.id || null;
        setUser(next);
        if (newlySignedIn && (event === 'SIGNED_IN' || ['home', 'login', 'register'].includes(initialPage()))) {
          setPage(consumeAuthDestination(next.role));
        }
      } catch (error) {
        if (active && currentRevision === revision) {
          setUser(null); identity.current = null;
          showToast('Session verification failed. Please login again.', 'error');
        }
      } finally { if (active && currentRevision === revision) setLoadingApp(false); }
    };
    (async () => {
      setReviews((await store.get('reviews')) || []);
      try {
        const { supabase } = await import('./utils/supabaseClient');
        if (!active) return;
        // Defer async Auth work outside the auth callback's internal session lock.
        const { data } = supabase.auth.onAuthStateChange((event, session) => {
          setTimeout(() => { if (active) void sync(session, event); }, 0);
        });
        subscription = data.subscription;
      } catch { if (active) void sync(null, 'INITIAL_SESSION'); }
    })();
    return () => { active = false; revision++; subscription?.unsubscribe(); };
  }, [setPage, showToast]);

  const addOrder = useCallback(async (order) => {
    if (!user) throw new Error("Please sign in before placing an order.");
    const data = await orderApi('/api/orders', { method: 'POST', body: JSON.stringify(order) }, user);
    if (!data.order?.id) throw new Error('The server did not confirm your order. Please check My Orders before retrying.');
    if (data.guestToken) {
      try { rememberGuestOrder(data.order.id, data.guestToken); } catch { /* Receipt still contains the token. */ }
    }
    setOrders(prev => [data.order, ...prev.filter(o => o.id !== data.order.id)]);
    return { ...data.order, guestToken: data.guestToken };
  }, [user]);

  useEffect(() => {
    setOrders([]);
    if (!user) return;
    let active = true, pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const data = await orderApi('/api/customers/orders', {}, user);
        if (active) setOrders(data.orders || []);
      } catch { /* Customer pages display their own actionable load errors. */ }
      finally { pending = false; }
    };
    load();
    const timer = setInterval(load, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [user]);

  const handleLogout = useCallback(async () => {
    try {
      if (user?.authProvider === "supabase") {
        const { supabase } = await import("./utils/supabaseClient");
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      }

      await store.del("session");
      identity.current = null;
      setUser(null);
      setCurrentPage("home");
      window.history.replaceState(null, '', '#home');
      showToast("Logged out successfully.", "success");
      return true;
    } catch (error) {
      console.error("Logout failed:", error);
      showToast("Unable to log out. Please try again.", "error");
      return false;
    }
  }, [showToast, user]);

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
      className={renderedPage === "home" ? undefined : `bm-internal-page${["staff", "admin"].includes(renderedPage) ? "" : " bm-customer-page"}${["login", "register", "products", "contact"].includes(renderedPage) ? " bm-background-under-header" : ""}`}
      style={{
        minHeight: "100vh",
        fontFamily: "'Open Sans', sans-serif"
      }}
    >
      <style>{globalStyles}</style>
      <Navbar
        page={renderedPage}
        setPage={setPage}
        user={user}
        onLogout={handleLogout}
      />

      {renderedPage === "home" && <HomePage setPage={setPage} reviews={reviews} />}
      {renderedPage === "products" && (
        <ProductsPage setPage={setPage} setSelectedProduct={setSelectedProduct} />
      )}
      {renderedPage === "order" && (
        <OrderPage
          key={user?.id || "guest"}
          user={user}
          selectedProduct={selectedProduct}
          setPage={setPage}
          addOrder={addOrder}
          showToast={showToast}
        />
      )}
      {renderedPage === "track" && <TrackPage orders={orders} user={user} />}
      {renderedPage === "myorders" && user && (
        <MyOrdersPage
          orders={orders}
          user={user}
          setPage={setPage}
          showToast={showToast}
        />
      )}
      {renderedPage === "myorders" && !user && (
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
      {renderedPage === "contact" && <ContactPage showToast={showToast} user={user} />}
      {renderedPage === "login" && (
        <LoginPage setPage={setPage} onLogin={completeSignIn} showToast={showToast} />
      )}
      {renderedPage === "register" && (
        <RegisterPage setPage={setPage} onLogin={completeSignIn} showToast={showToast} />
      )}
      {renderedPage === "profile" && user && (
        <ProfilePage user={user} setUser={setUser} showToast={showToast} />
      )}
      {['staff', 'admin'].includes(renderedPage) && (
        <ProtectedDashboard key={renderedPage} user={user} page={renderedPage}>
          {verifiedUser => renderedPage === 'admin'
            ? <AdminPanel user={verifiedUser} showToast={showToast} />
            : <div className="bm-staff-dashboard"><h1>Staff Dashboard</h1><StaffOrders user={verifiedUser} showToast={showToast} /></div>}
        </ProtectedDashboard>
      )}

      {!['staff', 'admin'].includes(renderedPage) && <Chatbot setPage={setPage} />}

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
