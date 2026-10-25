import { OrderReference } from '../Common/OrderReference';
import { specificationConfigFor, validateSpecifications } from '../../../shared/productSpecifications';
import { watchCatalog } from '../../utils/watchCatalog';
import { productAvailability } from '../../../shared/productStock';
import { useState, useRef, useEffect, useId } from "react";
import { C } from "../../constants/colors";
import { PRODUCTS } from "../../constants/products";
import { PAYMENT_METHODS } from "../../constants/paymentMethods";
import { orderApi } from "../../utils/orderApi";
import { publicAsset } from "../../utils/assets";
import { catalogSource } from "../../utils/catalogSource";
import { generateId } from "../../utils/helpers";
import { Card } from "../Common/Card";
import { Btn } from "../Common/Btn";

import "./OrderPage.css";


const money = value => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
const PAYMENT_OPTIONS = PAYMENT_METHODS.map(method => ({
  id: method.id,
  label: method.name,
  accountName: method.accountName,
  accountNumber: method.accountNumber,
  backendValue: method.backendValue
}));
const ORDER_STEPS = [
  { title: "Your Information", detail: "Contact and delivery details" },
  { title: "Product & Specifications", detail: "Choose product, size, paper, quantity" },
  { title: "Payment & Review", detail: "Confirm and place your order" }
];
const OrderIcon = ({ name }) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  {name === "user" ? <><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></> : name === "check" ? <path d="m5 12 4 4L19 6"/> : name === "arrow-left" ? <><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></> : name === "arrow-right" ? <><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></> : <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>}
</svg>;
// Local labeled controls keep the existing value/onChange contract.
const Input = ({ label, type, value, onChange, placeholder, required, options, rows }) => {
  const id = useId();
  const props = { id, value, onChange: e => onChange(e.target.value), required, className: "order-step2__control" };
  return <div className="order-step2__field"><label htmlFor={id}>{label}{required && <span> *</span>}</label>
    {type === "select" ? <select {...props}><option value="">Select...</option>{options.map(o => <option key={o} value={o}>{o}</option>)}</select> : <textarea {...props} placeholder={placeholder} rows={rows || 3}/>}
  </div>;
};
const OrderProgress = ({ step }) => <aside className="bm-order-sidebar" aria-label="Order progress">
  <section className="bm-order-progress">
    <div className="bm-order-progress-heading"><h2>Order Progress</h2><span aria-live="polite">{step} of 3</span></div>
    <progress value={step} max="3" aria-label="Order progress" />
    <ol>{ORDER_STEPS.map((item, i) => <li key={item.title} className={step === i + 1 ? "is-current" : step > i + 1 ? "is-complete" : ""} aria-current={step === i + 1 ? "step" : undefined}>
      <span className="bm-order-progress-marker">{step > i + 1 ? <OrderIcon name="check"/> : i + 1}</span>
      <div><strong>{item.title}</strong><p>{item.detail}</p><small>{step === i + 1 ? "Current step" : step > i + 1 ? "Completed" : "Up next"}</small></div>
    </li>)}</ol>
  </section>
  <section className="bm-order-security"><OrderIcon name="lock"/><h2>Secure Ordering</h2><p>Review your details before submitting. Payment remains unverified until confirmed by the BM team.</p><span>Made for your ideas. Printed with care.</span></section>
</aside>;

const REMOVED_PRODUCT_NAMES = new Set([
  "Tote Bag Printing",
  "Tarpaulin Printing (per sqm)",
  "Pull-Up / Roll-Up Banner",
  "Keychain / Button Pin"
]);

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|pdf)$/i;
const MAX_DESIGN_FILE_SIZE = 10 * 1024 * 1024;

const SpecificationField = ({ field, value, onChange, error }) => (
  <div className="order-step2__field">
    <label htmlFor={`spec-${field.key}`}>{field.label}{field.required && <span> *</span>}</label>
    {field.type === "select" ? (
      <select
        id={`spec-${field.key}`}
        className="order-step2__control"
        value={value || ""}
        onChange={event => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `spec-${field.key}-error` : undefined}
      >
        <option value="">Select...</option>
        {field.options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    ) : (
      <input
        id={`spec-${field.key}`}
        className="order-step2__control"
        type={field.type || "text"}
        min={field.min}
        step={field.step}
        value={value || ""}
        onChange={event => onChange(event.target.value)}
        placeholder={field.placeholder}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `spec-${field.key}-error` : undefined}
      />
    )}
    {error && <p className="order-step2__error" id={`spec-${field.key}-error`}>{error}</p>}
  </div>
);

