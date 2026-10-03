"""
create_admin.py — run this once to create your first admin account in
`admin_users` (username + password_hash + role), matching your db.py schema.

Usage:
    python create_admin.py
"""

import bcrypt
from db import get_db  # uses your existing MONGO_URI / MONGO_DB_NAME env vars

db = get_db()

username = input("Admin username: ").strip()
password = input("Admin password (min 6 chars): ").strip()
name = input("Display name (optional, press Enter to skip): ").strip()

if db.admin_users.find_one({"username": username}):
    print(f"A user with username '{username}' already exists.")
elif len(password) < 6:
    print("Password must be at least 6 characters.")
else:
    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt())
    doc = {"username": username, "password_hash": password_hash, "role": "admin"}
    if name:
        doc["name"] = name
    db.admin_users.insert_one(doc)
    print(f"Admin account created for '{username}'.")
