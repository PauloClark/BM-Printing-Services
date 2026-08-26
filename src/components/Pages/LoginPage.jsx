import { useState } from "react";
import { C } from "../../constants/colors";
import { store } from "../../utils/storage";
import { Card } from "../Common/Card";
import { Btn } from "../Common/Btn";
import { Input } from "../Common/Input";
import { BMLogo } from "../Common/BMLogo";

export const LoginPage = ({ setPage, onLogin, showToast }) => {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    if (!email || !pass) {
      showToast("Enter email and password", "error");
      return;
    }
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: pass })
      });
      const data = await response.json();

      if (!response.ok || !data.user) {
        throw new Error(data.error || "Invalid email or password.");
      }

      const user = data.user;
      await store.set("session", user);
      onLogin(user);
      setPage(user.role === "admin" ? "admin" : "home");
      showToast(`Welcome back, ${user.name}!`, "success");
    } catch (error) {
      showToast(error.message || "Invalid email or password.", "error");
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
      <Card style={{ width: "100%", maxWidth: 400 }}>
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
            Welcome Back
          </h2>
          <p
            style={{
              color: C.gray400,
              fontSize: 13,
              marginTop: 4
            }}
          >
            Login to your BM Printing account
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Input
            label="Email Address"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="your@email.com"
          />
          <Input
            label="Password"
            type="password"
            value={pass}
            onChange={setPass}
            placeholder="••••••••"
          />
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
            Login
          </Btn>
          <p
            style={{
              textAlign: "center",
              fontSize: 13,
              color: C.gray400
            }}
          >
            Don't have an account?{" "}
            <button
              onClick={() => setPage("register")}
              style={{
                color: C.red,
                background: "none",
                border: "none",
                cursor: "pointer",
                fontWeight: 700
              }}
            >
              Register
            </button>
          </p>
          <div
            style={{
              background: C.infoBg,
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 12,
              color: C.info
            }}
          >
            <strong>Admin demo:</strong> admin@bm.com / admin123
          </div>
        </div>
      </Card>
    </div>
  );
};
