import { C } from "../../constants/colors";
import { HomeHero } from "./HomeHero";
import { BMLogo } from "../Common/BMLogo";
import { Card } from "../Common/Card";

export const HomePage = ({ setPage, reviews }) => {
  return (
    <div className="fade-in bm-home-page">
      <HomeHero setPage={setPage} />

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
