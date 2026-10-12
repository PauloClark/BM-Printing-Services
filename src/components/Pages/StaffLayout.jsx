import { useEffect, useRef, useState } from 'react';
import { BMLogo } from '../Common/BMLogo';
import { NotificationBell } from '../Common/NotificationBell';
import { StaffOrders } from './StaffOrders';
import { ProfilePage } from './ProfilePage';
import './StaffLayout.css';

export function StaffLayout({ user, setUser, showToast, onLogout }) {
  const [view, setView] = useState('jobs');
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef(null);
  const initials = (user?.name || user?.email || 'S').trim().slice(0, 1).toUpperCase();
  const navigate = next => { setAccountOpen(false); setView(next); };

  useEffect(() => {
    if (!accountOpen) return undefined;
    const outside = event => { if (!accountRef.current?.contains(event.target)) setAccountOpen(false); };
    const keyboard = event => {
      if (event.key === 'Escape') {
        setAccountOpen(false);
        accountRef.current?.querySelector('.bm-staff-account-trigger')?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keyboard); };
  }, [accountOpen]);

  return <main className="bm-staff-shell">
    <header className="bm-staff-topbar">
      <div className="bm-staff-brand"><BMLogo size={38} /><span><strong>BM Printing</strong><small>Staff workspace</small></span></div>
      <nav className="bm-staff-nav" aria-label="Staff navigation">
        <button className={view === 'jobs' ? 'is-active' : ''} onClick={() => navigate('jobs')}>My jobs</button>
        <button className={view === 'profile' ? 'is-active' : ''} onClick={() => navigate('profile')}>Account settings</button>
      </nav>
      <div className="bm-staff-account">
        <NotificationBell user={user} dark onNavigate={() => navigate('jobs')} />
        <div className="bm-staff-account-menu-wrap" ref={accountRef}>
          <button type="button" className="bm-staff-account-trigger" aria-haspopup="menu" aria-expanded={accountOpen} onClick={() => setAccountOpen(open => !open)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setAccountOpen(true); requestAnimationFrame(() => accountRef.current?.querySelector('[role=menuitem]')?.focus()); } }}>
            <span className="bm-staff-avatar" aria-hidden="true">{initials}</span>
            <span className="bm-staff-account__name"><strong>{user?.name || 'Staff member'}</strong><small>Staff</small></span>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          {accountOpen&&<div className="bm-staff-account-dropdown" role="menu"><button type="button" role="menuitem" onClick={() => navigate('profile')}>Account settings</button><button type="button" role="menuitem" onClick={() => { setAccountOpen(false); onLogout(); }}>Logout</button></div>}
        </div>
      </div>
    </header>
    <section className="bm-staff-content">
      {view === 'jobs'
        ? <><header className="bm-staff-heading"><span>WORKSPACE</span><h1>My assigned jobs</h1><p>View your production work, instructions, files, and progress updates.</p></header><StaffOrders user={user} showToast={showToast} /></>
        : <ProfilePage user={user} setUser={setUser} showToast={showToast} dark />}
    </section>
  </main>;
}
