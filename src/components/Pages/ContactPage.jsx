import { useEffect, useState } from "react";
import { Card } from "../Common/Card";
import { Btn } from "../Common/Btn";
import { Input } from "../Common/Input";
import { TurnstileWidget } from "../Common/TurnstileWidget";
import { BM_CONTACT } from "../../constants/contact";
import "./ContactPage.css";

// Turns a backend response into actionable copy. Without this, every failure
// mode (server down, missing route, rate limit, rejected Turnstile, validation)
// collapsed into one generic message that hid the real cause.
export function contactErrorMessage(status, data) {
  const fieldErrors = data?.fields ? Object.values(data.fields).filter(Boolean).join(" ") : "";
  const serverMessage = typeof data?.error === "string" ? data.error : "";

  if (status === 400 && fieldErrors) return fieldErrors;
  if (status === 400 && serverMessage) return serverMessage;
  if (status === 403) return "Security verification failed. Please try again.";
  if (status === 429) return serverMessage || "Too many messages sent. Please wait a few minutes and try again.";
  if (status === 404) {
    return "The contact service is not available on this server. Please restart the backend and try again.";
  }
  if ([502, 503, 504].includes(status)) {
    return serverMessage || "The contact service is temporarily unavailable. Please try again in a moment.";
  }
  if (status >= 500) return serverMessage || "Unable to send message. Please try again.";
  return serverMessage || "Unable to send message. Please try again.";
}

