/**
 * Client-Side Excel Daily Report Compiler.
 * Matches the logic in ui.py (_generate_daily_summary_excel_action)
 * using ExcelJS. Runs completely in-browser.
 */
(function (global) {
  // Reference Fahrenheit temperatures from legacy Python code
  const REF_TEMPS_F = {
    "GIZMO": ["101.9", "102", "102"],
    "AVANI": ["100.5", "100.5", "100.6"],
    "GANPAT": ["101.0", "101.0", "100.9"],
    "GOD FATHER": ["100.4", "100.6", "100.4"],
    "LUCKY BOY": ["101.4", "101.6", "101.5"],
    "TARANG": ["99.7", "99.6", "99.7"],
    "TOY": ["100.6", "100.4", "100.5"],
    "TRISHUL": ["100.5", "100.2", "100.3"],
    "TULIP": ["99.5", "99.3", "99.5"],
    "VIDHI": ["100.1f", "100.1f", "100.1f"],
    "VIDYUT": ["100.6", "100.7", "100.6"],
    "VINCENT": ["100.2", "100.3", "100.3"],
  };

  const _DAILY_SUMMARY_PET_META_COLS = 3;
  const _IST_OFFSET_MINUTES = 330; // UTC+5:30

  function _daily_summary_col(legacy_col) {
    if (legacy_col <= 2) return legacy_col;
    return legacy_col + _DAILY_SUMMARY_PET_META_COLS;
  }

  function getColumnLetter(col) {
    let letter = "";
    let tempCol = col;
    while (tempCol > 0) {
      let temp = (tempCol - 1) % 26;
      letter = String.fromCharCode(65 + temp) + letter;
      tempCol = Math.floor((tempCol - temp) / 26);
    }
    return letter;
  }

  function _positiveFloat(value) {
    const n = Number(String(value ?? "").replace(/f$/i, "").trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function normalizeTemperatureReadings(payload) {
    if (Array.isArray(payload)) return payload.filter((x) => x && typeof x === "object");
    if (payload && typeof payload === "object") {
      for (const key of ["readings", "temperature_readings", "data", "results"]) {
        if (Array.isArray(payload[key])) {
          return payload[key].filter((x) => x && typeof x === "object");
        }
      }
    }
    return [];
  }

  /** Map summary IR fields into [ambient, forehead, body] for t1/t2/t3. */
  function tBlocksFromSummary(irSummary) {
    const blocks = {
      t1: [0.0, 0.0, 0.0],
      t2: [0.0, 0.0, 0.0],
      t3: [0.0, 0.0, 0.0],
    };
    if (!irSummary || typeof irSummary !== "object") return blocks;

    const nestedAmb = irSummary.ambient && typeof irSummary.ambient === "object" ? irSummary.ambient : null;
    const nestedFore = irSummary.forehead && typeof irSummary.forehead === "object" ? irSummary.forehead : null;

    ["t1", "t2", "t3"].forEach((key, idx) => {
      const n = idx + 1;
      const ambient = _positiveFloat(
        irSummary[`${key}_ambient`] ??
          irSummary[`${key}_amb`] ??
          irSummary[`ambient_${key}`] ??
          irSummary[`ambient_t${n}`] ??
          irSummary[`t_ambient_${n}`] ??
          nestedAmb?.[key] ??
          nestedAmb?.[`t${n}`] ??
          nestedAmb?.[n]
      );
      const forehead = _positiveFloat(
        irSummary[`${key}_forehead`] ??
          irSummary[`${key}_tf`] ??
          irSummary[`forehead_${key}`] ??
          irSummary[`forehead_t${n}`] ??
          irSummary[`tf_${n}`] ??
          nestedFore?.[key] ??
          nestedFore?.[`t${n}`] ??
          nestedFore?.[n]
      );
      const body = _positiveFloat(
        irSummary[key] ?? irSummary[`${key}_body`] ?? irSummary[`${key}_tbody`] ?? irSummary[`body_${key}`]
      );
      if (ambient != null) blocks[key][0] = ambient;
      if (forehead != null) blocks[key][1] = forehead;
      if (body != null) blocks[key][2] = body;
    });
    return blocks;
  }

  function tBlocksFromRawReadings(readings) {
    const blocks = {
      t1: [0.0, 0.0, 0.0],
      t2: [0.0, 0.0, 0.0],
      t3: [0.0, 0.0, 0.0],
    };
    const slotMap = { 1: "t1", 2: "t2", 3: "t3" };
    const colMap = { ambient: 0, t_ambient: 0, forehead: 1, tf: 1, body: 2, tbody: 2 };

    (readings || []).forEach((item) => {
      const sensor = String(item.sensor_type || item.type || item.sensor || "").trim().toLowerCase();
      if (["reference_thermometer", "reference", "tmp", "rectal_sensor", "rectal"].includes(sensor)) return;
      const readingNo = Number(item.reading_number || 0);
      const slot = slotMap[readingNo];
      if (!slot) return;

      const ambient = _positiveFloat(item.ambient ?? item.t_ambient);
      const forehead = _positiveFloat(item.forehead ?? item.tf);
      const body = _positiveFloat(item.body ?? item.tbody ?? item.temperature_value);
      if (ambient != null) blocks[slot][0] = ambient;
      if (forehead != null) blocks[slot][1] = forehead;
      if (body != null) blocks[slot][2] = body;

      const zone = String(item.zone || item.measurement_zone || item.location || "").trim().toLowerCase();
      const val = _positiveFloat(item.temperature_value);
      if (zone && val != null && colMap[zone] != null) {
        blocks[slot][colMap[zone]] = val;
      }
    });
    return blocks;
  }

  function mergeTBlocks(primary, fallback) {
    const out = {
      t1: [...(primary?.t1 || [0, 0, 0])],
      t2: [...(primary?.t2 || [0, 0, 0])],
      t3: [...(primary?.t3 || [0, 0, 0])],
    };
    ["t1", "t2", "t3"].forEach((key) => {
      for (let i = 0; i < 3; i += 1) {
        if (!(out[key][i] > 0) && fallback?.[key]?.[i] > 0) out[key][i] = fallback[key][i];
      }
    });
    return out;
  }

  function tBlocksNeedEnrichment(blocks) {
    return ["t1", "t2", "t3"].some((key) => !(blocks?.[key]?.[0] > 0) || !(blocks?.[key]?.[1] > 0));
  }

  function refsFromSummary(summary) {
    const refs = [0.0, 0.0, 0.0];
    if (!summary || typeof summary !== "object") return refs;
    [1, 2, 3].forEach((i) => {
      const v = _positiveFloat(
        summary[`ref${i}`] ??
          summary[`ref_${i}`] ??
          summary[`reference${i}`] ??
          summary[`reference_${i}`] ??
          summary[`temp${i}`] ??
          summary[`ref_temp${i}`]
      );
      if (v != null) refs[i - 1] = v;
    });
    return refs;
  }

  function refsFromRawReadings(readings) {
    const refs = [0.0, 0.0, 0.0];
    (readings || []).forEach((item) => {
      const sensor = String(item.sensor_type || item.type || item.sensor || "").trim().toLowerCase();
      if (!["reference_thermometer", "reference"].includes(sensor) && !sensor.includes("reference")) return;
      const readingNo = Number(item.reading_number || 0);
      if (![1, 2, 3].includes(readingNo)) return;
      const v = _positiveFloat(item.temperature_value ?? item.temp ?? item.value);
      if (v != null) refs[readingNo - 1] = v;
    });
    return refs;
  }

  function mergeRefs(primary, fallback) {
    return [0, 1, 2].map((i) => (primary[i] > 0 ? primary[i] : fallback[i] > 0 ? fallback[i] : 0));
  }

  function _finiteNums(values) {
    return values.map((v) => Number(v)).filter((n) => Number.isFinite(n));
  }

  function _mean(values) {
    const nums = _finiteNums(values);
    if (!nums.length) return 0;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  function _max(values) {
    const nums = _finiteNums(values);
    return nums.length ? Math.max(...nums) : 0;
  }

  function _min(values) {
    const nums = _finiteNums(values);
    return nums.length ? Math.min(...nums) : 0;
  }

  /** Sample standard deviation (Excel STDEV.S) */
  function _stdevS(values) {
    const nums = _finiteNums(values);
    if (nums.length < 2) return 0;
    const avg = _mean(nums);
    const variance = nums.reduce((s, v) => s + (v - avg) ** 2, 0) / (nums.length - 1);
    return Math.sqrt(variance);
  }

  function _setFormulaCell(ws, rowIdx, col, formula, result) {
    const cell = ws.getCell(rowIdx, col);
    cell.value = {
      formula: String(formula).replace(/^=/, ""),
      result: Number.isFinite(result) ? result : 0,
    };
    cell.numFmt = "0.00";
  }

  function parseApiTimestamp(raw) {
    const text = String(raw || "").trim();
    if (!text) return null;
    const normalized = text.replace("Z", "+00:00");
    if (/[+-]\d{2}:\d{2}$/.test(normalized)) {
      const d = new Date(normalized);
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(`${normalized}+05:30`);
    return isNaN(d.getTime()) ? null : d;
  }

  function coerceToIstNaiveForSort(parsedDate) {
    const utcMs = parsedDate.getTime() + parsedDate.getTimezoneOffset() * 60000;
    return new Date(utcMs + _IST_OFFSET_MINUTES * 60000);
  }

  function rowDatetimeForSort(row) {
    const keyText = String(row.s3_key || "");
    const fnameMatch = keyText.match(/temperature_tmp_reading\d+[_-](20\d{2})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})(?:\.[a-z]{3,5})?/i);
    if (fnameMatch) {
      const [, y, mo, d, hh, mm, ss] = fnameMatch;
      return new Date(parseInt(y), parseInt(mo) - 1, parseInt(d), parseInt(hh), parseInt(mm), parseInt(ss));
    }

    const keyMatch = keyText.match(/(20\d{2})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/);
    if (keyMatch) {
      const [, y, mo, d, hh, mm, ss] = keyMatch;
      return new Date(parseInt(y), parseInt(mo) - 1, parseInt(d), parseInt(hh), parseInt(mm), parseInt(ss));
    }

    const rawValue = String(row.recorded_at || row.created_at || row.timestamp || "").trim();
    if (rawValue) {
      const parsed = parseApiTimestamp(rawValue);
      if (parsed) {
        return coerceToIstNaiveForSort(parsed);
      }
      if (/^\d{5,6}$/.test(rawValue)) {
        const hhmmss = rawValue.padStart(6, "0");
        const hh = parseInt(hhmmss.slice(0, 2));
        const mm = parseInt(hhmmss.slice(2, 4));
        const ss = parseInt(hhmmss.slice(4, 6));
        if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59 && ss >= 0 && ss <= 59) {
          return new Date(1970, 0, 1, hh, mm, ss);
        }
      }
    }
    return new Date(0); // Minimum date
  }

  function sessionDatetimeForSort(session) {
    const rawValue = String(session.started_at || session.created_at || session.activated_at || "").trim();
    if (rawValue) {
      const parsed = parseApiTimestamp(rawValue);
      if (parsed) {
        return coerceToIstNaiveForSort(parsed);
      }
    }
    return new Date(0);
  }

  function formatDateIso(d) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${mo}-${day}`;
  }

  function formatTimeIso(d) {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  function parseKeyDatetimeIst(y, mo, d, hh, mm, ss) {
    try {
      const naive = new Date(parseInt(y), parseInt(mo) - 1, parseInt(d), parseInt(hh), parseInt(mm), parseInt(ss));
      return [formatDateIso(naive), formatTimeIso(naive)];
    } catch (e) {
      return null;
    }
  }

  function extractDatetimeParts(row) {
    const rawValue = String(row.recorded_at || row.created_at || row.timestamp || "").trim();
    if (rawValue) {
      const parsed = parseApiTimestamp(rawValue);
      if (parsed) {
        const ist = coerceToIstNaiveForSort(parsed);
        return [formatDateIso(ist), formatTimeIso(ist)];
      }

      const dateMatch = rawValue.match(/(20\d{2})(\d{2})(\d{2})/);
      const timeMatch = rawValue.match(/(?<!\d)(\d{2})(\d{2})(\d{2})(?!\d)/);
      if (dateMatch) {
        const datePart = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
        let timePart = "00:00:00";
        if (timeMatch) {
          timePart = `${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3]}`;
        }
        try {
          const asUtc = new Date(`${datePart}T${timePart}Z`);
          const ist = coerceToIstNaiveForSort(asUtc);
          return [formatDateIso(ist), formatTimeIso(ist)];
        } catch (e) {}
      }
    }

    const keyText = String(row.s3_key || "");
    const fnameMatch = keyText.match(/temperature_tmp_reading\d+[_-](20\d{2})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/i);
    if (fnameMatch) {
      const parts = parseKeyDatetimeIst(fnameMatch[1], fnameMatch[2], fnameMatch[3], fnameMatch[4], fnameMatch[5], fnameMatch[6]);
      if (parts) return parts;
    }

    const keyMatch = keyText.match(/(20\d{2})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/);
    if (keyMatch) {
      const parts = parseKeyDatetimeIst(keyMatch[1], keyMatch[2], keyMatch[3], keyMatch[4], keyMatch[5], keyMatch[6]);
      if (parts) return parts;
    }

    return ["unknown", "unknown"];
  }

  function examSessionStartedDateIst(session) {
    const raw = String(session.started_at || session.created_at || "").trim();
    if (!raw) return null;
    const parsed = parseApiTimestamp(raw);
    if (!parsed) return null;
    const ist = coerceToIstNaiveForSort(parsed);
    return formatDateIso(ist);
  }

  function bestExamSessionIdForRow(row, sessions) {
    if (!sessions || sessions.length === 0) return "";
    const rowDt = rowDatetimeForSort(row);
    if (rowDt.getTime() === 0) {
      const first = sessions[0];
      return String(first.id || first.exam_session_id || "").trim();
    }

    const rowDateStr = formatDateIso(rowDt);
    const gracePeriodMs = 10 * 60 * 1000;

    let bestBefore = null;
    for (const s of sessions) {
      const sDt = sessionDatetimeForSort(s);
      if (sDt.getTime() !== 0 && sDt <= rowDt) {
        if (!bestBefore || sDt > sessionDatetimeForSort(bestBefore)) {
          bestBefore = s;
        }
      }
    }

    let bestAfterSameDay = null;
    for (const s of sessions) {
      if (examSessionStartedDateIst(s) === rowDateStr) {
        const sDt = sessionDatetimeForSort(s);
        if (sDt.getTime() !== 0 && sDt > rowDt) {
          if ((sDt - rowDt) <= gracePeriodMs) {
            if (!bestAfterSameDay || sDt < sessionDatetimeForSort(bestAfterSameDay)) {
              bestAfterSameDay = s;
            }
          }
        }
      }
    }

    let chosen = bestBefore;
    if (bestAfterSameDay) {
      if (!bestBefore) {
        chosen = bestAfterSameDay;
      } else {
        const isActive = String(bestBefore.status || "").trim().toLowerCase() === "active";
        const beforeDate = examSessionStartedDateIst(bestBefore);
        if (isActive && beforeDate === rowDateStr) {
          chosen = bestBefore;
        } else if (beforeDate !== rowDateStr) {
          chosen = bestAfterSameDay || bestBefore;
        } else {
          chosen = bestBefore;
        }
      }
    }

    if (chosen) {
      return String(chosen.id || chosen.exam_session_id || "").trim();
    }

    let bestSessionId = "";
    let bestDelta = null;
    for (const s of sessions) {
      const sid = String(s.id || s.exam_session_id || "").trim();
      if (!sid) continue;
      const sDt = sessionDatetimeForSort(s);
      if (sDt.getTime() === 0) continue;
      const delta = Math.abs(rowDt.getTime() - sDt.getTime());
      if (bestDelta === null || delta < bestDelta) {
        bestDelta = delta;
        bestSessionId = sid;
      }
    }

    return bestSessionId || String(sessions[0].id || "").trim();
  }

  function bestIrRowForSession(session, irRows, nextSessionDt = new Date(8640000000000000)) {
    if (!irRows || irRows.length === 0) return {};
    const sid = String(session.id || session.exam_session_id || "").trim();
    const sDt = sessionDatetimeForSort(session);

    for (const r of irRows) {
      if (sid && String(r.s3_key || "").includes(sid)) {
        return r;
      }
    }

    const graceMs = 10 * 60 * 1000;
    const candidatesInWindow = [];
    for (const r of irRows) {
      const rDt = rowDatetimeForSort(r);
      if ((sDt - graceMs) <= rDt && rDt < nextSessionDt) {
        candidatesInWindow.push({ rDt, r });
      }
    }

    if (candidatesInWindow.length > 0) {
      candidatesInWindow.sort((a, b) => b.rDt - a.rDt);
      return candidatesInWindow[0].r;
    }

    const candidatesAfter = [];
    for (const r of irRows) {
      const rDt = rowDatetimeForSort(r);
      if (rDt >= sDt) {
        candidatesAfter.push({ rDt, r });
      }
    }

    if (candidatesAfter.length > 0) {
      candidatesAfter.sort((a, b) => a.rDt - b.rDt);
      return candidatesAfter[0].r;
    }

    const candidatesAll = irRows.map(r => ({ rDt: rowDatetimeForSort(r), r }));
    candidatesAll.sort((a, b) => {
      const da = a.rDt.getTime() !== 0 ? Math.abs(a.rDt.getTime() - sDt.getTime()) : Infinity;
      const db = b.rDt.getTime() !== 0 ? Math.abs(b.rDt.getTime() - sDt.getTime()) : Infinity;
      return da - db;
    });

    return candidatesAll.length > 0 ? candidatesAll[0].r : {};
  }

  function collectSessionsForReportDate(examSessions, irRows, sessionToIrList, filterDate) {
    const byId = {};
    function add(session) {
      const sid = String(session.id || session.exam_session_id || "").trim();
      if (!sid) return;
      byId[sid] = session;
    }

    for (const session of examSessions) {
      if (examSessionStartedDateIst(session) === filterDate) {
        add(session);
      }
    }

    for (const row of irRows) {
      if (extractDatetimeParts(row)[0] !== filterDate) continue;
      const sid = bestExamSessionIdForRow(row, examSessions);
      if (!sid) continue;
      for (const session of examSessions) {
        if (String(session.id || session.exam_session_id || "").trim() === sid) {
          add(session);
          break;
        }
      }
    }

    for (const [sid, irList] of Object.entries(sessionToIrList)) {
      if (!sid || byId[sid]) continue;
      for (const row of irList) {
        if (extractDatetimeParts(row)[0] === filterDate) {
          for (const session of examSessions) {
            if (String(session.id || session.exam_session_id || "").trim() === sid) {
              add(session);
              break;
            }
          }
          break;
        }
      }
    }

    return examSessions.filter(s => {
      const sid = String(s.id || s.exam_session_id || "").trim();
      return !!byId[sid];
    });
  }

  function examSessionNumbersForWebTabs(examSessions) {
    const byId = {};
    examSessions.forEach((session, idx) => {
      const sid = String(session.id || session.exam_session_id || "").trim();
      if (sid) {
        const keys = ["session_index", "session_number", "session_no", "number", "sequence"];
        let found = false;
        for (const k of keys) {
          const raw = session[k];
          if (raw !== undefined && raw !== null) {
            const n = parseInt(raw);
            if (n >= 1) {
              byId[sid] = n;
              found = true;
              break;
            }
          }
        }
        if (!found) {
          byId[sid] = idx + 1;
        }
      }
    });
    return byId;
  }

  function getRawValue(cell) {
    if (!cell) return null;
    const val = cell.value;
    if (val && typeof val === 'object') {
      if (val.result !== undefined) return val.result;
      if (val.text !== undefined) return val.text;
    }
    return val;
  }

  async function _extract_t_blocks_from_excel(arrayBuffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer);
    const ws = workbook.worksheets[0] || workbook.getWorksheet(1);
    if (!ws) {
      return {
        t1: [null, null, null],
        t2: [null, null, null],
        t3: [null, null, null],
      };
    }

    let headerRow = null;
    let ambientCol = null;
    let foreheadCol = null;
    let bodyCol = null;

    const maxRow = Math.min(ws.rowCount, 40);
    for (let rowIdx = 1; rowIdx <= maxRow; rowIdx++) {
      const row = ws.getRow(rowIdx);
      const rowValues = [];
      const maxCol = row.cellCount;
      for (let c = 1; c <= maxCol; c++) {
        rowValues.push(String(row.getCell(c).value || "").trim().toLowerCase());
      }
      const hasAmbient = rowValues.some(val => val.includes("ambient"));
      const hasForehead = rowValues.some(val => val.includes("forehead"));
      const hasBody = rowValues.some(val => val.includes("body"));
      if (hasAmbient && hasForehead && hasBody) {
        headerRow = rowIdx;
        break;
      }
    }

    if (headerRow === null) {
      return {
        t1: [getRawValue(ws.getCell(5, 2)), getRawValue(ws.getCell(5, 3)), getRawValue(ws.getCell(5, 4))],
        t2: [getRawValue(ws.getCell(6, 2)), getRawValue(ws.getCell(6, 3)), getRawValue(ws.getCell(6, 4))],
        t3: [getRawValue(ws.getCell(7, 2)), getRawValue(ws.getCell(7, 3)), getRawValue(ws.getCell(7, 4))],
      };
    }

    const headerRowObj = ws.getRow(headerRow);
    const maxCol = headerRowObj.cellCount;
    for (let colIdx = 1; colIdx <= maxCol; colIdx++) {
      const headerValue = String(headerRowObj.getCell(colIdx).value || "").trim().toLowerCase();
      if (ambientCol === null && headerValue.includes("ambient")) {
        ambientCol = colIdx;
      } else if (foreheadCol === null && headerValue.includes("forehead")) {
        foreheadCol = colIdx;
      } else if (bodyCol === null && headerValue.includes("body")) {
        bodyCol = colIdx;
      }
    }

    if (ambientCol === null || foreheadCol === null || bodyCol === null) {
      return {
        t1: [getRawValue(ws.getCell(5, 2)), getRawValue(ws.getCell(5, 3)), getRawValue(ws.getCell(5, 4))],
        t2: [getRawValue(ws.getCell(6, 2)), getRawValue(ws.getCell(6, 3)), getRawValue(ws.getCell(6, 4))],
        t3: [getRawValue(ws.getCell(7, 2)), getRawValue(ws.getCell(7, 3)), getRawValue(ws.getCell(7, 4))],
      };
    }

    return {
      t1: [getRawValue(ws.getCell(headerRow + 1, ambientCol)), getRawValue(ws.getCell(headerRow + 1, foreheadCol)), getRawValue(ws.getCell(headerRow + 1, bodyCol))],
      t2: [getRawValue(ws.getCell(headerRow + 2, ambientCol)), getRawValue(ws.getCell(headerRow + 2, foreheadCol)), getRawValue(ws.getCell(headerRow + 2, bodyCol))],
      t3: [getRawValue(ws.getCell(headerRow + 3, ambientCol)), getRawValue(ws.getCell(headerRow + 3, foreheadCol)), getRawValue(ws.getCell(headerRow + 3, bodyCol))],
    };
  }

  function _temperature_ir_rows(fileRows) {
    const out = [];
    for (const row of fileRows) {
      const key = String(row.s3_key || "").toUpperCase();
      if (key.includes("IR") || key.includes("MLX") || key.includes("90614") || key.includes("90632")) {
        out.push(row);
      }
    }
    return out;
  }

  function _normalize_note_text(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") {
      for (const key of ["notes", "note", "value", "text", "message"]) {
        const nested = value[key];
        if (nested !== undefined && nested !== null) {
          return String(nested).trim();
        }
      }
      return "";
    }
    return String(value).trim();
  }

  function _extract_note_fields(payload) {
    const extracted = { ir_ear: "", rectal_sensor: "", reference_thermometer: "" };
    if (!payload) return extracted;

    if (Array.isArray(payload)) {
      for (const item of payload) {
        if (!item || typeof item !== "object") continue;
        const sensor_type = String(item.sensor_type || item.type || "").trim().toLowerCase();
        const note_text = _normalize_note_text(item.notes || item.note || item.value || "");
        if (!note_text) continue;
        if (["ir_ear", "ir", "ir_thermometer"].includes(sensor_type)) {
          extracted.ir_ear = note_text;
        } else if (["rectal_sensor", "rectal"].includes(sensor_type)) {
          extracted.rectal_sensor = note_text;
        } else if (["reference_thermometer", "reference"].includes(sensor_type)) {
          extracted.reference_thermometer = note_text;
        }
      }
      return extracted;
    }

    if (typeof payload !== "object") return extracted;

    const notes_obj = payload.notes;
    if (notes_obj && typeof notes_obj === "object") {
      const nested = _extract_note_fields(notes_obj);
      for (const [key, value] of Object.entries(nested)) {
        if (value) extracted[key] = value;
      }
    }

    const key_aliases = {
      ir_ear: ["ir_ear", "ir", "ir_note", "ir_notes"],
      rectal_sensor: ["rectal_sensor", "rectal", "rectal_note", "rectal_notes"],
      reference_thermometer: ["reference_thermometer", "reference", "reference_note", "reference_notes"],
    };

    for (const [canonical_key, aliases] of Object.entries(key_aliases)) {
      for (const alias of aliases) {
        if (alias in payload) {
          const text = _normalize_note_text(payload[alias]);
          if (text) {
            extracted[canonical_key] = text;
            break;
          }
        }
      }
    }
    return extracted;
  }

  function _resolve_pet_metadata(petId, petRow, client, baseUrl, deviceId, cache) {
    if (cache[petId]) return cache[petId];

    let species = petRow.species || petRow.pet_species || "";
    let breed = petRow.breed || petRow.pet_breed || "";
    let weight = "";
    const weightKeys = ["weight", "pet_weight", "weight_kg"];
    for (const k of weightKeys) {
      if (petRow[k] !== undefined && petRow[k] !== null && typeof petRow[k] !== "boolean") {
        weight = String(petRow[k]).trim();
        break;
      }
    }

    // Detail fetch is done asynchronously in the main loop if missing.
    return [species, breed, weight];
  }

  function _safe_float(value) {
    if (value === null || value === undefined) return null;
    const cleaned = String(value).trim().toLowerCase().replace("f", "");
    if (!cleaned) return null;
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
  }

  function slugify(val) {
    return String(val || "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
  }

  function canonicalSpecies(raw) {
    return global.VetDashboardFilters?.canonicalizeSpecies?.(raw) || String(raw || "").trim();
  }

  function matchesAnimalFilter(pet, animalType) {
    if (!animalType || animalType === "all") return true;
    const species = canonicalSpecies(
      pet?.species || pet?.pet_species || pet?.animal_type || pet?.animal_category || ""
    );
    return species.toLowerCase() === canonicalSpecies(animalType).toLowerCase();
  }

  function dateInRange(isoDate, from, to) {
    return Boolean(isoDate && from && to && isoDate >= from && isoDate <= to);
  }

  function enumerateDays(from, to) {
    const days = [];
    let cursor = from;
    while (cursor && to && cursor <= to) {
      days.push(cursor);
      if (cursor === to) break;
      const d = new Date(`${cursor}T12:00:00`);
      d.setDate(d.getDate() + 1);
      cursor = formatDateIso(d);
    }
    return days;
  }

  function normalizeSummaries(payload) {
    if (Array.isArray(payload)) return payload.filter((x) => x && typeof x === "object");
    if (payload && typeof payload === "object") {
      for (const key of ["summaries", "temperature_summaries", "data", "results"]) {
        const blob = payload[key];
        if (Array.isArray(blob)) return blob.filter((x) => x && typeof x === "object");
      }
    }
    return [];
  }

  function normalizeRecordings(data) {
    if (Array.isArray(data)) return data.filter((x) => x && typeof x === "object");
    if (data && typeof data === "object") {
      if (data.heart || data.lung) {
        const out = [];
        ["heart", "lung"].forEach((kind) => {
          (data[kind] || []).forEach((r) => {
            if (r && typeof r === "object") out.push({ ...r, _audio_container: kind });
          });
        });
        return out;
      }
      for (const key of ["recordings", "items", "data"]) {
        if (Array.isArray(data[key])) return data[key].filter((x) => x && typeof x === "object");
      }
    }
    return [];
  }

  function isIrSummaryRow(row) {
    const s = String(row?.sensor_type || row?.type || row?.sensor || "").trim().toLowerCase();
    return /mlx|90614|90632|ir|ir_ear/.test(s);
  }

  function dedupeSessions(sessions) {
    const seenSessionIds = new Set();
    const uniqueSessions = [];
    (sessions || []).forEach((s) => {
      if (!s || typeof s !== "object") return;
      const sid = String(s.id || s.exam_session_id || "").trim();
      if (sid) {
        if (!seenSessionIds.has(sid)) {
          seenSessionIds.add(sid);
          uniqueSessions.push(s);
        }
      } else {
        uniqueSessions.push(s);
      }
    });
    return uniqueSessions;
  }

  function countTemperatureRowsForDay(uniqueSessions, summaryRows, day) {
    const summariesToday = summaryRows.filter((r) => extractDatetimeParts(r)[0] === day);
    const summarySessionIds = new Set(
      summariesToday.map((r) => String(r.exam_session_id || r.examSessionId || "").trim()).filter(Boolean)
    );
    const sessionsToProcess = uniqueSessions.filter((s) => {
      const sid = String(s.id || s.exam_session_id || "").trim();
      return examSessionStartedDateIst(s) === day || (sid && summarySessionIds.has(sid));
    });
    const processed = new Set(
      sessionsToProcess.map((s) => String(s.id || s.exam_session_id || "").trim()).filter(Boolean)
    );
    let orphanIr = 0;
    summariesToday.forEach((r) => {
      const sid = String(r.exam_session_id || r.examSessionId || "").trim();
      if (sid && processed.has(sid)) return;
      if (!isIrSummaryRow(r)) return;
      orphanIr += 1;
    });
    return sessionsToProcess.length + orphanIr;
  }

  async function mapPool(items, limit, worker) {
    if (!items.length) return [];
    const results = new Array(items.length);
    let next = 0;
    async function run() {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i], i);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
    return results;
  }

  async function createReportClient(deviceId, options = {}) {
    const session = global.VetAuth?.getSession?.() || {};
    const resolvedDeviceId = String(
      deviceId || session.deviceId || global.VetAuth?.getDeviceId?.() || global.API_CONFIG?.deviceId || "ARMY"
    )
      .trim()
      .toUpperCase();
    const cfg = {
      baseUrl: global.API_CONFIG.baseUrl,
      deviceId: resolvedDeviceId,
      timeoutMs: Number(options.timeoutMs) || 25000,
    };
    const client = new global.VetApiClient(cfg);
    if (resolvedDeviceId && session.password) {
      await client.login(resolvedDeviceId, session.password);
    }
    return { client, cfg };
  }

  async function fetchWithRetry(fn, retries = 3, delayMs = 900) {
    let lastErr;
    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (attempt < retries - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
        }
      }
    }
    throw lastErr;
  }

  function recordingContainerKind(rec) {
    for (const key of ["_audio_container", "organ", "recording_organ", "body_system", "category", "recording_type", "type"]) {
      const text = String(rec[key] || "").trim().toLowerCase();
      if (!text) continue;
      if (text.includes("heart") || text.includes("lung")) return text;
      if (text === "heart" || text === "lung") return text;
    }
    return "";
  }

  function recordingIsHeart(rec) {
    return recordingContainerKind(rec).includes("heart");
  }

  function recordingIsLung(rec) {
    return recordingContainerKind(rec).includes("lung");
  }

  /** Scan every exam session (Python download-all); filter each clip by recording or session date. */
  function resolveSessionsForAudioScan(uniqueSessions, from, to) {
    return { sessions: uniqueSessions, filterRecordings: Boolean(from && to) };
  }

  function recordingInReportRange(rec, session, from, to) {
    if (!from || !to) return true;
    const row = {
      recorded_at: rec.completed_at || rec.recorded_at || rec.created_at,
      created_at: rec.completed_at || rec.recorded_at || rec.created_at,
      timestamp: rec.timestamp,
      s3_key: rec.s3_key || "",
    };
    const recDay = extractDatetimeParts(row)[0];
    if (recDay && recDay !== "unknown") return dateInRange(recDay, from, to);
    const sessionDay = examSessionStartedDateIst(session);
    if (sessionDay) return dateInRange(sessionDay, from, to);
    return true;
  }

  async function countAudioRecordingsInSessions(
    client,
    cfg,
    petId,
    sessions,
    filterRecordings,
    from,
    to,
    needHeart,
    needLung
  ) {
    let heart = 0;
    let lung = 0;
    for (const s of sessions) {
      const sid = String(s.id || s.exam_session_id || "").trim();
      if (!sid) continue;
      try {
        const rec = await client.recordingsWithContext(petId, sid, cfg);
        normalizeRecordings(rec).forEach((r) => {
          if (filterRecordings && !recordingInReportRange(r, s, from, to)) return;
          if (needHeart && recordingIsHeart(r)) heart += 1;
          if (needLung && recordingIsLung(r)) lung += 1;
        });
      } catch {
        /* ignore per-session failures */
      }
    }
    return { heart, lung };
  }

  async function discoverSavedDataRange(client, cfg, allPets, animalType, onProgress = null) {
    const today = global.VetLiveApi?.todayIsoIst?.() || formatDateIso(new Date());
    const pets = (allPets || []).filter((p) => matchesAnimalFilter(p, animalType));
    let minDate = null;
    let maxDate = null;
    let done = 0;
    const total = Math.max(pets.length, 1);

    await mapPool(pets, 8, async (pet) => {
      const petId = String(pet.pet_id || pet.id || "").trim();
      if (!petId) {
        done += 1;
        return;
      }
      try {
        const sessionsResponse = await client.examSessionsWithContext(petId, cfg);
        const sessions = Array.isArray(sessionsResponse)
          ? sessionsResponse
          : sessionsResponse?.exam_sessions || [];
        dedupeSessions(sessions).forEach((s) => {
          const d = examSessionStartedDateIst(s);
          if (!d) return;
          if (!minDate || d < minDate) minDate = d;
          if (!maxDate || d > maxDate) maxDate = d;
        });
      } catch {
        /* ignore per-pet failures */
      }
      done += 1;
      onProgress?.(
        Math.round((done / total) * 100),
        `Finding saved dates ${done}/${total}`
      );
    });

    if (!minDate || !maxDate) {
      const fallbackFrom = (() => {
        const d = new Date(`${today}T12:00:00`);
        d.setDate(d.getDate() - 29);
        return formatDateIso(d);
      })();
      return { from: fallbackFrom, to: today, days: 30, source: "fallback" };
    }

    if (maxDate > today) maxDate = today;
    const capFrom = (() => {
      const d = new Date(`${today}T12:00:00`);
      d.setDate(d.getDate() - 364);
      return formatDateIso(d);
    })();
    if (minDate < capFrom) minDate = capFrom;

    const days = enumerateDays(minDate, maxDate).length;
    return { from: minDate, to: maxDate, days, source: "sessions" };
  }

  async function resolvePetsForDateRange(client, from, to, allPets, animalType, onProgress = null) {
    const days = enumerateDays(from, to);
    const petMap = new Map();
    let doneDays = 0;
    await mapPool(days, 8, async (day) => {
      let list = [];
      if (global.VetLiveApi?.resolvePetsForDate) {
        const resolved = await global.VetLiveApi.resolvePetsForDate(client, day, allPets);
        list = resolved.list || [];
      } else {
        const daily = await client.dailyPets(day).catch(() => null);
        list = daily?.pets || [];
      }
      list.forEach((p) => {
        if (!matchesAnimalFilter(p, animalType)) return;
        const id = String(p.pet_id || p.id || "").trim();
        if (id) petMap.set(id, p);
      });
      doneDays += 1;
      onProgress?.(
        18 + Math.round((doneDays / Math.max(days.length, 1)) * 12),
        `Loading daily lists ${doneDays}/${days.length}`
      );
    });
    return [...petMap.values()];
  }

  async function countReportInventory(filters, logger = { log() {} }, onProgress = null) {
    const from = filters.from;
    const to = filters.to;
    const animalType = filters.animalType || "all";
    const testType = filters.testType || "all";
    const needTemp = testType === "all" || testType === "temperature";
    const needHeart = testType === "all" || testType === "heart";
    const needLung = testType === "all" || testType === "lung";

    if (!from || !to || from > to) {
      return { temperature: 0, heart: 0, lung: 0, pets: 0 };
    }

    logger.log(`Counting report inventory ${from} → ${to} (animal=${animalType}, test=${testType})`);
    onProgress?.(5, "Connecting to device…");
    const { client, cfg } = await createReportClient(filters.deviceId);
    onProgress?.(12, "Loading animal list…");
    const allPets = global.VetApiNormalize.normalizePets(await client.listPets());
    onProgress?.(18, "Resolving animals in date range…");
    const pets = await resolvePetsForDateRange(client, from, to, allPets, animalType, onProgress);
    logger.log(`Scanning ${pets.length} animal(s)…`);
    onProgress?.(32, `Scanning ${pets.length} animal(s)…`);

    let temperature = 0;
    let heart = 0;
    let lung = 0;
    const tempDays = new Set();
    const days = enumerateDays(from, to);
    const total = Math.max(pets.length, 1);
    let done = 0;

    await mapPool(pets, 6, async (pet) => {
      const petId = String(pet.pet_id || pet.id || "").trim();
      if (!petId) return;

      let uniqueSessions = [];
      try {
        const sessionsResponse = await client.examSessionsWithContext(petId, cfg);
        const sessions = Array.isArray(sessionsResponse)
          ? sessionsResponse
          : sessionsResponse?.exam_sessions || [];
        uniqueSessions = dedupeSessions(sessions);
      } catch {
        done += 1;
        onProgress?.(18 + Math.round((done / total) * 80), `Scanned ${done}/${total} animals`);
        return;
      }

      if (needTemp) {
        try {
          const summaryResp = await client.petTemperatureSummaryWithContext(petId, cfg);
          const summaryRows = normalizeSummaries(summaryResp);
          for (const day of days) {
            const dayRows = countTemperatureRowsForDay(uniqueSessions, summaryRows, day);
            temperature += dayRows;
            if (dayRows > 0) tempDays.add(day);
          }
        } catch (err) {
          logger.warn?.(`Temperature count failed for ${petId}: ${err.message || err}`);
        }
      }

      if (needHeart || needLung) {
        const { sessions: audioSessions, filterRecordings } = resolveSessionsForAudioScan(
          uniqueSessions,
          from,
          to
        );
        const audioCounts = await countAudioRecordingsInSessions(
          client,
          cfg,
          petId,
          audioSessions,
          filterRecordings,
          from,
          to,
          needHeart,
          needLung
        );
        heart += audioCounts.heart;
        lung += audioCounts.lung;
      }

      done += 1;
      const name = pet.pet_name || pet.name || petId;
      onProgress?.(
        32 + Math.round((done / total) * 66),
        `Scanned ${done}/${total} · ${name}`
      );
    });

    onProgress?.(100, "Scan complete");
    return {
      temperature,
      heart,
      lung,
      pets: pets.length,
      resolvedPets: pets,
      daysWithTemperature: [...tempDays].sort(),
    };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function slugifyName(value) {
    return String(value || "")
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "unknown";
  }

  function buildSessionNumberMap(examSessions) {
    const byId = {};
    (examSessions || []).forEach((session, idx) => {
      const sid = String(session.id || session.exam_session_id || "").trim();
      if (!sid) return;
      for (const key of ["session_index", "session_number", "session_no", "number", "sequence"]) {
        const raw = session[key];
        if (raw != null) {
          const n = Number(raw);
          if (Number.isFinite(n) && n >= 1) {
            byId[sid] = n;
            break;
          }
        }
      }
      if (!byId[sid]) byId[sid] = idx + 1;
    });
    return byId;
  }

  function sessionNoFromMap(byId, sessionId) {
    const uuid = String(sessionId || "").trim();
    if (!uuid || !byId) return 1;
    if (byId[uuid] != null) return byId[uuid];
    const lower = uuid.toLowerCase();
    for (const [sid, num] of Object.entries(byId)) {
      if (sid.toLowerCase() === lower) return num;
    }
    return 1;
  }

  function audioStreamTypesToTry(rec) {
    const c = String(rec._audio_container || "").toLowerCase();
    if (c === "heart") return ["session", "heart"];
    if (c === "lung") return ["session", "lung"];
    return ["session", "heart", "lung"];
  }

  function audioOrganSlug(rec) {
    for (const key of ["organ", "recording_organ", "body_system", "category", "recording_type"]) {
      const raw = rec[key];
      if (raw == null) continue;
      const text = String(raw).trim().toLowerCase();
      if (!text) continue;
      if (text === "heart" || text === "lung") return text;
      const slug = slugifyName(text).toLowerCase();
      if (slug) return slug;
    }
    const c = String(rec._audio_container || "").trim().toLowerCase();
    if (c === "heart" || c === "lung") return c;
    return "session";
  }

  function audioPointLetter(rec) {
    const raw = String(rec.point || rec.slot || rec.recording_point || "").trim().toLowerCase();
    if (["p", "a", "m", "t"].includes(raw)) return raw;
    if (raw.length === 1 && /[a-z]/i.test(raw)) return raw;
    const blob = `${raw} ${rec.title || ""} ${rec.name || ""} ${rec.location || ""}`.toLowerCase();
    for (const [word, ch] of [
      ["pulmonary", "p"],
      ["tricuspid", "t"],
      ["mitral", "m"],
      ["aortic", "a"],
    ]) {
      if (blob.includes(word)) return ch;
    }
    const slug = slugifyName(raw).toLowerCase();
    return slug ? slug.slice(0, 1) : "x";
  }

  function recordingDatetimeFilenameParts(rec) {
    const row = {
      recorded_at: rec.completed_at || rec.recorded_at || rec.created_at,
      created_at: rec.completed_at || rec.recorded_at || rec.created_at,
      timestamp: rec.timestamp,
      s3_key: rec.s3_key || "",
    };
    const parts = extractDatetimeParts(row);
    if (parts[0] !== "unknown") {
      return [parts[0], parts[1].replace(/:/g, "-")];
    }
    const now = coerceToIstNaiveForSort(new Date());
    return [formatDateIso(now), formatTimeIso(now).replace(/:/g, "-")];
  }

  async function downloadOneRecordingWav(client, cfg, petId, recordingId, rec) {
    for (const recType of audioStreamTypesToTry(rec)) {
      try {
        const meta = await client.recordingAudioMetadata(recordingId, petId, recType, cfg);
        if (!meta || typeof meta !== "object") continue;
        const href = String(meta.audio_url || meta.stream_url || meta.url || "").trim();
        if (!href) continue;
        const buf = await client.downloadBinaryByHref(href, cfg);
        if (buf && buf.byteLength > 0) return buf;
      } catch {
        /* try next stream type */
      }
    }
    return null;
  }

  function uniqueZipPath(folder, baseName, usedPaths) {
    let path = `${folder}/${baseName}.wav`;
    let n = 0;
    while (usedPaths.has(path)) {
      n += 1;
      path = `${folder}/${baseName}_${n}.wav`;
    }
    usedPaths.add(path);
    return path;
  }

  async function collectAudioRecordings(client, cfg, pets, from, to, kinds, logger, onProgress) {
    const wantHeart = kinds.includes("heart");
    const wantLung = kinds.includes("lung");
    const total = Math.max(pets.length, 1);
    let done = 0;

    const batches = await mapPool(pets, 4, async (pet) => {
      const petItems = [];
      const petId = String(pet.pet_id || pet.id || "").trim();
      const petSlug = slugifyName(pet.pet_name || pet.name || petId);
      if (!petId) {
        done += 1;
        onProgress?.(Math.round((done / total) * 100), `Listing audio ${done}/${total}`);
        return petItems;
      }

      let uniqueSessions = [];
      try {
        const sessionsResponse = await fetchWithRetry(
          () => client.examSessionsWithContext(petId, cfg),
          3,
          1000
        );
        const sessions = Array.isArray(sessionsResponse)
          ? sessionsResponse
          : sessionsResponse?.exam_sessions || [];
        uniqueSessions = dedupeSessions(sessions);
      } catch (err) {
        logger.warn?.(`Sessions unavailable for ${petSlug}: ${err.message || err}`);
        done += 1;
        onProgress?.(Math.round((done / total) * 100), `Listing audio ${done}/${total}`);
        return petItems;
      }

      const sessionNoMap = buildSessionNumberMap(uniqueSessions);
      const { sessions: audioSessions, filterRecordings } = resolveSessionsForAudioScan(
        uniqueSessions,
        from,
        to
      );

      for (const session of audioSessions) {
        const sid = String(session.id || session.exam_session_id || "").trim();
        if (!sid) continue;
        const sessionNo = sessionNoFromMap(sessionNoMap, sid);
        let recPayload;
        try {
          recPayload = await fetchWithRetry(
            () => client.recordingsWithContext(petId, sid, cfg),
            2,
            700
          );
        } catch {
          continue;
        }
        for (const rec of normalizeRecordings(recPayload)) {
          if (filterRecordings && !recordingInReportRange(rec, session, from, to)) continue;
          if (wantHeart && recordingIsHeart(rec)) {
            petItems.push({ petId, petSlug, rec, sessionNo, sid, kind: "heart" });
          } else if (wantLung && recordingIsLung(rec)) {
            petItems.push({ petId, petSlug, rec, sessionNo, sid, kind: "lung" });
          }
        }
      }

      done += 1;
      onProgress?.(Math.round((done / total) * 100), `Listing audio ${done}/${total} · ${petSlug}`);
      return petItems;
    });

    return batches.flat();
  }

  async function resolveExportPets(client, cfg, filters, onProgress) {
    if (Array.isArray(filters.cachedPets) && filters.cachedPets.length) {
      onProgress?.(8, `Using ${filters.cachedPets.length} animal(s) from last scan`);
      return filters.cachedPets;
    }
    const allPets = global.VetApiNormalize.normalizePets(await client.listPets());
    return resolvePetsForDateRange(client, filters.from, filters.to, allPets, filters.animalType || "all", onProgress);
  }

  async function listAudioItemsForExport(client, cfg, filters, kinds, logger, onProgress) {
    const pets = await resolveExportPets(client, cfg, filters, (pct, label) => {
      onProgress?.(2 + Math.round(pct * 0.08), label || "Loading animals…");
    });

    logger.log(`Collecting ${kinds.join(" / ")} sound files…`);
    let items = await collectAudioRecordings(
      client,
      cfg,
      pets,
      filters.from,
      filters.to,
      kinds,
      logger,
      (pct, label) => onProgress?.(10 + Math.round(pct * 0.15), label || "Listing files…")
    );

    const expected = Number(filters.expectedCount) || 0;
    if (!items.length && expected > 0) {
      logger.warn?.("Retrying audio listing using full animal registry…");
      const allPets = global.VetApiNormalize.normalizePets(await client.listPets()).filter((p) =>
        matchesAnimalFilter(p, filters.animalType || "all")
      );
      items = await collectAudioRecordings(
        client,
        cfg,
        allPets,
        filters.from,
        filters.to,
        kinds,
        logger,
        (pct, label) => onProgress?.(10 + Math.round(pct * 0.15), label || "Retry listing…")
      );
    }

    return items;
  }

  async function addAudioFilesToZip(zip, client, cfg, items, logger, onProgress, progressBase = 0, progressSpan = 100) {
    const usedPaths = new Set();
    let saved = 0;
    let skipped = 0;
    const total = Math.max(items.length, 1);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const rid = String(item.rec.id || item.rec.recording_id || "").trim();
      if (!rid) {
        skipped += 1;
        continue;
      }
      const organ = audioOrganSlug(item.rec);
      const point = audioPointLetter(item.rec);
      const [datePart, timePart] = recordingDatetimeFilenameParts(item.rec);
      const baseName = `${item.petSlug}_${organ}_${point}_${item.sessionNo}_${datePart}_${timePart}`;
      const folder = item.kind === "lung" ? "lung" : "heart";
      const zipPath = uniqueZipPath(folder, baseName, usedPaths);

      onProgress?.(
        progressBase + Math.round(((i + 1) / total) * progressSpan),
        `Downloading ${folder} ${i + 1}/${items.length}`
      );
      logger.log?.(`Fetching ${zipPath}…`);

      const buf = await downloadOneRecordingWav(client, cfg, item.petId, rid, item.rec);
      if (buf) {
        zip.file(zipPath, buf);
        saved += 1;
        logger.log?.(`Added ${zipPath}`, "done");
      } else {
        skipped += 1;
        logger.warn?.(`Skipped ${zipPath} (no audio stream)`);
      }
    }

    return { saved, skipped };
  }

  function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function generateZipBlob(zip, onProgress) {
    return zip.generateAsync({ type: "blob", compression: "DEFLATE" }, (meta) => {
      onProgress?.(meta.percent, "Compressing ZIP…");
    });
  }

  async function exportAudioZip(filters, kind, logger = { log() {} }, onProgress = null) {
    if (!global.JSZip) throw new Error("ZIP library not loaded.");
    const from = filters.from;
    const to = filters.to;
    if (!from || !to || from > to) throw new Error("Invalid date range.");

    onProgress?.(2, "Connecting…");
    const { client, cfg } = await createReportClient(filters.deviceId, { timeoutMs: 90000 });

    const items = await listAudioItemsForExport(client, cfg, filters, [kind], logger, onProgress);

    if (!items.length) {
      const expected = Number(filters.expectedCount) || 0;
      const hint = expected > 0
        ? `Scan found ${expected} file(s) but the API failed while listing them. Wait 30 seconds and try again, or pick a shorter date range.`
        : `No ${kind} sound files found in the selected range.`;
      throw new Error(hint);
    }

    const zip = new global.JSZip();
    const { saved, skipped } = await addAudioFilesToZip(
      zip,
      client,
      cfg,
      items,
      logger,
      (pct, label) => onProgress?.(25 + Math.round(pct * 0.65), label || "Downloading audio…"),
      25,
      65
    );

    if (!saved) throw new Error(`Could not download any ${kind} sound files (${skipped} skipped).`);

    onProgress?.(92, "Building ZIP…");
    const blob = await generateZipBlob(zip, (pct) => onProgress?.(92 + Math.round(pct * 0.08), "Compressing ZIP…"));
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const filename = `${kind}_sound_${from}_${to}_${stamp}.zip`;
    triggerBlobDownload(blob, filename);
    onProgress?.(100, "Download started");
    return { saved, skipped, filename, kind };
  }

  async function exportCompleteZip(filters, logger = { log() {} }, onProgress = null) {
    if (!global.JSZip) throw new Error("ZIP library not loaded.");
    const from = filters.from;
    const to = filters.to;
    const animalType = filters.animalType || "all";
    const deviceId = filters.deviceId;
    if (!from || !to || from > to) throw new Error("Invalid date range.");

    const allDays = enumerateDays(from, to);
    const tempDays = Array.isArray(filters.daysWithTemperature) && filters.daysWithTemperature.length
      ? filters.daysWithTemperature
      : allDays;
    const zip = new global.JSZip();
    let tempFiles = 0;
    let tempRows = 0;
    let tempErrors = 0;

    onProgress?.(2, "Preparing complete export…");
    logger.log(`Export range: ${from} → ${to} (${allDays.length} day(s) total)`);
    logger.log(`Building temperature Excel for ${tempDays.length} day(s) with data…`);

    for (let i = 0; i < tempDays.length; i++) {
      const day = tempDays[i];
      const pct = 2 + Math.round((i / Math.max(tempDays.length, 1)) * 38);
      onProgress?.(pct, `Temperature Excel ${i + 1}/${tempDays.length} · ${day}`);
      logger.log(`Building Excel for ${day}…`);
      try {
        const result = await fetchWithRetry(
          () => compileDailySummary(day, deviceId, logger, { animalType, download: false }),
          2,
          1500
        );
        const rows = Number(result?.rows_written) || 0;
        if (rows > 0 && result.buffer) {
          zip.file(`temperature/${result.filename}`, result.buffer);
          tempFiles += 1;
          tempRows += rows;
          logger.log(`${day}: ${rows} row(s) added to ZIP`, "done");
        } else {
          logger.log(`${day}: no rows — skipped`);
        }
      } catch (err) {
        tempErrors += 1;
        logger.warn?.(`${day}: ${err.message || err}`);
      }
      if (i < tempDays.length - 1) await sleep(250);
    }

    onProgress?.(42, "Collecting audio files…");
    let audioSaved = 0;
    let audioSkipped = 0;
    let audioError = null;
    try {
      const { client, cfg } = await createReportClient(deviceId, { timeoutMs: 90000 });
      const audioItems = await listAudioItemsForExport(
        client,
        cfg,
        filters,
        ["heart", "lung"],
        logger,
        (pct, label) => onProgress?.(42 + Math.round(pct * 0.18), label || "Collecting audio…")
      );

      if (audioItems.length) {
        const audioResult = await addAudioFilesToZip(
          zip,
          client,
          cfg,
          audioItems,
          logger,
          (pct, label) => onProgress?.(60 + Math.round(pct * 0.3), label || "Downloading audio…"),
          60,
          30
        );
        audioSaved = audioResult.saved;
        audioSkipped = audioResult.skipped;
      } else {
        logger.log("No heart/lung recordings in range.");
      }
    } catch (err) {
      audioError = err.message || String(err);
      logger.warn?.(`Audio export skipped: ${audioError}`);
    }

    if (!tempFiles && !audioSaved) {
      throw new Error(
        tempErrors || audioError
          ? `Export failed — API errors while fetching data. Wait 30 seconds and try again, or use a shorter date range.`
          : "Nothing to export — no temperature rows or audio files in the selected range."
      );
    }

    zip.file(
      "export_manifest.txt",
      [
        `Device: ${deviceId}`,
        `Range: ${from} → ${to}`,
        `Temperature files: ${tempFiles} (${tempRows} rows, ${tempErrors} day(s) failed)`,
        `Audio files: ${audioSaved} (${audioSkipped} skipped)`,
        audioError ? `Audio note: ${audioError}` : "",
        `Generated: ${new Date().toISOString()}`,
      ].filter(Boolean).join("\n")
    );

    onProgress?.(92, "Compressing complete ZIP…");
    const blob = await generateZipBlob(zip, (pct) => onProgress?.(92 + Math.round(pct * 0.08), "Compressing ZIP…"));
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const filename = `complete_export_${from}_${to}_${stamp}.zip`;
    triggerBlobDownload(blob, filename);
    onProgress?.(100, "Download started");
    return { tempFiles, tempRows, audioSaved, audioSkipped, tempErrors, audioError, filename };
  }

  /**
   * Main Browser Export trigger
   */
  async function compileDailySummary(selectedDate, deviceId, logger, options = {}) {
    logger.log(`Starting report compilation for date: ${selectedDate}, device: ${deviceId}`);

    const { client, cfg } = await createReportClient(deviceId);
    const animalType = options.animalType || "all";

    logger.log("Fetching daily pets registry list...");
    let pets = [];
    const dailyResponse = await client.dailyPetsWithContext(selectedDate, {
      baseUrl: cfg.baseUrl,
      deviceId: cfg.deviceId,
    }).catch(() => null);
    pets = (dailyResponse?.pets || []).filter((p) => matchesAnimalFilter(p, animalType));

    if (!pets.length) {
      const allPets = global.VetApiNormalize.normalizePets(await client.listPets());
      if (global.VetLiveApi?.resolvePetsForDate) {
        const resolved = await global.VetLiveApi.resolvePetsForDate(client, selectedDate, allPets);
        pets = (resolved.list || []).filter((p) => matchesAnimalFilter(p, animalType));
      }
    }

    if (!pets || pets.length === 0) {
      logger.log(`No pets found for date: ${selectedDate} with the selected filters — skipping day.`);
      return {
        rows_written: 0,
        skipped: 0,
        notes: 0,
        pet_count: 0,
        buffer: null,
        filename: null,
        skipped_empty: true,
      };
    }

    logger.log(`Found ${pets.length} pet(s) registered on this day. Fetching template 'oneday_summary.xlsx'...`);
    const templateRes = await fetch("oneday_summary.xlsx");
    if (!templateRes.ok) {
      throw new Error("Failed to load oneday_summary.xlsx workbook template from server.");
    }
    const templateBuffer = await templateRes.arrayBuffer();

    const petMetaCache = {};
    const diagnosticsBuffer = [];
    const petSkipReasons = [];
    const globalReportData = [];
    let skippedCount = 0;
    let notesCount = 0;
    const excludedPets = [];

    for (const pet of pets) {
      const petId = String(pet.pet_id || pet.id || "").trim();
      const petName = String(pet.pet_name || pet.name || "Unknown").trim();
      if (!petId) {
        petSkipReasons.push({
          pet_name: petName,
          pet_id: "",
          reason: "missing pet_id in daily-pets response",
        });
        skippedCount++;
        continue;
      }

      logger.log(`Processing pet [${petName}]...`);

      // Resolve metadata
      let [species, breed, weight] = _resolve_pet_metadata(petId, pet, client, cfg.baseUrl, cfg.deviceId, petMetaCache);
      if (!species || !breed || !weight) {
        try {
          const detail = await client.petDetailWithContext(petId, {
            baseUrl: cfg.baseUrl,
            deviceId: cfg.deviceId,
          });
          if (detail) {
            species = species || detail.species || detail.pet_species || "NA";
            breed = breed || detail.breed || detail.pet_breed || "NA";
            weight = weight || String(detail.weight || detail.pet_weight || detail.weight_kg || "NA");
          }
        } catch (err) {
          logger.warn(`Could not fetch details for pet ${petName}: ${err.message}`);
        }
      }
      species = String(species || "NA").trim() || "NA";
      breed = String(breed || "NA").trim() || "NA";
      weight = String(weight || "NA").trim() || "NA";
      petMetaCache[petId] = [species, breed, weight];

      if (petName && !REF_TEMPS_F[petName.toUpperCase()]) {
        excludedPets.push(petName);
      }

      try {
        // Fetch DynamoDB summaries (JSON)
        logger.log(`  Retrieving temperature summaries...`);
        const summariesResponse = await client.petTemperatureSummaryWithContext(petId, {
          baseUrl: cfg.baseUrl,
          deviceId: cfg.deviceId,
        });
        const summaryRowsRaw = Array.isArray(summariesResponse)
          ? summariesResponse
          : (summariesResponse?.summaries || summariesResponse?.temperature_summaries || summariesResponse?.data || summariesResponse?.results || []);
        const summaryRows = (Array.isArray(summaryRowsRaw) ? summaryRowsRaw : []).filter((r) => r && typeof r === "object");

        if (summaryRows.length === 0) {
          petSkipReasons.push({
            pet_name: petName,
            pet_id: petId,
            reason: "no temperature summaries returned from API",
          });
          skippedCount++;
          continue;
        }

        // Fetch sessions
        logger.log(`  Retrieving exam sessions...`);
        const sessionsResponse = await client.examSessionsWithContext(petId, {
          baseUrl: cfg.baseUrl,
          deviceId: cfg.deviceId,
        });
        const sessions = Array.isArray(sessionsResponse) ? sessionsResponse : (sessionsResponse?.exam_sessions || []);
        
        // Deduplicate
        const seenSessionIds = new Set();
        const uniqueSessions = [];
        sessions.forEach(s => {
          if (s && typeof s === "object") {
            const sid = String(s.id || s.exam_session_id || "").trim();
            if (sid) {
              if (!seenSessionIds.has(sid)) {
                seenSessionIds.add(sid);
                uniqueSessions.push(s);
              }
            } else {
              uniqueSessions.push(s);
            }
          }
        });

        uniqueSessions.sort((a, b) => sessionDatetimeForSort(a) - sessionDatetimeForSort(b));
        summaryRows.sort((a, b) => rowDatetimeForSort(a) - rowDatetimeForSort(b));

        function isIrSummary(row) {
          const s = String(row?.sensor_type || row?.type || row?.sensor || "").trim().toLowerCase();
          return /mlx|90614|90632|ir|ir_ear/.test(s);
        }

        function isRectalSummary(row) {
          const s = String(row?.sensor_type || row?.type || row?.sensor || "").trim().toLowerCase();
          return s === "tmp" || /rectal/.test(s);
        }

        function pickLatestSummary(examSessionId, predicate) {
          const sid = String(examSessionId || "").trim();
          if (!sid) return null;
          const matches = summaryRows.filter((r) => String(r.exam_session_id || r.examSessionId || "").trim() === sid && predicate(r));
          if (!matches.length) return null;
          matches.sort((a, b) => rowDatetimeForSort(b) - rowDatetimeForSort(a));
          return matches[0] || null;
        }

        const summariesToday = summaryRows.filter((r) => extractDatetimeParts(r)[0] === selectedDate);
        const summarySessionIds = new Set(
          summariesToday
            .map((r) => String(r.exam_session_id || r.examSessionId || "").trim())
            .filter(Boolean)
        );

        const sessionsToProcess = uniqueSessions.filter((s) => {
          const sid = String(s.id || s.exam_session_id || "").trim();
          return examSessionStartedDateIst(s) === selectedDate || (sid && summarySessionIds.has(sid));
        });
        sessionsToProcess.sort((a, b) => sessionDatetimeForSort(a) - sessionDatetimeForSort(b));

        const rowsToEmit = [];
        sessionsToProcess.forEach((s) => rowsToEmit.push({ kind: "session", payload: s }));
        const processed = new Set(sessionsToProcess.map((s) => String(s.id || s.exam_session_id || "").trim()).filter(Boolean));
        summariesToday.forEach((r) => {
          const sid = String(r.exam_session_id || r.examSessionId || "").trim();
          if (sid && processed.has(sid)) return;
          if (!isIrSummary(r)) return;
          rowsToEmit.push({ kind: "ir", payload: r });
        });

        if (rowsToEmit.length === 0) {
          const startDates = uniqueSessions.map((s) => examSessionStartedDateIst(s) || "?");
          const uniqStartDates = [...new Set(startDates)].sort();
          petSkipReasons.push({
            pet_name: petName,
            pet_id: petId,
            reason: `no sessions or temperature summaries on ${selectedDate} (started IST dates: ${uniqStartDates.join(", ")})`,
          });
          skippedCount++;
          continue;
        }

        // Process emissions
        for (let pairIdx = 0; pairIdx < rowsToEmit.length; pairIdx++) {
          const { kind, payload } = rowsToEmit[pairIdx];
          const sessionCounter = pairIdx + 1;
          const sessionForPair = kind === "session" ? payload : null;
          const realExamSessionId =
            kind === "session"
              ? String(sessionForPair.id || sessionForPair.exam_session_id || "").trim()
              : String(payload.exam_session_id || payload.examSessionId || "").trim();

          const irSummary = kind === "ir" ? payload : pickLatestSummary(realExamSessionId, isIrSummary);
          const rectSummary = pickLatestSummary(realExamSessionId, isRectalSummary);

          const refsC = refsFromSummary(irSummary || rectSummary);
          const rectalC = [0.0, 0.0, 0.0];
          if (rectSummary) {
            [1, 2, 3].forEach((i) => {
              const v = _positiveFloat(rectSummary[`t${i}`]);
              if (v != null) rectalC[i - 1] = v;
            });
          }

          let chosenTBlocks = irSummary
            ? tBlocksFromSummary(irSummary)
            : { t1: [0.0, 0.0, 0.0], t2: [0.0, 0.0, 0.0], t3: [0.0, 0.0, 0.0] };

          let refsResolved = refsC;
          const needRawEnrichment =
            realExamSessionId &&
            (tBlocksNeedEnrichment(chosenTBlocks) || !refsResolved.some((v) => v > 0));

          if (needRawEnrichment) {
            try {
              const rawPayload = await client.petTemperatureBySessionWithContext(
                petId,
                realExamSessionId,
                cfg
              );
              const rawRows = normalizeTemperatureReadings(rawPayload);
              if (rawRows.length) {
                chosenTBlocks = mergeTBlocks(chosenTBlocks, tBlocksFromRawReadings(rawRows));
                refsResolved = mergeRefs(refsResolved, refsFromRawReadings(rawRows));
              }
            } catch (e) {
              logger.warn?.(
                `  Raw temperature enrich failed for session ${realExamSessionId}: ${e.message || e}`
              );
            }
          }

          const refsF = refsResolved.map((c) => (c > 0 ? parseFloat(((c * 9) / 5 + 32).toFixed(2)) : 0));

          let sortDt = new Date(0);
          if (irSummary) sortDt = rowDatetimeForSort(irSummary);
          else if (rectSummary) sortDt = rowDatetimeForSort(rectSummary);
          else if (sessionForPair) sortDt = sessionDatetimeForSort(sessionForPair);

          const fallbackTs = sessionForPair ? String(sessionForPair.started_at || sessionForPair.created_at || "") : "";
          const fallbackCreated = { recorded_at: fallbackTs };
          const [createdDate, createdTime] = extractDatetimeParts(irSummary || rectSummary || fallbackCreated);

          // Fetch notes
          let noteFields = { ir_ear: "", rectal_sensor: "", reference_thermometer: "" };
          if (realExamSessionId) {
            try {
              const notesPayload = await client.temperatureNotesWithContext(petId, realExamSessionId, {
                baseUrl: cfg.baseUrl,
                deviceId: cfg.deviceId,
              });
              noteFields = _extract_note_fields(notesPayload);
            } catch (e) {
              logger.warn(`  Failed to fetch clinical notes for session: ${realExamSessionId}`);
            }
          }

          const hasAnyNote = Object.values(noteFields).some(val => String(val).trim());
          if (hasAnyNote) notesCount++;

          // Validity filter
          const hasIrData = Object.values(chosenTBlocks).some(block => block.some(val => val > 0));
          const hasRectalData = rectalC.some(val => val > 0);
          const hasRefData = refsResolved.some(val => val > 0);

          if (!hasIrData && !hasRectalData && !hasRefData && !hasAnyNote) {
            logger.log(`  Skipping blank session row [${sessionCounter}] (no vitals or clinical notes).`);
            continue;
          }

          globalReportData.push({
            sortDt,
            pet_name: petName,
            pet_id: petId,
            meta_species: species,
            meta_breed: breed,
            meta_weight: weight,
            session_counter: sessionCounter,
            real_session_id: realExamSessionId,
            artifact_key: String((irSummary || rectSummary)?.session_id || realExamSessionId || `session_${sessionCounter}`),
            created_date: createdDate,
            created_time: createdTime,
            chosen_t_blocks: chosenTBlocks,
            refs_c: refsResolved,
            rectal_c: rectalC,
            refs_f: refsF,
            note_fields: noteFields,
          });

          diagnosticsBuffer.push({
            pet_name: petName,
            pet_id: petId,
            species,
            breed,
            weight,
            session_no: sessionCounter,
            t1_a: chosenTBlocks.t1[0],
            t1_f: chosenTBlocks.t1[1],
            t1_b: chosenTBlocks.t1[2],
            t2_a: chosenTBlocks.t2[0],
            t2_f: chosenTBlocks.t2[1],
            t2_b: chosenTBlocks.t2[2],
            t3_a: chosenTBlocks.t3[0],
            t3_f: chosenTBlocks.t3[1],
            t3_b: chosenTBlocks.t3[2],
          });
        }
      } catch (exc) {
        logger.error(`Error processing pet ${petName}: ${exc.message}`);
        petSkipReasons.push({
          pet_name: petName,
          pet_id: petId,
          reason: `unhandled error: ${exc.message}`,
        });
        skippedCount++;
      }
    }

    // Sort chronologically
    globalReportData.sort((a, b) => {
      if (a.sortDt.getTime() === 0) return 1;
      if (b.sortDt.getTime() === 0) return -1;
      return a.sortDt - b.sortDt;
    });

    // Populate sheet
    logger.log("Building workbook structure and compiling formulas...");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = wb.worksheets[0];

    const summaryBandEnd = _daily_summary_col(47);

    // Unmerge overlaps (ExcelJS uses unMergeCells, not unmergeCells)
    if (ws._merges) {
      Object.keys(ws._merges).forEach((key) => {
        const range = ws._merges[key];
        const model = range?.model || range;
        const top = model.top ?? range.top;
        const bottom = model.bottom ?? range.bottom;
        const left = model.left ?? range.left;
        const right = model.right ?? range.right;
        const overlapsHeader = !(bottom < 1 || top > 2);
        const overlapsCols = !(right < 3 || left > summaryBandEnd);
        if (overlapsHeader && overlapsCols) {
          try {
            const ref = range.tl && range.br ? `${range.tl}:${range.br}` : key;
            ws.unMergeCells(ref);
          } catch (e) {
            logger.warn(`Could not unmerge ${key}: ${e.message}`);
          }
        }
      });
    }

    // Rewrite headers
    const leftBlock = [
      [3, "Species"],
      [4, "Breed"],
      [5, "Weight"],
      [6, "Name"]
    ];
    leftBlock.forEach(([col, label]) => {
      ws.getCell(1, col).value = label;
      ws.mergeCells(1, col, 2, col);
    });

    ws.getCell(1, 7).value = "t1";
    ws.getCell(2, 7).value = "Ambient(T ambient)";
    ws.getCell(2, 8).value = "Forehead(Tf)";
    ws.getCell(2, 9).value = "Body(Tbody)";
    ws.mergeCells(1, 7, 1, 9);

    ws.getCell(1, 10).value = "t2";
    ws.getCell(2, 10).value = "Ambient";
    ws.getCell(2, 11).value = "Forehead";
    ws.getCell(2, 12).value = "Body(Tbody)";
    ws.mergeCells(1, 10, 1, 12);

    ws.getCell(1, 13).value = "t3";
    ws.getCell(2, 13).value = "Ambient";
    ws.getCell(2, 14).value = "Forehead";
    ws.getCell(2, 15).value = "Body(Tbody)";
    ws.mergeCells(1, 13, 1, 15);

    ws.getCell(1, _daily_summary_col(13)).value = "Rectal";
    ws.getCell(2, _daily_summary_col(13)).value = "t1";
    ws.getCell(2, _daily_summary_col(14)).value = "t2";
    ws.getCell(2, _daily_summary_col(15)).value = "t3";
    ws.mergeCells(1, _daily_summary_col(13), 1, _daily_summary_col(15));

    ws.getCell(1, _daily_summary_col(16)).value = "max ref temp";
    ws.getCell(2, _daily_summary_col(16)).value = "";
    ws.getCell(1, _daily_summary_col(17)).value = "Ref Temp c";
    ws.getCell(2, _daily_summary_col(17)).value = "temp1";
    ws.getCell(2, _daily_summary_col(18)).value = "temp2";
    ws.getCell(2, _daily_summary_col(19)).value = "temp3";
    ws.mergeCells(1, _daily_summary_col(17), 1, _daily_summary_col(19));

    ws.getCell(1, _daily_summary_col(20)).value = "Ref Temp f";
    ws.getCell(2, _daily_summary_col(20)).value = "temp1";
    ws.getCell(2, _daily_summary_col(21)).value = "temp2";
    ws.getCell(2, _daily_summary_col(22)).value = "temp3";
    ws.mergeCells(1, _daily_summary_col(20), 1, _daily_summary_col(22));

    ws.getCell(1, _daily_summary_col(23)).value = "IR";
    const irTitles = ["T1", "T2", "T3", "Ref(max)", "Mean", "Max", "SD", "Range", "Err_Mean", "Err_Max"];
    irTitles.forEach((t, i) => {
      ws.getCell(2, _daily_summary_col(23) + i).value = t;
    });
    ws.mergeCells(1, _daily_summary_col(23), 1, _daily_summary_col(32));

    ws.getCell(1, _daily_summary_col(33)).value = "Rectal";
    const rectalTitles = ["T1", "T2", "T3", "Ref(max)", "Mean", "Max", "SD", "Range", "Err_Mean", "Err_Max"];
    rectalTitles.forEach((t, i) => {
      ws.getCell(2, _daily_summary_col(33) + i).value = t;
    });
    ws.mergeCells(1, _daily_summary_col(33), 1, _daily_summary_col(42));

    ws.getCell(1, _daily_summary_col(43)).value = "Notes";
    ws.getCell(2, _daily_summary_col(43)).value = "IR Note";
    ws.getCell(2, _daily_summary_col(44)).value = "Rectal Note";
    ws.getCell(2, _daily_summary_col(45)).value = "Reference Note";
    ws.mergeCells(1, _daily_summary_col(43), 1, _daily_summary_col(45));

    ws.getCell(1, _daily_summary_col(46)).value = "Session Date (IST)";
    ws.getCell(1, _daily_summary_col(47)).value = "Session Time (IST)";

    const c_max_ref = _daily_summary_col(16);
    const c_ir_triple = [_daily_summary_col(23), _daily_summary_col(24), _daily_summary_col(25)];
    const c_ir_refslot = _daily_summary_col(26);
    const c_ir_mean = _daily_summary_col(27);
    const c_ir_max = _daily_summary_col(28);
    const c_ir_sd = _daily_summary_col(29);
    const c_ir_range = _daily_summary_col(30);
    const c_ir_err_mean = _daily_summary_col(31);
    const c_ir_err_max = _daily_summary_col(32);
    const c_rect_triple = [_daily_summary_col(33), _daily_summary_col(34), _daily_summary_col(35)];
    const c_rect_refslot = _daily_summary_col(36);
    const c_rect_mean = _daily_summary_col(37);
    const c_rect_max = _daily_summary_col(38);
    const c_rect_sd = _daily_summary_col(39);
    const c_rect_range = _daily_summary_col(40);
    const c_rect_err_mean = _daily_summary_col(41);
    const c_rect_err_max = _daily_summary_col(42);

    const L_MAX_REF = getColumnLetter(c_max_ref);
    const L_IR1 = getColumnLetter(c_ir_triple[0]);
    const L_IR2 = getColumnLetter(c_ir_triple[1]);
    const L_IR3 = getColumnLetter(c_ir_triple[2]);
    const L_IR_REF = getColumnLetter(c_ir_refslot);
    const L_IR_MEAN = getColumnLetter(c_ir_mean);
    const L_IR_MAX = getColumnLetter(c_ir_max);
    const L_R1 = getColumnLetter(c_rect_triple[0]);
    const L_R2 = getColumnLetter(c_rect_triple[1]);
    const L_R3 = getColumnLetter(c_rect_triple[2]);
    const L_RREF = getColumnLetter(c_rect_refslot);
    const L_RMEAN = getColumnLetter(c_rect_mean);
    const L_RMAX = getColumnLetter(c_rect_max);

    // Clear grid data rows 3..400
    for (let rIdx = 3; rIdx <= 400; rIdx++) {
      const row = ws.getRow(rIdx);
      row.values = [];
    }

    // Write Compiled Rows
    let writtenRows = 0;
    globalReportData.forEach((rowVal, idx) => {
      const rowIdx = 3 + idx;
      ws.getCell(rowIdx, 1).value = idx + 1;
      ws.getCell(rowIdx, 2).value = rowVal.session_counter;
      ws.getCell(rowIdx, 3).value = rowVal.meta_species;
      ws.getCell(rowIdx, 4).value = rowVal.meta_breed;
      ws.getCell(rowIdx, 5).value = rowVal.meta_weight;
      ws.getCell(rowIdx, 6).value = rowVal.pet_name;

      const blocks = rowVal.chosen_t_blocks;
      // Write ambient / forehead / body with full API precision (template often forces 0.00).
      const irGridCols = [
        [7, blocks.t1[0]],
        [8, blocks.t1[1]],
        [9, blocks.t1[2]],
        [10, blocks.t2[0]],
        [11, blocks.t2[1]],
        [12, blocks.t2[2]],
        [13, blocks.t3[0]],
        [14, blocks.t3[1]],
        [15, blocks.t3[2]],
      ];
      irGridCols.forEach(([col, value]) => {
        const cell = ws.getCell(rowIdx, col);
        cell.value = Number(value) || 0;
        cell.numFmt = "0.0000000";
      });

      const refsC = rowVal.refs_c;
      const rectalC = rowVal.rectal_c;
      const refsF = rowVal.refs_f;
      const hasRef = refsC.some(ref => ref > 0);

      ws.getCell(rowIdx, _daily_summary_col(13)).value = rectalC[0] > 0 ? rectalC[0] : 0.0;
      ws.getCell(rowIdx, _daily_summary_col(14)).value = rectalC[1] > 0 ? rectalC[1] : 0.0;
      ws.getCell(rowIdx, _daily_summary_col(15)).value = rectalC[2] > 0 ? rectalC[2] : 0.0;
      ws.getCell(rowIdx, _daily_summary_col(13)).numFmt = "0.00";
      ws.getCell(rowIdx, _daily_summary_col(14)).numFmt = "0.00";
      ws.getCell(rowIdx, _daily_summary_col(15)).numFmt = "0.00";

      ws.getCell(rowIdx, _daily_summary_col(16)).value = hasRef ? Math.max(...refsC) : 0;
      ws.getCell(rowIdx, _daily_summary_col(17)).value = hasRef ? refsC[0] : 0;
      ws.getCell(rowIdx, _daily_summary_col(18)).value = hasRef ? refsC[1] : 0;
      ws.getCell(rowIdx, _daily_summary_col(19)).value = hasRef ? refsC[2] : 0;
      ws.getCell(rowIdx, _daily_summary_col(20)).value = hasRef ? refsF[0] : 0;
      ws.getCell(rowIdx, _daily_summary_col(21)).value = hasRef ? refsF[1] : 0;
      ws.getCell(rowIdx, _daily_summary_col(22)).value = hasRef ? refsF[2] : 0;

      ws.getCell(rowIdx, _daily_summary_col(23)).value = blocks.t1[2];
      ws.getCell(rowIdx, _daily_summary_col(24)).value = blocks.t2[2];
      ws.getCell(rowIdx, _daily_summary_col(25)).value = blocks.t3[2];
      [_daily_summary_col(23), _daily_summary_col(24), _daily_summary_col(25)].forEach((col) => {
        ws.getCell(rowIdx, col).numFmt = "0.0000000";
      });

      const irTriple = [Number(blocks.t1[2]) || 0, Number(blocks.t2[2]) || 0, Number(blocks.t3[2]) || 0];
      const hasIr = irTriple.some((v) => v > 0);
      const maxRef = hasRef ? Math.max(...refsC) : 0;
      const irMean = _mean(irTriple);
      const irMax = _max(irTriple);
      const irSd = _stdevS(irTriple);
      const irRange = irMax - _min(irTriple);

      if (hasIr) {
        if (hasRef) {
          _setFormulaCell(ws, rowIdx, c_ir_refslot, `${L_MAX_REF}${rowIdx}`, maxRef);
        } else {
          ws.getCell(rowIdx, c_ir_refslot).value = 0;
          ws.getCell(rowIdx, c_ir_refslot).numFmt = "0.00";
        }
        _setFormulaCell(ws, rowIdx, c_ir_mean, `AVERAGE(${L_IR1}${rowIdx}:${L_IR3}${rowIdx})`, irMean);
        _setFormulaCell(ws, rowIdx, c_ir_max, `MAX(${L_IR1}${rowIdx}:${L_IR3}${rowIdx})`, irMax);
        _setFormulaCell(ws, rowIdx, c_ir_sd, `_xlfn.STDEV.S(${L_IR1}${rowIdx}:${L_IR3}${rowIdx})`, irSd);
        _setFormulaCell(
          ws,
          rowIdx,
          c_ir_range,
          `MAX(${L_IR1}${rowIdx}:${L_IR3}${rowIdx})-MIN(${L_IR1}${rowIdx}:${L_IR3}${rowIdx})`,
          irRange
        );
        if (hasRef) {
          _setFormulaCell(
            ws,
            rowIdx,
            c_ir_err_mean,
            `ABS(${L_IR_MEAN}${rowIdx}-${L_IR_REF}${rowIdx})`,
            Math.abs(irMean - maxRef)
          );
          _setFormulaCell(
            ws,
            rowIdx,
            c_ir_err_max,
            `ABS(${L_IR_MAX}${rowIdx}-${L_IR_REF}${rowIdx})`,
            Math.abs(irMax - maxRef)
          );
        } else {
          ws.getCell(rowIdx, c_ir_err_mean).value = 0;
          ws.getCell(rowIdx, c_ir_err_max).value = 0;
          ws.getCell(rowIdx, c_ir_err_mean).numFmt = "0.00";
          ws.getCell(rowIdx, c_ir_err_max).numFmt = "0.00";
        }
      } else {
        [c_ir_refslot, c_ir_mean, c_ir_max, c_ir_sd, c_ir_range, c_ir_err_mean, c_ir_err_max].forEach((c) => {
          ws.getCell(rowIdx, c).value = 0;
          ws.getCell(rowIdx, c).numFmt = "0.00";
        });
      }

      ws.getCell(rowIdx, _daily_summary_col(33)).value = rectalC[0] > 0 ? rectalC[0] : 0;
      ws.getCell(rowIdx, _daily_summary_col(34)).value = rectalC[1] > 0 ? rectalC[1] : 0;
      ws.getCell(rowIdx, _daily_summary_col(35)).value = rectalC[2] > 0 ? rectalC[2] : 0;

      const hasRectal = rectalC.some((val) => val > 0);
      const rectalTriple = [
        rectalC[0] > 0 ? rectalC[0] : 0,
        rectalC[1] > 0 ? rectalC[1] : 0,
        rectalC[2] > 0 ? rectalC[2] : 0,
      ];
      const rectMean = _mean(rectalTriple);
      const rectMax = _max(rectalTriple);
      const rectSd = _stdevS(rectalTriple);
      const rectRange = rectMax - _min(rectalTriple);

      if (hasRef && hasRectal) {
        _setFormulaCell(ws, rowIdx, c_rect_refslot, `${L_MAX_REF}${rowIdx}`, maxRef);
        _setFormulaCell(ws, rowIdx, c_rect_mean, `AVERAGE(${L_R1}${rowIdx}:${L_R3}${rowIdx})`, rectMean);
        _setFormulaCell(ws, rowIdx, c_rect_max, `MAX(${L_R1}${rowIdx}:${L_R3}${rowIdx})`, rectMax);
        _setFormulaCell(ws, rowIdx, c_rect_sd, `_xlfn.STDEV.S(${L_R1}${rowIdx}:${L_R3}${rowIdx})`, rectSd);
        _setFormulaCell(
          ws,
          rowIdx,
          c_rect_range,
          `MAX(${L_R1}${rowIdx}:${L_R3}${rowIdx})-MIN(${L_R1}${rowIdx}:${L_R3}${rowIdx})`,
          rectRange
        );
        _setFormulaCell(
          ws,
          rowIdx,
          c_rect_err_mean,
          `ABS(${L_RMEAN}${rowIdx}-${L_RREF}${rowIdx})`,
          Math.abs(rectMean - maxRef)
        );
        _setFormulaCell(
          ws,
          rowIdx,
          c_rect_err_max,
          `ABS(${L_RMAX}${rowIdx}-${L_RREF}${rowIdx})`,
          Math.abs(rectMax - maxRef)
        );
      } else {
        [c_rect_refslot, c_rect_mean, c_rect_max, c_rect_sd, c_rect_range, c_rect_err_mean, c_rect_err_max].forEach((c) => {
          ws.getCell(rowIdx, c).value = 0;
          ws.getCell(rowIdx, c).numFmt = "0.00";
        });
      }

      const noteFields = rowVal.note_fields;
      ws.getCell(rowIdx, _daily_summary_col(43)).value = noteFields.ir_ear;
      ws.getCell(rowIdx, _daily_summary_col(44)).value = noteFields.rectal_sensor;
      ws.getCell(rowIdx, _daily_summary_col(45)).value = noteFields.reference_thermometer;
      ws.getCell(rowIdx, _daily_summary_col(46)).value = rowVal.created_date;
      ws.getCell(rowIdx, _daily_summary_col(47)).value = rowVal.created_time;

      writtenRows++;
    });

    // Create FetchedPets worksheet
    logger.log("Building supplementary worksheet: FetchedPets...");
    const fSheet = wb.addWorksheet("FetchedPets");
    fSheet.getRow(1).values = ["pet_id", "pet_name", "species", "breed", "weight", "source_device", "source_base_url"];
    pets.forEach((pet, i) => {
      const pid = String(pet.pet_id || pet.id || "");
      const meta = petMetaCache[pid] || ["NA", "NA", "NA"];
      fSheet.getRow(2 + i).values = [pid, String(pet.pet_name || pet.name || ""), meta[0], meta[1], meta[2], cfg.deviceId, cfg.baseUrl];
    });

    // Create SkippedPets worksheet
    logger.log("Building supplementary worksheet: SkippedPets...");
    const sSheet = wb.addWorksheet("SkippedPets");
    sSheet.getRow(1).values = ["pet_name", "pet_id", "reason"];
    petSkipReasons.forEach((rec, i) => {
      sSheet.getRow(2 + i).values = [rec.pet_name, rec.pet_id, rec.reason];
    });

    // Create SessionDiagnostics worksheet
    logger.log("Building supplementary worksheet: SessionDiagnostics...");
    const dSheet = wb.addWorksheet("SessionDiagnostics");
    dSheet.getRow(1).values = [
      "pet_name", "pet_id", "species", "breed", "weight", "session_no",
      "t1_ambient", "t1_forehead", "t1_body",
      "t2_ambient", "t2_forehead", "t2_body",
      "t3_ambient", "t3_forehead", "t3_body"
    ];
    diagnosticsBuffer.forEach((rec, i) => {
      dSheet.getRow(2 + i).values = [
        rec.pet_name, rec.pet_id, rec.species, rec.breed, rec.weight, rec.session_no,
        rec.t1_a, rec.t1_f, rec.t1_b,
        rec.t2_a, rec.t2_f, rec.t2_b,
        rec.t3_a, rec.t3_f, rec.t3_b
      ];
    });

    logger.log("Generating report binary stream...");
    const outputBuffer = await wb.xlsx.writeBuffer();
    const fileDate = selectedDate.replace(/-/g, "");
    const runStamp = new Date().toTimeString().slice(0, 8).replace(/:/g, "-");
    const filename = `oneday_summary_${fileDate}_${runStamp}.xlsx`;

    if (!writtenRows) {
      logger.log(`No data rows for ${selectedDate} — skipping empty Excel file.`);
      return {
        rows_written: 0,
        skipped: skippedCount,
        notes: notesCount,
        pet_count: pets.length,
        buffer: null,
        filename: null,
        skipped_empty: true,
      };
    }

    logger.log(`Compilation successful! Triggering client download for '${filename}'...`);

    if (options.download !== false) {
      const outputBlob = new Blob([outputBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(outputBlob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    logger.success(`Report compiled successfully: ${writtenRows} row(s), skipped: ${skippedCount}, notes: ${notesCount}.`);
    return {
      rows_written: writtenRows,
      skipped: skippedCount,
      notes: notesCount,
      pet_count: pets.length,
      buffer: outputBuffer,
      filename,
    };
  }

  // Bind to window context
  global.VetExcelGenerator = {
    compileDailySummary,
    countReportInventory,
    createReportClient,
    discoverSavedDataRange,
    enumerateDays,
    exportAudioZip,
    exportCompleteZip,
  };

  // Helper init inside document ready
  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("btn-generate-excel");
    const deviceInput = document.getElementById("excel-device-id");
    const resultBox = document.getElementById("report-result-box");
    const resultTitle = document.getElementById("report-result-title");
    const resultSubtext = document.getElementById("report-result-subtext");

    const getReportDate = () =>
      document.getElementById("app-report-date")?.value ||
      formatDateIso(new Date());

    const setReportResult = (state, title, subtext = "") => {
      if (resultTitle) resultTitle.textContent = title;
      if (resultSubtext) resultSubtext.textContent = subtext;
      if (resultBox) {
        resultBox.classList.remove("is-success", "is-error", "is-loading");
        if (state) resultBox.classList.add(state);
      }
    };

    const silentLogger = {
      log: (msg) => console.log(`[Excel Export] ${msg}`),
      warn: (msg) => console.warn(`[Excel Export] ${msg}`),
      error: (msg) => console.error(`[Excel Export] ${msg}`),
      success: (msg) => console.log(`[Excel Export] ${msg}`),
    };

    if (btn) {
      btn.addEventListener("click", async () => {
        const selectedDate = getReportDate();
        const deviceId = deviceInput?.value || global.VetAuth?.getDeviceId?.() || global.API_CONFIG?.deviceId || "ARMY";

        btn.disabled = true;
        setReportResult("is-loading", "Generating report…", "");

        try {
          const result = await compileDailySummary(selectedDate, deviceId, silentLogger);
          const count = result?.pet_count ?? 0;
          setReportResult(
            "is-success",
            `Found ${count} pets. Report generated!`,
            ""
          );
        } catch (err) {
          const message = String(err?.message || err || "").trim();
          const noPets = /no pets found/i.test(message);
          setReportResult(
            "is-error",
            noPets ? "No pet list found." : "Report generation failed.",
            noPets ? "" : (message || "Unknown error. Check the browser console for details.")
          );
          console.error("[Excel Export] Report generation failed:", err);
        } finally {
          btn.disabled = false;
        }
      });
    }
  });

})(window);
