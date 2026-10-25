import { useEffect, useRef } from 'react';

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TEST_SITE_KEY = '1x00000000000000000000AA';
const siteKey = import.meta.env.DEV && import.meta.env.VITE_TURNSTILE_USE_TEST_KEYS === 'true'
  ? TEST_SITE_KEY : import.meta.env.VITE_TURNSTILE_SITE_KEY || '';
let scriptPromise;

function loadScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not load.'));
    script.onerror = () => { scriptPromise = undefined; script.remove(); reject(new Error('Turnstile could not be loaded.')); };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export const TurnstileWidget = ({ resetSignal = 0, onTokenChange, onStatusChange }) => {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const callbacksRef = useRef({ onTokenChange, onStatusChange });
  callbacksRef.current = { onTokenChange, onStatusChange };

  useEffect(() => {
    let active = true;
    if (!siteKey) {
      callbacksRef.current.onTokenChange('');
      callbacksRef.current.onStatusChange('unavailable');
      return () => { active = false; };
    }
    callbacksRef.current.onStatusChange('loading');
    loadScript().then(turnstile => {
      if (!active || !containerRef.current) return;
      widgetIdRef.current = turnstile.render(containerRef.current, {
        sitekey: siteKey,
        size: 'flexible',
        callback: token => { callbacksRef.current.onTokenChange(token); callbacksRef.current.onStatusChange('ready'); },
        'expired-callback': () => { callbacksRef.current.onTokenChange(''); callbacksRef.current.onStatusChange('expired'); },
        'timeout-callback': () => { callbacksRef.current.onTokenChange(''); callbacksRef.current.onStatusChange('expired'); },
        'error-callback': code => {
          callbacksRef.current.onTokenChange('');
          callbacksRef.current.onStatusChange(String(code).startsWith('110200') ? 'hostname-not-authorized' : 'unavailable');
        }
      });
    }).catch(() => { if (active) callbacksRef.current.onStatusChange('unavailable'); });
    return () => {
      active = false;
      if (widgetIdRef.current !== null) window.turnstile?.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!resetSignal) return;
    callbacksRef.current.onTokenChange('');
    if (widgetIdRef.current !== null) window.turnstile?.reset(widgetIdRef.current);
  }, [resetSignal]);

  return <div className="bm-turnstile-wrap" role="group" aria-label="Security verification"><div ref={containerRef} className="bm-turnstile-widget" /></div>;
};
