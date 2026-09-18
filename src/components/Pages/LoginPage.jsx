import React, { useState } from 'react';
import { store } from '../../utils/storage';

export const LoginPage = ({ setPage, onLogin, showToast }) => {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [loading, setLoading] = useState(false);

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
      await store.set('session', user);
      onLogin?.(user);
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
    <div style={{
      minHeight: 'calc(100vh - 70px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f3f3f3',
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
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <div style={{
            width: 62,
            height: 62,
            borderRadius: '50%',
            background: '#ffffff',
            border: '1px solid #d7d7d7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'Georgia, serif',
            fontWeight: 700,
            fontSize: 28,
            color: '#8a1f1f'
          }}>
            BM
          </div>
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
          disabled={loading}
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
          Admin demo: <span style={{ fontWeight: 600 }}>admin@bm.com</span> / <span style={{ fontWeight: 600 }}>admin123</span>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;