const fileToDataUrl = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error("Unable to read the selected design file."));
  reader.readAsDataURL(file);
});

const isProductImage = source =>
  typeof source === "string" && /^(\/|https?:\/\/|data:image\/)/i.test(source);

const normalizePhone = value => value.replace(/[\s()-]/g, "");

const validateCustomerInfo = (form, fulfillmentMethod, walkIn = false) => {
  const errors = {};
  const name = form.name.trim().replace(/\s+/g, " ");
  const email = form.email.trim();
  const phone = normalizePhone(form.phone);

  if (!name) errors.name = "Enter your full name.";
  if (!email && !walkIn) {
    errors.email = "Enter your email address.";
  } else if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    errors.email = "Enter a valid email address, such as juan@email.com.";
  }
  if (!phone && !walkIn) {
    errors.phone = "Enter your Philippine mobile number.";
  } else if (phone && !/^(09\d{9}|\+639\d{9})$/.test(phone)) {
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

export const OrderPage = ({ user, selectedProduct, setPage, addOrder, showToast, walkIn = false }) => {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const submittingRef = useRef(false);
  const orderIdRef = useRef(null);
  const formPanelRef = useRef(null);
  const previousStepRef = useRef(step);
  useEffect(() => {
    if (previousStepRef.current !== step) {
      formPanelRef.current?.focus({ preventScroll: true });
      formPanelRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
      previousStepRef.current = step;
    }
  }, [step]);
  const [fulfillmentMethod, setFulfillmentMethod] = useState("pickup");
  const [step1Errors, setStep1Errors] = useState({});
  const [catalogProducts, setCatalogProducts] = useState([]);
  const [step2Attempted, setStep2Attempted] = useState(false);
  const [specificationErrors, setSpecificationErrors] = useState({});
  const [form, setForm] = useState({
    name: (!walkIn && user?.name) || "",
    email: (!walkIn && user?.email) || "",
    phone: (!walkIn && user?.phone) || "",
    address: (!walkIn && user?.address) || "",
    productId: selectedProduct && !REMOVED_PRODUCT_NAMES.has(selectedProduct.name) ? selectedProduct.id : "",
    quantity: 1,
    specs: "",
    specificationDetails: {},
    designFile: null,
    specialInstructions: "",
    paymentMethod: walkIn ? "cash" : "",
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
    if (!user || walkIn) return;
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
        const data = await orderApi("/api/products", { cache: "no-store" });
        const source = catalogSource(data, PRODUCTS);
        if (!source) return;
        const activeProducts = source
          .filter(item => !REMOVED_PRODUCT_NAMES.has(item.name))
          .map(item => {
            const local = PRODUCTS.find(product => Number(product.id) === Number(item.id));
            return {
              ...local,
              ...item,
              id: item.id ?? local?.id,
              name: item.name,
              price: Number(item.price ?? 0),
              minQty: Number(item.minQty || 1),
              category: item.category || local?.category || "Printing",
              unit: item.unit || "per piece",
              image: item.image ? publicAsset(item.image) : "",
              popular: Boolean(item.popular),
              trackStock: Boolean(item.trackStock),
              stock: Number(item.stock || 0),
              lowStockThreshold: Number(item.lowStockThreshold || 0)
            };
          });

        if (!cancelled) setCatalogProducts(activeProducts);
      } catch {}
    };

    const stopWatching = watchCatalog(loadActiveProducts);
    return () => {
      stopWatching();
      cancelled = true;
    };
  }, []);

  const product = catalogProducts.find(item => String(item.id) === String(form.productId)) ||
    catalogProducts.find(item => item.name === form.productId) || null;
  const specificationConfig = specificationConfigFor(product);
  const quantityText = String(form.quantity ?? "");
  const quantityValue = Number(quantityText);
  const quantityError = !quantityText.trim()
    ? "Enter a quantity of at least 1."
    : !/^\d+$/.test(quantityText) || !Number.isSafeInteger(quantityValue)
      ? "Enter a whole-number quantity of at least 1."
      : quantityValue < (product?.minQty || 1)
        ? `Quantity must be at least ${product?.minQty || 1}.`
        : product?.trackStock && product.stock <= 0
          ? "This product is out of stock."
          : product?.trackStock && quantityValue > product.stock
            ? `Only ${product.stock} item${product.stock === 1 ? '' : 's'} currently available.`
        : "";
  const total = product ? product.price * Math.max(0, quantityValue || 0) : 0;
  const selectedPaymentMethod = PAYMENT_OPTIONS.find(item => item.id === form.paymentMethod);
  const validOrder = Boolean(user && product && product.active !== false && !quantityError && form.designFile &&
    Object.keys(validateCustomerInfo(form, fulfillmentMethod, walkIn)).length === 0 &&
    specificationConfig.required.every(key => {
      const field = specificationConfig.fields.find(item => item.key === key);
      const value = String(form.specificationDetails[key] || "").trim();
      return value && (field?.type !== "number" || (Number.isFinite(Number(value)) && Number(value) > 0));
    }));
  const canPay = validOrder && confirmed && PAYMENT_OPTIONS.some(item => item.id === form.paymentMethod);
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
      setStep1Errors(validateCustomerInfo(nextForm, fulfillmentMethod, walkIn));
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
    const errors = validateCustomerInfo(normalizedForm, fulfillmentMethod, walkIn);
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
    const errors = validateSpecifications(product, form.specificationDetails);
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
    specificationConfig.required.forEach(key => {
      const field = specificationConfig.fields.find(item => item.key === key);
      const value = String(form.specificationDetails[key] || "").trim();
      if (!value) errors[key] = "This field is required.";
      else if (field?.type === "number" && (!Number.isFinite(Number(value)) || Number(value) <= 0)) {
        errors[key] = "Enter a value greater than 0.";
      }
    });
    if (!form.designFile) errors.designFile = "Upload a design or reference image to continue.";
    setSpecificationErrors(errors);
    const firstError = Object.keys(errors)[0];
    if (firstError) {
      const invalidField = document.getElementById(firstError === "designFile" ? "order-design-file" : `spec-${firstError}`);
      invalidField?.focus();
      invalidField?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setStep(3);
  };

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    if (!canPay) {
      showToast("Please fill in all required fields.", "error");
      return;
    }
    submittingRef.current = true;
    setLoading(true);
    const specificationLines = specificationConfig.fields
      .filter(field => String(form.specificationDetails[field.key] || "").trim())
      .map(field => `${field.label}: ${String(form.specificationDetails[field.key]).trim()}`);
    const orderSpecs = [
      ...specificationLines,
      `Design: ${form.designFile.name}`,
      String(form.specialInstructions || "").trim()
        ? `Additional Notes: ${String(form.specialInstructions).trim()}`
        : ""
    ].filter(Boolean).join("\n");
    let designFile;
    try {
      designFile = { filename: form.designFile.name, base64: await fileToDataUrl(form.designFile) };
    } catch (error) {
      setLoading(false);
      submittingRef.current = false;
      showToast(error.message, "error");
      return;
    }
    orderIdRef.current ||= "ORD-" + generateId();
    const order = {
      id: orderIdRef.current,
      customer: form.name,
      email: form.email,
      phone: form.phone,
      address: fulfillmentMethod === "pickup" ? "Pickup" : form.address.trim(),
      product: product.name,
      productId: product.id,
      quantity: Number(form.quantity),
      specs: orderSpecs,
      specificationDetails: form.specificationDetails,
      fulfillmentMethod,
      designNotes: orderSpecs,
      designFile,
      payment: selectedPaymentMethod?.backendValue,
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
      const createdOrder = walkIn ? (await orderApi("/api/admin/orders/walk-in", { method: "POST", body: JSON.stringify(order) }, user)).order : await addOrder(order);
      setSubmitted(createdOrder);
    } catch (error) {
      showToast(error.message || "Unable to place your order. Please try again.", "error");
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  if (submitted) {
    const selectedPayment = PAYMENT_OPTIONS.find(option => option.backendValue === submitted.payment) || PAYMENT_OPTIONS.find(option => option.id === submitted.payment);
    const isCash = submitted.payment === 'cash';
    const copy = async value => {
      try { await navigator.clipboard.writeText(value); showToast('Order ID copied.', 'success'); }
      catch { showToast('Unable to copy the Order ID. Please select it manually.', 'error'); }
    };
    const summaryRows = [
      ['Order ID', submitted.id], ['Customer', submitted.customer], ['Product', submitted.product],
      ['Specifications', submitted.specs || 'None recorded'], ['Quantity', submitted.quantity],
      ['Payment method', selectedPayment?.name || submitted.payment],
      ['Payment status', submitted.paymentStatus === 'Verified' ? 'Paid - verified by Admin' : 'Pending Payment']
    ];
    return <main className="bm-order-page bm-order-success-page">
      <section className="bm-order-success-banner" aria-labelledby="order-success-title">
        <span className="bm-order-success-check" aria-hidden="true"><OrderIcon name="check" /></span>
        <div className="bm-order-success-copy"><p className="bm-order-eyebrow">Order confirmation</p><h1 id="order-success-title">Order Saved Successfully!</h1><p>Your order has been received and is awaiting payment verification.</p></div>
        <div className="bm-order-success-id"><span>Order reference</span><strong>{submitted.id}</strong><button type="button" onClick={() => copy(submitted.id)}>Copy Order ID</button></div>
      </section>
      <div className="bm-order-success-grid">
        <section className="bm-success-card" aria-labelledby="saved-summary-title"><div className="bm-success-card-heading"><span className="bm-success-card-kicker">01</span><div><h2 id="saved-summary-title">Order Summary</h2><p>Review the details saved to your order.</p></div></div><dl className="bm-success-summary-list">{summaryRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}<div className="bm-success-total"><dt>Total price</dt><dd>{money(submitted.total)}</dd></div></dl></section>
        <section className="bm-success-card bm-payment-card" aria-labelledby="payment-instructions-title"><div className="bm-success-card-heading"><span className="bm-success-card-kicker">02</span><div><h2 id="payment-instructions-title">Payment Instructions</h2><p>{isCash ? 'Complete payment at the shop.' : 'Complete payment, then upload proof.'}</p></div></div>{isCash ? <div className="bm-cash-instructions"><strong>Cash - Pay at Shop</strong><p>Show your Order Reference at BM Printing Services and pay the full total in person.</p><p className="bm-payment-status"><span aria-hidden="true">&#9679;</span> Pending Payment</p></div> : <><p className="bm-payment-lead">Pay the full total and upload proof from My Orders.</p><div className="bm-payment-method-detail"><div><strong>{selectedPayment?.name || submitted.payment}</strong><span>{selectedPayment?.accountName}</span></div><div className="bm-payment-account"><strong>{selectedPayment?.accountNumber}</strong><button type="button" onClick={() => copy(selectedPayment?.accountNumber)}>Copy</button></div></div><p className="bm-payment-status"><span aria-hidden="true">&#9679;</span> Payment remains unverified until Admin confirms it.</p></>}</section>
      </div>
      <div className="bm-order-success-actions"><Btn onClick={() => setPage(walkIn ? 'orders' : 'myorders')}>{walkIn ? 'Return to Admin Orders' : 'View My Orders'}</Btn><OrderReference order={submitted} compact /><Btn variant="ghost" onClick={() => setPage('home')}>Back to Home</Btn></div>
      {walkIn && <p className="bm-walk-in-note">If cash was received, open this saved order in Admin Orders and confirm the amount received.</p>}
    </main>;
  }

  return (
    <main className="bm-order-page">
      <header className="bm-order-intro">
        <div><p className="bm-order-eyebrow">Custom printing made easy</p><h1>{walkIn ? "Create Walk-in Order" : "Place an Order"}</h1><p>Fill in the details below and we'll get started.<br/>It only takes a few minutes.</p></div>
        <div className="bm-order-art" aria-hidden="true">
          {[1, 9, 4].map(id => { const item = PRODUCTS.find(p => p.id === id); return item?.image ? <img key={id} src={item.image} alt=""/> : null; })}
          <span>Your ideas, in print.</span>
        </div>
      </header>
      <ol className="bm-order-steps" aria-label="Order steps">
        {ORDER_STEPS.map((item, i) => <li key={item.title} className={step === i + 1 ? "is-current" : ""} aria-current={step === i + 1 ? "step" : undefined}>
          <span className="bm-order-step-number">{String(i + 1).padStart(2, "0")}</span>
          <div><strong>{item.title}</strong><p>{item.detail}</p></div>
        </li>)}
      </ol>
      {!user ? (
        <section className="bm-order-auth" aria-labelledby="bm-order-auth-title">
          <span className="bm-order-auth-icon"><OrderIcon name="lock"/></span>
          <h2 id="bm-order-auth-title">Sign in to start your order</h2>
          <p>You need to be logged in before placing an order.<br/>Sign in to continue, or create an account if you're new to BM Printing Services.</p>
          <div className="bm-order-auth-actions">
            <Btn onClick={() => setPage("login")}>Log In</Btn>
            <Btn variant="ghost" onClick={() => setPage("register")}>Create Account</Btn>
          </div>
          <small>Your order details will be connected to your account so you can track its progress later.</small>
        </section>
      ) : (
      <div className="bm-order-layout">
      <section ref={formPanelRef} tabIndex={-1} className="bm-order-form" aria-label={ORDER_STEPS[step - 1].title}>
        {step === 1 && (
          <div className="order-step1">
            <div className="bm-order-section-heading"><span><OrderIcon name="user"/></span><div><h2>Customer Information</h2><p>Let us know who you are and where to deliver your order.</p></div></div>
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
                required={!walkIn}
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
                placeholder="+63 9XX XXX XXXX"
                required={!walkIn}
                error={step1Errors.phone}
              />
              {fulfillmentMethod === "delivery" ? (
                <CustomerField
                  id="customer-address"
                  
                  label="Delivery Address"
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
              <div className="order-step1__field--wide"><Input label="Additional Notes (Optional)" type="textarea" value={form.notes} onChange={v => f("notes", v)} placeholder="Landmark, preferred delivery time, or special instructions" rows={3}/></div>
              <div className="order-step1__actions">
                <Btn variant="ghost" onClick={() => setPage("products")}><OrderIcon name="arrow-left" />Back</Btn>
                <Btn onClick={handleStep1Next}>Next Step<OrderIcon name="arrow-right" /></Btn>
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
                      setForm(current => ({
                        ...current,
                        productId: selected?.id || "",
                        quantity: 1,
                        specificationDetails: {},
                        designFile: null,
                        specialInstructions: ""
                      }));
                      setSpecificationErrors({});
                    }}
                    required
                    aria-invalid={step2Attempted && !product}
                    aria-describedby={step2Attempted && !product ? "order-product-error" : undefined}
                  >
                    <option value="">Select a product</option>
                    {catalogProducts.map(item => (
                      <option key={item.id} value={item.id} disabled={item.active === false || (item.trackStock && item.stock <= 0)}>
                        {item.name} - {productAvailability({ ...item, active: item.active !== false }).label}
                      </option>
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
                      <span>PHP {Number(product.price).toLocaleString()} {product.unit || "per piece"}</span>
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
                    min={product?.minQty || 1}
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
              {product ? (
                <div className="order-step2__fields">
                  {specificationConfig.fields.map(field => (
                    <SpecificationField
                      key={field.key}
                      field={field}
                      value={form.specificationDetails[field.key]}
                      onChange={value => updateSpecification(field.key, value)}
                      error={step2Attempted ? specificationErrors[field.key] : ""}
                    />
                  ))}
                  <div className="order-step2__field order-step2__field--wide">
                    <label htmlFor="order-design-file">{specificationConfig.uploadLabel} <span>*</span></label>
                    <input
                      id="order-design-file"
                      className="order-step2__control"
                      type="file"
                      accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                      aria-invalid={Boolean(step2Attempted && specificationErrors.designFile)}
                      aria-describedby={step2Attempted && specificationErrors.designFile ? "order-design-file-error" : undefined}
                      onChange={event => {
                        const file = event.target.files?.[0] || null;
                        let error = "";
                        if (file && (!IMAGE_TYPES.has(file.type) || !IMAGE_EXTENSIONS.test(file.name))) {
                          error = "Choose a JPG, JPEG, PNG, WEBP, or PDF file.";
                        } else if (file && file.size > MAX_DESIGN_FILE_SIZE) {
                          error = "The image must be 10 MB or smaller.";
                        }
                        setForm(current => ({ ...current, designFile: error ? null : file }));
                        setSpecificationErrors(current => ({ ...current, designFile: error }));
                        if (event.target.value && error) event.target.value = "";
                      }}
                    />
                    {form.designFile && <p className="order-step2__file-name">Selected: {form.designFile.name}</p>}
                    {step2Attempted && specificationErrors.designFile && (
                      <p className="order-step2__error" id="order-design-file-error">{specificationErrors.designFile}</p>
                    )}
                  </div>
                </div>
              ) : <p>Select a product to see its specifications.</p>}
            </section>

            <section className="order-step2__section">
              <h3>Special Instructions</h3>
              <Input
                label="Additional Notes (optional)"
                type="textarea"
                value={form.specialInstructions}
                onChange={value => f("specialInstructions", value)}
                placeholder="Describe any other requirements or design details..."
                rows={4}
              />
            </section>

            <section className="order-step2__total">
              <h3>Total Price</h3>
              <div>
                <span>{product ? `PHP ${Number(product.price).toLocaleString()} x ${quantityText || 0} ${product.unit || "per piece"}` : "Select a product"}</span>
                <strong>PHP {total.toLocaleString()}</strong>
              </div>
            </section>

            <div className="order-step2__actions">
              <Btn variant="ghost" onClick={() => setStep(1)}><OrderIcon name="arrow-left" />Back</Btn>
              <Btn onClick={handleStep2Next}>Next Step<OrderIcon name="arrow-right" /></Btn>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="order-step3">
            <div className="bm-order-section-heading"><span><OrderIcon name="lock"/></span><div><h2>Payment &amp; Review</h2><p>Review your order and choose your payment method.</p></div></div>

            <div className="order-step3__grid">
              <section className="order-step3__summary" aria-labelledby="order-summary-title">
                <h3 id="order-summary-title">Order Summary</h3>
                <dl>{[
                  ["Customer", form.name], ["Email", form.email], ["Phone", form.phone],
                  ["Fulfillment", fulfillmentMethod === "pickup" ? "Pickup" : "Delivery"],
                  ...(fulfillmentMethod === "delivery" ? [["Address", form.address]] : []),
                  ["Product", product?.name], ["Quantity", form.quantity], ["Unit price", money(product?.price || 0)],
                  ...specificationConfig.fields.filter(field => String(form.specificationDetails[field.key] || "").trim())
                    .map(field => [field.label, form.specificationDetails[field.key]]),
                  ["Design / reference", form.designFile?.name || "None uploaded"],
                  ...(form.notes.trim() ? [["Order notes", form.notes.trim()]] : []),
                  ...(form.specialInstructions.trim() ? [["Special instructions", form.specialInstructions.trim()]] : [])
                ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
              </section>
              <div className="order-step3__payment">
                <section className="order-step3__prices" aria-labelledby="payment-summary-title">
                  <h3 id="payment-summary-title">Price Summary</h3>
                  <dl>
                    <div><dt>Total Price</dt><dd>{money(total)}</dd></div>
                    <div className="order-step3__total-summary"><dt>Full total due</dt><dd>{money(total)}</dd></div>
                  </dl>
                </section>
                <fieldset className="order-step3__wallets"><legend>Payment Method</legend>
                  <div>{PAYMENT_OPTIONS.filter(option => !walkIn || option.id === "cash").map(option => <label key={option.id} className={form.paymentMethod === option.id ? "is-selected" : ""}>
                    <input type="radio" name="paymentMethod" value={option.id} checked={form.paymentMethod === option.id} onChange={() => { f("paymentMethod", option.id); setConfirmed(false); }}/>
                    <span><strong>{option.label}</strong><small>{option.accountName}</small></span>
                  </label>)}</div>
                </fieldset>
              </div>
            </div>
            <div aria-live="polite">
              <p className="bm-order-payment-notice">{form.paymentMethod === "cash" ? "Pay in person at BM Printing Services. Present your saved order reference at the shop. No payment screenshot is required." : "Pay the full total and upload proof from My Orders after saving. Payment awaits Admin verification."}</p>
            </div>
            <label className="order-step3__confirmation"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/><span>I confirm that the order details above are correct and I will pay the full total.</span></label>
            <div className="order-step3__actions">
              <Btn variant="ghost" disabled={loading} onClick={() => setStep(2)}>&larr; Back</Btn>
              <Btn size="lg" onClick={handleSubmit} disabled={!canPay} loading={loading}>Submit Order</Btn>
            </div>
          </div>
        )}
      </section>
      <OrderProgress step={step}/>
      </div>
      )}
    </main>
  );
};
