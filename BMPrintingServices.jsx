import { useState, useEffect, useCallback } from "react";

// ─── BRAND COLORS ───────────────────────────────────────────────────────────
const C = {
  red: "#8B1A1A", redLight: "#a82020", redDark: "#6b1414",
  black: "#111111", white: "#ffffff",
  gray50: "#f9f9f9", gray100: "#f0f0f0", gray200: "#e0e0e0",
  gray400: "#9e9e9e", gray600: "#555555", gray800: "#222222",
  success: "#1a7a3a", successBg: "#e6f5ec",
  info: "#1565c0", infoBg: "#e3f0fc",
  warning: "#b45309", warningBg: "#fef3e2",
};

// ─── STORAGE HELPERS ─────────────────────────────────────────────────────────
const store = {
  async get(key) {
    try { const r = await window.storage.get(key); return r ? JSON.parse(r.value) : null; }
    catch { return null; }
  },
  async set(key, val) {
    try { await window.storage.set(key, JSON.stringify(val)); return true; }
    catch { return false; }
  },
  async list(prefix) {
    try { const r = await window.storage.list(prefix); return r?.keys || []; }
    catch { return []; }
  },
  async del(key) {
    try { await window.storage.delete(key); return true; }
    catch { return false; }
  }
};

// ─── LOGO ────────────────────────────────────────────────────────────────────
const BMLogo = ({ size = 40 }) => (
  <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="60" cy="60" r="80" fill="white" stroke="#ddd" strokeWidth="2"/>
    <text x="12" y="72" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="68" fill={C.red}>B</text>
    <text x="52" y="72" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="68" fill={C.black}>M</text>
    <text x="22" y="95" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="14" fill={C.black}>Printing</text>
    <text x="60" y="95" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="14" fill={C.black}> Services</text>
  </svg>
);

// ─── PRODUCTS DATA ────────────────────────────────────────────────────────────
const PRODUCTS = [
  { id: 1, category: "Clothing & Apparel", name: "Custom T-Shirt Printing", description: "Full-color sublimation or screen printing on quality fabric. Single to bulk orders.", price: 180, unit: "per piece", minQty: 1, image: "👕", popular: true },
  { id: 2, category: "Clothing & Apparel", name: "Polo Shirt with Logo", description: "Embroidered or printed polo shirts — perfect for uniforms and events.", price: 350, unit: "per piece", minQty: 5, image: "👔" },
  { id: 3, category: "Clothing & Apparel", name: "Hoodie / Jacket Printing", description: "Heat transfer or sublimation printing on hoodies and varsity jackets.", price: 550, unit: "per piece", minQty: 3, image: "🧥" },
  { id: 4, category: "School Supplies", name: "School ID with Lanyard", description: "PVC school ID with lamination + custom printed lanyard. Fast turnaround.", price: 65, unit: "per set", minQty: 10, image: "🪪", popular: true },
  { id: 5, category: "School Supplies", name: "Notebook / Journal Printing", description: "Custom-cover notebooks — great for giveaways and school supplies.", price: 95, unit: "per piece", minQty: 20, image: "📓" },
  { id: 6, category: "School Supplies", name: "Tote Bag Printing", description: "Sublimation-printed canvas or non-woven tote bags. Eco-friendly option.", price: 120, unit: "per piece", minQty: 10, image: "🛍️" },
  { id: 7, category: "Tarpaulins & Banners", name: "Tarpaulin Printing (per sqm)", description: "High-resolution full-color tarpaulin for events, stores, and announcements.", price: 45, unit: "per sqm", minQty: 1, image: "🖼️", popular: true },
  { id: 8, category: "Tarpaulins & Banners", name: "Pull-Up / Roll-Up Banner", description: "Premium pull-up banner with stand — ready to display anytime.", price: 850, unit: "per piece", minQty: 1, image: "📢" },
  { id: 9, category: "Promotional Items", name: "Mug Printing", description: "Sublimation-printed ceramic mugs. Perfect for giveaways and souvenirs.", price: 150, unit: "per piece", minQty: 6, image: "☕", popular: true },
  { id: 10, category: "Promotional Items", name: "Keychain / Button Pin", description: "Custom-designed keychains or button pins for events and giveaways.", price: 35, unit: "per piece", minQty: 20, image: "🔑" },
  { id: 11, category: "Promotional Items", name: "Sticker Printing", description: "Die-cut or standard cut stickers — vinyl or paper-based, any design.", price: 25, unit: "per piece", minQty: 50, image: "🏷️" },
  { id: 12, category: "Tarpaulins & Banners", name: "Event Backdrop / Streamer", description: "Large-format event backdrops, photo wall streamers, and step-and-repeat designs.", price: 55, unit: "per sqm", minQty: 1, image: "🎉" },
];

const CATEGORIES = ["All", "Clothing & Apparel", "School Supplies", "Tarpaulins & Banners", "Promotional Items"];
const PAYMENT_METHODS = ["GCash", "PayMaya", "Bank Transfer (BDO/BPI)", "Credit/Debit Card"];
const STATUS_LIST = ["Pending", "Confirmed", "In Production", "Ready for Pickup", "Completed", "Cancelled"];
const STATUS_COLORS = {
  "Pending": { bg: C.warningBg, color: C.warning },
  "Confirmed": { bg: C.infoBg, color: C.info },
  "In Production": { bg: "#e8f5ff", color: "#0277bd" },
  "Ready for Pickup": { bg: "#f3e5f5", color: "#6a1b9a" },
  "Completed": { bg: C.successBg, color: C.success },
  "Cancelled": { bg: "#fce8e8", color: "#c62828" },
};
const generateId = () => Math.random().toString(36).slice(2, 10).toUpperCase();

// ─── GLOBAL STYLES ─────────────────────────────────────────────────────────
const globalStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Open+Sans:wght@400;500;600&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Open Sans', sans-serif; background: ${C.gray50}; color: ${C.black}; }
  h1,h2,h3,h4,h5 { font-family: 'Montserrat', sans-serif; }
  button { cursor: pointer; border: none; outline: none; font-family: 'Open Sans', sans-serif; }
  input, select, textarea { font-family: 'Open Sans', sans-serif; outline: none; }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: ${C.gray100}; }
  ::-webkit-scrollbar-thumb { background: ${C.gray400}; border-radius: 3px; }
  @keyframes slideIn { from { transform: translateX(100px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  .card-hover:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(139,26,26,0.12); }
  .fade-in { animation: fadeIn 0.35s ease; }
`;

// ─── REUSABLE COMPONENTS ────────────────────────────────────────────────────
const Badge = ({ status }) => {
  const s = STATUS_COLORS[status] || STATUS_COLORS["Pending"];
  return <span style={{ background: s.bg, color: s.color, padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>{status}</span>;
};

const Btn = ({ children, onClick, variant = "primary", size = "md", style: sx = {}, disabled, loading }) => {
  const base = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontWeight: 600, borderRadius: 8, cursor: disabled || loading ? "not-allowed" : "pointer", transition: "all 0.2s", border: "none", fontFamily: "'Montserrat', sans-serif", opacity: disabled || loading ? 0.65 : 1 };
  const sizes = { sm: { padding: "6px 14px", fontSize: 13 }, md: { padding: "10px 22px", fontSize: 14 }, lg: { padding: "14px 30px", fontSize: 15 } };
  const variants = {
    primary: { background: C.red, color: "#fff" },
    secondary: { background: "transparent", color: C.red, border: `2px solid ${C.red}` },
    ghost: { background: "transparent", color: C.gray600, border: `1px solid ${C.gray200}` },
    dark: { background: C.black, color: "#fff" },
    danger: { background: "#c62828", color: "#fff" },
    success: { background: C.success, color: "#fff" },
  };
  return (
    <button style={{ ...base, ...sizes[size], ...variants[variant], ...sx }} onClick={onClick} disabled={disabled || loading}>
      {loading && <span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.7s linear infinite", display: "inline-block" }} />}
      {children}
    </button>
  );
};

const Card = ({ children, style: sx = {}, className = "" }) => (
  <div className={className} style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.gray200}`, padding: "20px 24px", transition: "transform 0.2s, box-shadow 0.2s", ...sx }}>{children}</div>
);

