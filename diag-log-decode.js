/**
 * Decode GET /api/diag/events into Story / All-events / Faults rows.
 * Codebook sourced from event_log_decoding_page_neccessary (PM/SD/ESP faults + STM families).
 */
(function (global) {
  const FAMILY_PREFIX = {
    1: "ST",
    2: "SU",
    3: "SA",
    4: "SF",
    5: "SC",
    6: "SS",
    7: "SO",
    8: "PW",
    9: "IB",
    10: "TM",
    11: "AH",
    12: "DP",
    13: "FM",
    14: "UB",
    15: "IO",
    16: "PR",
    17: "UA",
    18: "SP",
    19: "WF",
    20: "TL",
    21: "MQ",
    22: "ES",
    23: "OT",
    24: "PM",
    25: "SD",
  };

  const FAMILY_AREA = {
    ST: "STM system",
    SU: "STM↔ESP UART",
    SA: "Audio transport",
    SF: "Stream / app flow",
    SC: "Cloud / Wi‑Fi (STM)",
    SS: "STM runtime",
    SO: "OTA control",
    PW: "Power / battery",
    IB: "I²C",
    TM: "Temperature probes",
    AH: "Audio hardware",
    DP: "Display",
    FM: "External flash",
    UB: "USB / SpO2",
    IO: "Buttons / GPIO",
    PR: "Provisioning",
    UA: "UART bridge",
    SP: "SPI audio",
    WF: "Wi‑Fi",
    TL: "TLS / reachability",
    MQ: "MQTT",
    ES: "ESP system",
    OT: "OTA",
    PM: "ESP metrics",
    SD: "STM status dump",
  };

  const CODE_MEANING = {
    "PR-01": "Provisioning / setup fault",
    "PR-02": "Provisioning / setup fault",
    "PR-03": "Provisioning / setup fault",
    "PR-04": "Unknown / unsupported UART command",
    "PR-05": "Provisioning fault",
    "UA-01": "UART read / link error",
    "UA-02": "UART fault",
    "UA-03": "UART fault",
    "UA-04": "UART driver re-init / recovery",
    "UA-05": "STM UART silence watchdog",
    "SP-01": "SPI RX fault",
    "SP-02": "SPI RX fault",
    "SP-03": "SPI fault",
    "SP-04": "Audio ring overflow",
    "SP-05": "Packetizer fault",
    "WF-01": "Wi‑Fi disconnected",
    "WF-02": "No Wi‑Fi access point found",
    "WF-03": "Lost IP after being online",
    "WF-04": "Wi‑Fi fault",
    "TL-01": "AWS DNS resolve failed",
    "TL-02": "AWS TLS probe failed",
    "TL-03": "TLS error on probe",
    "TL-04": "MQTT TLS send/recv fault",
    "TL-05": "AWS endpoint not reachable",
    "MQ-01": "MQTT connect / session failed",
    "MQ-02": "MQTT CONNACK timeout / broker silent",
    "MQ-03": "MQTT receive failed",
    "MQ-04": "MQTT out of memory",
    "MQ-05": "MQTT send failed",
    "MQ-06": "MQTT keepalive timeout",
    "MQ-07": "Subscribe send failed",
    "MQ-08": "Broker rejected subscribe topic(s)",
    "MQ-09": "MQTT illegal state",
    "MQ-10": "MQTT server refused request",
    "MQ-23": "Stream / publish path fault",
    "ES-01": "OTA malloc fail",
    "ES-02": "Task create fail / coredump path",
    "ES-03": "Boot after watchdog reset",
    "ES-04": "Boot after panic",
    "ES-05": "Boot after brownout",
    "ES-06": "Core-dump present",
    "ES-07": "Core-dump upload fail",
    "ES-08": "Core-dump partition issue",
    "ES-09": "Free heap below 40 KB",
    "ES-10": "Min heap below 32 KB",
    "ES-11": "mqtt_process stack critically low",
    "OT-01": "OTA HTTP status error",
    "OT-02": "OTA flash begin/write fail",
    "OT-03": "OTA pending NVS fail",
    "OT-04": "STM OTA protocol / UART fail",
    "OT-05": "OTA URL too long",
    "OT-06": "OTA HTTP client init failed",
    "OT-07": "OTA HTTP open failed",
    "OT-08": "OTA download stream failed",
    "OT-09": "OTA download empty",
    "OT-10": "OTA image invalid / corrupt",
    "OT-11": "OTA task create failed",
    "OT-12": "OTA URL truncated",
    "OT-13": "OTA URL buffer alloc fail",
    "OT-14": "OTA job missing / malformed URL",
    "OT-15": "OTA finalize / boot partition fail",
    "OT-16": "STM OTA firmware size / URL fetch failed",
    "OT-17": "OTA partition erase failed",
    "PM-01": "Free heap",
    "PM-02": "Min free heap",
    "PM-03": "Largest free block",
    "PM-04": "mqtt_process stack HWM",
    "PM-05": "Wi‑Fi RSSI",
    "PM-06": "Wi‑Fi reconnect count",
    "PM-07": "MQTT disconnect count",
    "PM-08": "Uptime since diag boot",
    "PM-09": "Wi‑Fi connected",
    "PM-10": "Wi‑Fi has IP",
    "PM-11": "Internet / AWS path OK",
    "PM-12": "MQTT connected",
    "PM-13": "Wi‑Fi reconnect in progress",
    "PM-14": "Saved Wi‑Fi network index",
    "PM-15": "SSID hash",
    "PM-16": "MQTT keepalive ping RTT",
    "PM-17": "Temp cloud-ACK queue depth",
    "PM-18": "MQTT outbox pending",
    "PM-19": "MQTT event queue length",
    "PM-20": "Internal RAM free",
    "PM-21": "diag_mgr stack HWM",
    "PM-22": "uart_rx stack HWM",
    "PM-23": "mqtt_diag stack HWM",
    "PM-24": "Wi‑Fi channel",
    "PM-25": "Last DNS resolve duration",
    "PM-26": "Last TLS duration",
    "PM-27": "AWS path reachable",
    "PM-28": "SNTP / time trusted",
    "PM-29": "Wi‑Fi SSID length",
    "PM-30": "SSID bytes 0–3",
    "PM-31": "SSID bytes 4–7",
    "PM-32": "SSID bytes 8–11",
    "PM-33": "SSID bytes 12–15",
    "PM-34": "SSID bytes 16–19",
    "PM-35": "SSID bytes 20–23",
    "PM-36": "SSID bytes 24–27",
    "PM-37": "SSID bytes 28–31",
    "PM-38": "Heap total",
    "PM-39": "Heap used",
    "PM-40": "Heap used %",
    "PM-41": "aws_iot_demo stack HWM",
    "PM-42": "mqtt_stream stack HWM",
    "PM-43": "audio_packetizer stack HWM",
    "PM-44": "spi_audio_rx stack HWM",
    "PM-45": "mqtt_process_task stack HWM",
    "PM-46": "temp_ack_retry stack HWM",
    "PM-47": "audio_ctrl_pub stack HWM",
    "PM-48": "mqtt_health_task stack HWM",
    "PM-49": "ESP die temperature",
    "PW-14": "Battery NTC1 warm",
    "PW-15": "Battery NTC1 cool",
    "PW-16": "Battery NTC1 cold",
    "PW-17": "Battery NTC1 hot",
    "SS-20": "STM heap used ≥ 80%",
    "SS-21": "STM heap used ≥ 90%",
    "ST-01": "STM boot / reset",
    "ST-02": "STM watchdog / hard fault path",
    "ST-03": "STM init / bring-up event",
    "ST-04": "STM scheduler / task event",
    "ST-05": "STM system heartbeat / runtime event",
    "SU-01": "STM↔ESP UART framing / sync issue",
    "SU-02": "STM↔ESP UART CRC / payload error",
    "SU-03": "STM↔ESP UART timeout",
    "SU-04": "STM↔ESP UART overflow / drop",
    "SJ-01": "STM↔ESP UART bridge event",
    "TM-01": "Temperature probe alert",
    "TM-10": "Temperature probe alert",
    "TM-20": "Temperature probe alert",
    "TM-30": "Temperature probe alert",
  };

  const SCREENS = {
    0: "Logo",
    1: "Wi‑Fi Connect",
    2: "Home",
    3: "Wi‑Fi QR",
    4: "Temperature Probe",
    5: "Temperature Process",
    6: "Temperature Result",
    7: "Manual ID",
    8: "Examination",
    9: "Auscultation",
    10: "Charging",
  };

  const BUTTONS = {
    255: "none",
    0: "Select",
    1: "Up",
    2: "Right",
    3: "Down",
    4: "Left",
    5: "Back",
    6: "Home",
  };

  const ACTIONS = {
    0: "none",
    1: "entered screen",
    10: "Home select",
    11: "Home back/home",
    20: "Examination select",
    30: "Temperature sample",
    31: "Temperature save",
    40: "Audio stream start",
    41: "Audio stream stop",
    42: "Auscultation back",
    50: "QR navigation",
  };

  const WIFI_STATUS = { 0: "Connecting", 1: "Connected", 2: "Error" };
  const BATTERY_CHG = { 0: "idle", 1: "charging", 2: "complete" };

  function num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function u16(v) {
    return num(v) & 0xffff;
  }

  function metricValueU32(ev) {
    if (!ev || typeof ev !== "object") return 0;
    // Normalized events store camelCase valueU32; API raw uses value_u32 / session halves
    if (ev.valueU32 != null && Number.isFinite(Number(ev.valueU32))) return num(ev.valueU32) >>> 0;
    if (ev.value_u32 != null && Number.isFinite(Number(ev.value_u32))) return num(ev.value_u32) >>> 0;
    if (ev.value != null && Number.isFinite(Number(ev.value))) return num(ev.value) >>> 0;
    if (ev.raw) return metricValueU32(ev.raw);
    return (u16(ev.source_session) | (u16(ev.source_sequence) << 16)) >>> 0;
  }

  function leBytes4(u32) {
    const v = u32 >>> 0;
    return [(v >>> 0) & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  }

  function readU16LE(buf, off) {
    return (buf[off] | (buf[off + 1] << 8)) & 0xffff;
  }

  function readU32LE(buf, off) {
    return (
      (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0
    );
  }

  function readI16LE(buf, off) {
    const u = readU16LE(buf, off);
    return u > 0x7fff ? u - 0x10000 : u;
  }

  function normalizeCode(rawCode, familyId, codeId) {
    const fam = num(familyId);
    const cid = num(codeId);
    const prefix = FAMILY_PREFIX[fam];
    if (prefix && cid > 0) return `${prefix}-${String(cid).padStart(2, "0")}`;

    const text = String(rawCode || "").trim().toUpperCase();
    const fHex = text.match(/^F([0-9A-F]{1,2})-(\d{1,3})$/i);
    if (fHex) {
      const famHex = parseInt(fHex[1], 16);
      const mapped = FAMILY_PREFIX[famHex];
      if (mapped) return `${mapped}-${String(Number(fHex[2])).padStart(2, "0")}`;
    }
    const plain = text.match(/^([A-Z]{2})-(\d{1,3})$/);
    if (plain) return `${plain[1]}-${String(Number(plain[2])).padStart(2, "0")}`;
    return text || (prefix ? `${prefix}-??` : "UNKNOWN");
  }

  function codeKind(code) {
    if (/^PM-/.test(code)) {
      const id = Number(code.slice(3));
      if (id === 29) return "ssid_meta";
      if (id >= 30 && id <= 37) return "ssid_chunk";
      return "metric";
    }
    if (/^SD-/.test(code)) return "status_chunk";
    return "fault";
  }

  function isFaultCode(code) {
    const kind = codeKind(code);
    if (kind === "metric" || kind === "ssid_meta" || kind === "ssid_chunk" || kind === "status_chunk") {
      return false;
    }
    return true;
  }

  function isUiRelated(code, stmStatus) {
    if (/^SD-/.test(code)) return true;
    if (stmStatus) return true;
    const prefix = String(code || "").slice(0, 2);
    return ["IO", "DP", "SF", "SC"].includes(prefix);
  }

  function meaningFor(code) {
    if (CODE_MEANING[code]) return CODE_MEANING[code];
    const prefix = code.split("-")[0];
    const area = FAMILY_AREA[prefix];
    if (/^SD-/.test(code)) return `STM status chunk ${code}`;
    if (/^PM-/.test(code)) return `ESP metric ${code}`;
    if (area) return `${area} event (${code})`;
    return `Diagnostic event ${code}`;
  }

  const istDateTimeFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  function formatIstDateTime(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "—";
    const parts = istDateTimeFmt.formatToParts(date);
    const get = (t) => parts.find((p) => p.type === t)?.value || "";
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")} IST`;
  }

  function formatDeviceTime(eventTimeS, timeQuality) {
    const s = num(eventTimeS, NaN);
    if (!Number.isFinite(s) || s <= 0) return { text: "—", iso: "" };
    const q = String(timeQuality || "").toUpperCase();
    if (q === "U" || s < 1_000_000_000) {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = Math.floor(s % 60);
      return {
        text: `boot+${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`,
        iso: "",
      };
    }
    const d = new Date(s * 1000);
    if (Number.isNaN(d.getTime())) return { text: String(s), iso: "" };
    return {
      text: formatIstDateTime(d),
      iso: d.toISOString(),
    };
  }

  function formatServerTime(iso) {
    const raw = String(iso || "").trim();
    if (!raw) return "—";
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return formatIstDateTime(d);
  }

  function formatMetricDetail(code, valueU32) {
    const v = valueU32 >>> 0;
    const signed = v > 0x7fffffff ? v - 0x100000000 : v;
    switch (code) {
      case "PM-05":
        return `${signed} dBm`;
      case "PM-49":
        return `${(signed / 100).toFixed(2)} °C`;
      case "PM-09":
      case "PM-10":
      case "PM-11":
      case "PM-12":
      case "PM-13":
      case "PM-27":
      case "PM-28":
        return v ? "Yes" : "No";
      case "PM-40":
        return `${v}%`;
      case "PM-08":
        return `${v} s`;
      case "PM-16":
      case "PM-25":
      case "PM-26":
        return `${v} ms`;
      case "PM-29":
        return `${v} chars`;
      default:
        if (/^PM-(30|31|32|33|34|35|36|37)$/.test(code)) {
          return leBytes4(v)
            .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
            .join("");
        }
        if (/^PM-/.test(code)) return String(v);
        return String(v);
    }
  }

  function decodeStmStatus(payload) {
    if (!payload || payload.length < 74) return null;
    const p = payload;
    const screen = p[5];
    const button = p[11];
    const action = p[12];
    const wifi = p[6];
    const mqtt = p[8];
    const batteryPct = p[67];
    const batteryChg = p[68];
    const batteryMv = readU16LE(p, 69);
    const mcuTemp = readI16LE(p, 71);
    const mcuOk = p[73];
    return {
      sessionId: readU16LE(p, 0),
      seq: readU16LE(p, 2),
      kind: p[4],
      screen,
      screenName: SCREENS[screen] || `Screen ${screen}`,
      wifiStatus: wifi,
      wifiStatusName: WIFI_STATUS[wifi] || `Wi‑Fi ${wifi}`,
      wifiRssiCat: p[7],
      mqtt: mqtt ? 1 : 0,
      audioStreaming: p[9] ? 1 : 0,
      audioType: p[10],
      button,
      buttonName: BUTTONS[button] != null ? BUTTONS[button] : `Button ${button}`,
      action,
      actionName: ACTIONS[action] || `Action ${action}`,
      buttonAgeS: p[13],
      heapTotal: readU32LE(p, 14),
      heapFree: readU32LE(p, 18),
      heapUsed: readU32LE(p, 22),
      heapPct: p[26],
      uploadKbps: readU32LE(p, 27),
      mqttQPct: p[31],
      ringPct: p[32],
      heapMinFree: readU32LE(p, 63),
      batteryPct,
      batteryChg,
      batteryChgName: BATTERY_CHG[batteryChg] || String(batteryChg),
      batteryMv,
      mcuTempC: mcuTemp,
      mcuTempOk: mcuOk ? 1 : 0,
    };
  }

  function rebuildSdPayload(chunkEvents) {
    const byId = {};
    chunkEvents.forEach((ev) => {
      const m = String(ev.code || "").match(/^SD-(\d+)$/);
      if (!m) return;
      byId[Number(m[1])] = metricValueU32(ev);
    });
    const out = new Uint8Array(76);
    let filled = 0;
    for (let i = 1; i <= 19; i++) {
      if (byId[i] == null) continue;
      const bytes = leBytes4(byId[i]);
      out.set(bytes, (i - 1) * 4);
      filled += 1;
    }
    // Need at least SD-01..02 to read kind/screen (bytes 0–7)
    if (filled < 2 || byId[1] == null || byId[2] == null) return null;
    return out.subarray(0, 74);
  }

  function rebuildSsid(chunkEvents) {
    const byId = {};
    chunkEvents.forEach((ev) => {
      const m = String(ev.code || "").match(/^PM-(\d+)$/);
      if (!m) return;
      byId[Number(m[1])] = metricValueU32(ev);
    });
    if (byId[29] == null) return "";
    const len = Math.min(32, Math.max(0, byId[29]));
    const raw = [];
    for (let i = 30; i <= 37; i++) raw.push(...leBytes4(byId[i] || 0));
    return String.fromCharCode(...raw.slice(0, len)).replace(/\0/g, "").trim();
  }

  function normalizeEvent(raw) {
    const familyId = num(raw.family_id);
    const codeId = num(raw.code_id);
    const code = normalizeCode(raw.code, familyId, codeId);
    const kind = codeKind(code);
    const flags = num(raw.flags);
    const valueU32 = metricValueU32(raw);
    const tq = String(raw.time_quality || "").toUpperCase() || ((flags & 3) === 2 ? "C" : (flags & 3) === 1 ? "E" : "U");
    const deviceTime = formatDeviceTime(raw.event_time_s, tq);
    return {
      raw,
      code,
      familyId,
      codeId,
      kind,
      isFault: isFaultCode(code),
      meaning: meaningFor(code),
      repeat: Math.max(1, num(raw.repeat ?? raw.repeat_count, 1)),
      eventTimeS: num(raw.event_time_s),
      timeQuality: tq,
      deviceTimeText: deviceTime.text,
      deviceTimeIso: deviceTime.iso,
      serverReceivedAt: String(raw.server_received_at || ""),
      serverTimeText: formatServerTime(raw.server_received_at),
      sessionHex: String(raw.session_hex || "").toUpperCase() || u16(raw.source_session).toString(16).padStart(4, "0").toUpperCase(),
      sequenceHex: String(raw.sequence_hex || "").toUpperCase() || u16(raw.source_sequence).toString(16).padStart(4, "0").toUpperCase(),
      bucketId: String(raw.bucket_id ?? ""),
      valueU32,
      valueText: kind === "metric" || kind === "ssid_meta" || kind === "ssid_chunk" || kind === "status_chunk"
        ? formatMetricDetail(code, valueU32)
        : "",
      source: /^SD-/.test(code) || familyId <= 15 ? "STM" : "ESP",
    };
  }

  const DECODE_BUILD = "stm-ui-v7-2026-10-06";

  /** Health dumps keep last button for a long time (button_age_s up to 255). Only treat as a real press when fresh. */
  function isFreshButtonPress(st) {
    if (st.button === 255 || st.buttonName === "none") return false;
    if (st.kind === 1) return true;
    return (st.buttonAgeS ?? 255) <= 2;
  }

  function stmStoryLine(st, prev) {
    const screen = st.screenName || "Unknown screen";
    const screenChanged = !prev || prev.screen !== st.screen;
    const freshPress = isFreshButtonPress(st);
    const uiFrame = st.kind === 1;

    // Real UI: screen change, dedicated UI frame, or freshly pressed button
    if (uiFrame || freshPress || screenChanged) {
      const parts = [];
      if (screenChanged) {
        parts.push(`Navigated to ${screen}`);
      } else {
        parts.push(`On ${screen}`);
      }
      if (uiFrame && st.action === 1) {
        parts.push("entered this screen");
      } else if (uiFrame && st.action && st.action !== 0) {
        parts.push(st.actionName);
      }
      if (freshPress) {
        parts.push(`pressed ${st.buttonName}`);
      }
      if (!prev || prev.wifiStatus !== st.wifiStatus) {
        parts.push(`Wi‑Fi ${st.wifiStatusName.toLowerCase()}`);
      }
      if (!prev || prev.mqtt !== st.mqtt) {
        parts.push(st.mqtt ? "MQTT online" : "MQTT offline");
      }
      if (st.audioStreaming && (!prev || !prev.audioStreaming)) {
        parts.push("audio streaming started");
      }
      if (!st.audioStreaming && prev?.audioStreaming) {
        parts.push("audio streaming stopped");
      }
      // Avoid empty "On Home." spam when nothing else changed on a UI frame
      if (parts.length === 1 && !screenChanged && !freshPress) {
        return { text: "", category: "ui", coalesceKey: "", skip: true };
      }
      return {
        text: parts.join(" · ") + ".",
        category: "ui",
        coalesceKey: freshPress ? `ui|${screen}|${st.button}|${st.action || 0}` : `nav|${screen}`,
        skip: false,
      };
    }

    // Periodic health (kind 0) with stale button — only status deltas
    const changes = [];
    if (!prev || prev.wifiStatus !== st.wifiStatus) {
      changes.push(`Wi‑Fi ${st.wifiStatusName.toLowerCase()}`);
    }
    if (!prev || prev.mqtt !== st.mqtt) {
      changes.push(st.mqtt ? "MQTT online" : "MQTT offline");
    }
    if (st.audioStreaming && (!prev || !prev.audioStreaming)) {
      changes.push("audio streaming started");
    }
    if (!st.audioStreaming && prev?.audioStreaming) {
      changes.push("audio streaming stopped");
    }
    if (!prev || prev.batteryPct !== st.batteryPct || prev.batteryChg !== st.batteryChg) {
      changes.push(`battery ${st.batteryPct}% (${st.batteryChgName})`);
    }
    // Always surface STM die temp when present (user-visible vs ESP-only Story)
    if (st.mcuTempOk && (!prev || !prev.mcuTempOk || Math.abs((prev.mcuTempC || 0) - st.mcuTempC) >= 1)) {
      changes.push(`STM MCU ${st.mcuTempC} °C`);
    }
    if (!prev) {
      changes.push(
        `STM health on ${screen}: Wi‑Fi ${st.wifiStatusName}, MQTT ${st.mqtt ? "online" : "offline"}, battery ${st.batteryPct}%` +
          (st.mcuTempOk ? `, STM MCU ${st.mcuTempC} °C` : "")
      );
    }
    if (!changes.length) {
      return { text: "", category: "metric", coalesceKey: "", skip: true };
    }
    return {
      text: `STM status · on ${screen} · ${changes.join(" · ")}.`,
      category: "metric",
      coalesceKey: "",
      skip: false,
    };
  }

  function faultStoryLine(ev, lastScreen) {
    const prefix = ev.code.split("-")[0];
    const onScreen = lastScreen ? ` (while on ${lastScreen})` : "";
    if (prefix === "WF") return `Wi‑Fi problem: ${ev.meaning}${onScreen}.`;
    if (prefix === "MQ") return `MQTT problem: ${ev.meaning}${onScreen}.`;
    if (prefix === "TL") return `Cloud reachability problem: ${ev.meaning}${onScreen}.`;
    if (prefix === "TM") return `Temperature probe alert: ${ev.meaning}${onScreen}.`;
    if (prefix === "PW") return `Power / battery alert: ${ev.meaning}${onScreen}.`;
    if (prefix === "UA" || prefix === "SU" || prefix === "SJ") {
      return `STM↔ESP link alert (${ev.code}): ${ev.meaning}${onScreen}.`;
    }
    if (prefix === "ST") return `STM system alert (${ev.code}): ${ev.meaning}${onScreen}.`;
    if (prefix === "SF") return `STM stream/flow alert (${ev.code}): ${ev.meaning}${onScreen}.`;
    if (prefix === "SC") return `STM cloud/Wi‑Fi alert (${ev.code}): ${ev.meaning}${onScreen}.`;
    if (prefix === "SS") return `STM runtime alert (${ev.code}): ${ev.meaning}${onScreen}.`;
    if (prefix === "IO") return `Button/GPIO alert (${ev.code}): ${ev.meaning}${onScreen}.`;
    if (ev.source === "STM") return `STM alert (${ev.code}): ${ev.meaning}${onScreen}.`;
    return `ESP alert (${ev.code}): ${ev.meaning}${onScreen}.`;
  }

  function coalesceStoryLines(lines) {
    const out = [];
    lines.forEach((line) => {
      if (!line || line.skip || !line.text) return;
      const prev = out[out.length - 1];
      const key = line.coalesceKey || "";
      const canCoalesce =
        key &&
        prev &&
        prev.coalesceKey === key &&
        ((key.startsWith("ui|") && prev.category === "ui") ||
          (key.startsWith("fault|") && prev.category === "fault"));
      if (canCoalesce) {
        prev.count = (prev.count || 1) + 1;
        prev.text = prev.text.replace(/\s*\(\d+×\)\./, ".").replace(/\.$/, ` (${prev.count}×).`);
        prev.serverTime = line.serverTime || prev.serverTime;
        return;
      }
      out.push({ ...line, count: 1 });
    });
    return out;
  }

  function buildReportModel(eventsPayload, meta = {}) {
    const list = Array.isArray(eventsPayload)
      ? eventsPayload
      : Array.isArray(eventsPayload?.events)
        ? eventsPayload.events
        : [];
    const normalized = list.map(normalizeEvent).sort((a, b) => {
      if (a.eventTimeS !== b.eventTimeS) return a.eventTimeS - b.eventTimeS;
      return String(a.serverReceivedAt).localeCompare(String(b.serverReceivedAt));
    });

    const byTime = new Map();
    normalized.forEach((ev) => {
      const key = String(ev.eventTimeS);
      if (!byTime.has(key)) byTime.set(key, []);
      byTime.get(key).push(ev);
    });

    const allRows = [];
    const faultRows = [];
    const rawStory = [];
    const stmFrames = [];
    const rowByKey = new Map();
    let prevStm = null;
    let prevEspWifi = null;
    let prevEspMqtt = null;
    let lastStmHeartbeatTs = null;
    let wifiDrops = 0;
    let mqttDrops = 0;
    let lastScreen = "";
    let unsynced = 0;
    let stmDecoded = 0;
    let stmSkippedChunks = 0;

    function rowKey(ev) {
      return `${ev.eventTimeS}|${ev.code}|${ev.serverReceivedAt}|${ev.sessionHex}|${ev.sequenceHex}`;
    }

    normalized.forEach((ev) => {
      if (ev.timeQuality === "U") unsynced += 1;
      if (ev.code.startsWith("WF-")) wifiDrops += 1;
      if (ev.code.startsWith("MQ-")) mqttDrops += 1;

      const row = {
        deviceTime: ev.deviceTimeText,
        serverTime: ev.serverTimeText,
        timeQuality: ev.timeQuality,
        source: ev.source,
        kind: ev.kind,
        code: ev.code,
        meaning: ev.meaning,
        value: ev.valueText,
        session: ev.sessionHex,
        sequence: ev.sequenceHex,
        repeat: ev.repeat,
        bucketId: ev.bucketId,
        eventTimeS: ev.eventTimeS,
        serverReceivedAt: ev.serverReceivedAt,
        isFault: ev.isFault,
        isUi: isUiRelated(ev.code),
      };
      allRows.push(row);
      rowByKey.set(rowKey(ev), row);
      if (ev.isFault) faultRows.push(row);
    });

    [...byTime.keys()]
      .map(Number)
      .sort((a, b) => a - b)
      .forEach((ts) => {
        const group = byTime.get(String(ts)) || [];
        const tLabel = group[0]?.deviceTimeText || String(ts);
        const sdChunks = group.filter((e) => e.kind === "status_chunk");
        const pmChunks = group.filter((e) => /^PM-/.test(e.code));
        const faults = group.filter((e) => e.isFault);

        if (sdChunks.length) {
          const payload = rebuildSdPayload(sdChunks);
          const st = decodeStmStatus(payload);
          if (st) {
            stmDecoded += 1;
            lastScreen = st.screenName;
            stmFrames.push({
              deviceTime: tLabel,
              serverTime: group[0]?.serverTimeText || "",
              eventTimeS: ts,
              kind: st.kind === 1 ? "UI" : "health",
              screen: st.screenName,
              button: st.buttonName,
              buttonAgeS: st.buttonAgeS,
              action: st.action ? st.actionName : "—",
              wifi: st.wifiStatusName,
              mqtt: st.mqtt ? "online" : "offline",
              audio: st.audioStreaming ? "streaming" : "idle",
              batteryPct: st.batteryPct,
              batteryMv: st.batteryMv,
              mcuTempC: st.mcuTempOk ? st.mcuTempC : null,
              mcuTempOk: st.mcuTempOk ? "yes" : "no",
            });
            const detail = [
              `screen=${st.screenName}`,
              `kind=${st.kind === 1 ? "UI" : "health"}`,
              st.buttonName !== "none" ? `btn=${st.buttonName} age=${st.buttonAgeS}s` : null,
              st.action ? `action=${st.actionName}` : null,
              st.mcuTempOk ? `STM_MCU=${st.mcuTempC}C` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            sdChunks.forEach((ev) => {
              const row = rowByKey.get(rowKey(ev));
              if (row && /^SD-0[12]$/.test(row.code)) {
                row.value = detail;
                row.meaning = `STM status · ${detail}`;
              }
            });
            const narr = stmStoryLine(st, prevStm);
            if (!narr.skip && narr.text) {
              rawStory.push({
                time: tLabel,
                eventTimeS: ts,
                serverTime: group[0]?.serverTimeText || "",
                text: narr.text,
                category: narr.category,
                coalesceKey: narr.coalesceKey || "",
              });
            }
            // Heartbeat so Story always shows STM MCU temp / screen at least every ~60s
            const needBeat =
              lastStmHeartbeatTs == null ||
              (Number.isFinite(ts) && ts - lastStmHeartbeatTs >= 60);
            if (needBeat) {
              const already =
                narr &&
                !narr.skip &&
                narr.text &&
                (narr.text.includes("STM MCU") || narr.text.includes("Navigated"));
              if (!already) {
                const bits = [`on ${st.screenName}`];
                if (st.mcuTempOk) bits.push(`STM MCU ${st.mcuTempC} °C`);
                bits.push(`battery ${st.batteryPct}%`);
                bits.push(st.mqtt ? "MQTT online" : "MQTT offline");
                rawStory.push({
                  time: tLabel,
                  eventTimeS: ts,
                  serverTime: group[0]?.serverTimeText || "",
                  text: `STM status · ${bits.join(" · ")}.`,
                  category: "metric",
                  coalesceKey: "",
                });
              }
              lastStmHeartbeatTs = ts;
            }
            prevStm = st;
          } else {
            stmSkippedChunks += 1;
          }
        }

        faults.forEach((ev) => {
          rawStory.push({
            time: tLabel,
            eventTimeS: ts,
            serverTime: ev.serverTimeText,
            text: faultStoryLine(ev, lastScreen),
            category: "fault",
            coalesceKey: `fault|${ev.code}`,
          });
        });

        // Periodic ESP metrics flood Story — only emit on Wi‑Fi/MQTT change or new SSID
        if (!sdChunks.length && pmChunks.length) {
          const ssid = rebuildSsid(pmChunks);
          const wifiOn = pmChunks.find((e) => e.code === "PM-09");
          const mqttOn = pmChunks.find((e) => e.code === "PM-12");
          const heap = pmChunks.find((e) => e.code === "PM-01");
          const die = pmChunks.find((e) => e.code === "PM-49");
          const wifiVal = wifiOn ? wifiOn.valueU32 : null;
          const mqttVal = mqttOn ? mqttOn.valueU32 : null;
          const wifiChanged = wifiVal != null && wifiVal !== prevEspWifi;
          const mqttChanged = mqttVal != null && mqttVal !== prevEspMqtt;
          const firstSnap = prevEspWifi == null && prevEspMqtt == null && (wifiOn || mqttOn || ssid);
          if (ssid || wifiChanged || mqttChanged || firstSnap) {
            const bits = [];
            if (wifiOn) bits.push(wifiOn.valueU32 ? "Wi‑Fi connected" : "Wi‑Fi not connected");
            if (mqttOn) bits.push(mqttOn.valueU32 ? "MQTT online" : "MQTT offline");
            if (heap && (wifiChanged || mqttChanged || firstSnap)) {
              bits.push(`ESP free heap ${heap.valueU32} bytes`);
            }
            if (die && (wifiChanged || mqttChanged || firstSnap)) {
              bits.push(`ESP die temperature ${formatMetricDetail("PM-49", die.valueU32)}`);
            }
            if (ssid) bits.push(`Wi‑Fi network “${ssid}”`);
            if (bits.length) {
              rawStory.push({
                time: tLabel,
                eventTimeS: ts,
                serverTime: group[0]?.serverTimeText || "",
                text: `ESP status: ${bits.join("; ")}.`,
                category: "metric",
                coalesceKey: "",
              });
            }
          }
          if (wifiVal != null) prevEspWifi = wifiVal;
          if (mqttVal != null) prevEspMqtt = mqttVal;
        }
      });

    const storyLines = coalesceStoryLines(rawStory);

    const deviceId = meta.deviceId || eventsPayload?.device_id || normalized[0]?.raw?.device_id || "";
    const day = meta.date || eventsPayload?.day || "";
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    const summary = {
      deviceId,
      date: day,
      totalEvents: normalized.length,
      faultCount: faultRows.length,
      wifiDrops,
      mqttDrops,
      lastScreen: lastScreen || "—",
      firstDeviceTime: first?.deviceTimeText || "—",
      lastDeviceTime: last?.deviceTimeText || "—",
      firstServerTime: first?.serverTimeText || "—",
      lastServerTime: last?.serverTimeText || "—",
      unsyncedCount: unsynced,
      unsyncedRatio: normalized.length ? unsynced / normalized.length : 0,
      stmDecoded,
      stmSkippedChunks,
      stmFrameCount: stmFrames.length,
      storyCount: storyLines.length,
      decodeBuild: DECODE_BUILD,
    };

    return { summary, storyLines, allRows, faultRows, stmFrames, normalized };
  }

  function filterPreviewRows(model, chip) {
    if (!model) return [];
    if (chip === "faults") return model.storyLines.filter((l) => l.category === "fault");
    if (chip === "ui") return model.storyLines.filter((l) => l.category === "ui");
    return model.storyLines;
  }

  global.VetDiagLogDecode = {
    buildReportModel,
    filterPreviewRows,
    normalizeCode,
    isFaultCode,
    FAMILY_PREFIX,
    DECODE_BUILD,
  };
})(window);
