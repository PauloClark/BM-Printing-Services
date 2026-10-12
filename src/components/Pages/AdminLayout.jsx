import AdminPanel from './AdminPanel';

/**
 * Route-level boundary for the administration workspace. Customer chrome must
 * remain outside this component so admin pages cannot inherit its navigation.
 */
export function AdminLayout({ user, showToast, onLogout }) {
  return <AdminPanel user={user} showToast={showToast} onLogout={onLogout} />;
}