const Input = ({ label, type = "text", value, onChange, placeholder, required, options, style: sx = {}, rows, min, max, step }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    {label && <label style={{ fontSize: 13, fontWeight: 600, color: C.gray600 }}>{label}{required && <span style={{ color: C.red }}> *</span>}</label>}
    {type === "select" ? (
      <select value={value} onChange={e => onChange(e.target.value)} style={{ padding: "10px 14px", border: `1.5px solid ${C.gray200}`, borderRadius: 8, fontSize: 14, background: C.white, ...sx }}>
        <option value="">Select...</option>
        {options?.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    ) : type === "textarea" ? (
      <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows || 3} style={{ padding: "10px 14px", border: `1.5px solid ${C.gray200}`, borderRadius: 8, fontSize: 14, resize: "vertical", ...sx }} />
    ) : (
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} min={min} max={max} step={step} style={{ padding: "10px 14px", border: `1.5px solid ${C.gray200}`, borderRadius: 8, fontSize: 14, ...sx }} />
    )}
  </div>
);

const Toast = ({ message, type, onClose }) => {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
  const colors = { success: { bg: C.success, icon: "✓" }, error: { bg: "#c62828", icon: "✕" }, info: { bg: C.info, icon: "ℹ" } };
  const c = colors[type] || colors.info;
  return (
    <div style={{ position: "fixed", top: 24, right: 24, zIndex: 9999, background: c.bg, color: "#fff", padding: "14px 20px", borderRadius: 10, fontSize: 14, fontWeight: 500, display: "flex", alignItems: "center", gap: 10, boxShadow: "0 4px 20px rgba(0,0,0,0.25)", maxWidth: 360, animation: "slideIn 0.3s ease" }}>
      <span style={{ fontSize: 18, flexShrink: 0 }}>{c.icon}</span>
      <span style={{ flex: 1 }}>{message}</span>
      <span style={{ cursor: "pointer", marginLeft: 8, opacity: 0.7 }} onClick={onClose}>✕</span>
    </div>
  );
};

const Spinner = ({ size = 32 }) => (
  <div style={{ width: size, height: size, border: `3px solid ${C.gray200}`, borderTopColor: C.red, borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
);

const Modal = ({ open, onClose, title, children, width = 500 }) => {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: C.white, borderRadius: 16, width: "100%", maxWidth: width, maxHeight: "90vh", overflow: "auto", animation: "fadeIn 0.2s ease" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", borderBottom: `1px solid ${C.gray200}` }}>
          <h3 style={{ fontFamily: "Montserrat", fontWeight: 700, fontSize: 18 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.gray400, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: "20px 24px" }}>{children}</div>
      </div>
    </div>
  );
};

// ─── NAVBAR ─────────────────────────────────────────────────────────────────
const Navbar = ({ page, setPage, user, onLogout }) => {
  const links = [
    { id: "home", label: "Home" }, { id: "products", label: "Products" },
    { id: "order", label: "Order Now" }, { id: "track", label: "Track Order" },
    { id: "contact", label: "Contact" },
  ];
  return (
    <nav style={{ background: C.white, borderBottom: `3px solid ${C.red}`, position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64, gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", flexShrink: 0 }} onClick={() => setPage("home")}>
          <BMLogo size={44} />
          <div>
            <div style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 16, color: C.red, lineHeight: 1.1 }}>BM PRINTING</div>
            <div style={{ fontSize: 10, color: C.gray600, letterSpacing: 1 }}>SERVICES</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}>
          {links.map(l => (
            <button key={l.id} onClick={() => setPage(l.id)} style={{ padding: "8px 12px", background: page === l.id ? C.red : "transparent", color: page === l.id ? "#fff" : C.gray600, border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, fontFamily: "Montserrat", cursor: "pointer", transition: "all 0.2s" }}>{l.label}</button>
          ))}
          {user ? (
            <>
              {user.role === "admin" && <button onClick={() => setPage("admin")} style={{ padding: "8px 12px", background: page === "admin" ? C.black : "transparent", color: page === "admin" ? "#fff" : C.gray600, border: `1px solid ${C.gray200}`, borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>⚙ Admin</button>}
              <button onClick={() => setPage("myorders")} style={{ padding: "8px 12px", background: "transparent", color: C.gray600, border: `1px solid ${C.gray200}`, borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>📦 My Orders</button>
              <button onClick={() => setPage("profile")} style={{ padding: "8px 12px", background: "transparent", color: C.gray600, border: `1px solid ${C.gray200}`, borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>👤 {user.name.split(" ")[0]}</button>
              <Btn size="sm" variant="ghost" onClick={onLogout}>Logout</Btn>
            </>
          ) : (
            <>
              <Btn size="sm" variant="ghost" onClick={() => setPage("login")}>Login</Btn>
              <Btn size="sm" variant="primary" onClick={() => setPage("register")}>Register</Btn>
            </>
          )}
        </div>
      </div>
    </nav>
  );
};

// ─── HOME PAGE ────────────────────────────────────────────────────────────────
const HomePage = ({ setPage, reviews }) => {
  const stats = [{ n: "500+", l: "Orders Completed" }, { n: "98%", l: "Satisfaction Rate" }, { n: "24/7", l: "Online Ordering" }, { n: "5+", l: "Years Experience" }];
  const services = [
    { icon: "👕", title: "Clothing & Apparel", desc: "Custom t-shirts, polo, hoodies & jackets with sublimation, screen print, or embroidery." },
    { icon: "🪪", title: "School Supplies", desc: "IDs, notebooks, tote bags, and academic materials for schools and universities." },
    { icon: "🖼️", title: "Tarpaulins & Banners", desc: "High-res tarpaulins, pull-up banners, streamers, and event backdrops of any size." },
    { icon: "☕", title: "Promotional Items", desc: "Mugs, keychains, pins, stickers, and branded merchandise for events and giveaways." },
  ];
  const steps = [
    { n: 1, icon: "🛍️", title: "Browse & Select", desc: "Choose from our catalog" },
    { n: 2, icon: "📝", title: "Fill Order Form", desc: "Provide specs and design" },
    { n: 3, icon: "💳", title: "Pay Securely", desc: "GCash, PayMaya, bank, card" },
    { n: 4, icon: "📧", title: "Confirmation", desc: "Instant order confirmation" },
    { n: 5, icon: "🚀", title: "Track & Receive", desc: "Monitor production status" },
  ];
  return (
    <div className="fade-in">
      <div style={{ background: `linear-gradient(135deg, ${C.black} 0%, #2a0a0a 50%, ${C.redDark} 100%)`, color: "#fff", padding: "80px 24px", textAlign: "center" }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}><BMLogo size={80} /></div>
          <h1 style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 48, lineHeight: 1.15, marginBottom: 16 }}>BM <span style={{ color: "#ff6b6b" }}>Printing</span> Services</h1>
          <p style={{ fontSize: 18, opacity: 0.85, marginBottom: 12, color: "#f0cccc" }}>Custom Clothing · School Supplies · Tarpaulins · Promotional Items</p>
          <p style={{ fontSize: 15, opacity: 0.7, marginBottom: 36 }}>Your one-stop digital printing partner in the Philippines. Order online 24/7.</p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
            <Btn size="lg" onClick={() => setPage("products")} style={{ background: C.red, fontSize: 16 }}>🛍️ Browse Products</Btn>
            <Btn size="lg" variant="secondary" onClick={() => setPage("order")} style={{ borderColor: "#fff", color: "#fff" }}>📝 Place Order</Btn>
          </div>
        </div>
      </div>
      <div style={{ background: C.red, padding: "32px 24px" }}>
        <div style={{ maxWidth: 800, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, textAlign: "center" }}>
          {stats.map(s => (
            <div key={s.l}><div style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 32, color: "#fff" }}>{s.n}</div><div style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", marginTop: 4 }}>{s.l}</div></div>
          ))}
        </div>
      </div>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "60px 24px" }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <h2 style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 32, color: C.black }}>Our Services</h2>
          <p style={{ color: C.gray600, marginTop: 8 }}>Everything you need for custom printing — all in one place</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 24 }}>
          {services.map(s => (
            <Card key={s.title} className="card-hover" style={{ textAlign: "center", cursor: "pointer" }} onClick={() => setPage("products")}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>{s.icon}</div>
              <h3 style={{ fontFamily: "Montserrat", fontWeight: 700, fontSize: 17, marginBottom: 10 }}>{s.title}</h3>
              <p style={{ color: C.gray600, fontSize: 14, lineHeight: 1.6 }}>{s.desc}</p>
            </Card>
          ))}
        </div>
      </div>
      <div style={{ background: C.gray100, padding: "60px 24px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <h2 style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 30, textAlign: "center", marginBottom: 40 }}>How It Works</h2>
          <div style={{ display: "flex", gap: 0, overflowX: "auto", padding: "8px 0" }}>
            {steps.map((s, i) => (
              <div key={s.n} style={{ flex: 1, textAlign: "center", minWidth: 130, position: "relative", padding: "0 8px" }}>
                <div style={{ width: 56, height: 56, borderRadius: "50%", background: C.red, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, margin: "0 auto 12px" }}>{s.icon}</div>
                <div style={{ fontFamily: "Montserrat", fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{s.title}</div>
                <div style={{ fontSize: 12, color: C.gray600, lineHeight: 1.5 }}>{s.desc}</div>
                {i < steps.length - 1 && <div style={{ position: "absolute", top: 28, right: -10, fontSize: 20, color: C.red, fontWeight: 700 }}>→</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Reviews */}
      {reviews && reviews.length > 0 && (
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "60px 24px" }}>
          <h2 style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 28, textAlign: "center", marginBottom: 32 }}>What Our Customers Say</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 20 }}>
            {reviews.slice(0, 6).map((r, i) => (
              <Card key={i}>
                <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.red, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16, flexShrink: 0 }}>{r.name[0]}</div>
                  <div><div style={{ fontWeight: 700, fontSize: 14 }}>{r.name}</div><div style={{ color: "#f59e0b", fontSize: 14 }}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</div></div>
                </div>
                <p style={{ fontSize: 14, color: C.gray600, lineHeight: 1.6, fontStyle: "italic" }}>"{r.comment}"</p>
                <div style={{ fontSize: 11, color: C.gray400, marginTop: 8 }}>{r.product} · {r.date}</div>
              </Card>
            ))}
          </div>
        </div>
      )}
      <div style={{ background: C.black, color: "#fff", padding: "60px 24px", textAlign: "center" }}>
        <h2 style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 30, marginBottom: 12 }}>Ready to Print?</h2>
        <p style={{ color: "rgba(255,255,255,0.7)", marginBottom: 28 }}>Place your order online — we'll take care of the rest.</p>
        <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
          <Btn size="lg" onClick={() => setPage("order")}>Place Order Now</Btn>
          <Btn size="lg" variant="ghost" onClick={() => setPage("contact")} style={{ color: "#fff", borderColor: "rgba(255,255,255,0.4)" }}>Contact Us</Btn>
        </div>
      </div>
      <footer style={{ background: "#0a0a0a", color: "rgba(255,255,255,0.6)", padding: "32px 24px", textAlign: "center", fontSize: 13 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 12 }}>
          <BMLogo size={30} />
          <span style={{ color: "#fff", fontWeight: 700, fontFamily: "Montserrat" }}>BM Printing Services</span>
        </div>
        <p>facebook.com/BMprintingshop · Philippines</p>
        <p style={{ marginTop: 8 }}>© 2025 BM Printing Services. All rights reserved.</p>
      </footer>
    </div>
  );
};

