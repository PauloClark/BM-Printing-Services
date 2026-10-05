import { OrderDesignFiles } from '../Common/OrderDesignFiles';
import { ProductionProgress } from '../Common/ProductionProgress';
import { useState, useEffect } from "react";
import { C } from "../../constants/colors";
import { store } from "../../utils/storage";
import { Card } from "../Common/Card";
import { Btn } from "../Common/Btn";
import { Badge } from "../Common/Badge";
import { Input } from "../Common/Input";
import { Modal } from "../Common/Modal";
import { PaymentSubmissionModal } from "./PaymentSubmissionModal";

export const MyOrdersPage = ({ orders, user, setPage, showToast }) => {
  const [reviewModal, setReviewModal] = useState(null);
  const [review, setReview] = useState({ rating: 5, comment: "" });
  const [submittingReview, setSubmittingReview] = useState(false);
  const [myOrders, setMyOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [ordersError, setOrdersError] = useState("");
  const [paymentOrder, setPaymentOrder] = useState(null);

  useEffect(() => {
    let active = true, pending = false;
    setMyOrders([]); setLoadingOrders(true);
    const fetchMyOrders = async () => {
      if (pending) return;
      pending = true;
      try {
        let token = user?.token || "";
        if (user?.authProvider === "supabase") {
          const { supabase } = await import("../../utils/supabaseClient");
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          token = data.session?.access_token || "";
        } else if (!token) {
          const session = await store.get("session");
          token = session?.token || "";
        }

        if (!token) throw new Error("Please login to view your orders.");
        const response = await fetch('/api/customers/orders', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Unable to load your orders.");
        if (active) { setMyOrders(Array.isArray(data.orders) ? data.orders : []); setOrdersError(""); }
      } catch (error) {
        if (active) {
          setMyOrders([]);
          setOrdersError(error.message || "Unable to load your orders.");
        }
      } finally {
        pending = false;
        if (active) setLoadingOrders(false);
      }
    };
    fetchMyOrders();
    const timer = setInterval(fetchMyOrders, 5000);
    window.addEventListener('focus', fetchMyOrders);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', fetchMyOrders); };
  }, [user]);

  const submitReview = async () => {
    if (!review.comment.trim()) {
      showToast("Please write a comment", "error");
      return;
    }
    setSubmittingReview(true);
    const r = {
      name: user.name,
      rating: review.rating,
      comment: review.comment,
      product: reviewModal.product,
      date: new Date().toISOString().split("T")[0],
      orderId: reviewModal.id
    };
    const existing = (await store.get("reviews")) || [];
    await store.set("reviews", [...existing, r]);
    showToast("Review submitted! Thank you 🙏", "success");
    setReviewModal(null);
    setReview({ rating: 5, comment: "" });
    setSubmittingReview(false);
  };

  const handlePaymentSubmitted = updatedOrder => {
    setMyOrders(current => current.map(order => order.id === updatedOrder.id ? { ...order, ...updatedOrder } : order));
    setPaymentOrder(null);
  };

  return (
    <div
      style={{
        maxWidth: 900,
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
          marginBottom: 24
        }}
      >
        My Orders
      </h1>
      {new URLSearchParams(window.location.search).has('payment_return') && (
        <p role="status" className="bm-order-payment-notice">You have returned from checkout. This does not confirm payment. Online payments remain pending verification; contact BM Printing for assistance.</p>
      )}

      {loadingOrders ? (
        <Card style={{ textAlign: "center", padding: 40, color: C.gray400 }}>
          Loading your orders...
        </Card>
      ) : ordersError ? (
        <Card role="alert" style={{ textAlign: "center", padding: 40, color: C.gray600 }}>
          {ordersError}
        </Card>
      ) : myOrders.length === 0 ? (
        <Card
          style={{
            textAlign: "center",
            padding: 60,
            color: C.gray400
          }}
        >
          <h2 style={{ color: C.gray800, fontFamily: "Montserrat", fontSize: 20, margin: "0 0 8px" }}>
            No orders yet
          </h2>
          <p style={{ margin: 0 }}>Your orders will appear here after you place your first order.</p>
          <div style={{ marginTop: 16 }}>
            <Btn onClick={() => setPage("order")}>Place an Order</Btn>
          </div>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
{myOrders.map(o => (
            <Card key={o.id}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start"
                }}
              >
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      marginBottom: 4
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "Montserrat",
                        fontWeight: 700,
                        fontSize: 15
                      }}
                    >
                      {o.id}
                    </div>
                    <Badge status={o.status} />
                  </div>
                  <div style={{ fontSize: 14, color: C.gray600 }}>
                    {o.product} · {o.quantity} pcs · {o.date}
                  </div>
                  <ProductionProgress production={o.production} orderStatus={o.status} pickedUpAt={o.pickedUpAt} />
                  <div style={{ marginTop: 8, fontSize: 13, color: C.gray600 }}>
                    Payment Status: <strong>{o.paymentStatus || "Unpaid"}</strong>
                  </div>
                  {o.status === "Picked Up" && o.pickedUpAt && (
                    <div style={{ marginTop: 4, fontSize: 13, color: "#1a7a3a", fontWeight: 600 }}>
                      Picked Up on {new Date(o.pickedUpAt).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" })}
                    </div>
                  )}
                  {o.paymentRejectionReason && (o.paymentStatus || "Unpaid") === "Rejected" && (
                    <p style={{ margin: "5px 0 0", color: "#9b2525", fontSize: 12 }}>
                      Reason: {o.paymentRejectionReason}
                    </p>
                  )}
                  {o.specs && (
                    <div
                      style={{
                        fontSize: 13,
                        color: C.gray400,
                        marginTop: 6
                      }}
                    >
                      {o.specs.slice(0, 80)}
                      {o.specs.length > 80 && "..."}
                    </div>
                  )}
                  {o.designNotes && (
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 12,
                        color: C.gray600,
                        fontStyle: "italic"
                      }}
                    >
                      📝 {o.designNotes.slice(0, 100)}{o.designNotes.length > 100 && "..."}
                    </div>
                  )}
          <OrderDesignFiles key={o.id} order={o} user={user} />
                </div>
                <div
                  style={{
                    textAlign: "right",
                    flexShrink: 0
                  }}
                >
                  <div
                    style={{
                      fontFamily: "Montserrat",
                      fontWeight: 800,
                      fontSize: 20,
                      color: C.red,
                      marginBottom: 8
                    }}
                  >
                    ₱{o.total?.toLocaleString()}
                  </div>
                  {o.status === "Completed" && (
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={() => setReviewModal(o)}
                    >
                      ⭐ Review
                    </Btn>
                  )}
                  {(o.paymentStatus || "Unpaid") !== "Verified" &&
                    (o.paymentStatus || "Unpaid") !== "For Verification" &&
                    !["Cancelled", "Completed"].includes(o.status) && (
                      <Btn size="sm" onClick={() => setPaymentOrder(o)}>
                        Submit Payment
                      </Btn>
                    )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {paymentOrder && (
        <PaymentSubmissionModal
          order={paymentOrder}
          user={user}
          onClose={() => setPaymentOrder(null)}
          onSubmitted={handlePaymentSubmitted}
          showToast={showToast}
        />
      )}

      <Modal
        open={!!reviewModal}
        onClose={() => setReviewModal(null)}
        title={`Review: ${reviewModal?.product}`}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: C.gray600,
                display: "block",
                marginBottom: 8
              }}
            >
              Rating
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  onClick={() =>
                    setReview(r => ({ ...r, rating: n }))
                  }
                  style={{
                    fontSize: 28,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: n <= review.rating ? "#f59e0b" : C.gray200
                  }}
                >
                  ★
                </button>
              ))}
            </div>
          </div>
          <Input
            label="Your Review"
            type="textarea"
            value={review.comment}
            onChange={v =>
              setReview(r => ({ ...r, comment: v }))
            }
            placeholder="Share your experience with this product..."
            rows={4}
          />
          <Btn onClick={submitReview} loading={submittingReview}>
            Submit Review
          </Btn>
        </div>
      </Modal>
    </div>
  );
};
