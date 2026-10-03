"""
auth_routes.py — Real authentication for Learnalytix.

Plug into your existing Flask app:

    from db import get_db
    from auth_routes import auth_bp, init_auth

    init_auth(get_db())
    app.register_blueprint(auth_bp, url_prefix="/api")

Requires:  pip install pyjwt bcrypt flask-cors --break-system-packages
Env vars:
    JWT_SECRET        — required, secret used to sign tokens
    ADMIN_USERNAME     — the one fixed admin login (default: "admin")
    ADMIN_PASSWORD_HASH — a bcrypt hash of the admin password (see bottom
                          of this file for how to generate one). If unset,
                          falls back to a dev-only password "changeme" —
                          DO NOT ship that default to production.

Design notes:
------------------------------------------
- ADMIN is a single fixed account, not a database-backed collection —
  no admin registration, no admin_users lookup. Credentials are compared
  against ADMIN_USERNAME / ADMIN_PASSWORD_HASH env vars.

- STUDENTS have NO pre-existing login. `students` docs are seeded by admin
  CSV upload and only contain academic data (roll_no, name, branch,
  current_semester, predictions, shap, history). There is deliberately no
  separate "student_users" collection — a student can only self-register if
  their roll_no already exists in `students` (i.e. their admin already
  uploaded them). Registration ATTACHES login credentials (email, phone,
  password_hash) to that existing document rather than creating a new one.
  This also means a student can never register a roll number their college
  hasn't entered into the system, and doubles as an identity check: the
  branch + semester they submit must match what's already on file.

  If your admin CSV upload doesn't cover every student yet, some real
  students will get "roll number not found" until it does.

FIX (bytes-not-JSON-serializable crash):
------------------------------------------
bcrypt.hashpw() returns `bytes`. Storing that directly in Mongo means any
route that later reads the student doc and jsonify()'s it (e.g. GET
/api/students/<roll_no>) blows up with:

    TypeError: Object of type bytes is not JSON serializable

password_hash is now always stored as a plain `str` (decoded utf-8), and
re-encoded to bytes only at the point bcrypt.checkpw() needs it. Note:
app.py's serialize_student() should ALSO strip password_hash before
returning student docs to the client — this fix stops the crash, but the
hash still shouldn't be sent to the frontend at all.
"""

import os
import datetime
import bcrypt
import jwt
from flask import Blueprint, request, jsonify

auth_bp = Blueprint("auth", __name__)

JWT_SECRET = os.environ.get("JWT_SECRET", "CHANGE_ME_DEV_ONLY_SET_ENV_VAR")
JWT_ALGO = "HS256"
JWT_EXPIRY_HOURS = 12

VALID_BRANCHES = ["CST", "CE", "AI", "DS", "ENC"]

ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
# Dev-only fallback hash for password "changeme" — set ADMIN_PASSWORD_HASH
# in your real environment instead of relying on this.
# Kept as `str` (decoded) for the same reason student password_hash is a
# str now — consistency, and so nothing bytes-shaped is floating around
# that could accidentally end up in a jsonify() call later.
_DEV_FALLBACK_HASH = bcrypt.hashpw(b"changeme", bcrypt.gensalt()).decode("utf-8")
ADMIN_PASSWORD_HASH = os.environ.get("ADMIN_PASSWORD_HASH", "") or _DEV_FALLBACK_HASH

_db = None  # set by init_auth()


def init_auth(db):
    """Call once from your main app.py, passing your existing get_db() result."""
    global _db
    _db = db
    # Students register by attaching credentials to an existing doc, so email
    # needs to be unique but sparse (most rows won't have one until they do).
    _db.students.create_index("email", unique=True, sparse=True)


def _students():
    if _db is None:
        raise RuntimeError("init_auth(db) was never called — see auth_routes.py docstring.")
    return _db.students


def _make_token(role, identifier, name):
    payload = {
        "sub": identifier,          # "admin" for the admin, roll_no for students
        "role": role,
        "name": name,
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=JWT_EXPIRY_HOURS),
        "iat": datetime.datetime.utcnow(),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