// ─── PRODUCTS PAGE ────────────────────────────────────────────────────────────
const ProductsPage = ({ setPage, setSelectedProduct }) => {
  const [cat, setCat] = useState("All");
  const [search, setSearch] = useState("");
  const filtered = PRODUCTS.filter(p => (cat === "All" || p.category === cat) && (p.name.toLowerCase().includes(search.toLowerCase()) || p.description.toLowerCase().includes(search.toLowerCase())));
  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 24px" }} className="fade-in">
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 30, marginBottom: 8 }}>Our Products</h1>
        <p style={{ color: C.gray600 }}>Browse our full catalog of custom printing services</p>
      </div>
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap", alignItems: "center" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍  Search products..." style={{ padding: "10px 16px", border: `1.5px solid ${C.gray200}`, borderRadius: 8, fontSize: 14, flex: 1, minWidth: 200 }} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {CATEGORIES.map(c => (
            <button key={c} onClick={() => setCat(c)} style={{ padding: "8px 16px", borderRadius: 20, border: `1.5px solid ${cat === c ? C.red : C.gray200}`, background: cat === c ? C.red : C.white, color: cat === c ? "#fff" : C.gray600, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{c}</button>
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 20 }}>
        {filtered.map(p => (
          <Card key={p.id} className="card-hover" style={{ position: "relative" }}>
            {p.popular && <div style={{ position: "absolute", top: 16, right: 16, background: C.red, color: "#fff", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 12 }}>POPULAR</div>}
            <div style={{ fontSize: 48, marginBottom: 12, textAlign: "center" }}>{p.image}</div>
            <div style={{ fontSize: 11, color: C.red, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{p.category}</div>
            <h3 style={{ fontFamily: "Montserrat", fontWeight: 700, fontSize: 16, marginBottom: 8 }}>{p.name}</h3>
            <p style={{ fontSize: 13, color: C.gray600, lineHeight: 1.6, marginBottom: 16 }}>{p.description}</p>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
              <div>
                <div style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 22, color: C.red }}>₱{p.price.toLocaleString()}</div>
                <div style={{ fontSize: 11, color: C.gray400 }}>{p.unit} · min. {p.minQty} pcs</div>
              </div>
              <Btn size="sm" onClick={() => { setSelectedProduct(p); setPage("order"); }}>Order →</Btn>
            </div>
          </Card>
        ))}
      </div>
      {filtered.length === 0 && <div style={{ textAlign: "center", padding: "60px 0", color: C.gray400 }}>No products found.</div>}
    </div>
  );
};

// ─── ORDER FORM ───────────────────────────────────────────────────────────────
const OrderPage = ({ user, selectedProduct, setPage, addOrder, showToast }) => {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: user?.name || "", email: user?.email || "", phone: user?.phone || "", address: "",
    productId: selectedProduct?.id || "", quantity: selectedProduct?.minQty || 1,
    specs: "", design: "", paymentMethod: "", notes: "",
  });
  const [submitted, setSubmitted] = useState(null);
  const product = PRODUCTS.find(p => p.id === Number(form.productId)) || (form.productId ? PRODUCTS.find(p => p.name === form.productId) : null);
  const total = product ? product.price * Number(form.quantity) : 0;
  const f = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async () => {
    if (!form.name || !form.email || !form.phone || !product || !form.paymentMethod) {
      showToast("Please fill in all required fields.", "error"); return;
    }
    setLoading(true);
    const order = {
      id: "ORD-" + generateId(),
      customer: form.name, email: form.email, phone: form.phone, address: form.address,
      product: product.name, productId: product.id,
      quantity: Number(form.quantity), specs: form.specs, design: form.design,
      payment: form.paymentMethod, total,
      status: "Pending", date: new Date().toISOString().split("T")[0],
      notes: form.notes, userId: user?.id,
      createdAt: Date.now(),
    };
    await addOrder(order);
    setSubmitted(order);
    showToast("🎉 Order placed successfully!", "success");
    setLoading(false);
  };

  if (submitted) return (
    <div style={{ maxWidth: 600, margin: "60px auto", padding: "0 24px", textAlign: "center" }} className="fade-in">
      <Card>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🎉</div>
        <h2 style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 26, color: C.success, marginBottom: 8 }}>Order Placed!</h2>
        <p style={{ color: C.gray600, marginBottom: 20 }}>Your order has been received. We'll confirm within 1 business day.</p>
        <Card style={{ background: C.gray50, textAlign: "left", marginBottom: 20 }}>
          {[["Order ID", submitted.id], ["Product", submitted.product], ["Quantity", `${submitted.quantity} pcs`], ["Payment", submitted.payment]].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 14 }}><span style={{ color: C.gray600 }}>{k}</span><strong>{v}</strong></div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: `1px solid ${C.gray200}`, paddingTop: 8, marginTop: 4 }}>
            <span style={{ fontWeight: 700 }}>Total</span>
            <strong style={{ color: C.red, fontFamily: "Montserrat", fontSize: 18 }}>₱{submitted.total.toLocaleString()}</strong>
          </div>
        </Card>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <Btn onClick={() => setPage("track")}>Track Order</Btn>
          <Btn variant="ghost" onClick={() => { setSubmitted(null); setStep(1); }}>New Order</Btn>
        </div>
      </Card>
    </div>
  );

  return (
    <div style={{ maxWidth: 760, margin: "40px auto", padding: "0 24px" }} className="fade-in">
      <h1 style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 28, marginBottom: 8 }}>Place an Order</h1>
      <p style={{ color: C.gray600, marginBottom: 28 }}>Fill in the details below and we'll get started.</p>
      {/* Progress */}
      <div style={{ display: "flex", marginBottom: 32 }}>
        {[["1", "Your Info"], ["2", "Product & Specs"], ["3", "Payment & Review"]].map(([n, l], i) => (
          <div key={n} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              {i > 0 && <div style={{ flex: 1, height: 2, background: step > i ? C.red : C.gray200 }} />}
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: step > i ? C.success : step === i + 1 ? C.red : C.gray200, color: step > i || step === i + 1 ? "#fff" : C.gray600, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>{step > i + 1 ? "✓" : n}</div>
              {i < 2 && <div style={{ flex: 1, height: 2, background: step > i + 1 ? C.red : C.gray200 }} />}
            </div>
            <div style={{ fontSize: 12, color: step === i + 1 ? C.red : C.gray400, marginTop: 6, fontWeight: step === i + 1 ? 700 : 400 }}>{l}</div>
          </div>
        ))}
      </div>
      <Card>
        {step === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <h3 style={{ fontFamily: "Montserrat", fontWeight: 700 }}>Customer Information</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Input label="Full Name" value={form.name} onChange={v => f("name", v)} placeholder="Juan dela Cruz" required />
              <Input label="Email Address" type="email" value={form.email} onChange={v => f("email", v)} placeholder="juan@email.com" required />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Input label="Phone Number" value={form.phone} onChange={v => f("phone", v)} placeholder="09XXXXXXXXX" required />
              <Input label="Address (for delivery)" value={form.address} onChange={v => f("address", v)} placeholder="Barangay, City, Province" />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Btn onClick={() => { if (!form.name || !form.email || !form.phone) { showToast("Please fill required fields", "error"); return; } setStep(2); }}>Next →</Btn>
            </div>
          </div>
        )}
        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <h3 style={{ fontFamily: "Montserrat", fontWeight: 700 }}>Product & Specifications</h3>
            <Input label="Select Product" type="select" value={product?.name || ""} onChange={v => { const p = PRODUCTS.find(x => x.name === v); f("productId", p?.id || ""); f("quantity", p?.minQty || 1); }} options={PRODUCTS.map(p => p.name)} required />
            {product && <div style={{ background: C.gray50, borderRadius: 8, padding: "12px 16px", fontSize: 13, color: C.gray600 }}>
              <strong>{product.image} {product.name}</strong> — ₱{product.price.toLocaleString()} {product.unit} · Min. qty: {product.minQty}
            </div>}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Input label="Quantity *" type="number" min={product?.minQty || 1} value={form.quantity} onChange={v => f("quantity", v)} />
              <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                <div style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 24, color: C.red }}>₱{total.toLocaleString()}</div>
                <div style={{ fontSize: 12, color: C.gray400 }}>Estimated Total</div>
              </div>
            </div>
            <Input label="Print Specifications" type="textarea" value={form.specs} onChange={v => f("specs", v)} placeholder="Size, color, placement, quantity per design, etc." rows={4} />
            <Input label="Design Notes / File Description" type="textarea" value={form.design} onChange={v => f("design", v)} placeholder="Will email via JPG, Canva link, etc." rows={3} />
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Btn variant="ghost" onClick={() => setStep(1)}>← Back</Btn>
              <Btn onClick={() => { if (!product) { showToast("Please select a product", "error"); return; } setStep(3); }}>Next →</Btn>
            </div>
          </div>
        )}
        {step === 3 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <h3 style={{ fontFamily: "Montserrat", fontWeight: 700 }}>Payment & Review</h3>
            <Input label="Payment Method" type="select" value={form.paymentMethod} onChange={v => f("paymentMethod", v)} options={PAYMENT_METHODS} required />
            {form.paymentMethod && (
              <div style={{ background: C.infoBg, borderRadius: 8, padding: "12px 16px", fontSize: 13, color: C.info }}>
                ℹ️ After confirming, we'll send payment instructions to <strong>{form.email}</strong> with our {form.paymentMethod} details.
              </div>
            )}
            <Input label="Additional Notes" type="textarea" value={form.notes} onChange={v => f("notes", v)} placeholder="Rush? Pickup preference? Special instructions?" rows={3} />
            <Card style={{ background: C.gray50 }}>
              <h4 style={{ fontFamily: "Montserrat", fontWeight: 700, marginBottom: 12 }}>Order Summary</h4>
              {[["Customer", form.name], ["Email", form.email], ["Phone", form.phone], ["Product", product?.name], ["Quantity", form.quantity + " pcs"], ["Payment", form.paymentMethod]].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 6 }}><span style={{ color: C.gray600 }}>{k}</span><span>{v}</span></div>
              ))}
              <div style={{ borderTop: `1px solid ${C.gray200}`, marginTop: 10, paddingTop: 10, display: "flex", justifyContent: "space-between" }}>
                <strong>Total Estimate</strong>
                <strong style={{ color: C.red, fontFamily: "Montserrat", fontSize: 20 }}>₱{total.toLocaleString()}</strong>
              </div>
            </Card>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Btn variant="ghost" onClick={() => setStep(2)}>← Back</Btn>
              <Btn size="lg" onClick={handleSubmit} loading={loading}>🚀 Confirm Order</Btn>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

