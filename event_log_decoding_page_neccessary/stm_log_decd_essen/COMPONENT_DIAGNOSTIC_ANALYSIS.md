# VETINSTANT EXAMD — Component Diagnostic Analysis

Phone-style health / fault map for every IC and subsystem in `VETINSTANT_EXAMD_FINAL`.  
Use this like a modem/radio/PMIC diag log: **what can fail → how the silicon tells you → what firmware already reads → what you can watch or log on screen**.

**MCU:** STM32U575VGT6  
**Firmware root:** `VETINSTANT/`

---

## Quick index — “this part not working”

| Log-style message | Component | How you know |
|-------------------|-----------|--------------|
| `CHG: NOT FOUND` | MP2722 | I2C4 `IsDeviceReady(0x3F)` fails |
| `CHG: INPUT OVP` | MP2722 | REG13 `CHG_FAULT` = `01` |
| `CHG: TIMER FAULT` | MP2722 | REG13 `CHG_FAULT` = `10` |
| `CHG: BATT OVP` | MP2722 | REG13 `CHG_FAULT` = `11` |
| `CHG: THERMAL REG` | MP2722 | REG12 `THERM_STAT` = 1 |
| `CHG: WATCHDOG FAULT` | MP2722 | REG12 `WATCHDOG_FAULT` = 1 |
| `CHG: BATT MISSING` | MP2722 | REG14 `BATT_MISSING` = 1 |
| `CHG: NTC MISSING` | MP2722 | REG14 `NTC_MISSING` = 1 |
| `CHG: NTC HOT/COLD` | NTC via MP2722 | REG14 NTC1/NTC2 JEITA zone |
| `BOOST: OVERLOAD/OTP/BATT_LOW` | MP2722 OTG | REG13 `BOOST_FAULT` |
| `BATT: LOW VOLTAGE` | ADC4 divider | `battery_voltage` &lt; 3.3 V |
| `TEMP: NO PROBE` | TMP117 / MLX90614 / MLX90632 | I2C3 none of 0x48 / 0x5A / 0x3A ACK |
| `TEMP: TMP117 FAIL` | TMP117 | I2C fail / bad DEVICE_ID |
| `TEMP: MLX90614 FAIL` | MLX90614 | I2C fail / sample success &lt; 8 |
| `TEMP: MLX90632 BUSY/BRST` | MLX90632 | STATUS `BUSY` / `BRST` |
| `DAC: NOT RESPONDING` | TLV320DAC32 | I2C1 write fail / no ACK @ 0x18 |
| `MIC: MDF ERROR` | PDM mics | `HAL_MDF_ErrorCallback` |
| `DISP: NO RESPONSE` | ST7789V2 | SPI init / blank (no status reg) |
| `FLASH: ID BAD / BUSY` | MX25L6433F | JEDEC ID / SR WIP stuck |
| `WIFI: NOT CONNECTED / ERROR` | ESP32 | UART `CMD_WIFI_STATUS_RESP` |
| `ESP: NO POWER / NO UART` | ESP32 | PD7/PD3 rail + no packets |
| `SPO2: WRONG DEVICE` | USB SpO2 | PID ≠ `0x505C` |
| `SPO2: DISCONNECTED` | USB SpO2 | host state not READY |
| `TCPP: OCP/OVP/OTP` | TCPP02/03 | FLAG reg (legacy, disabled) |

---

## System bus map

| Bus | Pins | Devices |
|-----|------|---------|
| I2C1 | PB8 SCL / PB9 SDA | TLV320DAC32 @ **0x18** |
| I2C3 | PC0 SCL / PC1 SDA | TMP117 **0x48**, MLX90632 **0x3A**, MLX90614 **0x5A** |
| I2C4 | PB6 SCL / PD13 SDA | MP2722 @ **0x3F** |
| SPI1 | PA5/PA7 + GPIO | ST7789V2 LCD |
| SPI2 | PB12/13, PC2/3 | ESP32 PCM audio |
| USART3 | — | ESP32 command UART @ 115200 |
| SAI1 | PE2/4/5/6 | DAC I2S |
| MDF1 | PB1, PD6, PE9 | Dual PDM mics |
| OCTOSPI1 | PA2, PB0/10, PE12/14/15 | MX25L6433F |
| USB OTG FS | PA11/PA12 | SpO2 CDC host |
| ADC4 | PA4 | Battery voltage |

### Power / enable GPIOs (rail health)

| Rail | Pin | Meaning if wrong |
|------|-----|------------------|
| Temp probe power | **PD4** | Sensors never ACK on I2C3 |
| DAC + mic power | **PD2** | No audio / MDF silence / DAC NACK |
| ESP power | **PD7** + **PD3** | No WiFi / no UART packets |
| Display power | **PD14** | Black screen |
| Display backlight | **PA0** (TIM2 PWM) | Dim / off but SPI may still work |
| Kill power | **PA6** | Hard power cut |
| Peripheral ON | **PB14** | Board peripheral rail |

---

## 1. MP2722 — Battery charger / PMIC (best diag IC)

**Role:** Single-cell NVDC charger + Type-C CC / OTG  
**Bus:** I2C4 @ `0x3F`  
**Hardware interrupt:** **PC8 → EXTI8 (rising)**  
**Driver:** `Core/Inc/mp2722.h`, `Core/Src/mp2722.c`  
**Task:** `StartMP2722Task` — on INT, sets `mp2722_update_pending` → `MP2722_ReadAllRegisters()`

### How phone-style logging works here

```
INT (PC8) rising
  → HAL_GPIO_EXTI_Callback
  → mp2722_update_pending = 1
  → MP2722 task reads REG00–REG16
  → Decode REG11–REG16 bits into fault/status
```

### Presence check

```c
HAL_I2C_IsDeviceReady(&hi2c4, (0x3F << 1), 1, 100);
// fail → mp2722_init_status = MP2722_NOT_FOUND → "CHG: NOT FOUND"
```

### Status / fault registers (already in firmware)

| Reg | Name | What it tells you |
|-----|------|-------------------|
| **0x11** | Input / DPDM | `IINDPM_STAT`, `VINDPM_STAT`, USB BC1.2 type (`DPDM_STAT[3:0]`) |
| **0x12** | Safety / VIN | `WATCHDOG_BARK`, **`WATCHDOG_FAULT`**, `VSYS_STAT`, **`THERM_STAT`**, `LEGACYCABLE`, `VIN_RDY`, `VIN_GD` |
| **0x13** | Charge / boost | **`CHG_FAULT[1:0]`**, **`BOOST_FAULT[2:0]`**, **`CHG_STAT[2:0]`** |
| **0x14** | Battery / NTC | **`NTC1/2_FAULT`**, **`BATT_MISSING`**, **`NTC_MISSING`** |
| **0x15** | Type-C CC | CC1/CC2 source & sink attach status |
| **0x16** | Misc | `AUDIOACC`, `DEBUGACC`, `OTG_NEED`, **`BATT_LOW_STAT`**, `BFET_STAT`, `TOPOFF_ACTIVE` |

### Decode tables (for UI / UART logs)

**CHG_STAT [2:0] (REG13)** — already mapped to `CHARGING_STATUS` / `CHARGING_COMPLETE`:

| Value | Meaning | Suggested log |
|-------|---------|---------------|
| `000` | Not charging | `CHG: IDLE` |
| `001` | Trickle | `CHG: TRICKLE` |
| `010` | Pre-charge | `CHG: PRECHARGE` |
| `011` | Fast charge (CC) | `CHG: FAST` |
| `100` | Constant voltage | `CHG: CV` |
| `101` | Charge done | `CHG: COMPLETE` (`CHARGING_COMPLETE=1`) |

**CHG_FAULT [1:0]:**

| Value | Meaning | Suggested log |
|-------|---------|---------------|
| `00` | OK | — |
| `01` | Input overvoltage (latch) | `CHG: FAULT INPUT_OVP` |
| `10` | Charge timer expired (latch) | `CHG: FAULT TIMER` |
| `11` | Battery overvoltage (latch) | `CHG: FAULT BATT_OVP` |

**BOOST_FAULT [2:0]:**

| Value | Meaning | Suggested log |
|-------|---------|---------------|
| `000` | OK | — |
| `001` | Overload / short (latch) | `BOOST: FAULT OVERLOAD` |
| `010` | Boost OVP (auto-recover) | `BOOST: FAULT OVP` |
| `011` | Boost over-temp (latch) | `BOOST: FAULT OTP` |
| `100` | Battery too low for boost | `BOOST: FAULT BATT_LOW` |

