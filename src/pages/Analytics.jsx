// src/pages/Analytics.jsx
//
// Cohort-level analytics, all computed client-side from /api/students —
// no new backend endpoints needed since every student doc already carries
// branch, year, cgpa, backlogs, s1-7_sgpa, att_s1-7, and predictions.

import { useState, useEffect, useMemo } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, BarChart, Bar, ReferenceLine, ResponsiveContainer,
} from "recharts";
import "../css/Analytics.css";

const API_BASE = "http://localhost:5000/api";
const RISK_COLOR = { Low: "#27ae60", Medium: "#f39c12", High: "#e74c3c" };
const RISK_SCORE = { Low: 0, Medium: 1, High: 2 };
const BRANCH_COLORS = ["#3d3d8f", "#e67e22", "#27ae60", "#c0392b", "#8e44ad", "#16a085"];
const ATT_BINS = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];

function flattenStudent(doc) {
  const p = doc.predictions || {};
  return { ...doc, dropout_risk: p.dropout_risk, pass_fail: p.pass_fail };
}

function heatColor(val, max) {
  // green (low risk) -> yellow -> red (high risk), val in [0, max]
  const t = max > 0 ? Math.min(val / max, 1) : 0;
  if (t < 0.5) {
    const k = t / 0.5;
    return `rgb(${Math.round(39 + k * (255 - 39))}, ${Math.round(174 + k * (235 - 174))}, ${Math.round(96 + k * (59 - 96))})`;
  }
  const k = (t - 0.5) / 0.5;
  return `rgb(${Math.round(255 + k * (231 - 255))}, ${Math.round(235 + k * (76 - 235))}, ${Math.round(59 + k * (60 - 59))})`;
}

