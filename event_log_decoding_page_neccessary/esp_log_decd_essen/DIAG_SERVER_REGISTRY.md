# Diagnostic Server Registry (seed this DB)

Use this file to **enter codes into the cloud registry**.  
Wire / flash format is unchanged: 16-byte `bucket-v1` records inside **32768**-byte buckets (`format_ver=3`).

Readable code = `PREFIX` + `-` + zero-padded decimal `code_id`  
Example: family `0x18`, code `16` → **PM-16**.

Metric value (when `flags & 0x04`):

```text
value_u32 = source_session | (source_sequence << 16)   // little-endian halves
```

Suggested DB columns: `code`, `family_id`, `code_id`, `kind`, `unit`, `meaning`, `notes`

`kind` values used below:

| kind | Meaning |
|------|---------|
| `fault` | Alert / threshold event |
| `metric` | Integer sample in `value_u32` |
| `ssid_meta` | SSID length (use with `ssid_chunk`) |
| `ssid_chunk` | 4 ASCII bytes of SSID (LE in `value_u32`) |
| `status_chunk` | 4 bytes of STM `0x5B` payload (LE in `value_u32`) |

---

## 1. Families (enter all)

| family_id | PREFIX | owner | area |
|-----------|--------|-------|------|
| 1 (`0x01`) | ST | STM | STM system / framing |
| 2 (`0x02`) | SU | STM | STM↔ESP UART |
| 3 (`0x03`) | SA | STM | Audio / SPI transport |
| 4 (`0x04`) | SF | STM | Stream / app flow |
| 5 (`0x05`) | SC | STM | Cloud / WiFi handshake (STM view) |
| 6 (`0x06`) | SS | STM | STM runtime |
| 7 (`0x07`) | SO | STM | OTA control |
| 8 (`0x08`) | PW | STM | Power / MP2722 / battery |
| 9 (`0x09`) | IB | STM | I²C |
| 10 (`0x0A`) | TM | STM | Temperature probes |
| 11 (`0x0B`) | AH | STM | Audio hardware |
| 12 (`0x0C`) | DP | STM | Display |
| 13 (`0x0D`) | FM | STM | External flash |
| 14 (`0x0E`) | UB | STM | USB / SpO2 |
| 15 (`0x0F`) | IO | STM | Buttons / GPIO / rails |
| 16 (`0x10`) | PR | ESP | Provisioning |
| 17 (`0x11`) | UA | ESP | UART bridge / STM link |
| 18 (`0x12`) | SP | ESP | SPI audio path |
| 19 (`0x13`) | WF | ESP | Wi‑Fi faults |
| 20 (`0x14`) | TL | ESP | TLS / reachability faults |
| 21 (`0x15`) | MQ | ESP | MQTT faults |
| 22 (`0x16`) | ES | ESP | ESP system / crash / heap thresholds |
| 23 (`0x17`) | OT | ESP | OTA faults |
| 24 (`0x18`) | PM | ESP | Performance / link **metrics** |
| 25 (`0x19`) | SD | ESP | STM `0x5B` status dump **chunks** |

STM alert code meanings (ST…IO) stay in the Error Book — accept any `code_id` 1…255 for families `0x01`…`0x0F`.

---

## 2. ESP fault codes (enter these)

