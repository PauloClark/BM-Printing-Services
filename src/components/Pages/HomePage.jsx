import { C } from "../../constants/colors";
import { PRODUCTS } from "../../constants/products";
import { BMLogo } from "../Common/BMLogo";
import { Btn } from "../Common/Btn";
import { Card } from "../Common/Card";

export const HomePage = ({ setPage, reviews }) => {
  const stats = [
    { n: "500+", l: "Orders Completed" },
    { n: "98%", l: "Satisfaction Rate" },
    { n: "24/7", l: "Online Ordering" },
    { n: "8+", l: "Years Experience" }
  ];

  const services = [
    {
      icon: "👕",
      title: "Clothing & Apparel",
      desc: "Custom t-shirts, polo, hoodies & jackets with sublimation, screen print, or embroidery."
    },
    {
      icon: "🪪",
      title: "School Supplies",
      desc: "IDs, notebooks, tote bags, and academic materials for school."
    },
    {
      icon: "🖼️",
      title: "Tarpaulins & Banners",
      desc: "Tarpaulins, pull-up banners, and event backdrops of any size."
    },
    {
      icon: "☕",
      title: "Promotional Items",
      desc: "Mugs, keychains, stickers, and branded merchandise for events and giveaways."
    }
  ];

  const steps = [
    { n: 1, icon: "🛍️", title: "Browse & Select", desc: "Choose from our catalog" },
    { n: 2, icon: "📝", title: "Fill Order Form", desc: "Provide specs and design" },
    { n: 3, icon: "💳", title: "Pay Securely", desc: "GCash, PayMaya, bank, card" },
    { n: 4, icon: "📧", title: "Confirmation", desc: "Instant order confirmation" },
    { n: 5, icon: "🚀", title: "Track & Receive", desc: "Monitor production status" }
  ];

  return (
    <div className="fade-in">
      <div
        style={{
          background: `linear-gradient(135deg, ${C.black} 0%, #2a0a0a 50%, ${C.redDark} 100%)`,
          color: "#fff",
          padding: "80px 24px",
          textAlign: "center"
        }}
      >
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
            <BMLogo size={80} />
          </div>
          <h1
            style={{
              fontFamily: "Montserrat",
              fontWeight: 800,
              fontSize: 48,
              lineHeight: 1.15,
              marginBottom: 16
            }}
          >
            BM <span style={{ color: "#ff6b6b" }}>Printing</span> Services
          </h1>
          <p
            style={{
              fontSize: 18,
              opacity: 0.85,
              marginBottom: 12,
              color: "#f0cccc"
            }}
          >
            Custom Clothing · School Supplies · Tarpaulins · Promotional Items
          </p>
          <p style={{ fontSize: 15, opacity: 0.7, marginBottom: 36 }}>
            Your one-stop digital printing partner in the Philippines. Order online 24/7.
          </p>
          <div
            style={{
              display: "flex",
              gap: 16,
              justifyContent: "center",
              flexWrap: "wrap"
            }}
          >
            <Btn
              size="lg"
              onClick={() => setPage("products")}
              style={{ background: C.red, fontSize: 16 }}
            >
               Browse Products
            </Btn>
            <Btn
              size="lg"
              variant="secondary"
              onClick={() => setPage("order")}
              style={{ borderColor: "#fff", color: "#fff" }}
            >
              Place Order
            </Btn>
          </div>
        </div>
      </div>

      <div style={{ background: C.red, padding: "32px 24px" }}>
        <div
          style={{
            maxWidth: 800,
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 16,
            textAlign: "center"
          }}
        >
          {stats.map(s => (
            <div key={s.l}>
              <div
                style={{
                  fontFamily: "Montserrat",
                  fontWeight: 800,
                  fontSize: 32,
                  color: "#fff"
                }}
              >
                {s.n}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "rgba(255,255,255,0.8)",
                  marginTop: 4
                }}
              >
                {s.l}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "60px 24px" }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <h2
            style={{
              fontFamily: "Montserrat",
              fontWeight: 800,
              fontSize: 32,
              color: C.black
            }}
          >
            Our Services
          </h2>
          <p style={{ color: C.gray600, marginTop: 8 }}>
            Everything you need for custom printing — all in one place
          </p>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 24
          }}
        >
          {services.map(s => (
            <Card
              key={s.title}
              className="card-hover"
              style={{ textAlign: "center", cursor: "pointer" }}
              onClick={() => setPage("products")}
            >
              <div style={{ fontSize: 48, marginBottom: 16 }}>{s.icon}</div>
              <h3
                style={{
                  fontFamily: "Montserrat",
                  fontWeight: 700,
                  fontSize: 17,
                  marginBottom: 10
                }}
              >
                {s.title}
              </h3>
              <p style={{ color: C.gray600, fontSize: 14, lineHeight: 1.6 }}>
                {s.desc}
              </p>
            </Card>
          ))}
        </div>
      </div>

      <div style={{ background: C.gray100, padding: "60px 24px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <h2
            style={{
              fontFamily: "Montserrat",
              fontWeight: 800,
              fontSize: 30,
              textAlign: "center",
              marginBottom: 40
            }}
          >
            How It Works
          </h2>
          <div style={{ display: "flex", gap: 0, overflowX: "auto", padding: "8px 0" }}>
            {steps.map((s, i) => (
              <div
                key={s.n}
                style={{
                  flex: 1,
                  textAlign: "center",
                  minWidth: 130,
                  position: "relative",
                  padding: "0 8px"
                }}
              >
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: "50%",
                    background: C.red,
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 24,
                    margin: "0 auto 12px"
                  }}
                >
                  {s.icon}
                </div>
                <div
                  style={{
                    fontFamily: "Montserrat",
                    fontWeight: 700,
                    fontSize: 13,
                    marginBottom: 6
                  }}
                >
                  {s.title}
                </div>
                <div style={{ fontSize: 12, color: C.gray600, lineHeight: 1.5 }}>
                  {s.desc}
                </div>
                {i < steps.length - 1 && (
                  <div
                    style={{
                      position: "absolute",
                      top: 28,
                      right: -10,
                      fontSize: 20,
                      color: C.red,
                      fontWeight: 700
                    }}
                  >
                    →
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {reviews && reviews.length > 0 && (
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "60px 24px" }}>
          <h2
            style={{
              fontFamily: "Montserrat",
              fontWeight: 800,
              fontSize: 28,
              textAlign: "center",
              marginBottom: 32
            }}
          >
            What Our Customers Say
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 20
            }}
          >
            {reviews.slice(0, 6).map((r, i) => (
              <Card key={i}>
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    marginBottom: 12
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: "50%",
                      background: C.red,
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: 16,
                      flexShrink: 0
                    }}
                  >
                    {r.name[0]}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{r.name}</div>
                    <div style={{ color: "#f59e0b", fontSize: 14 }}>
                      {"★".repeat(r.rating)}
                      {"☆".repeat(5 - r.rating)}
                    </div>
                  </div>
                </div>
                <p
                  style={{
                    fontSize: 14,
                    color: C.gray600,
                    lineHeight: 1.6,
                    fontStyle: "italic"
                  }}
                >
                  "{r.comment}"
                </p>
                <div style={{ fontSize: 11, color: C.gray400, marginTop: 8 }}>
                  {r.product} · {r.date}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div style={{ background: C.black, color: "#fff", padding: "60px 24px", textAlign: "center" }}>
        <h2
          style={{
            fontFamily: "Montserrat",
            fontWeight: 800,
            fontSize: 30,
            marginBottom: 12
          }}
        >
          Ready to Print?
        </h2>
        <p
          style={{
            color: "rgba(255,255,255,0.7)",
            marginBottom: 28
          }}
        >
          Place your order online — we'll take care of the rest.
        </p>
        <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
          <Btn size="lg" onClick={() => setPage("order")}>
            Place Order Now
          </Btn>
          <Btn
            size="lg"
            variant="ghost"
            onClick={() => setPage("contact")}
            style={{ color: "#fff", borderColor: "rgba(255,255,255,0.4)" }}
          >
            Contact Us
          </Btn>
        </div>
      </div>

      <footer
        style={{
          background: "#0a0a0a",
          color: "rgba(255,255,255,0.6)",
          padding: "32px 24px",
          textAlign: "center",
          fontSize: 13
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            marginBottom: 12
          }}
        >
          <BMLogo size={30} />
          <span
            style={{
              color: "#fff",
              fontWeight: 700,
              fontFamily: "Montserrat"
            }}
          >
            BM Printing Services
          </span>
        </div>
        <p>facebook.com/BMprintingshop · Philippines</p>
        <p style={{ marginTop: 8 }}>© 2018 BM Printing Services. All rights reserved.</p>
      </footer>
    </div>
  );
};
