from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.utils import secure_filename
from werkzeug.security import check_password_hash, generate_password_hash
from bson import ObjectId
from datetime import datetime, timezone
from dotenv import load_dotenv
import joblib
import numpy as np
import pandas as pd
import json
import os
import math

load_dotenv()

from db import get_db
from auth_routes import auth_bp, init_auth

from db import students_col, uploads_col, admin_users_col, ensure_indexes
from shap_utils import build_explainers, compute_shap_batch, generate_recommendations

app = Flask(__name__)
CORS(app)

# ── Auth wiring goes here, now that `app` exists ──
init_auth(get_db())
app.register_blueprint(auth_bp, url_prefix="/api")

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")


def load_models():
    return {
        "dropout":    joblib.load(f"{MODELS_DIR}/dropout_model.pkl"),
        "passfail":   joblib.load(f"{MODELS_DIR}/passfail_model.pkl"),
        "scaler":     joblib.load(f"{MODELS_DIR}/scaler.pkl"),
        "branch_enc": joblib.load(f"{MODELS_DIR}/branch_encoder.pkl"),
        "dr_enc":     joblib.load(f"{MODELS_DIR}/dropout_label_encoder.pkl"),
        "pf_enc":     joblib.load(f"{MODELS_DIR}/passfail_label_encoder.pkl"),
    }

models = load_models()

with open(f"{MODELS_DIR}/model_meta.json") as f:
    meta = json.load(f)

FEATURES        = meta["features"]
KNOWN_BRANCHES  = meta.get("known_branches", ["AI", "CE", "CST", "DS", "ENC"])

# TreeExplainers are expensive to build (walk the whole forest/ensemble), so
# build them once at startup and reuse for every upload/predict call.
explainers = build_explainers(models)

try:
    ensure_indexes()
except Exception as e:
    print(f"Warning: could not connect to MongoDB / ensure indexes: {e}")

# ── Safe type converters ───────────────────────────────────────────────────────
def safe_float(val, default=0.0):
    try:
        v = float(val)
        return default if math.isnan(v) else v
    except Exception:
        return default

def safe_int(val, default=0):
    try:
        v = float(val)
        return default if math.isnan(v) else int(v)
    except Exception:
        return default

def safe_bool(val):
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.lower() in ("true", "yes", "1")
    return bool(val)

# ── CSV column mapping ─────────────────────────────────────────────────────────
# Accepts the raw export header (e.g. "Roll No", "S1 SGPA", "Att S1%") and maps
# it to the internal snake_case keys used everywhere else (build_feature_vector,
# predict.py, the students collection). Matching is case/whitespace-insensitive
# so minor header formatting differences don't break the upload.

def _find_col(lower_lookup: dict, *candidates):
    for c in candidates:
        if c in lower_lookup:
            return lower_lookup[c]
    return None

def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.rename(columns=lambda c: str(c).strip())
    lower_lookup = {c.lower(): c for c in df.columns}

    mapping = {
        "roll_no":          _find_col(lower_lookup, "roll no", "roll_no", "rollno"),
        "name":             _find_col(lower_lookup, "student name", "name"),
        "branch":           _find_col(lower_lookup, "branch"),
        "year":             _find_col(lower_lookup, "year"),
        "current_semester": _find_col(lower_lookup, "current_semester", "current semester"),
        "cgpa":             _find_col(lower_lookup, "cgpa"),
        "overall_att":      _find_col(lower_lookup, "overall att%", "overall_att"),
        "backlogs":         _find_col(lower_lookup, "backlogs"),
        "internship":       _find_col(lower_lookup, "internship"),
        "projects":         _find_col(lower_lookup, "projects"),
        "hackathons":       _find_col(lower_lookup, "hackathons"),
    }
    for i in range(1, 8):
        mapping[f"s{i}_sgpa"] = _find_col(lower_lookup, f"s{i} sgpa")
        mapping[f"att_s{i}"]  = _find_col(lower_lookup, f"att s{i}%")

    out = pd.DataFrame(index=df.index)
    for target, source in mapping.items():
        out[target] = df[source] if source else np.nan
    return out