**NTC JEITA zone (NTC1/NTC2 3-bit):**

| Value | Zone | Suggested log |
|-------|------|---------------|
| `000` | Normal | `NTC: NORMAL` |
| `001` | Warm | `NTC: WARM` |
| `010` | Cool | `NTC: COOL` |
| `011` | Cold | `NTC: COLD` |
| `100` | Hot | `NTC: HOT` |

### Live Expressions already available

```
mp2722_init_status
mp2722_detected_address
mp2722_read_status
mp2722_all_regs[0] … mp2722_all_regs[22]
mp2722_reg_11_value … mp2722_reg_16_value
mp2722_reg_12_bits[0..7]   // WATCHDOG, THERM, VIN_RDY, …
mp2722_reg_13_bits[0..7]   // CHG_FAULT, BOOST_FAULT, CHG_STAT
mp2722_reg_14_bits[0..7]   // NTC, BATT_MISSING, NTC_MISSING
CHARGING_STATUS
CHARGING_COMPLETE
mp2722_update_pending
```

### APIs

- `MP2722_Init()`
- `MP2722_ReadAllRegisters()`
- `MP2722_ReadStatusRegisters()` — REG11–16 only (fast fault poll)
- `MP2722_ReadOperationalRegisters()` — REG00–10 config

---

## 2. Battery pack + ADC (voltage / %)

**Sense:** ADC4 channel on **PA4**, divider R1=26 Ω / R2=100 Ω  
**Driver:** `battery_monitor.c` / `.h`  
**No dedicated “battery fuel-gauge IC”** — percent is a linear map 3.3–4.2 V.

| Variable / API | Diagnostic use |
|----------------|----------------|
| `battery_voltage` | Real pack voltage (after divider math) |
| `battery_percent` | 0–100 UI value |
| `Battery_GetVoltage()` / `Battery_GetPercent()` | App queries |
| `battery_voltage < 3.3f` | Stub for low-batt sleep (commented) |

**Cross-check with MP2722:**  
`BATT_LOW_STAT` (REG16), `BATT_MISSING` (REG14), `CHG_STAT`, `BFET_STAT` (charging vs discharging).

**Suggested logs:**  
`BATT: 3.85V 62%` · `BATT: CRITICAL <3.3V` · `BATT: MISSING (charger)`

---

## 3. Temperature probes (I2C3, power PD4)

Firmware auto-detects **one** of three probes via `HAL_I2C_IsDeviceReady` in `app_freertos.c`:

| Priority | IC | Addr | Type |
|----------|----|------|------|
| 1 | **TMP117** | `0x48` | Contact |
| 2 | **MLX90632** | `0x3A` | Medical IR |
| 3 | **MLX90614** | `0x5A` | IR forehead |

`debug_sensor_address` is set to whichever was found (`0x48` / `0x3A` / `0x5A`).

---

### 3a. TMP117 (TI precision contact)

**Registers (driver):**

| Reg | Addr | Diagnostic use |
|-----|------|----------------|
| TEMP_RESULT | `0x00` | Live °C (`× 0.0078125`) |
| CONFIG | `0x01` | Mode / conversion / alert config |
| T_HIGH / T_LOW | `0x02` / `0x03` | Thresholds (ALERT compare) |
| TEMP_OFFSET | `0x07` | Calibration offset |
| DEVICE_ID | `0x0F` | Must be **0x0117** — ID mismatch = wrong/dead chip |

**Hardware ALERT pin:** TMP117 has an open-drain **ALERT** pin for high/low limit.  
**This board does not wire/use ALERT in firmware** — diagnosis is I2C-only today.

**How firmware detects failure:**

1. Power PD4 ON  
2. `IsDeviceReady(0x48)`  
3. Read loop; on fail → re-check ready → exit if gone  
4. `tmp117_cancel_flag` for user abort  

**Suggested logs:**  
`TEMP: TMP117 OK ID=0x0117` · `TEMP: TMP117 NACK` · `TEMP: TMP117 READ FAIL`

---

### 3b. MLX90614 (Melexis IR)

**RAM / EEPROM:**

| Addr | Name | Use |
|------|------|-----|
| `0x06` | TA | Ambient |
| `0x07` | TOBJ1 | Object / forehead |
| `0x08` | TOBJ2 | Second object (if dual) |
| `0x24` | Emissivity EEPROM | Must be sane (skin ~0.98) |
| `0x25` | Config | Dual/single, IIR, etc. |

**No dedicated FAULT INT pin used.** Failure modes:

- I2C NACK → probe missing / PD4 off / cable  
- Raw `0x0000` / `0xFFFF` treated as bad in driver  
- Averaging: `debug_mlx90614_successful_samples` should be **8**  

**Live Expressions:** see `mlx90614_live_expressions.md`

**Suggested logs:**  
`TEMP: MLX90614 OK` · `TEMP: MLX90614 FAIL samples=3/8` · `TEMP: MLX90614 NACK`

---

### 3c. MLX90632 (Melexis medical IR)

**Status register `0x3FFF`:**

| Bit | Name | Diagnostic meaning |
|-----|------|--------------------|
| 10 | `BUSY` | Measurement in progress |
| 9 | `EE_BUSY` | EEPROM busy — don’t write |
| 8 | `BRST` | **Brown-out reset** — power glitch / rail drop |
| 6:2 | `CYCLE_POS` | Measurement table position |
| 0 | `DATA_RDY` | New data ready |

Also: control `0x3001`, I2C addr reg `0x3000`, EEPROM version `0x240B`.

**Suggested logs:**  
`TEMP: MLX90632 DATA_RDY` · `TEMP: MLX90632 BROWN_OUT` · `TEMP: MLX90632 EE_BUSY` · `TEMP: MLX90632 TIMEOUT`

---

## 4. TLV320DAC32 — Audio DAC

**Bus:** I2C1 @ **0x18** (HAL uses `0x18<<1`)  
**Audio:** SAI1 I2S  
**Power:** **PD2** (`DAC_Mic_PowerOn` / `Off`)  
**Driver:** `dac_config.c` / `.h`

### What exists today

- Write-only init sequence (page 0 clocks, routing, HP unmute)  
- Volume reg **`0x2B`**  
- `dac_config->debug_init_status` (0 = not done, 1 = init ran)  
- **No status-register poll, no GPIO interrupt**

### How to diagnose “DAC not working”

| Check | Method | Log |
|-------|--------|-----|
| Power rail | PD2 high? | `DAC: POWER OFF` |
| I2C ACK | `IsDeviceReady(0x18)` | `DAC: NACK` |
| Init | `debug_init_status` | `DAC: INIT FAIL` |
| Volume path | Read back `0x2B` after write | `DAC: VOL MISMATCH` |
| I2S clocks | Scope / SAI state | `DAC: NO I2S` |

TLV320 family typically has page/status regs for PLL lock / DAC power — **not read in this project yet**; add read-back if you want richer logs.

---

## 5. Dual PDM MEMS microphones

**Interface:** STM32 **MDF1** (not a discrete I2C mic driver)  
**Pins:** SDI0 **PB1**, SDI1 **PD6**, clock **PE9**  
**Power:** same as DAC (**PD2**)  
**Part number:** not named in firmware (generic PDM MEMS)

### Fault path

`HAL_MDF_ErrorCallback()` in `main.c` — overflow, filter overrun, clock absence, short-circuit detection (HAL capability).

| Symptom | Likely cause | Log |
|---------|--------------|-----|
| Silence both channels | PD2 off / clock missing | `MIC: NO CLOCK / POWER` |
| One channel dead | Mic or SDI trace | `MIC: CH0 FAIL` / `CH1 FAIL` |
| Callback fires | Overrun / CK absence | `MIC: MDF_ERROR` |

No per-mic ID register — diagnose via MDF errors + signal energy.

---

## 6. ST7789 / ST7789V2 — LCD

**Bus:** SPI1  
**GPIO:** DC **PC5**, RST **PE7**, CS **PE13**, ON **PD14**, BL **PA0**

**No interrupt / no status register** (typical for this panel). Diagnosis is operational:

| Check | Fail log |
|-------|----------|
| PD14 off | `DISP: POWER OFF` |
| BL PWM 0% | `DISP: BACKLIGHT OFF` |
| SPI init / fill fails | `DISP: SPI FAIL` |
| Visible garbage after RST | `DISP: PANEL / FPC` |

Legacy **ILI9341** mentions exist only as comments.

---

## 7. MX25L6433F — External NOR flash

**Bus:** OCTOSPI1 @ `0x90000000`  
**BSP:** `Drivers/BSP/Components/mx25l6433f/`

| Mechanism | Meaning |
|-----------|---------|
| `MX25L6433F_ReadID` / JEDEC | Wrong ID → wrong/missing flash |
| Status reg cmd `0x05` | **WIP** bit = busy |
| `SR_WEL` | Write enable latch |
| `BSP_MEM_Init(0)` | Init fail in `main.c` |

**Suggested logs:**  
`FLASH: OK ID=…` · `FLASH: BAD ID` · `FLASH: WIP STUCK` · `FLASH: INIT FAIL`

---

## 8. ESP32 — WiFi / cloud radio

**Control:** USART3 packet protocol (`ESP32Task.h`)  
**Audio PCM:** SPI2  
**Power:** PD7 + PD3  

### Protocol “status registers” (UART commands)

| Cmd | Direction | Diagnostic meaning |
|-----|-----------|--------------------|
| `0x01` / `0x02` | WiFi status req/resp | Connected / not / connecting / error / AP not found |
| `0x10` / `0x11` | RSSI | Signal strength |
| `0x12` | WiFi connecting | Standalone ESP→STM connecting notification |
| `0x14` | WiFi failed | Standalone ESP→STM failure notification |
| `0x40` / `0x41` | Audio control | Stream start/stop ACK |
| `0x50`–`0x54` | OTA | Update available / starting / success |
| `0x0D` | Sensor ACK | Cloud got temp/SpO2 |

**WiFi payload codes:**

| Code | Log |
|------|-----|
| `0x00` | `WIFI: NOT_CONNECTED` |
| `0x01` | `WIFI: CONNECTED` |
| `0x13` | `WIFI: CONNECTING` |
| `0x03` | `WIFI: ERROR` |
| `0x15` | `WIFI: SUITABLE/CONFIGURED AP NOT FOUND` |

GUI watches `Wifistatus`, `wifistength`, `debug_wifi_status` in `Model.cpp`.

**Hardware-level:** no ESP GPIO fault line to STM — if UART silent after `ESP32_PowerOn()`, log `ESP: NO RESPONSE`.

---

## 9. USB SpO2 probe (external)

**Link:** USB OTG FS Host CDC  
**Expected PID:** **`0x505C`** (`spo2_pid` in `main.c`)

| Flag / check | Log |
|--------------|-----|
| `Check_USB_Device_PID` match | `SPO2: READY` |
| Wrong PID | `SPO2: WRONG_DEVICE` (`wrong_device_error=1`) |
| Not READY | `SPO2: DISCONNECTED` |
| CDC TX/RX timeout | `SPO2: CDC TIMEOUT` |
| `spo2_running_state` | Measuring vs stopped |

Data fields: `spo2_value`, HR, `status_flag` from device packet.

---

## 10. TCPP02 / TCPP03 — USB-C port protector (legacy / disabled)

**In tree but not the active charge path** (MP2722 used instead).  
**I2C:** `0x68` / `0x6A`  
**FLAG pin:** **PB3** `UCPD_FLAG`  
**Enable:** **PE10** `UCPD_ENABLE`

**FLAG register (`0x02`) capabilities in BSP:**

| API | Fault |
|-----|-------|
| `GetOCPVBusFlag` | VBUS over-current |
| `GetOCPVConnFlag` | VCONN over-current |
| `GetOVPVBusFlag` | VBUS over-voltage |
| `GetOVPCCFlag` | CC over-voltage |
| `GetOTPFlag` | Over-temperature |
| `GetVBusOkFlag` | VBUS OK |

If you re-enable USB-PD path, these are the phone-style Type-C protector logs.

---

## 11. STM32U575 — MCU / platform diagnostics

Not an external IC, but needed for system logs:

| Area | Mechanism |
|------|-----------|
| HardFault / MemManage | Fault handlers in `stm32u5xx_it.c` |
| I2C bus hang | HAL timeout on Mem_Read/Write |
| FreeRTOS | Task stack / assert |
| Sleep / Stop | `power_stage`, SELECT wake on **PC13** |
| Buttons | PE3/8/11, PB2/7, PD10 — stuck GPIO = “button not working” |

---

## Recommended “Diag Menu” / UART banner (implementation sketch)

Poll or event-driven; print one line per subsystem:

```
=== EXAMD HEALTH ===
MCU: OK
CHG: OK VIN_GD=1 STAT=FAST FAULT=0 NTC=NORMAL BATT_MISS=0
BATT: 3.91V 74%
TEMP: MLX90614@0x5A OK samples=8/8
DAC: OK vol=0x00
MIC: OK
DISP: ON BL=80%
FLASH: OK
ESP: WIFI CONNECTED RSSI=-52
SPO2: DISCONNECTED
====================
```

### Event sources to hook

| Event | Source |
|-------|--------|
| Charger change | PC8 INT → read REG11–16 |
| Probe plug | PD4 ON + I2C scan 0x48/0x3A/0x5A |
| WiFi change | `CMD_WIFI_STATUS_RESP` |
| SpO2 plug | USB host READY + PID check |
| Mic fault | `HAL_MDF_ErrorCallback` |
| Low battery | ADC + MP2722 `BATT_LOW_STAT` |

---

## What firmware already has vs gaps

| Component | Interrupt / event | Status regs read today | Gap for phone-like UI |
|-----------|-------------------|------------------------|------------------------|
| **MP2722** | PC8 EXTI | Full REG11–16 + bit arrays | Map bits → human strings on screen / UART |
| **Battery ADC** | DMA complete | Voltage/% | Low-batt popup (stub exists) |
| **TMP117** | None (ALERT unused) | Temp + ready poll | Read `DEVICE_ID`; wire ALERT if PCB allows |
| **MLX90614** | None | TA/TOBJ + sample counters | Emit FAIL if samples &lt; 8 |
| **MLX90632** | None | STATUS in Melexis lib | Surface `BRST` / timeout to UI |
| **TLV320DAC32** | None | Init flag only | I2C ready + read-back |
| **PDM mics** | MDF error CB | Callback stub | Log + UI banner |
| **ST7789** | None | None | Power/BL state only |
| **MX25L6433F** | None | Init / ID / WIP | Check ID at boot |
| **ESP32** | UART packets | WiFi/RSSI/OTA | `ESP: NO RESPONSE` timeout |
| **USB SpO2** | USB host | PID + CDC | Already has wrong-device flag |
| **TCPP** | FLAG pin | BSP APIs | Disabled — ignore unless re-enabled |

---

## File cheat sheet

| Topic | Path |
|-------|------|
| MP2722 regs / INT | `VETINSTANT/Core/Inc/mp2722.h`, `Core/Src/mp2722.c`, EXTI in `main.c` |
| MP2722 task | `app_freertos.c` → `StartMP2722Task` |
| Battery | `battery_monitor.c` |
| Temp detect | `app_freertos.c`, `TEMP SENSORS/` |
| MLX90614 debug | `mlx90614_live_expressions.md` |
| DAC | `dac_config.c` |
| ESP protocol | `ESP32Task.h`, `ESP32task.c` |
| SpO2 | `main.c` (`Check_USB_Device_PID`, `CDC_HANDLE`) |
| Flash | `Drivers/BSP/Components/mx25l6433f/` |
| TCPP (legacy) | `Drivers/BSP/Components/tcpp0203/` |
| Power rails | `main.h`, `POWER_MANAGEMENT_DOCUMENTATION.md` |

---

## Bottom line

- **MP2722 is the only IC with a true hardware fault interrupt + rich status/fault register map already wired** (same idea as a phone PMIC diag).  
- **Temp sensors / DAC / flash / ESP / SpO2** are diagnosable mainly by **I2C/SPI/USB/UART presence + protocol status**, not by a shared FAULT pin.  
- **Display and PDM mics** have almost no silicon status — use power GPIO + error callbacks + signal sanity.  
- To get phone-like “this IC is not working” on the UI, start by **decoding MP2722 REG12–14 on every INT**, then add a boot **I2C/OSPI/USB/UART health scan** for everything else using the tables above.

