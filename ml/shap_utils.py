"""
shap_utils.py — SHAP explanation helpers for Learnalytix

Both models (RandomForest for dropout risk, GradientBoosting for pass/fail)
are tree-based, so shap.TreeExplainer is fast enough to run at upload time
for the whole batch (this is why we precompute + cache rather than compute
on-demand per request).

Fix log:
  - FEATURE_ACTIONS now maps Att S5%, Att S6%, Att S7% to recommendation
    text (dataset was regenerated so attendance covers S1-S7, matching
    SGPA) — previously these SHAP contributions had no mapped action and
    were silently dropped from recommendations for S6/S7 checkpoint students
"""

import numpy as np
import shap

# Features that aren't actionable advice targets — skip them when building
# recommendations even if they have a large SHAP contribution.
NON_ACTIONABLE = {"Branch_enc", "Year", "Current_Semester"}

FEATURE_ACTIONS = {
    "CGPA":            "Low CGPA is a major factor — recommend academic mentoring/tutoring.",
    "Overall Att%":    "Attendance is driving risk — recommend attendance counseling.",
    "Backlogs":        "Active backlogs are contributing to risk — recommend a backlog clearance plan.",
    "Internship_enc":  "No internship experience — recommend the internship guidance cell.",
    "Projects":        "Low project engagement — encourage joining a project team.",
    "Hackathons":      "Low hackathon participation — encourage extracurricular involvement.",
    "S1 SGPA":         "S1 performance is weak — flag for early-semester tutoring review.",
    "S2 SGPA":         "S2 performance is weak — flag for tutoring review.",
    "S3 SGPA":         "S3 performance is weak — flag for tutoring review.",
    "S4 SGPA":         "S4 performance is weak — flag for tutoring review.",
    "S5 SGPA":         "S5 performance is weak — flag for tutoring review.",
    "S6 SGPA":         "S6 performance is weak — flag for tutoring review.",
    "S7 SGPA":         "S7 performance is weak — flag for tutoring review.",
    "Att S1%":         "S1 attendance dropped — recommend early attendance counseling.",
    "Att S2%":         "S2 attendance dropped — recommend attendance counseling.",
    "Att S3%":         "S3 attendance dropped — recommend attendance counseling.",
    "Att S4%":         "S4 attendance dropped — recommend attendance counseling.",
    "Att S5%":         "S5 attendance dropped — recommend attendance counseling.",
    "Att S6%":         "S6 attendance dropped — recommend attendance counseling.",
    "Att S7%":         "S7 attendance dropped — recommend attendance counseling.",
}


def build_explainers(models: dict) -> dict:
    """Build TreeExplainers once at startup (or once per app process) and reuse them."""
    return {
        "dropout":  shap.TreeExplainer(models["dropout"]),
        "passfail": shap.TreeExplainer(models["passfail"]),
    }


def _predicted_class_shap_row(shap_output, pred_class_idx: int, row_idx: int = 0):
    """
    Normalize across shap versions/output shapes:
      - list of arrays (one per class): shap_output[class][row]
      - single 3D array (rows, features, classes): shap_output[row, :, class]
      - single 2D array (binary/regression style): shap_output[row]
    Returns a 1D array of per-feature contributions for the predicted class.
    """
    if isinstance(shap_output, list):
        return np.asarray(shap_output[pred_class_idx][row_idx])
    arr = np.asarray(shap_output)
    if arr.ndim == 3:
        return arr[row_idx, :, pred_class_idx]
    return arr[row_idx]


def compute_shap_for_row(
    explainers: dict,
    X_scaled_row: np.ndarray,
    features: list,
    dr_pred_class_idx: int,
    pf_pred_class_idx: int,
) -> dict:
    """
    X_scaled_row: shape (1, n_features) — same scaled input used for prediction.
    Returns {"dropout": {feature: value, ...}, "passfail": {feature: value, ...}}
    """
    dr_raw = explainers["dropout"].shap_values(X_scaled_row)
    pf_raw = explainers["passfail"].shap_values(X_scaled_row)

    dr_row = _predicted_class_shap_row(dr_raw, dr_pred_class_idx)
    pf_row = _predicted_class_shap_row(pf_raw, pf_pred_class_idx)

    return {
        "dropout":  {f: round(float(v), 4) for f, v in zip(features, dr_row)},
        "passfail": {f: round(float(v), 4) for f, v in zip(features, pf_row)},
    }


def compute_shap_batch(
    explainers: dict,
    X_scaled: np.ndarray,
    features: list,
    dr_pred_class_indices: list,
    pf_pred_class_indices: list,
) -> list:
    """
    Vectorized version for upload-time batch processing — calls shap_values
    ONCE on the whole matrix instead of once per row, which is what makes
    precomputing SHAP for 500 students at upload time fast enough to be
    practical (per-row TreeExplainer calls would be far slower in aggregate).

    Returns a list (len == X_scaled.shape[0]) of
    {"dropout": {...}, "passfail": {...}} dicts, one per row.
    """
    dr_raw = explainers["dropout"].shap_values(X_scaled)
    pf_raw = explainers["passfail"].shap_values(X_scaled)

    n_rows = X_scaled.shape[0]
    results = []
    for i in range(n_rows):
        dr_row = _predicted_class_shap_row(dr_raw, dr_pred_class_indices[i], row_idx=i)
        pf_row = _predicted_class_shap_row(pf_raw, pf_pred_class_indices[i], row_idx=i)
        results.append({
            "dropout":  {f: round(float(v), 4) for f, v in zip(features, dr_row)},
            "passfail": {f: round(float(v), 4) for f, v in zip(features, pf_row)},
        })
    return results


def generate_recommendations(shap_dropout: dict, shap_passfail: dict, top_n: int = 3) -> list:
    """
    Merge both SHAP dicts, keep only features that push *toward* risk/failure
    (positive contribution), drop non-actionable features, sort by magnitude,
    map the top N to human-readable actions. De-duplicates repeated actions.
    """
    combined = {}
    for f, v in shap_dropout.items():
        combined[f] = combined.get(f, 0) + max(v, 0)
    for f, v in shap_passfail.items():
        combined[f] = combined.get(f, 0) + max(v, 0)

    ranked = sorted(
        (item for item in combined.items() if item[0] not in NON_ACTIONABLE and item[1] > 0),
        key=lambda kv: kv[1],
        reverse=True,
    )

    recs = []
    for feature, _ in ranked:
        action = FEATURE_ACTIONS.get(feature)
        if action and action not in recs:
            recs.append(action)
        if len(recs) >= top_n:
            break
    return recs
