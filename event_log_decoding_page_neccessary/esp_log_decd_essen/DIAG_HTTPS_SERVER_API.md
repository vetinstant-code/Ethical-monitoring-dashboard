# Diagnostic HTTPS Upload — Server Implementation Spec

**Server registry seed (codes + meanings + CSV):** [`DIAG_SERVER_REGISTRY.md`](DIAG_SERVER_REGISTRY.md) — enter PM-01…49, SD-01…19, ESP faults, families, SSID/0x5B rebuild rules into your DB.

**Excel codebooks (same table format, split by side):**
- ESP-only: [`ESP_Diagnostic_Codebook.xlsx`](ESP_Diagnostic_Codebook.xlsx)
- Combined: [`DIAG_CODEBOOK_END_TO_END.xlsx`](DIAG_CODEBOOK_END_TO_END.xlsx)
- Error book: [`ESP_ERROR_BOOK_REGISTER.md`](ESP_ERROR_BOOK_REGISTER.md) / [`ESP_ERROR_BOOK_REGISTER.docx`](ESP_ERROR_BOOK_REGISTER.docx)
- STM-only: [`STM_ESP_Diagnostic_Codebook.xlsx`](STM_ESP_Diagnostic_Codebook.xlsx) (if present)

Use this document to implement the cloud receiver. When ready, give the ESP team:

1. **Events URL** → set as `DIAG_HTTPS_EVENTS_URL`
2. **Cmd / flush poll URL** → set as `DIAG_HTTPS_CMD_URL` (e.g. `…/api/diag/cmd`)
3. **Optional core-dump URL** → set as `DIAG_HTTPS_COREDUMP_URL`
4. **Optional bearer token** → set as `DIAG_HTTPS_AUTH_BEARER`
5. Expected `X-Device-Id` values (today default is `ARCHIT`)

Until `DIAG_HTTPS_EVENTS_URL` is non-empty, the device **stores** sealed 32 KB buckets on flash and does **not** upload.

**Normal flow:** ESP fills a 32 KB bucket → seals when full → `POST /api/diag/events` → erase on 2xx → keep filling.

**On-demand flush (optional):** call cloud `POST /api/diag/flush` for a device; ESP polls `GET /api/diag/cmd`, seals current (even partial), uploads, resumes fill. If you never flush, only the normal full-bucket flow runs.

---

## 0. On-demand flush (cloud APIs — already live)

### 0a. Ask a device to upload now (you / admin / UI)

```bash
curl -X POST "http://43.205.129.56:8000/api/diag/flush" \
  -H "Content-Type: application/json" \
  -d '{"device_id":"ARCHIT"}'
```

Sets a pending flush for that device. No extra endpoint needed.

### 0b. ESP poll (device → cloud)

ESP GETs every **15 s** when online (`DIAG_HTTPS_CMD_URL`):

```bash
curl -s "http://43.205.129.56:8000/api/diag/cmd" \
  -H "X-Device-Id: ARCHIT"
```

| Response | ESP behavior |
|----------|----------------|
| Body containing `flush` (e.g. `{"command":"flush"}`) | Seal active bucket (if ≥1 record) → upload sealed via §1 → resume fill |
| `204` / empty / no flush | Do nothing — normal flow only |

### 0c. Upload (unchanged)

ESP still `POST`s sealed buckets to `/api/diag/events` (see §1).

---

## 1. Endpoint the ESP will call (events / logs)

| Item | Value |
|------|--------|
| Method | `POST` |
| URL | whatever you provide (HTTPS only) |
| Body | raw binary, **exactly 32768 bytes** (one sealed bucket) |
| Content-Type | `application/octet-stream` |
| TLS | ESP uses system CA bundle (`esp_crt_bundle_attach`) |

### Request headers (always sent)

| Header | Example | Meaning |
|--------|---------|---------|
| `Content-Type` | `application/octet-stream` | Raw bucket blob |
| `X-Device-Id` | `ARCHIT` | Device identity (match MQTT / Thing id) |
| `X-Diag-Schema` | `bucket-v1` | Payload layout version (this doc) |
| `X-Bucket-Id` | `0` … `3` | Which of the four 32 KB slots was uploaded |
| `X-Bucket-Bytes` | `32768` | Declared body length |
| `Authorization` | `Bearer <token>` | Only if token configured on device |

### Response contract (critical)

| HTTP status | Device behavior |
|-------------|-----------------|
| **2xx** | Treat as success → **erase that 32 KB bucket** → free for new logs |
| Anything else / timeout / TLS fail | Keep bucket sealed → retry later |

