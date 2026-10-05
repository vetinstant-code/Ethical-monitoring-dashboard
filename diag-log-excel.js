/**
 * Build polished diagnostic Excel: Story / All events / Faults.
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
    row.height = 22;
  }

  function styleDataCell(cell, { bg, bold } = {}) {
    cell.font = { name: "Calibri", size: 11, bold: !!bold, color: { argb: `FF${COLORS.text}` } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
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

  function autoHeight(row, text, min = 18, max = 72) {
    const len = String(text || "").length;
    const lines = Math.max(1, Math.ceil(len / 90));
    row.height = Math.min(max, Math.max(min, lines * 15));
  }

  function writeSummaryBlock(ws, summary, from, to) {
    const lines = [
      ["Device", summary.deviceId || "—"],
      ["UTC date", summary.date || "—"],
      ["Time filter", from || to ? `${from || "start"} → ${to || "end"}` : "Full day"],
      ["Total events", String(summary.totalEvents ?? 0)],
      ["Faults / alerts", String(summary.faultCount ?? 0)],
      ["Wi‑Fi drop events", String(summary.wifiDrops ?? 0)],
      ["MQTT drop events", String(summary.mqttDrops ?? 0)],
      ["Last screen seen", summary.lastScreen || "—"],
      ["First device time", summary.firstDeviceTime || "—"],
      ["Last device time", summary.lastDeviceTime || "—"],
      ["First server received", summary.firstServerTime || "—"],
      ["Last server received", summary.lastServerTime || "—"],
    ];

    ws.mergeCells(1, 1, 1, 4);
    const title = ws.getCell(1, 1);
    title.value = "Diagnostic event log — summary";
    title.font = { bold: true, size: 14, name: "Calibri", color: { argb: `FF${COLORS.headerBg}` } };
    title.alignment = { vertical: "middle" };
    ws.getRow(1).height = 26;

    lines.forEach((pair, idx) => {
      const r = idx + 3;
      const row = ws.getRow(r);
      row.getCell(1).value = pair[0];
      row.getCell(2).value = pair[1];
      styleDataCell(row.getCell(1), { bg: COLORS.summaryBg, bold: true });
      styleDataCell(row.getCell(2), { bg: COLORS.summaryBg });
      ws.mergeCells(r, 2, r, 4);
      row.height = 20;
    });
    return 3 + lines.length + 1;
  }

  function buildStorySheet(wb, model, meta) {
    const ws = wb.addWorksheet("Story", {
      views: [{ state: "frozen", ySplit: 1, activeCell: "A1" }],
    });
    setWidths(ws, [22, 24, 100, 14]);
    const start = writeSummaryBlock(ws, model.summary, meta.from, meta.to);

    const headerRow = ws.getRow(start);
    headerRow.values = ["Device time", "Server received", "What happened", "Category"];
    styleHeader(headerRow, COLORS.headerBg);
    ws.views = [{ state: "frozen", ySplit: start, activeCell: `A${start + 1}` }];

    model.storyLines.forEach((line, i) => {
      const row = ws.getRow(start + 1 + i);
      row.values = [line.time, line.serverTime || "—", line.text, line.category];
      let bg = i % 2 ? COLORS.storyAlt : null;
      if (line.category === "fault") bg = COLORS.faultBg;
      else if (line.category === "ui") bg = COLORS.uiBg;
      else if (line.category === "metric") bg = COLORS.metricBg;
      row.eachCell((cell) => styleDataCell(cell, { bg }));
      autoHeight(row, line.text, 22, 90);
    });

    if (!model.storyLines.length) {
      const row = ws.getRow(start + 1);
      row.values = ["—", "—", "No story lines for this selection.", "—"];
      row.eachCell((cell) => styleDataCell(cell, { bg: COLORS.warnBg }));
    }
  }

  function buildTableSheet(wb, name, rows, headerBg) {
    const ws = wb.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 1 }],
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
    setWidths(ws, [22, 24, 12, 10, 14, 12, 42, 22, 12, 12, 10, 10]);
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
      row.eachCell((cell) => styleDataCell(cell, { bg }));
      autoHeight(row, `${r.meaning} ${r.value}`, 20, 60);
    });

    if (!rows.length) {
      const row = ws.getRow(2);
      row.values = ["—", "—", "—", "—", "—", "—", "No rows for this selection.", "", "", "", "", ""];
      row.eachCell((cell) => styleDataCell(cell, { bg: COLORS.warnBg }));
    }
  }

  async function exportDiagWorkbook(model, meta = {}) {
    if (typeof ExcelJS === "undefined") throw new Error("ExcelJS is not loaded.");
    const wb = new ExcelJS.Workbook();
    wb.creator = "VetInstant Ethical Monitoring Dashboard";
    wb.created = new Date();
    wb.modified = new Date();

    buildStorySheet(wb, model, meta);
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
