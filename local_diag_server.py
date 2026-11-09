#!/usr/bin/env python3
"""
local_diag_server.py
====================
A lightweight local Flask proxy for the VetInstant diagnostic API.

Usage
-----
    python local_diag_server.py                     # proxy to EC2 + cache
    python local_diag_server.py --port 8765         # custom port
    python local_diag_server.py --offline           # cache-only, never hit EC2
    python local_diag_server.py --ec2 http://...    # override EC2 base URL

What it does
------------
* Serves GET /api/diag/events      → paginated diagnostic events for a device/day
* Serves GET /api/diag/events/days → list of UTC days that have stored events
* Serves POST /api/diag/flush      → queues ESP to upload (proxied or no-op)
* Adds CORS headers so the dashboard on file:// or http://localhost can call it
* Caches every successful EC2 response under ./diag_cache/<DEVICE>/<UTC_DATE>.ndjson
* When EC2 is unreachable, filters the cache and returns paginated results

Dashboard config
----------------
Change new_dashboard/config.api.js (or use config.api.local.js):
    window.API_CONFIG = { baseUrl: "http://localhost:8765", ... };
"""

from __future__ import annotations

import sys
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import argparse
import base64
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Try to import Flask — give a clear message if missing
# ---------------------------------------------------------------------------
try:
    from flask import Flask, Response, jsonify, request, send_file
except ImportError:
    print(
        "\n[ERROR] Flask is not installed.\n"
        "  Install it with:  pip install flask requests\n"
    )
    sys.exit(1)

try:
    import requests as _requests
except ImportError:
    print(
        "\n[ERROR] requests is not installed.\n"
        "  Install it with:  pip install flask requests\n"
    )
    sys.exit(1)

# ---------------------------------------------------------------------------
# Configuration defaults (overridable via CLI)
# ---------------------------------------------------------------------------
DEFAULT_PORT = 8765
DEFAULT_EC2_BASE = "http://43.205.129.56:8000"
CACHE_DIR = Path(__file__).parent / "diag_cache"
CACHE_DIR.mkdir(exist_ok=True, parents=True)

IST = timezone(timedelta(hours=5, minutes=30))

# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path="")
_ec2_base: str = DEFAULT_EC2_BASE
_offline: bool = False


@app.route("/")
def index() -> Any:
    return app.send_static_file("index.html")



# ---------------------------------------------------------------------------
# CORS helper — allow the GitHub Pages origin and localhost
# ---------------------------------------------------------------------------
CORS_ORIGINS = {
    "http://localhost",
    "http://localhost:8765",
    "http://127.0.0.1",
    "null",  # file:// origin
}


def _cors(resp: Response) -> Response:
    origin = request.headers.get("Origin", "null")
    allow = origin if origin in CORS_ORIGINS or origin.startswith("http://localhost") else "null"
    resp.headers["Access-Control-Allow-Origin"] = allow
    resp.headers["Access-Control-Allow-Credentials"] = "true"
    resp.headers["Access-Control-Allow-Headers"] = (
        "Content-Type, X-Device-Id, X-Session-Token, ngrok-skip-browser-warning"
    )
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return resp


@app.after_request
def after(resp: Response) -> Response:
    return _cors(resp)


@app.route("/api/diag/<path:sub>", methods=["OPTIONS"])
def diag_options(sub: str) -> Response:
    return _cors(Response(status=204))


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------

def _cache_path(device_id: str, utc_date: str) -> Path:
    safe_dev = device_id.upper().replace("/", "_").replace("\\", "_")
    safe_date = utc_date.replace("-", "")
    return CACHE_DIR / safe_dev / f"{safe_date}.ndjson"


def _append_to_cache(device_id: str, utc_date: str, events: list[dict]) -> None:
    """Append new events to the local NDJSON cache (deduplicated by sk/server_received_at)."""
    path = _cache_path(device_id, utc_date)
    path.parent.mkdir(exist_ok=True, parents=True)

    # Load existing event keys
    existing_keys: set[str] = set()
    existing_lines: list[str] = []
    if path.exists():
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                    key = _event_key(ev)
                    existing_keys.add(key)
                    existing_lines.append(line)
                except json.JSONDecodeError:
                    pass

    # Append only new events
    new_lines: list[str] = []
    for ev in events:
        key = _event_key(ev)
        if key not in existing_keys:
            existing_keys.add(key)
            new_lines.append(json.dumps(ev, separators=(",", ":")))

    if new_lines:
        with path.open("a", encoding="utf-8") as f:
            for line in new_lines:
                f.write(line + "\n")
        print(f"[cache] +{len(new_lines)} events → {path}")


