// frontend/src/components/Login/SetupPassword.jsx
import { useState, useEffect } from "react";
import "./Login.css";

const API = process.env.REACT_APP_API_URL;

function FundIQLogo() {
  return (
    <div className="login-logo">
      <div className="login-logo-mark" />
      <div className="login-logo-text">
        <div className="login-logo-brand">
          <span className="login-logo-fund">Fund</span>
          <span className="login-logo-iq">IQ</span>
        </div>
        <span className="login-logo-secondary">A BugleRock Analytics Platform</span>
      </div>
    </div>
  );
}

export default function SetupPassword({ onLogin }) {
  const [step, setStep]         = useState("loading");
  const [token, setToken]       = useState("");
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    if (!t) {
      setStep("error");
      setError("No setup token found. Please ask your admin to resend the setup email.");
      return;
    }

    fetch(`${API}/api/auth/verify-setup-token`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ token: t }),
    })
      .then(res => res.json())
      .then(data => {
        if (!data.ok) throw new Error(data.detail || "Invalid link");
        setToken(data.token);
        setUserName(data.name);
        setStep("form");
      })
      .catch(err => {
        setStep("error");
        setError(err.message || "This setup link is invalid or has expired. Please ask your admin to resend it.");
      });
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("Passwords do not match"); return; }
    if (password.length < 8)  { setError("Password must be at least 8 characters"); return; }

    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/setup-password`, {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Setup failed");
      setStep("done");
      setTimeout(() => onLogin(data), 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <FundIQLogo />
        </div>

        {step === "loading" && (
          <p style={{ textAlign: "center", color: "#A2A0A0" }}>Verifying your link…</p>
        )}

        {step === "error" && (
          <div>
            <div className="form-error">{error}</div>
            <p style={{ fontSize: 13, color: "#A2A0A0", marginTop: 16, textAlign: "center" }}>
              Contact your admin to get a new setup link.
            </p>
          </div>
        )}

        {step === "form" && (
          <form onSubmit={handleSubmit} className="login-form">
            <p className="form-hint">
              Hi <strong>{userName.split(" ")[0]}</strong>, welcome to FundIQ.<br />
              Set your password to get started.
            </p>
            <div className="form-group">
              <label>New Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                required autoFocus
              />
            </div>
            <div className="form-group">
              <label>Confirm Password</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Repeat password"
                required
              />
            </div>
            {error && <div className="form-error">{error}</div>}
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? "Setting up…" : "Set password & sign in"}
            </button>
          </form>
        )}

        {step === "done" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <p style={{ color: "#3E3452", fontWeight: 600 }}>Password set! Signing you in…</p>
          </div>
        )}
      </div>
    </div>
  );
}