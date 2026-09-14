import { useState } from "react";
import { C } from "../../constants/colors";
import { store } from "../../utils/storage";
import { Card } from "../Common/Card";
import { Btn } from "../Common/Btn";
import { Badge } from "../Common/Badge";
import { Input } from "../Common/Input";
import { Modal } from "../Common/Modal";
import { v4 as uuidv4 } from "uuid";

export const MyOrdersPage = ({ orders, user, setPage, showToast }) => {
  const [reviewModal, setReviewModal] = useState(null);
  const [review, setReview] = useState({ rating: 5, comment: "" });
  const [submittingReview, setSubmittingReview] = useState(false);
  const myOrders = orders.filter(
    o => o.email === user?.email || o.userId === user?.id
  );

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

      {myOrders.length === 0 ? (
        <Card
          style={{
            textAlign: "center",
            padding: 60,
            color: C.gray400
          }}
        >
          You haven't placed any orders yet.
          <div style={{ marginTop: 16 }}>
            <Btn onClick={() => setPage("products")}>Browse Products</Btn>
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
                  {o.designFileName && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ fontSize: 12, color: C.gray600 }}>
                        📎 {o.designFileName}
                      </div>
                      {o.designFileType && o.designFileType.startsWith('image') && (
                        <img
                          src={o.designFilePath ? `/uploads/orders/${o.designFilePath.split('/').pop()}` : ''}
                          alt="Design preview"
                          style={{ width: 80, height: 60, objectFit: 'contain', borderRadius: 4, marginTop: 4 }}
                        />
                      )}
                      {o.designFilePath && !o.designFileType.startsWith('image') && (
                        <a
                          href={`/uploads/orders/${o.designFilePath.split('/').pop()}`}
                          style={{ color: C.blue, fontSize: 12, textDecoration: 'underline' }}
                        >
                          View/Download
                        </a>
                      )}
                    </div>
                  )}
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
                </div>
              </div>
            </Card>
          ))}
        </div>
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
