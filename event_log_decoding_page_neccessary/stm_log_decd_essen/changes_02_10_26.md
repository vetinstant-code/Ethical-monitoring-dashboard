# Changes — 02 Oct 2026 (`changes_02_10_26`)

STM→ESP diagnostic logging (CMD `0x59` / ACK `0x5A`) in **VETINSTANT_DATACOLLCTION_FINAL**.

## Docs copied
- Copied `COMPONENT_DIAGNOSTIC_ANALYSIS.md` from `VETINSTANT_EXAMD_FINAL` into this tree (architecture contract + codebook).
- **Updated both trees’** `COMPONENT_DIAGNOSTIC_ANALYSIS.md` SS section with `SS-20`…`SS-28` (heap/stack watermarks + per-task identity).

## UART print silence
- Added `STM_DISABLE_USART2_PRINTF 1` in `VETINSTANT/Core/Inc/main.h`.
- `_write()` in `main.c` returns immediately when the gate is on (no USART2/ITM text). Binary USART2 audio export (`ENABLE_UART_AUDIO_TX`) is unaffected.
- Boot `printf("app:...")` and other text prints are effectively silenced via `_write`.

## Diagnostic core
- Added `VETINSTANT/Core/Inc/stm_diag.h` and `VETINSTANT/Core/Src/stm_diag.c`:
  - Families `ST`…`IO`, high-value code IDs
  - RAM ring queue (depth 32), active-code dedup + repeat
  - Boot-unique session ID, monotonic sequence
  - Builds CMD `0x59` LEN `0x0D` (11-byte payload + XOR)
  - ACK `0x5A` handling (`01/02` dequeue, `03` drop, `04`/timeout retry)
  - Bounded TX attempts (40) then drop head; **re-enqueue on next Report** if code still active (fixed pre-flash review)
  - OTA pause via `STM_Diag_SetUartPaused`
- Listed `stm_diag.c` in `Debug/Core/Src/subdir.mk` (CubeIDE also auto-picks `Core/` source path).

## Protocol wiring
- `ESP32Task.h`: `CMD_STM_DIAGNOSTIC 0x59`, `CMD_STM_DIAGNOSTIC_ACK 0x5A`
- `ESP32task.c`:
  - `#include "stm_diag.h"`
  - `STM_Diag_Init()` at Esp32Task start
  - `STM_Diag_Process()` from `ESP32_DrainPendingPacket`
  - Parse `0x5A` ACK in `process_received_packet`
  - Pause diagnostics on STM/ESP OTA start; resume on `clear_esp_ota_success`

## Instrumentation sites (this pass)
| Family | Sites |
|--------|--------|
| ST | invalid LEN, END, checksum, RX overflow, unknown CMD |
| SU | USART3 ORE/FE/NE/PE/RTOF in RX callback |
| SF | audio START/STOP control response failure |
| SC | WiFi disconnect/error; cloud warn UNSTABLE/DOWN; temp cloud ACK fail/malformed |
| SA | SPI2 audio `esp_spi_transmit` HAL fail/timeout |
| UB | wrong PID, disconnect during flow, CDC TX/RX fail/timeout, malformed SpO2 packet |
| TM | no probe when measure requested; TMP117 read fail |
| PW | MP2722 I2C fail + REG12/13/14 fault decode on status read |
| SS | `Error_Handler`, FreeRTOS stack-overflow hook |
| SO | OTA start UART TX failure |

## Frame sanity
Doc example `ST-03,7` session `0x1234` seq `1` age `0`:

`AA 0D 59 01 03 07 34 12 01 00 00 00 00 00 7B 55` — XOR verified match.

`STM_Diag_Init()` is also called from `main` before `MX_FREERTOS_Init` (and again safely from Esp32Task).

## STM performance watermarks (SS-20..28)
STM-side only metrics (ESP just forwards codes like any other `0x59`):