---

# Unified STM32 Diagnostic Architecture Plan v1.0

**Status:** STM implemented in `VETINSTANT_DATACOLLCTION_FINAL` — `0x59`/`0x5A` alerts + `0x5B` health/UI status. ESP must decode/forward `0x5B` (no ACK required for `0x5B`).

This section is the implementation plan and immutable codebook proposal for all failures the STM can actually observe: communication, runtime, MP2722, I2C, temperature probes, audio hardware, display, external flash, USB SpO2, buttons, and controlled power rails. Status telemetry uses a separate command (`0x5B`).

## 1. Confirmed decisions

- Diagnostic UART command: **`CMD_STM_DIAGNOSTIC = 0x59`**.
- Diagnostic delivery ACK command: **`CMD_STM_DIAGNOSTIC_ACK = 0x5A`** (ESP→STM).
- Status / UI telemetry command: **`CMD_STM_STATUS = 0x5B`** (STM→ESP, integers only; **no ACK**).
- Existing/newer protocol uses `0x55` for temperature cloud ACK and `0x58` for mid-stream cloud warning.
- The former pre-stream cloud-probe commands `0x56/0x57` are obsolete and must not be implemented.
- Send compact codes only; never send verbose diagnostic sentences to ESP/AWS.
- Keep diagnostics in RAM only. Do not write internal flash, external flash, RTC backup, or another persistent store.
- Never transmit from an ISR, EXTI callback, UART RX callback, DMA callback, or fault callback.
- Do not gate STM diagnostic transmission on WiFi, IP, TLS, or MQTT state. Send whenever ESP power/UART is available.
- Pause diagnostic TX only while STM OTA owns USART3, then resume oldest-first draining when OTA releases it.
- A code’s meaning and severity are immutable after release. Changed behavior receives a new number; retired numbers are never reused.
- Physical IC faults are included only when supported by observable evidence. “NACK” means “not responding,” not automatically “chip physically broken.”

## 2. Families and wire IDs

| ID | Family | Owner |
|----|--------|-------|
| `0x01` | `ST` | STM framing and command contract |
| `0x02` | `SU` | STM↔ESP UART link |
| `0x03` | `SA` | STM→ESP audio/SPI transport |
| `0x04` | `SF` | Stream and application flow |
| `0x05` | `SC` | ESP-mediated cloud/WiFi handshake |
| `0x06` | `SS` | STM runtime |
| `0x07` | `SO` | OTA control over UART |
| `0x08` | `PW` | MP2722, battery, charging and power |
| `0x09` | `IB` | I2C bus infrastructure |
| `0x0A` | `TM` | Temperature probes |
| `0x0B` | `AH` | Local DAC/SAI/MDF/microphone hardware |
| `0x0C` | `DP` | ST7789V2 display path |
| `0x0D` | `FM` | MX25L6433F external flash |
| `0x0E` | `UB` | USB host and SpO2 probe |
| `0x0F` | `IO` | Buttons, GPIO and controlled rails |

`ST` is used instead of `SP` because the ESP codebook already uses `SP`; both devices publish to the same diagnostics topic.

- ESP reserves family IDs `0x10–0x17`; STM must never allocate them.
- `(family_id, code_id)` is the globally unique identity. Keep the bytes separate.
- Example: `0x01/0x03 = ST-03`; `0x0A/0x25 = TM-37` because wire code ID `0x25` is decimal 37.
- Do not use or translate through the obsolete ESP `0x97` single-byte mapping.

## 3. Diagnostic UART frames

### STM → ESP event (`0x59`)

```
[0xAA][0x0D][0x59][FAMILY_ID][CODE_ID][REPEAT]
[SESSION_LO][SESSION_HI][SEQ_LO][SEQ_HI]
[AGE0][AGE1][AGE2][AGE3][CHECKSUM][0x55]
```

- Payload is exactly eleven bytes:
  - `family_id` (1 byte)
  - `code_id` (1 byte)
  - `repeat_count` (1 byte)
  - `session_id` (uint16 little-endian)
  - `sequence_id` (uint16 little-endian)
  - `event_age_seconds` (uint32 little-endian)
- `LEN = CMD(1) + payload(11) + checksum(1) = 0x0D`.
- Checksum is XOR of `0x59` and all eleven payload bytes. LEN, START, and END are excluded.
- Example `ST-03` repeated seven times, session `0x1234`, sequence `0x0001`, sent immediately:

```
AA 0D 59 01 03 07 34 12 01 00 00 00 00 00 7B 55
```

- ESP decodes this as `ST-03,7` and forwards it to `vetin/datacol/<THING>/diagnostics`.
- Local debug console prints code-only output such as `E:SU-04`.
- Severity is fixed in the codebook and is not sent in the frame.

### ESP → STM delivery ACK (`0x5A`)

```
[0xAA][0x07][0x5A][SESSION_LO][SESSION_HI]
[SEQ_LO][SEQ_HI][STATUS][CHECKSUM][0x55]
```

- Payload is exactly five bytes: `session_id` uint16 little-endian, `sequence_id` uint16 little-endian, and `status`.
- `LEN = CMD(1) + payload(5) + checksum(1) = 0x07`.
- Checksum is XOR of `0x5A`, both session bytes, both sequence bytes, and status.
- `status=0x01` — accepted: cloud PUBACK received or offline flash committed; STM removes the event.
- `status=0x02` — duplicate already accepted: STM removes the event.
- `status=0x03` — invalid contract: STM removes/quarantines the event and must not retry it forever.
- `status=0x04` — ESP busy/storage failure: STM keeps the event and retries with bounded backoff.
- ESP sends no ACK for malformed framing, invalid LEN, invalid END, or checksum failure; STM retries after ACK timeout.
- Example ACK for session `0x1234`, sequence `0x0001`, accepted:

```
AA 07 5A 34 12 01 00 01 7C 55
```

STM must never dequeue a diagnostic merely because UART TX returned `HAL_OK`. It resends with the same session and sequence until it receives a valid matching `0x5A` with status `0x01` or `0x02`. Status `0x03` terminates retries as a permanent contract rejection; status `0x04` and ACK timeout retain the event.

### STM → ESP status / UI (`0x5B`) — dual channel

Two pipes share USART3 framing; do not overload `0x59` with telemetry.

| Kind | Wire `kind` | When | Purpose |
|------|-------------|------|---------|
| **Health** | `0` | Every **5 s** idle, **10 s** while `audioStreamStart==1`; also **once** on stream start/stop | Heap, per-task stacks, WiFi/MQTT/RSSI, battery, MCU die °C, current screen |
| **UI event** | `1` | On **screen enter** or **button / named action** (edge only) | Catch fast screen hops; button + action codes |

```
[0xAA][0x4C][0x5B][74-byte payload…][CHECKSUM][0x55]
```

- `LEN = CMD(1) + payload(74) + checksum(1) = 0x4C`.
- Checksum is XOR of `0x5B` and all 74 payload bytes.
- **No ESP ACK** for `0x5B` (fire-and-forget; loss is acceptable for telemetry).
- Pause TX under the same rules as `0x59` (OTA pause, `power_stage` 1/2).
- All fields are integers (uint8 / int16 / uint16 / uint32 little-endian). **No floats.**

#### Payload layout (74 bytes)

