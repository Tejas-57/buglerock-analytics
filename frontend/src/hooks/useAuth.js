// frontend/src/hooks/useAuth.js

import { useState, useEffect, useCallback } from "react";

const API = process.env.REACT_APP_API_URL || "";

export function useAuth() {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkSession() {
      try {
        // Try /api/auth/me first
        const res = await fetch(`${API}/api/auth/me`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setUser(data);
          setLoading(false);
          return;
        }

        // /api/auth/me failed — try silent refresh
        const refreshRes = await fetch(`${API}/api/auth/refresh`, {
          method: "POST", credentials: "include",
        });

        if (refreshRes.ok) {
          // Refresh worked — get user info
          const meRes = await fetch(`${API}/api/auth/me`, { credentials: "include" });
          if (meRes.ok) {
            const data = await meRes.json();
            setUser(data);
            setLoading(false);
            return;
          }
        }

        // Both failed — not logged in
        setUser(null);
      } catch {
        // Network error — not logged in
        setUser(null);
      } finally {
        setLoading(false);
      }
    }

    checkSession();
  }, []);

  // Silent refresh every 7 hours
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/auth/refresh`, {
          method: "POST", credentials: "include",
        });
        if (!res.ok) setUser(null);
      } catch {
        // Network error — don't log out
      }
    }, 7 * 60 * 60 * 1000);

    return () => clearInterval(interval);
  }, [user]);

  const login = useCallback((userData) => {
    setUser(userData);
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API}/api/auth/logout`, {
        method: "POST", credentials: "include",
      });
    } catch {}
    setUser(null);
  }, []);

  return { user, loading, login, logout };
}