# ESP Error / Metrics Book Register

Seed document for cloud DB + ops. Canonical tables also live in:

- [`DIAG_SERVER_REGISTRY.md`](DIAG_SERVER_REGISTRY.md) (CSV at bottom)
- [`DIAG_HTTPS_SERVER_API.md`](DIAG_HTTPS_SERVER_API.md)
- [`ESP_Diagnostic_Codebook.xlsx`](ESP_Diagnostic_Codebook.xlsx) / [`DIAG_CODEBOOK_END_TO_END.xlsx`](DIAG_CODEBOOK_END_TO_END.xlsx)

**Transport (unchanged):** 32 KB `bucket-v1` → many **16-byte** records → `POST /api/diag/events`.

---

## Wire families (ESP side)

| Family | Hex | Prefix | Role |
|--------|-----|--------|------|
| PR | `0x10` | PR | Provisioning / unknown CMD |
| UA | `0x11` | UA | UART / STM link |
| SP | `0x12` | SP | SPI / audio ring / packetizer |
| WF | `0x13` | WF | WiFi |
| TL | `0x14` | TL | DNS / TLS / AWS path |
| MQ | `0x15` | MQ | MQTT |
| ES | `0x16` | ES | System / heap thresholds |
| OT | `0x17` | OT | OTA |
| PM | `0x18` | PM | Continuous metrics (~10 s) |
| SD | `0x19` | SD | STM `0x5B` status dump chunks |

Readable code = `PREFIX` + `-` + decimal `code_id` (zero-padded 2 digits in docs).

Metric records: `flags & 0x04`; value = `source_session | (source_sequence << 16)` (LE u32).

---

## Continuous PM (PM-01…49)

Emitted every **~10 s** health cycle (+ some on WiFi/MQTT/DNS/TLS/PING events).

| Code | Unit | Meaning |
|------|------|---------|
| PM-01…03 | bytes | Free / min / largest heap |
| PM-04, 21–23, 41–48 | bytes | Per-task stack HWM |
| PM-05 | dBm | RSSI (signed) |
| PM-06 / 07 | count | WiFi / MQTT reconnects |
| PM-08 | s | Uptime |
| PM-09…13 | 0/1 | wifi / IP / internet / mqtt / reconnecting |
| PM-14 / 15 | index / hash | Network index / SSID FNV |
| PM-16 | ms | Ping RTT |
| PM-17…19 | count | Temp ACK q / outbox / event q |
| PM-20 | bytes | Internal RAM free |
| PM-24 | channel | WiFi channel |
| PM-25…27 | ms / 0/1 | DNS / TLS / AWS path |
| PM-28 | 0/1 | SNTP trusted |
| PM-29…37 | — | SSID length + 8× ASCII chunks |
| PM-38…40 | bytes / % | Heap total / used / % |
| **PM-49** | **centi-°C** | **ESP die temp (eFuse TEMP_CALIB corrected)** |

Decode PM-49: `(int32)value / 100.0` → °C.

### eFuse note (IDF 5.1.6)

Stock `esp_efuse_rtc_calib_get_tsens_val()` stubs to 0 on C6. Firmware reads `ESP_EFUSE_TEMP_CALIB` and applies `corrected = raw − delta/10` before PM-49 / health print.

---

## STM status dump (SD-01…19)

UART: `[AA][4C][5B][74 B][CHK][55]` — **V4 only**.

| Code | Payload bytes |
|------|----------------|
| SD-01…17 | `[0..67]` (through battery_pct) |
| SD-18 | `[68..71]` batt_chg, batt_mV, mcu_temp_c lo |
| SD-19 | `[72..73]` mcu_temp_c hi, mcu_temp_ok (+pad) |

Reassemble: same `event_time_s`, concat LE words SD-01…19 → first **74** bytes.  
Ignore `mcu_temp_c` when `mcu_temp_ok == 0`.

---

## Fault highlights (see registry for full list)

| Family | Codes | Notes |
|--------|-------|-------|
| ES-09…11 | heap / min-heap / mqtt stack HWM low | Hysteresis clears |
| TL-01…05 | DNS / TLS / AWS path | |
| MQ-01…10, MQ-23 | connect / CONNACK / send-recv / subscribe | |
| OT-01…17 | OTA HTTP / image / partition | |
| WF / UA / SP / PR | link / UART / SPI / provision | |

---

## Server seed checklist

1. Import CSV from [`DIAG_SERVER_REGISTRY.md`](DIAG_SERVER_REGISTRY.md) (includes PM-49, SD-19).
2. Rebuild SD frames with **19** chunks / **74** bytes.
3. Decode PM-49 as signed centi-°C (already corrected on device).
4. Health interval expectation: **~10 s** (flush poll still 15 s).

Generated companion: run `python docs/_gen_esp_only_codebook.py` and `python docs/_gen_esp_error_book_docx.py`.
