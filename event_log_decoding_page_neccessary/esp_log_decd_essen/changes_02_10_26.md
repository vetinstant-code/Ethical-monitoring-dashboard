# Changes — 02–03 Oct 2026 (`changes_02_10_26`)

Diagnostic architecture for ESP32-C6 (`ESP32_DAT_COL_NEW_07`).

---

## Summary

- ESP + STM codebook events → four **32 KB flash buckets** (128 KB `diag_log`) → **HTTPS** POST `bucket-v1`
- Cloud delivery is **HTTPS only** (not MQTT diagnostics topic)
- ESP metrics **PM-01…49** (heap/stacks/link/ping/DNS/TLS/**SSID**/chip temp) + **ES-09…11**
- STM **0x59** alerts (ACK 0x5A) + STM **0x5B** status → **SD-01…19** (74 B V4 + MCU temp) (no ACK)
- Live server verified with temporary dummy upload test (then **removed** to save flash)
- Console debug UART can be muted via `ESP_CONSOLE_DEBUG_LOGS` (STM UART unchanged)

---

## Architecture (current)

```
Failure / health / link / STM status
  → diag_report / diag_report_metric
     / STM 0x59 (ACK 0x5A)
     / STM 0x5B → SD-01..19
     / ESP PM-01..49 (SSID via PM-29..37, chip temp PM-49)
  → append 16-byte record(s) to active 32 KB flash bucket (order = log order)
  → when bucket full → seal → HTTPS POST 32768 bytes
  → HTTP 2xx → erase that bucket → continue filling next free (0..3)
  → BUSY only if all four sealed
```

Upload URL: `http://43.205.129.56:8000/api/diag/events`  
Headers: `Content-Type: application/octet-stream`, `X-Diag-Schema: bucket-v1`, `X-Device-Id` (= Thing name), `X-Bucket-Id`, `X-Bucket-Bytes`  
Success: **HTTP 204** (any 2xx) → erase local bucket.

Server API doc: [`docs/DIAG_HTTPS_SERVER_API.md`](DIAG_HTTPS_SERVER_API.md)  
**Server registry (enter codes):** [`docs/DIAG_SERVER_REGISTRY.md`](DIAG_SERVER_REGISTRY.md)  
**Excel codebook (all codes, colored tables):** [`docs/DIAG_CODEBOOK_END_TO_END.xlsx`](DIAG_CODEBOOK_END_TO_END.xlsx)

---

## Key files

| File | Purpose |
|------|---------|
| `main/device_identity.h` | **Single place** for Thing / device name (`AWS_IOT_OTA_THING_NAME`) → MQTT topics + `X-Device-Id` |
| `main/diag_https_config.h` | Events/coredump URLs, optional bearer |
| `main/esp_console_config.h/.c` | **`ESP_CONSOLE_DEBUG_LOGS`** 0/1 — mute console prints (not STM UART) |
| `main/diag_event.h` | 16-byte flash record + `DIAG_FLAG_METRIC` |
| `main/diag_registry.h/.c` | Families `0x01–0x18` (PM added) |
| `main/diag_manager.h/.c` | Queue, coalesce, flash own, HTTPS upload trigger |
| `main/diag_flash_ring.h/.c` | Four 32 KB buckets (`format_ver=3`) |
| `main/diag_cloud.h/.c` | HTTPS bucket POST |
| `main/diag_uart_bridge.h/.c` | STM `0x59` / ESP `0x5A` |
| `main/crash_dump_manager.*` | Core-dump HTTPS (URL optional) |
| `partitions.csv` | `diag_log` 128 KB @ `0x3D0000`, `coredump` 64 KB @ `0x3F0000` |

---

## Device identity

Edit only [`main/device_identity.h`](../main/device_identity.h):

```c
#define AWS_IOT_OTA_THING_NAME "ARCHIT"   // Bruno / Rocky / Zara / …
```

Used for MQTT client ID, `vetin/datacol/<id>/…`, and diagnostic `X-Device-Id`.

---

## UART bucket dump test (no HTTPS)

`main/diag_https_config.h`:

```c
#define DIAG_UART_BUCKET_DUMP  0   /* 1=print sealed 32 KB codes on UART, no upload; 0=HTTPS */
```

Same receive → flash store → seal flow. **Yes — after a 32 KB bucket fills and seals**, console UART prints only the diagnostic codes (via `esp_rom_uart_putc`, bypassing muted logs), then the bucket is erased so filling continues. Other app `ESP_LOG`/`printf` stay off (`ESP_CONSOLE_DEBUG_LOGS 0`).