def row_to_student_dict(row: pd.Series) -> dict:
    """Convert one normalized CSV row into the internal student dict shape
    (same field names used by build_feature_vector / predict.py / SCHEMA.md)."""
    d = {
        "roll_no":          str(row.get("roll_no", "") or "").strip(),
        "name":             str(row.get("name", "") or "").strip(),
        "branch":           str(row.get("branch", "CE") or "CE").strip().upper(),
        "year":             safe_int(row.get("year", 1), 1),
        "current_semester": safe_int(row.get("current_semester", 2), 2),
        "cgpa":             safe_float(row.get("cgpa", 0)),
        "overall_att":      safe_float(row.get("overall_att", 0)),
        "backlogs":         safe_int(row.get("backlogs", 0)),
        "internship":       safe_bool(row.get("internship", False)),
        "projects":         safe_int(row.get("projects", 0)),
        "hackathons":       safe_int(row.get("hackathons", 0)),
    }
    for i in range(1, 8):
        d[f"s{i}_sgpa"] = safe_float(row.get(f"s{i}_sgpa", 0))
        d[f"att_s{i}"]  = safe_float(row.get(f"att_s{i}", 0))
    return d


def serialize_student(doc: dict) -> dict:
    doc = dict(doc)
    doc["_id"] = str(doc["_id"])
    # FIX: registered students now have a password_hash field (set by
    # auth_routes.py). It must never be sent to the frontend, and if it's
    # ever stored as bytes (old data, or a future bug) it will crash
    # jsonify() with "Object of type bytes is not JSON serializable".
    # Stripping it unconditionally fixes both problems.
    doc.pop("password_hash", None)
    return doc


# ── Feature builder ────────────────────────────────────────────────────────────
def build_feature_vector(data: dict):
    """
    Returns (pd.DataFrame, error_string).
    error_string is None on success, a message string on failure.
    """
    branch = data.get("branch", "CE").strip().upper()
    if branch not in KNOWN_BRANCHES:
        return None, (
            f"Unknown branch '{branch}'. "
            f"Valid branches: {', '.join(KNOWN_BRANCHES)}"
        )
    branch_code = int(models["branch_enc"].transform([branch])[0])

    row = {
        "Current_Semester": safe_int(data.get("current_semester", 4)),
        "CGPA":             safe_float(data.get("cgpa", 0)),
        "Overall Att%":     safe_float(data.get("overall_att", 0)),
        "Backlogs":         safe_int(data.get("backlogs", 0)),
        "Internship_enc":   int(safe_bool(data.get("internship", False))),
        "Projects":         safe_int(data.get("projects", 0)),
        "Hackathons":       safe_int(data.get("hackathons", 0)),
        "Branch_enc":       branch_code,
        "Year":             safe_int(data.get("year", 1)),
        "S1 SGPA":          safe_float(data.get("s1_sgpa", 0)),
        "S2 SGPA":          safe_float(data.get("s2_sgpa", 0)),
        "S3 SGPA":          safe_float(data.get("s3_sgpa", 0)),
        "S4 SGPA":          safe_float(data.get("s4_sgpa", 0)),
        "S5 SGPA":          safe_float(data.get("s5_sgpa", 0)),
        "S6 SGPA":          safe_float(data.get("s6_sgpa", 0)),
        "S7 SGPA":          safe_float(data.get("s7_sgpa", 0)),
        "Att S1%":          safe_float(data.get("att_s1", 0)),
        "Att S2%":          safe_float(data.get("att_s2", 0)),
        "Att S3%":          safe_float(data.get("att_s3", 0)),
        "Att S4%":          safe_float(data.get("att_s4", 0)),
        "Att S5%":          safe_float(data.get("att_s5", 0)),
        "Att S6%":          safe_float(data.get("att_s6", 0)),
        "Att S7%":          safe_float(data.get("att_s7", 0)),
    }

    # Keep only features the model was trained on; pad any missing ones with 0
    row_filtered = {k: row.get(k, 0) for k in FEATURES}
    return pd.DataFrame([row_filtered], columns=FEATURES), None

# ── Routes ─────────────────────────────────────────────────────────────────────

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "known_branches": KNOWN_BRANCHES,
        "models": {
            "dropout_risk": meta["dropout"],
            "pass_fail":    meta["passfail"],
        },
    })


