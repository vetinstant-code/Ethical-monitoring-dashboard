#!/usr/bin/env python3
"""Generate STM_ESP_Diagnostic_Codebook.xlsx — polished multi-sheet codebook."""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.page import PageMargins
from pathlib import Path

OUT = Path(__file__).resolve().parent / "STM_ESP_Diagnostic_Codebook.xlsx"

NAVY = "1F4E79"
TEAL = "0D7377"
DARK = "2C3E50"
WHITE = "FFFFFF"
LIGHT_BLUE = "D6EAF8"
LIGHT_TEAL = "D5F5E3"
LIGHT_YELLOW = "FCF3CF"
LIGHT_ORANGE = "FDEBD0"
LIGHT_PURPLE = "E8DAEF"
LIGHT_GRAY = "F4F6F7"
ROW_ALT = "EEF5FB"
HEADER_FILL = PatternFill("solid", fgColor=NAVY)

FAMILY_FILLS = {
    "ST": PatternFill("solid", fgColor="5DADE2"),
    "SU": PatternFill("solid", fgColor="48C9B0"),
    "SA": PatternFill("solid", fgColor="58D68D"),
    "SF": PatternFill("solid", fgColor="F4D03F"),
    "SC": PatternFill("solid", fgColor="AF7AC5"),
    "SS": PatternFill("solid", fgColor="E67E22"),
    "SO": PatternFill("solid", fgColor="85929E"),
    "PW": PatternFill("solid", fgColor="E74C3C"),
    "IB": PatternFill("solid", fgColor="3498DB"),
    "TM": PatternFill("solid", fgColor="1ABC9C"),
    "AH": PatternFill("solid", fgColor="9B59B6"),
    "DP": PatternFill("solid", fgColor="F39C12"),
    "FM": PatternFill("solid", fgColor="16A085"),
    "UB": PatternFill("solid", fgColor="2980B9"),
    "IO": PatternFill("solid", fgColor="7F8C8D"),
}
SEV_FILL = {
    "CRITICAL": PatternFill("solid", fgColor="C0392B"),
    "ERROR": PatternFill("solid", fgColor="E74C3C"),
    "WARN": PatternFill("solid", fgColor="F39C12"),
    "INFO": PatternFill("solid", fgColor="3498DB"),
    "Retired": PatternFill("solid", fgColor="95A5A6"),
}
IMPL_FILL = {
    "Yes": PatternFill("solid", fgColor="27AE60"),
    "Partial": PatternFill("solid", fgColor="F1C40F"),
    "Doc only": PatternFill("solid", fgColor="BDC3C7"),
    "Retired": PatternFill("solid", fgColor="95A5A6"),
}

thin = Border(
    left=Side(style="thin", color="BFBFBF"),
    right=Side(style="thin", color="BFBFBF"),
    top=Side(style="thin", color="BFBFBF"),
    bottom=Side(style="thin", color="BFBFBF"),
)
thick_bottom = Border(
    left=Side(style="thin", color="BFBFBF"),
    right=Side(style="thin", color="BFBFBF"),
    top=Side(style="thin", color="BFBFBF"),
    bottom=Side(style="medium", color=NAVY),
)

FAM = {
    "ST": "0x01", "SU": "0x02", "SA": "0x03", "SF": "0x04", "SC": "0x05",
    "SS": "0x06", "SO": "0x07", "PW": "0x08", "IB": "0x09", "TM": "0x0A",
    "AH": "0x0B", "DP": "0x0C", "FM": "0x0D", "UB": "0x0E", "IO": "0x0F",
}


def style_header(ws, row, ncol):
    for c in range(1, ncol + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = HEADER_FILL
        cell.font = Font(name="Calibri", bold=True, color=WHITE, size=11)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = thick_bottom
    ws.row_dimensions[row].height = 28


def style_row(ws, row, ncol, alt=False):
    for c in range(1, ncol + 1):
        cell = ws.cell(row=row, column=c)
        cell.font = Font(name="Calibri", size=10, color=DARK)
        cell.alignment = Alignment(vertical="center", wrap_text=True)
        cell.border = thin
        if alt and (cell.fill.fgColor is None or str(getattr(cell.fill.fgColor, "rgb", "")) in ("00000000", "None")):
            cell.fill = PatternFill("solid", fgColor=ROW_ALT)
    ws.row_dimensions[row].height = 36


def autosize(ws, widths):
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w


def title_block(ws, title, subtitle, ncol):
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncol)
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=ncol)
    a = ws.cell(1, 1, title)
    a.font = Font(name="Calibri", bold=True, size=18, color=NAVY)
    a.alignment = Alignment(horizontal="left", vertical="center")
    b = ws.cell(2, 1, subtitle)
    b.font = Font(name="Calibri", size=11, color="5D6D7E", italic=True)
    b.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
    ws.row_dimensions[1].height = 30
    ws.row_dimensions[2].height = 22
    ws.freeze_panes = "A5"


codes = []


def add(fam, code_num, sev, meaning, example, clear, impl="Doc only"):
    codes.append((
        fam, FAM[fam], f"{fam}-{code_num:02d}",
        f"0x{code_num:02X}", sev, meaning, example, clear, impl, "0x59",
    ))


# ST
add("ST", 1, "ERROR", "LEN below 2 or above protocol max", "RX LEN=0x01 → ST-01", "Next valid frame", "Partial")
add("ST", 2, "ERROR", "END byte is not 0x55", "Frame ends with 0x00 → ST-02", "Next valid frame", "Partial")
add("ST", 3, "ERROR", "XOR checksum mismatch", "Doc example ST-03,7 session 0x1234 seq 1", "Next valid frame", "Yes")
add("ST", 4, "CRITICAL", "Raw RX buffer would overflow", "Burst fills uart_rx_raw_buffer", "Parser reset + valid frame", "Yes")
add("ST", 5, "WARN", "START during partial frame → resync", "New 0xAA while assembling prior frame", "Valid frame", "Doc only")
add("ST", 6, "ERROR", "Partial frame assembly timeout", "Started frame never completed", "Valid frame", "Doc only")
add("ST", 7, "WARN", "Unsupported command ID in valid frame", "Unknown CMD 0xEE received", "Supported command", "Yes")
add("ST", 8, "ERROR", "Payload length violates command contract", "CMD expects 11 bytes, got 3", "Valid instance of that CMD", "Doc only")
add("ST", 9, "ERROR", "Nested length exceeds payload bounds", "Inner length past end", "Valid payload", "Doc only")
add("ST", 10, "ERROR", "STM tries to build oversized TX payload", "Builder rejects oversized packet", "Valid TX build", "Doc only")
add("ST", 11, "CRITICAL", "TX checksum self-verification fails", "Local XOR check fails before send", "Verified build", "Doc only")

# SU
add("SU", 1, "ERROR", "USART3 overrun (ORE)", "RX ISR sees ORE flag", "Recovery + valid frame", "Yes")
add("SU", 2, "ERROR", "USART3 framing error (FE)", "Noise/baud mismatch → FE", "Recovery + valid frame", "Yes")
add("SU", 3, "WARN", "USART3 noise error (NE)", "NE flag set on RX", "Recovery + valid frame", "Yes")
add("SU", 4, "ERROR", "USART3 parity error (PE)", "PE flag set on RX", "Recovery + valid frame", "Yes")
add("SU", 5, "WARN", "RX timeout/IDLE with incomplete frame", "RTOF / incomplete assembly", "Valid frame", "Yes")
add("SU", 6, "ERROR", "USART3 RX DMA error (if DMA later)", "DMA TEIF/error", "After recovery", "Doc only")
add("SU", 7, "ERROR", "USART3 TX DMA error (if DMA later)", "DMA TX error", "Successful TX", "Doc only")
add("SU", 8, "ERROR", "Packet TX HAL error/timeout", "HAL_UART_Transmit timeout", "Successful TX", "Yes")
add("SU", 9, "ERROR", "ESP silent for expected reply", "No response to request", "Valid ESP traffic resumes", "Doc only")
add("SU", 10, "ERROR", "Validated RX queue full — packet lost", "Process queue full drop", "Queue recovery", "Yes")