Example UART output when sealed:

```text
DIAG_BUCKET id=0 records=2045 bytes=32768
E:PM-01 t=... v=...
E:MQ-07 t=... r=1
...
DIAG_BUCKET_END id=0
```

Set `DIAG_UART_BUCKET_DUMP` back to `0` for production HTTPS upload.

---

## Crash fix — FreeRTOS task name length (PM stack HWM)

**Symptom (field log):** boot → `app_main()` → assert panic loop:

```text
assert failed: xTaskGetHandle tasks.c:2958 (strlen( pcNameToQuery ) < 16)
  mqtt_diag_task_hwm_bytes → mqtt_diag_emit_perf_metrics → mqtt_diag_health_task
```

**Cause:** continuous PM per-task HWM called `xTaskGetHandle("audio_packetizer")` (and similar). FreeRTOS `CONFIG_FREERTOS_MAX_TASK_NAME_LEN=16` requires query name length **&lt; 16**; names like `audio_packetizer` / `mqtt_process_task` / `mqtt_health_task` are ≥16 and abort.

**Fix:** `mqtt_diag_task_hwm_bytes()` in `main/mqtt_diag.c` truncates the lookup name to `configMAX_TASK_NAME_LEN - 1` before `xTaskGetHandle` (matches how FreeRTOS stores long create-names).

---

## Console debug switch (STM UART untouched)

[`main/esp_console_config.h`](../main/esp_console_config.h):

```c
#define ESP_CONSOLE_DEBUG_LOGS  0   /* 0=silent console, 1=normal ESP_LOG/printf console */
```

Applied at start of `app_main()` via `esp_console_apply_log_policy()` (mutes `ESP_LOG*`).  
Also `#define printf(...)` to no-op in `app_main.c` / `mqtt_demo_mutual_auth.c` / `time_cache_debug.c` when logs are off (kills `Packet:` / `Raw data:` / `TIME_DEBUG` / `[MQTT]` printf spam).  
**Does not** disable the STM command UART (0xAA…0x55 packets).  
Bootloader lines (`I (23) boot:…`) still appear before `app_main`.

---

## Codes / metrics

| Family | Codes | Notes |
|--------|-------|--------|
| PR/UA/SP/WF | existing emit sites | Faults |
| **TL-01…05** | DNS / TLS probe / MQTT TLS / endpoint unreachable | Specific reachability |
| **MQ-01…10, MQ-23** | connect, CONNACK timeout, recv/send, NoMemory, keepalive, **subscribe fail**, **SUBACK reject**, illegal, refused | Specific MQTT |
| **OT-01…17** | HTTP status, flash write, NVS, STM transfer, **URL too long**, HTTP init/open/read, empty download, bad magic, task create, URL truncated, **URL alloc fail**, malformed job, finalize, size fetch, erase | Specific OTA |
| ES-01…08 | OOM / task / WDT / panic / brownout / coredump | |
| ES-09…11 | heap &lt;40KB / min&lt;32KB / stack HWM&lt;512B | hysteresis |
| **PM-01…49** (`0x18`) | heap/RAM/per-task stacks/link/ping/DNS/TLS + **SSID PM-29…37** + **chip temp PM-49** | ~10 s continuous + events |

Both buckets full offline → new writes pause until upload frees one.

App partition headroom after diag work: ~**7%** free (~137 KB) — keep growth tight.

---

## Temporary HTTPS test mode (removed after server OK)

Used once to verify the API without waiting ~4 h for a full bucket. **Removed from firmware** after successful `HTTP 204`. Kept here for history / re-enable if needed.

### What it did

- `DIAG_HTTPS_TEST_UPLOAD 1` — live flash logging off; every 30 s pack dummy codes, force-seal, POST 64 KB, erase on 204.
- Verified on device: `DIAG_CLOUD: bucket 0 uploaded OK (65536 bytes, HTTP 204)`.

### Excerpt (reference only — not in tree now)

```c
/* diag_https_config.h (was) */
#define DIAG_HTTPS_TEST_UPLOAD  1
#define DIAG_HTTPS_TEST_INTERVAL_MS  30000

/* diag_manager — pack + seal + upload */
append_test_event(DIAG_FAM_WF, DIAG_WF_01, 0, false);
append_test_event(DIAG_FAM_MQ, DIAG_MQ_23, 0, false);
append_test_event(DIAG_FAM_PM, DIAG_PM_01, 68000u, true);
/* … PM-02..08, UA-05, TL-01 … */
diag_flash_ring_force_seal();
try_upload_sealed_buckets();  /* expects HTTP 2xx then erase */
```

