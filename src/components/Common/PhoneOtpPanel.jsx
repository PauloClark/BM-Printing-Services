import { requestPhoneOtp, verifyPhoneOtp } from '../../utils/authActions';
import { PHONE_OTP_ERRORS, PHONE_OTP_RESEND_SECONDS } from '../../utils/phoneAuth';
import { TURNSTILE_ERRORS, verifyTurnstileToken } from '../../utils/turnstile';
import { TurnstileWidget } from '../Common/TurnstileWidget';
import React, { useEffect, useRef, useState } from 'react';

// Shared Phone/SMS OTP panel for Login and Register. Supabase verifies every
// code; nothing here stores or inspects the OTP beyond handing it back once.
export const PhoneOtpPanel = ({ onAuthenticated, showToast }) => {
  const [stage, setStage] = useState('phone');
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [token, setToken] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileStatus, setTurnstileStatus] = useState('loading');
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const cooldownTimer = useRef(null);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    cooldownTimer.current = setTimeout(() => setCooldown(seconds => seconds - 1), 1000);
    return () => clearTimeout(cooldownTimer.current);
  }, [cooldown]);

  // Reuses the existing server-side Turnstile check to limit OTP abuse.
  const guardTurnstile = async () => {
    if (!turnstileToken) {
      throw new Error(turnstileStatus === 'unavailable' ? TURNSTILE_ERRORS.unavailable : TURNSTILE_ERRORS.missing);
    }
    try {
      await verifyTurnstileToken(turnstileToken);
    } finally {
      setTurnstileToken('');
      setTurnstileResetSignal(signal => signal + 1);
    }
  };

  const sendOtp = async () => {
    setErrorMessage('');
    if (busy || cooldown > 0) return;
    setBusy(true);
    try {
      await guardTurnstile();
      const { supabase } = await import('../../utils/supabaseClient');
      const e164 = await requestPhoneOtp(supabase, phone);
      setSentTo(e164);
      setStage('code');
      setCooldown(PHONE_OTP_RESEND_SECONDS);
      showToast?.(`Verification code sent to ${e164}.`, 'success');
    } catch (error) {
      const message = error.message || PHONE_OTP_ERRORS.sendFailed;
      setErrorMessage(message);
      showToast?.(message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const verifyOtp = async () => {
    setErrorMessage('');
    if (busy) return;
    setBusy(true);
    try {
      const { supabase } = await import('../../utils/supabaseClient');
      const user = await verifyPhoneOtp(supabase, sentTo || phone, token);
      setToken('');
      showToast?.('Logged in successfully.', 'success');
      onAuthenticated?.(user);
    } catch (error) {
      const message = error.message || PHONE_OTP_ERRORS.invalidCode;
      setErrorMessage(message);
      showToast?.(message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const changePhone = () => {
    setStage('phone');
    setSentTo('');
    setToken('');
    setErrorMessage('');
  };

  return (
    <>
      <div className="bm-auth-fields">
        {stage === 'phone' ? (
          <div className="bm-auth-field">
            <label htmlFor="bm-phone-number">Phone Number</label>
            <div className="bm-auth-input-wrap">
              <svg className="bm-auth-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M11 18.5h2" /></svg>
              <input
                id="bm-phone-number"
                value={phone}
                onChange={event => { setPhone(event.target.value); setErrorMessage(''); }}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="0917 123 4567"
                aria-describedby="bm-phone-hint"
                required
              />
            </div>
            <p id="bm-phone-hint" className="bm-auth-hint">Philippine mobile number. We&apos;ll text you a 6-digit code.</p>
          </div>
        ) : (
          <div className="bm-auth-field">
            <label htmlFor="bm-phone-otp">Verification Code</label>
            <div className="bm-auth-input-wrap">
              <svg className="bm-auth-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M8 10h4M8 14h8" /></svg>
              <input
                id="bm-phone-otp"
                value={token}
                onChange={event => { setToken(event.target.value.replace(/\D/g, '').slice(0, 6)); setErrorMessage(''); }}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                aria-describedby="bm-phone-otp-hint"
                required
              />
            </div>
            <p id="bm-phone-otp-hint" className="bm-auth-hint">Enter the 6-digit code sent to {sentTo}.</p>
          </div>
        )}
      </div>

      {stage === 'phone' && (
        <TurnstileWidget
          resetSignal={turnstileResetSignal}
          onTokenChange={setTurnstileToken}
          onStatusChange={setTurnstileStatus}
        />
      )}

      {errorMessage && <p className="bm-auth-error" role="alert">{errorMessage}</p>}

      {stage === 'phone' ? (
        <button
          type="button"
          className="bm-auth-submit"
          onClick={sendOtp}
          disabled={busy || cooldown > 0}
          aria-busy={busy}
        >
          {busy && <span className="bm-auth-spinner" aria-hidden="true" />}
          <span>{busy ? 'Sending...' : 'SEND OTP'}</span>
          {!busy && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 12h15M13 5l7 7-7 7" /></svg>}
        </button>
      ) : (
        <>
          <button
            type="button"
            className="bm-auth-submit"
            onClick={verifyOtp}
            disabled={busy || token.length !== 6}
            aria-busy={busy}
          >
            {busy && <span className="bm-auth-spinner" aria-hidden="true" />}
            <span>{busy ? 'Verifying...' : 'VERIFY OTP'}</span>
            {!busy && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 12h15M13 5l7 7-7 7" /></svg>}
          </button>
          <div className="bm-auth-otp-actions">
            <button type="button" className="bm-auth-link" onClick={changePhone} disabled={busy}>Change number</button>
            <button type="button" className="bm-auth-link" onClick={sendOtp} disabled={busy || cooldown > 0}>
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>
          </div>
        </>
      )}
    </>
  );
};

export default PhoneOtpPanel;