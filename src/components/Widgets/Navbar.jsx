import { C } from "../../constants/colors";
import { BMLogo } from "../Common/BMLogo";
import { Btn } from "../Common/Btn";

export const Navbar = ({ page, setPage, user, onLogout }) => {
  const links = [
    { id: "home", label: "Home" },
    { id: "products", label: "Products" },
    { id: "order", label: "Order Now" },
    { id: "track", label: "Track Order" },
    { id: "contact", label: "Contact" },
  ];

  return (
    <nav
      style={{
        background: C.white,
        borderBottom: `3px solid ${C.red}`,
        position: "sticky",
        top: 0,
        zIndex: 100,
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)"
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "0 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 64,
          gap: 8
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            cursor: "pointer",
            flexShrink: 0
          }}
          onClick={() => setPage("home")}
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
        <div style={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}>
          {links.map(l => (
            <button
              key={l.id}
              onClick={() => setPage(l.id)}
              style={{
                padding: "8px 12px",
                background: page === l.id ? C.red : "transparent",
                color: page === l.id ? "#fff" : C.gray600,
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
              {user.role === "admin" && (
                <button
                  onClick={() => setPage("admin")}
                  style={{
                    padding: "8px 12px",
                    background: page === "admin" ? C.black : "transparent",
                    color: page === "admin" ? "#fff" : C.gray600,
                    border: `1px solid ${C.gray200}`,
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                >
                  ⚙ Admin
                </button>
              )}
              <button
                onClick={() => setPage("myorders")}
                style={{
                  padding: "8px 12px",
                  background: "transparent",
                  color: C.gray600,
                  border: `1px solid ${C.gray200}`,
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                📦 My Orders
              </button>
              <button
                onClick={() => setPage("profile")}
                style={{
                  padding: "8px 12px",
                  background: "transparent",
                  color: C.gray600,
                  border: `1px solid ${C.gray200}`,
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                👤 {user.name.split(" ")[0]}
              </button>
              <Btn size="sm" variant="ghost" onClick={onLogout}>
                Logout
              </Btn>
            </>
          ) : (
            <>
              <Btn size="sm" variant="ghost" onClick={() => setPage("login")}>
                Login
              </Btn>
              <Btn size="sm" variant="primary" onClick={() => setPage("register")}>
                Register
              </Btn>
            </>
          )}
        </div>
      </div>
    </nav>
  );
};