`diag_flash_ring_force_seal()` was also removed with the test path.

---

## ESP continuous metrics — PM-01…49

All integers via `diag_report_metric` → same flash buckets / HTTPS as alerts:

| When | Codes |
|------|--------|
| Every ~10 s health | PM-01…49 (heap/RAM, per-task stack HWM, link flags, ping/DNS/TLS, **SSID name chunks**, **chip die temp PM-49**) |
| WiFi connect/reconnect | PM-05/09/14/15/24 + **PM-29…37 SSID text** (+ PM-06 on reconnect) |
| WiFi disconnect | PM-09=0, PM-10=0 |
| MQTT up/down | PM-12, PM-07 |
| PINGRESP | PM-16 RTT ms |
| DNS / AWS path / TLS end | PM-25 / PM-26 / PM-27 |

SSID **name** is in-band: PM-29 length + PM-30…37 (8× u32 LE = 32 ASCII bytes). No server NVS map required. PM-14/15 (index/hash) still present as helpers.

---

## ESP detailed MQTT / OTA / endpoint event faults

Wired at failure sites (UART detail remains; flash/HTTPS gets **specific codes**):

| Scenario | Code(s) |
|----------|---------|
| Endpoint DNS fail | TL-01 |
| Endpoint TLS probe fail | TL-02 (+ TL-03 if TLS err code) |
| Endpoint not reachable | TL-05 |
| MQTT connect fail | MQ-01 (+ MQ-02 CONNACK timeout, MQ-05/03 send/recv, MQ-10 refused) |
| Subscribe send fail | MQ-07 |
| Broker rejects subscribed topic | MQ-08 |
| MQTT send / recv / NoMemory / keepalive / illegal | MQ-05 / MQ-03 / MQ-04 / MQ-06 / MQ-09 |
| OTA URL too long / truncated | OT-05 / OT-12 |
| Could not allocate URL buffer | OT-13 |
| HTTP client init / open / read fail | OT-06 / OT-07 / OT-08 |
| HTTP 4xx/5xx on download URL | OT-01 |
| Empty download / bad image magic | OT-09 / OT-10 |
| Malformed job / missing firmware URL | OT-14 |
| STM OTA size fetch / transfer | OT-16 / OT-04 |

Docs: `DIAG_HTTPS_SERVER_API.md`, `DIAG_SERVER_REGISTRY.md`, `COMPONENT_DIAGNOSTIC_ANALYSIS.md`, `ESP_Diagnostic_Codebook.xlsx` sheet `02_ESP_Alert_Codes`.

---

## STM status telemetry — CMD `0x5B`

- Frame: `AA 41 5B` + 63 bytes + XOR + `55` (`LEN=0x41`, no ACK)
- ESP splits payload into **16 ordered** flash records `SD-01`…`SD-16` (family `0x19`, `DIAG_FLAG_METRIC`), same `event_time_s`
- Same 4×32 KB seal → HTTPS → erase path as alerts; order in bucket = log order
- Server: concatenate 16× u32 LE → 64 bytes, take first 63

---

## Flash layout change — 4×32 KB (format_ver 3)

Was dual **64 KB**; now four **32 KB** buckets in the same 128 KB `diag_log`:

- Fill → seal → HTTPS POST **32768** bytes → 2xx → erase that slot → next free bucket
- Upload order: oldest `generation` among sealed `0..3`
- Busy / STM `BUSY` only when **all four** are sealed
- Max records per bucket: **2045**; seal footer at `0x7FF8`
- Old `format_ver=2` headers are rejected on recover (bucket treated empty)

---

## Docs updated

- `docs/DIAG_HTTPS_SERVER_API.md` — 4×32 KB, format_ver=3, PM-01…49, SD-01…19, eFuse-corrected chip temp
- `docs/DIAG_SERVER_REGISTRY.md` — TL-05, MQ-07…10, OT-05…17, PM-49, SD-19, CSV seed
- `docs/COMPONENT_DIAGNOSTIC_ANALYSIS.md` — ESP MQTT/TLS/OTA + PM-49 + 0x5B V4
- `docs/ESP_Diagnostic_Codebook.xlsx` / `DIAG_CODEBOOK_END_TO_END.xlsx` — regenerated
- `docs/ESP_ERROR_BOOK_REGISTER.md` (+ `.docx`) — TL/MQ/OT + PM-01…49 + SD-01…19
- `docs/changes_02_10_26.md` — this file

---

## Build / flash notes