def _event_key(ev: dict) -> str:
    return "|".join([
        str(ev.get("server_received_at", "")),
        str(ev.get("sk", "")),
        str(ev.get("code", "")),
        str(ev.get("event_time_s", "")),
        str(ev.get("bucket_id", "")),
        str(ev.get("session_hex", "")),
        str(ev.get("sequence_hex", "")),
    ])


def _load_from_cache(
    device_id: str,
    utc_date: str,
    from_iso: str | None = None,
    to_iso: str | None = None,
    limit: int = 2000,
    newest_first: bool = True,
) -> dict:
    """Return a paginated slice of the local cache matching the time window."""
    path = _cache_path(device_id, utc_date)
    if not path.exists():
        return {"device_id": device_id, "day": utc_date, "count": 0, "events": []}

    all_events: list[dict] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue

            # Time window filter
            srv_raw = str(ev.get("server_received_at", "")).strip()
            if srv_raw:
                try:
                    srv_ms = _parse_iso_ms(srv_raw)
                    if from_iso:
                        from_ms = _parse_iso_ms(from_iso)
                        if srv_ms < from_ms:
                            continue
                    if to_iso:
                        to_ms = _parse_iso_ms(to_iso)
                        if srv_ms > to_ms:
                            continue
                except (ValueError, TypeError):
                    pass

            all_events.append(ev)

    # Sort
    def sort_key(ev: dict):
        ts = ev.get("event_time_s") or 0
        srv = ev.get("server_received_at") or ""
        return (ts, srv)

    all_events.sort(key=sort_key, reverse=newest_first)

    # Paginate
    page = all_events[:limit]
    return {
        "device_id": device_id,
        "day": utc_date,
        "count": len(page),
        "total_cached": len(all_events),
        "from_cache": True,
        "events": page,
    }


def _parse_iso_ms(iso: str) -> float:
    """Parse ISO 8601 string to milliseconds (float). Handles fractional seconds."""
    # Strip trailing Z, replace with +00:00 for fromisoformat
    s = iso.rstrip("Z").rstrip("z")
    if "." in s:
        base, frac = s.split(".", 1)
        # Normalize fractional seconds to 6 digits
        frac = (frac + "000000")[:6]
        s = f"{base}.{frac}"
    try:
        dt = datetime.fromisoformat(s).replace(tzinfo=timezone.utc)
        return dt.timestamp() * 1000
    except ValueError:
        # Fallback: try parsing with dateutil
        import email.utils
        try:
            return time.mktime(email.utils.parsedate(iso)) * 1000  # type: ignore[arg-type]
        except Exception:
            return 0.0


def _cached_days(device_id: str) -> list[str]:
    """Return list of UTC date strings we have cached for this device."""
    device_dir = CACHE_DIR / device_id.upper()
    if not device_dir.exists():
        return []
    days: list[str] = []
    for ndjson in sorted(device_dir.glob("*.ndjson")):
        name = ndjson.stem  # e.g. "20261005"
        if len(name) == 8 and name.isdigit():
            days.append(f"{name[:4]}-{name[4:6]}-{name[6:8]}")
    return days


# ---------------------------------------------------------------------------
# EC2 proxy helper
# ---------------------------------------------------------------------------

def _proxy_get(path: str, params: dict | None = None, headers: dict | None = None) -> tuple[Any, int]:
    """Forward a GET to EC2 and return (parsed_json_or_None, status_code)."""
    url = f"{_ec2_base}/{path.lstrip('/')}"
    h = {"X-Device-Id": params.get("device_id", "") if params else ""}
    if headers:
        h.update(headers)
    try:
        resp = _requests.get(url, params=params, headers=h, timeout=15)
        if resp.ok:
            return resp.json(), 200
        print(f"[ec2] GET {url} -> HTTP {resp.status_code}")
        return None, resp.status_code
    except Exception as exc:
        print(f"[ec2] GET {url} -> {exc}")
        return None, 0


