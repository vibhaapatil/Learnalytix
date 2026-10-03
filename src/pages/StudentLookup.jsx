// src/pages/StudentLookup.jsx
//
// Fix log:
//   - NEW: now reads from /api/students (MongoDB) instead of the bundled
//     students.json + live /api/predict/batch calls, so it always reflects
//     whichever CSV was last uploaded via the admin Upload page
//   - NEW: doc.recommendations (SHAP-derived) passed through on each row so
//     StudentProfile has them immediately without a second fetch

import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { getCached, setCached } from "../data/studentsCache.js";
import "../css/StudentLookup.css";

const RISK_COLOR = { High: "#e74c3c", Medium: "#f39c12", Low: "#27ae60" };
const RISK_BG    = { High: "#fdf0ef", Medium: "#fef9ef", Low: "#edfaf3" };
const API_BASE   = "http://localhost:5000/api";

// Flatten the nested Mongo doc shape ({ predictions: {...}, recommendations: [...] })
// into the flat fields this page (and StudentProfile) expect.
function flattenStudent(doc) {
  const p = doc.predictions || {};
  return {
    ...doc,
    dropout_risk:           p.dropout_risk,
    dropout_confidence:     p.dropout_confidence,
    dropout_probabilities:  p.dropout_probabilities,
    pass_fail:              p.pass_fail,
    passfail_confidence:    p.passfail_confidence,
    passfail_probabilities: p.passfail_probabilities,
    recommendations:        doc.recommendations || [],
  };
}

function riskPill(risk) {
  return (
    <span className="sl-pill" style={{ color: RISK_COLOR[risk] || "#888", background: RISK_BG[risk] || "#f5f5f5" }}>
      {risk || "—"}
    </span>
  );
}

function pfPill(pf) {
  return (
    <span className={`sl-pf ${pf === "Pass" ? "pass" : "fail"}`}>
      {pf || "—"}
    </span>
  );
}