// ─── TRACK ORDER ──────────────────────────────────────────────────────────────
const TrackPage = ({ orders, user }) => {
  const [trackId, setTrackId] = useState("");
  const [found, setFound] = useState(null);
  const [searched, setSearched] = useState(false);
  const userOrders = user ? orders.filter(o => o.userId === user.id || o.email === user.email) : [];
  const statusFlow = ["Pending", "Confirmed", "In Production", "Ready for Pickup", "Completed"];
  const doSearch = () => {
    const q = trackId.trim().toLowerCase();
    const o = orders.find(o => o.id.toLowerCase() === q || o.email.toLowerCase() === q);
    setFound(o || null); setSearched(true);
  };
  return (
    <div style={{ maxWidth: 760, margin: "40px auto", padding: "0 24px" }} className="fade-in">
      <h1 style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 28, marginBottom: 8 }}>Track Your Order</h1>
      <p style={{ color: C.gray600, marginBottom: 28 }}>Enter your Order ID or email address to check status.</p>
      <Card style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", gap: 12 }}>
          <input value={trackId} onChange={e => setTrackId(e.target.value)} onKeyDown={e => e.key === "Enter" && doSearch()} placeholder="Order ID (e.g. ORD-XXXXXXXX) or email" style={{ flex: 1, padding: "12px 16px", border: `1.5px solid ${C.gray200}`, borderRadius: 8, fontSize: 14 }} />
          <Btn onClick={doSearch}>Search</Btn>
        </div>
      </Card>
      {searched && !found && <Card style={{ textAlign: "center", color: C.gray400, padding: "40px" }}>Order not found. Check the ID or email and try again.</Card>}
      {found && (
        <Card style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
            <div>
              <h3 style={{ fontFamily: "Montserrat", fontWeight: 700, fontSize: 18 }}>{found.id}</h3>
              <p style={{ color: C.gray600, fontSize: 14, marginTop: 4 }}>{found.product} · {found.quantity} pcs</p>
            </div>
            <Badge status={found.status} />
          </div>
          <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
            {statusFlow.map((s, i) => {
              const idx = statusFlow.indexOf(found.status);
              const active = i <= idx && found.status !== "Cancelled";
              return (
                <div key={s} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ height: 6, background: active ? C.red : C.gray200, borderRadius: 3, marginBottom: 6 }} />
                  <div style={{ fontSize: 10, color: active ? C.red : C.gray400, fontWeight: active ? 700 : 400 }}>{s}</div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 14 }}>
            {[["Customer", found.customer], ["Email", found.email], ["Phone", found.phone], ["Date", found.date], ["Payment", found.payment], ["Total", `₱${found.total?.toLocaleString()}`]].map(([k, v]) => (
              <div key={k}><span style={{ color: C.gray400, fontSize: 12 }}>{k}</span><div style={{ fontWeight: 500 }}>{v}</div></div>
            ))}
          </div>
          {found.specs && <div style={{ marginTop: 16, padding: "10px 14px", background: C.gray50, borderRadius: 8, fontSize: 13 }}><strong>Specs:</strong> {found.specs}</div>}
        </Card>
      )}
      {user && userOrders.length > 0 && (
        <div>
          <h3 style={{ fontFamily: "Montserrat", fontWeight: 700, fontSize: 18, marginBottom: 16 }}>Your Recent Orders</h3>
          {userOrders.map(o => (
            <Card key={o.id} style={{ marginBottom: 12, cursor: "pointer" }} onClick={() => { setFound(o); setSearched(true); }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontFamily: "Montserrat", fontWeight: 700, fontSize: 13 }}>{o.id}</span>
                  <span style={{ color: C.gray400, fontSize: 13, marginLeft: 12 }}>{o.product}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontWeight: 700, color: C.red }}>₱{o.total?.toLocaleString()}</span>
                  <Badge status={o.status} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── MY ORDERS ────────────────────────────────────────────────────────────────
const MyOrdersPage = ({ orders, user, setPage, showToast }) => {
  const [reviewModal, setReviewModal] = useState(null);
  const [review, setReview] = useState({ rating: 5, comment: "" });
  const [submittingReview, setSubmittingReview] = useState(false);
  const myOrders = orders.filter(o => o.email === user?.email || o.userId === user?.id);

  const submitReview = async () => {
    if (!review.comment.trim()) { showToast("Please write a comment", "error"); return; }
    setSubmittingReview(true);
    const r = {
      name: user.name, rating: review.rating, comment: review.comment,
      product: reviewModal.product, date: new Date().toISOString().split("T")[0], orderId: reviewModal.id
    };
    const existing = await store.get("reviews") || [];
    await store.set("reviews", [...existing, r]);
    showToast("Review submitted! Thank you 🙏", "success");
    setReviewModal(null); setReview({ rating: 5, comment: "" });
    setSubmittingReview(false);
  };

  return (
    <div style={{ maxWidth: 900, margin: "40px auto", padding: "0 24px" }} className="fade-in">
      <h1 style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 28, marginBottom: 24 }}>My Orders</h1>
      {myOrders.length === 0 ? (
        <Card style={{ textAlign: "center", padding: 60, color: C.gray400 }}>
          You haven't placed any orders yet.
          <div style={{ marginTop: 16 }}><Btn onClick={() => setPage("products")}>Browse Products</Btn></div>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {myOrders.map(o => (
            <Card key={o.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
                    <div style={{ fontFamily: "Montserrat", fontWeight: 700, fontSize: 15 }}>{o.id}</div>
                    <Badge status={o.status} />
                  </div>
                  <div style={{ fontSize: 14, color: C.gray600 }}>{o.product} · {o.quantity} pcs · {o.date}</div>
                  {o.specs && <div style={{ fontSize: 13, color: C.gray400, marginTop: 6 }}>{o.specs.slice(0, 80)}{o.specs.length > 80 && "..."}</div>}
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 20, color: C.red, marginBottom: 8 }}>₱{o.total?.toLocaleString()}</div>
                  {o.status === "Completed" && (
                    <Btn size="sm" variant="ghost" onClick={() => setReviewModal(o)}>⭐ Review</Btn>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!reviewModal} onClose={() => setReviewModal(null)} title={`Review: ${reviewModal?.product}`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: C.gray600, display: "block", marginBottom: 8 }}>Rating</label>
            <div style={{ display: "flex", gap: 8 }}>
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => setReview(r => ({ ...r, rating: n }))} style={{ fontSize: 28, background: "none", border: "none", cursor: "pointer", color: n <= review.rating ? "#f59e0b" : C.gray200 }}>★</button>
              ))}
            </div>
          </div>
          <Input label="Your Review" type="textarea" value={review.comment} onChange={v => setReview(r => ({ ...r, comment: v }))} placeholder="Share your experience with this product..." rows={4} />
          <Btn onClick={submitReview} loading={submittingReview}>Submit Review</Btn>
        </div>
      </Modal>
    </div>
  );
};

