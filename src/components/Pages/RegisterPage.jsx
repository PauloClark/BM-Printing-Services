import { useState } from "react";
import { C } from "../../constants/colors";
import { store } from "../../utils/storage";
import { generateId } from "../../utils/helpers";
import { Card } from "../Common/Card";
import { Btn } from "../Common/Btn";
import { Input } from "../Common/Input";
import { BMLogo } from "../Common/BMLogo";

export const RegisterPage = ({ setPage, onLogin, showToast }) => {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    pass: "",
    confirm: ""
  });
  const [loading, setLoading] = useState(false);
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handle = async () => {
    if (!form.name || !form.email || !form.phone || !form.pass) {
      showToast("Please fill all fields", "error");
      return;
    }
    if (form.pass !== form.confirm) {
      showToast("Passwords don't match", "error");
      return;
    }
    if (form.pass.length < 6) {
      showToast("Password must be at least 6 characters", "error");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone,
          password: form.pass
        })
      });
      const data = await response.json();

      if (!response.ok || !data.user) {
        throw new Error(data.error || "Unable to create account.");
      }

      const newUser = data.user;
      await store.set("session", newUser);
      onLogin(newUser);
      setPage("home");
      showToast("🎉 Account created! Welcome to BM Printing!", "success");
    } catch (error) {
      showToast(error.message || "Unable to create account.", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "70vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24
      }}
      className="fade-in"
    >
      <Card style={{ width: "100%", maxWidth: 440 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            <BMLogo size={56} />
          </div>
          <h2
            style={{
              fontFamily: "Montserrat",
              fontWeight: 800,
              fontSize: 22
            }}
          >
            Create Account
          </h2>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Input
            label="Full Name"
            value={form.name}
            onChange={v => f("name", v)}
            placeholder="Juan dela Cruz"
            required
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 14
            }}
          >
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={v => f("email", v)}
              required
            />
            <Input
              label="Phone"
              value={form.phone}
              onChange={v => f("phone", v)}
              placeholder="09XX-XXX-XXXX"
              required
            />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 14
            }}
          >
            <Input
              label="Password"
              type="password"
              value={form.pass}
              onChange={v => f("pass", v)}
              required
            />
            <Input
              label="Confirm Password"
              type="password"
              value={form.confirm}
              onChange={v => f("confirm", v)}
              required
            />
          </div>
          <Btn
            size="lg"
            onClick={handle}
            loading={loading}
            style={{
              width: "100%",
              justifyContent: "center",
              marginTop: 4
            }}
          >
            Create Account
          </Btn>
          <p
            style={{
              textAlign: "center",
              fontSize: 13,
              color: C.gray400
            }}
          >
            Already have an account?{" "}
            <button
              onClick={() => setPage("login")}
              style={{
                color: C.red,
                background: "none",
                border: "none",
                cursor: "pointer",
                fontWeight: 700
              }}
            >
              Login
            </button>
          </p>
        </div>
      </Card>
    </div>
  );
};
