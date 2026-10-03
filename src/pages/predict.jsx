// src/pages/Predict.jsx
// Form to enter student data and get ML predictions from Flask API
//
// Fix log:
//   - BRANCHES corrected to AI, CE, CST, DS, ENC (removed IT/ME/EE/EC)
//   - current_semester field added and sent to API
//   - S5, S6, S7 SGPA fields shown dynamically based on current_semester
//   - form submission includes all semester SGPA fields
//   - Attendance % now scales with current_semester (S1 up to S{visibleSems}),
//     matching the SGPA section, instead of being hardcoded to S1–S4

import { useState } from "react";
import { predictStudent } from "../services/mlService";
import "../css/Predict.css";

const BRANCHES = ["AI", "CE", "CST", "DS", "ENC"];

// Which semesters are visible at each checkpoint
const SEM_COUNT = { 2: 2, 4: 4, 6: 6, 7: 7 };
const CHECKPOINTS = [2, 4, 6, 7];

const initialForm = {
  roll_no: "", name: "", branch: "CE",
  year: 1, current_semester: 2,
  cgpa: "", overall_att: "", backlogs: 0, internship: false,
  projects: 0, hackathons: 0,
  s1_sgpa: "", s2_sgpa: "", s3_sgpa: "", s4_sgpa: "",
  s5_sgpa: "", s6_sgpa: "", s7_sgpa: "",
  att_s1: "", att_s2: "", att_s3: "", att_s4: "",
  att_s5: "", att_s6: "", att_s7: "",
};

export default function Predict() {
  const [form, setForm]       = useState(initialForm);
  const [result, setResult]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  // When semester changes, also update year to keep them in sync
  const handleSemesterChange = (sem) => {
    const semNum = parseInt(sem);
    const inferredYear = Math.ceil(semNum / 2);
    setForm(f => ({ ...f, current_semester: semNum, year: inferredYear }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const prediction = await predictStudent(form);
      setResult(prediction);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const riskColor = (risk) =>
    ({ High: "#e74c3c", Medium: "#f39c12", Low: "#27ae60" }[risk] || "#888");

  const visibleSems = SEM_COUNT[form.current_semester] || 2;

  return (
    <div className="predict-page">
      <h2>Student Risk Prediction</h2>
      <p className="subtitle">
        Enter student data up to their current semester to predict dropout risk and pass/fail outcome.
      </p>

      <form onSubmit={handleSubmit} className="predict-form">

        {/* Basic Info */}
        <section className="form-section">
          <h3>Basic Info</h3>
          <div className="form-row">
            <label>Roll No
              <input value={form.roll_no} onChange={e => set("roll_no", e.target.value)} placeholder="ENG2024001" />
            </label>
            <label>Student Name
              <input value={form.name} onChange={e => set("name", e.target.value)} placeholder="Full name" />
            </label>
            <label>Branch
              <select value={form.branch} onChange={e => set("branch", e.target.value)}>
                {BRANCHES.map(b => <option key={b}>{b}</option>)}
              </select>
            </label>
            <label>Current Semester
              <select
                value={form.current_semester}
                onChange={e => handleSemesterChange(e.target.value)}
              >
                {CHECKPOINTS.map(s => (
                  <option key={s} value={s}>S{s} (Year {Math.ceil(s / 2)})</option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {/* Academic Performance */}
        <section className="form-section">
          <h3>Academic Performance</h3>
          <div className="form-row">
            <label>CGPA *
              <input type="number" min="0" max="10" step="0.01" required
                value={form.cgpa} onChange={e => set("cgpa", e.target.value)}
                placeholder="e.g. 7.5" />
            </label>
            <label>Overall Att % *
              <input type="number" min="0" max="100" step="0.1" required
                value={form.overall_att} onChange={e => set("overall_att", e.target.value)}
                placeholder="e.g. 82" />
            </label>
            <label>Active Backlogs
              <input type="number" min="0" value={form.backlogs}
                onChange={e => set("backlogs", parseInt(e.target.value) || 0)} />
            </label>
          </div>

          {/* SGPA — only show semesters up to current checkpoint */}
          <h4 style={{ margin: "12px 0 8px", fontSize: "0.85rem", color: "#666" }}>
            Semester SGPA — enter only completed semesters (S1 to S{visibleSems})
          </h4>
          <div className="form-row">
            {Array.from({ length: visibleSems }, (_, i) => {
              const key = `s${i + 1}_sgpa`;
              return (
                <label key={key}>S{i + 1} SGPA
                  <input type="number" min="0" max="10" step="0.01"
                    value={form[key]}
                    onChange={e => set(key, e.target.value)}
                    placeholder="0–10" />
                </label>
              );
            })}
          </div>

          {/* Attendance — scales with current_semester, same as SGPA above */}
          <h4 style={{ margin: "12px 0 8px", fontSize: "0.85rem", color: "#666" }}>
            Attendance % (S1–S{visibleSems})
          </h4>
          <div className="form-row">
            {Array.from({ length: visibleSems }, (_, i) => {
              const key = `att_s${i + 1}`;
              return (
                <label key={key}>Att S{i + 1} %
                  <input type="number" min="0" max="100" step="0.1"
                    value={form[key]}
                    onChange={e => set(key, e.target.value)}
                    placeholder="0 if N/A" />
                </label>
              );
            })}
          </div>
        </section>

        {/* Extracurricular */}
        <section className="form-section">
          <h3>Extracurricular</h3>
          <div className="form-row">
            <label>Projects
              <input type="number" min="0" value={form.projects}
                onChange={e => set("projects", parseInt(e.target.value) || 0)} />
            </label>
            <label>Hackathons
              <input type="number" min="0" value={form.hackathons}
                onChange={e => set("hackathons", parseInt(e.target.value) || 0)} />
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={form.internship}
                onChange={e => set("internship", e.target.checked)} />
              Has Internship
            </label>
          </div>
        </section>

        {error && <p className="error-msg">{error}</p>}
        <button type="submit" className="predict-btn" disabled={loading}>
          {loading ? "Predicting…" : "Predict"}
        </button>
      </form>

      {/* Results */}
      {result && (
        <div className="results-card">
          <h3>Prediction Result</h3>
          <div className="results-grid">
            <div className="result-item">
              <span className="result-label">Dropout Risk</span>
              <span className="result-value" style={{ color: riskColor(result.dropout_risk) }}>
                {result.dropout_risk}
              </span>
              <span className="result-conf">{result.dropout_confidence}% confidence</span>
              <div className="proba-bars">
                {Object.entries(result.dropout_probabilities).map(([cls, pct]) => (
                  <div key={cls} className="proba-row">
                    <span>{cls}</span>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${pct}%`, background: riskColor(cls) }} />
                    </div>
                    <span>{pct}%</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="result-item">
              <span className="result-label">Pass / Fail</span>
              <span className="result-value" style={{ color: result.pass_fail === "Pass" ? "#27ae60" : "#e74c3c" }}>
                {result.pass_fail}
              </span>
              <span className="result-conf">{result.passfail_confidence}% confidence</span>
              <div className="proba-bars">
                {Object.entries(result.passfail_probabilities).map(([cls, pct]) => (
                  <div key={cls} className="proba-row">
                    <span>{cls}</span>
                    <div className="bar-track">
                      <div className="bar-fill"
                        style={{ width: `${pct}%`, background: cls === "Pass" ? "#27ae60" : "#e74c3c" }} />
                    </div>
                    <span>{pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