@app.route("/api/predict", methods=["POST"])
def predict():
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "No JSON body provided"}), 400

    X_df, err = build_feature_vector(data)
    if err:
        return jsonify({"error": err}), 400

    try:
        X_scaled = models["scaler"].transform(X_df)

        dr_pred    = models["dr_enc"].inverse_transform(models["dropout"].predict(X_scaled))[0]
        dr_proba   = models["dropout"].predict_proba(X_scaled)[0]
        dr_classes = models["dr_enc"].classes_.tolist()
        dr_proba_dict = {c: round(float(p) * 100, 1) for c, p in zip(dr_classes, dr_proba)}

        pf_pred    = models["pf_enc"].inverse_transform(models["passfail"].predict(X_scaled))[0]
        pf_proba   = models["passfail"].predict_proba(X_scaled)[0]
        pf_classes = models["pf_enc"].classes_.tolist()
        pf_proba_dict = {c: round(float(p) * 100, 1) for c, p in zip(pf_classes, pf_proba)}

        return jsonify({
            "dropout_risk":           dr_pred,
            "dropout_confidence":     round(float(dr_proba.max()) * 100, 1),
            "dropout_probabilities":  dr_proba_dict,
            "pass_fail":              pf_pred,
            "passfail_confidence":    round(float(pf_proba.max()) * 100, 1),
            "passfail_probabilities": pf_proba_dict,
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/predict/batch", methods=["POST"])
def predict_batch():
    data = request.get_json(force=True)
    students = data.get("students", [])
    if not students:
        return jsonify({"error": "No students provided"}), 400

    results = []
    for s in students:
        X_df, err = build_feature_vector(s)
        if err:
            results.append({"roll_no": s.get("roll_no", ""), "error": err})
            continue
        try:
            X_scaled = models["scaler"].transform(X_df)

            dr_pred = models["dr_enc"].inverse_transform(
                models["dropout"].predict(X_scaled)
            )[0]
            dr_conf = round(
                float(models["dropout"].predict_proba(X_scaled)[0].max()) * 100, 1
            )
            pf_pred = models["pf_enc"].inverse_transform(
                models["passfail"].predict(X_scaled)
            )[0]
            pf_conf = round(
                float(models["passfail"].predict_proba(X_scaled)[0].max()) * 100, 1
            )

            results.append({
                "roll_no":             s.get("roll_no", ""),
                "name":                s.get("name", ""),
                "current_semester":    s.get("current_semester", 4),
                "dropout_risk":        dr_pred,
                "dropout_confidence":  dr_conf,
                "pass_fail":           pf_pred,
                "passfail_confidence": pf_conf,
            })
        except Exception as e:
            results.append({"roll_no": s.get("roll_no", ""), "error": str(e)})

    return jsonify({"results": results, "total": len(results)})


@app.route("/api/model/info", methods=["GET"])
def model_info():
    return jsonify({
        "features":            FEATURES,
        "known_branches":      KNOWN_BRANCHES,
        "dropout_model":       meta["dropout"],
        "passfail_model":      meta["passfail"],
        "feature_importances": meta["feature_importances"],
    })


@app.route("/api/upload", methods=["POST"])
def upload_csv():
    """
    Accepts multipart/form-data with a 'file' field (the CSV). For every row:
    builds features, runs both models + SHAP, generates recommendations, and
    upserts into MongoDB (students collection), appending a history entry.
    Logs the whole batch to the uploads collection.
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided (expected form field 'file')"}), 400

    file = request.files["file"]
    if not file.filename or not file.filename.lower().endswith(".csv"):
        return jsonify({"error": "Only .csv files are supported"}), 400

    try:
        raw_df = pd.read_csv(file)
    except Exception as e:
        return jsonify({"error": f"Could not parse CSV: {e}"}), 400

    if raw_df.empty:
        return jsonify({"error": "CSV file has no rows"}), 400

    norm_df = normalize_columns(raw_df)
    if norm_df["roll_no"].isna().all():
        return jsonify({"error": "CSV is missing a 'Roll No' column"}), 400

    now = datetime.now(timezone.utc).isoformat()
    uploaded_by = request.form.get("uploaded_by", "admin")

    # Insert a placeholder log first so history entries can reference this upload_id
    upload_id = str(uploads_col().insert_one({
        "filename":      secure_filename(file.filename),
        "uploaded_at":   now,
        "uploaded_by":   uploaded_by,
        "row_count":     len(norm_df),
        "success_count": 0,
        "error_count":   0,
        "status":        "processing",
        "errors":        [],
    }).inserted_id)

    valid, errors = [], []
    for idx, row in norm_df.iterrows():
        s = row_to_student_dict(row)
        if not s["roll_no"]:
            errors.append({"row": int(idx) + 2, "roll_no": "", "error": "Missing Roll No"})
            continue
        X_df, err = build_feature_vector(s)
        if err:
            errors.append({"row": int(idx) + 2, "roll_no": s["roll_no"], "error": err})
            continue
        valid.append((s, X_df))

    if not valid:
        uploads_col().update_one({"_id": ObjectId(upload_id)}, {"$set": {
            "status": "failed", "error_count": len(errors), "errors": errors[:100],
        }})
        return jsonify({
            "upload_id": upload_id, "row_count": len(norm_df),
            "success_count": 0, "error_count": len(errors),
            "status": "failed", "errors": errors[:100],
        }), 400

    try:
        X_all    = pd.concat([x for _, x in valid], ignore_index=True)
        X_scaled = models["scaler"].transform(X_all)

        dr_preds_idx = models["dropout"].predict(X_scaled)
        dr_probas    = models["dropout"].predict_proba(X_scaled)
        pf_preds_idx = models["passfail"].predict(X_scaled)
        pf_probas    = models["passfail"].predict_proba(X_scaled)

        dr_classes = models["dr_enc"].classes_
        pf_classes = models["pf_enc"].classes_

        # One batched SHAP call for the whole upload — see shap_utils.py for why
        # this matters (per-row TreeExplainer calls would be far slower).
        shap_batch = compute_shap_batch(
            explainers, X_scaled, FEATURES, list(dr_preds_idx), list(pf_preds_idx)
        )

        for i, (s, _) in enumerate(valid):
            dr_pred = dr_classes[dr_preds_idx[i]]
            dr_conf = round(float(dr_probas[i].max()) * 100, 1)
            dr_proba_dict = {c: round(float(p) * 100, 1) for c, p in zip(dr_classes, dr_probas[i])}

            pf_pred = pf_classes[pf_preds_idx[i]]
            pf_conf = round(float(pf_probas[i].max()) * 100, 1)
            pf_proba_dict = {c: round(float(p) * 100, 1) for c, p in zip(pf_classes, pf_probas[i])}

            shap_row = shap_batch[i]
            recommendations = generate_recommendations(shap_row["dropout"], shap_row["passfail"])
            checkpoint = s["current_semester"]

            prediction_doc = {
                "checkpoint":             checkpoint,
                "dropout_risk":           dr_pred,
                "dropout_confidence":     dr_conf,
                "dropout_probabilities":  dr_proba_dict,
                "pass_fail":              pf_pred,
                "passfail_confidence":    pf_conf,
                "passfail_probabilities": pf_proba_dict,
                "computed_at":            now,
            }
            history_entry = {
                "upload_id":           upload_id,
                "uploaded_at":         now,
                "checkpoint":          checkpoint,
                "dropout_risk":        dr_pred,
                "dropout_confidence":  dr_conf,
                "pass_fail":           pf_pred,
            }

            students_col().update_one(
                {"roll_no": s["roll_no"]},
                {
                    "$set": {
                        **s,
                        "predictions":     prediction_doc,
                        "shap":            {"checkpoint": checkpoint, **shap_row},
                        "recommendations": recommendations,
                        "updated_at":      now,
                    },
                    "$setOnInsert": {"created_at": now},
                    "$push": {"history": history_entry},
                },
                upsert=True,
            )
    except Exception as e:
        uploads_col().update_one({"_id": ObjectId(upload_id)}, {"$set": {
            "status": "failed", "error_count": len(errors) + len(valid),
            "errors": (errors + [{"row": None, "roll_no": "", "error": str(e)}])[:100],
        }})
        return jsonify({"error": f"Prediction/SHAP pipeline failed: {e}"}), 500

    status = "success" if not errors else "partial"
    uploads_col().update_one({"_id": ObjectId(upload_id)}, {"$set": {
        "success_count": len(valid), "error_count": len(errors),
        "status": status, "errors": errors[:100],
    }})

    return jsonify({
        "upload_id":     upload_id,
        "row_count":     len(norm_df),
        "success_count": len(valid),
        "error_count":   len(errors),
        "status":        status,
        "errors":        errors[:100],
    })


@app.route("/api/students", methods=["GET"])
def list_students():
    """List students from the last CSV upload(s), with optional filters."""
    q = {}
    risk   = request.args.get("risk")
    branch = request.args.get("branch")
    pf     = request.args.get("pass_fail")
    search = request.args.get("search", "").strip()

    if risk and risk != "All":
        q["predictions.dropout_risk"] = risk
    if branch and branch != "All":
        q["branch"] = branch
    if pf and pf != "All":
        q["predictions.pass_fail"] = pf
    if search:
        q["$or"] = [
            {"name":    {"$regex": search, "$options": "i"}},
            {"roll_no": {"$regex": search, "$options": "i"}},
        ]

    try:
        docs = [serialize_student(d) for d in students_col().find(q)]
    except Exception as e:
        return jsonify({"error": f"Database error: {e}"}), 500

    return jsonify({"students": docs, "total": len(docs)})


@app.route("/api/students/<roll_no>", methods=["GET"])
def get_student(roll_no):
    """Full student doc, including predictions, shap contributions, and
    the recommendations generated at upload time — used by StudentProfile."""
    try:
        doc = students_col().find_one({"roll_no": roll_no})
    except Exception as e:
        return jsonify({"error": f"Database error: {e}"}), 500
    if not doc:
        return jsonify({"error": f"No student with roll number '{roll_no}'"}), 404
    return jsonify(serialize_student(doc))


@app.route("/api/uploads", methods=["GET"])
def list_uploads():
    """Recent upload history, most recent first — powers an upload log/status view."""
    limit = safe_int(request.args.get("limit", 20), 20)
    try:
        docs = list(uploads_col().find().sort("uploaded_at", -1).limit(limit))
    except Exception as e:
        return jsonify({"error": f"Database error: {e}"}), 500
    for d in docs:
        d["_id"] = str(d["_id"])
    return jsonify({"uploads": docs})


@app.route("/api/admin/change-password", methods=["POST"])
def change_password():
    """
    Change an admin's own password. Expects the currently-logged-in admin's
    username (however your auth/session layer stores it — see AdminManagement.jsx
    for the assumption it makes) plus current_password and new_password.
    Requires admin_users documents to have a werkzeug password_hash (see SCHEMA.md).

    NOTE: admin is now a single fixed account (ADMIN_USERNAME/ADMIN_PASSWORD_HASH
    in .env, see auth_routes.py) — there is no admin_users collection anymore.
    This route still queries admin_users_col() and will not work until it's
    updated to match. Left as-is here since it wasn't part of the auth fix;
    flag if you want this route rewritten too.
    """
    data = request.get_json(force=True) or {}
    username         = (data.get("username") or "").strip()
    current_password = data.get("current_password") or ""
    new_password     = data.get("new_password") or ""

    if not username or not current_password or not new_password:
        return jsonify({"error": "username, current_password and new_password are required"}), 400
    if len(new_password) < 8:
        return jsonify({"error": "New password must be at least 8 characters"}), 400

    try:
        user = admin_users_col().find_one({"username": username})
    except Exception as e:
        return jsonify({"error": f"Database error: {e}"}), 500

    if not user or not check_password_hash(user.get("password_hash", ""), current_password):
        return jsonify({"error": "Current password is incorrect"}), 401

    admin_users_col().update_one(
        {"username": username},
        {"$set": {"password_hash": generate_password_hash(new_password)}},
    )
    return jsonify({"success": True})


if __name__ == "__main__":
    print("Starting Learnalytix ML API on http://localhost:5000")
    print(f"Known branches: {KNOWN_BRANCHES}")
    print(f"Features ({len(FEATURES)}): {FEATURES}")
    app.run(debug=True, port=5000)