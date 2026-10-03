import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    confusion_matrix,
    classification_report
)
import joblib
import json
import os


# =============================================================================
# PATHS
# =============================================================================

DATA_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "data",
    "learnalytix_500_students_with_result.csv"
)

MODELS_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "models"
)

os.makedirs(MODELS_DIR, exist_ok=True)


# =============================================================================
# LOAD DATA
# =============================================================================

df = pd.read_csv(DATA_PATH)

print("=" * 70)
print("LEARNALYTIX - MACHINE LEARNING TRAINING")
print("=" * 70)

print(f"\nLoaded {len(df)} students")


# =============================================================================
# FEATURE ENGINEERING
# =============================================================================

# S1-S7 only because students have not completed S8
sgpa_cols = [f"S{i} SGPA" for i in range(1, 8)]
att_cols = [f"Att S{i}%" for i in range(1, 8)]

# Fill missing semester values
df[sgpa_cols] = df[sgpa_cols].fillna(0)
df[att_cols] = df[att_cols].fillna(0)

# Internship encoding
df["Internship_enc"] = (
    df["Internship"].astype(str).str.strip().str.lower() == "yes"
).astype(int)


# =============================================================================
# BRANCH ENCODING
# =============================================================================

KNOWN_BRANCHES = sorted(["AI", "CE", "CST", "DS", "ENC"])

branch_enc = LabelEncoder()
branch_enc.fit(KNOWN_BRANCHES)

df["Branch_enc"] = branch_enc.transform(df["Branch"])


# =============================================================================
# FEATURES
# =============================================================================

FEATURES = [
    "Current_Semester",
    "CGPA",
    "Overall Att%",
    "Backlogs",
    "Internship_enc",
    "Projects",
    "Hackathons",
    "Branch_enc",
    "Year",

    "S1 SGPA",
    "S2 SGPA",
    "S3 SGPA",
    "S4 SGPA",
    "S5 SGPA",
    "S6 SGPA",
    "S7 SGPA",

    "Att S1%",
    "Att S2%",
    "Att S3%",
    "Att S4%",
    "Att S5%",
    "Att S6%",
    "Att S7%",
]


X = df[FEATURES].copy()


# =============================================================================
# HELPER FUNCTION FOR MODEL EVALUATION
# =============================================================================

def evaluate_model(model, X_train, X_test, y_train, y_test, encoder, model_name):
    """
    Train model and calculate:
    Accuracy, Precision, Recall, F1-score and Confusion Matrix.
    """

    # Train
    model.fit(X_train, y_train)

    # Predictions
    y_pred = model.predict(X_test)

    # Metrics
    accuracy = accuracy_score(y_test, y_pred)

    precision = precision_score(
        y_test,
        y_pred,
        average="weighted",
        zero_division=0
    )

    recall = recall_score(
        y_test,
        y_pred,
        average="weighted",
        zero_division=0
    )

    f1 = f1_score(
        y_test,
        y_pred,
        average="weighted",
        zero_division=0
    )

    # Confusion matrix
    cm = confusion_matrix(
        y_test,
        y_pred
    )

    # Classification report
    report = classification_report(
        y_test,
        y_pred,
        target_names=encoder.classes_,
        zero_division=0
    )

    # Print results
    print("\n" + "=" * 70)
    print(model_name)
    print("=" * 70)

    print(f"Accuracy  : {accuracy:.4f} ({accuracy * 100:.2f}%)")
    print(f"Precision : {precision:.4f} ({precision * 100:.2f}%)")
    print(f"Recall    : {recall:.4f} ({recall * 100:.2f}%)")
    print(f"F1-Score  : {f1:.4f} ({f1 * 100:.2f}%)")

    print("\nConfusion Matrix:")
    print(cm)

    print("\nClassification Report:")
    print(report)

    return {
        "accuracy": round(float(accuracy), 4),
        "precision": round(float(precision), 4),
        "recall": round(float(recall), 4),
        "f1_score": round(float(f1), 4),
        "confusion_matrix": cm.tolist(),
        "classes": encoder.classes_.tolist(),
        "classification_report": classification_report(
            y_test,
            y_pred,
            target_names=encoder.classes_,
            output_dict=True,
            zero_division=0
        )
    }


