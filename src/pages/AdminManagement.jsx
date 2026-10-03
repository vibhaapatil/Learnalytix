// src/pages/AdminManagement.jsx
//
// Admin self-service page: change your own password. The "Only superadmins
// can manage users" note is a placeholder for a future user-management
// section (invite/remove admins) — gated on role, not implemented yet.
//
// ASSUMPTION: this reads the logged-in admin's username from
// localStorage.getItem("learnalytix_admin_username") and their role from
// localStorage.getItem("learnalytix_admin_role"). Swap these two lines for
// whatever your actual auth/session mechanism stores (context, cookie, JWT
// claim, etc.) — I don't have your Login.jsx / auth setup to match exactly.

import { useState } from "react";
import "../css/AdminManagement.css";

const API_BASE = "http://localhost:5000/api";

function EyeToggle({ shown, onClick }) {
  return (
    <button type="button" className="am-eye" onClick={onClick} tabIndex={-1}>
      {shown ? "🙈" : "👁"}
    </button>
  );
}

export default function AdminManagement() {
  const username = localStorage.getItem("learnalytix_admin_username") || "";
  const role     = localStorage.getItem("learnalytix_admin_role") || "admin";
  const isSuperadmin = role === "superadmin";

  const [current, setCurrent]   = useState("");
  const [next, setNext]         = useState("");
  const [confirm, setConfirm]   = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext]       = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError]     = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving]   = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!current || !next || !confirm) {
      setError("Please fill in all three fields.");
      return;
    }
    if (next.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setError("New password and confirmation don't match.");
      return;
    }
    if (!username) {
      setError("Couldn't determine the logged-in admin username — check your auth setup.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/admin/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          current_password: current,
          new_password: next,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update password");

      setSuccess("Password updated successfully.");
      setCurrent(""); setNext(""); setConfirm("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="am-page">
      <h2><span className="am-icon">⚙️</span> Admin Management</h2>

      {!isSuperadmin && (
        <div className="am-notice">
          🔒 Only superadmins can manage users.
        </div>
      )}

      <h3 className="am-section-title"><span className="am-icon">🔑</span> Change Password</h3>
      <form className="am-card" onSubmit={handleSubmit}>
        <label className="am-field">
          Current Password
          <div className="am-pass-wrap">
            <input
              type={showCurrent ? "text" : "password"}
              value={current}
              onChange={e => setCurrent(e.target.value)}
              autoComplete="current-password"
            />
            <EyeToggle shown={showCurrent} onClick={() => setShowCurrent(v => !v)} />
          </div>
        </label>

        <label className="am-field">
          New Password
          <div className="am-pass-wrap">
            <input
              type={showNext ? "text" : "password"}
              value={next}
              onChange={e => setNext(e.target.value)}
              autoComplete="new-password"
            />
            <EyeToggle shown={showNext} onClick={() => setShowNext(v => !v)} />
          </div>
        </label>

        <label className="am-field">
          Confirm New Password
          <div className="am-pass-wrap">
            <input
              type={showConfirm ? "text" : "password"}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
            <EyeToggle shown={showConfirm} onClick={() => setShowConfirm(v => !v)} />
          </div>
        </label>

        {error && <p className="am-error">⚠ {error}</p>}
        {success && <p className="am-success">✅ {success}</p>}

        <button type="submit" className="am-submit-btn" disabled={saving}>
          {saving ? "Updating…" : "Update Password"}
        </button>
      </form>
    </div>
  );
}