| Offset | Size | Name | Notes |
|--------|------|------|-------|
| 0 | u16 | `session_id` | Same boot session as `0x59` |
| 2 | u16 | `seq` | Monotonic status sequence (independent of alert seq) |
| 4 | u8 | `kind` | `0`=health, `1`=UI |
| 5 | u8 | `screen` | `ScreenState_t` 0…10 |
| 6 | u8 | `wifi_status` | `0` Connecting, `1` Connected, `2` Error |
| 7 | u8 | `wifi_rssi_cat` | `wifistength` 1…5 (5=no signal) |
| 8 | u8 | `mqtt` | `mqttConnected` 0/1 |
| 9 | u8 | `audio_streaming` | `audioStreamStart` 0/1 |
| 10 | u8 | `audio_type` | `currentAudioTypeCode` |
| 11 | u8 | `button` | `255`=none; `0` select … `6` home |
| 12 | u8 | `action` | See action table; `0`=none on pure health |
| 13 | u8 | `button_age_s` | Seconds since last button/action (cap 255) |
| 14 | u32 | `heap_total_B` | FreeRTOS `configTOTAL_HEAP_SIZE` |
| 18 | u32 | `heap_free_B` | `xPortGetFreeHeapSize()` |
| 22 | u32 | `heap_used_B` | total − free |
| 26 | u8 | `heap_pct` | 0…100 |
| 27 | u32 | `upload_kbps` | `audio_upload_kbps` |
| 31 | u8 | `mqtt_q_pct` | from ESP RSSI metrics |
| 32 | u8 | `ring_pct` | from ESP RSSI metrics |
| 33 | u16 | `jitter_mad_ms` | from ESP RSSI metrics |
| 35 | u16×2 | Esp32Task used_B, total_B | HWM-derived |
| 39 | u16×2 | guiTask | |
| 43 | u16×2 | audioTask | |
| 47 | u16×2 | USB_Task | |
| 51 | u16×2 | temp1Task | |
| 55 | u16×2 | Vitals_Task | |
| 59 | u16×2 | MP2722Task | |
| 63 | u32 | `heap_min_free_B` | `xPortGetMinimumEverFreeHeapSize()` — ESP-style watermark (drops as peak malloc grows; current `heap_free_B` may stay flat if no runtime alloc) |
| 67 | u8 | `battery_pct` | `Battery_GetPercent()` 0…100 |
| 68 | u8 | `battery_chg` | `0` idle/not charging, `1` charging, `2` charge complete (MP2722 `CHARGING_*`) |
| 69 | u16 | `battery_mV` | Pack voltage in millivolts (`Battery_GetVoltage()*1000`, integer) |
| 71 | i16 | `mcu_temp_c` | STM32U575 die temperature °C from ADC1 internal TS (`McuTemp_GetCelsius`); `0` if `mcu_temp_ok==0` |
| 73 | u8 | `mcu_temp_ok` | `1` last ADC1 VREFINT+TS poll OK, `0` fail |

#### Screens (`screen`)

| # | Name |
|---|------|
| 0 | LOGO |
| 1 | WIFI_Connect |
| 2 | Home |
| 3 | WIFI_QR |
| 4 | TempProbe |
| 5 | TempProcess |
| 6 | TempResult |
| 7 | ManualID |
| 8 | Examination |
| 9 | Auscultation |
| 10 | Charging |

#### Buttons (`button`)

| Value | Key |
|-------|-----|
| 255 | none |
| 0 | select |
| 1 | up |
| 2 | right |
| 3 | down |
| 4 | left |
| 5 | back |
| 6 | home |

#### Actions (`action`) — immutable once released

| Value | Meaning |
|-------|---------|
| 0 | none |
| 1 | screen_enter |
| 10 | Home select / enter |
| 11 | Home back/home |
| 20 | Exam select mode |
| 30 | Temp take sample |
| 31 | Temp save/upload |
| 40 | Aus stream **start** |
| 41 | Aus stream **stop** |
| 42 | Aus back/exit |
| 50 | QR/WiFi nav |

#### STM hooks (DATACOLLCTION_FINAL)

- Screen change: `STM_Diag_PerfPoll` / `STM_Diag_NotifyScreenEnter`
- Buttons: `MyButtonController::sample` → `STM_Diag_NotifyButton`
- Stream start/stop: `Model::UpdateAudiostreamingState` → `STM_Diag_NotifyAction(40/41)` + forced health once
- Drain + health timer: `STM_Diag_PerfPoll` (~2 s from `StartMP2722Task`)

#### ESP verify checklist

1. Parse USART3 frames with `CMD==0x5B`, `LEN==0x4C` (74-byte payload; older builds used `0x49`/71, `0x45`/67, or `0x41`/63), XOR OK, `END==0x55`.
2. Decode `heap_min_free_B` at offset 63 like ESP `min free heap` — expect it to drop over life of boot even when `heap_free_B` is flat.
3. Decode battery at offsets 67–70: `battery_pct`, `battery_chg` (0 idle / 1 charging / 2 complete), `battery_mV`.
4. Decode MCU die temp at offsets 71–73: `mcu_temp_c` (i16 LE °C), `mcu_temp_ok` (0/1). Expect ~25–45 °C at room ambient when OK; ignore °C when `ok==0`.
5. `kind==0`: expect period ~5 s idle / ~10 s while `audio_streaming==1`; also one extra health right after stream start/stop UI.
6. `kind==1`: on every screen change (`action==1`) and every debounced button; stream edges show `action` 40 then 41.
7. Cross-check `wifi_status` / `wifi_rssi_cat` / `mqtt` against ESP’s own link state (STM mirrors UI vars).
8. Cross-check `battery_pct` / `battery_chg` against UI battery icon and charger plug state.
9. Heap/stack fields change over time; stacks are used/total bytes per task (not % on wire).
10. Do **not** send `0x5A` for `0x5B`. Keep `0x59`/`0x5A` alert path unchanged.

### Event age

Each queued event retains its original STM tick:

```c
typedef struct
{
    uint8_t family_id;
    uint8_t code_id;
    uint8_t repeat_count;
    uint16_t session_id;
    uint16_t sequence_id;
    uint32_t first_occurrence_tick;
} stm_diag_event_t;
```

At transmission:

```c
event_age_seconds =
    (HAL_GetTick() - event->first_occurrence_tick) / 1000U;
```

ESP assigns the SNTP-aligned event time as `receive_time - event_age_seconds`. The original tick remains unchanged while repeats are coalesced. One-second precision is sufficient. The subtraction is wrap-safe because unsigned tick subtraction is used before conversion.

### Session, sequence, and ACK lifecycle

- Allocate one nonzero uint16 session ID per STM boot/runtime and use it for every diagnostic created in that runtime.
- The session must change after STM reset so ESP cannot confuse a reused sequence with a previous boot. Generate it from an approved boot-unique/entropy source; do not hard-code it.
- Allocate a monotonically advancing uint16 sequence when an event record first enters the TX queue.
- Sequence wraps naturally from `0xFFFF` to `0x0000`; do not reuse a sequence that is still outstanding.
- Only one queue owner may mutate the head event’s send/ACK state.
- After sending `0x59`, mark the event `ACK_PENDING` and start a finite ACK deadline.
- Matching session+sequence with status `0x01` or `0x02` removes the event and advances the queue.
- Matching status `0x03` removes/quarantines the permanently invalid event, records a local contract failure, and advances without an infinite retry loop.
- Matching status `0x04` retains the event and schedules a bounded-backoff retry.
- ACK timeout retains and retransmits the same event with the same session, sequence, repeat count, and first-occurrence tick; age is recalculated for each transmission.
- ACK with a wrong session, unknown/non-head sequence, invalid status, malformed frame, or bad checksum is ignored and must never remove another event.
- ESP identifies an event by `(session_id, sequence_id)`.
- ESP must treat a repeated `0x59` with an already accepted session+sequence as idempotent: do not store/publish another copy; return `0x5A/status=0x02`.
- ESP should retain a durable accepted-key window long enough to cover retries and STM reboot overlap.

This provides at-least-once UART delivery and duplicate suppression using the session+sequence pair. STM queue contents are still lost on STM reset; the new session prevents newly generated post-reset events from colliding with accepted events from the previous boot.

## 4. Communication and runtime codebook

### ST — framing and command contract

- `ST-01 ERROR` — LEN is below 2 or above the protocol maximum; clears on next valid frame.
- `ST-02 ERROR` — END byte is not `0x55`; clears on next valid frame.
- `ST-03 ERROR` — received XOR does not match calculated XOR; clears on next valid frame.
- `ST-04 CRITICAL` — raw RX buffer would overflow; clears after parser reset and a valid frame.
- `ST-05 WARN` — START arrives during a partial frame and forces resynchronization; clears on valid frame.
- `ST-06 ERROR` — partial frame exceeds assembly timeout; clears on valid frame.
- `ST-07 WARN` — valid frame contains unsupported command ID; clears on supported command.
- `ST-08 ERROR` — payload length violates command contract; clears on valid instance of that command.
- `ST-09 ERROR` — nested length exceeds payload bounds; clears on valid command payload.
- `ST-10 ERROR` — STM tries to build an oversized TX payload; clears after valid TX build.
- `ST-11 CRITICAL` — TX checksum self-verification fails; clears after verified build.

### SU — USART3 STM↔ESP link

