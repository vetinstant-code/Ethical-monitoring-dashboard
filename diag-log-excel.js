/**
 * Build polished diagnostic Excel: Summary / Story / All events / Faults.
 * Summary is on its own sheet so Story/All/Faults freeze only the header row (comfortable scrolling).
 */
(function (global) {
  const COLORS = {
    headerBg: "0F2237",
    headerFg: "FFFFFF",
    summaryBg: "E8F1F8",
    storyAlt: "F7FAFC",
    faultBg: "FDECEC",
    faultHeader: "B42318",
    warnBg: "FFF4E5",
    uiBg: "ECFDF3",
    metricBg: "EEF2FF",
    border: "D0D5DD",
    text: "101828",
    muted: "475467",
  };

  function styleHeader(row, bg) {
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${bg}` } };
      cell.font = { bold: true, color: { argb: `FF${COLORS.headerFg}` }, name: "Calibri", size: 11 };
      cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: `FF${COLORS.border}` } },
        left: { style: "thin", color: { argb: `FF${COLORS.border}` } },
        bottom: { style: "thin", color: { argb: `FF${COLORS.border}` } },
        right: { style: "thin", color: { argb: `FF${COLORS.border}` } },
      };
    });
    row.height = 24;
  }

  function styleDataCell(cell, { bg, bold, wrap } = {}) {
    cell.font = { name: "Calibri", size: 11, bold: !!bold, color: { argb: `FF${COLORS.text}` } };
    cell.alignment = {
      vertical: "middle",
      horizontal: "left",
      wrapText: wrap !== false,
    };
    cell.border = {
      top: { style: "thin", color: { argb: `FF${COLORS.border}` } },
      left: { style: "thin", color: { argb: `FF${COLORS.border}` } },
      bottom: { style: "thin", color: { argb: `FF${COLORS.border}` } },
      right: { style: "thin", color: { argb: `FF${COLORS.border}` } },
    };
    if (bg) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${bg}` } };
  }

  function setWidths(ws, widths) {
    widths.forEach((w, i) => {
      ws.getColumn(i + 1).width = w;
    });
  }

  function rowHeightFor(text, min = 20, max = 48) {
    const len = String(text || "").length;
    const lines = Math.max(1, Math.ceil(len / 100));
    return Math.min(max, Math.max(min, 18 + (lines - 1) * 14));
  }

  function buildSummarySheet(wb, model, meta) {
    const ws = wb.addWorksheet("Summary", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    setWidths(ws, [28, 48]);
    const title = ws.getRow(1);
    title.values = ["Field", "Value"];
    styleHeader(title, COLORS.headerBg);

    const lines = [
      ["Device", model.summary.deviceId || "—"],
      ["UTC date", model.summary.date || "—"],
      ["Time filter", meta.from || meta.to ? `${meta.from || "start"} → ${meta.to || "end"}` : "Full day"],
      ["Total events", String(model.summary.totalEvents ?? 0)],
      ["Faults / alerts", String(model.summary.faultCount ?? 0)],
      ["STM status frames decoded", String(model.summary.stmFrameCount ?? model.summary.stmDecoded ?? 0)],
      ["Wi‑Fi drop events", String(model.summary.wifiDrops ?? 0)],
      ["MQTT drop events", String(model.summary.mqttDrops ?? 0)],
      ["Last screen seen", model.summary.lastScreen || "—"],
      ["First device time", model.summary.firstDeviceTime || "—"],
      ["Last device time", model.summary.lastDeviceTime || "—"],
      ["First server received", model.summary.firstServerTime || "—"],
      ["Last server received", model.summary.lastServerTime || "—"],
      ["Chunks fetched", String(meta.chunks ?? "—")],
      ["Decoder build", model.summary.decodeBuild || "—"],
    ];

    lines.forEach((pair, i) => {
      const row = ws.getRow(i + 2);
      row.values = pair;
      styleDataCell(row.getCell(1), { bg: COLORS.summaryBg, bold: true, wrap: false });
      styleDataCell(row.getCell(2), { bg: COLORS.summaryBg, wrap: false });
      row.height = 22;
    });
  }

  function buildStorySheet(wb, model) {
    const ws = wb.addWorksheet("Story", {
      views: [{ state: "frozen", ySplit: 1, activeCell: "A2" }],
    });
    setWidths(ws, [24, 26, 110, 12]);
    const headerRow = ws.getRow(1);
    headerRow.values = ["Device time", "Server received", "What happened", "Category"];
    styleHeader(headerRow, COLORS.headerBg);

    model.storyLines.forEach((line, i) => {
      const row = ws.getRow(i + 2);
      row.values = [line.time, line.serverTime || "—", line.text, line.category];
      let bg = i % 2 ? COLORS.storyAlt : null;
      if (line.category === "fault") bg = COLORS.faultBg;
      else if (line.category === "ui") bg = COLORS.uiBg;
      else if (line.category === "metric") bg = COLORS.metricBg;
      row.eachCell((cell, col) => styleDataCell(cell, { bg, wrap: col === 3 }));
      row.height = rowHeightFor(line.text, 22, 56);
    });

    if (!model.storyLines.length) {
      const row = ws.getRow(2);
      row.values = ["—", "—", "No story lines for this selection.", "—"];
      row.eachCell((cell) => styleDataCell(cell, { bg: COLORS.warnBg }));
    }

    // Autofilter for comfortable browsing
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, model.storyLines.length + 1), column: 4 },
    };
  }

  function buildTableSheet(wb, name, rows, headerBg) {
    const ws = wb.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 1, activeCell: "A2" }],
    });
    const headers = [
      "Device time",
      "Server received",
      "Time quality",
      "Source",
      "Kind",
      "Code",
      "Meaning",
      "Value / detail",
      "Session",
      "Sequence",
      "Repeat",
      "Bucket",
    ];
    setWidths(ws, [24, 26, 12, 10, 14, 12, 44, 24, 12, 12, 10, 10]);
    const headerRow = ws.getRow(1);
    headerRow.values = headers;
    styleHeader(headerRow, headerBg);

    rows.forEach((r, i) => {
      const row = ws.getRow(i + 2);
      row.values = [
        r.deviceTime,
        r.serverTime,
        r.timeQuality,
        r.source,
        r.kind,
        r.code,
        r.meaning,
        r.value,
        r.session,
        r.sequence,
        r.repeat,
        r.bucketId,
      ];
      const bg = r.isFault ? COLORS.faultBg : i % 2 ? COLORS.storyAlt : null;
      row.eachCell((cell, col) => styleDataCell(cell, { bg, wrap: col === 7 || col === 8 }));
      row.height = rowHeightFor(`${r.meaning} ${r.value}`, 20, 40);
    });

    if (!rows.length) {
      const row = ws.getRow(2);
      row.values = ["—", "—", "—", "—", "—", "—", "No rows for this selection.", "", "", "", "", ""];
      row.eachCell((cell) => styleDataCell(cell, { bg: COLORS.warnBg }));
    }

    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, rows.length + 1), column: headers.length },
    };
  }

  function buildStmTimelineSheet(wb, model) {
    const ws = wb.addWorksheet("STM timeline", {
      views: [{ state: "frozen", ySplit: 1, activeCell: "A2" }],
    });
    const headers = [
      "Device time",
      "Server received",
      "Kind",
      "Screen",
      "Button",
      "Btn age (s)",
      "Action",
      "Wi‑Fi",
      "MQTT",
      "Audio",
      "Battery %",
      "Battery mV",
      "STM MCU °C",
      "MCU ok",
    ];
    setWidths(ws, [24, 26, 10, 18, 10, 10, 18, 12, 10, 12, 10, 12, 12, 8]);
    const headerRow = ws.getRow(1);
    headerRow.values = headers;
    styleHeader(headerRow, COLORS.headerBg);

    const frames = model.stmFrames || [];
    frames.forEach((f, i) => {
      const row = ws.getRow(i + 2);
      row.values = [
        f.deviceTime,
        f.serverTime,
        f.kind,
        f.screen,
        f.button,
        f.buttonAgeS,
        f.action,
        f.wifi,
        f.mqtt,
        f.audio,
        f.batteryPct,
        f.batteryMv,
        f.mcuTempC == null ? "—" : f.mcuTempC,
        f.mcuTempOk,
      ];
      const bg = f.kind === "UI" ? COLORS.uiBg : i % 2 ? COLORS.storyAlt : null;
      row.eachCell((cell) => styleDataCell(cell, { bg, wrap: false }));
      row.height = 20;
    });

    if (!frames.length) {
      const row = ws.getRow(2);
      row.values = ["—", "—", "—", "No STM 0x5B frames decoded in this window.", "", "", "", "", "", "", "", "", "", ""];
      row.eachCell((cell) => styleDataCell(cell, { bg: COLORS.warnBg }));
    }

    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, frames.length + 1), column: headers.length },
    };
  }

  async function exportDiagWorkbook(model, meta = {}) {
    if (typeof ExcelJS === "undefined") throw new Error("ExcelJS is not loaded.");
    const wb = new ExcelJS.Workbook();
    wb.creator = "VetInstant Ethical Monitoring Dashboard";
    wb.created = new Date();
    wb.modified = new Date();

    buildSummarySheet(wb, model, meta);
    buildStorySheet(wb, model);
    buildStmTimelineSheet(wb, model);
    buildTableSheet(wb, "All events", model.allRows, COLORS.headerBg);
    buildTableSheet(wb, "Faults", model.faultRows, COLORS.faultHeader);

    const buffer = await wb.xlsx.writeBuffer();
    const device = String(meta.deviceId || model.summary.deviceId || "DEVICE").toUpperCase();
    const date = String(meta.date || model.summary.date || "day").replace(/-/g, "");
    const filename = `diag_trace_${device}_${date}.xlsx`;
    return { buffer, filename, byteLength: buffer.byteLength || buffer.length || 0 };
  }

  function downloadBuffer(buffer, filename) {
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  global.VetDiagLogExcel = {
    exportDiagWorkbook,
    downloadBuffer,
  };
})(window);
