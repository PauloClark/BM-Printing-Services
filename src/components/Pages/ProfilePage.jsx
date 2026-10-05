import { supabaseAppUser } from '../../../shared/roles';
import { orderApi } from '../../utils/orderApi';
import { useState } from "react";
import { C } from "../../constants/colors";
import { store } from "../../utils/storage";
import { Card } from "../Common/Card";
import { Btn } from "../Common/Btn";
import { Input } from "../Common/Input";

export const ProfilePage = ({ user, setUser, showToast }) => {
  const isSupabaseUser = user?.authProvider === "supabase";
  const profileName = user?.name || user?.user_metadata?.full_name || user?.user_metadata?.name || "";
  const profileAvatar = user?.avatar || user?.user_metadata?.avatar_url || user?.user_metadata?.picture || "";
  const [form, setForm] = useState({
    name: profileName,
    phone: user?.phone || "",
    address: user?.address || ""
  });
  const [pwForm, setPwForm] = useState({
    current: "",
    new: "",
    confirm: ""
  });
  const [saving, setSaving] = useState(false);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);

  const saveProfile = async () => {
    if (!form.name.trim()) { showToast('Enter your name.', 'error'); return; }
    setSaving(true);
    try {
      let updated;
      if (isSupabaseUser) {
        const { supabase } = await import('../../utils/supabaseClient');
        const { data, error } = await supabase.auth.updateUser({ data: {
          full_name: form.name.trim(), phone: form.phone.trim(), address: form.address.trim()
        } });
        if (error) throw error;
        updated = supabaseAppUser(data.user);
      } else {
        const data = await orderApi('/api/auth/profile', { method: 'PATCH', body: JSON.stringify(form) }, user);
        updated = { ...user, ...data.user };
        await store.set('session', updated);
      }
      setUser(updated);
      showToast('Profile updated!', 'success');
    } catch (error) { showToast(error.message || 'Unable to save profile.', 'error'); }
    finally { setSaving(false); }
  };

  const changePassword = async () => {
    if (pwForm.new !== pwForm.confirm || pwForm.new.length < 8) {
      showToast('Passwords must match and contain at least 8 characters.', 'error'); return;
    }
    setSaving(true);
    try {
      if (isSupabaseUser) {
        const { supabase } = await import('../../utils/supabaseClient');
        const { error: verifyError } = await supabase.auth.signInWithPassword({ email: user.email, password: pwForm.current });
        if (verifyError) throw verifyError;
        const { error } = await supabase.auth.updateUser({ password: pwForm.new });
        if (error) throw error;
      } else {
        await orderApi('/api/auth/password', { method: 'PATCH', body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.new }) }, user);
      }
      showToast('Password changed!', 'success');
      setPwForm({ current: '', new: '', confirm: '' });
    } catch (error) { showToast(error.message || 'Unable to update password.', 'error'); }
    finally { setSaving(false); }
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
              {isSupabaseUser && profileAvatar && !avatarLoadFailed ? (
                <img
                  src={profileAvatar}
                  alt={`${profileName || "Google"} profile`}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarLoadFailed(true)}
                  style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
                />
              ) : (
                profileName?.[0]?.toUpperCase() || "U"
              )}
            </div>
            <div>
              <div
                style={{
                  fontFamily: "Montserrat",
                  fontWeight: 700,
                  fontSize: 20
                }}
              >
                {profileName}
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
                {user?.role === "admin" ? "Administrator" : user?.role === "staff" ? "Staff" : "Customer"}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Input
              label="Full Name"
              value={form.name}
              onChange={v => setForm(f => ({ ...f, name: v }))}
            />
            {isSupabaseUser && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label htmlFor="profile-email" style={{ fontSize: 13, fontWeight: 600, color: C.gray600 }}>
                  Email Address
                </label>
                <input
                  id="profile-email"
                  type="email"
                  value={user.email || ""}
                  readOnly
                  aria-readonly="true"
                  style={{
                    boxSizing: "border-box",
                    width: "100%",
                    padding: "10px 14px",
                    border: `1.5px solid ${C.gray200}`,
                    borderRadius: 8,
                    background: C.gray50,
                    color: C.gray600,
                    fontSize: 14
                  }}
                />
              </div>
            )}
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

        {(!isSupabaseUser || user.hasPassword) && <Card>
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
            <Btn variant="secondary" onClick={changePassword} loading={saving}>
              Update Password
            </Btn>
          </div>
        </Card>}
      </div>
    </div>
  );
};
