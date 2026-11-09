#!/usr/bin/env python3
"""
build_logs_manifest.py
======================
Scans downloaded CloudWatch and server log sessions from:
  ../cloud_watchlogs/downloaded_logs/
and generates:
  1) new_dashboard/data/logs_manifest.json (metadata, stats, viewable report markdown, stream snippets)
  2) copies key downloadable assets (.xlsx, .md, summaries) to new_dashboard/logs_storage/
so the dashboard can both view and download logs locally and statically!
"""

import os
import sys
import json
import shutil
import re
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BASE_DIR.parent
LOGS_SRC = REPO_ROOT / "cloud_watchlogs" / "downloaded_logs"
LOGS_STORAGE = BASE_DIR / "logs_storage"
DATA_DIR = BASE_DIR / "data"

LOGS_STORAGE.mkdir(exist_ok=True, parents=True)
DATA_DIR.mkdir(exist_ok=True, parents=True)

def parse_session_meta(folder_name: str) -> dict:
    """Extract date and time window from folder name."""
    # Examples: 2026-11-03_0930_to_1200 or 2026-10-09
    match = re.match(r"^(\d{4}-\d{2}-\d{2})(?:_(\d{4})_to_(\d{4}))?", folder_name)
    if not match:
        return {
            "date": folder_name,
            "start_time": "",
            "end_time": "",
            "time_window_display": "All Day",
        }
    
    date_str = match.group(1)
    start_raw = match.group(2)
    end_raw = match.group(3)
    
    if start_raw and end_raw:
        s_h, s_m = start_raw[:2], start_raw[2:]
        e_h, e_m = end_raw[:2], end_raw[2:]
        time_window = f"{s_h}:{s_m} - {e_h}:{e_m} IST"
    else:
        time_window = "Daily Session"
        
    return {
        "date": date_str,
        "start_time": f"{start_raw[:2]}:{start_raw[2:]}" if start_raw else "",
        "end_time": f"{end_raw[:2]}:{end_raw[2:]}" if end_raw else "",
        "time_window_display": time_window,
    }

def extract_markdown_summary(md_path: Path) -> dict:
    """Extract quick metrics from forensic speed report."""
    if not md_path.exists():
        return {}
    
    try:
        text = md_path.read_text(encoding="utf-8")
    except Exception:
        return {}
    
    # Extract severity counts: OK / WEAK / BAD / FAIL: 283 / 16 / 8 / 2
    sev_match = re.search(r"OK\s*/\s*WEAK\s*/\s*BAD\s*/\s*FAIL:\s*\*\*(\d+)\*\*\s*/\s*\*\*(\d+)\*\*\s*/\s*\*\*(\d+)\*\*\s*/\s*\*\*(\d+)\*\*", text)
    speed_samples_match = re.search(r"Speed samples:\s*\*\*(\d+)\*\*", text)
    audit_match = re.search(r"Audit events:\s*\*\*(\d+)\*\*", text)
    mean_dl_match = re.search(r"Download kbps — mean `([\d.]+)`", text)
    mean_ping_match = re.search(r"Ping ms — mean `([\d.]+)`", text)
    
    result = {
        "has_metrics": bool(sev_match),
        "ok": int(sev_match.group(1)) if sev_match else 0,
        "weak": int(sev_match.group(2)) if sev_match else 0,
        "bad": int(sev_match.group(3)) if sev_match else 0,
        "fail": int(sev_match.group(4)) if sev_match else 0,
        "speed_samples": int(speed_samples_match.group(1)) if speed_samples_match else 0,
        "audit_events": int(audit_match.group(1)) if audit_match else 0,
        "mean_dl_kbps": float(mean_dl_match.group(1)) if mean_dl_match else None,
        "mean_ping_ms": float(mean_ping_match.group(1)) if mean_ping_match else None,
    }
    return result

