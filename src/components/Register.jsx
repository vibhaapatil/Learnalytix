import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/Register.css";

// Set this to wherever your Flask app runs. Consider moving to a .env
// (VITE_API_URL) instead of hardcoding once you deploy.
const API_URL = "http://localhost:5000/api";

export default function Register() {
  const navigate = useNavigate();
  const goToLogin = () => navigate("/");

  const [step, setStep] = useState(1); // step 1 = personal info, step 2 = account setup
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});

  const [form, setForm] = useState({
    fullName: "",
    rollNumber: "",
    email: "",
    phone: "",
    branch: "",
    semester: "",
    password: "",
    confirmPassword: "",
  });

  // Matches VALID_BRANCHES in auth_routes.py / your students collection.
  const branches = [
    { code: "CST", label: "Computer Science & Technology" },
    { code: "CE",  label: "Civil Engineering" },
    { code: "AI",  label: "Artificial Intelligence" },
    { code: "DS",  label: "Data Science" },
    { code: "ENC", label: "Electronics & Communication" },
  ];

  const semesters = [1, 2, 3, 4, 5, 6, 7, 8];

  const update = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const validateStep1 = () => {
    const e = {};
    if (!form.fullName.trim()) e.fullName = "Full name is required.";
    if (!form.rollNumber.trim()) e.rollNumber = "Roll number is required.";
    if (!form.email.trim()) e.email = "Email is required.";
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = "Enter a valid email.";
    if (!form.branch) e.branch = "Please select your branch.";
    if (!form.semester) e.semester = "Please select your semester.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateStep2 = () => {
    const e = {};
    if (!form.password) e.password = "Password is required.";
    else if (form.password.length < 6) e.password = "Password must be at least 6 characters.";
    if (!form.confirmPassword) e.confirmPassword = "Please confirm your password.";
    else if (form.password !== form.confirmPassword) e.confirmPassword = "Passwords do not match.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => {
    if (validateStep1()) setStep(2);
  };

  const handleSubmit = async () => {
    if (!validateStep2()) return;

    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: form.fullName,
          rollNumber: form.rollNumber,
          email: form.email,
          phone: form.phone,
          branch: form.branch,
          semester: form.semester,
          password: form.password,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        // Backend returns field-level errors (roll number not found, branch/
        // semester mismatch, duplicate email, etc.) in the same shape as
        // this form's local `errors` state.
        setErrors(data.errors || { fullName: "Registration failed. Please try again." });
        setSubmitting(false);
        if (data.errors && (data.errors.email || data.errors.rollNumber || data.errors.branch || data.errors.semester)) {
          setStep(1);
        }
        return;
      }

      // Registration also returns a token, so the new student is signed in
      // immediately rather than having to log in again right after.
      localStorage.setItem("learnalytix_token", data.token);
      setSubmitting(false);
      setSuccess(true);
    } catch (err) {
      setSubmitting(false);
      setErrors({ fullName: "Could not reach the server. Please try again." });
    }
  };

  if (success) {
    return (
      <div className="rg-wrap">
        <div className="rg-left">
          <div className="rg-logo-row">
            <div className="rg-logo-box">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EEEDFE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/>
                <line x1="6" y1="9" x2="12" y2="15"/><line x1="18" y1="9" x2="12" y2="15"/>
              </svg>
            </div>
            <span className="rg-logo-name">Learnalyntix</span>
          </div>

          <div className="rg-success-box">
            <div className="rg-success-circle">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0F6E56" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <h2 className="rg-success-title">Registration successful!</h2>
            <p className="rg-success-sub">
              Welcome, <strong>{form.fullName}</strong>! Your student account has been created. You can now sign in to access your portal.
            </p>
            <button className="rg-submit-btn" onClick={goToLogin}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/>
                <polyline points="10 17 15 12 10 7"/>
                <line x1="15" y1="12" x2="3" y2="12"/>
              </svg>
              Go to Sign In
            </button>
          </div>

          <p className="rg-copyright">© 2026 Learnalyntix</p>
        </div>
        <div className="rg-right">
          <RightPanel />
        </div>
      </div>
    );
  }

  return (
    <div className="rg-wrap">
      {/* ── Left panel ── */}
      <div className="rg-left">
        <div className="rg-logo-row">
          <div className="rg-logo-box">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EEEDFE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/>
              <line x1="6" y1="9" x2="12" y2="15"/><line x1="18" y1="9" x2="12" y2="15"/>
            </svg>
          </div>
          <span className="rg-logo-name">Learnalyntix</span>
        </div>

        <div className="rg-form-box">
          <h1 className="rg-title">Create your account</h1>
          <p className="rg-sub">Student registration — takes less than a minute</p>

          {/* Step indicator */}
          <div className="rg-steps">
            <div className={`rg-step ${step >= 1 ? "active" : ""}`}>
              <div className="rg-step-circle">
                {step > 1
                  ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                  : "1"}
              </div>
              <span>Personal info</span>
            </div>
            <div className="rg-step-line" />
            <div className={`rg-step ${step >= 2 ? "active" : ""}`}>
              <div className="rg-step-circle">2</div>
              <span>Account setup</span>
            </div>
          </div>

          {/* ── Step 1 ── */}
          {step === 1 && (
            <div className="rg-fields">
              <div className="rg-field">
                <label>Full name</label>
                <input
                  type="text"
                  placeholder="e.g. Arjun Mehta"
                  value={form.fullName}
                  onChange={(e) => update("fullName", e.target.value)}
                />
                {errors.fullName && <span className="rg-err">{errors.fullName}</span>}
              </div>

              <div className="rg-row">
                <div className="rg-field">
                  <label>Roll number</label>
                  <input
                    type="text"
                    placeholder="e.g. 2021CS001"
                    value={form.rollNumber}
                    onChange={(e) => update("rollNumber", e.target.value)}
                  />
                  {errors.rollNumber && <span className="rg-err">{errors.rollNumber}</span>}
                  <span className="rg-hint">Must already be on file — ask your admin if it's not recognized.</span>
                </div>
                <div className="rg-field">
                  <label>Phone (optional)</label>
                  <input
                    type="tel"
                    placeholder="e.g. 9876543210"
                    value={form.phone}
                    onChange={(e) => update("phone", e.target.value)}
                  />
                </div>
              </div>

              <div className="rg-field">
                <label>College email</label>
                <input
                  type="email"
                  placeholder="you@college.edu"
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                />
                {errors.email && <span className="rg-err">{errors.email}</span>}
              </div>

              <div className="rg-row">
                <div className="rg-field">
                  <label>Branch</label>
                  <select
                    value={form.branch}
                    onChange={(e) => update("branch", e.target.value)}
                  >
                    <option value="">Select branch</option>
                    {branches.map((b) => <option key={b.code} value={b.code}>{b.label}</option>)}
                  </select>
                  {errors.branch && <span className="rg-err">{errors.branch}</span>}
                </div>
                <div className="rg-field">
                  <label>Current semester</label>
                  <select
                    value={form.semester}
                    onChange={(e) => update("semester", e.target.value)}
                  >
                    <option value="">Select semester</option>
                    {semesters.map((s) => <option key={s} value={s}>Semester {s}</option>)}
                  </select>
                  {errors.semester && <span className="rg-err">{errors.semester}</span>}
                </div>
              </div>

              <button className="rg-submit-btn" onClick={handleNext}>
                Next — Account setup
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                </svg>
              </button>
            </div>
          )}

          {/* ── Step 2 ── */}
          {step === 2 && (
            <div className="rg-fields">
              <div className="rg-review-card">
                <div className="rg-review-avatar">{form.fullName.charAt(0).toUpperCase()}</div>
                <div>
                  <div className="rg-review-name">{form.fullName}</div>
                  <div className="rg-review-meta">{form.branch} · Semester {form.semester}</div>
                  <div className="rg-review-meta">{form.rollNumber}</div>
                </div>
              </div>

              <div className="rg-field">
                <label>Create password</label>
                <div className="rg-pass-wrap">
                  <input
                    type={showPass ? "text" : "password"}
                    placeholder="Min. 6 characters"
                    value={form.password}
                    onChange={(e) => update("password", e.target.value)}
                  />
                  <button className="rg-eye" onClick={() => setShowPass(!showPass)} type="button" aria-label="Toggle password">
                    {showPass
                      ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    }
                  </button>
                </div>
                {errors.password && <span className="rg-err">{errors.password}</span>}
              </div>

              <div className="rg-field">
                <label>Confirm password</label>
                <div className="rg-pass-wrap">
                  <input
                    type={showConfirm ? "text" : "password"}
                    placeholder="Re-enter your password"
                    value={form.confirmPassword}
                    onChange={(e) => update("confirmPassword", e.target.value)}
                  />
                  <button className="rg-eye" onClick={() => setShowConfirm(!showConfirm)} type="button" aria-label="Toggle confirm password">
                    {showConfirm
                      ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    }
                  </button>
                </div>
                {errors.confirmPassword && <span className="rg-err">{errors.confirmPassword}</span>}
              </div>

              <div className="rg-btn-row">
                <button className="rg-back-btn" onClick={() => setStep(1)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
                  </svg>
                  Back
                </button>
                <button className="rg-submit-btn rg-submit-flex" onClick={handleSubmit} disabled={submitting}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  {submitting ? "Creating account…" : "Create account"}
                </button>
              </div>
            </div>
          )}

          <p className="rg-login-row">
            Already have an account?{" "}
            <span className="rg-login-link" onClick={goToLogin}>Sign in →</span>
          </p>
        </div>

        <p className="rg-copyright">© 2026 Learnalyntix</p>
      </div>

      {/* ── Right panel ── */}
      <div className="rg-right">
        <RightPanel />
      </div>
    </div>
  );
}

function RightPanel() {
  return (
    <div className="rg-right-content">
      <h2 className="rg-right-heading">
        Your academic journey starts here.
      </h2>
      <p className="rg-right-sub">
        Learnalyntix helps you stay on track, spot challenges early, and connect with the right support — before it's too late.
      </p>

      <div className="rg-feature-list">
        {[
          { icon: "📊", title: "Track your progress", desc: "See your attendance, grades, and engagement in one place." },
          { icon: "🎯", title: "Set & hit goals", desc: "Create weekly targets and get nudges to stay consistent." },
          { icon: "💬", title: "Talk to a counselor", desc: "Reach out to your assigned counselor anytime, instantly." },
          { icon: "📚", title: "Access resources", desc: "Study tips, mental health guides, and scholarship info." },
        ].map((f) => (
          <div className="rg-feature-item" key={f.title}>
            <div className="rg-feature-icon">{f.icon}</div>
            <div>
              <div className="rg-feature-title">{f.title}</div>
              <div className="rg-feature-desc">{f.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
