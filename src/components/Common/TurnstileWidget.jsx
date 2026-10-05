import { useEffect, useRef } from 'react';

const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';
let turnstileScriptPromise;

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileScriptPromise) return turnstileScriptPromise;

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not load.'));
    script.onerror = () => {
      turnstileScriptPromise = undefined;
      script.remove();
      reject(new Error('Turnstile could not be loaded.'));
    };
    document.head.appendChild(script);
  });
  return turnstileScriptPromise;
}

export const TurnstileWidget = ({ resetSignal, onTokenChange, onStatusChange }) => {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const callbacksRef = useRef({ onTokenChange, onStatusChange });
  callbacksRef.current = { onTokenChange, onStatusChange };

  useEffect(() => {
    let active = true;
    if (!TURNSTILE_SITE_KEY) {
      onStatusChange('unavailable');
      return () => { active = false; };
    }

    onStatusChange('loading');
    loadTurnstileScript().then(turnstile => {
      if (!active || !containerRef.current) return;
      widgetIdRef.current = turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        size: 'flexible',
        callback: token => {
          callbacksRef.current.onTokenChange(token);
          callbacksRef.current.onStatusChange('ready');
        },
        'expired-callback': () => {
          callbacksRef.current.onTokenChange('');
          callbacksRef.current.onStatusChange('expired');
        },
        'error-callback': () => {
          callbacksRef.current.onTokenChange('');
          callbacksRef.current.onStatusChange('unavailable');
        },
        'timeout-callback': () => {
          callbacksRef.current.onTokenChange('');
          callbacksRef.current.onStatusChange('expired');
        }
      });
      callbacksRef.current.onStatusChange('ready');
    }).catch(() => {
      if (active) callbacksRef.current.onStatusChange('unavailable');
    });

    return () => {
      active = false;
      if (widgetIdRef.current !== null) {
        window.turnstile?.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [onStatusChange]);

  useEffect(() => {
    if (resetSignal === 0) return;
    callbacksRef.current.onTokenChange('');
    if (widgetIdRef.current !== null) {
      window.turnstile?.reset(widgetIdRef.current);
    }
  }, [resetSignal]);

  return (
    <div className="bm-turnstile-wrap" role="group" aria-label="Security verification">
      <div ref={containerRef} className="bm-turnstile-widget" />
    </div>
  );
};