// ─── PROFILE PAGE ─────────────────────────────────────────────────────────────
const ProfilePage = ({ user, setUser, showToast }) => {
  const [form, setForm] = useState({ name: user?.name || "", phone: user?.phone || "", address: user?.address || "" });
  const [pwForm, setPwForm] = useState({ current: "", new: "", confirm: "" });
  const [saving, setSaving] = useState(false);

  const saveProfile = async () => {
    setSaving(true);
    const updated = { ...user, ...form };
    await store.set(`user:${user.id}`, updated);
    setUser(updated);
    showToast("Profile updated!", "success");
    setSaving(false);
  };

  const changePassword = async () => {
    if (pwForm.new !== pwForm.confirm) { showToast("Passwords don't match", "error"); return; }
    if (pwForm.new.length < 6) { showToast("Password must be at least 6 characters", "error"); return; }
    const stored = await store.get(`user:${user.id}`);
    if (stored?.password && stored.password !== pwForm.current) { showToast("Current password is incorrect", "error"); return; }
    await store.set(`user:${user.id}`, { ...stored, password: pwForm.new });
    showToast("Password changed!", "success");
    setPwForm({ current: "", new: "", confirm: "" });
  };

  return (
    <div style={{ maxWidth: 700, margin: "40px auto", padding: "0 24px" }} className="fade-in">
      <h1 style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 28, marginBottom: 24 }}>My Profile</h1>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: C.red, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Montserrat", fontWeight: 800, fontSize: 28 }}>{user?.name?.[0] || "U"}</div>
            <div>
              <div style={{ fontFamily: "Montserrat", fontWeight: 700, fontSize: 20 }}>{user?.name}</div>
              <div style={{ color: C.gray600 }}>{user?.email}</div>
              <div style={{ fontSize: 12, background: C.infoBg, color: C.info, padding: "2px 8px", borderRadius: 10, display: "inline-block", marginTop: 4 }}>{user?.role === "admin" ? "Administrator" : "Customer"}</div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Input label="Full Name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} />
            <Input label="Phone Number" value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} placeholder="09XXXXXXXXX" />
            <Input label="Address" value={form.address} onChange={v => setForm(f => ({ ...f, address: v }))} placeholder="Your delivery address" />
            <Btn onClick={saveProfile} loading={saving}>Save Changes</Btn>
          </div>
        </Card>
        <Card>
          <h3 style={{ fontFamily: "Montserrat", fontWeight: 700, marginBottom: 16 }}>Change Password</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Input label="Current Password" type="password" value={pwForm.current} onChange={v => setPwForm(p => ({ ...p, current: v }))} />
            <Input label="New Password" type="password" value={pwForm.new} onChange={v => setPwForm(p => ({ ...p, new: v }))} />
            <Input label="Confirm New Password" type="password" value={pwForm.confirm} onChange={v => setPwForm(p => ({ ...p, confirm: v }))} />
            <Btn variant="secondary" onClick={changePassword}>Update Password</Btn>
          </div>
        </Card>
      </div>
    </div>
  );
};

// ─── CONTACT PAGE ─────────────────────────────────────────────────────────────
const ContactPage = ({ showToast }) => {
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [loading, setLoading] = useState(false);
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const send = async () => {
    if (!form.name || !form.email || !form.message) { showToast("Please fill all fields", "error"); return; }
    setLoading(true);
    const msg = { ...form, date: new Date().toISOString().split("T")[0], id: generateId() };
    const existing = await store.get("messages") || [];
    await store.set("messages", [...existing, msg]);
    showToast("Message sent! We'll respond within the day.", "success");
    setForm({ name: "", email: "", subject: "", message: "" });
    setLoading(false);
  };
  return (
    <div style={{ maxWidth: 900, margin: "40px auto", padding: "0 24px" }} className="fade-in">
      <h1 style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 28, marginBottom: 8 }}>Contact Us</h1>
      <p style={{ color: C.gray600, marginBottom: 32 }}>Have questions? Send us a message and we'll respond within the day.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 32 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {[["📘", "Facebook", "facebook.com/BMprintingshop"], ["📧", "Email", "bmprintingshop@gmail.com"], ["📱", "Phone", "09XX-XXX-XXXX"], ["📍", "Location", "Philippines"]].map(([i, l, v]) => (
            <Card key={l}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span style={{ fontSize: 28 }}>{i}</span>
                <div><div style={{ fontWeight: 700, fontSize: 14 }}>{l}</div><div style={{ fontSize: 13, color: C.gray600 }}>{v}</div></div>
              </div>
            </Card>
          ))}
          <Card style={{ background: C.infoBg, borderColor: C.info }}>
            <p style={{ fontSize: 13, color: C.info }}>💡 <strong>Quick tip:</strong> For faster response, message us on Facebook (facebook.com/BMprintingshop)!</p>
          </Card>
        </div>
        <Card>
          <h3 style={{ fontFamily: "Montserrat", fontWeight: 700, marginBottom: 20 }}>Send a Message</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Input label="Name" value={form.name} onChange={v => f("name", v)} placeholder="Your name" />
              <Input label="Email" type="email" value={form.email} onChange={v => f("email", v)} placeholder="your@email.com" />
            </div>
            <Input label="Subject" value={form.subject} onChange={v => f("subject", v)} placeholder="What's this about?" />
            <Input label="Message" type="textarea" value={form.message} onChange={v => f("message", v)} placeholder="Tell us more..." rows={5} />
            <Btn onClick={send} loading={loading}>Send Message</Btn>
          </div>
        </Card>
      </div>
    </div>
  );
};