| code | family_id | code_id | kind | unit | meaning |
|------|-----------|---------|------|------|---------|
| PR-01 | 16 | 1 | fault | — | Provisioning / setup fault 1 |
| PR-02 | 16 | 2 | fault | — | Provisioning / setup fault 2 |
| PR-03 | 16 | 3 | fault | — | Provisioning / setup fault 3 |
| PR-04 | 16 | 4 | fault | — | Unknown / unsupported UART command |
| PR-05 | 16 | 5 | fault | — | Provisioning fault 5 |
| UA-01 | 17 | 1 | fault | — | UART read / link error |
| UA-02 | 17 | 2 | fault | — | UART fault 2 |
| UA-03 | 17 | 3 | fault | — | UART fault 3 |
| UA-04 | 17 | 4 | fault | — | UART driver re-init / recovery |
| UA-05 | 17 | 5 | fault | — | STM UART silence watchdog |
| SP-01 | 18 | 1 | fault | — | SPI RX fault 1 |
| SP-02 | 18 | 2 | fault | — | SPI RX fault 2 |
| SP-03 | 18 | 3 | fault | — | SPI fault 3 |
| SP-04 | 18 | 4 | fault | — | Audio ring overflow |
| SP-05 | 18 | 5 | fault | — | Packetizer fault |
| WF-01 | 19 | 1 | fault | — | WiFi disconnected (any reason) |
| WF-02 | 19 | 2 | fault | — | No AP found |
| WF-03 | 19 | 3 | fault | — | Lost IP after being online |
| WF-04 | 19 | 4 | fault | — | WiFi fault 4 (reserved/defined) |
| TL-01 | 20 | 1 | fault | — | AWS endpoint DNS resolve fail |
| TL-02 | 20 | 2 | fault | — | AWS endpoint TLS probe fail |
| TL-03 | 20 | 3 | fault | — | TLS error code on probe fail |
| TL-04 | 20 | 4 | fault | — | MQTT TLS send/recv path fault |
| TL-05 | 20 | 5 | fault | — | AWS endpoint not reachable |
| MQ-01 | 21 | 1 | fault | — | MQTT connect / session failed |
| MQ-02 | 21 | 2 | fault | — | MQTT CONNACK timeout / broker silent |
| MQ-03 | 21 | 3 | fault | — | MQTT receive failed |
| MQ-04 | 21 | 4 | fault | — | MQTTNoMemory (buffer / outbox full) |
| MQ-05 | 21 | 5 | fault | — | MQTT send failed |
| MQ-06 | 21 | 6 | fault | — | MQTT keepalive timeout |
| MQ-07 | 21 | 7 | fault | — | Subscribe send failed |
| MQ-08 | 21 | 8 | fault | — | SUBACK: broker rejected topic(s) |
| MQ-09 | 21 | 9 | fault | — | MQTT illegal state |
| MQ-10 | 21 | 10 | fault | — | MQTT server refused request |
| MQ-23 | 21 | 23 | fault | — | Stream / publish path fault |
| ES-01 | 22 | 1 | fault | — | OTA malloc fail |
| ES-02 | 22 | 2 | fault | — | Task create fail / coredump path |
| ES-03 | 22 | 3 | fault | — | Boot after WDT reset |
| ES-04 | 22 | 4 | fault | — | Boot after panic |
| ES-05 | 22 | 5 | fault | — | Boot after brownout |
| ES-06 | 22 | 6 | fault | — | Core-dump present |
| ES-07 | 22 | 7 | fault | — | Core-dump upload fail |
| ES-08 | 22 | 8 | fault | — | Core-dump partition issue |
| ES-09 | 22 | 9 | fault | — | Free heap &lt; 40 KB |
| ES-10 | 22 | 10 | fault | — | Min heap &lt; 32 KB |
| ES-11 | 22 | 11 | fault | — | mqtt_process stack HWM &lt; 512 B |
| OT-01 | 23 | 1 | fault | — | OTA HTTP status error (URL 4xx/5xx) |
| OT-02 | 23 | 2 | fault | — | OTA flash begin/write fail |
| OT-03 | 23 | 3 | fault | — | OTA pending NVS open/commit fail |
| OT-04 | 23 | 4 | fault | — | STM OTA protocol / UART transfer fail |
| OT-05 | 23 | 5 | fault | — | OTA URL too long |
| OT-06 | 23 | 6 | fault | — | OTA HTTP client init failed |
| OT-07 | 23 | 7 | fault | — | OTA HTTP open failed (URL unreachable) |
| OT-08 | 23 | 8 | fault | — | OTA HTTP read / download stream failed |
| OT-09 | 23 | 9 | fault | — | OTA download empty (no data) |
| OT-10 | 23 | 10 | fault | — | OTA image invalid / corrupt magic |
| OT-11 | 23 | 11 | fault | — | OTA task create failed |
| OT-12 | 23 | 12 | fault | — | OTA URL truncated (pending store) |
| OT-13 | 23 | 13 | fault | — | Could not allocate buffer for OTA URL |
| OT-14 | 23 | 14 | fault | — | OTA job missing / malformed firmware URL |
| OT-15 | 23 | 15 | fault | — | OTA finalize / set boot partition failed |
| OT-16 | 23 | 16 | fault | — | STM OTA firmware size / URL fetch failed |
| OT-17 | 23 | 17 | fault | — | OTA partition erase failed |

