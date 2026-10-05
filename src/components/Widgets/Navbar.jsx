import { isOrderStaff } from '../../../shared/orderWorkflow';
import { useEffect, useRef, useState } from "react";
import { C } from "../../constants/colors";
import { BMLogo } from "../Common/BMLogo";
import { Btn } from "../Common/Btn";
import "./Navbar.css";


const AccountIcon = ({ name }) => (
  <svg className="bm-account-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name === "orders" && <><path d="m12 3 9 5v8l-9 5-9-5V8l9-5Z" /><path d="m3 8 9 5 9-5M12 13v8M7.5 5.5l9 5" /></>}
    {name === "profile" && <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>}
    {name === "logout" && <><path d="M9 21H4V3h5M9 12h12m-4-4 4 4-4 4" /></>}
    {name === "dashboard" && <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>}
  </svg>
);

export const Navbar = ({ page, setPage, user, onLogout }) => {
  const isStaff = user?.role === "staff";
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutModalMounted, setLogoutModalMounted] = useState(false);
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const navRef = useRef(null);
  const toggleRef = useRef(null);
  const cancelLogoutRef = useRef(null);
  const confirmLogoutRef = useRef(null);
  const closeTimerRef = useRef(null);
  const navigate = (destination) => {
    setMenuOpen(false);
    setPage(destination);
  };

  useEffect(() => { setMenuOpen(false); }, [page]);
  useEffect(() => () => window.clearTimeout(closeTimerRef.current), []);
  useEffect(() => {
    if (!logoutModalMounted) return undefined;
    const previousFocus = document.activeElement;
    cancelLogoutRef.current?.focus();

    const handleKeyDown = event => {
      if (event.key === "Escape" && !logoutLoading) {
        event.preventDefault();
        closeLogoutModal();
      }
      if (event.key !== "Tab") return;
      const first = cancelLogoutRef.current;
      const last = confirmLogoutRef.current;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus?.();
    };
  }, [logoutModalMounted, logoutLoading]);

  const openLogoutModal = () => {
    window.clearTimeout(closeTimerRef.current);
    setMenuOpen(false);
    setLogoutModalMounted(true);
    requestAnimationFrame(() => setLogoutModalOpen(true));
  };

  const closeLogoutModal = () => {
    if (logoutLoading) return;
    setLogoutModalOpen(false);
    closeTimerRef.current = window.setTimeout(() => setLogoutModalMounted(false), 200);
  };

  const confirmLogout = async () => {
    if (logoutLoading) return;
    setLogoutLoading(true);
    try {
      const succeeded = await onLogout?.();
      if (succeeded) {
        setLogoutLoading(false);
        setLogoutModalOpen(false);
        closeTimerRef.current = window.setTimeout(() => setLogoutModalMounted(false), 200);
      } else {
        setLogoutLoading(false);
      }
    } catch {
      setLogoutLoading(false);
    }
  };
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeOnResize = () => { if (desktop.matches) setMenuOpen(false); };
    const closeOutside = (event) => {
      if (!navRef.current?.contains(event.target)) setMenuOpen(false);
    };
    desktop.addEventListener("change", closeOnResize);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      desktop.removeEventListener("change", closeOnResize);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, []);
  const links = [
    { id: "home", label: "Home" },
    { id: "products", label: "Products" },
    { id: "order", label: "Order Now" },
    { id: "track", label: "Track Order" },
    { id: "contact", label: "Contact" },
  ];

  return (
    <>
    <nav
      ref={navRef}
      className="bm-navbar"
      aria-label="Main navigation"
      onKeyDown={(event) => {
        if (event.key === "Escape" && menuOpen) {
          setMenuOpen(false);
          toggleRef.current?.focus();
        }
      }}
    >
      <div
        className="bm-navbar-row"
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "0 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 74,
          gap: 8
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            cursor: "pointer",
            flexShrink: 0
          }}
          onClick={() => navigate(isStaff ? "staff" : "home")}
        >
          <BMLogo size={44} />
          <div>
            <div
              style={{
                fontFamily: "Montserrat",
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
        <button
          ref={toggleRef}
          type="button"
          className="bm-navbar-toggle"
          aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={menuOpen}
          aria-controls="bm-navigation-links"
          onClick={() => setMenuOpen(open => !open)}
        >
          <span aria-hidden="true">{menuOpen ? "✕" : "☰"}</span>
        </button>
        <div id="bm-navigation-links" className={`bm-navbar-links${menuOpen ? " is-open" : ""}`}>
          {!isStaff && links.map(l => (
            <button
              className="bm-navbar-link"
              key={l.id}
              onClick={() => navigate(l.id)}
              aria-current={page === l.id ? "page" : undefined}
              style={{
                padding: "8px 12px",
                background: "transparent",
                color: "#2d2526",
                border: "none",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "Montserrat",
                cursor: "pointer",
                transition: "all 0.2s"
              }}
            >
              {l.label}
            </button>
          ))}
          {user ? (
            <>
              {isOrderStaff(user) && (
                <button
                  type="button"
                  className="bm-account-control"
                  onClick={() => navigate(user.role === "admin" ? "admin" : "staff")}
                  aria-current={page === (user.role === "admin" ? "admin" : "staff") ? "page" : undefined}
                  title={user.role === "admin" ? "Admin" : "Staff Dashboard"}
                >
                  <AccountIcon name="dashboard" />
                  <span className="bm-account-label">{user.role === "admin" ? "Admin" : "Staff Dashboard"}</span>
                </button>
              )}
              {!isStaff && (
                <button
                  type="button"
                  className="bm-account-control"
                  aria-current={page === "myorders" ? "page" : undefined}
                  onClick={() => navigate("myorders")}
                  title="My Orders"
                >
                  <AccountIcon name="orders" />
                  <span className="bm-account-label">My Orders</span>
                </button>
              )}
              <button
                type="button"
                className="bm-account-control bm-account-control--profile"
                aria-current={page === "profile" ? "page" : undefined}
                onClick={() => navigate("profile")}
                title={user.name}
              >
                <AccountIcon name="profile" />
                <span className="bm-account-label">{user.name.split(" ")[0]}</span>
              </button>
              <button type="button" className="bm-account-control bm-account-control--logout" onClick={openLogoutModal} title="Logout">
                <AccountIcon name="logout" />
                <span className="bm-account-label">Logout</span>
              </button>
            </>
          ) : (
            <>
              <Btn size="sm" variant="ghost" style={{ background: "rgba(255,255,255,0.22)", borderColor: "rgba(45,37,38,0.4)", color: "#2d2526" }} aria-current={page === "login" ? "page" : undefined} onClick={() => navigate("login")}>
                Login
              </Btn>
              <Btn size="sm" variant="primary" aria-current={page === "register" ? "page" : undefined} onClick={() => navigate("register")}>
                Register
              </Btn>
            </>
          )}
        </div>
      </div>
    </nav>
    {logoutModalMounted && (
      <div
        className={`bm-logout-backdrop${logoutModalOpen ? " is-open" : ""}`}
        onMouseDown={event => {
          if (event.target === event.currentTarget && !logoutLoading) closeLogoutModal();
        }}
      >
        <section
          className="bm-logout-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bm-logout-title"
          aria-describedby="bm-logout-description"
        >
          <h2 id="bm-logout-title">Log out?</h2>
          <p id="bm-logout-description">Are you sure you want to log out of your BM Printing account?</p>
          <div className="bm-logout-actions">
            <button
              ref={cancelLogoutRef}
              type="button"
              className="bm-logout-cancel"
              onClick={closeLogoutModal}
              disabled={logoutLoading}
            >
              Cancel
            </button>
            <button
              ref={confirmLogoutRef}
              type="button"
              className="bm-logout-confirm"
              onClick={confirmLogout}
              disabled={logoutLoading}
            >
              {logoutLoading && <span className="bm-logout-spinner" aria-hidden="true" />}
              {logoutLoading ? "Logging out..." : "Log Out"}
            </button>
          </div>
        </section>
      </div>
    )}
    </>
  );
};
