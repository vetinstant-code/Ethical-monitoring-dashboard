/**
 * DIAGNOSTIC CODEBOOKS (Browser Client Version)
 * Comprehensive Registry of 25 Families, 66 Performance Metrics, and Causality Ranks
 * Source: diagnostic_codebooks.json & DIAG_SERVER_REGISTRY.md
 */
(function (global) {
  const FAMILIES = {
    1: { prefix: "ST", owner: "STM", name: "STM System / Framing" },
    2: { prefix: "SU", owner: "STM", name: "STM<->ESP UART Link" },
    3: { prefix: "SA", owner: "STM", name: "STM Audio / SPI Transport" },
    4: { prefix: "SF", owner: "STM", name: "STM Stream / App Flow" },
    5: { prefix: "SC", owner: "STM", name: "STM Cloud / WiFi Handshake" },
    6: { prefix: "SS", owner: "STM", name: "STM Runtime" },
    7: { prefix: "SO", owner: "STM", name: "STM OTA Control" },
    8: { prefix: "PW", owner: "STM", name: "Power / MP2722 / Battery" },
    9: { prefix: "IB", owner: "STM", name: "I2C Bus" },
    10: { prefix: "TM", owner: "STM", name: "Temperature Probes" },
    11: { prefix: "AH", owner: "STM", name: "Audio Hardware" },
    12: { prefix: "DP", owner: "STM", name: "Display" },
    13: { prefix: "FM", owner: "STM", name: "External Flash" },
    14: { prefix: "UB", owner: "STM", name: "USB / SpO2" },
    15: { prefix: "IO", owner: "STM", name: "Buttons / GPIO / Rails" },
    16: { prefix: "PR", owner: "ESP", name: "Provisioning" },
    17: { prefix: "UA", owner: "ESP", name: "UART Bridge / STM Link" },
    18: { prefix: "SP", owner: "ESP", name: "SPI Audio Path" },
    19: { prefix: "WF", owner: "ESP", name: "Wi-Fi Faults" },
    20: { prefix: "TL", owner: "ESP", name: "TLS / Reachability Faults" },
    21: { prefix: "MQ", owner: "ESP", name: "MQTT Faults" },
    22: { prefix: "ES", owner: "ESP", name: "ESP System / Crash / Heap Thresholds" },
    23: { prefix: "OT", owner: "ESP", name: "OTA Faults" },
    24: { prefix: "PM", owner: "ESP", name: "Performance / Link Metrics" },
    25: { prefix: "SD", owner: "ESP", name: "STM 0x5B Status Dump Chunks" },
  };

  const PM_METRICS = {
    1: { name: "ESP Free Heap", unit: "bytes", group: "Heap" },
    2: { name: "ESP Min Free Heap", unit: "bytes", group: "Heap" },
    3: { name: "ESP Largest Free Block", unit: "bytes", group: "Heap" },
    4: { name: "Task mqtt_process stack HWM", unit: "bytes", group: "Stack" },
    5: { name: "Wi-Fi RSSI", unit: "dBm", group: "Wi-Fi" },
    6: { name: "Wi-Fi Reconnect Count", unit: "count", group: "Wi-Fi" },
    7: { name: "MQTT Disconnect Count", unit: "count", group: "MQTT" },
    8: { name: "System Uptime", unit: "seconds", group: "System" },
    9: { name: "Wi-Fi Connected", unit: "0/1", group: "Wi-Fi" },
    10: { name: "Wi-Fi Has IP", unit: "0/1", group: "Wi-Fi" },
    11: { name: "Internet Path OK", unit: "0/1", group: "Network" },
    12: { name: "MQTT Connected", unit: "0/1", group: "MQTT" },
    13: { name: "Wi-Fi Reconnecting", unit: "0/1", group: "Wi-Fi" },
    16: { name: "MQTT Ping RTT", unit: "ms", group: "MQTT" },
    17: { name: "Temp Cloud-ACK Queue Depth", unit: "count", group: "Queue" },
    18: { name: "MQTT Outbox Pending", unit: "count", group: "Queue" },
    19: { name: "MQTT Event Queue Depth", unit: "count", group: "Queue" },
    20: { name: "ESP Internal RAM Free", unit: "bytes", group: "Heap" },
    27: { name: "AWS Path Reachable", unit: "0/1", group: "Network" },
    28: { name: "SNTP Time Synchronized", unit: "0/1", group: "System" },
    38: { name: "ESP Total Heap", unit: "bytes", group: "Heap" },
    39: { name: "ESP Used Heap", unit: "bytes", group: "Heap" },
    40: { name: "ESP Heap Utilization %", unit: "%", group: "Heap" },
    49: { name: "Chip Die Temperature", unit: "centi_c", group: "System" },
    50: { name: "Heap Fragmentation Ratio", unit: "ratio_1000", group: "Heap" },
    51: { name: "Last Wi-Fi Disconnect Reason", unit: "code", group: "Wi-Fi" },
    52: { name: "Last Socket Errno", unit: "errno", group: "Network" },
    53: { name: "Last MbedTLS Error", unit: "hex", group: "Network" },
    54: { name: "Last Failed UART CMD", unit: "hex", group: "UART Link" },
    55: { name: "Audio Auscultation Point Code", unit: "code", group: "Audio Flow" },
    56: { name: "Audio Pet ID Hash", unit: "hash", group: "Audio Flow" },
    57: { name: "Temperature Sensor Type", unit: "temp_type", group: "Temperature Flow" },
    58: { name: "Temperature Slot Index", unit: "slot_idx", group: "Temperature Flow" },
  };

  const POINT_NAMES = {
    0: "Heart P (Pulmonic)",
    1: "Heart A (Aortic)",
    2: "Heart M (Mitral)",
    3: "Heart T (Tricuspid)",
    4: "Lung LL1",
    5: "Lung LL2",
    6: "Lung RL1",
    7: "Lung RL2",
  };

  const WIFI_DISCONNECT_REASONS = {
    1: "UNSPECIFIED",
    2: "AUTH_EXPIRE",
    3: "AUTH_LEAVE",
    4: "ASSOC_EXPIRE",
    5: "ASSOC_TOOMANY",
    6: "NOT_AUTHED",
    7: "NOT_ASSOCED",
    8: "ASSOC_LEAVE",
    9: "ASSOC_NOT_AUTHED",
    15: "4WAY_HANDSHAKE_TIMEOUT",
    201: "NO_AP_FOUND",
    202: "AUTH_FAIL",
    203: "ASSOC_FAIL",
    204: "HANDSHAKE_TIMEOUT",
    205: "CONNECTION_FAIL",
    206: "AP_TSF_RESET",
    207: "ROAMING",
  };

  function normalizeCode(rawCode, familyId, codeId) {
    if (rawCode && typeof rawCode === "string" && !rawCode.startsWith("F")) {
      return rawCode.trim();
    }
    const fam = Number(familyId || 0);
    const cod = Number(codeId || 0);
    if (fam === 24) return `PM-${String(cod).padStart(2, "0")}`;
    if (fam === 25) return `SD-${String(cod).padStart(2, "0")}`;
    const fObj = FAMILIES[fam];
    if (fObj) return `${fObj.prefix}-${String(cod).padStart(2, "0")}`;
    if (typeof rawCode === "string" && rawCode.trim()) return rawCode.trim();
    return `FAM${fam}-${cod}`;
  }

  function unpackU32(sourceSession, sourceSequence) {
    const s = Number(sourceSession || 0) & 0xffff;
    const q = Number(sourceSequence || 0) & 0xffff;
    return (q << 16) | s;
  }

  function unpackSigned(u32Val) {
    const val = Number(u32Val >>> 0);
    return val >= 0x80000000 ? val - 0x100000000 : val;
  }

  global.VetDiagCodebooks = {
    FAMILIES,
    PM_METRICS,
    POINT_NAMES,
    WIFI_DISCONNECT_REASONS,
    normalizeCode,
    unpackU32,
    unpackSigned,
  };
})(window);