# SA
add("SA", 1, "ERROR", "SPI2 audio HAL error (non-timeout)", "esp_spi_transmit HAL fail", "Successful block", "Yes")
add("SA", 2, "ERROR", "SPI2 audio transfer timeout", "esp_spi_transmit timeout", "Successful block", "Yes")
add("SA", 3, "ERROR", "SPI2 audio DMA error (if enabled)", "DMA error on audio SPI", "After recovery", "Doc only")
add("SA", 4, "WARN", "PCM transport queue full — block dropped", "UART2 audio ring full", "Clears on enqueue OK", "Yes")
add("SA", 5, "ERROR", "PCM block null/zero/oversized/misaligned", "Invalid PCM pointer/size", "Valid block", "Doc only")

# SF
add("SF", 1, "ERROR", "Illegal stream state transition", "Illegal START while STARTED", "IDLE/STOPPED", "Doc only")
add("SF", 2, "ERROR", "START response timeout", "No START ACK from ESP", "Success or cancel", "Doc only")
add("SF", 3, "ERROR", "START response reports failure", "ESP ACK failure on START", "Later success/cancel", "Yes")
add("SF", 4, "ERROR", "START response fields mismatch request", "Pet/audio/state mismatch", "Correlated response", "Doc only")
add("SF", 5, "ERROR", "STOP response timeout", "No STOP ACK", "Success or forced reset", "Doc only")
add("SF", 6, "ERROR", "STOP response reports failure", "ESP ACK failure on STOP", "Later success/reset", "Yes")
add("SF", 7, "ERROR", "STOP response does not correlate", "Wrong correlation IDs", "Correlated response", "Doc only")
add("SF", 8, "WARN", "STM and ESP stream states diverge", "STM streaming, ESP stopped", "Both agree", "Doc only")
add("SF", 9, "WARN", "Screen/mode exits while handshake pending", "Leave auscultation mid-handshake", "After settlement", "Doc only")

# SC
add("SC", 1, "ERROR", "Expected temp cloud ACK 0x55 missing at deadline", "Temp upload, no 0x55", "—", "Partial")
add("SC", 2, "WARN", "0x55 arrives after timeout/cancel", "Late ACK after cancel", "—", "Doc only")
add("SC", 3, "ERROR", "0x55 status = upload failure (0)", "Cloud rejected temp", "—", "Yes")
add("SC", 4, "ERROR", "0x55 payload/message-ID length malformed", "Bad ACK length", "—", "Yes")
add("SC", 5, "ERROR", "ACK message ID ≠ pending transaction", "Mismatched msg id", "—", "Doc only")
add("SC", 6, "WARN", "Cloud warning 0x58 UNSTABLE", "Mid-stream cloud warn unstable", "Clears on OK", "Yes")
add("SC", 7, "ERROR", "Cloud warning 0x58 DOWN", "Mid-stream cloud down", "Clears on UNSTABLE/OK", "Yes")
add("SC", 8, "ERROR", "0x58 payload/quality/context invalid", "Malformed cloud warn", "—", "Doc only")
add("SC", 9, "ERROR", "WiFi status response wrong payload length", "Bad WIFI_RESP length", "—", "Doc only")
add("SC", 10, "WARN", "WiFi disconnected (status 0x00)", "Wifistatus → Error_Connect", "Clears on connected", "Yes")
add("SC", 11, "WARN", "WiFi connecting beyond timeout", "Stuck Connecting", "—", "Doc only")
add("SC", 12, "ERROR", "WiFi explicit error (status 0x03)", "WIFI error status", "—", "Yes")
add("SC", 13, "ERROR", "Configured AP not found (payload 0x15)", "AP missing", "—", "Doc only")
add("SC", 14, "WARN", "RSSI response timeout", "No RSSI reply within 3s", "Clears on RSSI resp", "Yes")
add("SC", 15, "ERROR", "RSSI response length/range invalid", "Bad RSSI frame", "—", "Doc only")
add("SC", 16, "WARN", "N consecutive RSSI polls missed", "3 missed RSSI polls", "Clears on RSSI resp", "Yes")
codes.append(("SC", "0x05", "SC-17", "0x11", "Retired",
              "Unassigned — do not use (obsolete 0x56/0x57 probe)", "n/a", "n/a", "Retired", "0x59"))
codes.append(("SC", "0x05", "SC-18", "0x12", "Retired",
              "Unassigned — do not use (obsolete 0x56/0x57 probe)", "n/a", "n/a", "Retired", "0x59"))
add("SC", 19, "ERROR", "CMD_WIFI_RESP undefined status payload", "Unknown wifi status byte", "—", "Doc only")
add("SC", 20, "ERROR", "Standalone CMD_WIFI_FAILED (0x14)", "WiFi failed command", "Clears on connected/connecting", "Doc only")

# SS
add("SS", 1, "CRITICAL", "HardFault handler entered", "Usually cannot reach ESP", "n/a (reset)", "Doc only")
add("SS", 2, "CRITICAL", "MemManage fault", "Usually cannot reach ESP", "n/a", "Doc only")
add("SS", 3, "CRITICAL", "BusFault", "Usually cannot reach ESP", "n/a", "Doc only")
add("SS", 4, "CRITICAL", "UsageFault", "Usually cannot reach ESP", "n/a", "Doc only")
add("SS", 5, "CRITICAL", "Boot flags: IWDG reset", "IWDG not enabled today", "n/a", "Doc only")
add("SS", 6, "CRITICAL", "Boot flags: WWDG reset", "Reset cause WWDG", "n/a", "Doc only")
add("SS", 7, "CRITICAL", "FreeRTOS stack-overflow hook", "vApplicationStackOverflowHook", "n/a", "Yes")
add("SS", 8, "CRITICAL", "FreeRTOS malloc-failed hook", "pvPortMalloc failed", "n/a", "Partial")
add("SS", 9, "CRITICAL", "Boot flags: brownout reset", "BOR reset flag", "n/a", "Doc only")
add("SS", 10, "CRITICAL", "configASSERT failed", "assert in FreeRTOS/app", "n/a", "Doc only")
add("SS", 11, "CRITICAL", "Fatal Error_Handler entered", "Error_Handler() called", "n/a", "Yes")
add("SS", 12, "ERROR", "Diagnostic event ring overflow", "Too many active 0x59 events", "After queue recovery", "Yes")
add("SS", 20, "WARN", "FreeRTOS heap used ≥ 80%", "heap_pct crosses 80 → SS-20", "Clears ≤ 70%", "Yes")
add("SS", 21, "ERROR", "FreeRTOS heap used ≥ 90%", "heap_pct crosses 90 → SS-21", "Clears ≤ 70%", "Yes")
add("SS", 22, "WARN", "Esp32Task stack used ≥ 80% (HWM)", "Esp32Task watermark high", "Clears ≤ 70%", "Yes")
add("SS", 23, "WARN", "guiTask (TouchGFX) stack ≥ 80% (HWM)", "guiTask watermark high", "Clears ≤ 70%", "Yes")
add("SS", 24, "WARN", "audioTask stack ≥ 80% (HWM)", "audioTask watermark high", "Clears ≤ 70%", "Yes")
add("SS", 25, "WARN", "USB_Task stack ≥ 80% (HWM)", "USB_Task watermark high", "Clears ≤ 70%", "Yes")
add("SS", 26, "WARN", "temp1Task stack ≥ 80% (HWM)", "temp1Task watermark high", "Clears ≤ 70%", "Yes")
add("SS", 27, "WARN", "Vitals_Task (SpO2) stack ≥ 80% (HWM)", "Vitals watermark high", "Clears ≤ 70%", "Yes")
add("SS", 28, "WARN", "MP2722Task stack ≥ 80% (HWM)", "≠ charger absent — stack watermark only", "Clears ≤ 70%", "Yes")