---

## 3. PM metrics — enter all (family 24 / `0x18`)

All rows: `kind=metric` unless noted. Always decode `value_u32` as above.

| code | code_id | kind | unit | meaning | notes |
|------|---------|------|------|---------|-------|
| PM-01 | 1 | metric | bytes | Free heap | Periodic ~10 s |
| PM-02 | 2 | metric | bytes | Min free heap (watermark) | Periodic |
| PM-03 | 3 | metric | bytes | Largest free block | Periodic |
| PM-04 | 4 | metric | bytes | mqtt_process stack HWM | Periodic |
| PM-05 | 5 | metric | dBm | WiFi RSSI | **signed** int32 in value |
| PM-06 | 6 | metric | count | WiFi reconnect count | Periodic + on reconnect |
| PM-07 | 7 | metric | count | MQTT disconnect count | Periodic + on disconnect |
| PM-08 | 8 | metric | s | Uptime since diag boot | Periodic |
| PM-09 | 9 | metric | 0/1 | WiFi connected | Periodic + WiFi events |
| PM-10 | 10 | metric | 0/1 | WiFi has IP | Periodic + disconnect→0 |
| PM-11 | 11 | metric | 0/1 | Internet / AWS path OK | Periodic |
| PM-12 | 12 | metric | 0/1 | MQTT connected | Periodic + MQTT up/down |
| PM-13 | 13 | metric | 0/1 | WiFi reconnect in progress | Periodic |
| PM-14 | 14 | metric | index | Saved WiFi network index | 1-based; 0=none |
| PM-15 | 15 | metric | hash | SSID FNV-1a u32 | Helper; name is PM-29…37 |
| PM-16 | 16 | metric | ms | MQTT keepalive ping RTT | On PINGRESP + periodic last |
| PM-17 | 17 | metric | count | Temp cloud-ACK queue depth | Periodic |
| PM-18 | 18 | metric | count | MQTT outbox pending | Periodic |
| PM-19 | 19 | metric | count | MQTT event queue length | Periodic; 0 if unknown |
| PM-20 | 20 | metric | bytes | Internal RAM free | Periodic |
| PM-21 | 21 | metric | bytes | Task `diag_mgr` stack HWM | Periodic |
| PM-22 | 22 | metric | bytes | Task `uart_rx` stack HWM | Periodic |
| PM-23 | 23 | metric | bytes | Task `mqtt_diag` stack HWM | Periodic |
| PM-24 | 24 | metric | — | WiFi channel | Periodic + connect |
| PM-25 | 25 | metric | ms | Last DNS resolve duration | On DNS + periodic last |
| PM-26 | 26 | metric | ms | Last TLS / AWS-path TLS duration | On TLS end / AWS probe |
| PM-27 | 27 | metric | 0/1 | AWS path reachable | On AWS probe + periodic |
| PM-28 | 28 | metric | 0/1 | SNTP / time trusted | Periodic |
| PM-29 | 29 | ssid_meta | chars | WiFi SSID length (0…32) | With PM-30…37 |
| PM-30 | 30 | ssid_chunk | bytes[4] | SSID ASCII bytes `[0..3]` | LE in value |
| PM-31 | 31 | ssid_chunk | bytes[4] | SSID ASCII bytes `[4..7]` | LE in value |
| PM-32 | 32 | ssid_chunk | bytes[4] | SSID ASCII bytes `[8..11]` | LE in value |
| PM-33 | 33 | ssid_chunk | bytes[4] | SSID ASCII bytes `[12..15]` | LE in value |
| PM-34 | 34 | ssid_chunk | bytes[4] | SSID ASCII bytes `[16..19]` | LE in value |
| PM-35 | 35 | ssid_chunk | bytes[4] | SSID ASCII bytes `[20..23]` | LE in value |
| PM-36 | 36 | ssid_chunk | bytes[4] | SSID ASCII bytes `[24..27]` | LE in value |
| PM-37 | 37 | ssid_chunk | bytes[4] | SSID ASCII bytes `[28..31]` | LE in value |
| PM-38 | 38 | metric | bytes | Heap total | Continuous ~10 s |
| PM-39 | 39 | metric | bytes | Heap used | Continuous ~10 s |
| PM-40 | 40 | metric | percent | Heap used % (0…100) | Continuous ~10 s |
| PM-41 | 41 | metric | bytes | Task `aws_iot_demo` stack HWM | Continuous ~10 s |
| PM-42 | 42 | metric | bytes | Task `mqtt_stream` stack HWM | Continuous ~10 s |
| PM-43 | 43 | metric | bytes | Task `audio_packetizer` stack HWM | Continuous ~10 s |
| PM-44 | 44 | metric | bytes | Task `spi_audio_rx` stack HWM | Continuous ~10 s |
| PM-45 | 45 | metric | bytes | Task `mqtt_process_task` stack HWM | Continuous ~10 s |
| PM-46 | 46 | metric | bytes | Task `temp_ack_retry` stack HWM | Continuous ~10 s |
| PM-47 | 47 | metric | bytes | Task `audio_ctrl_pub` stack HWM | Continuous ~10 s |
| PM-48 | 48 | metric | bytes | Task `mqtt_health_task` stack HWM | Continuous ~10 s |
| PM-49 | 49 | metric | centi-°C | ESP32-C6 on-chip die temperature (signed; ÷100 → °C) | Continuous ~10 s |

