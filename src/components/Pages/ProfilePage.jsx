import { useState } from "react";
import { C } from "../../constants/colors";
import { store } from "../../utils/storage";
import { Card } from "../Common/Card";
import { Btn } from "../Common/Btn";
import { Input } from "../Common/Input";

export const ProfilePage = ({ user, setUser, showToast }) => {
  const [form, setForm] = useState({
    name: user?.name || "",
    phone: user?.phone || "",
    address: user?.address || ""
  });
  const [pwForm, setPwForm] = useState({
    current: "",
    new: "",
    confirm: ""
  });
  const [saving, setSaving] = useState(false);

  const saveProfile = async () => {
    setSaving(true);
    const updated = { ...user, ...form };
    await store.set(`user:${user.id}`, updated);
    setUser(updated);
    showToast("Profile updated!", "success");
    setSaving(false);
  };

  const changePassword = async () => {
    if (pwForm.new !== pwForm.confirm) {
      showToast("Passwords don't match", "error");
      return;
    }
    if (pwForm.new.length < 6) {
      showToast("Password must be at least 6 characters", "error");
      return;
    }
    const stored = await store.get(`user:${user.id}`);
    if (stored?.password && stored.password !== pwForm.current) {
      showToast("Current password is incorrect", "error");
      return;
    }
    await store.set(`user:${user.id}`, { ...stored, password: pwForm.new });
    showToast("Password changed!", "success");
    setPwForm({ current: "", new: "", confirm: "" });
  };

  return (
    <div
      style={{
        maxWidth: 700,
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
        My Profile
      </h1>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <Card>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              marginBottom: 24
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: C.red,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "Montserrat",
                fontWeight: 800,
                fontSize: 28
              }}
            >
              {user?.name?.[0] || "U"}
            </div>
            <div>
              <div
                style={{
                  fontFamily: "Montserrat",
                  fontWeight: 700,
                  fontSize: 20
                }}
              >
                {user?.name}
              </div>
              <div style={{ color: C.gray600 }}>{user?.email}</div>
              <div
                style={{
                  fontSize: 12,
                  background: C.infoBg,
                  color: C.info,
                  padding: "2px 8px",
                  borderRadius: 10,
                  display: "inline-block",
                  marginTop: 4
                }}
              >
                {user?.role === "admin" ? "Administrator" : "Customer"}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Input
              label="Full Name"
              value={form.name}
              onChange={v => setForm(f => ({ ...f, name: v }))}
            />
            <Input
              label="Phone Number"
              value={form.phone}
              onChange={v => setForm(f => ({ ...f, phone: v }))}
              placeholder="09XXXXXXXXX"
            />
            <Input
              label="Address"
              value={form.address}
              onChange={v => setForm(f => ({ ...f, address: v }))}
              placeholder="Your delivery address"
            />
            <Btn onClick={saveProfile} loading={saving}>
              Save Changes
            </Btn>
          </div>
        </Card>

        <Card>
          <h3
            style={{
              fontFamily: "Montserrat",
              fontWeight: 700,
              marginBottom: 16
            }}
          >
            Change Password
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Input
              label="Current Password"
              type="password"
              value={pwForm.current}
              onChange={v => setPwForm(p => ({ ...p, current: v }))}
            />
            <Input
              label="New Password"
              type="password"
              value={pwForm.new}
              onChange={v => setPwForm(p => ({ ...p, new: v }))}
            />
            <Input
              label="Confirm New Password"
              type="password"
              value={pwForm.confirm}
              onChange={v => setPwForm(p => ({ ...p, confirm: v }))}
            />
            <Btn variant="secondary" onClick={changePassword}>
              Update Password
            </Btn>
          </div>
        </Card>
      </div>
    </div>
  );
};
