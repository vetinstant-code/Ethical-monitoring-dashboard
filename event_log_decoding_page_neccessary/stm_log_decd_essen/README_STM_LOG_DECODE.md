# STM log decode essentials (`stm_log_decd_essen`)

Snapshot of everything needed to decode STM↔ESP diagnostic / health logs for the **current** DATACOLLCTION firmware flow.

**Source tree:** `NEED_CHANGES/VETINSTANT_DATACOLLCTION_FINAL`  
**As of:** 0x5B **v4** (74-byte payload, `LEN=0x4C`, battery + MCU die temp)

---

## Files in this folder

| File | Use for |
|------|---------|
| `COMPONENT_DIAGNOSTIC_ANALYSIS.md` | **Primary architecture** — families, alert contract, full `0x5B` field map, screens/buttons/actions, ESP verify checklist |
| `STM_ESP_Diagnostic_Codebook.xlsx` | **Excel codebook** — all `0x59` codes + `0x5B` field sheet + wire examples + flow rates |
| `_gen_codebook_xlsx.py` | Regenerates the Excel from the same source lists |
| `changes_02_10_26.md` | Change log for dual-pipe diag (`0x59`/`0x5A`/`0x5B` v1→v4) |
| `stm_diag.h` | **C registry** — family IDs + per-code `#define`s used on STM |
| `ESP32Task_CMD_registry.h` | Copy of `ESP32Task.h` — UART CMD IDs (`0x59`/`0x5A`/`0x5B`, cloud, OTA, …) |
| `stm_esp_cloud_stability_protocol.md` | Related `0x56`/`0x57`/`0x58` cloud probe/warn frames (SC family context) |

---

## Wire overview (current)

Common frame:

```
[0xAA][LEN][CMD][PAYLOAD…][XOR][0x55]
LEN = CMD(1) + payload + checksum(1)   // START/END not in LEN
XOR = CMD ⊕ all payload bytes
```

| CMD | Dir | LEN | Payload | ACK |
|-----|-----|-----|---------|-----|
| `0x59` | STM→ESP | `0x0D` | 11 B alert | Yes → `0x5A` |
| `0x5A` | ESP→STM | `0x07` | 5 B ACK | — |
| `0x5B` | STM→ESP | **`0x4C`** | **74 B** health/UI | **No ACK** |

### `0x5B` payload tail (v4) — must decode

| Offset | Type | Field |
|--------|------|--------|
| 63 | u32 LE | `heap_min_free_B` |
| 67 | u8 | `battery_pct` |
| 68 | u8 | `battery_chg` (0 idle / 1 charging / 2 complete) |
| 69 | u16 LE | `battery_mV` |
| 71 | i16 LE | `mcu_temp_c` (°C; trust only if ok=1) |
| 73 | u8 | `mcu_temp_ok` |

Older builds used `LEN` `0x49` (71 B), `0x45` (67 B), or `0x41` (63 B). **Current firmware = `0x4C` / 74 B.**

Full 74-byte map: see `COMPONENT_DIAGNOSTIC_ANALYSIS.md` § STM → ESP status / UI (`0x5B`), or Excel sheet `04_Status_0x5B_Fields`.

### `0x59` alert payload (11 B)

| Offset | Field |
|--------|--------|
| 0–1 | `session_id` u16 LE |
| 2–3 | `seq` u16 LE |
| 4 | `family_id` |
| 5 | `code` |
| 6 | `severity` |
| 7 | `flags` |
| 8–9 | `age_ms` u16 LE |
| 10 | `repeat` |

Family/code names: Excel `02_Alert_Codes_0x59` or `stm_diag.h`.

---

## Suggested ESP decode order

1. Match `START`/`END`, compute XOR, branch on `CMD`.
2. For `0x5B`: require `LEN==0x4C`, unpack LE integers, log health + UI enums.
3. For `0x59`: unpack alert, map `family_id`+`code` via codebook, send matching `0x5A`.
4. Do **not** ACK `0x5B`.

---

## Regenerate Excel

From this folder (or the parent tree):

```bash
python _gen_codebook_xlsx.py
```

Output: `STM_ESP_Diagnostic_Codebook.xlsx` (written next to the script).