| Code | Meaning | Set | Clear (hysteresis) |
|------|---------|-----|--------------------|
| SS-20 | FreeRTOS heap used ≥ 80% | 80% | ≤ 70% |
| SS-21 | FreeRTOS heap used ≥ 90% | 90% | ≤ 70% |
| SS-22 | **Esp32Task** stack ≥ 80% | 80% | ≤ 70% |
| SS-23 | **guiTask** (TouchGFX) stack ≥ 80% | 80% | ≤ 70% |
| SS-24 | **audioTask** stack ≥ 80% | 80% | ≤ 70% |
| SS-25 | **USB_Task** stack ≥ 80% | 80% | ≤ 70% |
| SS-26 | **temp1Task** stack ≥ 80% | 80% | ≤ 70% |
| SS-27 | **Vitals_Task** (SpO2) stack ≥ 80% | 80% | ≤ 70% |
| SS-28 | **MP2722Task** stack ≥ 80% | 80% | ≤ 70% |
| SS-07 | Hard stack overflow hook (+ matching SS-22..28 when task name known) | on fault | n/a |

- API: `STM_Diag_PerfPoll()` in `stm_diag.c`
- Polled ~every 2 s from `StartMP2722Task` (low priority)
- **Which task is bad = which code** (no task-name string on the wire)
- Not continuous telemetry — threshold cross/clear only

## Abnormal button presses — status
**IO-10/11 stuck-key anomaly codes still not implemented** (planned only). Normal button presses are now sent as `0x5B` UI events (see below).

## CMD `0x5B` health + UI status (implemented)
Dual channel on USART3 (same framing as other CMDs). **No ESP ACK.**

| Kind | When | Rate |
|------|------|------|
| Health (`kind=0`) | Timer + once on stream start/stop | **5 s** idle / **10 s** streaming |
| UI (`kind=1`) | Screen enter, button, stream action | Edge only (not polled) |

**Wire (current v4):** `AA 4C 5B` + 74-byte LE integer payload + XOR + `55` (`LEN=0x4C`).

**STM files:**
- `ESP32Task.h`: `CMD_STM_STATUS 0x5B`
- `stm_diag.h` / `stm_diag.c`: payload builder, UI ring (depth 8), `STM_Diag_NotifyScreenEnter/Button/Action`, health timer inside `STM_Diag_PerfPoll`
- `mcu_temp.h` / `mcu_temp.c`: ADC1 die temp → `0x5B` offsets 71–73
- `MyButtonController.cpp`: emit UI on delivered key
- `Model.cpp`: stream start/stop → action 40/41 + forced health

**Docs:** both trees’ `COMPONENT_DIAGNOSTIC_ANALYSIS.md` updated with full payload map + ESP verify checklist.

**Excel codebook (all codes + 0x5B decode):**  
`NEED_CHANGES/VETINSTANT_DATACOLLCTION_FINAL/STM_ESP_Diagnostic_Codebook.xlsx`  
(8 sheets: overview, all 0x59 codes with examples, families, 0x5B field map, screen/button/action enums, wire hex examples, flow rates, severity legend). Regenerate via `_gen_codebook_xlsx.py` if needed.

### ESP verify flow (quick)
1. Log every USART3 frame with `CMD==0x5B` (`LEN` must be `0x4C`).
2. Idle on Home: `kind=0` about every 5 s; `screen` matches UI; `button=255`.
3. Navigate screens quickly: `kind=1` with `action=1` (screen_enter) for each hop — not only the last screen.
4. Press Select on Home: `kind=1` `button=0` `action=10`.
5. Start auscultation stream: `kind=1` `action=40`, then a `kind=0` health soon after; while streaming health ~10 s; stop → `action=41` + health.
6. Compare `wifi_status` / `wifi_rssi_cat` / `mqtt` to ESP’s own state.
7. Decode `batt=%` / `chg` / `mV` and `mcu_temp=%dC ok=%d` from the tail of the payload.
8. Do **not** ACK `0x5B` with `0x5A`.

