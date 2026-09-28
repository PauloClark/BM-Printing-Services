import React, { useState } from 'react';
import { showToast } from '../../utils/notifications';
import { store } from '../../utils/storage';
import { GoogleAuthOption } from '../Common/GoogleAuthOption';

export const RegisterPage = ({ setPage, onLogin, showToast: notify }) => {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: ''
  });
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const register = async () => {
    if (!form.name || !form.email || !form.password) {
      notify?.('Please complete all required fields.', 'error');
      return;
    }

    if (form.password !== form.confirmPassword) {
      notify?.('Passwords do not match.', 'error');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone,
          password: form.password
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Unable to create account.');
      }

      if (!data.user) {
        throw new Error(data.error || 'Unable to create account.');
      }

      await store.set('session', { ...data.user, token: data.token });
      onLogin?.({ ...data.user, token: data.token });
      notify?.('Account created successfully.', 'success');
      setPage?.('home');
    } catch (error) {
      console.error('Registration failed:', error);
      notify?.(error.message || 'Unable to create account.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bm-internal-surface" style={{
      minHeight: 'calc(100vh - 70px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px 16px'
    }}>
      <div style={{
        width: '100%',
        maxWidth: 380,
        background: '#f4f4f4',
        border: '1px solid #d9d9d9',
        borderRadius: 8,
        boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
        padding: '28px 26px 20px',
        textAlign: 'center'
      }}>
        <div style={{
          width: 90,
          height: 90,
          margin: '0 auto 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          border: '1px solid #ddd',
          borderRadius: '50%',
          background: '#fff'
        }}>
          <img
            src="/bm-logo.png"
            alt="BM Printing Services"
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%', display: 'block', flexShrink: 0 }}
          />
        </div>

        <h2 style={{
          margin: '0 0 16px',
          fontSize: 29,
          fontWeight: 700,
          color: '#2a2a2a',
          fontFamily: 'Georgia, serif'
        }}>
          Create Account
        </h2>

        <div style={{ textAlign: 'left' }}>
          <label style={{ display: 'block', marginBottom: 8, fontSize: 12, color: '#444' }}>
            Full Name
          </label>
          <input
            name="name"
            value={form.name}
            onChange={onChange}
            required
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 12px',
              marginBottom: 12,
              border: '1px solid #cfcfcf',
              borderRadius: 4,
              fontSize: 14,
              background: '#fff'
            }}
          />

          <label style={{ display: 'block', marginBottom: 8, fontSize: 12, color: '#444' }}>
            Email
          </label>
          <input
            name="email"
            type="email"
            value={form.email}
            onChange={onChange}
            required
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 12px',
              marginBottom: 12,
              border: '1px solid #cfcfcf',
              borderRadius: 4,
              fontSize: 14,
              background: '#fff'
            }}
          />

          <label style={{ display: 'block', marginBottom: 8, fontSize: 12, color: '#444' }}>
            Phone
          </label>
          <input
            name="phone"
            value={form.phone}
            onChange={onChange}
            required
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 12px',
              marginBottom: 12,
              border: '1px solid #cfcfcf',
              borderRadius: 4,
              fontSize: 14,
              background: '#fff'
            }}
          />

          <label style={{ display: 'block', marginBottom: 8, fontSize: 12, color: '#444' }}>
            Password
          </label>
          <input
            name="password"
            type="password"
            value={form.password}
            onChange={onChange}
            required
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 12px',
              marginBottom: 12,
              border: '1px solid #cfcfcf',
              borderRadius: 4,
              fontSize: 14,
              background: '#fff'
            }}
          />

          <label style={{ display: 'block', marginBottom: 8, fontSize: 12, color: '#444' }}>
            Confirm Password
          </label>
          <input
            name="confirmPassword"
            type="password"
            value={form.confirmPassword}
            onChange={onChange}
            required
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 12px',
              marginBottom: 18,
              border: '1px solid #cfcfcf',
              borderRadius: 4,
              fontSize: 14,
              background: '#fff'
            }}
          />
        </div>

        <button
          type="button"
          onClick={register}
          disabled={loading || googleLoading}
          style={{
            width: '100%',
            background: '#8a1f1f',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            padding: '12px 16px',
            fontSize: 15,
            fontWeight: 600,
            cursor: loading || googleLoading ? 'not-allowed' : 'pointer',
            opacity: loading || googleLoading ? 0.8 : 1,
            marginBottom: 18
          }}
        >
          {loading ? 'Creating account...' : 'Create Account'}
        </button>

        <GoogleAuthOption
          disabled={loading}
          onLoadingChange={setGoogleLoading}
          onError={error => notify?.(error.message || 'Unable to connect with Google. Please try again.', 'error')}
        />

        <div style={{ fontSize: 13, color: '#666' }}>
          Already have an account?{' '}
          <button
            type="button"
            onClick={() => setPage?.('login')}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#8a1f1f',
              fontWeight: 600,
              cursor: 'pointer',
              padding: 0
            }}
          >
            Login
          </button>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
