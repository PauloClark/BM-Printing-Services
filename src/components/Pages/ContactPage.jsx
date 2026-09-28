import { useState } from "react";
import { store } from "../../utils/storage";
import { generateId } from "../../utils/helpers";
import { Card } from "../Common/Card";
import { Btn } from "../Common/Btn";
import { Input } from "../Common/Input";
import "./ContactPage.css";

export const ContactPage = ({ showToast }) => {
  const [form, setForm] = useState({
    name: "",
    email: "",
    subject: "",
    message: ""
  });
  const [loading, setLoading] = useState(false);
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const send = async () => {
    if (!form.name || !form.email || !form.message) {
      showToast("Please fill all fields", "error");
      return;
    }
    setLoading(true);
    const msg = {
      ...form,
      date: new Date().toISOString().split("T")[0],
      id: generateId()
    };
    const existing = (await store.get("messages")) || [];
    await store.set("messages", [...existing, msg]);
    showToast("Message sent! We'll respond within the day.", "success");
    setForm({ name: "", email: "", subject: "", message: "" });
    setLoading(false);
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
              <Btn style={{ width: "100%" }} onClick={send} loading={loading}>
                Send Message
              </Btn>
            </div>
          </section>

          <section className="bm-contact-information" aria-labelledby="bm-contact-info-title">
            <h2 id="bm-contact-info-title">Contact Information</h2>
            <div className="bm-contact-info-grid">
              <div className="bm-contact-info-item">
                <img src="/icons/phone-icon.png" alt="" />
                <div>
                  <h3>Phone</h3>
                  <a href="tel:+639083045001">0908 304 5001 / 0997 642 0849</a>
                </div>
              </div>
              <div className="bm-contact-info-item">
                <img src="/icons/gmail-icon.png" alt="" />
                <div>
                  <h3>Email</h3>
                  <a href="mailto:bmprintingservices11@gmail.com">bmprintingservices11@gmail.com</a>
                </div>
              </div>
              <div className="bm-contact-info-item">
                <img src="/icons/facebook-icon.png" alt="" />
                <div>
                  <h3>Facebook</h3>
                  <a href="https://www.facebook.com/BMPS01" target="_blank" rel="noreferrer">BMPS01</a>
                  <span>or Visit 'BM PS'</span>
                </div>
              </div>
              <div className="bm-contact-info-item">
                <img src="/icons/location-icon.png" alt="" />
                <div>
                  <h3>Location</h3>
                  <address>NHA Phase 2, R. Castillo Site and Services, Brgy. Gov. Duterte, Agdao, Davao City, Philippines</address>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="bm-contact-map">
          <iframe
            title="Map to BM Printing Services"
            src={`https://maps.google.com/maps?q=${encodeURIComponent("NHA Phase 2, R. Castillo Site and Services, Brgy. Gov. Duterte, Agdao, Davao City, Philippines")}&output=embed`}
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
          <a href="https://www.facebook.com/BMPS01" target="_blank" rel="noreferrer">Contact on Facebook</a>
          <a href="mailto:bmprintingservices11@gmail.com">Contact via Gmail</a>
        </div>
      </Card>
    </div>
  );
};
