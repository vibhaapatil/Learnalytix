"""
db.py — MongoDB connection and index setup for Learnalytix

Collections:
  students      — one document per student, with a single `predictions` object
                  reflecting their most recent checkpoint, a `shap` object with
                  feature contributions for that prediction, and a `history[]`
                  array of past checkpoint snapshots (see SCHEMA.md)
  uploads       — audit log of every CSV upload
  admin_users   — admin accounts (username, password_hash, role)

Run `python db.py` once to (re)create indexes.
"""

import os
from pymongo import MongoClient, ASCENDING, DESCENDING

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017")
DB_NAME   = os.environ.get("MONGO_DB_NAME", "learnalytix")

_client = None


def get_client():
    global _client
    if _client is None:
        _client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    return _client


def get_db():
    return get_client()[DB_NAME]


def students_col():
    return get_db()["students"]


def uploads_col():
    return get_db()["uploads"]


def admin_users_col():
    return get_db()["admin_users"]


def ensure_indexes():
    """Call once at startup (or via `python db.py`) to create/verify indexes."""
    students = students_col()
    students.create_index([("roll_no", ASCENDING)], unique=True)
    students.create_index([("branch", ASCENDING)])
    students.create_index([("current_semester", ASCENDING)])
    students.create_index([("name", ASCENDING)])

    # These match the actual query patterns in app.py:
    #   list_students()   filters on predictions.dropout_risk / predictions.pass_fail
    #   at_risk_students() filters on predictions.dropout_risk, sorts by
    #                       predictions.dropout_confidence descending
    students.create_index([("predictions.dropout_risk", ASCENDING)])
    students.create_index([("predictions.pass_fail", ASCENDING)])
    students.create_index([
        ("predictions.dropout_risk", ASCENDING),
        ("predictions.dropout_confidence", DESCENDING),
    ])

    uploads = uploads_col()
    uploads.create_index([("uploaded_at", DESCENDING)])

    admins = admin_users_col()
    admins.create_index([("username", ASCENDING)], unique=True)

    print("Indexes ensured on:", get_db().name)


if __name__ == "__main__":
    ensure_indexes()