# SO
add("SO", 1, "ERROR", "OTA available 0x50 payload malformed", "Bad OTA available frame", "—", "Doc only")
add("SO", 2, "ERROR", "OTA 0x52 phase unknown", "Unknown OTA phase byte", "—", "Doc only")
add("SO", 3, "ERROR", "Cannot TX OTA start 0x51/0x54", "UART TX fail starting OTA", "—", "Yes")
add("SO", 4, "ERROR", "Expected OTA STARTING phase timeout", "No STARTING phase", "—", "Doc only")
add("SO", 5, "ERROR", "Reserved: OTA chunk silence timeout", "Future use", "—", "Doc only")
add("SO", 6, "ERROR", "OTA success 0x53 timeout", "No success frame", "—", "Doc only")
add("SO", 7, "ERROR", "Version/job-ID length violates bounds", "Bad string lengths", "—", "Doc only")
add("SO", 8, "WARN", "OTA phase/success in incompatible state", "Success while not in OTA", "—", "Doc only")

# PW
add("PW", 1, "ERROR", "MP2722 does not ACK at I2C4 0x3F", "Charger chip missing/NACK", "—", "Yes")
add("PW", 2, "ERROR", "MP2722 register R/W fails after detection", "I2C fail after found", "—", "Yes")
add("PW", 3, "CRITICAL", "REG12 charger watchdog fault", "WD fault bit", "Clears when bit clear", "Yes")
add("PW", 4, "WARN", "REG12 active die thermal regulation", "Thermal regulation", "Clears when bit clear", "Yes")
add("PW", 5, "CRITICAL", "REG13 charge input overvoltage", "VIN OVP", "Clears", "Yes")
add("PW", 6, "ERROR", "REG13 charge safety timer expired", "Safety timer", "Clears", "Yes")
add("PW", 7, "CRITICAL", "REG13 battery overvoltage", "VBAT OVP", "Clears", "Yes")
add("PW", 8, "CRITICAL", "REG13 boost overload/short", "Boost fault", "Clears", "Yes")
add("PW", 9, "ERROR", "REG13 boost overvoltage", "Boost OVP", "Clears", "Yes")
add("PW", 10, "CRITICAL", "REG13 boost overtemperature", "Boost OT", "Clears", "Yes")
add("PW", 11, "ERROR", "REG13 battery too low for boost", "VBAT low for boost", "Clears", "Yes")
add("PW", 12, "CRITICAL", "REG14 battery missing", "Battery absent bit", "Clears", "Yes")
add("PW", 13, "ERROR", "REG14 NTC missing", "NTC missing", "Clears", "Yes")
add("PW", 14, "WARN", "NTC1 WARM", "NTC1 warm zone", "Clears", "Yes")
add("PW", 15, "WARN", "NTC1 COOL", "NTC1 cool zone", "Clears", "Yes")
add("PW", 16, "ERROR", "NTC1 COLD", "NTC1 cold", "Clears", "Yes")
add("PW", 17, "ERROR", "NTC1 HOT", "NTC1 hot", "Clears", "Yes")
add("PW", 18, "WARN", "NTC2 WARM", "NTC2 warm", "Clears", "Yes")
add("PW", 19, "WARN", "NTC2 COOL", "NTC2 cool", "Clears", "Yes")
add("PW", 20, "ERROR", "NTC2 COLD", "NTC2 cold", "Clears", "Yes")
add("PW", 21, "ERROR", "NTC2 HOT", "NTC2 hot", "Clears", "Yes")
add("PW", 22, "WARN", "Sustained input DPM throttling", "IIN/VIN DPM 5 reads", "Clears", "Yes")
add("PW", 23, "ERROR", "Battery ADC4 DMA start/error", "ADC DMA fail", "—", "Doc only")
add("PW", 24, "CRITICAL", "Filtered battery voltage below critical", "Battery critically low", "—", "Doc only")
add("PW", 25, "ERROR", "Battery ADC impossible/stale vs MP2722", "ADC contradicts charger", "—", "Doc only")

# IB
for name, base in (("I2C1", 1), ("I2C3", 11), ("I2C4", 21)):
    add("IB", base, "ERROR", f"{name} bus error (BERR)", f"{name} BERR flag", "Recovery", "Doc only")
    add("IB", base + 1, "ERROR", f"{name} arbitration lost (ARLO)", f"{name} ARLO", "Recovery", "Doc only")
    add("IB", base + 2, "ERROR", f"{name} timeout / busy-stuck", f"{name} stuck busy", "Recovery", "Doc only")
    add("IB", base + 3, "ERROR", f"{name} DMA/internal error", f"{name} controller error", "Recovery", "Doc only")

# TM
add("TM", 1, "WARN", "No supported probe after PD4 power-on during measurement", "User starts temp, no probe", "—", "Yes")
add("TM", 2, "ERROR", "Multiple mutually exclusive probe addresses respond", "TMP117 + MLX both ACK", "—", "Doc only")
add("TM", 10, "ERROR", "TMP117 disappears during active measurement", "TMP117 NACK mid-measure", "—", "Yes")
add("TM", 11, "ERROR", "TMP117 DEVICE_ID mismatch", "Wrong ID register", "—", "Doc only")
add("TM", 12, "ERROR", "TMP117 register read fails after ACK", "Read fail", "—", "Partial")
add("TM", 13, "ERROR", "TMP117 measurement no progress by deadline", "Stuck conversion", "—", "Doc only")
add("TM", 14, "ERROR", "TMP117 value NaN/impossible/out of range", "Decoded temp invalid", "—", "Doc only")
add("TM", 20, "ERROR", "MLX90614 disappears during active measurement", "MLX90614 NACK", "—", "Doc only")
add("TM", 21, "ERROR", "MLX90614 paired ambient/object read fails", "Ta/To read fail", "—", "Doc only")
add("TM", 22, "ERROR", "MLX90614 raw 0x0000/0xFFFF", "Invalid raw", "—", "Doc only")
add("TM", 23, "WARN", "MLX90614 < 8/8 successful sample pairs", "Partial average set", "—", "Doc only")
add("TM", 24, "ERROR", "MLX90614 calculated value invalid range", "Body temp out of range", "—", "Doc only")
add("TM", 30, "ERROR", "MLX90632 disappears during active measurement", "MLX90632 NACK", "—", "Doc only")
add("TM", 31, "ERROR", "MLX90632 register/RAM read failure", "Reg read fail", "—", "Doc only")
add("TM", 32, "ERROR", "MLX90632 DATA_RDY timeout", "No data ready", "—", "Doc only")
add("TM", 33, "ERROR", "MLX90632 brownout-reset status", "Brownout status bit", "—", "Doc only")
add("TM", 34, "ERROR", "MLX90632 BUSY timeout", "Busy stuck", "—", "Doc only")
add("TM", 35, "ERROR", "MLX90632 EE_BUSY timeout", "EEPROM busy", "—", "Doc only")
add("TM", 36, "ERROR", "MLX90632 EEPROM version/calibration invalid", "Bad calibration", "—", "Doc only")
add("TM", 37, "ERROR", "MLX90632 calculated value invalid range", "Out of range", "—", "Doc only")