Body of the response is ignored. Empty `204` is fine.

Timeouts: device waits up to **60 s** for the transfer.

---

## 2. What the 32 KB body is

The body is a **verbatim copy of one flash bucket** — not JSON, not line text.

```
Offset          Size        Content
──────────────  ──────────  ─────────────────────────────────
0x0000          32 bytes    Bucket header
0x0020          N × 16      Event records (packed, little-endian)
…               …           Unused slots are 0xFF… (erased flash)
0x7FF8          8 bytes     Seal footer at end of bucket
```

Constants:

- Bucket size = **32768** (`0x8000`)
- Header size = **32**
- Record size = **16**
- Seal footer size = **8**
- Max records = `(32768 − 32 − 8) / 16` = **2045**
- Unused gap before footer (after last possible record) = **8** bytes (`0xFF`)

Quad-bucket note: device has **four** of these (0..3) inside 128 KB `diag_log`. You receive **one full 32 KB** per POST. Upload order is oldest sealed generation first. After 2xx the device erases that slot and can keep filling/sealing the others.

---

## 3. Bucket header (32 bytes, little-endian)

| Offset | Type | Field | Notes |
|--------|------|-------|-------|
| 0 | `u32` | `magic` | `0x4B424744` (`'DGBK'` LE) |
| 4 | `u8` | `format_ver` | Must be `3` for current 4×32 KB layout |
| 5 | `u8` | `state` | `0=EMPTY`, `1=FILLING`, `2=SEALED` — uploaded buckets are sealed |
| 6 | `u16` | `record_count` | May be stale in header; **prefer seal footer** |
| 8 | `u32` | `generation` | Monotonic bucket generation |
| 12 | `u32` | `boot_id` | Boot instance id |
| 16 | `u8[14]` | `reserved` | Ignore |
| 30 | `u16` | `crc16` | CRC-16/CCITT over bytes `[0..29]` |

Reject bucket if `magic` / `format_ver` wrong.

---

## 4. Seal footer (last 8 bytes of the 32 KB)

Absolute offset **`0x7FF8`**:

| Offset in footer | Type | Field | Notes |
|------------------|------|-------|-------|
| 0 | `u32` | `magic` | `0x4C414553` (`'SEAL'` LE) |
| 4 | `u16` | `record_count` | **Authoritative** count of valid records |
| 6 | `u16` | `crc16` | CRC-16/CCITT over first 6 bytes of footer |

Parse path:

1. Read footer at `0x7FF8`
2. Verify SEAL magic + CRC
3. Use `record_count` as `N`
4. Read `N` records starting at offset `0x20`

If footer invalid, fall back: scan records from `0x20` until CRC fails or slot is erased (`0xFF`).

---

## 5. Event record (16 bytes each, little-endian)

Starting at offset `0x0020 + index * 16`:

| Offset | Type | Field | Notes |
|--------|------|-------|-------|
| 0 | `u8` | `family_id` | Family byte (see §7) |
| 1 | `u8` | `code_id` | Code byte (decimal NN in `PREFIX-NN`) |
| 2 | `u8` | `repeat_count` | Occurrences coalesced; treat `0` as `1` |
| 3 | `u8` | `flags` | Time quality in low 2 bits (see §6) |
| 4 | `u32` | `event_time_s` | UTC epoch seconds if synced; else boot-relative |
| 8 | `u16` | `source_session` | STM session or ESP local session |
| 10 | `u16` | `source_sequence` | Sequence within session |
| 12 | `u16` | `crc16` | CRC-16/CCITT over **first 12 bytes only** |
| 14 | `u16` | `reserved` | Ignore (often `0xFFFF`) |

### Valid record checks

- Reject if `family_id == 0xFF && code_id == 0xFF` (erased slot)
- Reject if `family_id == 0` or `code_id == 0`
- Reject if CRC over bytes `[0..11]` ≠ `crc16`

### Suggested DB / API fields after decode

| Field | How to derive |
|-------|----------------|
| `code` | `"{PREFIX}-{code_id:02d}"` e.g. `MQ-23`, `UA-05`, `SC-11` |
| `registry_id` | `(family_id << 8) \| code_id` (uint16) |
| `repeat` | `max(repeat_count, 1)` |
| `event_time` | `event_time_s` + quality |
| `time_quality` | `U` / `E` / `C` from flags |
| `session` | `source_session` hex |
| `sequence` | `source_sequence` hex |
| `device_id` | from `X-Device-Id` |
| `bucket_id` | from `X-Bucket-Id` |
| `schema` | `bucket-v1` |

