import { useEffect, useState } from 'react';
import { orderApi } from '../../utils/orderApi';
import { canOpenDashboard } from '../../../shared/roles';

export function ProtectedDashboard({ user, page, children }) {
  const [verified, setVerified] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true, pending = false;
    setVerified(null); setError('');
    const verify = async () => {
      if (pending) return;
      pending = true;
      try {
        if (!user) throw new Error('Please login to access this dashboard.');
        const { user: current } = await orderApi('/api/auth/me', {}, user);
        if (!canOpenDashboard(current.role, page)) throw new Error('Access denied. Your account cannot access this dashboard.');
        if (active) { setVerified({ ...user, ...current }); setError(''); }
      } catch (e) { if (active) { setVerified(null); setError(e.message); } }
      finally { pending = false; }
    };
    verify();
    const timer = setInterval(verify, 30000);
    window.addEventListener('focus', verify);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', verify); };
  }, [user, page, retry]);
  if (error) return <div role="alert" style={{ padding: 40, textAlign: 'center' }}><p>{error}</p><button onClick={() => setRetry(n => n + 1)}>Retry access check</button></div>;
  if (!verified) return <p role="status" style={{ padding: 40 }}>Verifying dashboard access…</p>;
  return children(verified);
}
