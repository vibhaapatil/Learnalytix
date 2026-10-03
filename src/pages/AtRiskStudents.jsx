// src/pages/AtRiskStudents.jsx
//
// Derives Fail_Risk_%, Dropout_Risk_%, and Combined_Risk_% for every student
// straight from the predictions already stored per student (no new backend
// endpoint needed):
//   Fail_Risk_%     = passfail_probabilities.Fail   (P(the student fails))
//   Dropout_Risk_%  = dropout_probabilities.High    (P(high dropout risk))
//   Combined_Risk_% = average of the two
//   Risk_Level      = High (>=60) / Medium (>=30) / Low (otherwise)
// These thresholds match the reference dashboard (60% / 30% lines).

import { useState, useEffect, useMemo } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip,
  BarChart, Bar, ReferenceLine, ResponsiveContainer, Cell,
} from "recharts";
import "../css/AtRiskStudents.css";

const API_BASE = "http://localhost:5000/api";

function flattenStudent(doc) {
  const p = doc.predictions || {};
  const failRisk    = p.passfail_probabilities?.Fail ?? 0;
  const dropoutRisk = p.dropout_probabilities?.High ?? 0;
  const combined     = Math.round(((failRisk + dropoutRisk) / 2) * 10) / 10;
  const riskLevel     = combined >= 60 ? "HIGH" : combined >= 30 ? "MEDIUM" : "LOW";
  return {
    ...doc,
    dropout_risk: p.dropout_risk, pass_fail: p.pass_fail,
    fail_risk_pct: Math.round(failRisk * 10) / 10,
    dropout_risk_pct: Math.round(dropoutRisk * 10) / 10,
    combined_risk_pct: combined,
    risk_level: riskLevel,
  };
}

function riskColor(pct) {
  // green (low) -> amber (medium) -> red (high), interpolated
  if (pct >= 60) return "#e74c3c";
  if (pct >= 30) return "#f39c12";
  return "#27ae60";
}