# AH
add("AH", 1, "ERROR", "TLV320DAC32 NACK while PD2 on", "DAC not responding", "—", "Doc only")
add("AH", 2, "ERROR", "Required DAC init register write fails", "DAC init write fail", "—", "Doc only")
add("AH", 3, "ERROR", "DAC critical-register readback mismatch", "Readback ≠ written", "—", "Doc only")
add("AH", 4, "ERROR", "SAI1 start/DMA operation fails", "SAI start fail", "—", "Doc only")
add("AH", 5, "ERROR", "SAI1 underrun/overrun/error callback", "SAI error CB", "—", "Doc only")
add("AH", 10, "ERROR", "MDF acquisition overflow", "MDF overflow", "Clears after healthy audio", "Yes")
add("AH", 11, "ERROR", "MDF resampling-filter overrun", "Resample overrun", "Clears after healthy audio", "Yes")
add("AH", 12, "ERROR", "MDF clock absence", "No MDF clock", "—", "Doc only")
add("AH", 13, "WARN", "Sustained MDF saturation/out-of-limit", "Saturated mic path", "Clears after healthy audio", "Yes")
add("AH", 14, "CRITICAL", "MDF short-circuit detection", "Mic short detect", "—", "Doc only")
add("AH", 15, "ERROR", "MDF DMA error", "MDF DMA fail", "—", "Doc only")
add("AH", 16, "ERROR", "One mic near-zero energy, other valid", "Dead mic channel", "—", "Doc only")
add("AH", 17, "WARN", "Sustained mic imbalance/clipping", "One mic near-zero 1.5s", "Clears after 2s healthy", "Yes")

# DP
add("DP", 1, "CRITICAL", "SPI1/display init fails", "ST7789 init fail", "—", "Doc only")
add("DP", 2, "ERROR", "SPI1 display transfer HAL error", "Display SPI error", "—", "Doc only")
add("DP", 3, "ERROR", "SPI1 display transfer timeout", "Display SPI timeout", "—", "Doc only")
add("DP", 4, "ERROR", "PD14 unexpectedly off while UI needs display", "Display rail off", "—", "Doc only")
add("DP", 5, "WARN", "Backlight PWM zero while UI needs visible output", "Backlight off", "—", "Doc only")
add("DP", 6, "ERROR", "Reset/init sequence fails to complete", "Init incomplete", "—", "Doc only")

# FM
add("FM", 1, "CRITICAL", "BSP_MEM_Init(0) fails", "Ext flash init fail", "—", "Doc only")
add("FM", 2, "CRITICAL", "JEDEC ID read fails", "No JEDEC response", "—", "Doc only")
add("FM", 3, "CRITICAL", "JEDEC ID mismatch", "Wrong flash chip ID", "—", "Doc only")
add("FM", 4, "ERROR", "Flash status-register read fails", "SR read fail", "—", "Doc only")
add("FM", 5, "CRITICAL", "WIP stuck past operation timeout", "Write in progress stuck", "—", "Doc only")
add("FM", 6, "ERROR", "WEL does not set after write-enable", "Write enable fail", "—", "Doc only")
add("FM", 7, "ERROR", "Erase/program operation fails", "Program/erase fail", "—", "Doc only")
add("FM", 8, "CRITICAL", "Readback/CRC verification mismatch", "Verify fail", "—", "Doc only")
add("FM", 9, "CRITICAL", "OCTOSPI memory-mapped mode entry/sanity fails", "MMAP fail", "—", "Doc only")

# UB
add("UB", 1, "ERROR", "USB host/class init fails", "USB host init", "—", "Doc only")
add("UB", 2, "WARN", "Target disconnects during active SpO2 flow", "Probe unplug mid-flow", "—", "Yes")
add("UB", 3, "ERROR", "Enumerated PID ≠ 0x505C", "Wrong USB device", "—", "Yes")
add("UB", 4, "ERROR", "CDC TX submission fails", "CDC TX submit fail", "—", "Yes")
add("UB", 5, "ERROR", "CDC TX completion timeout", "CDC TX timeout", "—", "Yes")
add("UB", 6, "ERROR", "CDC RX submission fails", "CDC RX submit fail", "—", "Yes")
add("UB", 7, "ERROR", "CDC RX completion timeout", "CDC RX timeout", "—", "Yes")
add("UB", 8, "ERROR", "SpO2 packet malformed/short", "Bad SpO2 packet", "—", "Yes")
add("UB", 9, "ERROR", "SpO2/HR/status violates contract", "Out-of-range vitals fields", "—", "Doc only")
add("UB", 10, "ERROR", "USB HCD transport error during active session", "HCD error", "—", "Doc only")

# IO
add("IO", 1, "ERROR", "PD4 temp power disagrees with active flow", "Temp rail wrong state", "—", "Doc only")
add("IO", 2, "ERROR", "PD2 DAC/mic power disagrees with audio flow", "Audio rail wrong", "—", "Doc only")
add("IO", 3, "ERROR", "PD7/PD3 ESP power disagrees with ESP state", "ESP rail wrong", "—", "Doc only")
add("IO", 4, "ERROR", "Display power/backlight disagrees with UI sleep/wake", "Display state mismatch", "—", "Doc only")
add("IO", 5, "ERROR", "PB14 peripheral-enable disagrees with required state", "PB14 mismatch", "—", "Doc only")
add("IO", 10, "WARN", "Nav button stuck beyond timeout", "Held >= 8s", "Released", "Yes")
add("IO", 11, "ERROR", "Wake/select but expected UI transition timed out", "Select with no screen change", "—", "Doc only")