def _proxy_post(path: str, body: dict | None = None, headers: dict | None = None) -> tuple[Any, int]:
    url = f"{_ec2_base}/{path.lstrip('/')}"
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    try:
        resp = _requests.post(url, json=body, headers=h, timeout=15)
        if resp.ok:
            try:
                return resp.json(), 200
            except Exception:
                return {"ok": True}, 200
        print(f"[ec2] POST {url} -> HTTP {resp.status_code}")
        return None, resp.status_code
    except Exception as exc:
        print(f"[ec2] POST {url} -> {exc}")
        return None, 0


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/api/diag/events/days", methods=["GET"])
def diag_event_days() -> Response:
    """GET /api/diag/events/days?device_id=X&limit=60"""
    device_id = (request.args.get("device_id") or "").strip().upper()
    limit = int(request.args.get("limit") or 60)

    if not _offline:
        params: dict = {"device_id": device_id, "limit": limit}
        data, status = _proxy_get("/api/diag/events/days", params=params)
        if data is not None:
            # Cache all days returned so we know what we have
            days_list = data.get("days") or []
            for day_str in days_list:
                cache_path = _cache_path(device_id, day_str)
                cache_path.parent.mkdir(exist_ok=True, parents=True)
                # Touch so _cached_days() finds it
                if not cache_path.exists():
                    cache_path.touch()
            return jsonify(data), 200
        # Fall through to cache
        print("[info] EC2 unreachable for /days — using local cache")

    # Offline / fallback
    cached = _cached_days(device_id)[:limit]
    return jsonify({
        "device_id": device_id,
        "days": cached,
        "count": len(cached),
        "from_cache": True,
    }), 200


@app.route("/api/diag/events", methods=["GET"])
def diag_events() -> Response:
    """
    GET /api/diag/events?device_id=X&date=YYYY-MM-DD&from=ISO&to=ISO&limit=2000&newest_first=true
    """
    device_id = (request.args.get("device_id") or "").strip().upper()
    utc_date = (request.args.get("date") or "").strip()
    from_iso = request.args.get("from") or None
    to_iso = request.args.get("to") or None
    limit_raw = request.args.get("limit")
    limit = int(limit_raw) if limit_raw and limit_raw.isdigit() else 2000
    newest_first_raw = (request.args.get("newest_first") or "true").lower()
    newest_first = newest_first_raw not in ("false", "0", "no")

    if not device_id:
        return jsonify({"error": "device_id required"}), 400

    # Try EC2 first (unless offline)
    if not _offline:
        params: dict = {"device_id": device_id, "limit": limit, "newest_first": "true" if newest_first else "false"}
        if utc_date:
            params["date"] = utc_date
        if from_iso:
            params["from"] = from_iso
        if to_iso:
            params["to"] = to_iso

        data, status = _proxy_get("/api/diag/events", params=params)
        if data is not None:
            events = data.get("events") or []
            if events and utc_date:
                _append_to_cache(device_id, utc_date, events)
            return jsonify(data), 200
        print(f"[info] EC2 unreachable for /events({utc_date}) — using local cache")

    # Offline / fallback: serve from cache
    result = _load_from_cache(
        device_id=device_id,
        utc_date=utc_date or _today_utc(),
        from_iso=from_iso,
        to_iso=to_iso,
        limit=limit,
        newest_first=newest_first,
    )
    return jsonify(result), 200


@app.route("/api/diag/flush", methods=["POST"])
def diag_flush() -> Response:
    """POST /api/diag/flush — proxy to EC2 or ack locally."""
    body = request.get_json(silent=True) or {}
    device_id = (body.get("device_id") or "").strip().upper()

    if not _offline:
        data, status = _proxy_post("/api/diag/flush", body=body)
        if data is not None:
            return jsonify(data), 200
        print("[info] EC2 unreachable for /flush — returning local ack")

    return jsonify({"ok": True, "local": True, "device_id": device_id}), 200


@app.route("/api/health", methods=["GET"])
def health() -> Response:
    return jsonify({"status": "ok", "server": "local_diag_server", "offline": _offline}), 200


@app.route("/api/login", methods=["POST"])
def login() -> Response:
    """Minimal local login — always succeeds so the dashboard can initialise."""
    body = request.get_json(silent=True) or {}
    device_id = (body.get("device_id") or "ARMY").strip().upper()
    return jsonify({
        "session_token": f"local-session-{device_id}",
        "device_id": device_id,
        "ok": True,
        "local": True,
    }), 200


