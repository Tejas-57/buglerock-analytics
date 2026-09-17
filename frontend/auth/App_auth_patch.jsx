// HOW TO WIRE AUTH INTO YOUR EXISTING App.jsx
// This is a patch guide — not a full replacement.
// Add/change the highlighted sections in your existing App.jsx

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";           // ADD THIS
import Login from "./components/Login/Login";         // ADD THIS
import SetupPassword from "./components/Login/SetupPassword";  // ADD THIS
import AdminPanel from "./components/Admin/AdminPanel"; // ADD THIS

// ... your existing imports ...

export default function App() {
  const { user, loading, login, logout } = useAuth();  // ADD THIS

  // Show nothing while checking session on startup
  if (loading) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex",
        alignItems: "center", justifyContent: "center",
        background: "#f8f6fb",
      }}>
        <div style={{ color: "#912F63", fontWeight: 600 }}>Loading FundIQ…</div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Setup password page — public, no auth needed */}
        <Route
          path="/setup-password"
          element={
            user
              ? <Navigate to="/" replace />   // already logged in → go home
              : <SetupPassword onLogin={login} />
          }
        />

        {/* Login page — public */}
        <Route
          path="/login"
          element={
            user
              ? <Navigate to="/" replace />
              : <Login onLogin={login} />
          }
        />

        {/* All protected routes — redirect to login if not authenticated */}
        <Route
          path="/*"
          element={
            !user
              ? <Navigate to="/login" replace />
              : (
                  // Your existing app layout — pass user + logout as props
                  <YourExistingLayout user={user} onLogout={logout}>
                    <Routes>
                      {/* ... your existing routes ... */}

                      {/* Admin panel — only for admin role */}
                      <Route
                        path="/admin"
                        element={
                          user.role === "admin"
                            ? <AdminPanel />
                            : <Navigate to="/" replace />
                        }
                      />
                    </Routes>
                  </YourExistingLayout>
                )
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

// ── In your navbar/header — add logout button + user name ─────────────────────
// Wherever your top nav is, add this:
//
//   <span>{user.name}</span>
//   {user.role === "admin" && <a href="/admin">Admin</a>}
//   <button onClick={onLogout}>Sign out</button>