export default function StudentLookup() {
  const navigate = useNavigate();

  const [students, setStudents]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState("");
  const [search, setSearch]         = useState("");
  const [riskFilter, setRiskFilter] = useState("All");
  const [branchFilter, setBranchFilter] = useState("All");
  const [pfFilter, setPfFilter]     = useState("All");
  const [sortKey, setSortKey]       = useState("name");
  const [sortDir, setSortDir]       = useState("asc");
  const [page, setPage]             = useState(1);
  const PER_PAGE = 20;

  useEffect(() => {
    const cached = getCached();
    if (cached) {
      setStudents(cached);
      setLoading(false);
      return;
    }

    async function load() {
      try {
        const res = await fetch(`${API_BASE}/students`);
        if (!res.ok) throw new Error("API error: " + res.status);
        const data = await res.json();
        const flat = (data.students || []).map(flattenStudent);

        setCached(flat);
        setStudents(flat);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const branches = useMemo(() => {
    const set = new Set(students.map(s => s.branch).filter(Boolean));
    return ["All", ...Array.from(set).sort()];
  }, [students]);

  const filtered = useMemo(() => {
    let list = students.filter(s => {
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        s.name?.toLowerCase().includes(q) ||
        s.roll_no?.toLowerCase().includes(q) ||
        s.branch?.toLowerCase().includes(q);
      const matchRisk   = riskFilter === "All" || s.dropout_risk === riskFilter;
      const matchBranch = branchFilter === "All" || s.branch === branchFilter;
      const matchPF     = pfFilter === "All" || s.pass_fail === pfFilter;
      return matchSearch && matchRisk && matchBranch && matchPF;
    });

    list = [...list].sort((a, b) => {
      let va = a[sortKey] ?? "";
      let vb = b[sortKey] ?? "";
      if (typeof va === "string") va = va.toLowerCase();
      if (typeof vb === "string") vb = vb.toLowerCase();
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return list;
  }, [students, search, riskFilter, branchFilter, pfFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const pageData   = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
    setPage(1);
  }

  function SortIcon({ col }) {
    if (sortKey !== col) return <span className="sort-icon neutral">⇅</span>;
    return <span className="sort-icon active">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  const highRisk  = students.filter(s => s.dropout_risk === "High").length;
  const medRisk   = students.filter(s => s.dropout_risk === "Medium").length;
  const lowRisk   = students.filter(s => s.dropout_risk === "Low").length;
  const failCount = students.filter(s => s.pass_fail === "Fail").length;

  if (loading) return (
    <div className="sl-loading">
      <div className="sl-spinner" />
      <p>Loading student records…</p>
    </div>
  );

  if (error) return (
    <div className="sl-error">
      <span className="sl-error-icon">⚠</span>
      <p>{error}</p>
      <p className="sl-error-hint">
        Make sure Flask is running (<code>python ml/app.py</code>) and a CSV has been
        uploaded from the admin Upload page.
      </p>
    </div>
  );

  return (
    <div className="sl-page">

      <div className="sl-header">
        <div>
          <h2>Student Lookup</h2>
          <p className="sl-sub">{students.length} students · {highRisk} high risk · {failCount} predicted fail</p>
        </div>
      </div>

      <div className="sl-summary">
        {[
          { label: "Total",       val: students.length, color: "#3d3d8f" },
          { label: "High Risk",   val: highRisk,        color: "#e74c3c" },
          { label: "Medium Risk", val: medRisk,         color: "#f39c12" },
          { label: "Low Risk",    val: lowRisk,         color: "#27ae60" },
          { label: "Pred. Fail",  val: failCount,       color: "#8e44ad" },
        ].map(({ label, val, color }) => (
          <div key={label} className="sl-stat" style={{ "--c": color }}>
            <span className="sl-stat-val">{val}</span>
            <span className="sl-stat-lbl">{label}</span>
          </div>
        ))}
      </div>

      <div className="sl-controls">
        <div className="sl-search-wrap">
          <svg className="sl-search-icon" viewBox="0 0 20 20" fill="none">
            <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.6"/>
            <path d="M13 13l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
          <input
            className="sl-search"
            placeholder="Search name or roll no…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
          {search && (
            <button className="sl-search-clear" onClick={() => { setSearch(""); setPage(1); }}>✕</button>
          )}
        </div>

        <div className="sl-filters">
          <select value={branchFilter} onChange={e => { setBranchFilter(e.target.value); setPage(1); }}>
            {branches.map(b => <option key={b}>{b}</option>)}
          </select>
          <select value={riskFilter} onChange={e => { setRiskFilter(e.target.value); setPage(1); }}>
            {["All","High","Medium","Low"].map(r => <option key={r}>{r}</option>)}
          </select>
          <select value={pfFilter} onChange={e => { setPfFilter(e.target.value); setPage(1); }}>
            {["All","Pass","Fail"].map(p => <option key={p}>{p}</option>)}
          </select>
        </div>

        <span className="sl-result-count">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="sl-table-wrap">
        <table className="sl-table">
          <thead>
            <tr>
              <th onClick={() => toggleSort("roll_no")}>Roll No <SortIcon col="roll_no" /></th>
              <th onClick={() => toggleSort("name")}>Name <SortIcon col="name" /></th>
              <th onClick={() => toggleSort("branch")}>Branch <SortIcon col="branch" /></th>
              <th onClick={() => toggleSort("year")}>Year <SortIcon col="year" /></th>
              <th onClick={() => toggleSort("cgpa")}>CGPA <SortIcon col="cgpa" /></th>
              <th onClick={() => toggleSort("overall_att")}>Att % <SortIcon col="overall_att" /></th>
              <th onClick={() => toggleSort("backlogs")}>Backlogs <SortIcon col="backlogs" /></th>
              <th onClick={() => toggleSort("dropout_risk")}>Dropout Risk <SortIcon col="dropout_risk" /></th>
              <th onClick={() => toggleSort("dropout_confidence")}>Confidence <SortIcon col="dropout_confidence" /></th>
              <th onClick={() => toggleSort("pass_fail")}>Pass / Fail <SortIcon col="pass_fail" /></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pageData.length === 0 ? (
              <tr>
                <td colSpan={11} className="sl-empty">
                  No students match your filters.
                  <button className="sl-clear-all" onClick={() => {
                    setSearch(""); setRiskFilter("All");
                    setBranchFilter("All"); setPfFilter("All");
                  }}>Clear filters</button>
                </td>
              </tr>
            ) : pageData.map((s, i) => (
              <tr
                key={s.roll_no || i}
                className="sl-row"
                onClick={() => navigate(`/students/${s.roll_no}`, { state: { student: s } })}
              >
                <td className="mono">{s.roll_no}</td>
                <td className="sl-name">{s.name}</td>
                <td><span className="sl-branch">{s.branch}</span></td>
                <td>Y{s.year}</td>
                <td className={parseFloat(s.cgpa) < 5 ? "sl-cgpa low" : "sl-cgpa"}>{s.cgpa}</td>
                <td className={parseFloat(s.overall_att) < 75 ? "sl-att low" : "sl-att"}>{s.overall_att}%</td>
                <td className={s.backlogs > 0 ? "sl-backlog-warn" : ""}>{s.backlogs}</td>
                <td>{riskPill(s.dropout_risk)}</td>
                <td>
                  <div className="sl-conf-bar">
                    <div>
                      <div className="sl-conf-fill" style={{
                        width: `${s.dropout_confidence || 0}%`,
                        background: RISK_COLOR[s.dropout_risk] || "#3d3d8f"
                      }} />
                    </div>
                    <span>{s.dropout_confidence || "—"}%</span>
                  </div>
                </td>
                <td>{pfPill(s.pass_fail)}</td>
                <td>
                  <button className="sl-view-btn" onClick={e => {
                    e.stopPropagation();
                    navigate(`/students/${s.roll_no}`, { state: { student: s } });
                  }}>
                    View →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="sl-pagination">
          <button disabled={page === 1} onClick={() => setPage(1)}>«</button>
          <button disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
            .reduce((acc, p, i, arr) => {
              if (i > 0 && p - arr[i - 1] > 1) acc.push("…");
              acc.push(p);
              return acc;
            }, [])
            .map((p, i) =>
              p === "…"
                ? <span key={`e-${i}`} className="sl-ellipsis">…</span>
                : <button key={p} className={page === p ? "active" : ""} onClick={() => setPage(p)}>{p}</button>
            )
          }
          <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>›</button>
          <button disabled={page === totalPages} onClick={() => setPage(totalPages)}>»</button>
          <span className="sl-page-info">
            {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, filtered.length)} of {filtered.length}
          </span>
        </div>
      )}

    </div>
  );
}