Human line form used elsewhere in firmware (reference only; **not** what is POSTed):

```text
v1|MQ-23|1|1710000000|C|00A1:0003
```

Format: `v1|<CODE>|<repeat>|<event_time_s>|<U|E|C>|<session:seq>`

---

## 6. Time quality (`flags` low bits)

| `flags & 0x03` | Char | Meaning |
|----------------|------|---------|
| `0` | `U` | Unsynced — `event_time_s` is boot-relative / weak |
| `1` | `E` | Estimated |
| `2` | `C` | SNTP-corrected UTC epoch |

| Extra flag | Meaning |
|------------|---------|
| `flags & 0x04` (`DIAG_FLAG_METRIC`) | Record is a **performance metric**. Decode value as `uint32 = source_session \| (source_sequence << 16)` (little-endian halves). |

For metric records, `source_session` / `source_sequence` are **not** identity keys — they carry the numeric sample. Deduplicate metrics by `(device_id, code, event_time_s)` instead.

---

## 7. Family → PREFIX map

Readable code = `PREFIX` + `-` + zero-padded **decimal** `code_id`.

Example: family `0x15`, code `0x17` → **`MQ-23`** (because `0x17` = 23 decimal).

### STM-owned families (`0x01`–`0x0F`)

| ID | PREFIX | Area (high level) |
|----|--------|-------------------|
| `0x01` | ST | STM system / status |
| `0x02` | SU | STM UART |
| `0x03` | SA | STM audio |
| `0x04` | SF | STM flash / FS |
| `0x05` | SC | STM codec / signal path |
| `0x06` | SS | STM sensors |
| `0x07` | SO | STM other / app |
| `0x08` | PW | Power |
| `0x09` | IB | I²C bus |
| `0x0A` | TM | Temperature / thermal |
| `0x0B` | AH | Audio hardware |
| `0x0C` | DP | DSP / processing |
| `0x0D` | FM | Firmware / module |
| `0x0E` | UB | USB |
| `0x0F` | IO | GPIO / IO |

STM detailed code meanings live in the shared Error Book / STM firmware. Server should accept any `code_id` in `1..255` for these families and resolve text from your registry DB.

### ESP-owned families (`0x10`–`0x19`)

| ID | PREFIX | Area |
|----|--------|------|
| `0x10` | PR | Provisioning / pairing |
| `0x11` | UA | UART bridge / STM link |
| `0x12` | SP | SPI audio path |
| `0x13` | WF | Wi-Fi |
| `0x14` | TL | TLS / reachability |
| `0x15` | MQ | MQTT |
| `0x16` | ES | ESP system / crash / heap thresholds |
| `0x17` | OT | OTA |
| `0x18` | PM | Performance metrics (periodic samples) |
| `0x19` | SD | STM `0x5B` status/UI dump (19 ordered chunks) |

### ESP codes currently emitted (seed your registry)