- `SU-01 ERROR` — USART3 overrun (`ORE`); clears after flag recovery and valid frame.
- `SU-02 ERROR` — framing error (`FE`); clears after recovery and valid frame.
- `SU-03 WARN` — noise error (`NE`); clears after recovery and valid frame.
- `SU-04 ERROR` — parity error (`PE`); clears after recovery and valid frame.
- `SU-05 WARN` — receiver timeout/IDLE with incomplete frame; clears on valid frame.
- `SU-06 ERROR` — USART3 RX DMA error if DMA is enabled later; clears after recovery.
- `SU-07 ERROR` — USART3 TX DMA error if DMA is enabled later; clears after successful TX.
- `SU-08 ERROR` — finite-timeout packet TX returns HAL error/timeout; clears after successful TX.
- `SU-09 ERROR` — ESP is silent for a generic request expecting a reply; clears when valid ESP traffic resumes.
- `SU-10 ERROR` — validated RX queue is full and packet would be lost; clears after queue recovery.

### SA — STM→ESP audio transport

- `SA-01 ERROR` — SPI2 audio transfer returns non-timeout HAL error; clears after successful block.
- `SA-02 ERROR` — SPI2 audio transfer times out; clears after successful block.
- `SA-03 ERROR` — SPI2 audio DMA error if enabled; clears after recovery.
- `SA-04 WARN` — PCM transport queue is full and block is dropped; clears after sustained drain.
- `SA-05 ERROR` — PCM block is null, zero, oversized, or misaligned; clears on valid block.

### SF — stream flow

- `SF-01 ERROR` — illegal stream state transition; clears after returning to IDLE/STOPPED.
- `SF-02 ERROR` — START response timeout; clears on correlated success or cancellation.
- `SF-03 ERROR` — START response reports failure; clears on later success/cancellation.
- `SF-04 ERROR` — START response pet/audio/state fields do not match request; clears on correlated response.
- `SF-05 ERROR` — STOP response timeout; clears on correlated success or forced reset.
- `SF-06 ERROR` — STOP response reports failure; clears on later success/reset.
- `SF-07 ERROR` — STOP response does not correlate; clears on correlated response.
- `SF-08 WARN` — STM and ESP stream states diverge; clears when both agree.
- `SF-09 WARN` — screen/mode exits while handshake is pending; clears after settlement.

### SC — cloud/WiFi status received through ESP

- `SC-01 ERROR` — expected temperature cloud ACK `0x55` is missing at deadline.
- `SC-02 WARN` — `0x55` arrives after transaction timeout/cancellation.
- `SC-03 ERROR` — `0x55` status is upload failure (`0`).
- `SC-04 ERROR` — `0x55` payload/message-ID length is malformed.
- `SC-05 ERROR` — ACK message ID does not match pending transaction where correlation exists.
- `SC-06 WARN` — cloud warning `0x58` reports UNSTABLE; clears on OK.
- `SC-07 ERROR` — cloud warning `0x58` reports DOWN; clears on UNSTABLE/OK.
- `SC-08 ERROR` — `0x58` payload, quality, or context is invalid.
- `SC-09 ERROR` — WiFi status response has wrong payload length.
- `SC-10 WARN` — WiFi status `0x00`, disconnected; clears on connected.
- `SC-11 WARN` — WiFi remains connecting/reconnecting beyond timeout after `CMD_WIFI_RESP` payload `0x13` or standalone `CMD_WIFI_CONNECTING (0x12)`.
- `SC-12 ERROR` — WiFi status `0x03`, explicit error.
- `SC-13 ERROR` — `CMD_WIFI_RESP` payload `0x15`, suitable/configured AP not found.
- `SC-14 WARN` — RSSI response timeout.
- `SC-15 ERROR` — RSSI response violates length/range contract.
- `SC-16 WARN` — configured number of consecutive RSSI polls are missed.
- `SC-19 ERROR` — `CMD_WIFI_RESP` carries an undefined status payload.
- `SC-20 ERROR` — standalone `CMD_WIFI_FAILED (0x14)` received; clears on a later connected/connecting state.

`SC-17` and `SC-18` are removed and remain unassigned; they must not be used for the obsolete `0x56/0x57` cloud-probe flow. Command IDs `0x12` and `0x14` are standalone commands, while `0x13` and `0x15` above are payload values inside command `0x02`.

### SS — STM runtime

- `SS-01 CRITICAL` — HardFault handler entered.
- `SS-02 CRITICAL` — MemManage fault handler entered.
- `SS-03 CRITICAL` — BusFault handler entered.
- `SS-04 CRITICAL` — UsageFault handler entered.
- `SS-05 CRITICAL` — boot flags identify IWDG reset.
- `SS-06 CRITICAL` — boot flags identify WWDG reset.
- `SS-07 CRITICAL` — FreeRTOS stack-overflow hook fires.
- `SS-08 CRITICAL` — FreeRTOS malloc-failed hook fires.
- `SS-09 CRITICAL` — boot flags identify brownout reset.
- `SS-10 CRITICAL` — `configASSERT` fails.
- `SS-11 CRITICAL` — fatal application `Error_Handler` is entered.
- `SS-12 ERROR` — diagnostic event ring overflows.
- `SS-20 WARN` — FreeRTOS heap used ≥ 80% of `configTOTAL_HEAP_SIZE`; clears when used ≤ 70%.
- `SS-21 ERROR` — FreeRTOS heap used ≥ 90%; clears when used ≤ 70%.
- `SS-22 WARN` — Esp32Task stack used ≥ 80% (high-water mark); clears ≤ 70%.
- `SS-23 WARN` — guiTask (TouchGFX) stack used ≥ 80% (HWM); clears ≤ 70%.
- `SS-24 WARN` — audioTask stack used ≥ 80% (HWM); clears ≤ 70%.
- `SS-25 WARN` — USB_Task stack used ≥ 80% (HWM); clears ≤ 70%.
- `SS-26 WARN` — temp1Task stack used ≥ 80% (HWM); clears ≤ 70%.
- `SS-27 WARN` — Vitals_Task (SpO2) stack used ≥ 80% (HWM); clears ≤ 70%.
- `SS-28 WARN` — MP2722Task stack used ≥ 80% (HWM); clears ≤ 70%.

`SS-20`–`SS-28` are STM-only performance watermarks: polled periodically in firmware, transmitted as compact `0x59` codes only on threshold cross/clear (not continuous heap/stack telemetry). Task identity is the code ID. On `SS-07`, firmware may also raise the matching `SS-22`–`SS-28` when the overflowing task name is known. Wire IDs: `0x14`…`0x1C` for SS-20…SS-28.

IWDG is not currently enabled and stack-overflow checking is currently effectively disabled. Do not silently enable IWDG. With no retained storage and no sending from exception context, HardFault/MemManage/BusFault/UsageFault cannot be guaranteed to reach ESP.

### SO — OTA control over UART

- `SO-01 ERROR` — OTA available `0x50` payload malformed.
- `SO-02 ERROR` — OTA `0x52` phase is unknown.
- `SO-03 ERROR` — STM cannot transmit OTA start `0x51`/`0x54`.
- `SO-04 ERROR` — expected OTA STARTING phase times out.
- `SO-05 ERROR` — reserved for future OTA chunk-transfer silence timeout.
- `SO-06 ERROR` — OTA success `0x53` times out.
- `SO-07 ERROR` — version/job-ID length fields violate bounds.
- `SO-08 WARN` — OTA phase/success arrives in incompatible local state.

## 5. Connected-hardware codebook

Device-absent codes only apply when the device is expected to be powered and in use.

### PW — MP2722, charging, battery and NTC

- `PW-01 ERROR` — MP2722 does not ACK at I2C4 `0x3F`.
- `PW-02 ERROR` — MP2722 register read/write fails after detection.
- `PW-03 CRITICAL` — REG12 charger watchdog fault.
- `PW-04 WARN` — REG12 active die thermal regulation.
- `PW-05 CRITICAL` — REG13 charge input overvoltage.
- `PW-06 ERROR` — REG13 charge safety timer expired.
- `PW-07 CRITICAL` — REG13 battery overvoltage.
- `PW-08 CRITICAL` — REG13 boost overload/short.
- `PW-09 ERROR` — REG13 boost overvoltage.
- `PW-10 CRITICAL` — REG13 boost overtemperature.
- `PW-11 ERROR` — REG13 battery too low for boost.
- `PW-12 CRITICAL` — REG14 battery missing.
- `PW-13 ERROR` — REG14 NTC missing.
- `PW-14 WARN` / `PW-15 WARN` / `PW-16 ERROR` / `PW-17 ERROR` — NTC1 WARM/COOL/COLD/HOT.
- `PW-18 WARN` / `PW-19 WARN` / `PW-20 ERROR` / `PW-21 ERROR` — NTC2 WARM/COOL/COLD/HOT.
- `PW-22 WARN` — sustained input-current/input-voltage DPM throttling.
- `PW-23 ERROR` — battery ADC4 DMA start/error.
- `PW-24 CRITICAL` — filtered battery voltage remains below validated critical threshold.
- `PW-25 ERROR` — battery ADC is impossible, stale, or materially contradicts MP2722.

