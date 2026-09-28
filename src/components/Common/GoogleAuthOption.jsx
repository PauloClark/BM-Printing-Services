import { useState } from 'react';

export const GoogleAuthOption = ({ disabled = false, onLoadingChange, onError }) => {
  const [loading, setLoading] = useState(false);

  const startGoogleSignIn = async () => {
    if (loading || disabled) return;
    setLoading(true);
    onLoadingChange?.(true);

    try {
      const { supabase } = await import('../../utils/supabaseClient');
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin
        }
      });

      if (error) throw error;
    } catch (error) {
      console.error('Google login failed:', error);
      setLoading(false);
      onLoadingChange?.(false);
      onError?.(error);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 16px', color: '#888', fontSize: 11 }}>
        <span style={{ height: 1, flex: 1, background: '#d9d9d9' }} />
        <span>OR</span>
        <span style={{ height: 1, flex: 1, background: '#d9d9d9' }} />
      </div>

      <button
        type="button"
        onClick={startGoogleSignIn}
        disabled={disabled || loading}
        style={{
          display: 'flex',
          width: '100%',
          minHeight: 44,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          marginBottom: 18,
          padding: '10px 16px',
          border: '1px solid #cfcfcf',
          borderRadius: 4,
          background: '#fff',
          color: '#333',
          fontSize: 14,
          fontWeight: 600,
          cursor: disabled || loading ? 'not-allowed' : 'pointer',
          opacity: disabled || loading ? 0.7 : 1
        }}
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z" />
          <path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.6-5.1c-1.8 1.2-4 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44Z" />
          <path fill="#FBBC05" d="M12.6 27.6a12 12 0 0 1 0-7.2v-5.3H5.8a20 20 0 0 0 0 17.8l6.8-5.3Z" />
          <path fill="#EA4335" d="M24 11.9c3 0 5.7 1 7.8 3.1l5.8-5.8C34.1 5.9 29.5 4 24 4A20 20 0 0 0 5.8 15.1l6.8 5.3c1.6-4.9 6.1-8.5 11.4-8.5Z" />
        </svg>
        {loading ? 'Connecting...' : 'Continue with Google'}
      </button>
    </>
  );
};