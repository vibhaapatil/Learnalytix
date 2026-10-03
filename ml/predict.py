"""
Learnalytix Prediction Helper

Fix log:
  - Branch validated against known list before encoding
  - Sample updated to include a year-3 student with S5/S6 data
"""

import joblib, json, numpy as np

MODELS_DIR = "ml/models"

KNOWN_BRANCHES = ["AI", "CE", "CST", "DS", "ENC"]

def load_models():
    return {
        "dropout":    joblib.load(f"{MODELS_DIR}/dropout_model.pkl"),
        "passfail":   joblib.load(f"{MODELS_DIR}/passfail_model.pkl"),
        "scaler":     joblib.load(f"{MODELS_DIR}/scaler.pkl"),
        "branch_enc": joblib.load(f"{MODELS_DIR}/branch_encoder.pkl"),
        "dr_enc":     joblib.load(f"{MODELS_DIR}/dropout_label_encoder.pkl"),
        "pf_enc":     joblib.load(f"{MODELS_DIR}/passfail_label_encoder.pkl"),
    }


def predict_student(student: dict, models: dict) -> dict:
    """
    Predict dropout risk and pass/fail for a single student.

    Required keys:
      cgpa, overall_att, backlogs, internship (bool), projects, hackathons,
      branch (str: AI | CE | CST | DS | ENC), year (1-4),
      current_semester (2 | 4 | 6 | 7),
      s1_sgpa .. s7_sgpa  (0 for semesters not yet completed),
      att_s1 .. att_s7    (0 for semesters not yet completed)

    Raises ValueError for unknown branch.
    """
    branch = student.get("branch", "CE").strip().upper()
    if branch not in KNOWN_BRANCHES:
        raise ValueError(
            f"Unknown branch '{branch}'. Valid: {', '.join(KNOWN_BRANCHES)}"
        )
    branch_code = models["branch_enc"].transform([branch])[0]

    # Feature order must match FEATURES in train.py exactly
    X = np.array([[
        student.get("current_semester", 4),
        student.get("cgpa", 0),
        student.get("overall_att", 0),
        student.get("backlogs", 0),
        int(bool(student.get("internship", False))),
        student.get("projects", 0),
        student.get("hackathons", 0),
        branch_code,
        student.get("year", 1),
        student.get("s1_sgpa", 0),
        student.get("s2_sgpa", 0),
        student.get("s3_sgpa", 0),
        student.get("s4_sgpa", 0),
        student.get("s5_sgpa", 0),
        student.get("s6_sgpa", 0),
        student.get("s7_sgpa", 0),
        student.get("att_s1", 0),
        student.get("att_s2", 0),
        student.get("att_s3", 0),
        student.get("att_s4", 0),
        student.get("att_s5", 0),
        student.get("att_s6", 0),
        student.get("att_s7", 0),
    ]])

    X_scaled = models["scaler"].transform(X)

    dr_pred  = models["dr_enc"].inverse_transform(models["dropout"].predict(X_scaled))[0]
    dr_proba = models["dropout"].predict_proba(X_scaled)[0]
    dr_conf  = round(float(dr_proba.max()) * 100, 1)

    pf_pred  = models["pf_enc"].inverse_transform(models["passfail"].predict(X_scaled))[0]
    pf_proba = models["passfail"].predict_proba(X_scaled)[0]
    pf_conf  = round(float(pf_proba.max()) * 100, 1)

    return {
        "dropout_risk":        dr_pred,
        "dropout_confidence":  dr_conf,
        "pass_fail":           pf_pred,
        "passfail_confidence": pf_conf,
    }


if __name__ == "__main__":
    models = load_models()

    # Example: year-3 student at S6 checkpoint
    sample = {
        "current_semester": 6,
        "cgpa": 5.8, "overall_att": 67, "backlogs": 2,
        "internship": False, "projects": 1, "hackathons": 0,
        "branch": "CE", "year": 3,
        "s1_sgpa": 6.1, "s2_sgpa": 6.4, "s3_sgpa": 5.9, "s4_sgpa": 5.3,
        "s5_sgpa": 4.8, "s6_sgpa": 4.2, "s7_sgpa": 0,
        "att_s1": 70, "att_s2": 68, "att_s3": 65, "att_s4": 62,
        "att_s5": 60, "att_s6": 58, "att_s7": 0,
    }
    result = predict_student(sample, models)
    print(json.dumps(result, indent=2))
