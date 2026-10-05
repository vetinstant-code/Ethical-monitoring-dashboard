# STM ↔ ESP Cloud Stability Protocol

**Frame:** `[0xAA][LEN][CMD][PAYLOAD…][XOR checksum][0x55]` (same as existing UART protocol)

---

## New commands

| CMD | Dir | Name | Purpose |
|-----|-----|------|---------|
| `0x56` | STM→ESP | `CMD_CLOUD_PROBE_REQ` | Run short MQTT uplink capacity probe before streaming |
| `0x57` | ESP→STM | `CMD_CLOUD_PROBE_RESP` | Probe result: GOOD / UNSTABLE / CANT |
| `0x58` | ESP→STM | `CMD_CLOUD_WARN` | Mid-stream (or anytime) cloud quality warning |
| `0x55` | ESP→STM | `CMD_TEMP_CLOUD_ACK` | Unchanged; **status=0** = upload failed, please retry |

---

## `0x56` CMD_CLOUD_PROBE_REQ (STM → ESP)

| Byte | Field |
|------|--------|
| (optional) `[0]` | Duration seconds `2`–`8` (default **4** if omitted) |

ESP publishes dummy ~516 B MQTT packets at ~16 pkt/s for that window (same path as audio).  
Must **not** run while audio streaming.

---

## `0x57` CMD_CLOUD_PROBE_RESP (ESP → STM)

| Byte | Field |
|------|--------|
| `[0]` | `result`: `0x00` DOWN/CANT stream, `0x01` UNSTABLE, `0x02` GOOD |
| `[1]` | Achieved `pkt/s` (0–255) |
| `[2..3]` | `max_block_ms` LE |
| `[4..5]` | `duration_ms` LE |
| `[6]` | `mqtt_connected` 0/1 |

**STM UX suggestion**

- `0x02` → allow auscultation  
- `0x01` → warn “Internet not stable for cloud saving”; allow if user continues  
- `0x00` → warn cannot rely on cloud / fix network  

---

## `0x58` CMD_CLOUD_WARN (ESP → STM, unsolicited)

| Byte | Field |
|------|--------|
| `[0]` | `quality`: `0` DOWN, `1` UNSTABLE, `2` OK |
| `[1]` | `context`: `0` idle, `1` streaming, `2` probe |
| `[2]` | `pkt_per_sec` (hint, may be 0) |
| `[3]` | `queue_pct` (hint, may be 0) |

During streaming, ESP sends this when live metrics degrade (`CLOUD_UNSTABLE`).  
STM can show: **“Network fluctuation / streaming instability detected.”**

---

## Temp upload fail → please retry (`0x55` status=0)

Existing `CMD_TEMP_CLOUD_ACK` (`0x55`):

| Byte | Field |
|------|--------|
| `[0]` | `1` = cloud ACK success (unchanged) |
| `[0]` | `0` = **upload failed — please try again** (now used) |
| `[1]` | message_id length |
| `[2..]` | message_id |

**ESP behavior:** retries MQTT publish every 3 s. If **no cloud ACK within 6 s**, sends `0x55` with `status=0`, drops that queue item.  
**STM behavior:** on `status=0`, re-send temp packet (`0x0B`). On later `status=1`, treat as success (same as today).

---

## MQTT lifecycle / publish diagnostics (ESP logs)

Filter serial for:

| Tag | Meaning |
|-----|---------|
| `[MQTT_LIFECYCLE] stage=TLS_START/OK/FAIL` | TLS step |
| `[MQTT_LIFECYCLE] stage=CONNACK_WAIT/OK/FAIL` | MQTT CONNECT→CONNACK |
| `[PUB_BACKPRESSURE]` | Slow `MQTT_Publish` + WiFi RSSI classify |
| `[TCP_SEND_STALL]` | TLS/TCP send waited (buffer / uplink) |

---

## Also already in firmware

- Never-give-up MQTT reconnect while WiFi+IP  
- Adaptive CONNACK from TLS duration  
- Stream intent + auto-resume after MQTT reconnect  
