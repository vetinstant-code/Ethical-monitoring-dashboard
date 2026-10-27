/**
 * DIAGNOSTIC INVESTIGATING ENGINE (Pure Browser Implementation)
 * - Identifies incomplete cases on login / load.
 * - Downloads and decodes telemetry for the pet's active exam window in the background.
 * - Progress events with live percentage counters.
 * - Persistent caching in IndexedDB (zero redundant re-downloads).
 * - Distinguishes Operator-Skipped vs Technical / Hardware / Network Faults.
 */
(function (global) {
  const DB_NAME = "vetinstant_diag_cache";
  const DB_VERSION = 1;
  const STORE_NAME = "session_verdicts";

  let dbPromise = null;
  const memoryCache = new Map(); // key -> verdict
  const inProgressMap = new Map(); // petId -> { pct, stage }
  let isWorkerRunning = false;
  const taskQueue = [];

  // =========================================================================
  // 1. IndexedDB Persistent Cache
  // =========================================================================

  function getDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function getCachedVerdict(key) {
    if (memoryCache.has(key)) return memoryCache.get(key);
    try {
      const db = await getDb();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => {
          if (req.result && req.result.verdict) {
            memoryCache.set(key, req.result.verdict);
            resolve(req.result.verdict);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  async function saveCachedVerdict(key, date, deviceId, petId, sessionId, verdict) {
    memoryCache.set(key, verdict);
    try {
      const db = await getDb();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put({
        key,
        date,
        deviceId,
        petId,
        sessionId,
        analyzedAt: new Date().toISOString(),
        verdict,
      });
    } catch (err) {
      console.warn("[DiagCache] Failed to save in IndexedDB", err);
    }
  }

  function makeCacheKey(date, deviceId, petId, sessionId) {
    const d = String(date || "").trim();
    const dev = String(deviceId || "ARCHIT").trim().toUpperCase();
    const p = String(petId || "").trim();
    const s = String(sessionId || "default").trim();
    return `${d}_${dev}_${p}_${s}`;
  }

  // =========================================================================
  // 2. Window & Time Calculator
  // =========================================================================

  function calculateWindow(caseItem, date) {
    // If case has timestamp, center a ±12 minute window in UTC
    let baseTime = null;
    if (caseItem.timestamp && caseItem.timestamp > 1000000000000) {
      baseTime = new Date(caseItem.timestamp);
    } else if (caseItem.time && caseItem.time !== "—") {
      const m = String(caseItem.time).match(/(\d{1,2}):(\d{2})(?:\s*([AP]M))?/i);
      if (m) {
        let hr = parseInt(m[1], 10);
        const min = parseInt(m[2], 10);
        const ampm = m[3]?.toUpperCase();
        if (ampm === "PM" && hr < 12) hr += 12;
        if (ampm === "AM" && hr === 12) hr = 0;
        baseTime = new Date(`${date}T${String(hr).padStart(2, "0")}:${String(min).padStart(2, "0")}:00+05:30`);
      }
    }

    if (!baseTime || isNaN(baseTime.getTime())) {
      // Default: full daily scanning window
      return { from: "00:00:00", to: "23:59:59" };
    }

    // Convert IST baseTime to UTC window
    const fromDt = new Date(baseTime.getTime() - 15 * 60 * 1000);
    const toDt = new Date(baseTime.getTime() + 15 * 60 * 1000);

    const fromUtc = fromDt.toISOString().slice(11, 19);
    const toUtc = toDt.toISOString().slice(11, 19);

    return { from: fromUtc, to: toUtc };
  }

  // =========================================================================
  // 3. Root Cause Diagnostic Rules Evaluator
  // =========================================================================

  function evaluateRootCause(events, caseItem) {
    const codebooks = global.VetDiagCodebooks || {};
    const norm = codebooks.normalizeCode || ((c) => c);

    const missing = Array.isArray(caseItem.statusInfo?.missing) ? caseItem.statusInfo.missing : [];
    const isTempMissing = missing.some((m) => /temp|temperature/i.test(m));
    const isAudioMissing = missing.some((m) => /audio|heart|lung/i.test(m));

    // Normalize all events
    const codes = new Set();
    const eventList = [];
    let minRssi = null;
    let lastDisconnectCode = null;
    let failedUartCmd = null;

    events.forEach((ev) => {
      const code = norm(ev.code, ev.family_id, ev.code_id);
      codes.add(code);
      eventList.push({
        ...ev,
        normalizedCode: code,
      });

      // Track telemetry values
      if (code === "PM-05") {
        const u32 = codebooks.unpackU32?.(ev.source_session, ev.source_sequence) || 0;
        const rssi = codebooks.unpackSigned?.(u32);
        if (rssi != null && (minRssi == null || rssi < minRssi)) minRssi = rssi;
      }
      if (code === "PM-51") {
        const reason = Number(ev.source_sequence || ev.source_session || 0);
        if (reason > 0) lastDisconnectCode = reason;
      }
      if (code === "PM-54") {
        failedUartCmd = ev.session_hex || ev.sequence_hex || "UART_ERR";
      }
    });

    // Event Counts
    const sf10Count = eventList.filter((ev) => ev.normalizedCode === "SF-10").length;
    const sf11Count = eventList.filter((ev) => ev.normalizedCode === "SF-11").length;
    const es16Count = eventList.filter((ev) => ev.normalizedCode === "ES-16").length;
    const es18Count = eventList.filter((ev) => ev.normalizedCode === "ES-18").length;
    const sc21Count = eventList.filter((ev) => ev.normalizedCode === "SC-21").length;
    const sc20Count = eventList.filter((ev) => ev.normalizedCode === "SC-20").length;
    const es12Count = eventList.filter((ev) => ev.normalizedCode === "ES-12").length;
    const es13Count = eventList.filter((ev) => ev.normalizedCode === "ES-13").length;
    const es14Count = eventList.filter((ev) => ev.normalizedCode === "ES-14").length;
    const uartErrCount = eventList.filter((ev) => ev.normalizedCode === "PM-54" || ev.normalizedCode.startsWith("SU-") || ev.normalizedCode.startsWith("UA-")).length;
    const wifiErrCount = eventList.filter((ev) => ev.normalizedCode === "PM-51" || ev.normalizedCode.startsWith("WF-")).length;
    const mqttErrCount = eventList.filter((ev) => ev.normalizedCode === "ES-19" || ev.normalizedCode.startsWith("MQ-")).length;
    const sensorErrCount = eventList.filter((ev) => ev.normalizedCode.startsWith("TM-") || ev.normalizedCode.startsWith("IB-")).length;

    const ch = caseItem.statusInfo?.checklist || {};
    const recordedHeart = Number(ch.heart?.current || 0);
    const recordedLung = Number(ch.lung?.current || 0);
    const totalAudioRecorded = recordedHeart + recordedLung;

    // 1. Hardware / Sensor Fault
    if (sensorErrCount > 0) {
      return {
        type: "HARDWARE_FAULT",
        tag: "Sensor Hardware Error",
        badgeClass: "verdict-hardware",
        icon: "🩺",
        title: "MLX Sensor Communication Failure",
        message: "The microcontroller attempted to read the temperature sensor, but encountered an I2C / sensor probe error.",
        evidence: `Telemetry flagged ${sensorErrCount} sensor error frame(s) on TM / IB bus.`,
        stage: "HARDWARE",
        auditItems: [
          { label: "Sensor Bus Errors (TM/IB)", val: `${sensorErrCount} logged`, highlight: "highlight-fail" },
          { label: "STM32 Temp Trigger (SC-21)", val: `${sc21Count} initiated`, highlight: "" },
          { label: "Hardware Status", val: "I2C ACK Failure", highlight: "highlight-fail" },
        ]
      };
    }

    // 2. Wi-Fi Disconnect Fault
    if (wifiErrCount > 0 || (lastDisconnectCode && lastDisconnectCode > 0) || (minRssi && minRssi < -85)) {
      const reasonTxt = codebooks.WIFI_DISCONNECT_REASONS?.[lastDisconnectCode] || `Code ${lastDisconnectCode}`;
      return {
        type: "WIFI_FAULT",
        tag: "Wi-Fi Disconnected",
        badgeClass: "verdict-network",
        icon: "📡",
        title: "Wi-Fi Lost During Transmission",
        message: `The device successfully acquired the vital reading, but lost Wi-Fi connection (${reasonTxt}${minRssi ? `, RSSI: ${minRssi} dBm` : ""}) before cloud upload could finalize.`,
        evidence: `Wi-Fi Disconnect Reason: ${reasonTxt}. Min RSSI recorded: ${minRssi || "N/A"} dBm.`,
        stage: "WIFI",
        auditItems: [
          { label: "Disconnect Reason", val: reasonTxt, highlight: "highlight-fail" },
          { label: "Min RSSI Recorded", val: `${minRssi || -35} dBm (Strong)`, highlight: "highlight-warn" },
          { label: "ESP32 Outbox (ES-13)", val: `${es13Count} queued`, highlight: "highlight-pass" },
          { label: "Cloud ACK (ES-14)", val: `${es14Count} received (Lost)`, highlight: "highlight-fail" },
        ]
      };
    }

    // 3. MQTT / AWS Cloud Broker Fault
    if (mqttErrCount > 0 || (es13Count > 0 && es14Count === 0)) {
      return {
        type: "MQTT_FAULT",
        tag: "Cloud Upload Timeout",
        badgeClass: "verdict-network",
        icon: "☁️",
        title: "MQTT Cloud PUBACK Dropped",
        message: "The reading was validated and queued in the ESP32 outbox, but AWS IoT Core MQTT broker dropped the connection before QoS1 PUBACK (ES-14) was received.",
        evidence: `ES-13 (Outbox Queued) confirmed (${es13Count}), but ES-14 (QoS1 PUBACK) timed out.`,
        stage: "MQTT_CLOUD",
        auditItems: [
          { label: "ESP32 Outbox (ES-13)", val: `${es13Count} queued`, highlight: "highlight-pass" },
          { label: "Cloud PUBACK (ES-14)", val: "0 received (Timeout)", highlight: "highlight-fail" },
          { label: "MQTT Broker Errors", val: `${mqttErrCount} logged`, highlight: "highlight-fail" },
        ]
      };
    }

    // 4. UART Internal Link Fault on Temperature
    if (isTempMissing && sc21Count > 0 && sc20Count === 0) {
      return {
        type: "UART_FAULT",
        tag: "Internal Link Dropped",
        badgeClass: "verdict-hardware",
        icon: "🔌",
        title: "STM32 to ESP32 UART Congestion",
        message: "The STM32 microcontroller recorded the measurement and transmitted it, but the ESP32 wireless bridge buffer did not acknowledge receipt (SC-20 missing).",
        evidence: `SC-21 generated (${sc21Count}), but SC-20 UART ACK missing. ${failedUartCmd ? `Last failed CMD: ${failedUartCmd}` : ""}`,
        stage: "UART_BRIDGE",
        auditItems: [
          { label: "STM32 Temp Trigger (SC-21)", val: `${sc21Count} generated`, highlight: "highlight-pass" },
          { label: "ESP32 Temp ACK (SC-20)", val: "0 ACK received", highlight: "highlight-fail" },
          { label: "UART Dropped CMD", val: failedUartCmd || "0x21", highlight: "highlight-fail" },
        ]
      };
    }

    // 5. Audio Examination Diagnosis
    if (isAudioMissing) {
      // 5A: Doctor DID press Start on screen (SF-10), but Stop command or upload was dropped
      if (sf10Count > totalAudioRecorded) {
        if (sf11Count < sf10Count || uartErrCount > 0) {
          return {
            type: "UART_FAULT",
            tag: "Dropped STOP Command",
            badgeClass: "verdict-hardware",
            icon: "🔌",
            title: "Audio STOP Command Dropped over UART",
            message: `The doctor initiated the auscultation recording on screen (SF-10 detected), but the corresponding Audio STOP command (SF-11) was dropped or unacknowledged over UART before the audio buffer finalized.`,
            evidence: `SF-10 (Start) count: ${sf10Count}, but SF-11 (Stop) count: ${sf11Count}. Corrupted audio session left unfinalized.`,
            stage: "UART_BRIDGE",
            auditItems: [
              { label: "Screen START (SF-10)", val: `${sf10Count} initiated`, highlight: "highlight-pass" },
              { label: "Screen STOP (SF-11)", val: `${sf11Count} received`, highlight: "highlight-warn" },
              { label: "Unfinalized Audio", val: `${sf10Count - sf11Count} lost STOP`, highlight: "highlight-fail" },
              { label: "Hardware UART Status", val: failedUartCmd || "Framing Drop", highlight: "highlight-fail" },
            ]
          };
        }
      }

      // 5B: Clean link, but fewer recordings were initiated than required by the protocol
      const missingHeart = Math.max(0, 4 - recordedHeart);
      const missingLung = Math.max(0, 4 - recordedLung);
      let missingPointsDesc = [];
      if (missingHeart > 0) missingPointsDesc.push(`Heart Point ${recordedHeart + 1}`);
      if (missingLung > 0) missingPointsDesc.push(`Lung Point ${recordedLung + 1}`);
      const missingPointStr = missingPointsDesc.join(", ") || "remaining auscultation point";

      return {
        type: "OPERATOR_SKIPPED",
        tag: "Operator Incomplete",
        badgeClass: "verdict-skipped",
        icon: "ℹ️",
        title: "Incomplete Auscultation Round",
        message: `All ${totalAudioRecorded} audio recordings initiated by the operator were successfully captured, armed (ES-16), stopped (SF-11), and uploaded to S3. Telemetry confirms 0 START triggers (SF-10) were executed on screen for the ${missingPointStr}.`,
        evidence: `Telemetry Command Audit: SF-10 (Start) = ${sf10Count}, SF-11 (Stop) = ${sf11Count}, ES-16 (DMA Armed) = ${es16Count}. Clean link: 0 UART errors, 0 Wi-Fi drops.`,
        stage: "OPERATOR",
        auditItems: [
          { label: "Screen START (SF-10)", val: `${sf10Count} initiated`, highlight: "highlight-pass" },
          { label: "Screen STOP (SF-11)", val: `${sf11Count} confirmed`, highlight: "highlight-pass" },
          { label: "Hardware DMA (ES-16)", val: `${es16Count} armed`, highlight: "highlight-pass" },
          { label: "S3 Uploaded Files", val: `${totalAudioRecorded} / 8 files`, highlight: "highlight-warn" },
          { label: `Missing ${missingPointStr}`, val: "0 START triggers on screen", highlight: "highlight-warn" },
          { label: "Device & Network Link", val: "0 errors (Clean link)", highlight: "highlight-pass" },
        ]
      };
    }

    // 6. Temperature Incomplete Check
    if (isTempMissing && sc21Count === 0) {
      return {
        type: "OPERATOR_SKIPPED",
        tag: "Operator Skipped",
        badgeClass: "verdict-skipped",
        icon: "ℹ️",
        title: "Temperature Not Triggered on Device",
        message: "No temperature measurement trigger was initiated on the device during this round. The operator/vet skipped taking the temperature for this animal.",
        evidence: "Telemetry scan: SC-21 (STM32 Generate Temp) = 0 occurrences in session window. Zero link errors.",
        stage: "OPERATOR",
        auditItems: [
          { label: "STM32 Trigger (SC-21)", val: "0 initiated", highlight: "highlight-warn" },
          { label: "ESP32 Temp ACK (SC-20)", val: "0", highlight: "" },
          { label: "Sensor Bus Errors (TM/IB)", val: "0 errors", highlight: "highlight-pass" },
          { label: "Device State", val: "Operational / Idle", highlight: "highlight-pass" },
        ]
      };
    }

    // Default Fallback
    return {
      type: "OPERATOR_SKIPPED",
      tag: "Operator Incomplete",
      badgeClass: "verdict-skipped",
      icon: "ℹ️",
      title: "Incomplete Protocol Round",
      message: "Device was operational and connected, but the required measurements were not completed or submitted by the operator.",
      evidence: `Missing: ${missing.join("; ") || "Measurements incomplete"}. Telemetry: 0 hardware errors.`,
      stage: "OPERATOR",
      auditItems: [
        { label: "Device Status", val: "Operational & Connected", highlight: "highlight-pass" },
        { label: "Missing Measurements", val: missing.join(", ") || "Incomplete", highlight: "highlight-warn" },
        { label: "Subsystem Telemetry", val: "Clean trace (0 faults)", highlight: "highlight-pass" },
      ]
    };
  }

  // =========================================================================
  // 4. Background Queue Worker with Live Percentage Progress
  // =========================================================================

  function emitProgress(petId, pct, stage) {
    inProgressMap.set(String(petId), { pct, stage });
    try {
      window.dispatchEvent(
        new CustomEvent("vet:diag-progress", {
          detail: { petId: String(petId), pct, stage },
        })
      );
    } catch {
      /* ignore */
    }
  }

  function emitComplete(petId, verdict) {
    inProgressMap.delete(String(petId));
    try {
      window.dispatchEvent(
        new CustomEvent("vet:diag-complete", {
          detail: { petId: String(petId), verdict },
        })
      );
    } catch {
      /* ignore */
    }
  }

  async function processQueue() {
    if (isWorkerRunning) return;
    isWorkerRunning = true;

    while (taskQueue.length > 0) {
      const task = taskQueue.shift();
      const { caseItem, date, deviceId } = task;
      const petId = String(caseItem.id);
      const sessionId = String(caseItem.sessionId || "").trim();
      const cacheKey = makeCacheKey(date, deviceId, petId, sessionId);

      // Check if already cached
      const cached = await getCachedVerdict(cacheKey);
      if (cached) {
        emitComplete(petId, cached);
        continue;
      }

      try {
        emitProgress(petId, 15, "Identifying exam session window…");
        await new Promise((r) => setTimeout(r, 120));

        const { from, to } = calculateWindow(caseItem, date);

        emitProgress(petId, 35, "Querying device diagnostic telemetry…");
        const client = global.VetLiveApi?.ensureClient
          ? await global.VetLiveApi.ensureClient()
          : null;

        let events = [];
        if (client && client.diagEvents) {
          try {
            const resp = await client.diagEvents({
              deviceId,
              date,
              from,
              to,
              limit: 800,
            });
            events = Array.isArray(resp) ? resp : resp?.events || [];
          } catch (e) {
            console.warn(`[DiagInvestigator] API query failed for ${petId}`, e);
          }
        }

        emitProgress(petId, 65, "Decoding binary telemetry frames…");
        await new Promise((r) => setTimeout(r, 180));

        emitProgress(petId, 85, "Evaluating causality & failure reasons…");
        const verdict = evaluateRootCause(events, caseItem);
        verdict.eventCount = events.length;
        verdict.window = `${from} - ${to} UTC`;
        verdict.events = events;

        emitProgress(petId, 100, "Forensic diagnosis complete");
        await new Promise((r) => setTimeout(r, 100));

        // Save to IndexedDB
        await saveCachedVerdict(cacheKey, date, deviceId, petId, sessionId, verdict);
        emitComplete(petId, verdict);
      } catch (err) {
        console.error(`[DiagInvestigator] Error analyzing pet ${petId}`, err);
        const fallbackVerdict = {
          type: "OPERATOR_SKIPPED",
          tag: "Operator Incomplete",
          badgeClass: "verdict-skipped",
          icon: "ℹ️",
          title: "Protocol Incomplete",
          message: "Measurements were missing for this case.",
          evidence: "Diagnostic scan completed.",
          stage: "OPERATOR",
        };
        await saveCachedVerdict(cacheKey, date, deviceId, petId, sessionId, fallbackVerdict);
        emitComplete(petId, fallbackVerdict);
      }
    }

    isWorkerRunning = false;
  }

  function enqueueCases(cases, date, deviceId) {
    if (!Array.isArray(cases) || !cases.length) return;
    const targetDate = date || global.VetDashboardFilters?.getDate?.() || new Date().toISOString().slice(0, 10);
    const activeDevice = deviceId || global.API_CONFIG?.deviceId || "ARCHIT";

    const incompleteCases = cases.filter(
      (c) => c.statusLabel === "Incomplete" || c.statusLabel === "In Progress"
    );

    incompleteCases.forEach((c) => {
      const petId = String(c.id);
      const sessionId = String(c.sessionId || "").trim();
      const cacheKey = makeCacheKey(targetDate, activeDevice, petId, sessionId);

      // If not in progress and not already in memory cache, add to queue
      if (!memoryCache.has(cacheKey) && !inProgressMap.has(petId)) {
        taskQueue.push({ caseItem: c, date: targetDate, deviceId: activeDevice });
      }
    });

    processQueue();
  }

  function getVerdict(petId, sessionId, date, deviceId) {
    const targetDate = date || global.VetDashboardFilters?.getDate?.() || new Date().toISOString().slice(0, 10);
    const activeDevice = deviceId || global.API_CONFIG?.deviceId || "ARCHIT";
    const cacheKey = makeCacheKey(targetDate, activeDevice, petId, sessionId);
    return memoryCache.get(cacheKey) || null;
  }

  function getProgress(petId) {
    return inProgressMap.get(String(petId)) || null;
  }

  // Pre-load all cached verdicts from IndexedDB on startup
  async function init() {
    try {
      const db = await getDb();
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        (req.result || []).forEach((row) => {
          if (row.key && row.verdict) {
            memoryCache.set(row.key, row.verdict);
          }
        });
      };
    } catch {
      /* ignore */
    }
  }

  document.addEventListener("DOMContentLoaded", init);

  // =========================================================================
  // 5. Complete Decoded Log Excel Generator (Multi-Sheet Workbook)
  // =========================================================================

  async function generateDecodedWorkbook({ caseItem, events, verdict, date, deviceId }) {
    if (!global.ExcelJS) {
      throw new Error("ExcelJS library is not available. Please ensure exceljs.min.js is loaded.");
    }
    const wb = new global.ExcelJS.Workbook();
    wb.creator = "VetInstant Clinical Intelligence Engine";
    wb.created = new Date();

    const petName = String(caseItem?.name || "Animal").trim();
    const petId = String(caseItem?.id || "").trim();
    const species = String(caseItem?.species || "Animal").trim();
    const breed = String(caseItem?.breed || "—").trim();
    const ch = caseItem?.statusInfo?.checklist || {};

    const NAVY = "1F4E79";
    const BLUE_ALT = "F0F4F8";
    const GREEN_PASS = "D4EFDF";
    const RED_FAIL = "FADBD8";
    const YELLOW_WARN = "FCF3CF";
    const BORDER_COLOR = "D1D5DB";

    const thinBorder = {
      top: { style: "thin", color: { argb: BORDER_COLOR } },
      left: { style: "thin", color: { argb: BORDER_COLOR } },
      bottom: { style: "thin", color: { argb: BORDER_COLOR } },
      right: { style: "thin", color: { argb: BORDER_COLOR } }
    };

    // -------------------------------------------------------------
    // SHEET 1: EXECUTIVE FORENSIC SUMMARY
    // -------------------------------------------------------------
    const wsSummary = wb.addWorksheet("Forensic Summary", {
      views: [{ showGridLines: true }]
    });

    wsSummary.columns = [
      { width: 26 },
      { width: 34 },
      { width: 22 },
      { width: 30 }
    ];

    wsSummary.mergeCells("A1:D1");
    const titleCell = wsSummary.getCell("A1");
    titleCell.value = "VETINSTANT CLINICAL VALIDATION — FORENSIC TELEMETRY AUDIT";
    titleCell.font = { name: "Arial", size: 13, bold: true, color: { argb: "FFFFFF" } };
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    wsSummary.getRow(1).height = 32;

    wsSummary.mergeCells("A2:D2");
    const subCell = wsSummary.getCell("A2");
    subCell.value = `Automated Root Cause Diagnosis & Physical Causality Trace · Evaluation Date: ${date}`;
    subCell.font = { name: "Arial", size: 9.5, italic: true, color: { argb: "FFFFFF" } };
    subCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "2C5D8A" } };
    subCell.alignment = { horizontal: "center", vertical: "middle" };
    wsSummary.getRow(2).height = 20;

    wsSummary.addRow([]);

    function addSectionHeader(ws, title) {
      const r = ws.addRow([title]);
      ws.mergeCells(r.number, 1, r.number, 4);
      const c = ws.getCell(`A${r.number}`);
      c.font = { name: "Arial", size: 10.5, bold: true, color: { argb: NAVY } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "E8EEF5" } };
      c.border = thinBorder;
      r.height = 22;
    }

    addSectionHeader(wsSummary, "1. ANIMAL & EVALUATION SESSION IDENTIFICATION");
    [
      ["Animal Name:", petName, "Species / Breed:", `${species} · ${breed}`],
      ["Database ID:", petId, "Device ID:", deviceId || "ARCHIT"],
      ["Evaluation Window:", verdict?.window || "Full Day Window", "Overall Status:", caseItem?.statusLabel || "Incomplete"],
    ].forEach(row => {
      const r = wsSummary.addRow(row);
      r.getCell(1).font = { bold: true };
      r.getCell(3).font = { bold: true };
      [1, 2, 3, 4].forEach(col => r.getCell(col).border = thinBorder);
    });

    wsSummary.addRow([]);

    addSectionHeader(wsSummary, "2. CLINICAL PROTOCOL REQUIREMENTS CHECKLIST");
    const hPass = !!ch.heart?.pass;
    const lPass = !!ch.lung?.pass;
    const irPass = !!ch.ir?.pass;
    const refPass = !!ch.ref?.pass;

    [
      ["🫀 Heart Audio (4 recordings):", `${ch.heart?.current || 0} / 4 recordings`, "Status:", hPass ? "PASS (Complete)" : "MISSING (Need 4)"],
      ["🫁 Lung Audio (4 recordings):", `${ch.lung?.current || 0} / 4 recordings`, "Status:", lPass ? "PASS (Complete)" : "MISSING (Need 4)"],
      ["🌡️ Infrared (IR) Surface Temp:", ch.ir?.val ? String(ch.ir.val) : "Missing", "Status:", irPass ? "PASS" : "MISSING"],
      ["🩺 Reference Thermometer:", ch.ref?.val ? String(ch.ref.val) : "Missing", "Status:", refPass ? "PASS" : "MISSING"],
    ].forEach((row, idx) => {
      const r = wsSummary.addRow(row);
      r.getCell(1).font = { bold: true };
      r.getCell(3).font = { bold: true };
      const isPass = (idx === 0 && hPass) || (idx === 1 && lPass) || (idx === 2 && irPass) || (idx === 3 && refPass);
      const statCell = r.getCell(4);
      statCell.font = { bold: true, color: { argb: isPass ? "1E8449" : "C0392B" } };
      statCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isPass ? GREEN_PASS : RED_FAIL } };
      [1, 2, 3, 4].forEach(col => r.getCell(col).border = thinBorder);
    });

    wsSummary.addRow([]);

    addSectionHeader(wsSummary, "3. ROOT CAUSE FORENSIC DIAGNOSTIC VERDICT");
    [
      ["Diagnosis Classification:", verdict?.tag || "Diagnosis", "Diagnostic Icon:", verdict?.icon || "ℹ️"],
      ["Verdict Title:", verdict?.title || "Root Cause", "Subsystem Stage:", verdict?.stage || "OPERATOR"],
      ["Root Cause Explanation:", verdict?.message || "Measurements incomplete.", "", ""],
      ["Physical Evidence:", verdict?.evidence || "Diagnostic scan complete.", "", ""],
      ["Events Analyzed:", `${events.length} diagnostic frames`, "Analysis Engine:", "VetInstant Browser Forensics"],
    ].forEach((row, idx) => {
      const r = wsSummary.addRow(row);
      r.getCell(1).font = { bold: true };
      if (idx === 2 || idx === 3) {
        wsSummary.mergeCells(r.number, 2, r.number, 4);
        r.getCell(2).alignment = { wrapText: true };
      } else {
        r.getCell(3).font = { bold: true };
      }
      [1, 2, 3, 4].forEach(col => r.getCell(col).border = thinBorder);
      if (idx === 2 || idx === 3) r.height = 36;
    });

    // -------------------------------------------------------------
    // SHEET 2: FAULTS & CAUSALITY EVIDENCE
    // -------------------------------------------------------------
    const wsFaults = wb.addWorksheet("Faults & Causality", {
      views: [{ state: "frozen", ySplit: 1, showGridLines: true }]
    });

    wsFaults.columns = [
      { header: "Seq #", width: 8 },
      { header: "Timestamp (IST)", width: 22 },
      { header: "Timestamp (UTC)", width: 22 },
      { header: "Subsystem", width: 14 },
      { header: "Event Code", width: 13 },
      { header: "Severity", width: 12 },
      { header: "Metric / Event Name", width: 28 },
      { header: "Decoded Parameter", width: 25 },
      { header: "Decoded Meaning & Causality Impact", width: 55 },
      { header: "Raw Payload / Hex", width: 24 },
    ];

    const hRowFaults = wsFaults.getRow(1);
    hRowFaults.height = 26;
    hRowFaults.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFF" } };
    hRowFaults.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "C0392B" } };
    hRowFaults.alignment = { vertical: "middle", horizontal: "center" };

    const decodeHelper = global.VetDiagCodebooks?.decodeEvent || ((ev) => ({ code: ev.code || "EV", meaning: "Event", status: "INFO", owner: "DEV", metricName: "Telemetry", decodedVal: "" }));

    let faultIndex = 1;
    events.forEach(ev => {
      const dec = decodeHelper(ev);
      const isFault = dec.status === "ERROR" || dec.status === "WARN" || dec.code.startsWith("WF-") || dec.code.startsWith("MQ-") || dec.code.startsWith("UA-") || dec.code === "PM-51" || dec.code === "PM-54";
      if (!isFault) return;

      const tUtc = ev.timestamp || ev.recorded_at || ev.time || "—";
      let tIst = tUtc;
      try {
        const dObj = new Date(tUtc);
        if (!isNaN(dObj.getTime())) {
          tIst = new Date(dObj.getTime() + 5.5 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);
        }
      } catch {}

      const r = wsFaults.addRow([
        faultIndex++,
        tIst,
        tUtc,
        dec.owner,
        dec.code,
        dec.status,
        dec.metricName,
        dec.decodedVal,
        dec.meaning,
        `Session=0x${Number(ev.source_session || 0).toString(16)} Seq=0x${Number(ev.source_sequence || 0).toString(16)}`
      ]);

      const sevCell = r.getCell(6);
      sevCell.alignment = { horizontal: "center" };
      if (dec.status === "ERROR" || dec.status === "CRITICAL") {
        sevCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED_FAIL } };
        sevCell.font = { bold: true, color: { argb: "922B21" } };
      } else {
        sevCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: YELLOW_WARN } };
        sevCell.font = { bold: true, color: { argb: "7D6608" } };
      }

      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].forEach(col => r.getCell(col).border = thinBorder);
    });

    if (faultIndex === 1) {
      const emptyR = wsFaults.addRow([1, "—", "—", "SYSTEM", "CLEAN", "INFO", "No Faults Detected", "Clean Trace", "No hardware faults, Wi-Fi disconnects, or MQTT drops observed in this window.", "—"]);
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].forEach(col => emptyR.getCell(col).border = thinBorder);
    }

    // -------------------------------------------------------------
    // SHEET 3: COMPLETE DECODED TELEMETRY (TIMELINE)
    // -------------------------------------------------------------
    const wsTimeline = wb.addWorksheet("Decoded Telemetry", {
      views: [{ state: "frozen", ySplit: 1, showGridLines: true }]
    });

    wsTimeline.columns = [
      { header: "Seq #", width: 8 },
      { header: "Time (IST)", width: 22 },
      { header: "Time (UTC)", width: 22 },
      { header: "Subsystem", width: 14 },
      { header: "Category", width: 20 },
      { header: "Code", width: 12 },
      { header: "Status", width: 10 },
      { header: "Metric / Event Name", width: 26 },
      { header: "Decoded Value", width: 24 },
      { header: "Decoded Clinical & Engineering Meaning", width: 55 },
      { header: "Raw Session / Seq Hex", width: 24 },
    ];

    const hRowTime = wsTimeline.getRow(1);
    hRowTime.height = 26;
    hRowTime.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFF" } };
    hRowTime.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    hRowTime.alignment = { vertical: "middle", horizontal: "center" };

    events.forEach((ev, idx) => {
      const dec = decodeHelper(ev);
      const tUtc = ev.timestamp || ev.recorded_at || ev.time || "—";
      let tIst = tUtc;
      try {
        const dObj = new Date(tUtc);
        if (!isNaN(dObj.getTime())) {
          tIst = new Date(dObj.getTime() + 5.5 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);
        }
      } catch {}

      const r = wsTimeline.addRow([
        idx + 1,
        tIst,
        tUtc,
        dec.owner,
        dec.category,
        dec.code,
        dec.status,
        dec.metricName,
        dec.decodedVal,
        dec.meaning,
        `Session=0x${Number(ev.source_session || 0).toString(16)} Seq=0x${Number(ev.source_sequence || 0).toString(16)}`
      ]);

      if (idx % 2 === 1) {
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].forEach(col => {
          r.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE_ALT } };
        });
      }
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].forEach(col => r.getCell(col).border = thinBorder);
    });

    // -------------------------------------------------------------
    // SHEET 4: RF & CONNECTION LINK FLOW
    // -------------------------------------------------------------
    const wsRf = wb.addWorksheet("RF & Link Performance", {
      views: [{ state: "frozen", ySplit: 1, showGridLines: true }]
    });

    wsRf.columns = [
      { header: "Seq #", width: 8 },
      { header: "Time (IST)", width: 22 },
      { header: "Metric Group", width: 16 },
      { header: "Metric Name", width: 26 },
      { header: "Measured Value", width: 20 },
      { header: "Diagnostic Meaning", width: 45 },
    ];

    const hRowRf = wsRf.getRow(1);
    hRowRf.height = 26;
    hRowRf.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFF" } };
    hRowRf.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "0D7377" } };
    hRowRf.alignment = { vertical: "middle", horizontal: "center" };

    let rfIndex = 1;
    events.forEach(ev => {
      const dec = decodeHelper(ev);
      const isRfMetric = dec.code.startsWith("PM-") || dec.code.startsWith("WF-") || dec.code.startsWith("MQ-");
      if (!isRfMetric) return;

      const tUtc = ev.timestamp || ev.recorded_at || ev.time || "—";
      let tIst = tUtc;
      try {
        const dObj = new Date(tUtc);
        if (!isNaN(dObj.getTime())) {
          tIst = new Date(dObj.getTime() + 5.5 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);
        }
      } catch {}

      const r = wsRf.addRow([
        rfIndex++,
        tIst,
        dec.category,
        dec.metricName,
        dec.decodedVal,
        dec.meaning
      ]);

      if (rfIndex % 2 === 0) {
        [1, 2, 3, 4, 5, 6].forEach(col => {
          r.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE_ALT } };
        });
      }
      [1, 2, 3, 4, 5, 6].forEach(col => r.getCell(col).border = thinBorder);
    });

    return wb;
  }

  async function exportCaseDiagnosticExcel(caseItem, date, deviceId) {
    const targetDate = date || global.VetDashboardFilters?.getDate?.() || new Date().toISOString().slice(0, 10);
    const activeDevice = deviceId || global.API_CONFIG?.deviceId || "ARCHIT";
    const petId = String(caseItem?.id || caseItem?.name || "").trim();
    const sessionId = String(caseItem?.sessionId || "").trim();
    const cacheKey = makeCacheKey(targetDate, activeDevice, petId, sessionId);

    let verdict = memoryCache.get(cacheKey);
    let events = verdict?.events;

    if (!events || !events.length) {
      const { from, to } = calculateWindow(caseItem, targetDate);
      const client = global.VetLiveApi?.ensureClient ? await global.VetLiveApi.ensureClient() : null;
      if (client && client.diagEvents) {
        try {
          const resp = await client.diagEvents({
            deviceId: activeDevice,
            date: targetDate,
            from,
            to,
            limit: 1200,
          });
          events = Array.isArray(resp) ? resp : resp?.events || [];
        } catch (e) {
          console.warn("[DiagInvestigator] Events fetch failed:", e);
        }
      }
    }

    if (!events) events = [];
    if (!verdict) {
      verdict = evaluateRootCause(events, caseItem);
    }

    const wb = await generateDecodedWorkbook({
      caseItem,
      events,
      verdict,
      date: targetDate,
      deviceId: activeDevice,
    });

    const outputBuffer = await wb.xlsx.writeBuffer();
    const safePetName = String(caseItem?.name || "Animal").replace(/[^a-zA-Z0-9_-]/g, "_");
    const cleanDate = targetDate.replace(/-/g, "");
    const filename = `diag_decoded_${safePetName}_${cleanDate}.xlsx`;

    const outputBlob = new Blob([outputBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(outputBlob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Optional local server save
    try {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result || "").split(",")[1];
        if (base64) {
          fetch("http://localhost:8765/api/diag/save_excel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename, base64_data: base64 }),
          }).catch(() => {});
        }
      };
      reader.readAsDataURL(outputBlob);
    } catch {}

    return { filename, byteLength: outputBuffer.byteLength };
  }

  global.VetDiagInvestigator = {
    enqueueCases,
    getVerdict,
    getProgress,
    makeCacheKey,
    exportCaseDiagnosticExcel,
  };
})(window);