## 0x5B v2 — ESP-like heap watermark
Payload grew **63 → 67** bytes (`LEN=0x45`). New field at offset 63: `heap_min_free_B` = `xPortGetMinimumEverFreeHeapSize()` (same idea as ESP PM-02 min free heap). Current `heap_free_B` can stay flat on this firmware; **min_free** and **stack HWM** are the live pressure signals. **ESP decoder must accept LEN 0x45 and parse offset 63.**

## 0x5B v3 — battery percent / charge / mV
Payload grew **67 → 71** bytes (`LEN=0x49`). New fields:
- offset 67 `battery_pct` (u8, 0–100) from `Battery_GetPercent()`
- offset 68 `battery_chg` (u8: 0 idle, 1 charging, 2 complete) from MP2722 `CHARGING_STATUS` / `CHARGING_COMPLETE`
- offset 69 `battery_mV` (u16 LE) = `Battery_GetVoltage()*1000`

**ESP decoder must accept LEN `0x49` and log `batt=%d%% chg=%d mV=%d`.**

## 0x5B v4 — MCU die temperature
Payload grew **71 → 74** bytes (`LEN=0x4C`). New fields from ADC1 internal VREFINT + TEMPSENSOR (`mcu_temp.c`, polled with MP2722):
- offset 71 `mcu_temp_c` (i16 LE, °C) = `McuTemp_GetCelsius()` when OK, else `0`
- offset 73 `mcu_temp_ok` (u8: 0 fail, 1 ok)

Uses factory `TS_CAL1`/`TS_CAL2` + measured VREF via `__HAL_ADC_CALC_VREFANALOG_VOLTAGE` / `__HAL_ADC_CALC_TEMPERATURE` (not a fixed 3300 mV assumption).

**ESP decoder must accept LEN `0x4C` and log `mcu_temp=%dC ok=%d` (only trust °C when ok=1).**

## Anti-spam pass (high-risk codes)
Root fix: `STM_Diag_Report` no longer re-queues after ESP `0x5A` accept while code still active (only bumps repeat). Clears start a new episode.

| Code | Anti-spam behavior | Site |
|------|--------------------|------|
| SU-01…05 | Sticky Report; **Clear on next valid UART frame** | USART3 RX ISR |
| ST-03/01/02/04 | Sticky; Clear on valid frame | Parser |
| ST-05 | Mid-frame START resync; Clear on valid | Parser |
| SA-04 | Report on UART2 audio ring full; Clear on successful enqueue | `Audio_Uart2RingEnqueue` |
| SC-06 | Already edge Report/Clear on `0x58`; no re-queue spam | cloud warn |
| SC-14 / SC-16 | RSSI wait 3 s → SC-14; 3 misses → SC-16; Clear on RSSI resp | Esp32Task |
| AH-10/11/13 | MDF error callback sticky; Clear after ~2 s healthy mic energy | `HAL_MDF_ErrorCallback` + mic poll |
| AH-17 | Mic imbalance debounce 1.5 s set / 2 s clear | Process_Raw/Denoised |
| PW-04 | Already sticky bit; no re-queue spam | mp2722 |
| PW-14…21 | NTC zone map; Clear when zone leaves | mp2722 REG14 |
| PW-22 | DPM needs **5 consecutive** reads; Clear when DPM off | mp2722 REG11 |
| IO-10 | Stuck key **8 s** continuous hold; Clear on release | MyButtonController |
| SS-20 | Existing 80%/70% hysteresis | PerfPoll |

## Known gaps
- **ESP side** must still decode/forward `0x5B` (not in this STM tree).
- **ESP codebook** should list SS-20..28 so cloud UI can name them (wire format already works if ESP accepts any STM family/code).
- Full codebook rows (all AH/DP/FM/IO/… codes) not yet wired — headers define high-value IDs; remaining rows stay doc-only until later passes.
- HardFault/MemManage/etc. cannot reliably reach ESP (no NVM, no TX from exception context) — as documented in the architecture plan.
- Rebuild in CubeIDE (ARM GCC) required to verify link; frame XOR checked offline.
- Button anomaly codes (IO-10/11) documented only — not wired.
