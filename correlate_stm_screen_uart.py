import sys
import openpyxl
import re

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

wb_path = 'd:/OFFFICE/PROJECTS/Data_Collection_ethical/PYTHON_APPLIC/new_dashboard/downloads/diag_trace_BRUNO_20261014.xlsx'
wb = openpyxl.load_workbook(wb_path, data_only=True)

print("=" * 90)
print("1. SUMMARY SHEET CONTENT:")
print("=" * 90)
ws_sum = wb['Summary']
for r in ws_sum.iter_rows(values_only=True):
    if r and any(r):
        print(f"  {r[0]:<35} : {r[1]}")

print("\n" + "=" * 90)
print("2. SEARCHING FOR UART FRAMING ERRORS (SU-01, SU-02, UA-*, FE, framing):")
print("=" * 90)
ws_faults = wb['Faults']
fault_headers = [c for c in next(ws_faults.iter_rows(max_row=1, values_only=True))]
print(f"Faults sheet columns: {fault_headers}")

uart_faults = []
for r in ws_faults.iter_rows(min_row=2, values_only=True):
    row_str = " ".join([str(x) for x in r if x is not None])
    if any(k in row_str.upper() for k in ["UART", "FRAMING", "SU-", "UA-", "FE", "0x5A", "PARSER"]):
        uart_faults.append(r)

print(f"Total matching UART/Framing fault records found in Faults sheet: {len(uart_faults)}")
for f in uart_faults[:15]:
    print("  ", f)

print("\n" + "=" * 90)
print("3. EXAMINING 'STM timeline' AND 'Device Flow' SHEETS FOR SCREEN MOVEMENTS & COMMANDS:")
print("=" * 90)
ws_flow = wb['Device Flow']
flow_headers = [c for c in next(ws_flow.iter_rows(max_row=1, values_only=True))]
print(f"Device Flow sheet columns: {flow_headers}")

ws_stm = wb['STM timeline']
stm_headers = [c for c in next(ws_stm.iter_rows(max_row=1, values_only=True))]
print(f"STM timeline sheet columns: {stm_headers}")

# Let's inspect the target windows:
# Lakshmi: 09:41:00 - 09:46:30
# Natchathira: 11:09:00 - 11:12:30
# Georgea: 11:28:00 - 11:30:30
def search_window(ws, name, t_start_ist, t_end_ist, keywords=None):
    print(f"\n--- {ws.title} Events for {name} [{t_start_ist} - {t_end_ist} IST] ---")
    matches = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        row_str = " ".join([str(x) for x in r if x is not None])
        # Look for time match
        m = re.search(r"(\d{2}:\d{2}:\d{2})", row_str)
        if m:
            tm = m.group(1)
            if t_start_ist <= tm <= t_end_ist:
                if keywords:
                    if any(k.lower() in row_str.lower() for k in keywords):
                        matches.append(r)
                else:
                    matches.append(r)
    print(f"  Found {len(matches)} rows matching window.")
    for m in matches[:25]:
        print("   ", [str(x)[:60] for x in m if x is not None])
    if len(matches) > 25:
        print(f"    ... and {len(matches) - 25} more rows.")

search_window(ws_flow, "Lakshmi", "09:41:00", "09:46:30")
search_window(ws_stm, "Lakshmi", "09:41:00", "09:46:30")

search_window(ws_flow, "Natchathira", "11:09:00", "11:12:30")
search_window(ws_stm, "Natchathira", "11:09:00", "11:12:30")

search_window(ws_flow, "Georgea", "11:28:00", "11:30:30")
search_window(ws_stm, "Georgea", "11:28:00", "11:30:30")
