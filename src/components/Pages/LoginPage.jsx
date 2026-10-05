import { signInAccount } from '../../utils/authActions';
import React, { useState } from 'react';
import { store } from '../../utils/storage';
import { GoogleAuthOption } from '../Common/GoogleAuthOption';
import { PhoneOtpPanel } from '../Common/PhoneOtpPanel';
import { TurnstileWidget } from '../Common/TurnstileWidget';
import { TURNSTILE_ERRORS, verifyTurnstileToken } from '../../utils/turnstile';
import './AuthPages.css';

export const LoginPage = ({ setPage, onLogin, showToast }) => {
  const [method, setMethod] = useState('email');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileStatus, setTurnstileStatus] = useState('loading');
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);

  const login = async () => {
    setErrorMessage('');
    if (!turnstileToken) {
      const message = turnstileStatus === 'unavailable' ? TURNSTILE_ERRORS.unavailable : TURNSTILE_ERRORS.missing;
      setErrorMessage(message);
      showToast?.(message, 'error');
      return;
    }

    setLoading(true);
    try {
      try {
        await verifyTurnstileToken(turnstileToken);
      } catch (verificationError) {
        setTurnstileToken('');
        setTurnstileResetSignal(signal => signal + 1);
        setErrorMessage(verificationError.message);
        showToast?.(verificationError.message, 'error');
        return;
      }

      setTurnstileToken('');
      setTurnstileResetSignal(signal => signal + 1);
      const { supabase } = await import('../../utils/supabaseClient');
      const user = await signInAccount(supabase, email, pass, async () => {
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

        return { ...data.user, token: data.token, authProvider: 'jwt' };
      });
      if (user.authProvider === 'supabase') await store.del('session');
      else await store.set('session', user);
      onLogin?.(user);
      showToast?.('Logged in successfully.', 'success');
    } catch (error) {
      console.error('Login failed:', error);
      const message = error.message || 'Invalid email or password.';
      setErrorMessage(message);
      showToast?.(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="bm-auth-page bm-auth-page--login">
      <div className="bm-auth-print-layer" aria-hidden="true">
        <img className="bm-auth-print bm-auth-print--tshirt" src="/image/hero/products/cutouts/tshirt-cutout.png" alt="" loading="lazy" decoding="async" />
        <img className="bm-auth-print bm-auth-print--mug" src="/image/hero/products/cutouts/mug-cutout.png" alt="" loading="lazy" decoding="async" />
        <img className="bm-auth-print bm-auth-print--hoodie" src="/image/hero/products/cutouts/hoodie-cutout.png" alt="" loading="lazy" decoding="async" />
        <img className="bm-auth-print bm-auth-print--polo" src="/image/hero/products/cutouts/polo-cutout.png" alt="" loading="lazy" decoding="async" />
        <img className="bm-auth-print bm-auth-print--sticker" src="/image/hero/products/cutouts/sticker-cutout.png" alt="" loading="lazy" decoding="async" />
      </div>
      <section className="bm-auth-card" aria-labelledby="bm-login-title">
        <div className="bm-auth-logo">
          <img src="/bm-logo.png" alt="BM Printing Services" />
        </div>
        <header className="bm-auth-heading">
          <h1 id="bm-login-title"><span>Welcome</span> <span className="bm-auth-accent">Back</span></h1>
          <p>Log in to your BM Printing Services account</p>
        </header>

        <div className="bm-auth-tabs" role="tablist" aria-label="Sign-in method">
          <button
            type="button"
            role="tab"
            id="bm-login-tab-email"
            aria-selected={method === 'email'}
            aria-controls="bm-login-panel"
            className={`bm-auth-tab${method === 'email' ? ' is-active' : ''}`}
            onClick={() => setMethod('email')}
          >
            Email
          </button>
          <button
            type="button"
            role="tab"
            id="bm-login-tab-phone"
            aria-selected={method === 'phone'}
            aria-controls="bm-login-panel"
            className={`bm-auth-tab${method === 'phone' ? ' is-active' : ''}`}
            onClick={() => setMethod('phone')}
          >
            Phone
          </button>
        </div>

        <div id="bm-login-panel" role="tabpanel" aria-labelledby={`bm-login-tab-${method}`}>
        {method === 'phone' ? (
          <PhoneOtpPanel
            showToast={showToast}
            onAuthenticated={user => {
              onLogin?.(user);
            }}
          />
        ) : (
        <>
        <div className="bm-auth-fields">
          <div className="bm-auth-field">
            <label htmlFor="bm-login-email">Email Address</label>
            <div className="bm-auth-input-wrap">
              <svg className="bm-auth-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></svg>
              <input
                id="bm-login-email"
                value={email}
                onChange={event => { setEmail(event.target.value); setErrorMessage(''); }}
                type="email"
                autoComplete="username"
                required
              />
            </div>
          </div>
          <div className="bm-auth-field">
            <label htmlFor="bm-login-password">Password</label>
            <div className="bm-auth-input-wrap">
              <svg className="bm-auth-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 1 1 8 0v3M12 14v3" /></svg>
              <input
                id="bm-login-password"
                value={pass}
                onChange={event => { setPass(event.target.value); setErrorMessage(''); }}
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="bm-auth-password-toggle"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword(visible => !visible)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                  <circle cx="12" cy="12" r="2.5" />
                  {showPassword && <path d="m4 4 16 16" />}
                </svg>
              </button>
            </div>
          </div>
        </div>

        <TurnstileWidget
          resetSignal={turnstileResetSignal}
          onTokenChange={setTurnstileToken}
          onStatusChange={setTurnstileStatus}
        />

        {errorMessage && <p className="bm-auth-error" role="alert">{errorMessage}</p>}

        <button
          type="button"
          className="bm-auth-submit"
          onClick={login}
          disabled={loading || googleLoading}
          aria-busy={loading}
        >
          {loading && <span className="bm-auth-spinner" aria-hidden="true" />}
          <span>{loading ? 'Logging in...' : 'LOGIN'}</span>
          {!loading && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 12h15M13 5l7 7-7 7" /></svg>}
        </button>

        </>
        )}
        </div>

        <GoogleAuthOption
          disabled={loading}
          onLoadingChange={setGoogleLoading}
          onError={error => showToast?.(error.message || 'Unable to connect with Google. Please try again.', 'error')}
        />

        <p className="bm-auth-switch">
          Don&apos;t have an account?{' '}
          <button type="button" onClick={() => setPage?.('register')}>Register</button>
        </p>
      </section>
    </main>
  );
};

export default LoginPage;
