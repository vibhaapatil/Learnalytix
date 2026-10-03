import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/Login.css";

// Set this to wherever your Flask app runs. Consider moving to a .env
// (VITE_API_URL) instead of hardcoding once you deploy.
const API_URL = "http://localhost:5000/api";

export default function Login({ onLogin }) {
  const navigate = useNavigate();
  const [role, setRole] = useState("admin");
  const [identifier, setIdentifier] = useState(""); // username (admin) or email/roll no (student)
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [loggedInName, setLoggedInName] = useState("");

  const handleRoleSwitch = (r) => {
    setRole(r);
    setError("");
    setIdentifier("");
    setPassword("");
  };

  const handleLogin = async () => {
    setError("");
    if (!identifier.trim()) {
      setError(role === "admin" ? "Please enter your username." : "Please enter your email or roll number.");
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Backend takes `email` as a generic identifier field — for admin
        // role it's treated as `username`, for student it's email or roll_no.
        body: JSON.stringify({ email: identifier.trim(), password, role }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Login failed. Please try again.");
        setLoading(false);
        return;
      }

      localStorage.setItem("learnalytix_token", data.token);

      setLoggedInName(data.user.name);
      setLoading(false);
      setSuccess(true);
      if (onLogin) onLogin(data.user.role, data.user.name);
    } catch (err) {
      setLoading(false);
      setError("Could not reach the server. Please try again.");
    }
  };

  // NOTE: SSO is still mocked — wiring real Google/Institution SSO needs
  // OAuth setup (client ID, redirect URI, callback route) which is a
  // separate task from the username/email + password flow above.
  const handleSSO = (provider) => {
    setError("SSO sign-in isn't connected yet.");
  };

  const handleReset = () => {
    setSuccess(false);
    setIdentifier("");
    setPassword("");
    setError("");
  };

  return (
    <div className="ll-wrap">
      {/* ── Left panel ── */}
      <div className="ll-left">
        <div className="ll-logo-row">
          <div className="ll-logo-box">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EEEDFE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/>
              <line x1="6" y1="9" x2="12" y2="15"/><line x1="18" y1="9" x2="12" y2="15"/>
            </svg>
          </div>
          <span className="ll-logo-name">Learnalyntix</span>
        </div>

        {!success ? (
          <div className="ll-form-box">
            <h1 className="ll-title">Welcome back</h1>
            <p className="ll-sub">Sign in to access your portal</p>

            {/* Role toggle */}
            <div className="ll-role-row">
              <button
                className={`ll-role-tab${role === "admin" ? " active" : ""}`}
                onClick={() => handleRoleSwitch("admin")}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                Admin
              </button>
              <button
                className={`ll-role-tab${role === "student" ? " active" : ""}`}
                onClick={() => handleRoleSwitch("student")}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 10v6M2 10l10-5 10 5-10 5-10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
                Student
              </button>
            </div>

            {/* Error */}
            {error && (
              <div className="ll-error">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                {error}
              </div>
            )}

            {/* Identifier: username for admin, email/roll no for student */}
            <div className="ll-field">
              <label htmlFor="ll-email">
                {role === "admin" ? "Username" : "Email or roll number"}
              </label>
              <input
                id="ll-email"
                type="text"
                placeholder={role === "admin" ? "e.g. admin1" : "roll@college.edu or 2021CS001"}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="off"
              />
            </div>

            {/* Password */}
            <div className="ll-field">
              <div className="ll-field-row">
                <label htmlFor="ll-pass">Password</label>
                <button className="ll-forgot" type="button">Forgot password?</button>
              </div>
              <div className="ll-pass-wrap">
                <input
                  id="ll-pass"
                  type={showPass ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                />
                <button
                  className="ll-eye"
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  aria-label="Toggle password visibility"
                >
                  {showPass ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
              </div>
            </div>

            {/* Remember */}
            <label className="ll-remember">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Remember me
            </label>

            {/* Login button */}
            <button
              className={`ll-login-btn${role === "student" ? " student" : ""}`}
              onClick={handleLogin}
              disabled={loading}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
              {loading ? "Signing in…" : `Sign in as ${role}`}
            </button>

            <div className="ll-divider"><span>or continue with</span></div>

            <div className="ll-social-row">
              <button className="ll-social-btn" onClick={() => handleSSO("Google")}>
                <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                Google
              </button>
              <button className="ll-social-btn" onClick={() => handleSSO("SSO")}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                Institution SSO
              </button>
            </div>

            <p className="ll-signup-row">
              New here?{" "}
              <span className="ll-signup-link" onClick={() => navigate("/register")}>Register →</span>
            </p>
          </div>
        ) : (
          /* Success state */
          <div className="ll-success-box">
            <div className={`ll-check-circle${role === "student" ? " student" : ""}`}>
              {role === "admin" ? (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#534AB7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              ) : (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#0F6E56" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 10v6M2 10l10-5 10 5-10 5-10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
              )}
            </div>
            <h2 className="ll-success-title">Welcome back, {loggedInName}</h2>
            <button className={`ll-login-btn${role === "student" ? " student" : ""}`} style={{ maxWidth: 240, margin: "0 auto" }}>
              {role === "admin" ? "Go to admin dashboard" : "Go to my dashboard"}
            </button>
            <button className="ll-reset-btn" onClick={handleReset}>← Use a different account</button>
          </div>
        )}

        <p className="ll-copyright">© 2026 Learnalyntix</p>
      </div>

      {/* ── Right panel (unchanged) ── */}
      <div className="ll-right">
        <div className="ll-right-content">
          <h2 className="ll-right-heading">
            Identify risk early.<br />Intervene before it's too late.
          </h2>
          <p className="ll-right-sub">
            A data-driven platform helping institutions support at-risk students before they drop out.
          </p>

          <div className="ll-preview-card">
            <div className="ll-preview-label">Dropout risk overview</div>
            <div className="ll-preview-val">47 at-risk</div>
            <div className="ll-mini-bars">
              {[40, 55, 80, 65, 90, 72, 58, 95, 70, 50].map((h, i) => (
                <div
                  key={i}
                  className={`ll-mbar${h >= 80 ? " hi" : ""}`}
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>

          <div className="ll-stats-row">
            {[
              { v: "91%", l: "Intervention success" },
              { v: "23", l: "Dropouts prevented" },
              { v: "1,284", l: "Students monitored" },
            ].map((s) => (
              <div className="ll-stat-mini" key={s.l}>
                <div className="ll-stat-val">{s.v}</div>
                <div className="ll-stat-label">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