### SSID rebuild (server)

Same `device_id` + same `event_time_s` (and consecutive PM-29…37 in bucket order):

```text
len  = value(PM-29)
raw  = concat( LE_bytes(value(PM-30)) … LE_bytes(value(PM-37)) )  // 32 bytes
ssid = raw[0:len] as ASCII/UTF-8
```

---

## 4. SD status chunks — enter all (family 25 / `0x19`)

STM UART CMD `0x5B`, **no ACK**.

Wire: `[AA][LEN=0x4C][5B][74-byte payload][CHK][55]`. `LEN = CMD(1)+payload(74)+CHK(1)`. No ACK.  
This firmware **accepts only V4** (older `0x41`/`0x45`/`0x49` rejected).

| Version | LEN | Payload | ESP store |
|---------|-----|---------|-----------|
| V4 (current) | `0x4C` | 74 B (+ MCU temp) | SD-01…19 |
| ~~V1~~ | `0x41` | 63 B | rejected |
| ~~V1.5~~ | `0x45` | 67 B | rejected |
| ~~V2~~ | `0x49` | 71 B | rejected |

| code | code_id | kind | unit | meaning |
|------|---------|------|------|---------|
| SD-01 | 1 | status_chunk | bytes[4] | STM status payload `[0..3]` |
| SD-02 | 2 | status_chunk | bytes[4] | `[4..7]` |
| SD-03 | 3 | status_chunk | bytes[4] | `[8..11]` |
| SD-04 | 4 | status_chunk | bytes[4] | `[12..15]` |
| SD-05 | 5 | status_chunk | bytes[4] | `[16..19]` |
| SD-06 | 6 | status_chunk | bytes[4] | `[20..23]` |
| SD-07 | 7 | status_chunk | bytes[4] | `[24..27]` |
| SD-08 | 8 | status_chunk | bytes[4] | `[28..31]` |
| SD-09 | 9 | status_chunk | bytes[4] | `[32..35]` |
| SD-10 | 10 | status_chunk | bytes[4] | `[36..39]` |
| SD-11 | 11 | status_chunk | bytes[4] | `[40..43]` |
| SD-12 | 12 | status_chunk | bytes[4] | `[44..47]` |
| SD-13 | 13 | status_chunk | bytes[4] | `[48..51]` |
| SD-14 | 14 | status_chunk | bytes[4] | `[52..55]` |
| SD-15 | 15 | status_chunk | bytes[4] | `[56..59]` |
| SD-16 | 16 | status_chunk | bytes[4] | `[60..63]` |
| SD-17 | 17 | status_chunk | bytes[4] | `[64..67]` (`heap_min` hi + `battery_pct`) |
| SD-18 | 18 | status_chunk | bytes[4] | `[68..71]` (`battery_chg`, `battery_mV`, `mcu_temp_c` lo) |
| SD-19 | 19 | status_chunk | bytes[4] | `[72..73]` + pad (`mcu_temp_c` hi, `mcu_temp_ok`) |

### Reassemble STM status

```text
n = 19
for i in 1..n:
    out[(i-1)*4 : (i-1)*4+4] = LE_bytes(value(SD-i))
payload = out[0:74]
```

