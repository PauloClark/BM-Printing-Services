import { useState } from "react";
import { C } from "../../constants/colors";
import { PRODUCTS, PAYMENT_METHODS, STATUS_LIST } from "../../constants/products";
import { generateId } from "../../utils/helpers";
import { Card } from "../Common/Card";
import { Btn } from "../Common/Btn";
import { Input } from "../Common/Input";

export const OrderPage = ({ user, selectedProduct, setPage, addOrder, showToast }) => {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: user?.name || "",
    email: user?.email || "",
    phone: user?.phone || "",
    address: "",
    productId: selectedProduct?.id || "",
    quantity: selectedProduct?.minQty || 1,
    specs: "",
    design: "",
    paymentMethod: "",
    notes: ""
  });
  const [submitted, setSubmitted] = useState(null);
  const product =
    PRODUCTS.find(p => p.id === Number(form.productId)) ||
    (form.productId ? PRODUCTS.find(p => p.name === form.productId) : null);
  const total = product ? product.price * Number(form.quantity) : 0;
  const f = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async () => {
    if (!form.name || !form.email || !form.phone || !product || !form.paymentMethod) {
      showToast("Please fill in all required fields.", "error");
      return;
    }
    setLoading(true);
    const order = {
      id: "ORD-" + generateId(),
      customer: form.name,
      email: form.email,
      phone: form.phone,
      address: form.address,
      product: product.name,
      productId: product.id,
      quantity: Number(form.quantity),
      specs: form.specs,
      design: form.design,
      payment: form.paymentMethod,
      total,
      unitPrice: product.price,
      subtotal: total,
      status: "Pending",
      date: new Date().toISOString().split("T")[0],
      notes: form.notes,
      userId: user?.id,
      createdAt: Date.now()
    };
    const createdOrder = await addOrder(order);
    setSubmitted(createdOrder || order);
    showToast("🎉 Order placed successfully!", "success");
    setLoading(false);
  };

  if (submitted) {
    return (
      <div
        style={{
          maxWidth: 600,
          margin: "60px auto",
          padding: "0 24px",
          textAlign: "center"
        }}
        className="fade-in"
      >
        <Card>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🎉</div>
          <h2
            style={{
              fontFamily: "Montserrat",
              fontWeight: 800,
              fontSize: 26,
              color: C.success,
              marginBottom: 8
            }}
          >
            Order Placed!
          </h2>
          <p style={{ color: C.gray600, marginBottom: 20 }}>
            Your order has been received. We'll confirm within 1 business day.
          </p>
          <Card
            style={{
              background: C.gray50,
              textAlign: "left",
              marginBottom: 20
            }}
          >
            {[
              ["Order ID", submitted.id],
              ["Product", submitted.product],
              ["Quantity", `${submitted.quantity} pcs`],
              ["Payment", submitted.payment]
            ].map(([k, v]) => (
              <div
                key={k}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 8,
                  fontSize: 14
                }}
              >
                <span style={{ color: C.gray600 }}>{k}</span>
                <strong>{v}</strong>
              </div>
            ))}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                borderTop: `1px solid ${C.gray200}`,
                paddingTop: 8,
                marginTop: 4
              }}
            >
              <span style={{ fontWeight: 700 }}>Total</span>
              <strong
                style={{
                  color: C.red,
                  fontFamily: "Montserrat",
                  fontSize: 18
                }}
              >
                ₱{submitted.total.toLocaleString()}
              </strong>
            </div>
          </Card>
          <Card
            style={{
              background: C.infoBg,
              borderColor: C.info,
              textAlign: "left",
              marginBottom: 20,
              padding: "18px 20px"
            }}
          >
            <h3
              style={{
                fontFamily: "Montserrat",
                fontWeight: 700,
                marginBottom: 12,
                color: C.info
              }}
            >
              Payment Pending / Awaiting Payment
            </h3>
            <p style={{ fontSize: 13, color: C.info, marginBottom: 16 }}>
              Please contact the BM Printing Services Admin or Owner directly to arrange and confirm your payment.
            </p>
            <div style={{ display: "grid", gap: 10, alignItems: "center" }}>
              <a
                href="https://www.facebook.com/BMPS01"
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "10px 16px",
                  borderRadius: 8,
                  background: C.red,
                  color: "#fff",
                  textDecoration: "none",
                  fontWeight: 700
                }}
              >
                Contact on Facebook
              </a>
              <a
                href="mailto:bmprintingservices11@gmail.com"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "10px 16px",
                  borderRadius: 8,
                  background: C.black,
                  color: "#fff",
                  textDecoration: "none",
                  fontWeight: 700
                }}
              >
                Contact via Gmail
              </a>
            </div>
          </Card>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <Btn onClick={() => setPage("track")}>Track Order</Btn>
            <Btn
              variant="ghost"
              onClick={() => {
                setSubmitted(null);
                setStep(1);
              }}
            >
              New Order
            </Btn>
          </div>
        </Card>
      </div>
    );
  }

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
        Place an Order
      </h1>
      <p style={{ color: C.gray600, marginBottom: 28 }}>
        Fill in the details below and we'll get started.
      </p>

      {/* Progress */}
      <div style={{ display: "flex", marginBottom: 32 }}>
        {[
          ["1", "Your Info"],
          ["2", "Product & Specs"],
          ["3", "Payment & Review"]
        ].map(([n, l], i) => (
          <div key={n} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              {i > 0 && (
                <div
                  style={{
                    flex: 1,
                    height: 2,
                    background: step > i ? C.red : C.gray200
                  }}
                />
              )}
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background:
                    step > i ? C.success : step === i + 1 ? C.red : C.gray200,
                  color: step > i || step === i + 1 ? "#fff" : C.gray600,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: 14,
                  flexShrink: 0
                }}
              >
                {step > i + 1 ? "✓" : n}
              </div>
              {i < 2 && (
                <div
                  style={{
                    flex: 1,
                    height: 2,
                    background: step > i + 1 ? C.red : C.gray200
                  }}
                />
              )}
            </div>
            <div
              style={{
                fontSize: 12,
                color: step === i + 1 ? C.red : C.gray400,
                marginTop: 6,
                fontWeight: step === i + 1 ? 700 : 400
              }}
            >
              {l}
            </div>
          </div>
        ))}
      </div>

      <Card>
        {step === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <h3 style={{ fontFamily: "Montserrat", fontWeight: 700 }}>
              Customer Information
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Input
                label="Full Name"
                value={form.name}
                onChange={v => f("name", v)}
                placeholder="Juan dela Cruz"
                required
              />
              <Input
                label="Email Address"
                type="email"
                value={form.email}
                onChange={v => f("email", v)}
                placeholder="juan@email.com"
                required
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Input
                label="Phone Number"
                value={form.phone}
                onChange={v => f("phone", v)}
                placeholder="09XXXXXXXXX"
                required
              />
              <Input
                label="Address (for delivery)"
                value={form.address}
                onChange={v => f("address", v)}
                placeholder="Barangay, City, Province"
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Btn
                onClick={() => {
                  if (!form.name || !form.email || !form.phone) {
                    showToast("Please fill required fields", "error");
                    return;
                  }
                  setStep(2);
                }}
              >
                Next →
              </Btn>
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <h3 style={{ fontFamily: "Montserrat", fontWeight: 700 }}>
              Product & Specifications
            </h3>
            <Input
              label="Select Product"
              type="select"
              value={product?.name || ""}
              onChange={v => {
                const p = PRODUCTS.find(x => x.name === v);
                f("productId", p?.id || "");
                f("quantity", p?.minQty || 1);
              }}
              options={PRODUCTS.map(p => p.name)}
              required
            />
            {product && (
              <div
                style={{
                  background: C.gray50,
                  borderRadius: 8,
                  padding: "12px 16px",
                  fontSize: 13,
                  color: C.gray600
                }}
              >
                <strong>{product.image} {product.name}</strong> — ₱
                {product.price.toLocaleString()} {product.unit} · Min. qty:{" "}
                {product.minQty}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Input
                label="Quantity *"
                type="number"
                min={product?.minQty || 1}
                value={form.quantity}
                onChange={v => f("quantity", v)}
              />
              <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                <div
                  style={{
                    fontFamily: "Montserrat",
                    fontWeight: 800,
                    fontSize: 24,
                    color: C.red
                  }}
                >
                  ₱{total.toLocaleString()}
                </div>
                <div style={{ fontSize: 12, color: C.gray400 }}>
                  Estimated Total
                </div>
              </div>
            </div>
            <Input
              label="Print Specifications"
              type="textarea"
              value={form.specs}
              onChange={v => f("specs", v)}
              placeholder="Size, color, placement, quantity per design, etc."
              rows={4}
            />
            <Input
              label="Design Notes / File Description"
              type="textarea"
              value={form.design}
              onChange={v => f("design", v)}
              placeholder="Will email via JPG, Canva link, etc."
              rows={3}
            />
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Btn variant="ghost" onClick={() => setStep(1)}>
                ← Back
              </Btn>
              <Btn
                onClick={() => {
                  if (!product) {
                    showToast("Please select a product", "error");
                    return;
                  }
                  setStep(3);
                }}
              >
                Next →
              </Btn>
            </div>
          </div>
        )}

        {step === 3 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <h3 style={{ fontFamily: "Montserrat", fontWeight: 700 }}>
              Payment & Review
            </h3>
            <Input
              label="Payment Method"
              type="select"
              value={form.paymentMethod}
              onChange={v => f("paymentMethod", v)}
              options={PAYMENT_METHODS}
              required
            />
            {form.paymentMethod && (
              <div
                style={{
                  background: C.infoBg,
                  borderRadius: 8,
                  padding: "12px 16px",
                  fontSize: 13,
                  color: C.info
                }}
              >
                ℹ️ After confirming, the admin will contact you through Facebook or Gmail to arrange and confirm payment.
              </div>
            )}
            <Input
              label="Additional Notes"
              type="textarea"
              value={form.notes}
              onChange={v => f("notes", v)}
              placeholder="Rush? Pickup preference? Special instructions?"
              rows={3}
            />
            <Card style={{ background: C.gray50 }}>
              <h4
                style={{
                  fontFamily: "Montserrat",
                  fontWeight: 700,
                  marginBottom: 12
                }}
              >
                Order Summary
              </h4>
              {[
                ["Customer", form.name],
                ["Email", form.email],
                ["Phone", form.phone],
                ["Product", product?.name],
                ["Quantity", form.quantity + " pcs"],
                ["Payment", form.paymentMethod]
              ].map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 14,
                    marginBottom: 6
                  }}
                >
                  <span style={{ color: C.gray600 }}>{k}</span>
                  <span>{v}</span>
                </div>
              ))}
              <div
                style={{
                  borderTop: `1px solid ${C.gray200}`,
                  marginTop: 10,
                  paddingTop: 10,
                  display: "flex",
                  justifyContent: "space-between"
                }}
              >
                <strong>Total Estimate</strong>
                <strong
                  style={{
                    color: C.red,
                    fontFamily: "Montserrat",
                    fontSize: 20
                  }}
                >
                  ₱{total.toLocaleString()}
                </strong>
              </div>
            </Card>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Btn variant="ghost" onClick={() => setStep(2)}>
                ← Back
              </Btn>
              <Btn size="lg" onClick={handleSubmit} loading={loading}>
                🚀 Confirm Order
              </Btn>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};