export default function Analytics() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");

  const [branchFilter, setBranchFilter] = useState("All");
  const [yearFilter, setYearFilter]     = useState("All");
  const [riskFilter, setRiskFilter]     = useState(["Low", "Medium", "High"]);

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

  const branches = useMemo(
    () => ["All", ...Array.from(new Set(students.map(s => s.branch).filter(Boolean))).sort()],
    [students]
  );
  const years = useMemo(
    () => ["All", ...Array.from(new Set(students.map(s => s.year).filter(Boolean))).sort((a, b) => a - b)],
    [students]
  );

  function toggleRisk(r) {
    setRiskFilter(f => f.includes(r) ? f.filter(x => x !== r) : [...f, r]);
  }

  const filtered = useMemo(() => students.filter(s => {
    const mBranch = branchFilter === "All" || s.branch === branchFilter;
    const mYear   = yearFilter === "All" || String(s.year) === String(yearFilter);
    const mRisk   = riskFilter.includes(s.dropout_risk);
    return mBranch && mYear && mRisk;
  }), [students, branchFilter, yearFilter, riskFilter]);

  // ── Backlogs vs CGPA, split into 3 series so each risk level gets its own color/legend entry
  const scatterByRisk = useMemo(() => ({
    Low:    filtered.filter(s => s.dropout_risk === "Low"),
    Medium: filtered.filter(s => s.dropout_risk === "Medium"),
    High:   filtered.filter(s => s.dropout_risk === "High"),
  }), [filtered]);

  // ── Avg dropout risk score by Branch & Year (0=Low,1=Medium,2=High)
  const heatmap = useMemo(() => {
    const cells = {}; // `${branch}|${year}` -> {sum, n}
    filtered.forEach(s => {
      if (!s.branch || !s.year || !(s.dropout_risk in RISK_SCORE)) return;
      const key = `${s.branch}|${s.year}`;
      cells[key] = cells[key] || { sum: 0, n: 0 };
      cells[key].sum += RISK_SCORE[s.dropout_risk];
      cells[key].n += 1;
    });
    const branchList = Array.from(new Set(filtered.map(s => s.branch).filter(Boolean))).sort();
    const yearList = Array.from(new Set(filtered.map(s => s.year).filter(Boolean))).sort((a, b) => a - b);
    return { branchList, yearList, cells };
  }, [filtered]);

  // ── Subject-wise SGPA summary (avg per branch per semester, ignoring 0 = not-yet-reached)
  const sgpaSummary = useMemo(() => {
    const branchList = Array.from(new Set(filtered.map(s => s.branch).filter(Boolean))).sort();
    return branchList.map(branch => {
      const rows = filtered.filter(s => s.branch === branch);
      const sems = {};
      for (let i = 1; i <= 7; i++) {
        const vals = rows.map(r => parseFloat(r[`s${i}_sgpa`])).filter(v => v > 0);
        sems[`s${i}`] = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : "—";
      }
      return { branch, ...sems };
    });
  }, [filtered]);

  // ── SGPA trend by branch (line chart, x = semester 1-7)
  const trendData = useMemo(() => {
    const branchList = Array.from(new Set(filtered.map(s => s.branch).filter(Boolean))).sort();
    return Array.from({ length: 7 }, (_, i) => {
      const sem = i + 1;
      const point = { semester: sem };
      branchList.forEach(branch => {
        const vals = filtered
          .filter(s => s.branch === branch)
          .map(r => parseFloat(r[`s${sem}_sgpa`]))
          .filter(v => v > 0);
        point[branch] = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null;
      });
      return point;
    });
  }, [filtered]);
  const trendBranches = useMemo(
    () => Array.from(new Set(filtered.map(s => s.branch).filter(Boolean))).sort(),
    [filtered]
  );

  // ── Attendance distribution histogram, grouped by branch
  const attHistogram = useMemo(() => {
    const branchList = Array.from(new Set(filtered.map(s => s.branch).filter(Boolean))).sort();
    return ATT_BINS.slice(0, -1).map((lo, i) => {
      const hi = ATT_BINS[i + 1];
      const bucket = { range: `${lo}-${hi}` };
      branchList.forEach(branch => {
        bucket[branch] = filtered.filter(s =>
          s.branch === branch &&
          parseFloat(s.overall_att) >= lo &&
          parseFloat(s.overall_att) < hi
        ).length;
      });
      return bucket;
    });
  }, [filtered]);

  if (loading) return <div className="an-loading">⏳ Loading analytics…</div>;
  if (error) return (
    <div className="an-loading"><p style={{ color: "#e74c3c" }}>❌ {error}</p></div>
  );

  const heatMax = 2; // RISK_SCORE range is 0-2

  return (
    <div className="an-page">
      <h2>Analytics</h2>

      <div className="an-filters">
        <label>
          Branch
          <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)}>
            {branches.map(b => <option key={b}>{b}</option>)}
          </select>
        </label>
        <label>
          Year
          <select value={yearFilter} onChange={e => setYearFilter(e.target.value)}>
            {years.map(y => <option key={y}>{y}</option>)}
          </select>
        </label>
        <div className="an-risk-tags">
          <span className="an-risk-label">Dropout Risk</span>
          {["Low", "Medium", "High"].map(r => (
            <button
              key={r}
              className={`an-risk-tag ${riskFilter.includes(r) ? "active" : ""}`}
              style={riskFilter.includes(r) ? { background: RISK_COLOR[r], borderColor: RISK_COLOR[r] } : {}}
              onClick={() => toggleRisk(r)}
            >
              {r} {riskFilter.includes(r) && "✕"}
            </button>
          ))}
        </div>
      </div>

      <p className="an-showing">Showing {filtered.length} students</p>

      {/* ── Scatter + Heatmap ── */}
      <div className="an-row">
        <div className="an-card">
          <h4>Backlogs vs CGPA (coloured by Dropout Risk)</h4>
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
              <CartesianGrid stroke="#eee" />
              <XAxis type="number" dataKey="backlogs" name="Backlogs"
                label={{ value: "Backlogs", position: "insideBottom", offset: -8, fontSize: 12 }} />
              <YAxis type="number" dataKey="cgpa" name="CGPA" domain={[0, 10]}
                label={{ value: "CGPA", angle: -90, position: "insideLeft", fontSize: 12 }} />
              <Tooltip cursor={{ strokeDasharray: "3 3" }} />
              <Legend />
              {["Low", "Medium", "High"].map(r => (
                <Scatter key={r} name={r} data={scatterByRisk[r]} fill={RISK_COLOR[r]} fillOpacity={0.7} />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        <div className="an-card">
          <h4>Average Dropout Risk by Branch &amp; Year</h4>
          <div className="an-heatmap-wrap">
            <table className="an-heatmap">
              <thead>
                <tr>
                  <th></th>
                  {heatmap.yearList.map(y => <th key={y}>{y}</th>)}
                </tr>
              </thead>
              <tbody>
                {heatmap.branchList.map(branch => (
                  <tr key={branch}>
                    <th>{branch}</th>
                    {heatmap.yearList.map(year => {
                      const cell = heatmap.cells[`${branch}|${year}`];
                      const avg = cell ? cell.sum / cell.n : null;
                      return (
                        <td
                          key={year}
                          style={avg !== null ? { background: heatColor(avg, heatMax) } : {}}
                        >
                          {avg !== null ? avg.toFixed(1) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="an-heatmap-legend">0 = Low risk · 2 = High risk (averaged)</p>
          </div>
        </div>
      </div>

      {/* ── Subject-wise SGPA summary ── */}
      <div className="an-card an-full">
        <h4>Subject-wise SGPA Summary</h4>
        <div className="an-table-wrap">
          <table className="an-sgpa-table">
            <thead>
              <tr>
                <th>Branch</th>
                {[1,2,3,4,5,6,7].map(i => <th key={i}>S{i} SGPA</th>)}
              </tr>
            </thead>
            <tbody>
              {sgpaSummary.map(row => (
                <tr key={row.branch}>
                  <td className="an-branch-cell">{row.branch}</td>
                  {[1,2,3,4,5,6,7].map(i => <td key={i}>{row[`s${i}`]}</td>)}
                </tr>
              ))}
              {sgpaSummary.length === 0 && (
                <tr><td colSpan={8} className="an-empty">No data for the current filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── SGPA trend + attendance histogram ── */}
      <div className="an-row">
        <div className="an-card">
          <h4>Average SGPA Trend by Branch</h4>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={trendData} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
              <CartesianGrid stroke="#eee" strokeDasharray="3 3" />
              <XAxis dataKey="semester" fontSize={12} label={{ value: "Semester", position: "insideBottom", offset: -5, fontSize: 12 }} />
              <YAxis domain={[0, 10]} fontSize={12} />
              <Tooltip />
              <Legend />
              {trendBranches.map((b, i) => (
                <Line key={b} type="monotone" dataKey={b} stroke={BRANCH_COLORS[i % BRANCH_COLORS.length]}
                  strokeWidth={2} dot={{ r: 3 }} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="an-card">
          <h4>Attendance Distribution</h4>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={attHistogram} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
              <CartesianGrid stroke="#eee" strokeDasharray="3 3" />
              <XAxis dataKey="range" fontSize={11} label={{ value: "Average Attendance %", position: "insideBottom", offset: -8, fontSize: 12 }} />
              <YAxis fontSize={12} label={{ value: "Count", angle: -90, position: "insideLeft", fontSize: 12 }} />
              <Tooltip />
              <Legend />
              {trendBranches.map((b, i) => (
                <Bar key={b} dataKey={b} fill={BRANCH_COLORS[i % BRANCH_COLORS.length]} fillOpacity={0.75} />
              ))}
            </BarChart>
          </ResponsiveContainer>
          <p className="an-heatmap-legend">Bins are 5-point Attendance % buckets — the 70–75 / 75–80 bins straddle the usual 75% eligibility threshold.</p>
        </div>
      </div>
    </div>
  );
}
