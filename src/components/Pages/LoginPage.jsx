import React, { useState } from 'react';
import { store } from '../../utils/storage';
import { GoogleAuthOption } from '../Common/GoogleAuthOption';

export const LoginPage = ({ setPage, onLogin, showToast }) => {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const login = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pass })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Invalid email or password.');
      }

      if (!data.user) {
        throw new Error(data.error || 'Invalid email or password.');
      }

      const user = data.user;
      const token = data.token;
      await store.set('session', { ...user, token });
      onLogin?.({ ...user, token });
      showToast?.('Logged in successfully.', 'success');
      setPage?.('home');
    } catch (error) {
      console.error('Login failed:', error);
      showToast?.(error.message || 'Invalid email or password.', 'error');
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
          Welcome Back
        </h2>

        <p style={{
          margin: '0 0 18px',
          fontSize: 13,
          color: '#666',
          fontFamily: 'sans-serif'
        }}>
          Login in your BM Printing account
        </p>

        <div style={{ textAlign: 'left' }}>
          <label style={{ display: 'block', marginBottom: 8, fontSize: 12, color: '#444' }}>
            Email Address
          </label>
          <input
            value={email}
            onChange={e => setEmail(e.target.value)}
            type="email"
            required
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 12px',
              marginBottom: 16,
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
            value={pass}
            onChange={e => setPass(e.target.value)}
            type="password"
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
          onClick={login}
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
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.8 : 1,
            marginBottom: 18
          }}
        >
          {loading ? 'Logging in...' : 'Login'}
        </button>

        <GoogleAuthOption
          disabled={loading}
          onLoadingChange={setGoogleLoading}
          onError={error => showToast?.(error.message || 'Unable to connect with Google. Please try again.', 'error')}
        />

        <div style={{ fontSize: 13, color: '#666' }}>
          Don&apos;t have an account?{' '}
          <button
            type="button"
            onClick={() => setPage?.('register')}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#8a1f1f',
              fontWeight: 600,
              cursor: 'pointer',
              padding: 0
            }}
          >
            Register
          </button>
        </div>

        <div style={{ marginTop: 18, fontSize: 12, color: '#777' }}>
          Admin access requires an admin account registered in the system.
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