def main():
    yes_codes = {
        "ST-01","ST-02","ST-03","ST-04","ST-05",
        "SU-01","SU-02","SU-03","SU-04","SU-05",
        "SA-04","SC-06","SC-14","SC-16",
        "AH-10","AH-11","AH-13","AH-17",
        "PW-04","PW-14","PW-15","PW-16","PW-17","PW-18","PW-19","PW-20","PW-21","PW-22",
        "IO-10","SS-20",
    }
    for i, row in enumerate(codes):
        fam, fam_id, code, code_id, sev, meaning, example, clear, impl, cmd = row
        if code in yes_codes:
            codes[i] = (fam, fam_id, code, code_id, sev, meaning, example, clear, "Yes", cmd)
    wb = Workbook()

    # ---- Overview ----
    ws = wb.active
    ws.title = "01_Overview"
    title_block(
        ws,
        "STM ↔ ESP Diagnostic Codebook",
        "End-to-end reference — CMD 0x59 alerts + CMD 0x5B health/UI  |  "
        "Source: COMPONENT_DIAGNOSTIC_ANALYSIS.md  |  Tree: VETINSTANT_DATACOLLCTION_FINAL",
        5,
    )
    headers = ["Sheet", "Contents", "CMD", "Audience", "Notes"]
    for i, h in enumerate(headers, 1):
        ws.cell(4, i, h)
    style_header(ws, 4, 5)
    overview_rows = [
        ("01_Overview", "Cover + legend + how to read codes", "—", "All", "Start here"),
        ("02_Alert_Codes_0x59", "Full family/code table + meaning + example + clear + implemented", "0x59", "STM+ESP+Cloud", "Primary error codebook"),
        ("03_Families", "Family ID registry (ST…IO)", "0x59", "ESP decode", "family_id byte"),
        ("04_Status_0x5B_Fields", "74-byte health/UI payload field map + text decode hints", "0x5B", "ESP decode", "Telemetry (not error codes)"),
        ("05_Screen_Button_Action", "Screen / button / action enums", "0x5B", "ESP+Cloud UI text", "Human-readable maps"),
        ("06_Wire_Examples", "Sample hex frames + LEN rules + ACK 0x5A", "0x59/5A/5B", "ESP bring-up", "Lock framing"),
        ("07_Flow_Rates", "When STM sends what (5s/10s + UI edges)", "0x5B", "Verification", "Timeline"),
        ("08_Severity_Legend", "CRITICAL/ERROR/WARN + color key", "—", "All", "Legend"),
    ]
    for r, row in enumerate(overview_rows, 5):
        for c, v in enumerate(row, 1):
            ws.cell(r, c, v)
        style_row(ws, r, 5, alt=(r % 2 == 0))
        ws.cell(r, 1).fill = PatternFill("solid", fgColor=LIGHT_BLUE)
        ws.cell(r, 1).font = Font(name="Calibri", bold=True, size=10, color=NAVY)

    ws.cell(15, 1, "How a 0x59 alert looks end-to-end").font = Font(
        name="Calibri", bold=True, size=12, color=NAVY
    )
    ws.merge_cells("A16:E19")
    ws["A16"] = (
        "1) STM detects fault → STM_Diag_Report(family, code)\n"
        "2) UART frame CMD 0x59: family_id + code_id + repeat + session + sequence + age\n"
        "3) ESP validates, ACKs with 0x5A, publishes e.g. ST-03,7 to MQTT diagnostics\n"
        "4) Cloud/UI maps ST-03 via this workbook to human text\n\n"
        "0x5B is NOT an error-code stream — it carries integer health + UI context "
        "(heap, stacks, battery, MCU die °C, screen, button). Every 0x5B packet includes full health fields "
        "(never empty), whether kind=0 (timer) or kind=1 (UI event)."
    )
    ws["A16"].alignment = Alignment(wrap_text=True, vertical="top")
    ws["A16"].fill = PatternFill("solid", fgColor=LIGHT_GRAY)
    for rr in range(16, 20):
        ws.row_dimensions[rr].height = 18

    ws.cell(21, 1, "Implemented column key").font = Font(
        name="Calibri", bold=True, size=12, color=NAVY
    )
    ws.cell(22, 1, "Status")
    ws.cell(22, 2, "Meaning")
    style_header(ws, 22, 2)
    impl_key = [
        ("Yes", "Wired in DATACOLLCTION_FINAL STM firmware today"),
        ("Partial", "Some sites wired / not full codebook path"),
        ("Doc only", "Defined in architecture; not yet STM_Diag_Report'd"),
        ("Retired", "Must never be emitted"),
    ]
    for i, (k, v) in enumerate(impl_key, 23):
        ws.cell(i, 1, k)
        ws.cell(i, 2, v)
        style_row(ws, i, 2)
        ws.cell(i, 1).fill = IMPL_FILL[k]
        ws.cell(i, 1).font = Font(
            name="Calibri",
            bold=True,
            color=WHITE if k != "Partial" else DARK,
            size=10,
        )
        ws.cell(i, 1).alignment = Alignment(horizontal="center", vertical="center")
    autosize(ws, [24, 72, 14, 22, 36])

    # ---- Alert codes ----
    ws2 = wb.create_sheet("02_Alert_Codes_0x59")
    title_block(
        ws2,
        "CMD 0x59 — Alert / Error Codebook",
        "Compact fault codes STM → ESP → MQTT. Display as FAMILY-CODE (e.g. SS-22). "
        "Severity is fixed here (not on the wire).",
        11,
    )
    headers2 = [
        "Family", "Family ID", "Code", "Code ID", "Severity",
        "Meaning (what it means)", "Example (what you see / when)",
        "Clears when", "Implemented (STM)", "Wire CMD", "Cloud-style text",
    ]
    for i, h in enumerate(headers2, 1):
        ws2.cell(4, i, h)
    style_header(ws2, 4, 11)

    for r, row in enumerate(codes, 5):
        fam, fam_id, code, code_id, sev, meaning, example, clear, impl, cmd = row
        cloud = f"{code}: {meaning}"
        vals = [fam, fam_id, code, code_id, sev, meaning, example, clear, impl, cmd, cloud]
        for c, v in enumerate(vals, 1):
            ws2.cell(r, c, v)
        for c in range(1, 12):
            cell = ws2.cell(r, c)
            cell.font = Font(name="Calibri", size=10, color=DARK)
            cell.alignment = Alignment(vertical="center", wrap_text=True)
            cell.border = thin
            if r % 2 == 0:
                cell.fill = PatternFill("solid", fgColor=ROW_ALT)
        ws2.row_dimensions[r].height = 36
        if fam in FAMILY_FILLS:
            ws2.cell(r, 1).fill = FAMILY_FILLS[fam]
            ws2.cell(r, 1).font = Font(name="Calibri", bold=True, size=10, color=WHITE)
            ws2.cell(r, 1).alignment = Alignment(horizontal="center", vertical="center")
        if sev in SEV_FILL:
            ws2.cell(r, 5).fill = SEV_FILL[sev]
            ws2.cell(r, 5).font = Font(name="Calibri", bold=True, size=9, color=WHITE)
            ws2.cell(r, 5).alignment = Alignment(horizontal="center", vertical="center")
        if impl in IMPL_FILL:
            ws2.cell(r, 9).fill = IMPL_FILL[impl]
            ws2.cell(r, 9).font = Font(
                name="Calibri",
                bold=True,
                size=9,
                color=WHITE if impl in ("Yes", "Retired") else DARK,
            )
            ws2.cell(r, 9).alignment = Alignment(horizontal="center", vertical="center")
        ws2.cell(r, 3).font = Font(name="Calibri", bold=True, size=10, color=NAVY)

    autosize(ws2, [10, 11, 10, 10, 11, 48, 42, 28, 16, 10, 52])
    ws2.auto_filter.ref = f"A4:K{4 + len(codes)}"

    # ---- Families ----
    ws3 = wb.create_sheet("03_Families")
    title_block(
        ws3,
        "Family Registry",
        "STM family IDs 0x01–0x0F. ESP reserves 0x10–0x17 — STM must never use them.",
        5,
    )
    for i, h in enumerate(["Family", "Wire ID", "Owner / scope", "On-wire example", "Notes"], 1):
        ws3.cell(4, i, h)
    style_header(ws3, 4, 5)
    families = [
        ("ST", "0x01", "Framing / command contract", "0x01/0x03 = ST-03", "Checksum, LEN, END, unknown CMD"),
        ("SU", "0x02", "USART3 STM↔ESP link", "SU-01 ORE", "UART HW errors + TX/RX queue"),
        ("SA", "0x03", "Audio / SPI transport", "SA-01 SPI fail", "SPI2 PCM path to ESP"),
        ("SF", "0x04", "Stream / app flow", "SF-03 START fail", "START/STOP handshake"),
        ("SC", "0x05", "Cloud / WiFi via ESP", "SC-10 WiFi down", "0x55/0x58/WIFI/RSSI"),
        ("SS", "0x06", "STM runtime", "SS-22 Esp32 stack", "Faults + heap/stack watermarks"),
        ("SO", "0x07", "OTA over UART", "SO-03 OTA TX fail", "OTA phases"),
        ("PW", "0x08", "MP2722 / battery / NTC", "PW-01 charger NACK", "Charger fault bits"),
        ("IB", "0x09", "I2C bus infrastructure", "IB-21 I2C4 BERR", "Controller errors, not device NACK"),
        ("TM", "0x0A", "Temperature probes", "TM-01 no probe", "TMP117 / MLX90614 / MLX90632"),
        ("AH", "0x0B", "DAC / SAI / MDF / mics", "AH-01 DAC NACK", "Local audio HW"),
        ("DP", "0x0C", "ST7789V2 display", "DP-01 init fail", "SPI1 display path"),
        ("FM", "0x0D", "External flash MX25", "FM-03 JEDEC mismatch", "Not used for diag persistence"),
        ("UB", "0x0E", "USB host / SpO2", "UB-03 wrong PID", "CDC SpO2 probe"),
        ("IO", "0x0F", "Buttons / GPIO / rails", "IO-10 stuck key", "Logical GPIO checks"),
    ]
    for r, row in enumerate(families, 5):
        for c, v in enumerate(row, 1):
            ws3.cell(r, c, v)
        style_row(ws3, r, 5, alt=(r % 2 == 0))
        fam = row[0]
        ws3.cell(r, 1).fill = FAMILY_FILLS[fam]
        ws3.cell(r, 1).font = Font(name="Calibri", bold=True, color=WHITE, size=11)
        ws3.cell(r, 1).alignment = Alignment(horizontal="center", vertical="center")
    autosize(ws3, [10, 10, 28, 24, 40])

    # ---- 0x5B fields ----
    ws4 = wb.create_sheet("04_Status_0x5B_Fields")
    title_block(
        ws4,
        "CMD 0x5B — Health / UI Status Payload (74 bytes)",
        "Same packet for health (kind=0) and UI events (kind=1). All integers LE. No floats. No ACK. "
        "Health fields are ALWAYS filled — never empty on UI events. LEN=0x4C.",
        7,
    )
    for i, h in enumerate(
        ["Offset", "Type", "Field name", "Units / enum", "Example value",
         "ESP decode / text example", "Notes"],
        1,
    ):
        ws4.cell(4, i, h)
    style_header(ws4, 4, 7)
    fields = [
        (0, "u16", "session_id", "boot session (same as 0x59)", "0x1234", "session=4660", "LE"),
        (2, "u16", "seq", "status sequence", "1", "seq=1", "Independent of alert seq"),
        (4, "u8", "kind", "0=health, 1=UI", "0", "type=health", "Timer vs event"),
        (5, "u8", "screen", "0..10 ScreenState", "2", "screen=Home", "See sheet 05"),
        (6, "u8", "wifi_status", "0 Connecting, 1 Connected, 2 Error", "1", "wifi=Connected", "Wifistatus"),
        (7, "u8", "wifi_rssi_cat", "1..5 bars (5=no signal)", "2", "rssi_bars=2", "wifistength"),
        (8, "u8", "mqtt", "0/1", "1", "mqtt=connected", "mqttConnected"),
        (9, "u8", "audio_streaming", "0/1", "0", "streaming=no", "audioStreamStart"),
        (10, "u8", "audio_type", "currentAudioTypeCode", "0", "audio_type=0", "Heart/lung codes"),
        (11, "u8", "button", "255=none, 0..6 keys", "255", "button=none", "See sheet 05"),
        (12, "u8", "action", "0 none, 1 enter, 10..50 actions", "0", "action=none", "See sheet 05"),
        (13, "u8", "button_age_s", "seconds since last UI (cap 255)", "0", "button_age_s=0", ""),
        (14, "u32", "heap_total_B", "bytes", "150000", "heap_total=150000 B", "configTOTAL_HEAP_SIZE"),
        (18, "u32", "heap_free_B", "bytes", "52000", "heap_free=52000 B", "xPortGetFreeHeapSize"),
        (22, "u32", "heap_used_B", "bytes", "98000", "heap_used=98000 B", "total−free"),
        (26, "u8", "heap_pct", "0..100 %", "65", "heap=65%", "Integer percent"),
        (27, "u32", "upload_kbps", "kb/s", "0", "upload=0 kb/s", "During stream"),
        (31, "u8", "mqtt_q_pct", "0..100 %", "0", "mqtt_q=0%", "From ESP RSSI metrics"),
        (32, "u8", "ring_pct", "0..100 %", "0", "ring=0%", ""),
        (33, "u16", "jitter_mad_ms", "ms", "0", "jitter_mad=0 ms", ""),
        (35, "u16", "esp32_used_B", "bytes", "2100", "Esp32Task used=2100 B", "HWM-derived"),
        (37, "u16", "esp32_total_B", "bytes", "8192", "Esp32Task total=8192 B", ""),
        (39, "u16", "gui_used_B", "bytes", "2800", "guiTask used=2800 B", ""),
        (41, "u16", "gui_total_B", "bytes", "6000", "guiTask total=6000 B", ""),
        (43, "u16", "audio_used_B", "bytes", "200", "audioTask used=200 B", ""),
        (45, "u16", "audio_total_B", "bytes", "612", "audioTask total=612 B", ""),
        (47, "u16", "usb_used_B", "bytes", "1200", "USB_Task used=1200 B", ""),
        (49, "u16", "usb_total_B", "bytes", "8192", "USB_Task total=8192 B", ""),
        (51, "u16", "temp1_used_B", "bytes", "4000", "temp1Task used=4000 B", ""),
        (53, "u16", "temp1_total_B", "bytes", "40000", "temp1Task total=40000 B", ""),
        (55, "u16", "vitals_used_B", "bytes", "3500", "Vitals used=3500 B", ""),
        (57, "u16", "vitals_total_B", "bytes", "24576", "Vitals total=24576 B", ""),
        (59, "u16", "mp2722_used_B", "bytes", "400", "MP2722 used=400 B", ""),
        (61, "u16", "mp2722_total_B", "bytes", "1024", "MP2722 total=1024 B", ""),
        (63, "u32", "heap_min_free_B", "bytes", "77448", "heap_min_free=77448 B", "xPortGetMinimumEverFreeHeapSize"),
        (67, "u8", "battery_pct", "0..100 %", "78", "batt=78%", "Battery_GetPercent"),
        (68, "u8", "battery_chg", "0 idle, 1 charging, 2 complete", "1", "batt_chg=charging", "MP2722 CHARGING_*"),
        (69, "u16", "battery_mV", "millivolts", "3850", "batt_mV=3850", "Battery_GetVoltage*1000"),
        (71, "i16", "mcu_temp_c", "°C (signed)", "35", "mcu_temp=35C", "ADC1 die TS; 0 if ok=0"),
        (73, "u8", "mcu_temp_ok", "0 fail, 1 ok", "1", "mcu_temp_ok=1", "Last McuTemp_Poll"),
    ]
    for r, row in enumerate(fields, 5):
        for c, v in enumerate(row, 1):
            ws4.cell(r, c, v)
        for c in range(1, 8):
            cell = ws4.cell(r, c)
            cell.font = Font(name="Calibri", size=10, color=DARK)
            cell.alignment = Alignment(vertical="center", wrap_text=True)
            cell.border = thin
            if r % 2 == 0:
                cell.fill = PatternFill("solid", fgColor=ROW_ALT)
        ws4.row_dimensions[r].height = 28
        ws4.cell(r, 1).fill = PatternFill("solid", fgColor=LIGHT_TEAL)
        ws4.cell(r, 1).alignment = Alignment(horizontal="center", vertical="center")
        ws4.cell(r, 3).font = Font(name="Calibri", bold=True, size=10, color=TEAL)
    autosize(ws4, [10, 8, 18, 36, 16, 36, 28])
    ws4.auto_filter.ref = f"A4:G{4 + len(fields)}"

    note_row = 5 + len(fields) + 1
    ws4.cell(note_row, 1, "LEN rule").font = Font(bold=True, color=NAVY, size=11)
    ws4.merge_cells(
        start_row=note_row + 1, start_column=1, end_row=note_row + 2, end_column=7
    )
    ws4.cell(
        note_row + 1,
        1,
        "Frame: [AA][LEN=0x4C][5B][74-byte payload][XOR][55].  "
        "LEN = CMD(1)+payload(74)+checksum(1)=76=0x4C.  START/END not in LEN.  "
        "XOR = 0x5B ⊕ all 74 payload bytes.  "
        "Battery: offset 67 pct, 68 chg (0/1/2), 69 mV.  "
        "MCU die temp: offset 71 i16 °C, 73 ok (0/1) from ADC1 internal TS.  "
        "Related alert codes for heap/stack thresholds: SS-20..SS-28 on CMD 0x59 "
        "(only on cross/clear — continuous numbers live here on 0x5B).",
    )
    ws4.cell(note_row + 1, 1).alignment = Alignment(wrap_text=True)
    ws4.cell(note_row + 1, 1).fill = PatternFill("solid", fgColor=LIGHT_YELLOW)

    # ---- Enums ----
    ws5 = wb.create_sheet("05_Screen_Button_Action")
    title_block(
        ws5,
        "0x5B Enumerations — Screen / Button / Action",
        "ESP/cloud should map these integers to display text. Action codes are immutable once released.",
        5,
    )
    ws5.cell(4, 1, "SCREENS").font = Font(bold=True, size=12, color=NAVY)
    for i, x in enumerate(["Value", "Name", "UI meaning", "Typical when", ""], 1):
        ws5.cell(5, i, x)
    style_header(ws5, 5, 5)
    screens = [
        (0, "LOGO", "Boot logo", "Power on", ""),
        (1, "WIFI_Connect", "Connecting to WiFi", "Provisioning / connect", ""),
        (2, "Home", "Home landing", "After WiFi / nav home", ""),
        (3, "WIFI_QR", "WiFi QR / provisioning", "QR screen", ""),
        (4, "TempProbe", "Temperature probe prompt", "Start temp flow", ""),
        (5, "TempProcess", "Taking temperature", "Measuring", ""),
        (6, "TempResult", "Temperature result", "Show/save temp", ""),
        (7, "ManualID", "Manual pet ID entry", "ID entry", ""),
        (8, "Examination", "Exam mode select", "Heart/lung/temp/spo2", ""),
        (9, "Auscultation", "Auscultation / stream UI", "Recording audio", ""),
        (10, "Charging", "Charging screen", "On charger", ""),
    ]
    for r, row in enumerate(screens, 6):
        for c, v in enumerate(row, 1):
            ws5.cell(r, c, v)
        style_row(ws5, r, 5, alt=(r % 2 == 0))
        ws5.cell(r, 1).fill = PatternFill("solid", fgColor=LIGHT_BLUE)
        ws5.cell(r, 1).alignment = Alignment(horizontal="center")

    ws5.cell(18, 1, "BUTTONS").font = Font(bold=True, size=12, color=NAVY)
    for i, x in enumerate(["Value", "Key", "Hardware map", "Notes", ""], 1):
        ws5.cell(19, i, x)
    style_header(ws5, 19, 5)
    buttons = [
        (255, "none", "—", "Health packet / no press", ""),
        (0, "select", "Center / select", "Most actions", ""),
        (1, "up", "PE8", "Nav", ""),
        (2, "right", "PE11", "Nav", ""),
        (3, "down", "PD10", "Nav", ""),
        (4, "left", "PE3", "Nav", ""),
        (5, "back", "PB2", "Back / exit", ""),
        (6, "home", "PB7", "Home", ""),
    ]
    for r, row in enumerate(buttons, 20):
        for c, v in enumerate(row, 1):
            ws5.cell(r, c, v)
        style_row(ws5, r, 5, alt=(r % 2 == 0))
        ws5.cell(r, 1).fill = PatternFill("solid", fgColor=LIGHT_ORANGE)
        ws5.cell(r, 1).alignment = Alignment(horizontal="center")

    ws5.cell(30, 1, "ACTIONS").font = Font(bold=True, size=12, color=NAVY)
    for i, x in enumerate(["Value", "Name", "Meaning", "Example log line", ""], 1):
        ws5.cell(31, i, x)
    style_header(ws5, 31, 5)
    actions = [
        (0, "none", "No named action (pure health or unmapped key)", "action=none", ""),
        (1, "screen_enter", "Entered a new screen", "UI screen_enter screen=Home", ""),
        (10, "home_select", "Home: select / enter", "UI Home select", ""),
        (11, "home_back", "Home: back/home", "UI Home back", ""),
        (20, "exam_select", "Examination: select mode", "UI Exam select heart", ""),
        (30, "temp_sample", "Temp process: take sample", "UI Temp sample", ""),
        (31, "temp_save", "Temp result: save/upload", "UI Temp save", ""),
        (40, "stream_start", "Auscultation: start stream", "UI stream_start", ""),
        (41, "stream_stop", "Auscultation: stop/save", "UI stream_stop", ""),
        (42, "aus_back", "Auscultation: back/exit", "UI aus back", ""),
        (50, "qr_nav", "QR/WiFi: home/back nav", "UI QR nav", ""),
    ]
    for r, row in enumerate(actions, 32):
        for c, v in enumerate(row, 1):
            ws5.cell(r, c, v)
        style_row(ws5, r, 5, alt=(r % 2 == 0))
        ws5.cell(r, 1).fill = PatternFill("solid", fgColor=LIGHT_PURPLE)
        ws5.cell(r, 1).alignment = Alignment(horizontal="center")
    autosize(ws5, [10, 16, 48, 36, 8])

    # ---- Wire examples ----
    ws6 = wb.create_sheet("06_Wire_Examples")
    title_block(ws6, "Wire Frame Examples", "Use these to lock ESP parser bring-up.", 4)
    for i, h in enumerate(["Name", "Hex (spaces) / value", "Decoded meaning", "Notes"], 1):
        ws6.cell(4, i, h)
    style_header(ws6, 4, 4)
    examples = [
        (
            "0x59 alert ST-03×7",
            "AA 0D 59 01 03 07 34 12 01 00 00 00 00 00 7B 55",
            "family=ST(01) code=03 repeat=7 session=0x1234 seq=1 age=0 → ST-03,7",
            "LEN=0x0D = 1+11+1; XOR verified",
        ),
        (
            "0x5A ACK accepted",
            "AA 07 5A 34 12 01 00 01 7C 55",
            "ACK session=0x1234 seq=1 status=01 (accepted)",
            "ESP→STM; STM dequeues",
        ),
        (
            "0x5A status meanings",
            "01=accepted  02=duplicate  03=invalid  04=busy",
            "STM: 01/02 remove; 03 drop; 04/timeout retry",
            "No ACK for malformed frames",
        ),
        (
            "0x5B health sample (synthetic)",
            "AA 4C 5B … [74-byte LE payload: batt@67 + mcu_temp@71] … XOR 55",
            "kind=0; 67=batt%, 68=chg, 69=mV, 71=mcu_temp_c i16, 73=ok",
            "LEN=0x4C; 79 bytes on wire; ESP must accept 0x4C",
        ),
        (
            "LEN rule (all CMDs)",
            "LEN = CMD + payload + checksum   (START/END excluded)",
            "0x59 → LEN 0x0D;  0x5A → LEN 0x07;  0x5B → LEN 0x4C",
            "payload_len = LEN - 2",
        ),
    ]
    for r, row in enumerate(examples, 5):
        for c, v in enumerate(row, 1):
            ws6.cell(r, c, v)
        style_row(ws6, r, 4)
        ws6.row_dimensions[r].height = 52
        ws6.cell(r, 1).fill = PatternFill("solid", fgColor=LIGHT_TEAL)
        ws6.cell(r, 1).font = Font(bold=True, size=10, color=TEAL)
    autosize(ws6, [30, 72, 55, 30])

    ws6.cell(12, 1, "0x5A ACK status byte").font = Font(bold=True, size=12, color=NAVY)
    for i, h in enumerate(["Status", "Name", "STM action", "ESP meaning"], 1):
        ws6.cell(13, i, h)
    style_header(ws6, 13, 4)
    acks = [
        ("0x01", "ACCEPTED", "Remove event from queue", "Cloud PUBACK or offline flash committed"),
        ("0x02", "DUPLICATE", "Remove event", "Already accepted session+seq"),
        ("0x03", "INVALID", "Drop / quarantine — do not retry forever", "Contract violation"),
        ("0x04", "BUSY", "Keep + retry with backoff", "ESP busy / storage failure"),
    ]
    ack_fills = [
        IMPL_FILL["Yes"],
        PatternFill("solid", fgColor="3498DB"),
        SEV_FILL["ERROR"],
        SEV_FILL["WARN"],
    ]
    for r, row in enumerate(acks, 14):
        for c, v in enumerate(row, 1):
            ws6.cell(r, c, v)
        style_row(ws6, r, 4, alt=(r % 2 == 0))
        ws6.cell(r, 1).fill = ack_fills[r - 14]
        ws6.cell(r, 1).font = Font(bold=True, color=WHITE, size=10)
        ws6.cell(r, 1).alignment = Alignment(horizontal="center", vertical="center")

    # ---- Flow rates ----
    ws7 = wb.create_sheet("07_Flow_Rates")
    title_block(
        ws7,
        "What is sent when — rates & dual channel",
        "UI events are edge-triggered. Health is periodic. Both use full 0x5B payload "
        "(health fields never empty on screen-change packets).",
        5,
    )
    for i, h in enumerate(
        ["Event", "CMD", "kind", "When / rate", "What ESP should expect"], 1
    ):
        ws7.cell(4, i, h)
    style_header(ws7, 4, 5)
    flows = [
        ("Fault / watermark", "0x59", "n/a", "On threshold cross / clear only", "ST-xx / SS-20..28 etc + 0x5A ACK"),
        ("Health idle", "0x5B", "0", "Every 5 seconds (not streaming)", "Full snapshot; screen=current; button often 255"),
        ("Health streaming", "0x5B", "0", "Every 10 seconds (audio streaming)", "Same + upload_kbps / q / ring filled"),
        ("Health on stream edge", "0x5B", "0", "Once right after stream start/stop", "Forced extra health"),
        ("Screen enter", "0x5B", "1", "Immediate on ScreenState change", "action=1; new screen; full heap/wifi still filled"),
        ("Button press", "0x5B", "1", "Immediate (debounced ~150ms)", "button=0..6 + mapped action"),
        ("Stream start/stop", "0x5B", "1", "Immediate from Model", "action=40 then 41"),
    ]
    for r, row in enumerate(flows, 5):
        for c, v in enumerate(row, 1):
            ws7.cell(r, c, v)
        style_row(ws7, r, 5, alt=(r % 2 == 0))
        if row[1] == "0x59":
            ws7.cell(r, 2).fill = PatternFill("solid", fgColor="E74C3C")
        else:
            ws7.cell(r, 2).fill = PatternFill("solid", fgColor=TEAL)
        ws7.cell(r, 2).font = Font(bold=True, color=WHITE)
        ws7.cell(r, 2).alignment = Alignment(horizontal="center", vertical="center")

    ws7.cell(14, 1, "Example timeline").font = Font(bold=True, size=12, color=NAVY)
    ws7.merge_cells("A15:E21")
    ws7["A15"] = (
        "t=0.5s   HEALTH kind=0  screen=LOGO     (first health soon after boot)\n"
        "t=1.0s   UI     kind=1  screen=Home action=1   (screen change — FULL data, not empty)\n"
        "t=1.5s   UI     kind=1  screen=Exam action=1\n"
        "t=2.0s   UI     kind=1  button=select action=20\n"
        "t=5.5s   HEALTH kind=0  screen=Exam            (5s idle timer)\n"
        "t=6.0s   UI     kind=1  screen=Aus action=1\n"
        "t=6.2s   UI     kind=1  action=40 stream_start + HEALTH kind=0 (forced)\n"
        "t=16.2s  HEALTH kind=0  streaming=1            (10s while streaming)\n"
        "t=20.0s  UI     kind=1  action=41 stream_stop  + HEALTH kind=0"
    )
    ws7["A15"].alignment = Alignment(wrap_text=True, vertical="top")
    ws7["A15"].fill = PatternFill("solid", fgColor=LIGHT_GRAY)
    ws7["A15"].font = Font(name="Consolas", size=10, color=DARK)
    for rr in range(15, 22):
        ws7.row_dimensions[rr].height = 15
    autosize(ws7, [24, 10, 10, 42, 52])

    # ---- Severity legend ----
    ws8 = wb.create_sheet("08_Severity_Legend")
    title_block(
        ws8,
        "Severity & Color Legend",
        "Severity is fixed per code in the codebook — it is NOT transmitted in the 0x59 frame.",
        3,
    )
    for i, h in enumerate(["Severity", "Meaning for operators", "Typical response"], 1):
        ws8.cell(4, i, h)
    style_header(ws8, 4, 3)
    sevs = [
        ("CRITICAL", "Device/runtime may be unsafe or unusable", "Immediate attention; may need reboot/RMA"),
        ("ERROR", "Feature failed; user flow likely broken", "Investigate; often recoverable"),
        ("WARN", "Degraded / early warning", "Monitor; may clear with hysteresis"),
        ("INFO", "Informational (ACK statuses etc.)", "Normal protocol signalling"),
        ("Retired", "Must never be emitted", "Ignore / reject if seen"),
    ]
    for r, row in enumerate(sevs, 5):
        for c, v in enumerate(row, 1):
            ws8.cell(r, c, v)
        style_row(ws8, r, 3)
        key = row[0]
        if key in SEV_FILL:
            ws8.cell(r, 1).fill = SEV_FILL[key]
        ws8.cell(r, 1).font = Font(bold=True, color=WHITE, size=11)
        ws8.cell(r, 1).alignment = Alignment(horizontal="center", vertical="center")

    ws8.cell(12, 1, "Family color key (sheet 02 column Family)").font = Font(
        bold=True, size=12, color=NAVY
    )
    ws8.cell(13, 1, "Family")
    ws8.cell(13, 2, "Color meaning")
    style_header(ws8, 13, 2)
    r = 14
    for fam, fill in FAMILY_FILLS.items():
        ws8.cell(r, 1, fam)
        ws8.cell(r, 2, f"{FAM[fam]} — see Families sheet")
        style_row(ws8, r, 2)
        ws8.cell(r, 1).fill = fill
        ws8.cell(r, 1).font = Font(bold=True, color=WHITE)
        ws8.cell(r, 1).alignment = Alignment(horizontal="center")
        r += 1
    autosize(ws8, [14, 48, 40])

    tab_colors = {
        "01_Overview": NAVY,
        "02_Alert_Codes_0x59": "C0392B",
        "03_Families": "2980B9",
        "04_Status_0x5B_Fields": TEAL,
        "05_Screen_Button_Action": "8E44AD",
        "06_Wire_Examples": "27AE60",
        "07_Flow_Rates": "E67E22",
        "08_Severity_Legend": "7F8C8D",
    }
    for name, color in tab_colors.items():
        wb[name].sheet_view.showGridLines = False
        wb[name].page_margins = PageMargins(left=0.4, right=0.4, top=0.5, bottom=0.5)
        wb[name].sheet_properties.tabColor = color

    wb.save(OUT)
    print("Wrote", OUT)
    print("Alert codes:", len(codes))
    print("0x5B fields:", len(fields))


if __name__ == "__main__":
    main()
