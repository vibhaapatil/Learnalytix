// src/pages/StudentProfile.jsx
// Full profile page for a single student — navigated to from StudentLookup
//
// Fix log:
//   - SemesterChart now renders dynamically up to current_semester (not hardcoded S1-S4)
//   - S5, S6, S7 SGPA read from student object and shown in chart
//   - Checkpoint label shown in hero (e.g. "S6 checkpoint — Year 3")
//   - Attendance now tracked S1-S7 (dataset was regenerated to match SGPA
//     range) — chart shows an attendance bar for every completed semester,
//     not just S1-S4, and Overall Att% is labelled "S1–S7 avg"
//   - NEW: profile now always fetches /api/students/<roll_no> (MongoDB),
//     which is where shap contributions + recommendations live — a table
//     row's location.state is only used as an offline fallback
//   - NEW: "Recommended Actions" card shows the SHAP-derived recommendations
//     generated at upload time (see shap_utils.py generate_recommendations)
//   - "All Fields" now excludes internal/nested doc fields (predictions,
//     shap, recommendations, history, _id, timestamps) so it doesn't dump
//     raw objects
//   - NEW: SGPATrendChart — a recharts line/area chart of SGPA across
//     completed semesters with a dashed average reference line, matching
//     the "<Name> — SGPA Trend" chart from the reference dashboard.
//     Requires `npm install recharts`.

import { useParams, useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Area, AreaChart, ResponsiveContainer } from "recharts";
import "../css/StudentProfile.css";

const RISK_COLOR = { High: "#e74c3c", Medium: "#f39c12", Low: "#27ae60" };
const RISK_BG    = { High: "#fff0ef", Medium: "#fffbef", Low: "#effff5" };

function GaugeRing({ pct = 0, color = "#3d3d8f", size = 88 }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e8e8f0" strokeWidth="8" />
      <circle
        cx={size/2} cy={size/2} r={r} fill="none"
        stroke={color} strokeWidth="8"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: "stroke-dasharray 0.7s ease" }}
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle"
        fontSize="14" fontWeight="600" fill={color}>
        {pct}%
      </text>
    </svg>
  );
}

