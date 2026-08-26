import { useState } from "react";
import { C } from "../../constants/colors";
import { STATUS_LIST } from "../../constants/products";
import { Card } from "../Common/Card";
import { Btn } from "../Common/Btn";
import { Badge } from "../Common/Badge";

export const TrackPage = ({ orders, user }) => {
  const [trackId, setTrackId] = useState("");
  const [found, setFound] = useState(null);
  const [searched, setSearched] = useState(false);
  const userOrders = user
    ? orders.filter(o => o.userId === user.id || o.email === user.email)
    : [];
  const statusFlow = ["Pending", "Confirmed", "In Production", "Ready for Pickup", "Completed"];

  const doSearch = () => {
    const q = trackId.trim().toLowerCase();
    const o = orders.find(
      o => o.id.toLowerCase() === q || o.email.toLowerCase() === q
    );
    setFound(o || null);
    setSearched(true);
  };

  return (
    <div
      style={{
        maxWidth: 760,
        margin: "40px auto",
        padding: "0 24px"
      }}
      className="fade-in"
    >
      <h1
        style={{
          fontFamily: "Montserrat",
          fontWeight: 800,
          fontSize: 28,
          marginBottom: 8
        }}
      >
        Track Your Order
      </h1>
      <p style={{ color: C.gray600, marginBottom: 28 }}>
        Enter your Order ID or email address to check status.
      </p>

      <Card style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", gap: 12 }}>
          <input
            value={trackId}
            onChange={e => setTrackId(e.target.value)}
            onKeyDown={e => e.key === "Enter" && doSearch()}
            placeholder="Order ID (e.g. ORD-XXXXXXXX) or email"
            style={{
              flex: 1,
              padding: "12px 16px",
              border: `1.5px solid ${C.gray200}`,
              borderRadius: 8,
              fontSize: 14
            }}
          />
          <Btn onClick={doSearch}>Search</Btn>
        </div>
      </Card>

      {searched && !found && (
        <Card
          style={{
            textAlign: "center",
            color: C.gray400,
            padding: "40px"
          }}
        >
          Order not found. Check the ID or email and try again.
        </Card>
      )}

      {found && (
        <Card style={{ marginBottom: 24 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: 20
            }}
          >
            <div>
              <h3
                style={{
                  fontFamily: "Montserrat",
                  fontWeight: 700,
                  fontSize: 18
                }}
              >
                {found.id}
              </h3>
              <p style={{ color: C.gray600, fontSize: 14, marginTop: 4 }}>
                {found.product} · {found.quantity} pcs
              </p>
            </div>
            <Badge status={found.status} />
          </div>
          <div
            style={{
              display: "flex",
              gap: 4,
              marginBottom: 20
            }}
          >
            {statusFlow.map((s, i) => {
              const idx = statusFlow.indexOf(found.status);
              const active = i <= idx && found.status !== "Cancelled";
              return (
                <div key={s} style={{ flex: 1, textAlign: "center" }}>
                  <div
                    style={{
                      height: 6,
                      background: active ? C.red : C.gray200,
                      borderRadius: 3,
                      marginBottom: 6
                    }}
                  />
                  <div
                    style={{
                      fontSize: 10,
                      color: active ? C.red : C.gray400,
                      fontWeight: active ? 700 : 400
                    }}
                  >
                    {s}
                  </div>
                </div>
              );
            })}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              fontSize: 14
            }}
          >
            {[
              ["Customer", found.customer],
              ["Email", found.email],
              ["Phone", found.phone],
              ["Date", found.date],
              ["Payment", found.payment],
              ["Total", `₱${found.total?.toLocaleString()}`]
            ].map(([k, v]) => (
              <div key={k}>
                <span style={{ color: C.gray400, fontSize: 12 }}>{k}</span>
                <div style={{ fontWeight: 500 }}>{v}</div>
              </div>
            ))}
          </div>
          {found.specs && (
            <div
              style={{
                marginTop: 16,
                padding: "10px 14px",
                background: C.gray50,
                borderRadius: 8,
                fontSize: 13
              }}
            >
              <strong>Specs:</strong> {found.specs}
            </div>
          )}
        </Card>
      )}

      {user && userOrders.length > 0 && (
        <div>
          <h3
            style={{
              fontFamily: "Montserrat",
              fontWeight: 700,
              fontSize: 18,
              marginBottom: 16
            }}
          >
            Your Recent Orders
          </h3>
          {userOrders.map(o => (
            <Card
              key={o.id}
              style={{ marginBottom: 12, cursor: "pointer" }}
              onClick={() => {
                setFound(o);
                setSearched(true);
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}
              >
                <div>
                  <span
                    style={{
                      fontFamily: "Montserrat",
                      fontWeight: 700,
                      fontSize: 13
                    }}
                  >
                    {o.id}
                  </span>
                  <span
                    style={{
                      color: C.gray400,
                      fontSize: 13,
                      marginLeft: 12
                    }}
                  >
                    {o.product}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      color: C.red
                    }}
                  >
                    ₱{o.total?.toLocaleString()}
                  </span>
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