export const ContactPage = ({ showToast, user }) => {
  const [form, setForm] = useState({
    name: "",
    email: "",
    subject: "",
    message: ""
  });
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileStatus, setTurnstileStatus] = useState("loading");
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // Prefill identity from the verified session. Guests keep the blank fields.
  useEffect(() => {
    if (!user) return;
    setForm(p => ({
      ...p,
      name: p.name || user.name || "",
      email: p.email || user.email || ""
    }));
  }, [user]);

  // A fresh challenge is required for each guest submission.
  const resetTurnstile = () => {
    setTurnstileToken("");
    setTurnstileResetSignal(signal => signal + 1);
  };

  const send = async () => {
    if (loading) return;
    setSent(false);

    const hasValue = key => form[key].trim().length > 0;
    if (!hasValue("name") || !hasValue("email") || !hasValue("subject") || !hasValue("message")) {
      showToast("Please fill in your name, email, subject and message.", "error");
      return;
    }

    if (!user && !turnstileToken) {
      const message = turnstileStatus === "unavailable"
        ? "Security verification is temporarily unavailable. Please try again."
        : "Please complete the security verification.";
      showToast(message, "error");
      return;
    }

    setLoading(true);
    try {
      const headers = { "Content-Type": "application/json" };
      // Authenticated customers reuse the existing session; identity is derived
      // server-side and no user ID is ever sent from the browser.
      if (user?.authProvider === "supabase") {
        const { supabase } = await import("../../utils/supabaseClient");
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (data.session?.access_token) {
          headers.Authorization = `Bearer ${data.session.access_token}`;
        }
      }

      const response = await fetch("/api/contact/messages", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          subject: form.subject,
          message: form.message,
          turnstileToken: user ? undefined : turnstileToken
        })
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        // A consumed or rejected Turnstile token must be renewed before retrying.
        if (!user) resetTurnstile();
        throw new Error(contactErrorMessage(response.status, data));
      }

      setSent(true);
      showToast("Message sent! We'll respond within the day.", "success");
      setForm(p => ({
        name: user?.name || p.name,
        email: user?.email || p.email,
        subject: "",
        message: ""
      }));
      if (!user) resetTurnstile();
    } catch (error) {
      // A thrown fetch means the request never reached the backend at all.
      const message = error instanceof TypeError
        ? "Cannot reach the server. Please check that the backend is running, then try again."
        : (error.message || "Unable to send message. Please try again.");
      showToast(message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fade-in bm-contact-page">
      <div className="bm-contact-main">
        <div className="bm-contact-left">
          <section className="bm-contact-form-section" aria-labelledby="bm-contact-title">
            <p className="bm-contact-eyebrow">CONTACT US</p>
            <h1 id="bm-contact-title" className="bm-contact-title">
              Get in <span>Touch</span>
            </h1>
            <p className="bm-contact-subtitle">
              Have questions? Send us a message and we'll respond within the day.
            </p>

            <div className="bm-contact-form-fields">
              <div className="bm-contact-name-email">
                <Input
                  label="Name"
                  value={form.name}
                  onChange={v => f("name", v)}
                  placeholder="Your name"
                />
                <Input
                  label="Email"
                  type="email"
                  value={form.email}
                  onChange={v => f("email", v)}
                  placeholder="your@email.com"
                />
              </div>
              <Input
                label="Subject"
                value={form.subject}
                onChange={v => f("subject", v)}
                placeholder="What's this about?"
              />
              <Input
                label="Message"
                type="textarea"
                value={form.message}
                onChange={v => f("message", v)}
                placeholder="Tell us more..."
                rows={5}
              />
              {!user && (
                <div className="bm-contact-turnstile">
                  <TurnstileWidget
                    resetSignal={turnstileResetSignal}
                    onTokenChange={setTurnstileToken}
                    onStatusChange={setTurnstileStatus}
                  />
                </div>
              )}
              {sent && (
                <p className="bm-contact-success" role="status">
                  Message sent successfully. We&apos;ll respond within the day.
                </p>
              )}
              <Btn style={{ width: "100%" }} onClick={send} loading={loading} disabled={loading}>
                {loading ? "Sending..." : "Send Message"}
              </Btn>
            </div>
          </section>

          <section className="bm-contact-information" aria-labelledby="bm-contact-info-title">
            <h2 id="bm-contact-info-title">Contact Information</h2>
            <div className="bm-contact-info-grid">
              <div className="bm-contact-info-item">
                <span className="bm-contact-icon bm-contact-icon--phone"><img src="/icons/phone-icon.png" alt="" /></span>
                <div className="bm-contact-info-details">
                  <h3>Phone</h3>
                  <a href={BM_CONTACT.phoneHref}>{BM_CONTACT.phoneDisplay}</a>
                </div>
              </div>
              <div className="bm-contact-info-item">
                <span className="bm-contact-icon bm-contact-icon--email"><img src="/icons/gmail.webp" alt="" /></span>
                <div className="bm-contact-info-details">
                  <h3>Email</h3>
                  <a href={`mailto:${BM_CONTACT.email}`}>{BM_CONTACT.email}</a>
                </div>
              </div>
              <div className="bm-contact-info-item">
                <span className="bm-contact-icon bm-contact-icon--facebook"><img src="/icons/facebook.webp" alt="" /></span>
                <div className="bm-contact-info-details">
                  <h3>Facebook</h3>
                  <a href={BM_CONTACT.facebookUrl} target="_blank" rel="noreferrer">{BM_CONTACT.facebookLabel}</a>
                  <span>or Visit '{BM_CONTACT.facebookAlternative}'</span>
                </div>
              </div>
              <div className="bm-contact-info-item">
                <span className="bm-contact-icon bm-contact-icon--location"><img src="/icons/location-icon.png" alt="" /></span>
                <div className="bm-contact-info-details">
                  <h3>Location</h3>
                  <address>{BM_CONTACT.location}</address>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="bm-contact-map">
          <iframe
            title="Map to BM Printing Services"
            src={`https://maps.google.com/maps?q=${encodeURIComponent(BM_CONTACT.location)}&output=embed`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
        </div>
      </div>

      <Card className="bm-contact-payment">
        <div>
          <h2>Payment Assistance</h2>
          <p>
            To complete your payment, contact the BM Printing Services Admin or Owner directly to arrange and confirm it.
          </p>
        </div>
        <div className="bm-contact-payment-actions">
          <a href={BM_CONTACT.facebookUrl} target="_blank" rel="noreferrer">Contact on Facebook</a>
          <a href={`mailto:${BM_CONTACT.email}`}>Contact via Gmail</a>
        </div>
      </Card>
    </div>
  );
};
