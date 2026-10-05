import { OrderDesignFiles } from '../Common/OrderDesignFiles';
import { ProductionProgress } from '../Common/ProductionProgress';
import { orderApi, guestOrderToken } from '../../utils/orderApi';
import { displayOrderStatus } from '../../../shared/orderWorkflow';
import { useState, useEffect } from "react";
import { C } from "../../constants/colors";
import { Card } from "../Common/Card";
import { Btn } from "../Common/Btn";
import { Badge } from "../Common/Badge";

export const TrackPage = ({ orders, user }) => {
  const [trackId, setTrackId] = useState("");
  const [found, setFound] = useState(null);
  const [trackingCode, setTrackingCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [lookup, setLookup] = useState(null);
  const [searched, setSearched] = useState(false);
  const userOrders = user
    ? orders.filter(o => o.userId === user.id || (user.email && o.email === user.email))
    : [];
  const statusFlow = ["Pending", "Confirmed", "Processing", "Ready for Pickup", "Picked Up"];

  const doSearch = () => {
    const id = trackId.trim().toUpperCase();
    if (!id) { setError('Enter your order ID.'); return; }
    setFound(null); setSearched(false); setLoading(true);
    let token = trackingCode.trim();
    try { token ||= guestOrderToken(id); } catch {}
    setLookup({ id, token });
  };
  useEffect(() => {
    setFound(null);
    if (!lookup) return;
    let active = true, pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        if (!user && !lookup.token) throw new Error('Enter the private tracking code from your receipt, or login to view your orders.');
        const url = lookup.token ? '/api/guest/orders/' : '/api/customers/orders/';
        const data = await orderApi(url + encodeURIComponent(lookup.id), {
          headers: lookup.token ? { 'X-Order-Token': lookup.token } : {}
        }, user);
        if (active) { setFound(data.order); setError(''); setSearched(true); }
      } catch (e) { if (active) { setFound(null); setError(e.message); } }
      finally { pending = false; if (active) setLoading(false); }
    };
    load();
    const timer = setInterval(load, 5000);
    window.addEventListener('focus', load);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', load); };
  }, [lookup, user]);

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
        Enter your Order ID to check the saved processing status. Updates refresh every 5 seconds.
      </p>

      <Card style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <input
            value={trackId}
            onChange={e => setTrackId(e.target.value)}
            onKeyDown={e => e.key === "Enter" && doSearch()}
            placeholder="Order ID (e.g. ORD-XXXXXXXX)"
            style={{
              flex: 1,
              minWidth: 0,
              padding: "12px 16px",
              border: `1.5px solid ${C.gray200}`,
              borderRadius: 8,
              fontSize: 14
            }}
          />
          <Btn onClick={doSearch} loading={loading}>Search</Btn>
        </div>
      </Card>

      {!user && <label style={{ display: 'block', marginBottom: 24 }}>Private tracking code (guest receipt)
        <input value={trackingCode} onChange={e => setTrackingCode(e.target.value)} style={{ display: 'block', width: '100%', padding: 12 }} autoComplete="off" />
      </label>}
      {error && <p role="alert" style={{ color: C.red }}>{error}</p>}
      {searched && !found && (
        <Card
          style={{
            textAlign: "center",
            color: C.gray400,
            padding: "40px"
          }}
        >
          Order not found. Check the ID and try again.
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
          <ProductionProgress production={found.production} orderStatus={found.status} pickedUpAt={found.pickedUpAt} />
          <div
            style={{
              display: "flex",
              gap: 4,
              marginBottom: 20
            }}
          >
            {statusFlow.map((s, i) => {
              const idx = statusFlow.indexOf(displayOrderStatus(found.status));
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
          {found.designNotes && (
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: C.gray600,
                fontStyle: "italic"
              }}
            >
              📝 {found.designNotes.slice(0, 100)}{found.designNotes.length > 100 && "..."}
            </div>
          )}
          <OrderDesignFiles key={found.id} order={found} user={user} />
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
                setTrackId(o.id);
                setLookup({ id: o.id, token: "" });
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
