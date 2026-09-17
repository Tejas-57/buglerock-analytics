// frontend/src/hooks/useAuth.js
// Drop this hook into your App.jsx to handle auth state + silent token refresh

import { useState, useEffect, useCallback } from "react";

const API = process.env.REACT_APP_API_URL;

export function useAuth() {
  const [user, setUser]       = useState(null);    // null = not logged in
  const [loading, setLoading] = useState(true);    // true while checking session on startup

  // ── On startup: try to restore session via /api/auth/me ──────────────────
  useEffect(() => {
    fetch(`${API}/api/auth/me`, { credentials: "include" })
      .then(res => {
        if (res.ok) return res.json();
        // Access token expired — try silent refresh
        return fetch(`${API}/api/auth/refresh`, {
          method: "POST", credentials: "include",
        }).then(r => {
          if (r.ok) {
            // Refresh worked — now get user info
            return fetch(`${API}/api/auth/me`, { credentials: "include" }).then(r2 => r2.json());
          }
          return null; // Refresh failed — user must log in
        });
      })
      .then(data => setUser(data || null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  // ── Silent refresh: runs every 7 hours to keep access token alive ─────────
  useEffect(() => {
    if (!user) return;

    // Refresh access token every 7 hours (before 8 hour expiry)
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/auth/refresh`, {
          method: "POST", credentials: "include",
        });
        if (!res.ok) {
          // Refresh token also expired — force logout
          setUser(null);
        }
      } catch {
        // Network error — don't log out, will retry next interval
      }
    }, 7 * 60 * 60 * 1000);  // 7 hours in ms

    return () => clearInterval(interval);
  }, [user]);

  // ── Login handler ─────────────────────────────────────────────────────────
  const login = useCallback((userData) => {
    setUser(userData);
  }, []);

  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    try {
      await fetch(`${API}/api/auth/logout`, {
        method: "POST", credentials: "include",
      });
    } catch { /* ignore errors */ }
    setUser(null);
  }, []);

  return { user, loading, login, logout };
}
