export const ROLES = ['customer', 'staff', 'admin'];
export const trustedRole = role => ROLES.includes(role) ? role : 'customer';
export const roleFromSupabaseUser = user => trustedRole(user?.app_metadata?.role);
export const dashboardForRole = role => role === 'admin' ? 'admin' : role === 'staff' ? 'staff' : 'home';
export const canOpenDashboard = (role, page) => page === 'admin' ? role === 'admin' : ['staff', 'admin'].includes(role);
export function supabaseAppUser(user) {
  const metadata = user.user_metadata || {};
  const email = user.email || '';
  // Phone-only identities (Supabase Phone Auth) carry the number here.
  const phone = user.phone || metadata.phone || '';
  return {
    id: user.id, email,
    name: metadata.full_name || metadata.name || email.split('@')[0] || phone || 'Customer',
    phone, address: metadata.address || '',
    avatar: metadata.avatar_url || metadata.picture || '',
    role: roleFromSupabaseUser(user), authProvider: 'supabase',
    hasPassword: user.app_metadata?.providers?.includes('email') || user.app_metadata?.provider === 'email'
  };
}