- First flash after partition change must rewrite partition table (`idf.py flash`).
- Normal app flash does **not** erase `diag_log`; leftover sealed data can remain until overwritten.
- OTA: `factory` and `ota_0` both `0x1D0000` — sizes match.

---

## Fix — CMD_RSSI_RESP upload_kbps to STM (03 Oct 2026)

- Bug: `send_rssi_response()` left `CMD_RSSI_RESP` payload `[2..5]` hard-zeroed (“reserved”), so STM `0x5B` `upload_kbps` stayed 0 even while q%/ring% updated.
- Fix: pack `mqtt_stream_get_audio_upload_kbps()` as little-endian u32 into `[2..5]`; declare getter in `mqtt_stream_task.h`.
- STM `0x5B` builder unchanged (already mirrors ESP’s last RSSI resp).

---

## Diag HTTPS re-enabled + on-demand flush (03 Oct 2026)

- `DIAG_UART_BUCKET_DUMP` → **0** (HTTPS upload again)
- Cloud already has `POST /api/diag/flush` + `GET /api/diag/cmd`
- ESP polls `GET /api/diag/cmd` every 15 s; on `flush` → seal current + upload sealed → resume
- Trigger anytime: `POST /api/diag/flush` `{"device_id":"ARCHIT"}`
- No MQTT flush; no ESP listening HTTP server

---

## STM 0x5B V4 — MCU temp (05 Oct 2026)

- Wire 79 B: `[AA][4C][5B][74 payload][CHK][55]`; `LEN=0x4C`
- Payload +`mcu_temp_c` @71 (i16), +`mcu_temp_ok` @73 (u8)
- ESP **accepts only 74 B** (rejects older 63/67/71) → **SD-01…19**
- Ignore `mcu_temp_c` when `mcu_temp_ok==0`

---

## STM 0x5B V2 — battery + heap_min (03 Oct 2026)

- Superseded by V4 above (kept for history)
- Wire 76 B: `[AA][49][5B][71 payload][CHK][55]`; `LEN=CMD+payload+CHK`
- Payload: +`heap_min_free_B` @63 (u32), +`battery_pct/chg/mV` @67–70
- ESP previously accepted **63 / 67 / 71** (`LEN 0x41 / 0x45 / 0x49`) → SD-01…16 / 17 / 18

---

## Fix — MQTT audio START/STOP race (03 Oct 2026)

Symptoms: audio packets before cloud START (auto/`unknown` pre-roll); short official WAV (~5 s) then continuation under `unknown/` when STOP landed after a newer START.

Fixes on ESP:
- Gate SPI ring + MQTT audio publish on `audio_mqtt_control_armed` — set **only after** MQTT control `"start"` publish succeeds (then flush session so no pre-roll).
- Control-queue retries use **`xQueueSendToFront`** so a failed STOP cannot jump behind a queued START.
- Drop **stale STOP** if a newer START was already published (`generation` stamp).
- MQTT reconnect / OTA resume: republish START via `audio_control_request_start_republish()` instead of arming audio with no control message.

---

## Health cycle interval → 10 s (05 Oct 2026)

- `MQTT_DIAG_HEALTH_MS` 15000 → **10000** (UART health + PM-01…49 emit rate)
- Cloud flush poll `DIAG_HTTPS_CMD_POLL_MS` still 15 s (unchanged)

---

## ESP chip temperature — PM-49 (04–05 Oct 2026)

- On-chip ESP32-C6 die temp via `driver/temperature_sensor.h` (range −10…80 °C)
- Emitted every ~10 s health cycle as **PM-49** (centi-°C signed int32, e.g. `3460` = 34.60 °C)
- Also shown in UART **HEALTH CHECK** snapshot (`Chip Temp`) and summary `chip_temp_c=`
- Not ambient / pet temperature

### eFuse TEMP_CALIB backport (IDF 5.1.6)

- IDF 5.1.6 `esp_efuse_rtc_calib_get_tsens_val()` is a **stub** (always returns `0` on C6 — `IDF-5236`)
- Hardware eFuse field `ESP_EFUSE_TEMP_CALIB` (9-bit, bit8=sign) **does exist** and is burnt on production modules
- Firmware reads that field in-app (same formula as IDF 5.4+) and applies  
  `corrected_C = raw_C − (deltaT / 10)`
- Example observed: `stub_deltaT=0`, `efuse_deltaT=-196`, `raw=15` → **corrected≈34.6 °C**
- **PM-49 / health logs store the corrected value**
- Full IDF upgrade not required for this fix

---

## Intentionally NOT using MQTT for diagnostics

MQTT remains for audio / temp / jobs. Diagnostics + coredump use HTTPS only.