### Field map after reassembly (enter as derived columns / JSON)

| Off | Type | name | meaning / enum |
|-----|------|------|----------------|
| 0 | u16 | session_id | STM boot session (same idea as 0x59) |
| 2 | u16 | seq | Status sequence (independent of alert seq) |
| 4 | u8 | kind | 0=health, 1=UI |
| 5 | u8 | screen | 0 LOGO, 1 WIFI_Connect, 2 Home, 3 WIFI_QR, 4 TempProbe, 5 TempProcess, 6 TempResult, 7 ManualID, 8 Examination, 9 Auscultation, 10 Charging |
| 6 | u8 | wifi_status | 0 Connecting, 1 Connected, 2 Error |
| 7 | u8 | wifi_rssi_cat | 1…5 bars (5=no signal) |
| 8 | u8 | mqtt | 0/1 |
| 9 | u8 | audio_streaming | 0/1 |
| 10 | u8 | audio_type | currentAudioTypeCode |
| 11 | u8 | button | 255=none; 0 select, 1 up, 2 right, 3 down, 4 left, 5 back, 6 home |
| 12 | u8 | action | 0 none, 1 screen_enter, 10 Home select, 11 Home back/home, 20 Exam select, 30 Temp sample, 31 Temp save, 40 stream start, 41 stream stop, 42 Aus back, 50 QR nav |
| 13 | u8 | button_age_s | seconds since last button/action (cap 255) |
| 14 | u32 | heap_total_B | STM FreeRTOS heap total |
| 18 | u32 | heap_free_B | free bytes |
| 22 | u32 | heap_used_B | used bytes |
| 26 | u8 | heap_pct | 0…100 |
| 27 | u32 | upload_kbps | kb/s integer |
| 31 | u8 | mqtt_q_pct | 0…100 |
| 32 | u8 | ring_pct | 0…100 |
| 33 | u16 | jitter_mad_ms | ms |
| 35 | u16 | esp32_used_B | Esp32Task stack used |
| 37 | u16 | esp32_total_B | Esp32Task stack total |
| 39 | u16 | gui_used_B | |
| 41 | u16 | gui_total_B | |
| 43 | u16 | audio_used_B | |
| 45 | u16 | audio_total_B | |
| 47 | u16 | usb_used_B | |
| 49 | u16 | usb_total_B | |
| 51 | u16 | temp1_used_B | |
| 53 | u16 | temp1_total_B | |
| 55 | u16 | vitals_used_B | |
| 57 | u16 | vitals_total_B | |
| 59 | u16 | mp2722_used_B | |
| 61 | u16 | mp2722_total_B | |
| 63 | u32 | heap_min_free_B | `xPortGetMinimumEverFreeHeapSize()` |
| 67 | u8 | battery_pct | 0…100 |
| 68 | u8 | battery_chg | 0 idle · 1 charging · 2 complete |
| 69 | u16 | battery_mV | pack mV LE |
| 71 | i16 | mcu_temp_c | STM MCU °C (ignore if `mcu_temp_ok==0`) |
| 73 | u8 | mcu_temp_ok | 0/1 |

All multi-byte fields are **little-endian**.

---

## 5. Bucket / parse constants (server config)

| Key | Value |
|-----|-------|
| Schema header | `X-Diag-Schema: bucket-v1` |
| Body length | **32768** |
| `X-Bucket-Bytes` | **32768** |
| `X-Bucket-Id` | `0`…`3` |
| Bucket `format_ver` | **3** |
| Seal footer offset | **0x7FF8** |
| Record size | 16 |
| Max records / bucket | 2045 |
| Success HTTP | any **2xx** (device then erases that bucket) |

---

## 6. CSV seed (copy into importer)

