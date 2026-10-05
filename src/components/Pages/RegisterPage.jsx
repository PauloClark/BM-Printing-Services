import { authCallbackUrl } from '../../utils/authReturn';
import { registerCustomer } from '../../utils/authActions';
import React, { useState } from 'react';
import { supabaseAppUser } from '../../../shared/roles';
import { store } from '../../utils/storage';
import { GoogleAuthOption } from '../Common/GoogleAuthOption';
import { PhoneOtpPanel } from '../Common/PhoneOtpPanel';
import { TurnstileWidget } from '../Common/TurnstileWidget';
import { TURNSTILE_ERRORS, verifyTurnstileToken } from '../../utils/turnstile';
import './AuthPages.css';

export const RegisterPage = ({ setPage, onLogin, showToast: notify }) => {
  const [method, setMethod] = useState('email');
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: ''
  });
  const [showPasswords, setShowPasswords] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileStatus, setTurnstileStatus] = useState('loading');
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);

  const onChange = (e) => {
    const { name, value } = e.target;
    setErrorMessage('');
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const register = async () => {
    setErrorMessage('');
    if (!form.name || !form.email || !form.password) {
      setErrorMessage('Please complete all required fields.');
      notify?.('Please complete all required fields.', 'error');
      return;
    }

    if (form.password !== form.confirmPassword) {
      setErrorMessage('Passwords do not match.');
      notify?.('Passwords do not match.', 'error');
      return;
    }

    if (!turnstileToken) {
      const message = turnstileStatus === 'unavailable'
        ? 'Security verification is temporarily unavailable. Please try again.'
        : 'Please complete the security verification.';
      setErrorMessage(message);
      notify?.(message, 'error');
      return;
    }

    setLoading(true);
    try {
      try {
        await verifyTurnstileToken(turnstileToken);
      } catch (verificationError) {
        setTurnstileToken('');
        setTurnstileResetSignal(signal => signal + 1);
        const message = verificationError.message;
        setErrorMessage(message);
        notify?.(message, 'error');
        return;
      }

      setTurnstileToken('');
      setTurnstileResetSignal(signal => signal + 1);
      const { supabase } = await import('../../utils/supabaseClient');
      const data = await registerCustomer(supabase, form, authCallbackUrl());
      await store.del('session');
      if (data.session && data.user) {
        onLogin?.(supabaseAppUser(data.user));
        notify?.('Account created successfully.', 'success');
      } else {
        notify?.('Check your email to confirm your account, then log in.', 'success');
        setPage?.('login');
      }
    } catch (error) {
      console.error('Registration failed:', error);
      const message = error.message || 'Unable to create account.';
      setErrorMessage(message);
      notify?.(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="bm-auth-page bm-auth-page--register">
      <div className="bm-auth-print-layer" aria-hidden="true">
        <img className="bm-auth-print bm-auth-print--tshirt" src="/image/hero/products/cutouts/tshirt-cutout.png" alt="" loading="lazy" decoding="async" />
        <img className="bm-auth-print bm-auth-print--mug" src="/image/hero/products/cutouts/mug-cutout.png" alt="" loading="lazy" decoding="async" />
        <img className="bm-auth-print bm-auth-print--hoodie" src="/image/hero/products/cutouts/hoodie-cutout.png" alt="" loading="lazy" decoding="async" />
        <img className="bm-auth-print bm-auth-print--polo" src="/image/hero/products/cutouts/polo-cutout.png" alt="" loading="lazy" decoding="async" />
        <img className="bm-auth-print bm-auth-print--sticker" src="/image/hero/products/cutouts/sticker-cutout.png" alt="" loading="lazy" decoding="async" />
      </div>
      <section className="bm-auth-card" aria-labelledby="bm-register-title">
        <div className="bm-auth-logo">
          <img src="/bm-logo.png" alt="BM Printing Services" />
        </div>
        <header className="bm-auth-heading">
          <h1 id="bm-register-title">Create Account</h1>
          <p>Create your BM Printing Services account</p>
        </header>

        <div className="bm-auth-tabs" role="tablist" aria-label="Registration method">
          <button
            type="button"
            role="tab"
            id="bm-register-tab-email"
            aria-selected={method === 'email'}
            aria-controls="bm-register-panel"
            className={`bm-auth-tab${method === 'email' ? ' is-active' : ''}`}
            onClick={() => setMethod('email')}
          >
            Email
          </button>
          <button
            type="button"
            role="tab"
            id="bm-register-tab-phone"
            aria-selected={method === 'phone'}
            aria-controls="bm-register-panel"
            className={`bm-auth-tab${method === 'phone' ? ' is-active' : ''}`}
            onClick={() => setMethod('phone')}
          >
            Phone
          </button>
        </div>

        <div id="bm-register-panel" role="tabpanel" aria-labelledby={`bm-register-tab-${method}`}>
        {method === 'phone' ? (
          <PhoneOtpPanel
            showToast={notify}
            onAuthenticated={user => {
              onLogin?.(user);
            }}
          />
        ) : (
        <>
        <div className="bm-auth-fields">
          <div className="bm-auth-field">
            <label htmlFor="bm-register-name">Full Name</label>
            <input id="bm-register-name" className="bm-auth-input" name="name" value={form.name} onChange={onChange} autoComplete="name" required />
          </div>
          <div className="bm-auth-field">
            <label htmlFor="bm-register-email">Email Address</label>
            <input id="bm-register-email" className="bm-auth-input" name="email" type="email" value={form.email} onChange={onChange} autoComplete="email" required />
          </div>
          <div className="bm-auth-field">
            <label htmlFor="bm-register-phone">Phone</label>
            <input id="bm-register-phone" className="bm-auth-input" name="phone" type="tel" value={form.phone} onChange={onChange} autoComplete="tel" required />
          </div>
          <div className="bm-auth-field">
            <label htmlFor="bm-register-password">Password</label>
            <div className="bm-auth-input-wrap">
              <input id="bm-register-password" className="bm-auth-input" name="password" type={showPasswords ? 'text' : 'password'} value={form.password} onChange={onChange} autoComplete="new-password" required />
              <button type="button" className="bm-auth-password-toggle" aria-label={showPasswords ? 'Hide passwords' : 'Show passwords'} aria-pressed={showPasswords} onClick={() => setShowPasswords(visible => !visible)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                  <circle cx="12" cy="12" r="2.5" />
                  {showPasswords && <path d="m4 4 16 16" />}
                </svg>
              </button>
            </div>
          </div>
          <div className="bm-auth-field">
            <label htmlFor="bm-register-confirm-password">Confirm Password</label>
            <div className="bm-auth-input-wrap">
              <input id="bm-register-confirm-password" className="bm-auth-input" name="confirmPassword" type={showPasswords ? 'text' : 'password'} value={form.confirmPassword} onChange={onChange} autoComplete="new-password" required />
              <button type="button" className="bm-auth-password-toggle" aria-label={showPasswords ? 'Hide passwords' : 'Show passwords'} aria-pressed={showPasswords} onClick={() => setShowPasswords(visible => !visible)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                  <circle cx="12" cy="12" r="2.5" />
                  {showPasswords && <path d="m4 4 16 16" />}
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
          onClick={register}
          disabled={loading || googleLoading}
          aria-busy={loading}
        >
          {loading && <span className="bm-auth-spinner" aria-hidden="true" />}
          <span>{loading ? 'Creating account...' : 'CREATE ACCOUNT'}</span>
          {!loading && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 12h15M13 5l7 7-7 7" /></svg>}
        </button>

        </>
        )}
        </div>

        <GoogleAuthOption
          disabled={loading}
          onLoadingChange={setGoogleLoading}
          onError={error => notify?.(error.message || 'Unable to connect with Google. Please try again.', 'error')}
        />

        <p className="bm-auth-switch">
          Already have an account?{' '}
          <button type="button" onClick={() => setPage?.('login')}>Login</button>
        </p>
      </section>
    </main>
  );
};

export default RegisterPage;
