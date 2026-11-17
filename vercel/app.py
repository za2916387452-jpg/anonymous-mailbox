import csv
import hashlib
import hmac
import io
import os
import secrets
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import date, datetime, time as datetime_time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import psycopg
from flask import Flask, jsonify, make_response, request, send_from_directory
from psycopg.rows import dict_row
from werkzeug.exceptions import HTTPException


BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"
DATABASE_URL = os.environ.get("DATABASE_URL", "")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
PUBLIC_URL = os.environ.get("PUBLIC_URL", "").rstrip("/")
SESSION_TTL_SECONDS = 8 * 60 * 60
CATEGORIES = ["学习", "生活", "班级建议", "同学关系", "心理困扰", "其他"]
PUBLIC_FILES = {"admin.html", "styles.css", "app.js", "admin.js"}

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 150 * 1024

_schema_ready = False
_schema_lock = threading.Lock()


def ensure_schema(connection):
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if _schema_ready:
            return
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                category TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL,
                is_read BOOLEAN NOT NULL DEFAULT FALSE
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_messages_created_at "
            "ON messages (created_at DESC)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS admin_sessions (
                token_hash TEXT PRIMARY KEY,
                expires_at BIGINT NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at "
            "ON admin_sessions (expires_at)"
        )
        connection.commit()
        _schema_ready = True


@contextmanager
def connect_database():
    if not DATABASE_URL:
        raise RuntimeError("Missing DATABASE_URL environment variable")
    connection = psycopg.connect(
        DATABASE_URL,
        connect_timeout=10,
        row_factory=dict_row,
    )
    try:
        ensure_schema(connection)
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


@app.after_request
def add_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; "
        "form-action 'self'; style-src 'self'; script-src 'self'; "
        "img-src 'self' data:; connect-src 'self'"
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@app.errorhandler(Exception)
def handle_unexpected_error(error):
    if isinstance(error, HTTPException):
        return error
    app.logger.exception("Mailbox request failed")
    return jsonify(error="服务器暂时不可用，请稍后再试"), 500


@app.errorhandler(413)
def request_too_large(_error):
    return jsonify(error="请求内容过大"), 413


def error_response(status, message):
    return jsonify(error=message), status


def read_json_object():
    body = request.get_json(silent=True)
    return body if isinstance(body, dict) else None


def hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def is_admin_authenticated():
    token = request.cookies.get("admin_session", "")
    if not token:
        return False
    now = int(time.time())
    with connect_database() as connection:
        row = connection.execute(
            "SELECT token_hash FROM admin_sessions "
            "WHERE token_hash = %s AND expires_at > %s",
            (hash_token(token), now),
        ).fetchone()
        if row is None:
            return False
        connection.execute(
            "UPDATE admin_sessions SET expires_at = %s WHERE token_hash = %s",
            (now + SESSION_TTL_SECONDS, row["token_hash"]),
        )
    return True


def unauthorized_response():
    return error_response(401, "请先登录教师后台")


def format_timestamp(value):
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


@app.get("/")
def student_page():
    return send_from_directory(PUBLIC_DIR, "index.html")


@app.get("/admin")
@app.get("/admin/")
def teacher_page():
    return send_from_directory(PUBLIC_DIR, "admin.html")


@app.get("/<path:asset_path>")
def public_asset(asset_path):
    if asset_path not in PUBLIC_FILES:
        return error_response(404, "页面不存在")
    return send_from_directory(PUBLIC_DIR, asset_path)


@app.get("/api/health")
def health():
    with connect_database() as connection:
        connection.execute("SELECT 1").fetchone()
    return jsonify(ok=True)


@app.post("/api/messages")
def create_message():
    body = read_json_object()
    if body is None:
        return error_response(400, "请求格式不正确")
    content = str(body.get("content") or "").strip()
    category = body.get("category")
    if category not in CATEGORIES:
        category = "其他"
    if len(content) < 2:
        return error_response(400, "请至少填写两字内容")
    if len(content) > 2000:
        return error_response(400, "留言不能超过 2000 字")

    with connect_database() as connection:
        connection.execute(
            "INSERT INTO messages (id, category, content, created_at, is_read) "
            "VALUES (%s, %s, %s, %s, FALSE)",
            (str(uuid.uuid4()), category, content, datetime.now(timezone.utc)),
        )
    return jsonify(ok=True), 201


