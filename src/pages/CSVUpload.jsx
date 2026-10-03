// src/pages/CSVUpload.jsx
// Admin CSV upload page.
//
// Posts the CSV straight to the Flask API (/api/upload), which parses it,
// runs both models + SHAP for the whole batch, generates recommendations,
// and upserts everything into MongoDB. AdminDashboard / StudentLookup /
// StudentProfile all read from that same DB afterward via /api/students,
// so this page is the single entry point for "what data is the app showing".

import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "../css/CSVUpload.css";

const API_BASE = "http://localhost:5000/api";

function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function CSVUpload() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [file, setFile]         = useState(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress]   = useState(0);
  const [result, setResult]       = useState(null);
  const [error, setError]         = useState("");
  const [history, setHistory]     = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  useEffect(() => {
    loadHistory();
  }, []);

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/uploads?limit=10`);
      const data = await res.json();
      setHistory(data.uploads || []);
    } catch {
      // Non-critical — the upload form still works without history.
    } finally {
      setHistoryLoading(false);
    }
  }

  function pickFile(f) {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) {
      setError("Please choose a .csv file.");
      return;
    }
    setError("");
    setResult(null);
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
    setError("");
    setResult(null);
    setProgress(15);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("uploaded_by", "admin");

      // fetch() has no native upload-progress event, so we fake a steady
      // climb while the request is in flight and snap to 100 on completion.
      const tick = setInterval(() => {
        setProgress(p => (p < 90 ? p + 7 : p));
      }, 300);

      const res = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        body: formData,
      });

      clearInterval(tick);
      setProgress(100);

      const data = await res.json();
      if (!res.ok && !data.status) {
        throw new Error(data.error || `Upload failed: ${res.status}`);
      }

      setResult(data);
      loadHistory();
    } catch (err) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function reset() {
    setFile(null);
    setResult(null);
    setError("");
    setProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="upload-page">
      <h2>Upload Student CSV</h2>
      <p className="subtitle">
        Upload a checkpoint CSV to run dropout &amp; pass/fail predictions with
        SHAP-based recommendations for every student, and refresh the dashboard.
      </p>

      {!result && (
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
              <button className="upload-file-remove" onClick={reset}>✕</button>
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

      {error && <p className="upload-error-msg">⚠ {error}</p>}

      {file && !result && (
        <div className="upload-actions">
          <button className="upload-btn" onClick={handleUpload} disabled={uploading}>
            {uploading ? "Processing…" : "Upload & Predict"}
          </button>
          {!uploading && (
            <button className="upload-secondary-btn" onClick={reset}>Cancel</button>
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

      {result && (
        <div className={`upload-result ${result.status}`}>
          <div className="upload-result-header">
            {result.status === "success" && <span>✅ Upload complete</span>}
            {result.status === "partial" && <span>⚠️ Upload completed with some errors</span>}
            {result.status === "failed"  && <span>❌ Upload failed</span>}
          </div>

          <div className="upload-result-stats">
            <div className="upload-stat">
              <div className="upload-stat-val">{result.row_count ?? 0}</div>
              <div className="upload-stat-lbl">Rows in CSV</div>
            </div>
            <div className="upload-stat">
              <div className="upload-stat-val" style={{ color: "#27ae60" }}>{result.success_count ?? 0}</div>
              <div className="upload-stat-lbl">Processed</div>
            </div>
            <div className="upload-stat">
              <div className="upload-stat-val" style={{ color: result.error_count ? "#e74c3c" : "#888" }}>
                {result.error_count ?? 0}
              </div>
              <div className="upload-stat-lbl">Errors</div>
            </div>
          </div>

          {result.errors?.length > 0 && (
            <div className="upload-errors">
              <h4>Row errors</h4>
              <div className="upload-error-list">
                {result.errors.map((e, i) => (
                  <div key={i} className="upload-error-row">
                    <span className="mono">Row {e.row ?? "?"} {e.roll_no ? `(${e.roll_no})` : ""}</span>
                    <span>{e.error}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="upload-result-actions">
            {result.success_count > 0 && (
              <button className="upload-btn" onClick={() => navigate("/admin/dashboard")}>
                View Dashboard →
              </button>
            )}
            <button className="upload-secondary-btn" onClick={reset}>Upload another file</button>
          </div>
        </div>
      )}

      <div className="upload-history">
        <h3>Recent Uploads</h3>
        {historyLoading ? (
          <p style={{ fontSize: "0.82rem", color: "#aaa" }}>Loading…</p>
        ) : history.length === 0 ? (
          <p style={{ fontSize: "0.82rem", color: "#aaa" }}>No uploads yet.</p>
        ) : (
          history.map(h => (
            <div key={h._id} className="upload-history-row">
              <div>
                <div className="upload-history-file">{h.filename}</div>
                <div className="upload-history-meta">
                  {formatDate(h.uploaded_at)} · {h.success_count}/{h.row_count} processed
                  {h.error_count > 0 && ` · ${h.error_count} errors`}
                </div>
              </div>
              <span className={`upload-status-badge ${h.status}`}>{h.status}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
