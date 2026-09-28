import { useState, useRef, useEffect } from "react";
import { C } from "../../constants/colors";
import { PRODUCTS, PAYMENT_METHODS, STATUS_LIST } from "../../constants/products";
import { generateId } from "../../utils/helpers";
import { Card } from "../Common/Card";
import { Btn } from "../Common/Btn";
import { Input } from "../Common/Input";
import "./OrderPage.css";

const REMOVED_PRODUCT_NAMES = new Set([
  "Tote Bag Printing",
  "Tarpaulin Printing (per sqm)",
  "Pull-Up / Roll-Up Banner",
  "Keychain / Button Pin",
  "Event Backdrop / Streamer"
]);

const SPECIFICATION_LABELS = {
  size: "Size",
  idStyle: "ID type/style",
  width: "Width",
  height: "Height",
  unit: "Unit",
  orientation: "Orientation",
  printSide: "Print side",
  shape: "Shape"
};

const getSpecificationType = product => {
  const name = product?.name?.toLowerCase() || "";
  if (/t-shirt|polo shirt|hoodie|jacket/.test(name) || product?.category === "Clothing & Apparel") return "clothing";
  if (name.includes("school id")) return "schoolId";
  if (name.includes("mug")) return "mug";
  if (name.includes("sticker")) return "sticker";
  if (name.includes("event backdrop") || name.includes("streamer")) return "backdrop";
  if (name.includes("banner") || name.includes("poster")) return "banner";
  return "general";
};

const SPECIFICATION_KEYS = {
  clothing: ["size"],
  schoolId: ["idStyle"],
  banner: ["width", "height", "unit", "orientation"],
  mug: ["printSide"],
  sticker: ["width", "height", "unit", "shape"],
  backdrop: ["width", "height", "unit"],
  general: []
};

const isProductImage = source =>
  typeof source === "string" && /^(\/|https?:\/\/|data:image\/)/i.test(source);

const normalizePhone = value => value.replace(/[\s()-]/g, "");

const validateCustomerInfo = (form, fulfillmentMethod) => {
  const errors = {};
  const name = form.name.trim().replace(/\s+/g, " ");
  const email = form.email.trim();
  const phone = normalizePhone(form.phone);

  if (!name) errors.name = "Enter your full name.";
  if (!email) {
    errors.email = "Enter your email address.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    errors.email = "Enter a valid email address, such as juan@email.com.";
  }
  if (!phone) {
    errors.phone = "Enter your Philippine mobile number.";
  } else if (!/^(09\d{9}|\+639\d{9})$/.test(phone)) {
    errors.phone = "Use a Philippine mobile number like 09XXXXXXXXX or +639XXXXXXXXX.";
  }
  if (fulfillmentMethod === "delivery" && !form.address.trim()) {
    errors.address = "Enter the delivery address.";
  }

  return errors;
};

const CustomerField = ({
  id,
  label,
  value,
  onChange,
  placeholder,
  required,
  error,
  inputRef,
  type = "text",
  inputMode,
  autoComplete,
  maxLength,
  className = ""
}) => (
  <div className={`order-step1__field ${className}`}>
    <label className="order-step1__label" htmlFor={id}>
      {label}{required && <span className="order-step1__required"> *</span>}
    </label>
    <input
      ref={inputRef}
      id={id}
      className="order-step1__input"
      type={type}
      inputMode={inputMode}
      autoComplete={autoComplete}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      required={required}
      maxLength={maxLength}
      aria-invalid={Boolean(error)}
      aria-describedby={error ? `${id}-error` : undefined}
    />
    {error && <p className="order-step1__error" id={`${id}-error`} role="alert">{error}</p>}
  </div>
);

