import { useState } from "react";
import { C } from "../../constants/colors";
import { store } from "../../utils/storage";
import { generateId } from "../../utils/helpers";
import { Card } from "../Common/Card";
import { Btn } from "../Common/Btn";
import { Input } from "../Common/Input";

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
          marginBottom: 8
        }}
      >
        Contact Us
      </h1>
      <p style={{ color: C.gray600, marginBottom: 32 }}>
        Have questions? Send us a message and we'll respond within the day.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1.5fr",
          gap: 32
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {[
            ["🌎", "Google Maps", " https://maps.app.goo.gl/V4tzzj7vkaafMc2o7   "],
            ["📘", "Facebook", "https://www.facebook.com/BMPS01 or Visit 'BM PS'"],
            ["📧", "Email", "bmprintingservices11@gmail.com"],
            ["📱", "Phone", "0908 304 5001 / 0997 642 0849"],
            ["📍", "Location", "NHA Phase 2, R. Castillo Site and Services, Brgy. Gov. Duterte, Agdao, Davao City,Philippines"]
          ].map(([i, l, v]) => (
            <Card key={l}>
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center"
                }}
              >
                <span style={{ fontSize: 28 }}>{i}</span>
                <div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 14
                    }}
                  >
                    {l}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: C.gray600
                    }}
                  >
                    {v}
                  </div>
                </div>
              </div>
            </Card>
          ))}
          <Card
            style={{
              background: C.infoBg,
              borderColor: C.info,
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
              Contact Admin or Owner for Payment
            </h3>
            <p
              style={{
                fontSize: 13,
                color: C.info,
                marginBottom: 16
              }}
            >
              To complete your payment, please contact the BM Printing Services Admin or Owner directly. You may use Facebook or Gmail to arrange and confirm your payment.
            </p>
            <div style={{ display: "grid", gap: 10 }}>
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
        </div>

        <Card>
          <h3
            style={{
              fontFamily: "Montserrat",
              fontWeight: 700,
              marginBottom: 20
            }}
          >
            Send a Message
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 14
              }}
            >
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
            <Btn onClick={send} loading={loading}>
              Send Message
            </Btn>
          </div>
        </Card>
      </div>
    </div>
  );
};