PC8 EXTI only sets `mp2722_update_pending`. `StartMP2722Task` reads REG11–REG16 and emits/clears codes outside the ISR.

### IB — I2C controller/bus failures

- `IB-01/02/03/04` — I2C1 BERR, ARLO, timeout/busy-stuck, DMA/internal error.
- `IB-11/12/13/14` — I2C3 BERR, ARLO, timeout/busy-stuck, DMA/internal error.
- `IB-21/22/23/24` — I2C4 BERR, ARLO, timeout/busy-stuck, DMA/internal error.

Device NACK belongs to the owning `PW`, `TM`, or `AH` family; `IB` means bus/controller failure.

### TM — temperature probes

- `TM-01 WARN` — no supported probe after PD4 power-on/settle during requested measurement.
- `TM-02 ERROR` — multiple mutually exclusive probe addresses respond.
- `TM-10 ERROR` — TMP117 disappears during active measurement.
- `TM-11 ERROR` — TMP117 DEVICE_ID mismatch.
- `TM-12 ERROR` — TMP117 register read fails after ACK.
- `TM-13 ERROR` — TMP117 measurement makes no progress by deadline.
- `TM-14 ERROR` — TMP117 decoded value is NaN/impossible/outside approved range.
- `TM-20 ERROR` — MLX90614 disappears during active measurement.
- `TM-21 ERROR` — MLX90614 paired ambient/object read fails.
- `TM-22 ERROR` — MLX90614 raw value is `0x0000`/`0xFFFF`.
- `TM-23 WARN` — MLX90614 acquisition has fewer than 8/8 successful sample pairs.
- `TM-24 ERROR` — MLX90614 calculated value is NaN/outside approved range.
- `TM-30 ERROR` — MLX90632 disappears during active measurement.
- `TM-31 ERROR` — MLX90632 register/RAM read failure.
- `TM-32 ERROR` — MLX90632 DATA_RDY timeout.
- `TM-33 ERROR` — MLX90632 brownout-reset status.
- `TM-34 ERROR` — MLX90632 BUSY timeout.
- `TM-35 ERROR` — MLX90632 EE_BUSY timeout.
- `TM-36 ERROR` — MLX90632 EEPROM version/calibration invalid.
- `TM-37 ERROR` — MLX90632 calculated value is NaN/outside approved range.

### AH — DAC, SAI, MDF and microphones

- `AH-01 ERROR` — TLV320DAC32 NACK while PD2 is commanded on.
- `AH-02 ERROR` — required DAC initialization register write fails.
- `AH-03 ERROR` — supported DAC critical-register readback mismatch.
- `AH-04 ERROR` — SAI1 start/DMA operation fails.
- `AH-05 ERROR` — SAI1 underrun/overrun/error callback.
- `AH-10 ERROR` — MDF acquisition overflow.
- `AH-11 ERROR` — MDF resampling-filter overrun.
- `AH-12 ERROR` — MDF clock absence.
- `AH-13 WARN` — sustained MDF saturation/out-of-limit.
- `AH-14 CRITICAL` — MDF short-circuit detection.
- `AH-15 ERROR` — MDF DMA error.
- `AH-16 ERROR` — one microphone has sustained near-zero energy while the other is valid.
- `AH-17 WARN` — sustained microphone imbalance/clipping.

The microphone part number is unknown, so no device-ID/self-test code is claimed.

### DP — ST7789V2 display

- `DP-01 CRITICAL` — SPI1/display initialization fails.
- `DP-02 ERROR` — SPI1 display transfer returns HAL error.
- `DP-03 ERROR` — SPI1 display transfer timeout.
- `DP-04 ERROR` — PD14 unexpectedly off while UI requires display.
- `DP-05 WARN` — backlight PWM unexpectedly zero while UI requires visible output.
- `DP-06 ERROR` — reset/init sequence fails to complete.

There is no panel status/TE/MISO feedback. Firmware cannot reliably detect disconnected FPC, internally dead glass, or visual corruption.

### FM — MX25L6433F external flash

- `FM-01 CRITICAL` — `BSP_MEM_Init(0)` fails.
- `FM-02 CRITICAL` — JEDEC ID read fails.
- `FM-03 CRITICAL` — JEDEC ID mismatch.
- `FM-04 ERROR` — flash status-register read fails.
- `FM-05 CRITICAL` — WIP remains set past operation timeout.
- `FM-06 ERROR` — WEL does not set after write-enable.
- `FM-07 ERROR` — erase/program operation fails.
- `FM-08 CRITICAL` — readback/CRC verification mismatch.
- `FM-09 CRITICAL` — OCTOSPI memory-mapped-mode entry/sanity read fails.

Diagnostics never use this flash for persistence.

### UB — USB host and SpO2

- `UB-01 ERROR` — USB host/class initialization fails.
- `UB-02 WARN` — target disconnects during active SpO2 flow.
- `UB-03 ERROR` — enumerated PID is not `0x505C`.
- `UB-04 ERROR` — CDC TX submission fails.
- `UB-05 ERROR` — CDC TX completion timeout.
- `UB-06 ERROR` — CDC RX submission fails.
- `UB-07 ERROR` — CDC RX completion timeout.
- `UB-08 ERROR` — received SpO2 packet malformed/short.
- `UB-09 ERROR` — SpO2/HR/status violates approved contract.
- `UB-10 ERROR` — USB HCD transport error during active session.

Normal unplug when no SpO2 flow is active is not an error.

### IO — buttons, GPIO and controlled rails

- `IO-01 ERROR` — PD4 temperature power state disagrees with active flow.
- `IO-02 ERROR` — PD2 DAC/microphone power state disagrees with audio flow.
- `IO-03 ERROR` — PD7/PD3 ESP power sequence disagrees with ESP state.
- `IO-04 ERROR` — display power/backlight state disagrees with UI sleep/wake state.
- `IO-05 ERROR` — PB14 peripheral-enable state disagrees with required state.
- `IO-10 WARN` — navigation button remains asserted beyond validated stuck-key duration.
- `IO-11 ERROR` — wake/select event occurs but expected state transition times out.

These checks prove commanded/logical GPIO state only; without voltage/current feedback they cannot prove the rail exists electrically.

### Legacy TCPP02/03

TCPP/UCPD is disabled and MP2722 is active. Do not emit TCPP faults from inactive code. If re-enabled, allocate a new `TC` family and document it before use.

## 6. Collection, deduplication and sending architecture

### Ownership boundary

**STM owns:**

- detection at the exact failure site;
- immutable STM family/code mapping;
- active-code deduplication and repeat counting;
- `first_occurrence_tick`;
- temporary fixed RAM queueing;
- construction and transmission of command `0x59`.

**ESP owns:**

- validation of diagnostic LEN, END, checksum, family and code;
- idempotent `(session_id, sequence_id)` handling and `0x5A` ACK generation;
- family/code translation through the shared codebook;
- SNTP-aligned event time using STM event age;
- immediate MQTT publish when available;
- offline storage in its 192 KB flash ring;
- oldest-first replay after reconnection;
- deletion only after QoS1 PUBACK.

ESP sends `0x5A/status=0x01` only after MQTT QoS1 PUBACK has arrived or the offline event and accepted session+sequence key are committed to ESP flash. UART receipt or RAM enqueue alone is not acceptance. A repeated already-accepted key receives status `0x02`.

```
Exact failure site
    → map immutable code
    → STM_Diag_Report()
    → active-code/repeat deduplication
    → fixed RAM ring
    → STM_Diag_Process() in Esp32Task
    → UART CMD 0x59
    → ESP validation and session+sequence dedup
    → ESP ACK CMD 0x5A
    → STM removes on status 0x01/0x02
    → MQTT now or ESP offline flash
```