# =============================================================================
# TARGET 1: DROPOUT RISK
# =============================================================================

print("\n" + "=" * 70)
print("TARGET 1: DROPOUT RISK")
print("=" * 70)

dr_enc = LabelEncoder()

y_dr = dr_enc.fit_transform(
    df["Dropout Risk"]
)


# 60% TRAIN / 40% TEST
X_tr, X_te, y_tr, y_te = train_test_split(
    X,
    y_dr,
    test_size=0.40,
    random_state=42,
    stratify=y_dr
)

print(f"\nTraining students : {len(X_tr)}")
print(f"Testing students  : {len(X_te)}")

print("\nDropout Risk classes:")
for i, class_name in enumerate(dr_enc.classes_):
    print(
        f"  {class_name}: "
        f"{np.sum(y_dr == i)} students"
    )


# Random Forest
dr_model = RandomForestClassifier(
    n_estimators=200,
    max_depth=10,
    random_state=42,
    class_weight="balanced"
)


dr_results = evaluate_model(
    dr_model,
    X_tr,
    X_te,
    y_tr,
    y_te,
    dr_enc,
    "RANDOM FOREST - DROPOUT RISK"
)


# 5-Fold Cross Validation
dr_cv_scores = cross_val_score(
    dr_model,
    X,
    y_dr,
    cv=5,
    scoring="accuracy"
)

dr_cv_mean = dr_cv_scores.mean()

print(
    f"\n5-Fold CV Accuracy: "
    f"{dr_cv_mean:.4f} ({dr_cv_mean * 100:.2f}%)"
)


# =============================================================================
# TARGET 2: PASS / FAIL
# =============================================================================

print("\n" + "=" * 70)
print("TARGET 2: PASS / FAIL")
print("=" * 70)

pf_enc = LabelEncoder()

y_pf = pf_enc.fit_transform(
    df["Pass/Fail"]
)


# 60% TRAIN / 40% TEST
X_tr2, X_te2, y_tr2, y_te2 = train_test_split(
    X,
    y_pf,
    test_size=0.40,
    random_state=42,
    stratify=y_pf
)

print(f"\nTraining students : {len(X_tr2)}")
print(f"Testing students  : {len(X_te2)}")

print("\nPass/Fail classes:")
for i, class_name in enumerate(pf_enc.classes_):
    print(
        f"  {class_name}: "
        f"{np.sum(y_pf == i)} students"
    )


# Gradient Boosting
pf_model = GradientBoostingClassifier(
    n_estimators=200,
    max_depth=5,
    random_state=42
)


pf_results = evaluate_model(
    pf_model,
    X_tr2,
    X_te2,
    y_tr2,
    y_te2,
    pf_enc,
    "GRADIENT BOOSTING - PASS / FAIL"
)


# 5-Fold Cross Validation
pf_cv_scores = cross_val_score(
    pf_model,
    X,
    y_pf,
    cv=5,
    scoring="accuracy"
)

pf_cv_mean = pf_cv_scores.mean()

print(
    f"\n5-Fold CV Accuracy: "
    f"{pf_cv_mean:.4f} ({pf_cv_mean * 100:.2f}%)"
)


# =============================================================================
# FEATURE IMPORTANCE
# =============================================================================

print("\n" + "=" * 70)
print("FEATURE IMPORTANCE")
print("=" * 70)

feature_importances = dict(
    zip(
        FEATURES,
        dr_model.feature_importances_.tolist()
    )
)

feature_importances = dict(
    sorted(
        feature_importances.items(),
        key=lambda x: x[1],
        reverse=True
    )
)

for feature, importance in feature_importances.items():
    print(
        f"{feature:<25} "
        f"{importance:.4f}"
    )


# =============================================================================
# SAVE MODELS
# =============================================================================

joblib.dump(
    dr_model,
    os.path.join(MODELS_DIR, "dropout_model.pkl")
)

joblib.dump(
    pf_model,
    os.path.join(MODELS_DIR, "passfail_model.pkl")
)

