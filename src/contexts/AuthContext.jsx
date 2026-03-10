import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import axios from 'axios';
import { backendUrl } from '../Constants';

const AuthContext = createContext(null);

/** How many ms before token expiry to trigger a refresh (2 minutes). */
const REFRESH_AHEAD_MS = 2 * 60 * 1000;

/** Parse JWT payload without verification (client-side only — server verifies). */
function parseJwt(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);         // { userId, username, displayName, role }
  const [tokens, setTokens] = useState(null);      // { access_token, refresh_token }
  const [loading, setLoading] = useState(true);     // initial session restore
  const refreshTimerRef = useRef(null);

  // ---- Persist / restore from sessionStorage ----
  const persist = (accessToken, refreshToken, userInfo) => {
    sessionStorage.setItem('auth_access', accessToken);
    sessionStorage.setItem('auth_refresh', refreshToken);
    sessionStorage.setItem('auth_user', JSON.stringify(userInfo));
  };

  const clearStorage = () => {
    sessionStorage.removeItem('auth_access');
    sessionStorage.removeItem('auth_refresh');
    sessionStorage.removeItem('auth_user');
  };

  // Schedule a token refresh before the access token expires
  const scheduleRefresh = useCallback((accessToken, refreshToken) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const payload = parseJwt(accessToken);
    if (!payload || !payload.exp) return;
    const expiresMs = payload.exp * 1000;
    const delay = Math.max(expiresMs - Date.now() - REFRESH_AHEAD_MS, 5000);
    refreshTimerRef.current = setTimeout(async () => {
      try {
        const res = await axios.post(`${backendUrl}/api/auth/refresh`, { refresh_token: refreshToken });
        const newAccess = res.data.access_token;
        setTokens(prev => {
          const updated = { ...prev, access_token: newAccess };
          sessionStorage.setItem('auth_access', newAccess);
          scheduleRefresh(newAccess, updated.refresh_token);
          return updated;
        });
      } catch {
        // Refresh failed — force logout
        logout();
      }
    }, delay);
  }, []);

  // ---- Login ----
  const login = useCallback(async (username, password) => {
    const res = await axios.post(`${backendUrl}/api/auth/login`, { username, password });
    const { access_token, refresh_token, userId, username: uname, displayName, role } = res.data;
    const userInfo = { userId, username: uname, displayName, role };
    setTokens({ access_token, refresh_token });
    setUser(userInfo);
    persist(access_token, refresh_token, userInfo);
    scheduleRefresh(access_token, refresh_token);
  }, [scheduleRefresh]);

  // ---- Logout ----
  const logout = useCallback(async () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const rt = tokens?.refresh_token || sessionStorage.getItem('auth_refresh');
    setUser(null);
    setTokens(null);
    clearStorage();
    try {
      if (rt) await axios.post(`${backendUrl}/api/auth/logout`, { refresh_token: rt });
    } catch { /* ignore */ }
  }, [tokens]);

  // ---- Restore session on mount ----
  useEffect(() => {
    const access = sessionStorage.getItem('auth_access');
    const refresh = sessionStorage.getItem('auth_refresh');
    const savedUser = sessionStorage.getItem('auth_user');
    if (access && refresh && savedUser) {
      try {
        const u = JSON.parse(savedUser);
        setTokens({ access_token: access, refresh_token: refresh });
        setUser(u);
        scheduleRefresh(access, refresh);
      } catch {
        clearStorage();
      }
    }
    setLoading(false);
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const value = {
    user,
    tokens,
    isAuthenticated: !!user,
    loading,
    login,
    logout,
    /** Convenience: current access token string */
    getAccessToken: () => tokens?.access_token || sessionStorage.getItem('auth_access') || null,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Hook to consume auth context. */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
