// src/pages/AdminDashboard.jsx
//
// Fix log:
//   - Table now shows Current Semester column so teachers see checkpoint context
//   - Checkpoint filter added (All / S2 / S4 / S6 / S7) alongside risk filter
//   - "Overall Att%" column header clarified to "Att % (S1–S7)" now that
//     attendance is tracked through S7 (previously stopped at S4)
//   - Stat cards include per-checkpoint breakdown
//   - current_semester passed through from batch results
//   - NEW: dashboard now reads from /api/students (MongoDB) instead of the
//     bundled students.json + live /api/predict/batch calls, so it always
//     reflects whichever CSV was last uploaded
//   - NEW: Recommendations column shows the top SHAP-derived recommendation
//     per student (full list is on the student's profile page)
//   - NEW: Branch filter dropdown alongside Risk/Checkpoint filters
//   - NEW: visual refresh — staggered entrance animations on stat cards,
//     animated bar/progress fills, hover lift on cards/rows, smoother
//     transitions throughout (see AdminDashboard.css)
//   - CHANGED: CSV upload no longer lives on a separate page/route — the
//     dropzone + upload logic is now inline on the dashboard itself, behind
//     a toggle. A successful upload re-fetches /api/students immediately so
//     the table/stats update without a page reload. No /admin/upload route
//     is needed anymore.

import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import "../css/AdminDashboard.css";
import "../css/CSVUpload.css";

const RISK_COLOR = { High: "#e74c3c", Medium: "#f39c12", Low: "#27ae60" };
const API_BASE = "http://localhost:5000/api";

// Flatten the nested Mongo doc shape ({ predictions: {...}, recommendations: [...] })
// into the flat fields the rest of this component (and StudentProfile) expects.
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