@app.post("/api/admin/login")
def admin_login():
    body = read_json_object()
    if body is None:
        return error_response(400, "请求格式不正确")
    if not ADMIN_PASSWORD:
        return error_response(500, "尚未设置后台密码 ADMIN_PASSWORD")
    provided_password = str(body.get("password") or "")
    if not hmac.compare_digest(provided_password, ADMIN_PASSWORD):
        return error_response(401, "密码不正确")

    now = int(time.time())
    token = secrets.token_urlsafe(32)
    token_digest = hash_token(token)
    with connect_database() as connection:
        connection.execute("DELETE FROM admin_sessions WHERE expires_at <= %s", (now,))
        connection.execute(
            "INSERT INTO admin_sessions (token_hash, expires_at) VALUES (%s, %s)",
            (token_digest, now + SESSION_TTL_SECONDS),
        )
    response = make_response(jsonify(ok=True))
    response.set_cookie(
        "admin_session",
        token,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        secure=True,
        samesite="Strict",
        path="/",
    )
    return response


@app.post("/api/admin/logout")
def admin_logout():
    token = request.cookies.get("admin_session", "")
    if token:
        with connect_database() as connection:
            connection.execute(
                "DELETE FROM admin_sessions WHERE token_hash = %s",
                (hash_token(token),),
            )
    response = make_response(jsonify(ok=True))
    response.delete_cookie(
        "admin_session", httponly=True, secure=True, samesite="Strict", path="/"
    )
    return response


@app.get("/api/admin/me")
def admin_me():
    if not is_admin_authenticated():
        return unauthorized_response()
    return jsonify(authenticated=True)


@app.get("/api/admin/config")
def admin_config():
    if not is_admin_authenticated():
        return unauthorized_response()
    return jsonify(publicUrl=PUBLIC_URL or request.url_root.rstrip("/"))


@app.get("/api/admin/messages")
def list_messages():
    if not is_admin_authenticated():
        return unauthorized_response()
    with connect_database() as connection:
        rows = connection.execute(
            "SELECT id, category, content, created_at, is_read "
            "FROM messages ORDER BY created_at DESC"
        ).fetchall()
    return jsonify(
        messages=[
            {
                "id": row["id"],
                "category": row["category"],
                "content": row["content"],
                "createdAt": format_timestamp(row["created_at"]),
                "read": row["is_read"],
            }
            for row in rows
        ]
    )


@app.get("/api/admin/export")
def export_messages():
    if not is_admin_authenticated():
        return unauthorized_response()

    start_text = request.args.get("start", "")
    end_text = request.args.get("end", "")
    try:
        start_date = date.fromisoformat(start_text)
        end_date = date.fromisoformat(end_text)
    except ValueError:
        return error_response(400, "请选择有效的开始和结束日期")
    if start_date.isoformat() != start_text or end_date.isoformat() != end_text:
        return error_response(400, "请选择有效的开始和结束日期")
    if start_date > end_date:
        return error_response(400, "开始日期不能晚于结束日期")

    china_timezone = ZoneInfo("Asia/Shanghai")
    start_at = datetime.combine(start_date, datetime_time.min, tzinfo=china_timezone)
    try:
        end_at = datetime.combine(
            end_date + timedelta(days=1), datetime_time.min, tzinfo=china_timezone
        )
    except OverflowError:
        return error_response(400, "结束日期超出可用范围")

    with connect_database() as connection:
        rows = connection.execute(
            "SELECT category, content, created_at, is_read FROM messages "
            "WHERE created_at >= %s AND created_at < %s ORDER BY created_at ASC",
            (start_at, end_at),
        ).fetchall()

    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["留言时间（北京时间）", "类型", "内容", "状态"])
    for row in rows:
        content = row["content"]
        if content.lstrip(" \t\r\n").startswith(("=", "+", "-", "@")):
            content = "'" + content
        writer.writerow(
            [
                row["created_at"].astimezone(china_timezone).strftime("%Y-%m-%d %H:%M:%S"),
                row["category"],
                content,
                "已读" if row["is_read"] else "未读",
            ]
        )

    response = make_response("\ufeff" + output.getvalue())
    response.headers["Content-Type"] = "text/csv; charset=utf-8"
    response.headers["Content-Disposition"] = (
        f'attachment; filename="anonymous-messages_{start_text}_{end_text}.csv"'
    )
    return response


@app.route("/api/admin/messages/<message_id>", methods=["PATCH", "DELETE"])
def update_or_delete_message(message_id):
    if not is_admin_authenticated():
        return unauthorized_response()

    with connect_database() as connection:
        existing = connection.execute(
            "SELECT id FROM messages WHERE id = %s", (message_id,)
        ).fetchone()
        if existing is None:
            return error_response(404, "留言不存在或已删除")

        if request.method == "DELETE":
            connection.execute("DELETE FROM messages WHERE id = %s", (message_id,))
            return jsonify(ok=True)

        body = read_json_object()
        if body is None or not isinstance(body.get("read"), bool):
            return error_response(400, "阅读状态无效")
        connection.execute(
            "UPDATE messages SET is_read = %s WHERE id = %s",
            (body["read"], message_id),
        )
    return jsonify(ok=True)
