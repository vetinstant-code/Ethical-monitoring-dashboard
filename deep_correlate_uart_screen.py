import sys
import openpyxl
import re
from collections import Counter

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

wb_path = 'd:/OFFFICE/PROJECTS/Data_Collection_ethical/PYTHON_APPLIC/new_dashboard/downloads/diag_trace_BRUNO_20261014.xlsx'
wb = openpyxl.load_workbook(wb_path, data_only=True)

ws_faults = wb['Faults']
fault_rows = list(ws_faults.iter_rows(values_only=True))
hdr = fault_rows[0]
rows = fault_rows[1:]

print("=" * 85)
print("TOTAL FAULTS SUMMARY ON BRUNO (2026-10-14)")
print("=" * 85)
print(f"Total Fault Rows in Excel: {len(rows)}")

# Find all code families in Faults
code_counter = Counter()
su_faults = []
ua_faults = []
for r in rows:
    # row format: [device_time_ist, server_rec_ist, screen, code, area, meaning, severity, notes...]
    r_str = " ".join([str(x) for x in r if x is not None])
    m_code = re.search(r"\b([A-Z]{2}-\d{2})\b", r_str)
    if m_code:
        code_counter[m_code.group(1)] += 1
    if "SU-01" in r_str or "SU-02" in r_str or "framing" in r_str.lower():
        su_faults.append(r)
    if "UA-" in r_str:
        ua_faults.append(r)

print("\nTop 15 Fault Codes on BRUNO today:")
for code, count in code_counter.most_common(15):
    print(f"  {code:<10} : {count:>5} occurrences")

print(f"\nTotal STM↔ESP UART Framing / Sync Faults (SU-01 / SU-02): {len(su_faults)}")
print(f"Total ESP UART Bridge Faults (UA-*): {len(ua_faults)}")

# Inspect SU faults by time
print("\n" + "=" * 85)
print("DISTRIBUTION OF UART FRAMING / SYNC FAULTS (SU-01) ACROSS THE DAY:")
print("=" * 85)
for f in su_faults[:30]:
    t_dev = str(f[0])[:19] if len(f) > 0 else ""
    t_srv = str(f[1])[:19] if len(f) > 1 else ""
    code = f[3] if len(f) > 3 else ""
    meaning = f[5] if len(f) > 5 else ""
    print(f"  Device Time: {t_dev} | Server Rec: {t_srv} | Code: {code} | Meaning: {meaning}")
if len(su_faults) > 30:
    print(f"  ... and {len(su_faults) - 30} more SU-01 faults.")

# Now correlate with the 4 target animals!
windows = [
    ("Lakshmi (ID: e9d4aa07)", "09:41:00", "09:46:30"),
    ("Natchathira (ID: 5720339b)", "11:09:00", "11:12:30"),
    ("Georgea (ID: a6eb5d6d)", "11:28:00", "11:30:30"),
    ("Black (ID: d0b261d5)", "10:48:00", "10:49:00"),
]

ws_flow = wb['Device Flow']
flow_rows = list(ws_flow.iter_rows(values_only=True))[1:]

print("\n" + "=" * 85)
print("CORRELATION: UART FRAMING FAULTS & SCREEN MOVEMENTS PER AFFECTED PET")
print("=" * 85)

for pet_name, t_start, t_end in windows:
    print(f"\n>>> PET: {pet_name} [{t_start} - {t_end} IST]")
    
    # 1. UART / Framing faults in this window
    window_su = []
    for f in su_faults:
        t_dev = str(f[0])
        m = re.search(r"(\d{2}:\d{2}:\d{2})", t_dev)
        if m and t_start <= m.group(1) <= t_end:
            window_su.append(f)
            
    print(f"  UART Framing / Sync Errors (SU-01/02): {len(window_su)}")
    for f in window_su:
        print(f"    [FAULT] {f[0]} | {f[3]} | {f[5]}")
        
    # 2. Screen movements and button actions in this window
    print(f"  Screen & Movement Timeline (from Device Flow):")
    window_flow = []
    for r in flow_rows:
        t_dev = str(r[0])
        m = re.search(r"(\d{2}:\d{2}:\d{2})", t_dev)
        if m and t_start <= m.group(1) <= t_end:
            window_flow.append(r)
            
    for r in window_flow:
        # [time_dev, time_srv, kind, screen, action_desc, wifi, mqtt, stream...]
        t_d = str(r[0])[11:19]
        kind = str(r[2])
        screen = str(r[3] or "")
        desc = str(r[4] or "")
        stream = str(r[7] or "")
        if any(w in desc.lower() for w in ["navigat", "press", "select", "stream", "stop", "screen", "alert", "framing", "fault"]):
            print(f"    [{t_d}] {kind:<6} | {screen:<14} | {desc:<65} | stream:{stream}")
