# ESP log decode essentials

Snapshot of docs/codebooks for decoding ESP HTTPS diagnostic buckets  
(**current flow**: PM-01…49, SD-01…19 / 0x5B V4 74 B, ~10 s health, eFuse-corrected chip temp).

## Start here (order)

| Priority | File | Use for |
|----------|------|---------|
| 1 | `DIAG_HTTPS_SERVER_API.md` | Bucket layout, 16-byte record, headers, PM/SD decode rules |
| 2 | `DIAG_SERVER_REGISTRY.md` | Full code table + **CSV seed** for server DB |
| 3 | `ESP_ERROR_BOOK_REGISTER.md` / `.docx` | Compact error/metrics register |
| 4 | `ESP_Diagnostic_Codebook.xlsx` | ESP-only colored codebook (alerts + PM + SD) |
| 5 | `DIAG_CODEBOOK_END_TO_END.xlsx` | Combined end-to-end codebook |
| 6 | `COMPONENT_DIAGNOSTIC_ANALYSIS.md` | Architecture / flow context |
| 7 | `changes_02_10_26.md` | What changed (V4, PM-49, eFuse calib, 10 s) |

## Quick decode reminders

- Upload body = **32768** bytes, schema `bucket-v1`, records **16 bytes** each.
- **PM-49** = ESP die °C as signed centi-°C (`value/100`). Already eFuse-corrected on device.
- **SD-01…19** = one STM `0x5B` V4 frame; same `event_time_s`; concat → **74** bytes.
- Ignore STM `mcu_temp_c` when `mcu_temp_ok == 0`.

## Not included (firmware only)

ESP-IDF sources under `main/` — not required for server-side decode if you have this pack.