// ─── AUTH PAGES ───────────────────────────────────────────────────────────────
const LoginPage = ({ setPage, onLogin, showToast }) => {
  const [email, setEmail] = useState(""); const [pass, setPass] = useState(""); const [loading, setLoading] = useState(false);
  const handle = async () => {
    if (!email || !pass) { showToast("Enter email and password", "error"); return; }
    setLoading(true);
    // Admin check
    if (email === "admin@bm.com" && pass === "admin123") {
      const adminUser = { id: "admin", name: "BM Admin", email, role: "admin" };
      await store.set("session", adminUser);
      onLogin(adminUser); setPage("admin"); setLoading(false); return;
    }
    // Look up user
    const keys = await store.list("user:");
    for (const key of keys) {
      const u = await store.get(key);
      if (u?.email === email && u?.password === pass) {
        await store.set("session", u);
        onLogin(u); setPage("home"); showToast(`Welcome back, ${u.name}!`, "success");
        setLoading(false); return;
      }
    }
    showToast("Invalid email or password.", "error");
    setLoading(false);
  };
  return (
    <div style={{ minHeight: "70vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} className="fade-in">
      <Card style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}><BMLogo size={56} /></div>
          <h2 style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 22 }}>Welcome Back</h2>
          <p style={{ color: C.gray400, fontSize: 13, marginTop: 4 }}>Login to your BM Printing account</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Input label="Email Address" type="email" value={email} onChange={setEmail} placeholder="your@email.com" />
          <Input label="Password" type="password" value={pass} onChange={setPass} placeholder="••••••••" />
          <Btn size="lg" onClick={handle} loading={loading} style={{ width: "100%", justifyContent: "center", marginTop: 4 }}>Login</Btn>
          <p style={{ textAlign: "center", fontSize: 13, color: C.gray400 }}>Don't have an account? <button onClick={() => setPage("register")} style={{ color: C.red, background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>Register</button></p>
          <div style={{ background: C.infoBg, borderRadius: 8, padding: "10px 14px", fontSize: 12, color: C.info }}>
            <strong>Admin demo:</strong> admin@bm.com / admin123
          </div>
        </div>
      </Card>
    </div>
  );
};

