import sys
import openpyxl
import re

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

wb_path = 'd:/OFFFICE/PROJECTS/Data_Collection_ethical/PYTHON_APPLIC/new_dashboard/downloads/diag_trace_BRUNO_20261014.xlsx'
wb = openpyxl.load_workbook(wb_path, data_only=True)

ws_flow = wb['Device Flow']
ws_stm = wb['STM timeline']
ws_faults = wb['Faults']

def inspect_exact_moment(title, t_start, t_end):
    print("\n" + "=" * 90)
    print(f"EXACT CORRELATION TIMELINE: {title} [{t_start} - {t_end} IST]")
    print("=" * 90)
    
    # Extract events from Device Flow
    print("--- DEVICE FLOW (Screen, Buttons, State Transitions, Faults) ---")
    for r in ws_flow.iter_rows(min_row=2, values_only=True):
        t_dev = str(r[0])
        m = re.search(r"(\d{2}:\d{2}:\d{2})", t_dev)
        if m and t_start <= m.group(1) <= t_end:
            t_ist = t_dev[11:19]
            kind = r[2] or ""
            screen = r[3] or ""
            desc = r[4] or ""
            stream = r[7] or ""
            print(f"  [{t_ist} IST] {kind:<6} | Screen: {screen:<13} | {desc:<70} | Stream: {stream}")

    # Extract SU-01 / Framing faults in this exact interval
    print("\n--- UART LINK FAULTS (SU-01 / SU-02 / UA-*) in this interval ---")
    su_found = 0
    for r in ws_faults.iter_rows(min_row=2, values_only=True):
        t_dev = str(r[0])
        m = re.search(r"(\d{2}:\d{2}:\d{2})", t_dev)
        if m and t_start <= m.group(1) <= t_end:
            code = r[3] if len(r) > 3 else ""
            if "SU-" in str(code) or "UA-" in str(code):
                su_found += 1
                meaning = r[5] if len(r) > 5 else ""
                print(f"  [{t_dev[11:19]} IST] Code: {code} | Meaning: {meaning} | Screen: {r[2]}")
    if su_found == 0:
        print("  None in this exact sub-window.")

inspect_exact_moment("1. Lakshmi: Heart P (09:41:38) -> Heart A (09:42:11)", "09:41:30", "09:42:40")
inspect_exact_moment("2. Lakshmi: Heart P (09:43:23) -> Heart A (09:44:23)", "09:43:15", "09:44:40")
inspect_exact_moment("3. Lakshmi: Lung LL1 (09:45:11) -> Lung LL2 (09:45:50)", "09:45:00", "09:46:15")
inspect_exact_moment("4. Natchathira: Heart M (11:09:18) -> Lung LL1 (11:10:32)", "11:09:10", "11:10:45")
inspect_exact_moment("5. Natchathira: Lung LL1 (11:10:32) -> Lung LL2 (11:11:31)", "11:10:30", "11:11:45")
inspect_exact_moment("6. Georgea: Lung RL1 (11:28:47) -> Lung RL2 (11:29:25)", "11:28:40", "11:29:45")