```csv
code,family_id,code_id,kind,unit,meaning
PR-01,16,1,fault,,Provisioning / setup fault 1
PR-02,16,2,fault,,Provisioning / setup fault 2
PR-03,16,3,fault,,Provisioning / setup fault 3
PR-04,16,4,fault,,Unknown / unsupported UART command
PR-05,16,5,fault,,Provisioning fault 5
UA-01,17,1,fault,,UART read / link error
UA-02,17,2,fault,,UART fault 2
UA-03,17,3,fault,,UART fault 3
UA-04,17,4,fault,,UART driver re-init / recovery
UA-05,17,5,fault,,STM UART silence watchdog
SP-01,18,1,fault,,SPI RX fault 1
SP-02,18,2,fault,,SPI RX fault 2
SP-03,18,3,fault,,SPI fault 3
SP-04,18,4,fault,,Audio ring overflow
SP-05,18,5,fault,,Packetizer fault
WF-01,19,1,fault,,WiFi disconnected
WF-02,19,2,fault,,No AP found
WF-03,19,3,fault,,Lost IP after being online
WF-04,19,4,fault,,WiFi fault 4
TL-01,20,1,fault,,AWS endpoint DNS resolve fail
TL-02,20,2,fault,,AWS endpoint TLS probe fail
TL-03,20,3,fault,,TLS error code on probe fail
TL-04,20,4,fault,,MQTT TLS send/recv path fault
TL-05,20,5,fault,,AWS endpoint not reachable
MQ-01,21,1,fault,,MQTT connect / session failed
MQ-02,21,2,fault,,MQTT CONNACK timeout / broker silent
MQ-03,21,3,fault,,MQTT receive failed
MQ-04,21,4,fault,,MQTTNoMemory
MQ-05,21,5,fault,,MQTT send failed
MQ-06,21,6,fault,,MQTT keepalive timeout
MQ-07,21,7,fault,,Subscribe send failed
MQ-08,21,8,fault,,SUBACK topic rejected
MQ-09,21,9,fault,,MQTT illegal state
MQ-10,21,10,fault,,MQTT server refused
MQ-23,21,23,fault,,Stream / publish path fault
ES-01,22,1,fault,,OTA malloc fail
ES-02,22,2,fault,,Task create fail / coredump path
ES-03,22,3,fault,,Boot after WDT reset
ES-04,22,4,fault,,Boot after panic
ES-05,22,5,fault,,Boot after brownout
ES-06,22,6,fault,,Core-dump present
ES-07,22,7,fault,,Core-dump upload fail
ES-08,22,8,fault,,Core-dump partition issue
ES-09,22,9,fault,,Free heap < 40 KB
ES-10,22,10,fault,,Min heap < 32 KB
ES-11,22,11,fault,,mqtt_process stack HWM < 512 B
OT-01,23,1,fault,,OTA HTTP status error
OT-02,23,2,fault,,OTA flash begin/write fail
OT-03,23,3,fault,,OTA pending NVS fail
OT-04,23,4,fault,,STM OTA protocol/UART fail
OT-05,23,5,fault,,OTA URL too long
OT-06,23,6,fault,,OTA HTTP client init fail
OT-07,23,7,fault,,OTA HTTP open fail
OT-08,23,8,fault,,OTA download stream fail
OT-09,23,9,fault,,OTA download empty
OT-10,23,10,fault,,OTA invalid image magic
OT-11,23,11,fault,,OTA task create fail
OT-12,23,12,fault,,OTA URL truncated
OT-13,23,13,fault,,OTA URL buffer alloc fail
OT-14,23,14,fault,,OTA job missing/malformed URL
OT-15,23,15,fault,,OTA finalize/boot partition fail
OT-16,23,16,fault,,STM OTA URL size fetch fail
OT-17,23,17,fault,,OTA partition erase fail
PM-01,24,1,metric,bytes,Free heap
PM-02,24,2,metric,bytes,Min free heap
PM-03,24,3,metric,bytes,Largest free block
PM-04,24,4,metric,bytes,mqtt_process stack HWM
PM-05,24,5,metric,dBm,WiFi RSSI (signed)
PM-06,24,6,metric,count,WiFi reconnect count
PM-07,24,7,metric,count,MQTT disconnect count
PM-08,24,8,metric,s,Uptime
PM-09,24,9,metric,0/1,WiFi connected
PM-10,24,10,metric,0/1,WiFi has IP
PM-11,24,11,metric,0/1,Internet / AWS path OK
PM-12,24,12,metric,0/1,MQTT connected
PM-13,24,13,metric,0/1,WiFi reconnecting
PM-14,24,14,metric,index,WiFi network index 1-based
PM-15,24,15,metric,hash,SSID FNV-1a
PM-16,24,16,metric,ms,MQTT ping RTT
PM-17,24,17,metric,count,Temp cloud-ACK queue depth
PM-18,24,18,metric,count,MQTT outbox pending
PM-19,24,19,metric,count,MQTT event queue length
PM-20,24,20,metric,bytes,Internal RAM free
PM-21,24,21,metric,bytes,diag_mgr stack HWM
PM-22,24,22,metric,bytes,uart_rx stack HWM
PM-23,24,23,metric,bytes,mqtt_diag stack HWM
PM-24,24,24,metric,channel,WiFi channel
PM-25,24,25,metric,ms,Last DNS resolve
PM-26,24,26,metric,ms,Last TLS duration
PM-27,24,27,metric,0/1,AWS path reachable
PM-28,24,28,metric,0/1,SNTP time trusted
PM-29,24,29,ssid_meta,chars,SSID length
PM-30,24,30,ssid_chunk,bytes4,SSID bytes 0-3
PM-31,24,31,ssid_chunk,bytes4,SSID bytes 4-7
PM-32,24,32,ssid_chunk,bytes4,SSID bytes 8-11
PM-33,24,33,ssid_chunk,bytes4,SSID bytes 12-15
PM-34,24,34,ssid_chunk,bytes4,SSID bytes 16-19
PM-35,24,35,ssid_chunk,bytes4,SSID bytes 20-23
PM-36,24,36,ssid_chunk,bytes4,SSID bytes 24-27
PM-37,24,37,ssid_chunk,bytes4,SSID bytes 28-31
PM-38,24,38,metric,bytes,Heap total
PM-39,24,39,metric,bytes,Heap used
PM-40,24,40,metric,percent,Heap used percent
PM-41,24,41,metric,bytes,aws_iot_demo stack HWM
PM-42,24,42,metric,bytes,mqtt_stream stack HWM
PM-43,24,43,metric,bytes,audio_packetizer stack HWM
PM-44,24,44,metric,bytes,spi_audio_rx stack HWM
PM-45,24,45,metric,bytes,mqtt_process_task stack HWM
PM-46,24,46,metric,bytes,temp_ack_retry stack HWM
PM-47,24,47,metric,bytes,audio_ctrl_pub stack HWM
PM-48,24,48,metric,bytes,mqtt_health_task stack HWM
PM-49,24,49,metric,centi_c,ESP chip die temperature (signed int32; divide by 100 for C)
SD-01,25,1,status_chunk,bytes4,STM 0x5B payload 0-3
SD-02,25,2,status_chunk,bytes4,STM 0x5B payload 4-7
SD-03,25,3,status_chunk,bytes4,STM 0x5B payload 8-11
SD-04,25,4,status_chunk,bytes4,STM 0x5B payload 12-15
SD-05,25,5,status_chunk,bytes4,STM 0x5B payload 16-19
SD-06,25,6,status_chunk,bytes4,STM 0x5B payload 20-23
SD-07,25,7,status_chunk,bytes4,STM 0x5B payload 24-27
SD-08,25,8,status_chunk,bytes4,STM 0x5B payload 28-31
SD-09,25,9,status_chunk,bytes4,STM 0x5B payload 32-35
SD-10,25,10,status_chunk,bytes4,STM 0x5B payload 36-39
SD-11,25,11,status_chunk,bytes4,STM 0x5B payload 40-43
SD-12,25,12,status_chunk,bytes4,STM 0x5B payload 44-47
SD-13,25,13,status_chunk,bytes4,STM 0x5B payload 48-51
SD-14,25,14,status_chunk,bytes4,STM 0x5B payload 52-55
SD-15,25,15,status_chunk,bytes4,STM 0x5B payload 56-59
SD-16,25,16,status_chunk,bytes4,STM 0x5B payload 60-63
SD-17,25,17,status_chunk,bytes4,STM 0x5B payload 64-67 (heap_min hi / battery_pct)
SD-18,25,18,status_chunk,bytes4,STM 0x5B payload 68-71 (battery chg/mV + mcu_temp_c lo)
SD-19,25,19,status_chunk,bytes4,STM 0x5B payload 72-73 + pad (mcu_temp_c hi + mcu_temp_ok)
```

---

Firmware sources: `main/diag_registry.h`, `main/mqtt_diag.c`, `main/diag_manager.c`  
Parse contract: [`DIAG_HTTPS_SERVER_API.md`](DIAG_HTTPS_SERVER_API.md)