const RegisterPage = ({ setPage, onLogin, showToast }) => {
  const [form, setForm] = useState({ name: "", email: "", phone: "", pass: "", confirm: "" });
  const [loading, setLoading] = useState(false);
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const handle = async () => {
    if (!form.name || !form.email || !form.phone || !form.pass) { showToast("Please fill all fields", "error"); return; }
    if (form.pass !== form.confirm) { showToast("Passwords don't match", "error"); return; }
    if (form.pass.length < 6) { showToast("Password must be at least 6 characters", "error"); return; }
    setLoading(true);
    // Check email unique
    const keys = await store.list("user:");
    for (const key of keys) {
      const u = await store.get(key);
      if (u?.email === form.email) { showToast("Email already registered. Please login.", "error"); setLoading(false); return; }
    }
    const newUser = { id: "user-" + generateId(), name: form.name, email: form.email, phone: form.phone, role: "customer", password: form.pass, createdAt: Date.now() };
    await store.set(`user:${newUser.id}`, newUser);
    await store.set("session", newUser);
    onLogin(newUser); setPage("home");
    showToast("🎉 Account created! Welcome to BM Printing!", "success");
    setLoading(false);
  };
  return (
    <div style={{ minHeight: "70vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} className="fade-in">
      <Card style={{ width: "100%", maxWidth: 440 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}><BMLogo size={56} /></div>
          <h2 style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 22 }}>Create Account</h2>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Input label="Full Name" value={form.name} onChange={v => f("name", v)} placeholder="Juan dela Cruz" required />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Input label="Email" type="email" value={form.email} onChange={v => f("email", v)} required />
            <Input label="Phone" value={form.phone} onChange={v => f("phone", v)} placeholder="09XX-XXX-XXXX" required />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Input label="Password" type="password" value={form.pass} onChange={v => f("pass", v)} required />
            <Input label="Confirm Password" type="password" value={form.confirm} onChange={v => f("confirm", v)} required />
          </div>
          <Btn size="lg" onClick={handle} loading={loading} style={{ width: "100%", justifyContent: "center", marginTop: 4 }}>Create Account</Btn>
          <p style={{ textAlign: "center", fontSize: 13, color: C.gray400 }}>Already have an account? <button onClick={() => setPage("login")} style={{ color: C.red, background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>Login</button></p>
        </div>
      </Card>
    </div>
  );
};

// ─── ADMIN PANEL ──────────────────────────────────────────────────────────────
const AdminPanel = ({ orders, setOrders, showToast }) => {
  const [tab, setTab] = useState("dashboard");
  const [filterStatus, setFilterStatus] = useState("All");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [users, setUsers] = useState([]);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  useEffect(() => {
    (async () => {
      setMessages(await store.get("messages") || []);
      setReviews(await store.get("reviews") || []);
      const keys = await store.list("user:");
      const us = [];
      for (const k of keys) { const u = await store.get(k); if (u) us.push(u); }
      setUsers(us);
    })();
  }, [tab]);

  const totalRev = orders.filter(o => o.status === "Completed").reduce((s, o) => s + (o.total || 0), 0);
  const pending = orders.filter(o => o.status === "Pending").length;
  const inProd = orders.filter(o => o.status === "In Production").length;

  const updateStatus = async (id, status) => {
    const updated = orders.map(o => o.id === id ? { ...o, status } : o);
    setOrders(updated);
    if (selected?.id === id) setSelected(prev => ({ ...prev, status }));
    await store.set("orders", updated);
    showToast(`Status updated to "${status}"`, "success");
  };

  const deleteOrder = async (id) => {
    const updated = orders.filter(o => o.id !== id);
    setOrders(updated);
    await store.set("orders", updated);
    setSelected(null); setDeleteConfirm(null);
    showToast("Order deleted.", "info");
  };

  const filteredOrders = orders.filter(o =>
    (filterStatus === "All" || o.status === filterStatus) &&
    (search === "" || o.customer?.toLowerCase().includes(search.toLowerCase()) || o.id.toLowerCase().includes(search.toLowerCase()) || o.product?.toLowerCase().includes(search.toLowerCase()))
  );

  const stats = [
    { label: "Total Orders", value: orders.length, icon: "📦", color: C.info },
    { label: "Pending", value: pending, icon: "⏳", color: C.warning },
    { label: "In Production", value: inProd, icon: "⚙️", color: "#0277bd" },
    { label: "Revenue (Completed)", value: `₱${totalRev.toLocaleString()}`, icon: "💰", color: C.success },
  ];
  const tabs = [["dashboard", "📊 Dashboard"], ["orders", "📦 Orders"], ["products", "🛍️ Products"], ["customers", "👥 Customers"], ["messages", "📬 Messages"], ["reviews", "⭐ Reviews"]];

  return (
    <div style={{ display: "flex", minHeight: "calc(100vh - 64px)" }}>
      <div style={{ width: 220, background: C.black, flexShrink: 0, padding: "24px 0" }}>
        <div style={{ padding: "0 20px 20px", borderBottom: "1px solid rgba(255,255,255,0.1)", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><BMLogo size={32} /><div style={{ color: "#fff", fontFamily: "Montserrat", fontWeight: 700, fontSize: 13 }}>BM Admin</div></div>
        </div>
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ width: "100%", padding: "12px 20px", background: tab === id ? C.red : "transparent", color: tab === id ? "#fff" : "rgba(255,255,255,0.7)", border: "none", textAlign: "left", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "Montserrat", transition: "all 0.2s" }}>{label}</button>
        ))}
      </div>
      <div style={{ flex: 1, padding: 28, background: C.gray50, overflow: "auto" }}>
        {/* DASHBOARD */}
        {tab === "dashboard" && (
          <div className="fade-in">
            <h2 style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 24, marginBottom: 24 }}>Dashboard Overview</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 28 }}>
              {stats.map(s => (
                <Card key={s.label}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 12, color: C.gray400, fontWeight: 600, marginBottom: 4 }}>{s.label}</div>
                      <div style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 26, color: s.color }}>{s.value}</div>
                    </div>
                    <span style={{ fontSize: 28 }}>{s.icon}</span>
                  </div>
                </Card>
              ))}
            </div>
            {/* Charts */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
              <Card>
                <h3 style={{ fontFamily: "Montserrat", fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Orders by Status</h3>
                {STATUS_LIST.map(s => {
                  const count = orders.filter(o => o.status === s).length;
                  const pct = orders.length ? Math.round((count / orders.length) * 100) : 0;
                  return (
                    <div key={s} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}><span>{s}</span><span style={{ fontWeight: 700 }}>{count}</span></div>
                      <div style={{ height: 6, background: C.gray100, borderRadius: 3 }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: STATUS_COLORS[s]?.color || C.red, borderRadius: 3, transition: "width 0.5s ease" }} />
                      </div>
                    </div>
                  );
                })}
              </Card>
              <Card>
                <h3 style={{ fontFamily: "Montserrat", fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Top Products</h3>
                {(() => {
                  const counts = {};
                  orders.forEach(o => { counts[o.product] = (counts[o.product] || 0) + 1; });
                  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => {
                    const prod = PRODUCTS.find(p => p.name === name);
                    return (
                      <div key={name} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                        <span style={{ fontSize: 20 }}>{prod?.image || "📦"}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{name}</div>
                          <div style={{ height: 4, background: C.gray100, borderRadius: 2, marginTop: 4 }}>
                            <div style={{ height: "100%", width: `${(count / orders.length) * 100}%`, background: C.red, borderRadius: 2 }} />
                          </div>
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: C.red }}>{count}</span>
                      </div>
                    );
                  });
                })()}
              </Card>
            </div>
            <h3 style={{ fontFamily: "Montserrat", fontWeight: 700, fontSize: 18, marginBottom: 16 }}>Recent Orders</h3>
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ background: C.gray50, borderBottom: `1px solid ${C.gray200}` }}>
                  {["Order ID", "Customer", "Product", "Total", "Status", "Date"].map(h => <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontWeight: 700, color: C.gray600 }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {orders.slice(0, 8).map(o => (
                    <tr key={o.id} style={{ borderBottom: `1px solid ${C.gray100}` }}>
                      <td style={{ padding: "12px 16px", fontFamily: "Montserrat", fontWeight: 700, color: C.red, fontSize: 12 }}>{o.id}</td>
                      <td style={{ padding: "12px 16px" }}>{o.customer}</td>
                      <td style={{ padding: "12px 16px", color: C.gray600 }}>{o.product?.slice(0, 22)}...</td>
                      <td style={{ padding: "12px 16px", fontWeight: 700 }}>₱{o.total?.toLocaleString()}</td>
                      <td style={{ padding: "12px 16px" }}><Badge status={o.status} /></td>
                      <td style={{ padding: "12px 16px", color: C.gray400 }}>{o.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        )}

        {/* ORDERS */}
        {tab === "orders" && (
          <div className="fade-in">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 24 }}>Order Management</h2>
              <div style={{ fontSize: 13, color: C.gray400 }}>{filteredOrders.length} orders</div>
            </div>
            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Search orders..." style={{ padding: "8px 14px", border: `1.5px solid ${C.gray200}`, borderRadius: 8, fontSize: 13, flex: 1, minWidth: 200 }} />
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ padding: "8px 14px", border: `1.5px solid ${C.gray200}`, borderRadius: 8, fontSize: 13, background: C.white }}>
                {["All", ...STATUS_LIST].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 380px" : "1fr", gap: 20 }}>
              <Card style={{ padding: 0, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead><tr style={{ background: C.gray50, borderBottom: `1px solid ${C.gray200}` }}>
                    {["Order ID", "Customer", "Product", "Qty", "Total", "Status", "Date", "Actions"].map(h => <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: C.gray600, whiteSpace: "nowrap" }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {filteredOrders.map(o => (
                      <tr key={o.id} onClick={() => setSelected(o === selected ? null : o)} style={{ borderBottom: `1px solid ${C.gray100}`, cursor: "pointer", background: selected?.id === o.id ? "#fff8f8" : "white" }}>
                        <td style={{ padding: "10px 14px", fontFamily: "Montserrat", fontWeight: 700, color: C.red, fontSize: 12 }}>{o.id}</td>
                        <td style={{ padding: "10px 14px", fontWeight: 500 }}>{o.customer}</td>
                        <td style={{ padding: "10px 14px", color: C.gray600, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.product}</td>
                        <td style={{ padding: "10px 14px" }}>{o.quantity}</td>
                        <td style={{ padding: "10px 14px", fontWeight: 700 }}>₱{o.total?.toLocaleString()}</td>
                        <td style={{ padding: "10px 14px" }}><Badge status={o.status} /></td>
                        <td style={{ padding: "10px 14px", color: C.gray400 }}>{o.date}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <select value={o.status} onChange={e => { e.stopPropagation(); updateStatus(o.id, e.target.value); }} style={{ padding: "4px 8px", border: `1px solid ${C.gray200}`, borderRadius: 6, fontSize: 12, background: C.white }} onClick={e => e.stopPropagation()}>
                            {STATUS_LIST.map(s => <option key={s}>{s}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredOrders.length === 0 && <div style={{ textAlign: "center", padding: 40, color: C.gray400 }}>No orders found.</div>}
              </Card>
              {selected && (
                <Card className="fade-in">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h3 style={{ fontFamily: "Montserrat", fontWeight: 700, fontSize: 15 }}>Order Details</h3>
                    <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: C.gray400 }}>✕</button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
                    {[["ID", selected.id], ["Customer", selected.customer], ["Email", selected.email], ["Phone", selected.phone], ["Product", selected.product], ["Quantity", `${selected.quantity} pcs`], ["Payment", selected.payment], ["Total", `₱${selected.total?.toLocaleString()}`], ["Date", selected.date]].map(([k, v]) => (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between", borderBottom: `1px solid ${C.gray100}`, paddingBottom: 8 }}>
                        <span style={{ color: C.gray400 }}>{k}</span><span style={{ fontWeight: 500, textAlign: "right", maxWidth: 200, wordBreak: "break-all" }}>{v}</span>
                      </div>
                    ))}
                    {selected.specs && <div style={{ background: C.gray50, borderRadius: 8, padding: 10 }}><strong style={{ fontSize: 12 }}>Specs:</strong><p style={{ marginTop: 4, color: C.gray600 }}>{selected.specs}</p></div>}
                    {selected.design && <div style={{ background: C.gray50, borderRadius: 8, padding: 10 }}><strong style={{ fontSize: 12 }}>Design:</strong><p style={{ marginTop: 4, color: C.gray600 }}>{selected.design}</p></div>}
                    {selected.notes && <div style={{ background: C.warningBg, borderRadius: 8, padding: 10 }}><strong style={{ fontSize: 12 }}>Notes:</strong><p style={{ marginTop: 4, color: C.warning }}>{selected.notes}</p></div>}
                    <div style={{ marginTop: 8 }}>
                      <label style={{ fontSize: 12, fontWeight: 700, color: C.gray600, display: "block", marginBottom: 6 }}>Update Status</label>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {STATUS_LIST.map(s => (
                          <button key={s} onClick={() => updateStatus(selected.id, s)} style={{ padding: "5px 10px", borderRadius: 6, border: `1px solid ${selected.status === s ? C.red : C.gray200}`, background: selected.status === s ? C.red : "white", color: selected.status === s ? "#fff" : C.gray600, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{s}</button>
                        ))}
                      </div>
                    </div>
                    <Btn variant="danger" size="sm" onClick={() => setDeleteConfirm(selected.id)} style={{ marginTop: 8 }}>🗑 Delete Order</Btn>
                  </div>
                </Card>
              )}
            </div>
          </div>
        )}

        {/* PRODUCTS */}
        {tab === "products" && (
          <div className="fade-in">
            <h2 style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 24, marginBottom: 20 }}>Product Catalog</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
              {PRODUCTS.map(p => (
                <Card key={p.id}>
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 32 }}>{p.image}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: C.red, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{p.category}</div>
                      <div style={{ fontFamily: "Montserrat", fontWeight: 700, fontSize: 14, marginTop: 2 }}>{p.name}</div>
                      <div style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 18, color: C.red, marginTop: 4 }}>₱{p.price.toLocaleString()}</div>
                      <div style={{ fontSize: 11, color: C.gray400 }}>{p.unit} · min. {p.minQty}</div>
                    </div>
                    {p.popular && <span style={{ background: C.red, color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10 }}>HOT</span>}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* CUSTOMERS */}
        {tab === "customers" && (
          <div className="fade-in">
            <h2 style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 24, marginBottom: 20 }}>Customer Management</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginBottom: 24 }}>
              <Card><div style={{ fontSize: 12, color: C.gray400, marginBottom: 4 }}>Registered Users</div><div style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 28, color: C.info }}>{users.length}</div></Card>
              <Card><div style={{ fontSize: 12, color: C.gray400, marginBottom: 4 }}>Unique Customers (Orders)</div><div style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 28, color: C.success }}>{new Set(orders.map(o => o.email)).size}</div></Card>
              <Card><div style={{ fontSize: 12, color: C.gray400, marginBottom: 4 }}>Avg Order Value</div><div style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 28, color: C.red }}>₱{orders.length ? Math.round(orders.reduce((s, o) => s + (o.total || 0), 0) / orders.length).toLocaleString() : 0}</div></Card>
            </div>
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ background: C.gray50, borderBottom: `1px solid ${C.gray200}` }}>
                  {["Customer", "Email", "Phone", "Orders", "Total Spent"].map(h => <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontWeight: 700, color: C.gray600 }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {Object.values(orders.reduce((acc, o) => {
                    if (!acc[o.email]) acc[o.email] = { name: o.customer, email: o.email, phone: o.phone, orders: 0, total: 0 };
                    acc[o.email].orders++; acc[o.email].total += o.total || 0;
                    return acc;
                  }, {})).sort((a, b) => b.total - a.total).map(c => (
                    <tr key={c.email} style={{ borderBottom: `1px solid ${C.gray100}` }}>
                      <td style={{ padding: "12px 16px", fontWeight: 600 }}>{c.name}</td>
                      <td style={{ padding: "12px 16px", color: C.gray600 }}>{c.email}</td>
                      <td style={{ padding: "12px 16px", color: C.gray600 }}>{c.phone || "—"}</td>
                      <td style={{ padding: "12px 16px" }}><span style={{ background: C.infoBg, color: C.info, padding: "2px 8px", borderRadius: 10, fontSize: 12, fontWeight: 700 }}>{c.orders}</span></td>
                      <td style={{ padding: "12px 16px", fontFamily: "Montserrat", fontWeight: 700, color: C.success }}>₱{c.total.toLocaleString()}</td>
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
            <h2 style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 24, marginBottom: 20 }}>Contact Messages ({messages.length})</h2>
            {messages.length === 0 ? <Card style={{ textAlign: "center", padding: 40, color: C.gray400 }}>No messages yet.</Card> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {messages.slice().reverse().map((m, i) => (
                  <Card key={i}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{m.name}</div>
                        <div style={{ fontSize: 13, color: C.gray600 }}>{m.email} · {m.date}</div>
                      </div>
                      {m.subject && <div style={{ background: C.infoBg, color: C.info, padding: "3px 10px", borderRadius: 10, fontSize: 12, fontWeight: 600 }}>{m.subject}</div>}
                    </div>
                    <p style={{ fontSize: 14, color: C.gray800, lineHeight: 1.6 }}>{m.message}</p>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* REVIEWS */}
        {tab === "reviews" && (
          <div className="fade-in">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 24 }}>Customer Reviews ({reviews.length})</h2>
              {reviews.length > 0 && <div style={{ fontSize: 14, fontWeight: 700, color: "#f59e0b" }}>{"★".repeat(Math.round(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length))} {(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)} avg</div>}
            </div>
            {reviews.length === 0 ? <Card style={{ textAlign: "center", padding: 40, color: C.gray400 }}>No reviews yet.</Card> : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
                {reviews.slice().reverse().map((r, i) => (
                  <Card key={i}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: C.red, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>{r.name[0]}</div>
                      <div><div style={{ fontWeight: 700, fontSize: 14 }}>{r.name}</div><div style={{ color: "#f59e0b" }}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</div></div>
                    </div>
                    <p style={{ fontSize: 13, color: C.gray600, lineHeight: 1.6, fontStyle: "italic" }}>"{r.comment}"</p>
                    <div style={{ fontSize: 11, color: C.gray400, marginTop: 8 }}>{r.product} · {r.date}</div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {/* Delete confirm modal */}
      <Modal open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete Order" width={400}>
        <p style={{ color: C.gray600, marginBottom: 20 }}>Are you sure you want to delete order <strong>{deleteConfirm}</strong>? This cannot be undone.</p>
        <div style={{ display: "flex", gap: 12 }}>
          <Btn variant="danger" onClick={() => deleteOrder(deleteConfirm)}>Yes, Delete</Btn>
          <Btn variant="ghost" onClick={() => setDeleteConfirm(null)}>Cancel</Btn>
        </div>
      </Modal>
    </div>
  );
};

// ─── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("home");
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [toast, setToast] = useState(null);
  const [loadingApp, setLoadingApp] = useState(true);

  const showToast = useCallback((message, type = "info") => setToast({ message, type }), []);

  // Load persisted data on mount
  useEffect(() => {
    (async () => {
      try {
        // Restore session
        const session = await store.get("session");
        if (session) setUser(session);
        // Load orders (merge stored + seed sample if empty)
        let storedOrders = await store.get("orders");
        if (!storedOrders || storedOrders.length === 0) {
          const sampleOrders = [
            { id: "ORD-SAMPLE01", customer: "Maria Santos", email: "maria@email.com", phone: "09171234567", product: "Custom T-Shirt Printing", productId: 1, quantity: 10, specs: "White XL, front logo, red print", payment: "GCash", total: 1800, status: "In Production", date: "2025-05-08", notes: "Rush order — needed by May 15", userId: null, createdAt: Date.now() - 86400000 * 3 },
            { id: "ORD-SAMPLE02", customer: "Juan dela Cruz", email: "juan@email.com", phone: "09281234567", product: "School ID with Lanyard", productId: 4, quantity: 50, specs: "Grade 7-10 IDs, school logo", payment: "Bank Transfer (BDO/BPI)", total: 3250, status: "Confirmed", date: "2025-05-07", notes: "", userId: null, createdAt: Date.now() - 86400000 * 4 },
            { id: "ORD-SAMPLE03", customer: "Anna Reyes", email: "anna@email.com", phone: "09391234567", product: "Mug Printing", productId: 9, quantity: 12, specs: "White mugs, personalized photo each", payment: "PayMaya", total: 1800, status: "Completed", date: "2025-05-03", notes: "Gift set for anniversary", userId: null, createdAt: Date.now() - 86400000 * 8 },
            { id: "ORD-SAMPLE04", customer: "Pedro Garcia", email: "pedro@email.com", phone: "09501234567", product: "Tarpaulin Printing (per sqm)", productId: 7, quantity: 8, specs: "4x2 meters each, election streamers", payment: "GCash", total: 360, status: "Pending", date: "2025-05-09", notes: "", userId: null, createdAt: Date.now() - 86400000 * 2 },
          ];
          storedOrders = sampleOrders;
          await store.set("orders", sampleOrders);
        }
        setOrders(storedOrders);
        // Load reviews
        const storedReviews = await store.get("reviews") || [];
        setReviews(storedReviews);
      } catch (e) {
        console.error("Storage load error:", e);
      }
      setLoadingApp(false);
    })();
  }, []);

  const addOrder = useCallback(async (order) => {
    setOrders(prev => {
      const updated = [order, ...prev];
      store.set("orders", updated);
      return updated;
    });
  }, []);

  const handleLogout = useCallback(async () => {
    await store.del("session");
    setUser(null); setPage("home");
    showToast("Logged out successfully.", "info");
  }, [showToast]);

  if (loadingApp) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, background: C.gray50 }}>
      <BMLogo size={64} />
      <Spinner size={40} />
      <div style={{ color: C.gray400, fontFamily: "Montserrat", fontSize: 14 }}>Loading BM Printing Services...</div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", fontFamily: "'Open Sans', sans-serif" }}>
      <style>{globalStyles}</style>
      <Navbar page={page} setPage={setPage} user={user} onLogout={handleLogout} />
      {page === "home" && <HomePage setPage={setPage} reviews={reviews} />}
      {page === "products" && <ProductsPage setPage={setPage} setSelectedProduct={setSelectedProduct} />}
      {page === "order" && <OrderPage user={user} selectedProduct={selectedProduct} setPage={setPage} addOrder={addOrder} showToast={showToast} />}
      {page === "track" && <TrackPage orders={orders} user={user} />}
      {page === "myorders" && user && <MyOrdersPage orders={orders} user={user} setPage={setPage} showToast={showToast} />}
      {page === "myorders" && !user && <div style={{ textAlign: "center", padding: 80 }}><p style={{ marginBottom: 16, color: C.gray400 }}>Please login to view your orders.</p><Btn onClick={() => setPage("login")}>Login</Btn></div>}
      {page === "contact" && <ContactPage showToast={showToast} />}
      {page === "login" && <LoginPage setPage={setPage} onLogin={setUser} showToast={showToast} />}
      {page === "register" && <RegisterPage setPage={setPage} onLogin={setUser} showToast={showToast} />}
      {page === "profile" && user && <ProfilePage user={user} setUser={setUser} showToast={showToast} />}
      {page === "admin" && user?.role === "admin" && <AdminPanel orders={orders} setOrders={setOrders} showToast={showToast} />}
      {page === "admin" && user?.role !== "admin" && <div style={{ textAlign: "center", padding: 80, color: C.gray400 }}><h2 style={{ fontFamily: "Montserrat" }}>Access Denied</h2><p style={{ marginTop: 8 }}>Admin login required.</p></div>}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