# ── /api/register — students only, admin has no registration ──────────────
@auth_bp.route("/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}

    full_name   = (data.get("fullName") or "").strip()
    roll_no     = (data.get("rollNumber") or "").strip()
    email       = (data.get("email") or "").strip().lower()
    phone       = (data.get("phone") or "").strip()
    branch      = (data.get("branch") or "").strip().upper()
    semester    = data.get("semester")
    password    = data.get("password") or ""

    errors = {}
    if not full_name:
        errors["fullName"] = "Full name is required."
    if not roll_no:
        errors["rollNumber"] = "Roll number is required."
    if not email or "@" not in email:
        errors["email"] = "Enter a valid email."
    if branch not in VALID_BRANCHES:
        errors["branch"] = "Please select a valid branch."
    if not semester:
        errors["semester"] = "Please select your semester."
    if not password or len(password) < 6:
        errors["password"] = "Password must be at least 6 characters."

    if errors:
        return jsonify({"errors": errors}), 400

    student = _students().find_one({"roll_no": roll_no})
    if not student:
        return jsonify({
            "errors": {"rollNumber": "Roll number not found. Ask your admin to add you to the system first."}
        }), 404

    if student.get("password_hash"):
        return jsonify({"errors": {"rollNumber": "This roll number is already registered. Please sign in."}}), 409

    try:
        semester_int = int(semester)
    except (TypeError, ValueError):
        return jsonify({"errors": {"semester": "Invalid semester."}}), 400

    if student.get("branch") != branch or student.get("current_semester") != semester_int:
        return jsonify({
            "errors": {"branch": "Branch/semester don't match our records for this roll number."}
        }), 409

    if _students().find_one({"email": email}):
        return jsonify({"errors": {"email": "An account with this email already exists."}}), 409

    # FIX: decode to str before storing — bcrypt.hashpw returns bytes, and
    # bytes stored in Mongo will blow up jsonify() the next time this doc
    # is read back (e.g. GET /api/students/<roll_no>).
    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    _students().update_one(
        {"roll_no": roll_no},
        {"$set": {
            "email": email,
            "phone": phone,
            "password_hash": password_hash,
            "registered_at": datetime.datetime.utcnow(),
            **({"name": full_name} if not student.get("name") else {}),
        }},
    )

    display_name = student.get("name") or full_name
    token = _make_token("student", roll_no, display_name)
    return jsonify({
        "token": token,
        "user": {"name": display_name, "role": "student", "rollNumber": roll_no},
    }), 201


# ── /api/login ────────────────────────────────────────────────────────────
@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}

    identifier = (data.get("email") or "").strip()  # username (admin) or email/roll_no (student)
    password   = data.get("password") or ""
    role       = (data.get("role") or "").strip()

    if not identifier or not password:
        return jsonify({"error": "Please enter your credentials."}), 400

    if role == "admin":
        # FIX: ADMIN_PASSWORD_HASH is now a str, so encode it here for checkpw.
        if identifier != ADMIN_USERNAME or not bcrypt.checkpw(
            password.encode("utf-8"), ADMIN_PASSWORD_HASH.encode("utf-8")
        ):
            return jsonify({"error": "Invalid username or password."}), 401
        token = _make_token("admin", ADMIN_USERNAME, "Admin")
        return jsonify({"token": token, "user": {"name": "Admin", "role": "admin"}}), 200

    elif role == "student":
        email_lower = identifier.lower()
        student = _students().find_one({"email": email_lower})
        if not student:
            student = _students().find_one({"roll_no": identifier})

        # FIX: student["password_hash"] is now a str, so encode it here for checkpw.
        if not student or not student.get("password_hash") or not bcrypt.checkpw(
            password.encode("utf-8"), student["password_hash"].encode("utf-8")
        ):
            return jsonify({"error": "Invalid email/roll number or password."}), 401

        name = student.get("name") or student["roll_no"]
        token = _make_token("student", student["roll_no"], name)
        return jsonify({
            "token": token,
            "user": {"name": name, "role": "student", "rollNumber": student["roll_no"]},
        }), 200

    return jsonify({"error": "Invalid role."}), 400


# ── /api/me — verify a token / restore session on page refresh ────────────
@auth_bp.route("/me", methods=["GET"])
def me():
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return jsonify({"error": "Missing token."}), 401
    token = auth_header.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        return jsonify({"error": "Token expired."}), 401
    except jwt.InvalidTokenError:
        return jsonify({"error": "Invalid token."}), 401
    return jsonify({"user": {"name": payload["name"], "role": payload["role"]}}), 200


# ── How to generate ADMIN_PASSWORD_HASH ────────────────────────────────────
# Run this once locally, then set the printed value as the ADMIN_PASSWORD_HASH
# env var (do not commit it to source control):
#
#   python -c "import bcrypt; print(bcrypt.hashpw(b'Admin123', bcrypt.gensalt()).decode())"
# ── How to generate ADMIN_PASSWORD_HASH ────────────────────────────────────
# Run this once locally, then set the printed value as the ADMIN_PASSWORD_HASH
# env var (do not commit it to source control):
#
#   python -c "import bcrypt; print(bcrypt.hashpw(b'Admin123', bcrypt.gensalt()).decode())"
