// frontend/src/components/Login/Login.jsx
import { useState } from "react";
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

export default function Login({ onLogin }) {
  const [step, setStep]               = useState("login");
  const [email, setEmail]             = useState("");
  const [password, setPassword]       = useState("");
  const [otp, setOtp]                 = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError]             = useState("");
  const [message, setMessage]         = useState("");
  const [loading, setLoading]         = useState(false);

  const clearMessages = () => { setError(""); setMessage(""); };

  async function handleLogin(e) {
    e.preventDefault();
    clearMessages();
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Login failed");
      onLogin(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e) {
    e.preventDefault();
    clearMessages();
    setLoading(true);
    try {
      await fetch(`${API}/api/auth/forgot-password`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email }),
      });
      setMessage("If that email exists, an OTP has been sent. Check your inbox.");
      setStep("otp");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleOTPReset(e) {
    e.preventDefault();
    clearMessages();
    if (newPassword !== confirmPassword) { setError("Passwords do not match"); return; }
    if (newPassword.length < 8) { setError("Password must be at least 8 characters"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/verify-otp`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email, otp, new_password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "OTP verification failed");
      setMessage("Password reset successful. Please log in.");
      setStep("login");
      setPassword("");
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

        {/* ── Login ── */}
        {step === "login" && (
          <form onSubmit={handleLogin} className="login-form">
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@buglerock.asia"
                required autoFocus
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
              />
            </div>
            {error   && <div className="form-error">{error}</div>}
            {message && <div className="form-success">{message}</div>}
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
            <button type="button" className="btn-link"
              onClick={() => { clearMessages(); setStep("forgot"); }}>
              Forgot password?
            </button>
          </form>
        )}

        {/* ── Forgot password ── */}
        {step === "forgot" && (
          <form onSubmit={handleForgot} className="login-form">
            <p className="form-hint">
              Enter your BugleRock email and we'll send you a 6-digit OTP.
            </p>
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@buglerock.asia"
                required autoFocus
              />
            </div>
            {error   && <div className="form-error">{error}</div>}
            {message && <div className="form-success">{message}</div>}
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? "Sending OTP…" : "Send OTP"}
            </button>
            <button type="button" className="btn-link"
              onClick={() => { clearMessages(); setStep("login"); }}>
              ← Back to login
            </button>
          </form>
        )}

        {/* ── OTP + new password ── */}
        {step === "otp" && (
          <form onSubmit={handleOTPReset} className="login-form">
            <p className="form-hint">
              Enter the 6-digit code sent to <strong>{email}</strong> and choose a new password.
            </p>
            <div className="form-group">
              <label>OTP Code</label>
              <input
                type="text"
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="6-digit code"
                maxLength={6}
                inputMode="numeric"
                required autoFocus
              />
            </div>
            <div className="form-group">
              <label>New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
              />
            </div>
            <div className="form-group">
              <label>Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repeat new password"
                required
              />
            </div>
            {error   && <div className="form-error">{error}</div>}
            {message && <div className="form-success">{message}</div>}
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? "Resetting…" : "Reset Password"}
            </button>
            <button type="button" className="btn-link"
              onClick={() => { clearMessages(); setStep("forgot"); }}>
              ← Resend OTP
            </button>
          </form>
        )}
      </div>
    </div>
  );
}