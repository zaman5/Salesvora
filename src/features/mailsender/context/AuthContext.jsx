import React, { createContext, useContext, useMemo } from 'react';
import { useAuth as useSalesvoraAuth } from '@/hooks/useAuth';
import { clearInboxCache } from '../pages/Inbox';

const AuthContext = createContext(null);

// Mail Sender has no login of its own anymore — it renders inside Salesvora's
// own AuthGuard, so by the time this mounts there is always a real Salesvora
// user. This just reshapes that user into what the ported pages expect.
export function AuthProvider({ children }) {
  const { user: salesvoraUser, logout: salesvoraLogout } = useSalesvoraAuth();

  const value = useMemo(() => {
    const user = salesvoraUser
      ? { id: salesvoraUser.id, name: salesvoraUser.name || salesvoraUser.email || 'User', email: salesvoraUser.email, role: salesvoraUser.role }
      : null;
    return {
      user,
      token: '',
      login: () => {},
      logout: () => { clearInboxCache(); salesvoraLogout(); },
      isAdmin: user?.role === 'admin' || user?.role === 'superadmin',
      isAuth: !!user,
    };
  }, [salesvoraUser, salesvoraLogout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