@app.route("/api/diag/save_excel", methods=["POST"])
def save_excel() -> Response:
    """Save generated Excel file to downloads/ folder and open it automatically."""
    body = request.get_json(silent=True) or {}
    filename = body.get("filename", "diag_export.xlsx")
    base64_data = body.get("base64_data", "")

    if not base64_data:
        return jsonify({"ok": False, "error": "No base64_data provided"}), 400

    base_dir = Path(__file__).resolve().parent
    downloads_dir = base_dir / "downloads"
    downloads_dir.mkdir(exist_ok=True, parents=True)
    out_path = downloads_dir / filename

    try:
        raw_bytes = base64.b64decode(base64_data)
        out_path.write_bytes(raw_bytes)
        opened = False
        if sys.platform == "win32":
            try:
                os.startfile(str(out_path))
                opened = True
            except Exception as e:
                print(f"[warn] Failed to auto-open excel file: {e}")
        return jsonify({
            "ok": True,
            "filename": filename,
            "saved_path": str(out_path.resolve()),
            "byte_length": len(raw_bytes),
            "opened": opened,
        }), 200
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


# ---------------------------------------------------------------------------
# Downloaded Logs & Timeline endpoints
# ---------------------------------------------------------------------------

@app.route("/api/logs/manifest", methods=["GET"])
def logs_manifest() -> Response:
    """Return the cached or freshly generated downloaded logs manifest."""
    manifest_path = BASE_DIR / "data" / "logs_manifest.json"
    if not manifest_path.exists():
        try:
            import build_logs_manifest
            build_logs_manifest.build()
        except Exception as e:
            return jsonify({"ok": False, "error": f"Failed to build manifest: {e}"}), 500

    if manifest_path.exists():
        return Response(manifest_path.read_text(encoding="utf-8"), mimetype="application/json")
    return jsonify({"ok": False, "error": "Manifest not found"}), 404


@app.route("/api/logs/download", methods=["GET"])
def logs_download() -> Response:
    """Download a specific log artifact (Excel, markdown, log, txt) safely."""
    rel_path = (request.args.get("path") or "").strip().replace("\\", "/")
    if not rel_path or ".." in rel_path:
        return jsonify({"ok": False, "error": "Invalid path parameter"}), 400

    # First check logs_storage/
    target = (BASE_DIR / "logs_storage" / rel_path).resolve()
    if not target.exists():
        # Fallback to source ../cloud_watchlogs/downloaded_logs/
        target = (BASE_DIR.parent / "cloud_watchlogs" / "downloaded_logs" / rel_path).resolve()

    if not target.exists() or not target.is_file():
        return jsonify({"ok": False, "error": f"File not found: {rel_path}"}), 404

    as_attachment = request.args.get("as_attachment", "1").lower() in ("1", "true", "yes")
    return send_file(
        str(target),
        as_attachment=as_attachment,
        download_name=target.name,
    )


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def _today_utc() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# CLI entry-point
# ---------------------------------------------------------------------------

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="VetInstant local diagnostic API proxy",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples
--------
  # Proxy to EC2 (default)
  python local_diag_server.py

  # Force offline/cache-only mode
  python local_diag_server.py --offline

  # Use a different EC2 address
  python local_diag_server.py --ec2 http://43.205.129.56:8000

  # Change port
  python local_diag_server.py --port 9000

Then update config.api.js:
  window.API_CONFIG = { baseUrl: "http://localhost:8765", ... };
""",
    )
    p.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Port to listen on (default: {DEFAULT_PORT})")
    p.add_argument("--ec2", default=DEFAULT_EC2_BASE, help="EC2 base URL to proxy (default: %(default)s)")
    p.add_argument("--offline", action="store_true", help="Never hit EC2; serve from local cache only")
    p.add_argument("--cache-dir", default=str(CACHE_DIR), help="Directory to store event cache (default: %(default)s)")
    return p.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    _ec2_base = args.ec2.rstrip("/")
    _offline = args.offline
    cache_dir_override = Path(args.cache_dir)
    cache_dir_override.mkdir(exist_ok=True, parents=True)
    CACHE_DIR = cache_dir_override  # type: ignore[assignment]

    mode = "OFFLINE (cache-only)" if _offline else f"PROXY -> {_ec2_base}"
    print("=" * 60)
    print(" VetInstant Local Diagnostic API Server")
    print("=" * 60)
    print(f"  Mode  : {mode}")
    print(f"  Port  : {args.port}")
    print(f"  Cache : {CACHE_DIR.resolve()}")
    print()
    print("  Dashboard config.api.js:")
    print(f'    baseUrl: "http://localhost:{args.port}"')
    print()
    print("  Starting... (Ctrl+C to stop)")
    print("=" * 60)

    app.run(host="0.0.0.0", port=args.port, debug=False, threaded=True)
