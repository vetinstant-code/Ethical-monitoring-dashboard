/**
 * Reports page — filters, download cards, history UI.
 */
(function (global) {
  const HISTORY_KEY = "vet_reports_download_history";
  const MAX_CUSTOM_DAYS = 90;
  const CHIP_LABELS = {
    today: "Today",
    yesterday: "Yesterday",
    last7: "Last 7 Days",
    last30: "Last 30 Days",
    all: "All Data (365 days)",
    custom: "Custom date range",
  };

  const state = {
    quickRange: "today",
    from: null,
    to: null,
    animalType: "all",
    testType: "all",
  };

  const istFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  function currentDeviceId() {
    return global.VetAuth?.getDeviceId?.() || global.API_CONFIG?.deviceId || "ARMY";
  }

  function todayIso() {
    return global.VetLiveApi?.todayIsoIst?.() || new Date().toISOString().slice(0, 10);
  }

  function addDaysIso(iso, delta) {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + delta);
    return d.toISOString().slice(0, 10);
  }

  function formatDisplay(iso) {
    if (!iso) return "—";
    try {
      return istFmt.format(new Date(`${iso}T12:00:00`));
    } catch {
      return iso;
    }
  }

  function dayCount(from, to) {
    if (!from || !to || from > to) return 0;
    let count = 0;
    let cur = from;
    while (cur <= to) {
      count += 1;
      if (cur === to) break;
      cur = addDaysIso(cur, 1);
    }
    return count;
  }

  function rangeLabel() {
    if (state.quickRange === "all") return "All Data (last 365 days)";
    if (!state.from || !state.to) return "—";
    if (state.from === state.to) return formatDisplay(state.from);
    return `${formatDisplay(state.from)} – ${formatDisplay(state.to)}`;
  }

  function applyQuickRange(key) {
    const today = todayIso();
    state.quickRange = key;
    if (key === "today") {
      state.from = today;
      state.to = today;
    } else if (key === "yesterday") {
      const y = addDaysIso(today, -1);
      state.from = y;
      state.to = y;
    } else if (key === "last7") {
      state.from = addDaysIso(today, -6);
      state.to = today;
    } else if (key === "last30") {
      state.from = addDaysIso(today, -29);
      state.to = today;
    } else if (key === "all") {
      state.from = addDaysIso(today, -364);
      state.to = today;
    }
    syncDateInputs();
    updateRangeLabels();
  }

  /** Single source of truth when Apply Filters / Download is clicked. */
  function readFiltersFromUi() {
    const activeChip = document.querySelector(".reports-chip.is-active");
    const animalEl = document.getElementById("reports-animal-type");
    const testEl = document.getElementById("reports-test-type");

    if (activeChip?.dataset?.range) {
      applyQuickRange(activeChip.dataset.range);
    } else {
      const fromEl = document.getElementById("reports-date-from");
      const toEl = document.getElementById("reports-date-to");
      state.from = fromEl?.value || state.from || todayIso();
      state.to = toEl?.value || state.to || todayIso();
      state.quickRange = "custom";
      syncDateInputs();
      updateRangeLabels();
    }

    state.animalType = animalEl?.value || "all";
    state.testType = testEl?.value || "all";
  }

  let _syncingDates = false;

  function syncDateInputs() {
    _syncingDates = true;
    const fromEl = document.getElementById("reports-date-from");
    const toEl = document.getElementById("reports-date-to");
    if (fromEl) fromEl.value = state.from || "";
    if (toEl) toEl.value = state.to || "";
    _syncingDates = false;
  }

  function updateFilterModeBanner() {
    const el = document.getElementById("reports-filter-mode");
    if (!el) return;
    const mode = CHIP_LABELS[state.quickRange] || CHIP_LABELS.custom;
    const days = dayCount(state.from, state.to);
    el.textContent = `Active filter: ${mode} · ${rangeLabel()} · ${days} day(s) — click Apply Filters to scan`;
  }

  function validateDateRange() {
    const from = state.from || todayIso();
    const to = state.to || todayIso();
    if (from > to) {
      return "Start date must be on or before end date.";
    }
    const days = dayCount(from, to);
    if (state.quickRange === "custom" && days > MAX_CUSTOM_DAYS) {
      return `Custom range is ${days} days (max ${MAX_CUSTOM_DAYS}). Use "Last 30 Days" or "All Data" instead.`;
    }
    return null;
  }

  function updateRangeLabels() {
    const label = rangeLabel();
    document.querySelectorAll("[data-card-range]").forEach((el) => {
      el.textContent = label;
    });
    updateFilterModeBanner();
  }

  function ensureProgressBlock() {
    let block = document.getElementById("reports-progress-block");
    if (block) return block;
    const anchor = document.querySelector(".reports-toolbar") || document.querySelector(".reports-page");
    if (!anchor) return null;
    block = document.createElement("div");
    block.className = "reports-progress-block";
    block.id = "reports-progress-block";
    block.innerHTML = `
      <div class="reports-progress-header">
        <span class="reports-progress-label" id="reports-progress-label">Working…</span>
        <span class="reports-progress-pct" id="reports-progress-pct">0%</span>
      </div>
      <div class="reports-progress-track">
        <div class="reports-progress-fill" id="reports-progress-fill" style="width:0%"></div>
      </div>
      <div class="reports-progress-log" id="reports-progress-log"></div>`;
    anchor.insertAdjacentElement("afterend", block);
    return block;
  }

  function setApplyButtonProgress(pct, label) {
    const btn = document.getElementById("reports-apply-filters");
    if (!btn) return;
    if (pct == null) {
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg><span>Apply Filters</span>`;
      return;
    }
    const span = btn.querySelector("span");
    if (span) span.textContent = `${Math.round(pct)}% · ${label || "Scanning"}`;
  }

  /* ---- progress bar helpers ---- */

  let _progressActive = false;

  function progressShow(label, pct) {
    const block = ensureProgressBlock();
    const labelEl = document.getElementById("reports-progress-label");
    const pctEl = document.getElementById("reports-progress-pct");
    const fill = document.getElementById("reports-progress-fill");
    const log = document.getElementById("reports-progress-log");
    if (!block) return;
    _progressActive = true;
    block.hidden = false;
    block.removeAttribute("hidden");
    block.classList.add("is-visible");
    block.scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (labelEl) labelEl.textContent = label || "Working…";
    const clamped = Math.max(0, Math.min(100, Math.round(pct || 0)));
    if (pctEl) pctEl.textContent = `${clamped}%`;
    if (fill) fill.style.width = `${clamped}%`;
    if (log && pct === 0) log.innerHTML = "";
    setApplyButtonProgress(clamped, label);
  }

  function progressUpdate(label, pct) {
    if (!_progressActive) progressShow(label, pct);
    const labelEl = document.getElementById("reports-progress-label");
    const pctEl = document.getElementById("reports-progress-pct");
    const fill = document.getElementById("reports-progress-fill");
    const block = document.getElementById("reports-progress-block");
    if (block) block.classList.add("is-visible");
    if (labelEl) labelEl.textContent = label || "Working…";
    const clamped = Math.max(0, Math.min(100, Math.round(pct || 0)));
    if (pctEl) pctEl.textContent = `${clamped}%`;
    if (fill) fill.style.width = `${clamped}%`;
    setApplyButtonProgress(clamped, label);
  }

  function progressLog(msg, kind) {
    const log = document.getElementById("reports-progress-log");
    if (!log) return;
    const line = document.createElement("div");
    line.className = "reports-progress-log-line" + (kind === "done" ? " is-done" : kind === "error" ? " is-error" : "");
    line.textContent = msg;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  function progressDone(msg, isError) {
    progressUpdate(msg || "Done", 100);
    if (isError) {
      const fill = document.getElementById("reports-progress-fill");
      if (fill) fill.style.background = "#dc2626";
    }
    _progressActive = false;
    setApplyButtonProgress(null);
  }

  function setStatus(msg, isError) {
    const el = document.getElementById("reports-status");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = msg;
    el.classList.toggle("is-error", !!isError);
  }

  function loadHistory() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function saveHistory(rows) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(rows.slice(0, 50)));
  }

  function renderHistory() {
    const body = document.getElementById("reports-history-body");
    if (!body) return;
    const rows = loadHistory();
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="7" class="empty-state">No downloads yet. Generated reports will appear here.</td></tr>`;
      return;
    }
    body.innerHTML = rows
      .map(
        (r) => `
      <tr>
        <td>${escapeHtml(r.when)}</td>
        <td>${escapeHtml(r.type)}</td>
        <td>${escapeHtml(r.range)}</td>
        <td>${escapeHtml(r.records)}</td>
        <td><span class="reports-hist-format">${escapeHtml(r.format)}</span></td>
        <td>${escapeHtml(r.size)}</td>
        <td>${r.actionHtml || "—"}</td>
      </tr>`
      )
      .join("");
  }

  function escapeHtml(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function pushHistory(entry) {
    const rows = loadHistory();
    rows.unshift(entry);
    saveHistory(rows);
    renderHistory();
  }

  function formatBytes(n) {
    if (!n || n < 1) return "—";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function ensureClient() {
    if (global.VetLiveApi?.ensureClient) return global.VetLiveApi.ensureClient();
    throw new Error("API client unavailable. Please sign in again.");
  }

  function getFilters() {
    return {
      quickRange: state.quickRange,
      from: state.from || todayIso(),
      to: state.to || todayIso(),
      animalType: state.animalType || "all",
      testType: state.testType || "all",
    };
  }

  function formatCountBadge(kind, count) {
    if (count == null) return kind === "temperature" ? "— Records" : "— Files";
    if (kind === "temperature") return `${count} Record${count === 1 ? "" : "s"}`;
    return `${count} File${count === 1 ? "" : "s"}`;
  }

  async function refreshCounts() {
    const tempBadge = document.getElementById("reports-temp-count");
    const heartBadge = document.getElementById("reports-heart-count");
    const lungBadge = document.getElementById("reports-lung-count");
    const from = state.from || todayIso();
    const to = state.to || todayIso();

    if (from > to) {
      if (tempBadge) tempBadge.textContent = "— Records";
      if (heartBadge) heartBadge.textContent = "— Files";
      if (lungBadge) lungBadge.textContent = "— Files";
      return;
    }

    if (tempBadge) tempBadge.textContent = "… Records";
    if (heartBadge) heartBadge.textContent = "… Files";
    if (lungBadge) lungBadge.textContent = "… Files";

    progressShow("Scanning data…", 0);
    progressLog(`Date range: ${formatDisplay(from)}${from !== to ? " – " + formatDisplay(to) : ""}`);

    try {
      if (!global.VetExcelGenerator?.countReportInventory) {
        throw new Error("Report counter unavailable.");
      }

      progressUpdate("Fetching animal list…", 10);
      progressLog("Loading animals for selected device…");

      const logger = {
        log: (msg) => progressLog(msg),
        warn: (msg) => progressLog(msg),
        error: () => {},
      };

      const counts = await global.VetExcelGenerator.countReportInventory({
        from,
        to,
        animalType: state.animalType,
        testType: state.testType,
        deviceId: currentDeviceId(),
      }, logger, (pct, label) => {
        progressUpdate(label || "Scanning…", 10 + Math.round(pct * 0.85));
      });

      progressUpdate("Done scanning", 100);

      const showTemp = state.testType === "all" || state.testType === "temperature";
      const showHeart = state.testType === "all" || state.testType === "heart";
      const showLung = state.testType === "all" || state.testType === "lung";

      if (tempBadge) tempBadge.textContent = showTemp ? formatCountBadge("temperature", counts.temperature) : "— Records";
      if (heartBadge) heartBadge.textContent = showHeart ? formatCountBadge("heart", counts.heart) : "— Files";
      if (lungBadge) lungBadge.textContent = showLung ? formatCountBadge("lung", counts.lung) : "— Files";

      progressLog(
        `Found: ${counts.temperature} temperature · ${counts.heart} heart · ${counts.lung} lung`,
        "done"
      );
      progressDone(`Scan complete · ${counts.pets} animal(s) in range`);
    } catch (err) {
      if (tempBadge) tempBadge.textContent = "— Records";
      if (heartBadge) heartBadge.textContent = "— Files";
      if (lungBadge) lungBadge.textContent = "— Files";
      progressLog(err.message || String(err), "error");
      progressDone("Scan failed", true);
    }
  }

  function syncReportDateHidden() {
    const el = document.getElementById("app-report-date");
    if (el) el.value = state.to || todayIso();
  }

  function applyFiltersToReports() {
    syncReportDateHidden();
  }

  async function populateAnimalTypes() {
    const select = document.getElementById("reports-animal-type");
    if (!select) return;
    try {
      const client = await ensureClient();
      const pets = global.VetLiveApi?.getPets?.() || global.VetApiNormalize.normalizePets(await client.listPets());
      const species = [...new Set(pets.map((p) => String(p.species || p.pet_species || "").trim()).filter(Boolean))].sort();
      const current = select.value || "all";
      select.innerHTML = `<option value="all">All Animals</option>` + species.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
      select.value = [...select.options].some((o) => o.value === current) ? current : "all";
    } catch {
      /* keep default */
    }
  }

  async function downloadTemperature() {
    readFiltersFromUi();
    const from = state.from || todayIso();
    const to = state.to || todayIso();
    if (from > to) throw new Error("Start date must be on or before end date.");

    if (!global.VetExcelGenerator?.compileDailySummary) {
      throw new Error("Excel report generator unavailable.");
    }

    const days =
      global.VetExcelGenerator.enumerateDays?.(from, to) ||
      (() => {
        const out = [];
        let cursor = from;
        while (cursor <= to) {
          out.push(cursor);
          if (cursor === to) break;
          cursor = addDaysIso(cursor, 1);
        }
        return out;
      })();

    progressShow(`Preparing Excel for ${days.length} day(s)…`, 0);
    progressLog(`Range: ${rangeLabel()} · ${days.length} day(s)`);

    let totalRows = 0;
    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      const pct = Math.round(((i) / days.length) * 90);
      progressUpdate(`Building Excel — ${formatDisplay(day)} (${i + 1}/${days.length})`, pct);
      progressLog(`Fetching data for ${formatDisplay(day)}…`);

      const logger = {
        log: (msg) => progressLog(msg),
        warn: (msg) => progressLog(msg),
        error: console.error,
        success: (msg) => progressLog(msg, "done"),
      };

      const result = await global.VetExcelGenerator.compileDailySummary(day, currentDeviceId(), logger, {
        animalType: state.animalType,
      });
      const rows = Number(result?.rows_written) || 0;
      totalRows += rows;
      progressLog(`${formatDisplay(day)}: ${rows} row(s) written`, "done");
    }

    progressUpdate("Saving Excel file…", 96);
    progressLog("Triggering file download…", "done");

    pushHistory({
      when: new Date().toLocaleString("en-IN", { hour12: true }),
      type: "Temperature Data",
      range: rangeLabel(),
      records: `${totalRows} row${totalRows === 1 ? "" : "s"}`,
      format: "Excel",
      size: "—",
      actionHtml: '<span class="reports-hist-done">Downloaded</span>',
    });
    progressDone(`Excel downloaded · ${totalRows} row(s) · ${rangeLabel()}`);
    setStatus(`Temperature Excel downloaded · ${totalRows} row${totalRows === 1 ? "" : "s"} · ${rangeLabel()}`);
  }

  async function downloadAudioKind(kind) {
    setStatus(`Preparing ${kind} sound ZIP download…`);
    pushHistory({
      when: new Date().toLocaleString("en-IN", { hour12: true }),
      type: kind === "heart" ? "Heart Sound Data" : "Lung Sound Data",
      range: rangeLabel(),
      records: "—",
      format: "ZIP",
      size: "—",
      actionHtml: '<span class="reports-hist-pending">Pending API</span>',
    });
    setStatus(
      `${kind === "heart" ? "Heart" : "Lung"} sound ZIP export will use the device audio batch API. UI is ready; wire-up next.`,
      true
    );
  }

  async function downloadComplete() {
    readFiltersFromUi();
    const from = state.from || todayIso();
    const to = state.to || todayIso();
    if (from > to) throw new Error("Start date must be on or before end date.");

    if (!global.VetExcelGenerator?.compileDailySummary) {
      throw new Error("Export generator unavailable.");
    }

    const days =
      global.VetExcelGenerator.enumerateDays?.(from, to) ||
      (() => {
        const out = [];
        let cursor = from;
        while (cursor <= to) {
          out.push(cursor);
          if (cursor === to) break;
          cursor = addDaysIso(cursor, 1);
        }
        return out;
      })();

    progressShow(`Complete export — ${days.length} day(s)…`, 0);
    progressLog(`Exporting all data for: ${rangeLabel()}`);
    progressLog("Step 1 of 2 — Temperature Excel");

    let totalRows = 0;
    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      const pct = Math.round((i / days.length) * 70);
      progressUpdate(`Temperature — ${formatDisplay(day)} (${i + 1}/${days.length})`, pct);
      progressLog(`Processing ${formatDisplay(day)}…`);
      const result = await global.VetExcelGenerator.compileDailySummary(day, currentDeviceId(), {
        log: (msg) => progressLog(msg),
        warn: (msg) => progressLog(msg),
        error: console.error,
        success: (msg) => progressLog(msg, "done"),
      }, { animalType: state.animalType });
      const rows = Number(result?.rows_written) || 0;
      totalRows += rows;
      progressLog(`${formatDisplay(day)}: ${rows} row(s)`, "done");
    }

    progressUpdate("Step 2 — Audio files (pending API)", 80);
    progressLog("Heart/lung sound ZIP requires device audio batch API — skipped for now.");

    pushHistory({
      when: new Date().toLocaleString("en-IN", { hour12: true }),
      type: "Complete Data Export",
      range: rangeLabel(),
      records: `${totalRows} temperature row${totalRows === 1 ? "" : "s"}`,
      format: "Excel",
      size: "—",
      actionHtml: '<span class="reports-hist-done">Downloaded</span>',
    });
    progressDone(`Export done · ${totalRows} temperature row(s) · audio ZIP pending`);
    setStatus(`Export complete · ${totalRows} temperature row(s). Audio ZIP requires device API.`);
  }

  function bindUi() {
    document.querySelectorAll(".reports-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".reports-chip").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        applyQuickRange(btn.dataset.range || "today");
        updateRangeLabels();
      });
    });

    document.getElementById("reports-date-from")?.addEventListener("change", (e) => {
      if (_syncingDates) return;
      state.from = e.target.value;
      state.quickRange = "custom";
      document.querySelectorAll(".reports-chip").forEach((b) => b.classList.remove("is-active"));
      updateRangeLabels();
    });
    document.getElementById("reports-date-to")?.addEventListener("change", (e) => {
      if (_syncingDates) return;
      state.to = e.target.value;
      state.quickRange = "custom";
      document.querySelectorAll(".reports-chip").forEach((b) => b.classList.remove("is-active"));
      updateRangeLabels();
    });

    document.getElementById("reports-animal-type")?.addEventListener("change", (e) => {
      state.animalType = e.target.value;
    });
    document.getElementById("reports-test-type")?.addEventListener("change", (e) => {
      state.testType = e.target.value;
    });

    document.getElementById("reports-apply-filters")?.addEventListener("click", async () => {
      readFiltersFromUi();
      const rangeError = validateDateRange();
      if (rangeError) {
        setStatus(rangeError, true);
        progressShow("Range too large", 0);
        progressLog(rangeError, "error");
        progressDone("Fix date range and try again", true);
        return;
      }
      applyFiltersToReports();
      const applyBtn = document.getElementById("reports-apply-filters");
      if (applyBtn) applyBtn.disabled = true;
      progressShow("Starting scan…", 1);
      try {
        await refreshCounts();
        setStatus(`Filters applied · ${rangeLabel()}`);
      } catch (err) {
        setStatus(err.message || String(err), true);
      } finally {
        if (applyBtn) applyBtn.disabled = false;
        setApplyButtonProgress(null);
      }
    });

    document.getElementById("reports-reset-filters")?.addEventListener("click", () => {
      document.querySelectorAll(".reports-chip").forEach((b) => b.classList.remove("is-active"));
      document.querySelector('.reports-chip[data-range="today"]')?.classList.add("is-active");
      const animal = document.getElementById("reports-animal-type");
      const test = document.getElementById("reports-test-type");
      if (animal) animal.value = "all";
      if (test) test.value = "all";
      state.animalType = "all";
      state.testType = "all";
      applyQuickRange("today");
      applyFiltersToReports();
      setStatus("Filters reset to Today. Click Apply Filters to scan.");
      const tempBadge = document.getElementById("reports-temp-count");
      const heartBadge = document.getElementById("reports-heart-count");
      const lungBadge = document.getElementById("reports-lung-count");
      if (tempBadge) tempBadge.textContent = "— Records";
      if (heartBadge) heartBadge.textContent = "— Files";
      if (lungBadge) lungBadge.textContent = "— Files";
    });

    document.querySelectorAll("[data-download]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const kind = btn.getAttribute("data-download");
        btn.disabled = true;
        const origText = btn.textContent;
        btn.textContent = "Working…";
        setStatus("");
        try {
          if (kind === "temperature") await downloadTemperature();
          else if (kind === "heart" || kind === "lung") await downloadAudioKind(kind);
        } catch (err) {
          progressLog(err.message || String(err), "error");
          progressDone("Download failed", true);
          setStatus(err.message || String(err), true);
        } finally {
          btn.disabled = false;
          btn.textContent = origText;
        }
      });
    });

    document.getElementById("reports-download-complete")?.addEventListener("click", async () => {
      const btn = document.getElementById("reports-download-complete");
      if (btn) { btn.disabled = true; btn.textContent = "Working…"; }
      setStatus("");
      try {
        await downloadComplete();
      } catch (err) {
        progressLog(err.message || String(err), "error");
        progressDone("Export failed", true);
        setStatus(err.message || String(err), true);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Download Complete ZIP"; }
      }
    });
  }

  function onShow() {
    if (!state.from) applyQuickRange("today");
    else {
      syncDateInputs();
      updateRangeLabels();
    }
    applyFiltersToReports();
    populateAnimalTypes();
    renderHistory();
    setStatus("Set filters and click Apply Filters to scan data.");
  }

  function init() {
    applyQuickRange("today");
    document.querySelectorAll(".reports-chip").forEach((b) => b.classList.remove("is-active"));
    document.querySelector('.reports-chip[data-range="today"]')?.classList.add("is-active");
    applyFiltersToReports();
    bindUi();
    renderHistory();
  }

  document.addEventListener("DOMContentLoaded", init);

  global.VetReportsPage = { onShow, applyQuickRange, getFilters, refreshCounts };
})(window);