joblib.dump(
    branch_enc,
    os.path.join(MODELS_DIR, "branch_encoder.pkl")
)

joblib.dump(
    dr_enc,
    os.path.join(MODELS_DIR, "dropout_label_encoder.pkl")
)

joblib.dump(
    pf_enc,
    os.path.join(MODELS_DIR, "passfail_label_encoder.pkl")
)


# =============================================================================
# SAVE METADATA
# =============================================================================

meta = {
    "dataset": {
        "name": "learnalytix_500_students_with_result.csv",
        "total_students": int(len(df)),
        "training_students": int(len(X_tr)),
        "testing_students": int(len(X_te)),
        "train_test_split": "60:40",
        "random_state": 42
    },

    "features": FEATURES,

    "number_of_features": len(FEATURES),

    "known_branches": KNOWN_BRANCHES,

    "dropout": {
        "type": "RandomForest",
        "n_estimators": 200,
        "max_depth": 10,

        "accuracy": dr_results["accuracy"],
        "precision": dr_results["precision"],
        "recall": dr_results["recall"],
        "f1_score": dr_results["f1_score"],

        "confusion_matrix": dr_results["confusion_matrix"],

        "classes": dr_results["classes"],

        "classification_report":
            dr_results["classification_report"],

        "cross_validation": {
            "folds": 5,
            "scores": [
                round(float(x), 4)
                for x in dr_cv_scores
            ],
            "mean_accuracy":
                round(float(dr_cv_mean), 4)
        }
    },

    "passfail": {
        "type": "GradientBoosting",
        "n_estimators": 200,
        "max_depth": 5,

        "accuracy": pf_results["accuracy"],
        "precision": pf_results["precision"],
        "recall": pf_results["recall"],
        "f1_score": pf_results["f1_score"],

        "confusion_matrix": pf_results["confusion_matrix"],

        "classes": pf_results["classes"],

        "classification_report":
            pf_results["classification_report"],

        "cross_validation": {
            "folds": 5,
            "scores": [
                round(float(x), 4)
                for x in pf_cv_scores
            ],
            "mean_accuracy":
                round(float(pf_cv_mean), 4)
        }
    },

    "feature_importances": feature_importances
}


with open(
    os.path.join(MODELS_DIR, "model_meta.json"),
    "w"
) as f:
    json.dump(
        meta,
        f,
        indent=2
    )


# =============================================================================
# FINAL SUMMARY
# =============================================================================

print("\n" + "=" * 70)
print("FINAL MODEL SUMMARY")
print("=" * 70)

print("\nDataset:")
print(f"  Total students : {len(df)}")
print(f"  Training       : {len(X_tr)}")
print(f"  Testing        : {len(X_te)}")
print("  Split          : 60:40")

print("\nDropout Risk - Random Forest:")
print(f"  Accuracy  : {dr_results['accuracy'] * 100:.2f}%")
print(f"  Precision : {dr_results['precision'] * 100:.2f}%")
print(f"  Recall    : {dr_results['recall'] * 100:.2f}%")
print(f"  F1-Score  : {dr_results['f1_score'] * 100:.2f}%")
print(f"  CV Accuracy: {dr_cv_mean * 100:.2f}%")

print("\nPass/Fail - Gradient Boosting:")
print(f"  Accuracy  : {pf_results['accuracy'] * 100:.2f}%")
print(f"  Precision : {pf_results['precision'] * 100:.2f}%")
print(f"  Recall    : {pf_results['recall'] * 100:.2f}%")
print(f"  F1-Score  : {pf_results['f1_score'] * 100:.2f}%")
print(f"  CV Accuracy: {pf_cv_mean * 100:.2f}%")

print("\n" + "=" * 70)
print("Models and metadata saved successfully!")
print("=" * 70)

print(f"\nModels directory:")
print(MODELS_DIR)

print("\nSaved files:")
print("  - dropout_model.pkl")
print("  - passfail_model.pkl")
print("  - branch_encoder.pkl")
print("  - dropout_label_encoder.pkl")
print("  - passfail_label_encoder.pkl")
print("  - model_meta.json")