| Code | `family` | `code_id` | Typical meaning |
|------|----------|-----------|-----------------|
| PR-01 | `0x10` | 1 | Provisioning / setup fault class 1 |
| PR-02 | `0x10` | 2 | … |
| PR-03 | `0x10` | 3 | … |
| PR-04 | `0x10` | 4 | … |
| PR-05 | `0x10` | 5 | Reserved / defined |
| UA-01 | `0x11` | 1 | UART link issue |
| UA-02 | `0x11` | 2 | … |
| UA-03 | `0x11` | 3 | … |
| UA-04 | `0x11` | 4 | … |
| UA-05 | `0x11` | 5 | STM UART silence / watchdog |
| SP-01 | `0x12` | 1 | SPI RX fault |
| SP-02 | `0x12` | 2 | SPI RX fault |
| SP-03 | `0x12` | 3 | Defined |
| SP-04 | `0x12` | 4 | Audio ring overflow |
| SP-05 | `0x12` | 5 | Packetizer fault |
| WF-01 | `0x13` | 1 | WiFi disconnected (any reason) |
| WF-02 | `0x13` | 2 | No AP found |
| WF-03 | `0x13` | 3 | Lost IP after being online |
| WF-04 | `0x13` | 4 | Defined (not emitted yet) |
| TL-01 | `0x14` | 1 | AWS endpoint DNS resolve fail |
| TL-02 | `0x14` | 2 | AWS endpoint TLS probe fail |
| TL-03 | `0x14` | 3 | TLS error code on probe fail |
| TL-04 | `0x14` | 4 | MQTT TLS send/recv path fault |
| TL-05 | `0x14` | 5 | AWS endpoint not reachable |
| MQ-01 | `0x15` | 1 | MQTT connect / session failed |
| MQ-02 | `0x15` | 2 | MQTT CONNACK timeout / broker silent |
| MQ-03 | `0x15` | 3 | MQTT receive failed |
| MQ-04 | `0x15` | 4 | MQTTNoMemory (buffer / outbox full) |
| MQ-05 | `0x15` | 5 | MQTT send failed |
| MQ-06 | `0x15` | 6 | MQTT keepalive timeout |
| MQ-07 | `0x15` | 7 | Subscribe send failed |
| MQ-08 | `0x15` | 8 | SUBACK: broker rejected topic(s) |
| MQ-09 | `0x15` | 9 | MQTT illegal state |
| MQ-10 | `0x15` | 10 | MQTT server refused request |
| MQ-23 | `0x15` | **23** (`0x17`) | Stream / publish path fault |
| ES-01 | `0x16` | 1 | OTA malloc fail |
| ES-02 | `0x16` | 2 | Task create fail / coredump path |
| ES-03 | `0x16` | 3 | Boot after WDT reset |
| ES-04 | `0x16` | 4 | Boot after panic |
| ES-05 | `0x16` | 5 | Boot after brownout |
| ES-06 | `0x16` | 6 | Core-dump present |
| ES-07 | `0x16` | 7 | Core-dump upload fail |
| ES-08 | `0x16` | 8 | Core-dump partition issue |
| ES-09 | `0x16` | 9 | Free heap &lt; 40 KB |
| ES-10 | `0x16` | 10 | Min heap &lt; 32 KB |
| ES-11 | `0x16` | 11 | mqtt_process stack HWM &lt; 512 B |
| OT-01 | `0x17` | 1 | OTA HTTP status error (URL 4xx/5xx) |
| OT-02 | `0x17` | 2 | OTA flash begin/write fail |
| OT-03 | `0x17` | 3 | OTA pending NVS open/commit fail |
| OT-04 | `0x17` | 4 | STM OTA protocol / UART transfer fail |
| OT-05 | `0x17` | 5 | OTA URL too long |
| OT-06 | `0x17` | 6 | OTA HTTP client init failed |
| OT-07 | `0x17` | 7 | OTA HTTP open failed (URL unreachable) |
| OT-08 | `0x17` | 8 | OTA HTTP read / download stream failed |
| OT-09 | `0x17` | 9 | OTA download empty (no data) |
| OT-10 | `0x17` | 10 | OTA image invalid / corrupt magic |
| OT-11 | `0x17` | 11 | OTA task create failed |
| OT-12 | `0x17` | 12 | OTA URL truncated (pending store) |
| OT-13 | `0x17` | 13 | Could not allocate buffer for OTA URL |
| OT-14 | `0x17` | 14 | OTA job missing / malformed firmware URL |
| OT-15 | `0x17` | 15 | OTA finalize / set boot partition failed |
| OT-16 | `0x17` | 16 | STM OTA firmware size / URL fetch failed |
| OT-17 | `0x17` | 17 | OTA partition erase failed |
| PM-01 | `0x18` | 1 | Free heap (bytes) — **metric** |
| PM-02 | `0x18` | 2 | Min free heap (bytes) — **metric** |
| PM-03 | `0x18` | 3 | Largest free block (bytes) — **metric** |
| PM-04 | `0x18` | 4 | mqtt_process stack HWM (bytes) — **metric** |
| PM-05 | `0x18` | 5 | RSSI dBm (signed) — **metric** |
| PM-06 | `0x18` | 6 | WiFi reconnect count — **metric** |
| PM-07 | `0x18` | 7 | MQTT disconnect count — **metric** |
| PM-08 | `0x18` | 8 | Uptime seconds — **metric** |
| PM-09 | `0x18` | 9 | WiFi connected 0/1 |
| PM-10 | `0x18` | 10 | WiFi has IP 0/1 |
| PM-11 | `0x18` | 11 | Internet/AWS path OK 0/1 |
| PM-12 | `0x18` | 12 | MQTT connected 0/1 |
| PM-13 | `0x18` | 13 | WiFi reconnecting 0/1 |
| PM-14 | `0x18` | 14 | WiFi network index (1-based, 0=none) |
| PM-15 | `0x18` | 15 | SSID FNV-1a hash (u32) |
| PM-16 | `0x18` | 16 | MQTT ping RTT (ms) |
| PM-17 | `0x18` | 17 | Temp cloud-ACK queue depth |
| PM-18 | `0x18` | 18 | MQTT outbox pending |
| PM-19 | `0x18` | 19 | MQTT event queue length |
| PM-20 | `0x18` | 20 | Internal RAM free (bytes) |
| PM-21 | `0x18` | 21 | `diag_mgr` stack HWM (bytes) |
| PM-22 | `0x18` | 22 | `uart_rx` stack HWM (bytes) |
| PM-23 | `0x18` | 23 | `mqtt_diag` stack HWM (bytes) |
| PM-24 | `0x18` | 24 | WiFi channel |
| PM-25 | `0x18` | 25 | Last DNS resolve (ms) |
| PM-26 | `0x18` | 26 | Last TLS handshake / AWS-path TLS (ms) |
| PM-27 | `0x18` | 27 | AWS path reachable 0/1 |
| PM-28 | `0x18` | 28 | SNTP/time trusted 0/1 |
| PM-29 | `0x18` | 29 | WiFi SSID length (0…32) |
| PM-30…37 | `0x18` | 30…37 | SSID ASCII as 8× u32 LE words (32 bytes, zero-padded) |
| PM-38 | `0x18` | 38 | Heap total (bytes) |
| PM-39 | `0x18` | 39 | Heap used (bytes) |
| PM-40 | `0x18` | 40 | Heap used percent 0…100 |
| PM-41 | `0x18` | 41 | `aws_iot_demo` stack HWM (bytes) |
| PM-42 | `0x18` | 42 | `mqtt_stream` stack HWM (bytes) |
| PM-43 | `0x18` | 43 | `audio_packetizer` stack HWM (bytes) |
| PM-44 | `0x18` | 44 | `spi_audio_rx` stack HWM (bytes) |
| PM-45 | `0x18` | 45 | `mqtt_process_task` stack HWM (bytes) |
| PM-46 | `0x18` | 46 | `temp_ack_retry` stack HWM (bytes) |
| PM-47 | `0x18` | 47 | `audio_ctrl_pub` stack HWM (bytes) |
| PM-48 | `0x18` | 48 | `mqtt_health_task` stack HWM (bytes) |
| PM-49 | `0x18` | 49 | ESP chip die temp — **metric**, value = centi-°C as signed int32 (3460 → 34.60 °C). **Corrected** with eFuse `TEMP_CALIB` in-app (IDF 5.1.6 stub ignored). |

