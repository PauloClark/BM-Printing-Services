import React from 'react';
import { BMLogo } from '../Common/BMLogo';
import './EmailVerificationPage.css';

const callbackError = () => {
  if (typeof window === 'undefined') return '';
  const raw = window.location.hash.replace(/^#\/?/, '');
  const params = new URLSearchParams(raw.includes('=') ? raw : window.location.search);
  const code = params.get('error_code') || params.get('error');
  if (!code) return '';
  if (/expired|otp_expired/i.test(code)) return 'This confirmation link has expired. Please request a new confirmation email.';
  if (/already|used/i.test(code)) return 'This confirmation link has already been used. You can log in with your account.';
  return 'This confirmation link is invalid or could not be completed. Please request a new confirmation email.';
};

export function EmailVerificationPage({ setPage, verified, loadingApp }) {
  const error = callbackError();
  const state = loadingApp ? 'loading' : error ? 'error' : verified ? 'success' : 'invalid';
  const copy = {
    loading: ['Verifying your account…', 'Please wait while Supabase securely confirms your email address.'],
    success: ['Account Confirmed Successfully!', 'Your account has been verified. You can now log in and start using your BM Printing Services account.'],
    error: ['Confirmation Link Unavailable', error],
    invalid: ['Confirmation Not Completed', 'We could not verify this account from the confirmation link. Please request a new email, then try again.']
  }[state];

  return <main className="bm-verification-page">
    <section className={'bm-verification-card is-' + state} aria-live="polite">
      <div className="bm-verification-brand"><BMLogo size={58} /><span>BM PRINTING<br /><small>SERVICES</small></span></div>
      {state === 'success' ? <span className="bm-verification-check" aria-hidden="true">✓</span> : state === 'loading' ? <span className="bm-verification-loader" aria-hidden="true" /> : <span className="bm-verification-alert" aria-hidden="true">!</span>}
      <p className="bm-verification-eyebrow">Account verification</p>
      <h1>{copy[0]}</h1>
      <p className="bm-verification-message">{copy[1]}</p>
      {(state === 'success' || state === 'invalid' || state === 'error') && <button type="button" className="bm-verification-primary" onClick={() => setPage('login')}>{state === 'success' ? 'Log In Now' : 'Go to Log In'}</button>}
      {(state === 'error' || state === 'invalid') && <p className="bm-verification-help">If you have already confirmed your account, continue to Log In.</p>}
    </section>
  </main>;
}