function SemesterChart({ sgpas = [], atts = [], semCount = 4 }) {
  const maxSGPA  = 10;
  const labels   = Array.from({ length: semCount }, (_, i) => `S${i + 1}`);
  const hasData  = sgpas.some(v => v > 0) || atts.some(v => v > 0);
  if (!hasData) return null;

  return (
    <div className="sp-sem-chart">
      <h4>Semester Breakdown</h4>
      <div className="sp-sem-bars">
        {labels.map((lbl, i) => {
          const sgpa = parseFloat(sgpas[i]) || 0;
          const att  = parseFloat(atts[i])  || 0;
          return (
            <div key={lbl} className="sp-sem-col">
              <div className="sp-sem-pair">
                <div className="sp-bar-track" title={`SGPA: ${sgpa}`}>
                  <div
                    className="sp-bar-fill sgpa"
                    style={{ height: `${(sgpa / maxSGPA) * 100}%` }}
                  />
                </div>
                {/* Attendance now tracked for every completed semester (S1-S7) */}
                <div className="sp-bar-track" title={`Attendance: ${att}%`}>
                 <div
  className="sp-bar-fill att"
  style={{
    height: `${att}%`,
    background: att < 75 ? "#e74c3c" : "#27ae60",   // green when healthy, red when low
  }}
/>
                </div>
              </div>
              <span className="sp-sem-label">{lbl}</span>
              <div className="sp-sem-vals">
                {sgpa > 0 && <span className="sp-sgpa-val">{sgpa}</span>}
                {att > 0 && <span className="sp-att-val">{att}%</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="sp-sem-legend">
        <span><span className="legend-dot sgpa" />SGPA</span>
        <span><span className="legend-dot att" />Attendance</span>
      </div>
    </div>
  );
}

// SGPA trend with an average reference line + shaded area under the curve —
// mirrors the "<Name> — SGPA Trend" chart from the reference dashboard.
function SGPATrendChart({ name, sgpas = [] }) {
  const points = sgpas
    .map((v, i) => ({ semester: i + 1, sgpa: parseFloat(v) || 0 }))
    .filter(p => p.sgpa > 0);
  if (points.length === 0) return null;

  const avg = Math.round((points.reduce((sum, p) => sum + p.sgpa, 0) / points.length) * 100) / 100;

  return (
    <div className="sp-card">
      <h3>{name ? `${name} — SGPA Trend` : "SGPA Trend"}</h3>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={points} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
          <CartesianGrid stroke="#eee" strokeDasharray="3 3" />
          <XAxis dataKey="semester" fontSize={12} label={{ value: "Semester", position: "insideBottom", offset: -5, fontSize: 12 }} />
          <YAxis domain={[0, 10]} fontSize={12} />
          <Tooltip formatter={v => v} labelFormatter={l => `Semester ${l}`} />
          <ReferenceLine y={avg} stroke="#888" strokeDasharray="4 4" label={{ value: `Avg: ${avg}`, position: "right", fontSize: 11, fill: "#888" }} />
          <Area type="monotone" dataKey="sgpa" stroke="#3d3d8f" strokeWidth={2.5} fill="#3d3d8f" fillOpacity={0.12} dot={{ r: 3 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function StudentProfile() {
  const { rollNo }  = useParams();
  const location    = useLocation();
  const navigate    = useNavigate();
  const [student, setStudent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    // Always fetch the full doc from the DB — it's the only place shap
    // contributions + recommendations live, even if we got a flattened
    // preview via location.state from the lookup/dashboard tables.
    async function load() {
      try {
        const res = await fetch(`http://localhost:5000/api/students/${rollNo}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `No student with roll number "${rollNo}"`);
        }
        const doc = await res.json();
        const p = doc.predictions || {};
        setStudent({
          ...doc,
          dropout_risk:           p.dropout_risk,
          dropout_confidence:     p.dropout_confidence,
          dropout_probabilities:  p.dropout_probabilities,
          pass_fail:              p.pass_fail,
          passfail_confidence:    p.passfail_confidence,
          passfail_probabilities: p.passfail_probabilities,
          recommendations:        doc.recommendations || [],
        });
      } catch (err) {
        // Fall back to whatever was passed via navigation state (e.g. from
        // a table row) so the page still renders something useful offline.
        if (location.state?.student) {
          setStudent(location.state.student);
        } else {
          setError(err.message);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [rollNo]);

  if (loading) return (
    <div className="sp-loading"><div className="sp-spinner" /><p>Loading profile…</p></div>
  );
  if (error) return (
    <div className="sp-error">
      <p>⚠ {error}</p>
      <button onClick={() => navigate("/students")}>← Back to Lookup</button>
    </div>
  );
  if (!student) return null;

  const s = student;

  const risk      = s.dropout_risk || "—";
  const riskColor = RISK_COLOR[risk] || "#888";
  const riskBg    = RISK_BG[risk]    || "#f5f5f5";
  const drConf    = s.dropout_confidence  || 0;
  const pfConf    = s.passfail_confidence || 0;

  // Build semester arrays dynamically from current_semester
  const semCount = parseInt(s.current_semester) || 4;
  const sgpas = Array.from({ length: semCount }, (_, i) =>
    parseFloat(s[`s${i + 1}_sgpa`]) || 0
  );
  // Attendance now collected S1-S7 (matches SGPA range)
  const atts = Array.from({ length: semCount }, (_, i) =>
    parseFloat(s[`att_s${i + 1}`]) || 0
  );

  const checkpointLabel = `S${semCount} checkpoint — Year ${Math.ceil(semCount / 2)}`;

  // Flags
  const flags = [];
  if (parseFloat(s.cgpa) < 5)         flags.push({ msg: "CGPA below 5.0",       level: "high" });
  if (parseFloat(s.overall_att) < 75)  flags.push({ msg: "Attendance below 75%", level: "high" });
  if (parseInt(s.backlogs) > 2)        flags.push({ msg: `${s.backlogs} active backlogs`, level: "high" });
  else if (parseInt(s.backlogs) > 0)   flags.push({ msg: `${s.backlogs} backlog(s)`, level: "medium" });
  if (parseFloat(s.cgpa) >= 5 && parseFloat(s.cgpa) < 7)
    flags.push({ msg: "CGPA below 7.0", level: "medium" });
  if (parseFloat(s.overall_att) >= 75 && parseFloat(s.overall_att) < 85)
    flags.push({ msg: "Attendance below 85%", level: "low" });

  // Detect declining SGPA trend (last 2 available sems vs first 2)
  if (semCount >= 4) {
    const early = (sgpas[0] + sgpas[1]) / 2;
    const recent = (sgpas[semCount - 2] + sgpas[semCount - 1]) / 2;
    if (recent < early - 0.5)
      flags.push({ msg: `Declining SGPA trend (${early.toFixed(1)} → ${recent.toFixed(1)})`, level: "medium" });
  }

  return (
    <div className="sp-page">

      <button className="sp-back" onClick={() => navigate("/students")}>
        ← Back to Lookup
      </button>

      {/* ── Hero ── */}
      <div className="sp-hero" style={{ "--risk-color": riskColor }}>
        <div className="sp-avatar">
          {s.name?.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
        </div>
        <div className="sp-hero-info">
          <h2>{s.name}</h2>
          <p className="sp-meta">
            <span>{s.roll_no}</span>
            <span className="sp-dot">·</span>
            <span>{s.branch}</span>
            <span className="sp-dot">·</span>
            <span>{checkpointLabel}</span>
          </p>
        </div>
        <div className="sp-risk-badge"
          style={{ background: riskBg, color: riskColor, borderColor: riskColor + "44" }}>
          <span className="sp-risk-label">Dropout Risk</span>
          <span className="sp-risk-val">{risk}</span>
          <span className="sp-risk-conf">{drConf}% confidence</span>
        </div>
      </div>

      {/* ── Flags ── */}
      {flags.length > 0 && (
        <div className="sp-flags">
          {flags.map((f, i) => (
            <div key={i} className={`sp-flag sp-flag-${f.level}`}>
              <span className="sp-flag-icon">{f.level === "high" ? "⚠" : "ℹ"}</span>
              {f.msg}
            </div>
          ))}
        </div>
      )}

      <div className="sp-body">

        {/* ── Left column ── */}
        <div className="sp-col">
          <div className="sp-card">
            <h3>Academic Snapshot</h3>
            <div className="sp-gauges">
              <div className="sp-gauge-item">
                <GaugeRing pct={Math.round((parseFloat(s.cgpa) / 10) * 100)} color="#3d3d8f" />
                <span>CGPA {s.cgpa}</span>
              </div>
              <div className="sp-gauge-item">
                <GaugeRing
                  pct={Math.round(parseFloat(s.overall_att) || 0)}
                  color={parseFloat(s.overall_att) < 75 ? "#e74c3c" : "#27ae60"}
                />
                {/* overall_att now averages across all completed semesters, S1-S7 */}
                <span>Att (S1–S7 avg)</span>
              </div>
            </div>
            <div className="sp-kv-grid">
              <div className="sp-kv">
                <span>Backlogs</span>
                <strong className={s.backlogs > 0 ? "warn" : ""}>{s.backlogs}</strong>
              </div>
              <div className="sp-kv"><span>Internship</span><strong>{s.internship ? "Yes" : "No"}</strong></div>
              <div className="sp-kv"><span>Projects</span><strong>{s.projects ?? "—"}</strong></div>
              <div className="sp-kv"><span>Hackathons</span><strong>{s.hackathons ?? "—"}</strong></div>
            </div>
          </div>

          <div className="sp-card">
            <SemesterChart sgpas={sgpas} atts={atts} semCount={semCount} />
          </div>

          <SGPATrendChart name={s.name} sgpas={sgpas} />
        </div>

        {/* ── Right column ── */}
        <div className="sp-col">
          <div className="sp-card sp-pred-card">
            <h3>ML Predictions</h3>

            <div className="sp-pred-block">
              <div className="sp-pred-header">
                <span>Dropout Risk</span>
                <span className="sp-pill" style={{ color: riskColor, background: riskBg }}>{risk}</span>
              </div>
              <div className="sp-conf-row">
                <div className="sp-conf-track">
                  <div className="sp-conf-fill" style={{ width: `${drConf}%`, background: riskColor }} />
                </div>
                <span>{drConf}%</span>
              </div>
              {s.dropout_probabilities && (
                <div className="sp-proba">
                  {Object.entries(s.dropout_probabilities).map(([cls, pct]) => (
                    <div key={cls} className="sp-proba-row">
                      <span className="sp-proba-lbl">{cls}</span>
                      <div className="sp-proba-track">
                        <div className="sp-proba-fill"
                          style={{ width: `${pct}%`, background: RISK_COLOR[cls] || "#888" }} />
                      </div>
                      <span className="sp-proba-pct">{pct}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="sp-pred-block">
              <div className="sp-pred-header">
                <span>Pass / Fail Prediction</span>
                <span className={`sp-pf-pill ${s.pass_fail === "Pass" ? "pass" : "fail"}`}>
                  {s.pass_fail || "—"}
                </span>
              </div>
              <div className="sp-conf-row">
                <div className="sp-conf-track">
                  <div className="sp-conf-fill"
                    style={{ width: `${pfConf}%`, background: s.pass_fail === "Pass" ? "#27ae60" : "#e74c3c" }} />
                </div>
                <span>{pfConf}%</span>
              </div>
              {s.passfail_probabilities && (
                <div className="sp-proba">
                  {Object.entries(s.passfail_probabilities).map(([cls, pct]) => (
                    <div key={cls} className="sp-proba-row">
                      <span className="sp-proba-lbl">{cls}</span>
                      <div className="sp-proba-track">
                        <div className="sp-proba-fill"
                          style={{ width: `${pct}%`, background: cls === "Pass" ? "#27ae60" : "#e74c3c" }} />
                      </div>
                      <span className="sp-proba-pct">{pct}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* SHAP-derived recommendations, generated at upload time (see shap_utils.py) */}
          {s.recommendations?.length > 0 && (
            <div className="sp-card">
              <h3>Recommended Actions</h3>
              <div className="sp-raw-grid" style={{ gap: "8px" }}>
                {s.recommendations.map((rec, i) => (
                  <div key={i} className="sp-raw-row" style={{
                    display: "flex", alignItems: "flex-start", gap: "8px",
                    background: "#fff8ec",
                  }}>
                    <span style={{ color: "#d35400" }}>💡</span>
                    <span className="sp-raw-val" style={{ fontWeight: 400 }}>{rec}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="sp-card">
            <h3>All Fields</h3>
            <div className="sp-raw-grid">
              {Object.entries(s)
                .filter(([k]) => ![
                  "dropout_probabilities", "passfail_probabilities",
                  "predictions", "shap", "recommendations", "history",
                  "_id", "created_at", "updated_at",
                ].includes(k))
                .map(([k, v]) => (
                  <div key={k} className="sp-raw-row">
                    <span className="sp-raw-key">{k.replace(/_/g, " ")}</span>
                    <span className="sp-raw-val">{String(v ?? "—")}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