export const OrderPage = ({ user, selectedProduct, setPage, addOrder, showToast }) => {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [fulfillmentMethod, setFulfillmentMethod] = useState("delivery");
  const [step1Errors, setStep1Errors] = useState({});
  const [catalogProducts, setCatalogProducts] = useState(() => {
    const fallbackProducts = PRODUCTS.filter(product => !REMOVED_PRODUCT_NAMES.has(product.name));
    return selectedProduct && !REMOVED_PRODUCT_NAMES.has(selectedProduct.name)
      ? [selectedProduct, ...fallbackProducts.filter(product => product.id !== selectedProduct.id)]
      : fallbackProducts;
  });
  const [step2Attempted, setStep2Attempted] = useState(false);
  const [form, setForm] = useState({
    name: user?.name || "",
    email: user?.email || "",
    phone: user?.phone || "",
    address: user?.address || "",
    productId: selectedProduct && !REMOVED_PRODUCT_NAMES.has(selectedProduct.name) ? selectedProduct.id : "",
    quantity: 1,
    specs: "",
    specificationDetails: {},
    specialInstructions: "",
    paymentMethod: "",
    notes: ""
  });
  const [submitted, setSubmitted] = useState(null);
  const nameInputRef = useRef(null);
  const emailInputRef = useRef(null);
  const phoneInputRef = useRef(null);
  const addressInputRef = useRef(null);
  const productSelectRef = useRef(null);
  const quantityInputRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    setForm(current => ({
      ...current,
      name: current.name || user.name || "",
      email: current.email || user.email || "",
      phone: current.phone || user.phone || "",
      address: current.address || user.address || ""
    }));
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    const loadActiveProducts = async () => {
      try {
        const response = await fetch("/api/products");
        if (!response.ok) return;
        const data = await response.json();
        if (!Array.isArray(data.products) || data.products.length === 0) return;

        const activeProducts = data.products
          .filter(item => !REMOVED_PRODUCT_NAMES.has(item.name))
          .map(item => {
            const local = PRODUCTS.find(product => Number(product.id) === Number(item.id));
            return {
              ...local,
              ...item,
              id: item.id ?? local?.id,
              name: item.name,
              price: Number(local?.price ?? item.price ?? 0),
              minQty: 1,
              category: item.category || local?.category || "Printing",
              unit: local?.unit || "per piece",
              image: local?.image || (isProductImage(item.image) ? item.image : ""),
              popular: local?.popular || false
            };
          });

        if (!cancelled) setCatalogProducts(activeProducts);
      } catch {
        // Keep the local catalog available when the products API is offline.
      }
    };

    loadActiveProducts();
    return () => {
      cancelled = true;
    };
  }, []);

  const product = catalogProducts.find(item => String(item.id) === String(form.productId)) ||
    catalogProducts.find(item => item.name === form.productId) || null;
  const productSpecType = getSpecificationType(product);
  const quantityText = String(form.quantity ?? "");
  const quantityValue = Number(quantityText);
  const quantityError = !quantityText.trim()
    ? "Enter a quantity of at least 1."
    : !/^\d+$/.test(quantityText) || !Number.isSafeInteger(quantityValue)
      ? "Enter a whole-number quantity of at least 1."
      : quantityValue < 1
        ? "Quantity must be at least 1."
        : "";
  const total = product ? product.price * Math.max(0, quantityValue || 0) : 0;
  const f = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const updateSpecification = (key, value) => {
    setForm(prev => ({
      ...prev,
      specificationDetails: { ...prev.specificationDetails, [key]: value }
    }));
  };
  const updateStep1Field = (key, value) => {
    const nextForm = { ...form, [key]: value };
    setForm(nextForm);
    if (Object.keys(step1Errors).length > 0) {
      setStep1Errors(validateCustomerInfo(nextForm, fulfillmentMethod));
    }
  };

  const handleStep1Next = () => {
    const normalizedForm = {
      ...form,
      name: form.name.trim().replace(/\s+/g, " "),
      email: form.email.trim(),
      phone: normalizePhone(form.phone),
      address: form.address.trim()
    };
    const errors = validateCustomerInfo(normalizedForm, fulfillmentMethod);
    setForm(normalizedForm);
    setStep1Errors(errors);

    const firstInvalidField = ["name", "email", "phone", "address"].find(key => errors[key]);
    if (firstInvalidField) {
      const refs = {
        name: nameInputRef,
        email: emailInputRef,
        phone: phoneInputRef,
        address: addressInputRef
      };
      const input = refs[firstInvalidField].current;
      input?.focus({ preventScroll: true });
      input?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setStep(2);
  };

  const handleStep2Next = () => {
    setStep2Attempted(true);
    if (!product) {
      productSelectRef.current?.focus();
      productSelectRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (quantityError) {
      quantityInputRef.current?.focus();
      quantityInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setStep(3);
  };

  const handleSubmit = async () => {
    if (!form.name || !form.email || !form.phone || !product || !form.paymentMethod) {
      showToast("Please fill in all required fields.", "error");
      return;
    }
    setLoading(true);
    const specificationLines = (SPECIFICATION_KEYS[productSpecType] || [])
      .filter(key => String(form.specificationDetails[key] || "").trim())
      .map(key => `${SPECIFICATION_LABELS[key]}: ${String(form.specificationDetails[key]).trim()}`);
    const orderSpecs = [
      String(form.specs || "").trim(),
      ...specificationLines,
      String(form.specialInstructions || "").trim()
        ? `Special Instructions: ${String(form.specialInstructions).trim()}`
        : ""
    ].filter(Boolean).join("\n");
    const order = {
      id: "ORD-" + generateId(),
      customer: form.name,
      email: form.email,
      phone: form.phone,
      address: fulfillmentMethod === "pickup" ? "Pickup" : form.address.trim(),
      product: product.name,
      productId: product.id,
      quantity: Number(form.quantity),
      specs: orderSpecs,
      designNotes: orderSpecs,
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
    try {
      const createdOrder = await addOrder(order);
      setSubmitted(createdOrder || order);
      showToast("🎉 Order placed successfully!", "success");
    } catch (error) {
      showToast(error.message || "Unable to place your order. Please try again.", "error");
    } finally {
      setLoading(false);
    }
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
          <div className="order-step1">
            <h3 style={{ fontFamily: "Montserrat", fontWeight: 700 }}>
              Customer Information
            </h3>
            <div className="order-step1__grid">
              <CustomerField
                id="customer-name"
                label="Full Name"
                value={form.name}
                inputRef={nameInputRef}
                onChange={e => updateStep1Field("name", e.target.value)}
                placeholder="Juan dela Cruz"
                required
                error={step1Errors.name}
              />
              <CustomerField
                id="customer-email"
                label="Email Address"
                inputMode="email"
                autoComplete="email"
                value={form.email}
                inputRef={emailInputRef}
                onChange={e => updateStep1Field("email", e.target.value)}
                placeholder="juan@email.com"
                required
                error={step1Errors.email}
              />
              <CustomerField
                id="customer-phone"
                label="Phone Number"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={20}
                value={form.phone}
                inputRef={phoneInputRef}
                onChange={e => updateStep1Field("phone", e.target.value.replace(/[^\d+()\s-]/g, ""))}
                placeholder="09XXXXXXXXX"
                required
                error={step1Errors.phone}
              />
              <fieldset className="order-step1__fulfillment">
                <legend>Fulfillment Method<span className="order-step1__required"> *</span></legend>
                <div className="order-step1__radio-options">
                  <label className="order-step1__radio">
                    <input
                      type="radio"
                      name="fulfillmentMethod"
                      value="pickup"
                      checked={fulfillmentMethod === "pickup"}
                      onChange={() => setFulfillmentMethod("pickup")}
                    />
                    <span>Pickup</span>
                  </label>
                  <label className="order-step1__radio">
                    <input
                      type="radio"
                      name="fulfillmentMethod"
                      value="delivery"
                      checked={fulfillmentMethod === "delivery"}
                      onChange={() => setFulfillmentMethod("delivery")}
                    />
                    <span>Delivery</span>
                  </label>
                </div>
              </fieldset>
              {fulfillmentMethod === "delivery" ? (
                <CustomerField
                  id="customer-address"
                  className="order-step1__field--wide"
                  label="Delivery / Pickup Address"
                  autoComplete="street-address"
                  value={form.address}
                  inputRef={addressInputRef}
                  onChange={e => updateStep1Field("address", e.target.value)}
                  placeholder="Barangay, City, Province"
                  required
                  error={step1Errors.address}
                />
              ) : (
                <div className="order-step1__pickup-note" role="status">
                  Pickup selected. You will collect your order in person; an address is not needed.
                </div>
              )}
              <div className="order-step1__actions">
                <Btn onClick={handleStep1Next}>Next →</Btn>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="order-step2">
            <section className="order-step2__section">
              <h3>Product</h3>
              <div className="order-step2__product-grid">
                <div className="order-step2__field">
                  <label htmlFor="order-product">Select Product <span>*</span></label>
                  <select
                    id="order-product"
                    ref={productSelectRef}
                    className="order-step2__control"
                    value={product ? String(product.id) : ""}
                    onChange={event => {
                      const selected = catalogProducts.find(item => String(item.id) === event.target.value);
                      f("productId", selected?.id || "");
                      f("quantity", 1);
                    }}
                    required
                    aria-invalid={step2Attempted && !product}
                    aria-describedby={step2Attempted && !product ? "order-product-error" : undefined}
                  >
                    <option value="">Select a product</option>
                    {catalogProducts.map(item => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                  {step2Attempted && !product && (
                    <p className="order-step2__error" id="order-product-error">Select a product to continue.</p>
                  )}
                </div>
                {product && (
                  <div className="order-step2__product-summary">
                    {isProductImage(product.image) && (
                      <img src={product.image} alt={product.name} />
                    )}
                    <div className="order-step2__product-info">
                      <strong>{product.name}</strong>
                      <span>₱{Number(product.price).toLocaleString()} {product.unit || "per piece"}</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="order-step2__quantity-grid">
                <div className="order-step2__field">
                  <label htmlFor="order-quantity">Quantity <span>*</span></label>
                  <input
                    id="order-quantity"
                    ref={quantityInputRef}
                    className="order-step2__control"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step="1"
                    value={form.quantity}
                    onChange={event => f("quantity", event.target.value)}
                    required
                    aria-invalid={step2Attempted && Boolean(quantityError)}
                    aria-describedby={step2Attempted && quantityError ? "order-quantity-error" : undefined}
                  />
                  {step2Attempted && quantityError && (
                    <p className="order-step2__error" id="order-quantity-error">{quantityError}</p>
                  )}
                </div>
              </div>
            </section>

            <section className="order-step2__section">
              <h3>Printing Specifications</h3>
              {productSpecType === "clothing" && (
                <div className="order-step2__fields">
                  <Input label="Size" type="select" value={form.specificationDetails.size || ""} onChange={value => updateSpecification("size", value)} options={["XS", "Small", "Medium", "Large", "XL", "2XL", "3XL"]} />
                </div>
              )}
              {productSpecType === "schoolId" && (
                <div className="order-step2__fields">
                  <Input label="ID Type / Style" value={form.specificationDetails.idStyle || ""} onChange={value => updateSpecification("idStyle", value)} placeholder="e.g. school ID, PVC, lanyard style" />
                </div>
              )}
              {(productSpecType === "banner" || productSpecType === "backdrop") && (
                <div className="order-step2__fields">
                  <Input label="Width" type="number" min="0" step="any" value={form.specificationDetails.width || ""} onChange={value => updateSpecification("width", value)} placeholder="Width" />
                  <Input label="Height" type="number" min="0" step="any" value={form.specificationDetails.height || ""} onChange={value => updateSpecification("height", value)} placeholder="Height" />
                  <Input label="Unit" type="select" value={form.specificationDetails.unit || ""} onChange={value => updateSpecification("unit", value)} options={["inches", "feet"]} />
                  {productSpecType === "banner" && (
                    <Input label="Orientation" type="select" value={form.specificationDetails.orientation || ""} onChange={value => updateSpecification("orientation", value)} options={["Portrait", "Landscape"]} />
                  )}
                </div>
              )}
              {productSpecType === "mug" && (
                <div className="order-step2__fields">
                  <Input label="Print Side" type="select" value={form.specificationDetails.printSide || ""} onChange={value => updateSpecification("printSide", value)} options={["One Side", "Both Sides", "Wrap Around"]} />
                </div>
              )}
              {productSpecType === "sticker" && (
                <div className="order-step2__fields">
                  <Input label="Width" type="number" min="0" step="any" value={form.specificationDetails.width || ""} onChange={value => updateSpecification("width", value)} placeholder="Width" />
                  <Input label="Height" type="number" min="0" step="any" value={form.specificationDetails.height || ""} onChange={value => updateSpecification("height", value)} placeholder="Height" />
                  <Input label="Unit" type="select" value={form.specificationDetails.unit || ""} onChange={value => updateSpecification("unit", value)} options={["cm", "inches"]} />
                  <Input label="Shape" type="select" value={form.specificationDetails.shape || ""} onChange={value => updateSpecification("shape", value)} options={["Square", "Rectangle", "Circle", "Custom"]} />
                </div>
              )}
            </section>

            <section className="order-step2__section">
              <h3>Special Instructions</h3>
              <Input
                label="Special Instructions (optional)"
                type="textarea"
                value={form.specialInstructions}
                onChange={value => f("specialInstructions", value)}
                placeholder="Tell us about your preferred colors, placement, text, or other printing details..."
                rows={4}
              />
            </section>

            <section className="order-step2__total">
              <h3>Total Price</h3>
              <div>
                <span>{product ? `₱${Number(product.price).toLocaleString()} × ${quantityText || 0} ${product.unit || "per piece"}` : "Select a product"}</span>
                <strong>₱{total.toLocaleString()}</strong>
              </div>
            </section>

            <div className="order-step2__actions">
              <Btn variant="ghost" onClick={() => setStep(1)}>← Back</Btn>
              <Btn onClick={handleStep2Next}>Next →</Btn>
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