- Add planned modules `Core/Inc/stm_diag.h` and `Core/Src/stm_diag.c`.
- Use fixed-size static memory only; no dynamic allocation.
- First occurrence records `first_occurrence_tick`, sets repeat to 1, marks the code active, and queues it.
- Repeated active occurrence does not create an immediate duplicate; it increments repeat, saturating at 255, while preserving the original tick.
- If the first queued record is still unsent, update its repeat count in place under the queue’s critical section.
- If the first record was already sent, accumulate a coalesced repeat summary in the active state and queue that summary on clear/debounce expiry.
- A clear or debounce expiry queues the coalesced summary if needed, then clears active state.
- Every code has a fixed severity, trigger, debounce/repeat policy, and clear condition.
- Diagnostic queue overflow latches `SS-12` without recursively trying to enqueue itself.
- `STM_Diag_Process()` runs inside `Esp32Task`, keeping USART3 as a single TX owner.
- Refactor packet TX to return finite-timeout status while preserving current callers.
- Prevent `SU-08` recursion when the failed packet itself is diagnostic.
- Send whenever ESP is intentionally powered and USART3 is available, regardless of WiFi/MQTT state.
- Pause diagnostic draining while STM OTA owns USART3. Preserve queue/order/ages and resume after OTA releases the UART.
- Keep only one queue-head session+sequence in flight unless a later protocol version explicitly adds a multi-entry ACK window.
- On UART TX failure, ACK timeout, status `0x04`, malformed ACK, or ESP reset, keep the event queued for retry; do not recursively report another `SU-08` for that failed diagnostic frame.
- Status `0x03` is a permanent contract rejection: stop retrying that event, quarantine/drop it locally, and surface a local protocol-contract failure.

### ESP receive/store path STM can rely on

```
Receive UART frame
    → require LEN 0x0D
    → require END 0x55
    → verify XOR over CMD + eleven payload bytes
    → validate family 0x01–0x0F
    → validate codebook entry
    → deduplicate session+sequence
    → event_time = receive_time - event_age_seconds
    → MQTT QoS1 PUBACK OR commit offline flash
    → ACK status 0x01
    → duplicate accepted key returns status 0x02
    → invalid contract returns status 0x03
    → transient busy/storage failure returns status 0x04
    → replay oldest-first
    → remove only after PUBACK
```

ESP’s compact offline record is:

```
[family_id:1][code_id:1][repeat:1][delta_seconds:2]
```

The 192 KB ring holds approximately 38,000 five-byte events and overwrites its oldest sector when full. This ESP persistence does not change the STM’s RAM-only limitation.

The five-byte offline event record does not contain session or sequence. ESP therefore needs a separate durable recent `(session_id, sequence_id)` acceptance journal, or a future offline record format containing that key. This durable key is required to return status `0x02` correctly after an ACK loss plus ESP reboot.

### ESP-unavailable limitation

- If ESP UART is unavailable, STM retains events until its RAM queue fills.
- When ESP returns, STM drains oldest-first with calculated event ages.
- If STM resets before draining, queued events are lost.
- `SS-12` indicates STM diagnostic RAM queue overflow.
- Surviving simultaneous STM and ESP power loss would require future STM persistence and is outside v1.

## 7. State-aware health model

1. **Boot checks:** MCU reset flags, always-on MP2722, external flash, mandatory initialization.
2. **Power-on checks:** after the owning rail is enabled and its settle delay completes.
3. **Active-flow checks:** temperature, audio, USB, and display checks only while those flows expect activity.
4. **Interrupt/status checks:** PC8 and HAL callbacks enqueue events; owning tasks read/decode details.
5. **Periodic sanity checks:** stale ADC, microphone signal energy, stuck button, and handshake deadlines use debounce/hysteresis.

Intentional power-off, normal charger unplug, unused USB, quiet audio before capture, and cancelled sensor flows must not emit errors.

## 8. Planned firmware integration points

- `ESP32task.c`: parser framing/checksum, `0x5A` ACK validation, UART flags, command validators, TX status, cloud/WiFi/RSSI, stream handshakes, OTA UART ownership, diagnostic queue state, per-boot session generation, sequence allocation, ACK deadlines/retry, and event-age encoding.
- `ESP32Task.h`: `CMD_STM_DIAGNOSTIC 0x59`, `CMD_STM_DIAGNOSTIC_ACK 0x5A`, family IDs, `0x55` temp ACK, `0x58` cloud warning, `0x12` WiFi connecting, `0x14` WiFi failed, and corrected WiFi response payload values.
- Remove obsolete `0x56/0x57` cloud-probe state, timers, handlers and codebook emissions without changing unrelated command framing.
- `mp2722.c` and `StartMP2722Task`: PC8-triggered REG11–REG16 decode.
- `app_freertos.c`: temperature detection and active-flow state.
- TMP117/MLX90614/MLX90632 drivers: identity, read, data-ready, status, sample and range checks.
- `battery_monitor.c`: ADC DMA start/error/stale/range checks.
- `dac_config.c` and `main.c`: DAC I2C results, SAI, MDF, DMA, microphone signal health.
- `main.c`: SPI1 display return values, display power/backlight, SPI2 audio return value, reset flags, SpO2 CDC timeouts.
- MX25L6433F BSP: init, JEDEC, status, WIP/WEL, verify, memory-map checks.
- `usb_host.c`: target PID, host/class state and transport errors.
- `stm32u5xx_it.c` and `FreeRTOSConfig.h`: runtime fault hooks; do not enable watchdog silently.

## 9. Verification plan

- Validate event frame `AA 0D 59 01 03 07 34 12 01 00 00 00 00 00 7B 55` → `ST-03,7`, session `0x1234`, sequence `0x0001`, age 0.
- Validate ACK frame `AA 07 5A 34 12 01 00 01 7C 55` accepts session `0x1234`, sequence `0x0001`.
- Verify nonzero `event_age_seconds` is encoded uint32 little-endian and included in XOR.
- Verify nonzero session is encoded uint16 little-endian and included in XOR.
- Verify nonzero sequence is encoded uint16 little-endian and included in XOR.
- Verify `first_occurrence_tick` remains unchanged while repeats coalesce.
- Verify repeat saturation at 255.
- Inject invalid LEN/end/checksum, unknown commands, malformed payloads, queue overflow and repeat saturation.
- Inject UART ORE/FE/NE/PE and request/handshake timeouts.
- Verify queued diagnostics drain while WiFi/MQTT is disconnected but ESP UART is available.
- Verify diagnostics pause while OTA owns USART3, retain order/age, and resume afterward.
- Verify diagnostic TX failure stays queued and cannot recursively create `SU-08`.
- Verify UART TX success without matching status `0x01`/`0x02` does not dequeue the event.
- Verify status `0x04`, ACK timeout, malformed ACK, wrong-session ACK, and wrong-sequence ACK retain the queue head.
- Verify status `0x03` terminates retries without removing another event.
- Verify retry reuses the same session+sequence and recalculates age from the original tick.
- Verify duplicate accepted session+sequence is not stored/published twice and ESP sends status `0x02`.
- Verify malformed framing/checksum receives no ACK and STM retries after timeout.
- Verify a new STM runtime uses a different nonzero session.
- Verify sequence wrap never reuses an outstanding sequence.
- Verify obsolete `0x56/0x57` cloud-probe logic is absent.
- Verify WiFi response payload `0x15` maps to AP-not-found, while standalone commands `0x12`/`0x14` remain command IDs.
- Feed MP2722 snapshots covering all charger, boost, NTC, missing-battery and clear states.
- Mock I2C1/I2C3/I2C4 BERR, ARLO, timeout, NACK and recovery separately.
- Mock every temperature-probe identity/status/read/range path.
- Exercise DAC/SAI/MDF callbacks and debounced microphone energy tests.
- Inject display SPI and power/backlight state failures without claiming panel disconnection.
- Mock flash JEDEC mismatch, WIP timeout, WEL failure and memory-map failure.
- Exercise USB wrong PID, normal idle unplug, active disconnect, CDC timeout and malformed data.
- Confirm intentional peripheral shutdown emits no diagnostic.
- Build and lint after future implementation.
- Do not enable IWDG or write diagnostic data to any nonvolatile memory.