**SSID name (no server-side NVS map):** same `event_time_s` group as the health/WiFi sample:

```
len = value(PM-29)
raw[32] = concat LE bytes of value(PM-30)..value(PM-37)
ssid = raw[0 : len] as UTF-8/ASCII
```

Example SSID `"HomeWiFi"` (`len=8`):

- PM-29 = `8`
- PM-30 = bytes `H o m e` → `0x656D6F48`
- PM-31 = bytes `W i F i` → `0x69466957`
- PM-32…37 = `0`

PM-01…49 are continuous samples every ~10 s (heap/RAM, per-task stack HWM, chip temp PM-49, link/queues/timing, SSID via PM-29…37) — ESP analogue of STM status continuous codes. Also on events: WiFi connect/reconnect includes full SSID chunks; WiFi disconnect (PM-09/10); MQTT connect/disconnect (PM-12/07); PINGRESP (PM-16); DNS (PM-25); TLS/AWS path (PM-26/27). ES-09…11 use hysteresis (clear when heap &gt; 48/40 KB or stack HWM &gt; 1024 B).

### SD — STM status/UI (`0x5B`) reassembly

Wire (V4, 79 B total): `[AA][4C][5B][74-byte payload][CHK][55]`.  
`LEN = CMD + payload + CHK` = `0x4C`. No `0x5A` ACK.  
**This firmware accepts only LEN=`0x4C` / 74 B** (older 63/67/71 rejected).

| Version | UART LEN | Payload | Flash records |
|---------|----------|---------|---------------|
| V4 | `0x4C` | 74 B | `SD-01`…`SD-19` |

