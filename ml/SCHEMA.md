# Learnalytix MongoDB Schema

## `students` collection

One document per student. `roll_no` is the unique key (upserted on every
upload, so re-uploading a later checkpoint updates the same document and
appends to `history`).

```jsonc
{
  "_id": ObjectId,
  "roll_no": "ENG2024001",
  "name": "Arjun Mehta",
  "branch": "CE",
  "year": 3,
  "current_semester": 6,

  "cgpa": 5.8,
  "overall_att": 67,
  "backlogs": 2,
  "internship": false,
  "projects": 1,
  "hackathons": 0,

  "s1_sgpa": 6.1, "s2_sgpa": 6.4, "s3_sgpa": 5.9, "s4_sgpa": 5.3,
  "s5_sgpa": 4.8, "s6_sgpa": 4.2, "s7_sgpa": 0,
  "att_s1": 70, "att_s2": 68, "att_s3": 65, "att_s4": 62,

  // Most recent prediction — this is what list/filter/sort endpoints read
  "predictions": {
    "checkpoint": 6,                 // current_semester at time of prediction
    "dropout_risk": "High",
    "dropout_confidence": 82.3,
    "dropout_probabilities": {"High": 82.3, "Medium": 14.2, "Low": 3.5},
    "pass_fail": "Fail",
    "passfail_confidence": 74.1,
    "passfail_probabilities": {"Pass": 25.9, "Fail": 74.1},
    "computed_at": "2026-07-05T10:00:00Z"
  },

  // SHAP contribution values for the *current* prediction, one dict per model
  "shap": {
    "checkpoint": 6,
    "dropout": {"CGPA": -0.42, "Overall Att%": -0.31, "Backlogs": 0.18, "...": 0.0},
    "passfail": {"CGPA": -0.55, "S6 SGPA": -0.20, "...": 0.0}
  },

  // Human-readable actions derived from top SHAP contributors
  "recommendations": [
    "Low CGPA is a major factor — recommend academic mentoring/tutoring.",
    "Attendance is driving risk — recommend attendance counseling.",
    "Active backlogs are contributing to risk — recommend a backlog clearance plan."
  ],

  // One snapshot appended per upload — this is what powers trend indicators
  // on the At-Risk page ("worsening/improving vs last checkpoint")
  "history": [
    {
      "upload_id": "665f...",
      "uploaded_at": "2026-05-01T09:00:00Z",
      "checkpoint": 4,
      "dropout_risk": "Medium",
      "dropout_confidence": 58.0,
      "pass_fail": "Pass"
    },
    {
      "upload_id": "667a...",
      "uploaded_at": "2026-07-05T10:00:00Z",
      "checkpoint": 6,
      "dropout_risk": "High",
      "dropout_confidence": 82.3,
      "pass_fail": "Fail"
    }
  ],

  "created_at": "2026-01-10T00:00:00Z",
  "updated_at": "2026-07-05T10:00:00Z"
}
```

Indexes: `roll_no` (unique), `branch`, `current_semester`,
`predictions.dropout_risk`, `name`.

## `uploads` collection

```jsonc
{
  "_id": ObjectId,
  "filename": "learnalytix_500_students_with_result.csv",
  "uploaded_at": "2026-07-05T10:00:00Z",
  "uploaded_by": "priya.sharma",
  "row_count": 500,
  "success_count": 497,
  "error_count": 3,
  "status": "partial",           // success | partial | failed
  "errors": [
    {"row": 118, "roll_no": "ENG2024118", "error": "Unknown branch 'ME'"}
  ]
}
```

Index: `uploaded_at` (descending) for the history feed.

## `admin_users` collection

```jsonc
{
  "_id": ObjectId,
  "username": "priya.sharma",
  "password_hash": "...",        // werkzeug.security.generate_password_hash
  "role": "admin",                // admin | superadmin
  "created_at": "2026-01-01T00:00:00Z"
}
```

Index: `username` (unique). Passwords are never stored or returned in plain text.

## Why `predictions` is a single object, not one per checkpoint

The model takes `current_semester` as an input feature and produces one
prediction reflecting the student's state *at that checkpoint* (future
semester SGPA fields are just zero-filled). So a student only has one
"current" prediction at any time — the checkpoint history comes from
re-uploading the CSV as the student progresses (S2 → S4 → S6 → S7), which is
exactly what `history[]` captures. This matches how `train.py` /
`predict.py` already model the problem, so no retraining is needed.
