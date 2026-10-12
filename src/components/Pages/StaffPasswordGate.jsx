import { useState } from 'react';
import { orderApi } from '../../utils/orderApi';

export function StaffPasswordGate({ user, onChanged }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async event => {
    event.preventDefault();
    if (password.length < 8 || password.length > 100) return setError('Password must contain 8–100 characters.');
    if (password !== confirm) return setError('The passwords do not match.');
    setSaving(true); setError('');
    try {
      await orderApi('/api/auth/staff/password', { method: 'PATCH', body: JSON.stringify({ newPassword: password }) }, user);
      setPassword(''); setConfirm(''); onChanged();
    } catch (requestError) { setError(requestError.message || 'Unable to change your password.'); }
    finally { setSaving(false); }
  };
  return <main className="bm-password-gate"><form onSubmit={submit} className="bm-password-gate__card">
    <span className="bm-password-gate__eyebrow">Account security</span><h1>Change your temporary password</h1>
    <p>Your administrator requires a private password before you can use staff operations.</p>
    <label>New password<input type="password" autoComplete="new-password" minLength="8" maxLength="100" required value={password} onChange={event => setPassword(event.target.value)} /></label>
    <label>Confirm new password<input type="password" autoComplete="new-password" minLength="8" maxLength="100" required value={confirm} onChange={event => setConfirm(event.target.value)} /></label>
    <small>Use at least 8 characters. Additional Supabase project password rules also apply.</small>
    {error && <div role="alert">{error}</div>}<button disabled={saving}>{saving ? 'Updating password…' : 'Update password and continue'}</button>
  </form></main>;
}