function downloadCSV(rows) {
  const headers = ["Student","Branch","Year","CGPA","Backlogs","Fail_Risk_%","Dropout_Risk_%","Combined_Risk_%","Risk_Level"];
  const lines = [headers.join(",")];
  rows.forEach(r => {
    lines.push([
      `"${r.name || ""}"`, r.branch, r.year, r.cgpa, r.backlogs,
      r.fail_risk_pct, r.dropout_risk_pct, r.combined_risk_pct, r.risk_level,
    ].join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "at_risk_students.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function AtRiskStudents() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [threshold, setThreshold] = useState(30);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/students`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `API error: ${res.status}`);
        }
        const data = await res.json();
        setStudents((data.students || []).map(flattenStudent));
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const counts = useMemo(() => ({
    high:   students.filter(s => s.risk_level === "HIGH").length,
    medium: students.filter(s => s.risk_level === "MEDIUM").length,
    low:    students.filter(s => s.risk_level === "LOW").length,
  }), [students]);

  const filtered = useMemo(
    () => students
      .filter(s => s.combined_risk_pct >= threshold)
      .sort((a, b) => b.combined_risk_pct - a.combined_risk_pct),
    [students, threshold]
  );

  const branchRisk = useMemo(() => {
    const byBranch = {};
    students.forEach(s => {
      if (!s.branch) return;
      byBranch[s.branch] = byBranch[s.branch] || [];
      byBranch[s.branch].push(s.combined_risk_pct);
    });
    return Object.entries(byBranch)
      .map(([branch, vals]) => ({
        branch,
        avgRisk: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10,
      }))
      .sort((a, b) => b.avgRisk - a.avgRisk);
  }, [students]);

  if (loading) return <div className="ar-loading">⏳ Loading risk data…</div>;
  if (error) return (
    <div className="ar-loading">
      <p style={{ color: "#e74c3c" }}>❌ {error}</p>
    </div>
  );

  return (
    <div className="ar-page">
      <h2>At-Risk Students</h2>

      <div className="ar-count-row">
        <div className="ar-count-item">
          <span className="ar-dot high" /> High Risk
          <div className="ar-count-val">{counts.high} students</div>
        </div>
        <div className="ar-count-item">
          <span className="ar-dot medium" /> Medium Risk
          <div className="ar-count-val">{counts.medium} students</div>
        </div>
        <div className="ar-count-item">
          <span className="ar-dot low" /> Low Risk
          <div className="ar-count-val">{counts.low} students</div>
        </div>
      </div>

      <div className="ar-slider-block">
        <label>Show students with Combined Risk above ({threshold}%)</label>
        <input
          type="range" min="0" max="100" step="1"
          value={threshold}
          onChange={e => setThreshold(Number(e.target.value))}
          className="ar-slider"
        />
      </div>

      <p className="ar-result-count">
        {filtered.length} student{filtered.length !== 1 ? "s" : ""} above {threshold}% risk threshold
      </p>

      <div className="ar-table-wrap">
        <table className="ar-table">
          <thead>
            <tr>
              <th>Student</th><th>Branch</th><th>Year</th><th>CGPA</th><th>Backlogs</th>
              <th>Fail Risk %</th><th>Dropout Risk %</th><th>Combined Risk %</th><th>Risk Level</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="ar-empty">No students above this threshold.</td></tr>
            ) : filtered.map((s, i) => (
              <tr key={s.roll_no || i}>
                <td>{s.name}</td>
                <td>{s.branch}</td>
                <td>{s.year}</td>
                <td>{s.cgpa}</td>
                <td>{s.backlogs}</td>
                <td>{s.fail_risk_pct}</td>
                <td>{s.dropout_risk_pct}</td>
                <td>{s.combined_risk_pct}</td>
                <td>
                  <span className={`ar-level ${s.risk_level.toLowerCase()}`}>
                    <span className="ar-dot-inline" /> {s.risk_level}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <button className="ar-download-btn" onClick={() => downloadCSV(filtered)}>
          ⬇ Download At-Risk Report
        </button>
      )}

      <div className="ar-charts-row">
        <div className="ar-chart-card">
          <h4>Fail Risk vs Dropout Risk Scatter</h4>
          <ResponsiveContainer width="100%" height={320}>
            <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
              <CartesianGrid stroke="#eee" />
              <XAxis type="number" dataKey="fail_risk_pct" name="Fail Risk %" domain={[0, 100]}
                label={{ value: "Fail Risk %", position: "insideBottom", offset: -8, fontSize: 12 }} />
              <YAxis type="number" dataKey="dropout_risk_pct" name="Dropout Risk %" domain={[0, 100]}
                label={{ value: "Dropout Risk %", angle: -90, position: "insideLeft", fontSize: 12 }} />
              <ZAxis range={[70, 70]} />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                formatter={(val, name) => [`${val}%`, name]}
                labelFormatter={() => ""}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="ar-tooltip">
                      <strong>{d.name}</strong><br />
                      Fail Risk: {d.fail_risk_pct}%<br />
                      Dropout Risk: {d.dropout_risk_pct}%<br />
                      Combined: {d.combined_risk_pct}%
                    </div>
                  );
                }}
              />
              <Scatter data={students}>
                {students.map((s, i) => (
                  <Cell key={i} fill={riskColor(s.combined_risk_pct)} fillOpacity={0.75} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        <div className="ar-chart-card">
          <h4>Risk Distribution by Branch</h4>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={branchRisk} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
              <CartesianGrid stroke="#eee" strokeDasharray="3 3" />
              <XAxis dataKey="branch" fontSize={12} />
              <YAxis domain={[0, 100]} fontSize={12} label={{ value: "Avg Combined Risk %", angle: -90, position: "insideLeft", fontSize: 11 }} />
              <Tooltip formatter={v => `${v}%`} />
              <ReferenceLine y={60} stroke="#e74c3c" strokeDasharray="4 4" label={{ value: "High threshold", position: "insideTopRight", fontSize: 10, fill: "#e74c3c" }} />
              <ReferenceLine y={30} stroke="#f39c12" strokeDasharray="4 4" label={{ value: "Medium threshold", position: "insideTopRight", fontSize: 10, fill: "#f39c12", dy: 14 }} />
              <Bar dataKey="avgRisk" radius={[6, 6, 0, 0]}>
                {branchRisk.map((b, i) => (
                  <Cell key={i} fill={riskColor(b.avgRisk)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