| Code | Chunk | Bytes of original payload |
|------|-------|---------------------------|
| SD-01 | word 0 | `[0..3]` (`session_id`, `seq`) |
| … | … | … |
| SD-16 | word 15 | `[60..63]` |
| SD-17 | word 16 | `[64..67]` (`heap_min` hi + `battery_pct`) |
| SD-18 | word 17 | `[68..71]` (`battery_chg`, `battery_mV`, `mcu_temp_c` lo) |
| SD-19 | word 18 | `[72..73]` + pad (`mcu_temp_c` hi, `mcu_temp_ok`) |

Reassemble: take first **74** bytes from SD-01…19 (last chunk padded to 4).

Added / changed fields vs V2: offset **71** `mcu_temp_c` (i16 °C); **73** `mcu_temp_ok` (0/1). Full map: [`DIAG_SERVER_REGISTRY.md`](DIAG_SERVER_REGISTRY.md) §4.

### Metric decode example

```
flags has bit 0x04
code = PM-01
value = session | (sequence << 16)   # e.g. 78972 bytes free heap
```

For PM-05 (RSSI), interpret `value` as **signed** int32 (e.g. `0xFFFFFFBF` → −65).

Unknown family → format as `Fxx-NN` (e.g. `F1A-03`). Still store the raw bytes.

---

## 8. CRC-16/CCITT (used by header, footer, records)

Same algorithm everywhere:

- Init = `0xFFFF`
- Poly = `0x1021`
- No final XOR
- Bit order: left-shift (MSB first)

Pseudo-code:

```c
uint16_t crc16_ccitt(const uint8_t *data, size_t len) {
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < len; i++) {
        crc ^= (uint16_t)data[i] << 8;
        for (int b = 0; b < 8; b++) {
            if (crc & 0x8000)
                crc = (uint16_t)((crc << 1) ^ 0x1021);
            else
                crc <<= 1;
        }
    }
    return crc;
}
```

---

## 9. Server parse recipe (recommended)

```
1. Require Content-Length / body == 32768
2. Require X-Diag-Schema == "bucket-v1"
3. Authenticate (Bearer / device allow-list via X-Device-Id)
4. Parse header @0; check magic DGBK + format_ver==3
5. Parse seal footer @0x7FF8; check SEAL + CRC → N = record_count
6. For i in 0..N-1:
      rec = body[0x20 + i*16 : +16]
      verify record CRC
      map to PREFIX-NN, insert row keyed by device_id + session + sequence
7. Return 204 (or 200) only after durable store succeeds
```

Idempotency: same `(device_id, session, sequence, family, code)` may be retried if erase failed after a prior 2xx. Upsert / ignore duplicates.

---

## 10. Optional second endpoint — core dump

Separate URL (`DIAG_HTTPS_COREDUMP_URL`), also `POST` + `application/octet-stream`.

| Header | Meaning |
|--------|---------|
| `X-Device-Id` | Device id |
| `X-Dump-Size` | Byte length of body |
| `X-Reset-Reason` | `coredump` |
| `Authorization` | Optional bearer |

Body = ESP-IDF core-dump binary (variable size, streamed). **2xx** → device erases coredump partition.

---

## 11. What to send back to ESP team

Fill and return:

```text
DIAG_HTTPS_EVENTS_URL   = https://______________________________
DIAG_HTTPS_COREDUMP_URL = https://______________________________   (optional)
DIAG_HTTPS_AUTH_BEARER  = ________________________________        (optional)
DIAG_HTTPS_DEVICE_ID    = ARCHIT   (or per-device list)
```

Also confirm:

- [ ] Endpoint accepts up to 32 KB body (exactly 32768)
- [ ] Returns 2xx only after persisted
- [ ] TLS cert is public CA (or tell us if custom CA needed)
- [ ] CORS not required (device is not a browser)

---

## 12. Quick test vector outline

After you stand up a stub:

1. `curl -X POST "$URL" \
  -H "Content-Type: application/octet-stream" \
  -H "X-Device-Id: ARCHIT" \
  -H "X-Diag-Schema: bucket-v1" \
  -H "X-Bucket-Id: 0" \
  -H "X-Bucket-Bytes: 32768" \
  --data-binary @sample_bucket.bin`

2. Parser should print `N` events as `PREFIX-NN` lines.

Firmware sources of truth:

- `main/diag_cloud.c` — HTTP headers / upload
- `main/diag_flash_ring.c` — bucket layout
- `main/diag_event.h` — 16-byte record
- `main/diag_registry.h` / `.c` — family prefixes
- `main/diag_https_config.h` — URL / auth knobs