function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [results, setResults]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [riskFilter, setRiskFilter]   = useState("All");
  const [semFilter, setSemFilter]     = useState("All");
  const [branchFilter, setBranchFilter] = useState("All");
  const [search, setSearch]           = useState("");
  const [drAcc, setDrAcc]             = useState(null);
  const [pfAcc, setPfAcc]             = useState(null);

  // ── Inline upload state ──────────────────────────────────────────────
  const [showUpload, setShowUpload] = useState(false);
  const [file, setFile]             = useState(null);
  const [dragging, setDragging]     = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [progress, setProgress]     = useState(0);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadError, setUploadError]   = useState("");

  const fetchStudents = useCallback(async () => {
    setError("");
    try {
      try {
        const infoRes = await fetch(`${API_BASE}/model/info`);
        const info = await infoRes.json();
        setDrAcc((info.dropout_model?.accuracy * 100).toFixed(1));
        setPfAcc((info.passfail_model?.accuracy * 100).toFixed(1));
      } catch {}

      const res = await fetch(`${API_BASE}/students`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `API error: ${res.status}`);
      }
      const data = await res.json();
      setResults((data.students || []).map(flattenStudent));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStudents(); }, [fetchStudents]);

  // ── Upload handlers ──────────────────────────────────────────────────
  function pickFile(f) {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) {
      setUploadError("Please choose a .csv file.");
      return;
    }
    setUploadError("");
    setUploadResult(null);
    setFile(f);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    pickFile(e.dataTransfer.files?.[0]);
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setUploadError("");
    setUploadResult(null);
    setProgress(15);

    const tick = setInterval(() => {
      setProgress(p => (p < 90 ? p + 7 : p));
    }, 300);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("uploaded_by", "admin");

      const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: formData });
      clearInterval(tick);
      setProgress(100);

      const data = await res.json();
      if (!res.ok && !data.status) {
        throw new Error(data.error || `Upload failed: ${res.status}`);
      }

      setUploadResult(data);
      if (data.success_count > 0) {
        setLoading(true);
        await fetchStudents(); // refresh table/stats immediately
      }
    } catch (err) {
      clearInterval(tick);
      setUploadError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function resetUpload() {
    setFile(null);
    setUploadResult(null);
    setUploadError("");
    setProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const total     = results.length;
  const highRisk  = results.filter(r => r.dropout_risk === "High").length;
  const medRisk   = results.filter(r => r.dropout_risk === "Medium").length;
  const lowRisk   = results.filter(r => r.dropout_risk === "Low").length;
  const failCount = results.filter(r => r.pass_fail === "Fail").length;

  // Checkpoint breakdown for the summary row
  const bySem = [2, 4, 6, 7].map(s => ({
    sem: s,
    count: results.filter(r => r.current_semester === s).length,
    high:  results.filter(r => r.current_semester === s && r.dropout_risk === "High").length,
  }));

  // Distinct branches present in the current dataset, for the filter dropdown
  const branches = ["All", ...Array.from(new Set(results.map(r => r.branch).filter(Boolean))).sort()];

  const visible = results.filter(r => {
    const matchRisk   = riskFilter === "All" || r.dropout_risk === riskFilter;
    const matchSem    = semFilter  === "All" || String(r.current_semester) === semFilter;
    const matchBranch = branchFilter === "All" || r.branch === branchFilter;
    const matchSearch = r.name?.toLowerCase().includes(search.toLowerCase()) ||
                        r.roll_no?.toLowerCase().includes(search.toLowerCase());
    return matchRisk && matchSem && matchBranch && matchSearch;
  });

  if (loading && !error) return (
    <div className="dash-loading">⏳ Loading students…</div>
  );

  return (
    <div className="admin-dash">

      <div className="dash-header">
        <div>
          <h2>Admin Dashboard</h2>
          <p className="dash-sub">
            {error
              ? "Couldn't load students — see below"
              : total > 0
                ? `Predictions for all ${total} students from the last upload`
                : "No students yet — upload a CSV to get started"}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {drAcc && (
            <div className="model-badge">
              <span>Dropout model: <strong>{drAcc}%</strong> acc</span>
              <span>Pass/Fail model: <strong>{pfAcc}%</strong> acc</span>
            </div>
          )}
          <button
            onClick={() => setShowUpload(v => !v)}
            style={{
              background: showUpload ? "#fff" : "#3d3d8f",
              color: showUpload ? "#3d3d8f" : "#fff",
              border: "1px solid #3d3d8f",
              borderRadius: "8px", padding: "0.6rem 1.1rem", fontSize: "0.85rem",
              fontWeight: 600, cursor: "pointer",
            }}
          >
            {showUpload ? "✕ Close" : "⬆ Upload CSV"}
          </button>
        </div>
      </div>

      {error && (
        <div className="risk-chart" style={{ marginBottom: "1.25rem" }}>
          <p style={{ color: "#e74c3c", margin: "0 0 6px" }}>❌ Error: {error}</p>
          <p style={{ fontSize: "0.8rem", color: "#aaa" }}>
            Make sure Flask is running (<code>python ml/app.py</code>) and MongoDB is
            reachable — check the Flask console for the full traceback.
          </p>
          <button onClick={fetchStudents} className="upload-secondary-btn" style={{ marginTop: "8px" }}>
            Retry
          </button>
        </div>
      )}

      {/* ── Inline CSV upload panel ─────────────────────────────────── */}
      {(showUpload || (total === 0 && !error)) && (
        <div className="risk-chart" style={{ marginBottom: "1.5rem" }}>
          <h4>Upload Student CSV</h4>
          <p style={{ fontSize: "0.82rem", color: "#888", margin: "0 0 1rem" }}>
            Runs both models + SHAP for every row and refreshes this dashboard automatically.
          </p>

          {!uploadResult && (
            <div
              className={`upload-dropzone ${dragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => !file && fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={e => pickFile(e.target.files?.[0])}
              />
              {file ? (
                <div className="upload-file-chip" onClick={e => e.stopPropagation()}>
                  <span className="upload-file-icon">📄</span>
                  <div className="upload-file-meta">
                    <div className="upload-file-name">{file.name}</div>
                    <div className="upload-file-size">{formatBytes(file.size)}</div>
                  </div>
                  <button className="upload-file-remove" onClick={resetUpload}>✕</button>
                </div>
              ) : (
                <>
                  <div className="upload-icon">⬆️</div>
                  <p className="upload-drop-title">Drag & drop your CSV here</p>
                  <p className="upload-drop-sub">
                    or <span className="upload-browse-link">browse files</span> — expects the
                    standard Learnalytix export (Roll No, Branch, CGPA, S1–S7 SGPA, Att S1–S7%, …)
                  </p>
                </>
              )}
            </div>
          )}

          {uploadError && <p className="upload-error-msg">⚠ {uploadError}</p>}

          {file && !uploadResult && (
            <div className="upload-actions">
              <button className="upload-btn" onClick={handleUpload} disabled={uploading}>
                {uploading ? "Processing…" : "Upload & Predict"}
              </button>
              {!uploading && (
                <button className="upload-secondary-btn" onClick={resetUpload}>Cancel</button>
              )}
            </div>
          )}

          {uploading && (
            <div style={{ marginTop: "1rem" }}>
              <div className="upload-progress-row">
                <span>Running predictions + SHAP for {file?.name}…</span>
                <span>{progress}%</span>
              </div>
              <div className="upload-progress-track">
                <div className="upload-progress-fill" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {uploadResult && (
            <div className={`upload-result ${uploadResult.status}`}>
              <div className="upload-result-header">
                {uploadResult.status === "success" && <span>✅ Upload complete</span>}
                {uploadResult.status === "partial" && <span>⚠️ Upload completed with some errors</span>}
                {uploadResult.status === "failed"  && <span>❌ Upload failed</span>}
              </div>

              <div className="upload-result-stats">
                <div className="upload-stat">
                  <div className="upload-stat-val">{uploadResult.row_count ?? 0}</div>
                  <div className="upload-stat-lbl">Rows in CSV</div>
                </div>
                <div className="upload-stat">
                  <div className="upload-stat-val" style={{ color: "#27ae60" }}>{uploadResult.success_count ?? 0}</div>
                  <div className="upload-stat-lbl">Processed</div>
                </div>
                <div className="upload-stat">
                  <div className="upload-stat-val" style={{ color: uploadResult.error_count ? "#e74c3c" : "#888" }}>
                    {uploadResult.error_count ?? 0}
                  </div>
                  <div className="upload-stat-lbl">Errors</div>
                </div>
              </div>

              {uploadResult.errors?.length > 0 && (
                <div className="upload-errors">
                  <h4>Row errors</h4>
                  <div className="upload-error-list">
                    {uploadResult.errors.map((e, i) => (
                      <div key={i} className="upload-error-row">
                        <span className="mono">Row {e.row ?? "?"} {e.roll_no ? `(${e.roll_no})` : ""}</span>
                        <span>{e.error}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="upload-result-actions">
                <button className="upload-secondary-btn" onClick={resetUpload}>Upload another file</button>
                {uploadResult.success_count > 0 && (
                  <button className="upload-secondary-btn" onClick={() => setShowUpload(false)}>
                    Done — view table below
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stat Cards */}
      <div className="stat-cards">
        <StatCard label="Total Students"  value={total}     color="#3d3d8f" delay={0} />
        <StatCard label="High Risk"       value={highRisk}  color="#e74c3c" delay={1} />
        <StatCard label="Medium Risk"     value={medRisk}   color="#f39c12" delay={2} />
        <StatCard label="Low Risk"        value={lowRisk}   color="#27ae60" delay={3} />
        <StatCard label="Predicted Fail"  value={failCount} color="#8e44ad" delay={4} />
      </div>

      {/* Per-checkpoint summary */}
      {total > 0 && (
        <div className="risk-chart" style={{ marginBottom: "1rem" }}>
          <h4>High-Risk Count by Checkpoint</h4>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "8px" }}>
            {bySem.map(({ sem, count, high }) => (
              <div key={sem} style={{
                background: "#f8f8fc", borderRadius: "8px", padding: "10px 16px",
                borderLeft: "3px solid #e74c3c", minWidth: "110px"
              }}>
                <div style={{ fontWeight: 600, color: "#3d3d8f" }}>S{sem} checkpoint</div>
                <div style={{ fontSize: "0.8rem", color: "#888" }}>{count} students</div>
                <div style={{ color: "#e74c3c", fontWeight: 600 }}>{high} high risk</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bar chart */}
      {total > 0 && (
        <div className="risk-chart">
          <h4>Dropout Risk Distribution</h4>
          <div className="bars">
            {[["High", highRisk, "#e74c3c"], ["Medium", medRisk, "#f39c12"], ["Low", lowRisk, "#27ae60"]].map(([lbl, val, col]) => (
              <div key={lbl} className="bar-group">
                <div className="bar-outer">
                  <div className="bar-inner" style={{ height: `${total > 0 ? (val / total) * 100 : 0}%`, background: col }} />
                </div>
                <span className="bar-label">{lbl}</span>
                <span className="bar-num">{val}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      {total > 0 && (
        <div className="table-section">
          <div className="table-controls">
            <input
              className="search-box"
              placeholder="Search by name or roll no…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div className="filter-tabs">
              <span style={{ fontSize: "0.8rem", color: "#888", alignSelf: "center" }}>Risk:</span>
              {["All","High","Medium","Low"].map(f => (
                <button key={f} className={`filter-tab ${riskFilter === f ? "active" : ""}`}
                  onClick={() => setRiskFilter(f)}>
                  {f}
                </button>
              ))}
            </div>
            <div className="filter-tabs">
              <span style={{ fontSize: "0.8rem", color: "#888", alignSelf: "center" }}>Checkpoint:</span>
              {["All","2","4","6","7"].map(f => (
                <button key={f} className={`filter-tab ${semFilter === f ? "active" : ""}`}
                  onClick={() => setSemFilter(f)}>
                  {f === "All" ? "All" : `S${f}`}
                </button>
              ))}
            </div>
            <div className="filter-tabs">
              <span style={{ fontSize: "0.8rem", color: "#888", alignSelf: "center" }}>Branch:</span>
              <select
                className="branch-select"
                value={branchFilter}
                onChange={e => setBranchFilter(e.target.value)}
              >
                {branches.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Roll No</th>
                  <th>Name</th>
                  <th>Branch</th>
                  <th>Checkpoint</th>
                  <th>CGPA</th>
                  <th>Att % (S1–S7)</th>
                  <th>Backlogs</th>
                  <th>Dropout Risk</th>
                  <th>Confidence</th>
                  <th>Pass / Fail</th>
                  <th>Top Recommendation</th>
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, 100).map((s, i) => (
                  <tr
                    key={i}
                    className="dash-row"
                    onClick={() => navigate(`/students/${s.roll_no}`, { state: { student: s } })}
                    style={{ cursor: "pointer", animationDelay: `${Math.min(i, 20) * 0.02}s` }}
                  >
                    <td className="mono">{s.roll_no}</td>
                    <td>{s.name}</td>
                    <td>{s.branch}</td>
                    <td>
                      <span style={{ fontSize: "0.8rem", color: "#555" }}>
                        S{s.current_semester} · Y{s.year}
                      </span>
                    </td>
                    <td>{s.cgpa}</td>
                    <td>{s.overall_att}%</td>
                    <td>{s.backlogs}</td>
                    <td>
                      <span className="risk-pill" style={{
                        background: (RISK_COLOR[s.dropout_risk] || "#888") + "22",
                        color: RISK_COLOR[s.dropout_risk] || "#888"
                      }}>
                        {s.dropout_risk || "—"}
                      </span>
                    </td>
                    <td>{s.dropout_confidence}%</td>
                    <td>
                      <span className={`pf-pill ${s.pass_fail === "Pass" ? "pass" : "fail"}`}>
                        {s.pass_fail || "—"}
                      </span>
                    </td>
                    <td style={{ maxWidth: "220px", fontSize: "0.78rem", color: "#666" }}>
                      {s.recommendations?.[0] || "—"}
                      {s.recommendations?.length > 1 && (
                        <span style={{ color: "#aaa" }}> (+{s.recommendations.length - 1} more)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visible.length === 0 && <p className="no-data">No students match the filter.</p>}
            {visible.length > 100 && (
              <p className="more-note">Showing 100 of {visible.length} results.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color, delay = 0 }) {
  return (
    <div
      className="stat-card"
      style={{ borderTop: `3px solid ${color}`, animationDelay: `${delay * 0.07}s` }}
    >
      <p className="stat-value" style={{ color }}>{value}</p>
      <p className="stat-label">{label}</p>
    </div>
  );
}