def build():
    print(f"Scanning logs from: {LOGS_SRC}")
    if not LOGS_SRC.exists():
        print(f"[ERROR] Source folder not found: {LOGS_SRC}")
        return

    sessions = []
    
    for item in sorted(os.listdir(LOGS_SRC), reverse=True):
        session_dir = LOGS_SRC / item
        if not session_dir.is_dir() or item in ("cloudwatch_raw", "logs_decoding") or item.startswith("."):
            continue
        
        meta = parse_session_meta(item)
        target_storage_dir = LOGS_STORAGE / item
        target_storage_dir.mkdir(exist_ok=True, parents=True)
        
        # Files in root of session
        root_files = [f for f in session_dir.iterdir() if f.is_file()]
        
        # Decoded Excel timeline
        timeline_xlsx = [f for f in root_files if f.suffix.lower() == ".xlsx" and "TIMELINE" in f.name.upper()]
        all_xlsx = [f for f in root_files if f.suffix.lower() == ".xlsx"]
        primary_xlsx = timeline_xlsx[0] if timeline_xlsx else (all_xlsx[0] if all_xlsx else None)
        
        # Forensic Markdown Report
        md_files = [f for f in root_files if f.suffix.lower() == ".md"]
        report_md = md_files[0] if md_files else None
        
        # If report not in this folder, check if a multi-day report covers this date
        # (e.g. bruno_speed_02_03_Nov2026 covers 02 Nov)
        if not report_md and "2026-11-02" in item:
            candidate = LOGS_SRC / "2026-11-03_0930_to_1200" / "bruno_speed_02_03_Nov2026_0930_1200_IST.md"
            if candidate.exists():
                report_md = candidate
        
        excel_info = None
        if primary_xlsx and primary_xlsx.exists():
            # Copy to storage
            dest_xlsx = target_storage_dir / primary_xlsx.name
            if not dest_xlsx.exists() or dest_xlsx.stat().st_size != primary_xlsx.stat().st_size:
                shutil.copy2(primary_xlsx, dest_xlsx)
                print(f"  [copy] {primary_xlsx.name} -> {dest_xlsx.relative_to(BASE_DIR)}")
            
            excel_info = {
                "name": primary_xlsx.name,
                "size_bytes": primary_xlsx.stat().st_size,
                "storage_url": f"logs_storage/{item}/{primary_xlsx.name}",
                "is_timeline": "TIMELINE" in primary_xlsx.name.upper(),
                "sheets": [
                    "Master_Timeline_All_Events",
                    "Audio_Flow_Events",
                    "Temperature_Flow_Events",
                    "STM32_Log_Events",
                    "ESP32_Log_Events",
                ] if "TIMELINE" in primary_xlsx.name.upper() else [],
            }
            
        report_info = None
        if report_md and report_md.exists():
            dest_md = target_storage_dir / report_md.name
            if not dest_md.exists() or dest_md.stat().st_size != report_md.stat().st_size:
                shutil.copy2(report_md, dest_md)
                print(f"  [copy] {report_md.name} -> {dest_md.relative_to(BASE_DIR)}")
            
            md_text = report_md.read_text(encoding="utf-8")
            metrics = extract_markdown_summary(report_md)
            
            report_info = {
                "name": report_md.name,
                "size_bytes": report_md.stat().st_size,
                "storage_url": f"logs_storage/{item}/{report_md.name}",
                "metrics": metrics,
                "markdown_content": md_text,
            }
            
        # Log streams inspection
        log_streams = []
        
        # 1. Server Bruno Filtered Log
        filtered_dir = session_dir / "server_logs_bruno_filtered"
        if filtered_dir.is_dir():
            for lf in filtered_dir.glob("*.log"):
                dest_log = target_storage_dir / lf.name
                if not dest_log.exists() or dest_log.stat().st_size != lf.stat().st_size:
                    shutil.copy2(lf, dest_log)
                
                # Read head snippet
                try:
                    with lf.open("r", encoding="utf-8", errors="replace") as fh:
                        snippet_lines = [fh.readline() for _ in range(80)]
                        snippet = "".join(snippet_lines)
                except Exception:
                    snippet = ""
                    
                log_streams.append({
                    "id": "bruno_filtered",
                    "label": f"Filtered Bruno Server Log ({lf.name})",
                    "type": "server_log",
                    "filename": lf.name,
                    "size_bytes": lf.stat().st_size,
                    "storage_url": f"logs_storage/{item}/{lf.name}",
                    "snippet": snippet,
                })
                
        # 2. CloudWatch Summary
        cw_sum_dir = session_dir / "cloudwatch_summaries"
        if cw_sum_dir.is_dir():
            for sf in cw_sum_dir.glob("*.txt"):
                dest_sf = target_storage_dir / sf.name
                if not dest_sf.exists() or dest_sf.stat().st_size != sf.stat().st_size:
                    shutil.copy2(sf, dest_sf)
                try:
                    with sf.open("r", encoding="utf-8", errors="replace") as fh:
                        snippet = fh.read(4000)
                except Exception:
                    snippet = ""
                log_streams.append({
                    "id": "cloudwatch_summary",
                    "label": f"CloudWatch Telemetry Summary ({sf.name})",
                    "type": "summary",
                    "filename": sf.name,
                    "size_bytes": sf.stat().st_size,
                    "storage_url": f"logs_storage/{item}/{sf.name}",
                    "snippet": snippet,
                })
                
        # 3. Server Diag Log
        diag_dir = session_dir / "server_diag_logs"
        if diag_dir.is_dir():
            for df in diag_dir.glob("*.txt"):
                dest_df = target_storage_dir / df.name
                if not dest_df.exists() or dest_df.stat().st_size != df.stat().st_size:
                    shutil.copy2(df, dest_df)
                try:
                    with df.open("r", encoding="utf-8", errors="replace") as fh:
                        snippet = fh.read(4000)
                except Exception:
                    snippet = ""
                log_streams.append({
                    "id": "diag_summary",
                    "label": f"Server Diagnostic Summary ({df.name})",
                    "type": "diag",
                    "filename": df.name,
                    "size_bytes": df.stat().st_size,
                    "storage_url": f"logs_storage/{item}/{df.name}",
                    "snippet": snippet,
                })

        # 4. MQTT Debug Log from server_system_logs (if present)
        sys_logs_dir = session_dir / "server_system_logs"
        if sys_logs_dir.is_dir():
            mqtt_files = list(sys_logs_dir.rglob("mqtt_debug.log"))
            if mqtt_files:
                mf = mqtt_files[0]
                try:
                    with mf.open("r", encoding="utf-8", errors="replace") as fh:
                        snippet_lines = [fh.readline() for _ in range(60)]
                        snippet = "".join(snippet_lines)
                    dest_mqtt = target_storage_dir / "mqtt_debug.log"
                    if not dest_mqtt.exists():
                        dest_mqtt.write_text(snippet, encoding="utf-8")
                    log_streams.append({
                        "id": "mqtt_debug",
                        "label": "MQTT Debug Stream (Telemetry & Audio Topics)",
                        "type": "mqtt",
                        "filename": "mqtt_debug.log",
                        "size_bytes": mf.stat().st_size,
                        "storage_url": f"logs_storage/{item}/mqtt_debug.log",
                        "snippet": snippet,
                    })
                except Exception as e:
                    print(f"  [warn] MQTT debug read: {e}")

        # Total counts across entire folder
        total_files = 0
        total_bytes = 0
        subdirs = []
        for root, dirs, fnames in os.walk(session_dir):
            rel = os.path.relpath(root, session_dir)
            if rel != ".":
                subdirs.append(rel)
            for fn in fnames:
                total_files += 1
                try:
                    total_bytes += os.path.getsize(os.path.join(root, fn))
                except OSError:
                    pass

        session_entry = {
            "id": item,
            "title": f"{meta['date']} ({meta['time_window_display']})",
            "date": meta["date"],
            "start_time": meta["start_time"],
            "end_time": meta["end_time"],
            "time_window": meta["time_window_display"],
            "device": "BRUNO",
            "total_files": total_files,
            "total_size_mb": round(total_bytes / (1024 * 1024), 2),
            "subdirectories": list(set(subdirs)),
            "excel": excel_info,
            "report": report_info,
            "log_streams": log_streams,
        }
        sessions.append(session_entry)

    # Output manifest JSON
    manifest = {
        "generated_at": "2026-11-09T20:30:00+05:30",
        "device": "BRUNO",
        "total_sessions": len(sessions),
        "sessions_with_excel": len([s for s in sessions if s.get("excel")]),
        "sessions_with_report": len([s for s in sessions if s.get("report")]),
        "sessions": sessions,
    }

    manifest_path = DATA_DIR / "logs_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nManifest generated successfully at: {manifest_path} ({manifest_path.stat().st_size / 1024:.1f} KB)")
    print(f"Total Sessions: {len(sessions)}")
    print(f"Sessions with Decoded Excel Timeline: {manifest['sessions_with_excel']}")
    print(f"Sessions with Forensic Speed Report: {manifest['sessions_with_report']}")

if __name__ == "__main__":
    build()

