/**
 * Reports page — unified filters (auto-apply), download cards, history UI.
 */
(function (global) {
  const HISTORY_KEY = "vet_reports_download_history";
  const MAX_CUSTOM_DAYS = 90;
  const CHIP_LABELS = {
    today: "Today",
    yesterday: "Yesterday",
    last7: "Last 7 Days",
    last30: "Last 30 Days",
    all: "All saved data",
    custom: "Custom range",
  };

  const ANIMAL_OPTIONS = [
    { value: "all", label: "All Animals" },
    { value: "Dogs", label: "Dogs" },
    { value: "Cattle", label: "Cows" },
    { value: "Cats", label: "Cats" },
    { value: "Horses", label: "Horses" },
  ];

  const state = {
    quickRange: "today",
    from: null,
    to: null,
    animalType: "all",
    testType: "all",
  };

  let _syncingDates = false;
  let _scanToken = 0;
  let _progressActive = false;
  let _lastCounts = null;
  let _scanCache = null;

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
    if (state.quickRange === "all") {
      if (!state.from || !state.to) return "All saved data";
      const days = dayCount(state.from, state.to);
      if (state.from === state.to) return `All saved · ${formatDisplay(state.from)}`;
      return `All saved · ${formatDisplay(state.from)} – ${formatDisplay(state.to)} (${days} days)`;
    }
    if (!state.from || !state.to) return "—";
    if (state.from === state.to) return formatDisplay(state.from);
    return `${formatDisplay(state.from)} – ${formatDisplay(state.to)}`;
  }

  function dateTriggerLabel() {
    const preset = CHIP_LABELS[state.quickRange] || CHIP_LABELS.custom;
    if (state.quickRange === "all" && !state.from) return preset;
    if (state.quickRange === "custom") return `${preset} · ${rangeLabel()}`;
    if (!state.from || !state.to) return preset;
    if (state.from === state.to) return `${preset} · ${formatDisplay(state.from)}`;
    return `${preset} · ${rangeLabel()}`;
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
      state.from = null;
      state.to = today;
    }
    syncDateInputs();
    updateRangeLabels();
    updateDateDropdownUi();
  }

  function readFiltersFromState() {
    const animalEl = document.getElementById("reports-animal-type");
    const testEl = document.getElementById("reports-test-type");
    state.animalType = animalEl?.value || "all";
    state.testType = testEl?.value || "all";
  }

  function setHiddenFilterValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }

  function setDropdownSelection(ddId, panelId, labelId, hiddenId, value, labelText) {
    const panel = document.getElementById(panelId);
    const label = document.getElementById(labelId);
    if (label) label.textContent = labelText;
    setHiddenFilterValue(hiddenId, value);
    panel?.querySelectorAll(".reports-dd-option").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.value === value);
    });
  }

  function updateDownloadButtons(counts, scanning) {
    const tempBtn = document.querySelector('[data-download="temperature"]');
    const heartBtn = document.querySelector('[data-download="heart"]');
    const lungBtn = document.querySelector('[data-download="lung"]');
    const completeBtn = document.getElementById("reports-download-complete");

    const tempCount = counts?.temperature ?? null;
    const heartCount = counts?.heart ?? null;
    const lungCount = counts?.lung ?? null;
    const canDownloadTemp = !scanning && tempCount != null && tempCount > 0;
    const canDownloadHeart = !scanning && heartCount != null && heartCount > 0;
    const canDownloadLung = !scanning && lungCount != null && lungCount > 0;
    const canDownloadComplete = !scanning && (canDownloadTemp || canDownloadHeart || canDownloadLung);

    if (tempBtn) {
      tempBtn.disabled = !canDownloadTemp;
      tempBtn.textContent = "Download";
      tempBtn.title = canDownloadTemp ? "Download temperature Excel for this range" : "Scan first — no temperature records in range";
    }

    if (heartBtn) {
      heartBtn.disabled = !canDownloadHeart;
      heartBtn.textContent = "Download";
      heartBtn.title = canDownloadHeart ? "Download heart sound WAV files as ZIP" : "Scan first — no heart recordings in range";
    }

    if (lungBtn) {
      lungBtn.disabled = !canDownloadLung;
      lungBtn.textContent = "Download";
      lungBtn.title = canDownloadLung ? "Download lung sound WAV files as ZIP" : "Scan first — no lung recordings in range";
    }

    if (completeBtn) {
      completeBtn.disabled = !canDownloadComplete;
      completeBtn.textContent = "Download Complete ZIP";
      completeBtn.title = canDownloadComplete
        ? "ZIP with temperature Excel + heart/lung WAV for the scanned range"
        : "Scan data first — nothing to export yet";
    }
  }

  async function resolveAllDataRange(scanToken) {
    if (!global.VetExcelGenerator?.discoverSavedDataRange) {
      const today = todayIso();
      state.from = addDaysIso(today, -29);
      state.to = today;
      return;
    }

    progressUpdate("Finding saved data range…", 3);
    progressLog("Scanning exam sessions to find first and last saved dates…");

    const { client, cfg } = await global.VetExcelGenerator.createReportClient(currentDeviceId());

    if (scanToken !== _scanToken) return;

    const allPets = global.VetApiNormalize.normalizePets(await client.listPets());
    const span = await global.VetExcelGenerator.discoverSavedDataRange(
      client,
      cfg,
      allPets,
      state.animalType,
      (pct, label) => {
        if (scanToken !== _scanToken) return;
        progressUpdate(label || "Finding saved dates…", 3 + Math.round(pct * 0.12));
      }
    );

    if (scanToken !== _scanToken) return;

    state.from = span.from;
    state.to = span.to;
    syncDateInputs();
    updateRangeLabels();
    progressLog(
      span.source === "sessions"
        ? `Saved data span: ${formatDisplay(span.from)} – ${formatDisplay(span.to)} (${span.days} day(s))`
        : `No sessions found — using last ${span.days} day(s) as fallback`,
      "done"
    );
  }

  function syncDateInputs() {
    _syncingDates = true;
    const fromEl = document.getElementById("reports-date-from");
    const toEl = document.getElementById("reports-date-to");
    if (fromEl) fromEl.value = state.from || "";
    if (toEl) toEl.value = state.to || "";
    _syncingDates = false;
  }

  function updateDateDropdownUi() {
    const label = document.getElementById("reports-date-label");
    if (label) label.textContent = dateTriggerLabel();

    document.querySelectorAll(".reports-dd-option[data-range]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.range === state.quickRange);
    });

    const customBlock = document.querySelector(".reports-dd-custom");
    if (customBlock) customBlock.classList.toggle("is-active", state.quickRange === "custom");
  }

  function validateDateRange() {
    const from = state.from || todayIso();
    const to = state.to || todayIso();
    if (from > to) {
      return "Start date must be on or before end date.";
    }
    const days = dayCount(from, to);
    if (state.quickRange === "custom" && days > MAX_CUSTOM_DAYS) {
      return `Custom range is ${days} days (max ${MAX_CUSTOM_DAYS}). Pick "Last 30 Days" or "All saved data" instead.`;
    }
    return null;
  }

  function updateRangeLabels() {
    const label = rangeLabel();
    document.querySelectorAll("[data-card-range]").forEach((el) => {
      el.textContent = label;
    });
    updateDateDropdownUi();
  }

  function setStatusStrip(mode, text) {
    const strip = document.getElementById("reports-status-strip");
    const textEl = document.getElementById("reports-status-text");
    if (!strip || !textEl) return;
    strip.classList.remove("is-scanning", "is-ready", "is-error");
    if (mode) strip.classList.add(mode);
    textEl.textContent = text;
  }

  function setScanningUi(active, pct, label) {
    const trigger = document.getElementById("reports-date-trigger");
    const grid = document.querySelector(".reports-cards-grid");
    if (trigger) trigger.classList.toggle("is-scanning", active);
    if (grid) grid.classList.toggle("is-loading", active);
    if (active) {
      const pctText = pct != null ? `${Math.round(pct)}% · ` : "";
      setStatusStrip("is-scanning", `${pctText}${label || "Scanning data…"}`);
    }
  }

  function setCardsLoading(active) {
    document.querySelector(".reports-cards-grid")?.classList.toggle("is-loading", active);
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
    if (labelEl) labelEl.textContent = label || "Working…";
    const clamped = Math.max(0, Math.min(100, Math.round(pct || 0)));
    if (pctEl) pctEl.textContent = `${clamped}%`;
    if (fill) {
      fill.style.width = `${clamped}%`;
      fill.style.background = "";
    }
    if (log && pct === 0) log.innerHTML = "";
    setScanningUi(true, clamped, label);
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
    setScanningUi(true, clamped, label);
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
    document.getElementById("reports-date-trigger")?.classList.remove("is-scanning");
    setCardsLoading(false);
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
    scrollToHistory();
  }

  function scrollToHistory() {
    document.querySelector(".reports-history-card")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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

  function buildExportFilters(expectedCount) {
    readFiltersFromState();
    const from = state.from || todayIso();
    const to = state.to || todayIso();
    const deviceId = currentDeviceId();
    const cacheOk = _scanCache
      && _scanCache.from === from
      && _scanCache.to === to
      && _scanCache.animalType === (state.animalType || "all")
      && _scanCache.deviceId === deviceId;
    return {
      from,
      to,
      animalType: state.animalType,
      testType: state.testType,
      deviceId,
      cachedPets: cacheOk ? _scanCache.pets : null,
      daysWithTemperature: cacheOk ? _scanCache.daysWithTemperature : null,
      expectedCount,
    };
  }

  function formatCountBadge(kind, count) {
    if (count == null) return kind === "temperature" ? "— Records" : "— Files";
    if (kind === "temperature") return `${count} Record${count === 1 ? "" : "s"}`;
    return `${count} File${count === 1 ? "" : "s"}`;
  }

  function summaryFromCounts(counts) {
    return `${counts.temperature} temperature · ${counts.heart} heart · ${counts.lung} lung · ${counts.pets} animal(s)`;
  }

  async function refreshCounts(scanToken) {
    const tempBadge = document.getElementById("reports-temp-count");
    const heartBadge = document.getElementById("reports-heart-count");
    const lungBadge = document.getElementById("reports-lung-count");
    const from = state.from || todayIso();
    const to = state.to || todayIso();

    if (from > to) {
      if (tempBadge) tempBadge.textContent = "— Records";
      if (heartBadge) heartBadge.textContent = "— Files";
      if (lungBadge) lungBadge.textContent = "— Files";
      return null;
    }

    if (tempBadge) tempBadge.textContent = "… Records";
    if (heartBadge) heartBadge.textContent = "… Files";
    if (lungBadge) lungBadge.textContent = "… Files";
    setCardsLoading(true);
    updateDownloadButtons(null, true);

    progressShow("Scanning data…", 0);
    progressLog(`${dateTriggerLabel()} · ${dayCount(from, to)} day(s)`);

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
        if (scanToken !== _scanToken) return;
        progressUpdate(label || "Scanning…", 10 + Math.round(pct * 0.85));
      });

      if (scanToken !== _scanToken) return null;

      progressUpdate("Done scanning", 100);

      const showTemp = state.testType === "all" || state.testType === "temperature";
      const showHeart = state.testType === "all" || state.testType === "heart";
      const showLung = state.testType === "all" || state.testType === "lung";

      if (tempBadge) tempBadge.textContent = showTemp ? formatCountBadge("temperature", counts.temperature) : "— Records";
      if (heartBadge) heartBadge.textContent = showHeart ? formatCountBadge("heart", counts.heart) : "— Files";
      if (lungBadge) lungBadge.textContent = showLung ? formatCountBadge("lung", counts.lung) : "— Files";

      progressLog(`Found: ${summaryFromCounts(counts)}`, "done");
      progressDone(`Scan complete · ${counts.pets} animal(s) in range`);
      setStatusStrip("is-ready", `Ready · ${dateTriggerLabel()} · ${summaryFromCounts(counts)}`);
      _lastCounts = counts;
      _scanCache = {
        from,
        to,
        animalType: state.animalType || "all",
        deviceId: currentDeviceId(),
        pets: counts.resolvedPets || [],
        daysWithTemperature: counts.daysWithTemperature || [],
        counts,
      };
      updateDownloadButtons(counts, false);
      return counts;
    } catch (err) {
      if (scanToken !== _scanToken) return null;
      if (tempBadge) tempBadge.textContent = "— Records";
      if (heartBadge) heartBadge.textContent = "— Files";
      if (lungBadge) lungBadge.textContent = "— Files";
      progressLog(err.message || String(err), "error");
      progressDone("Scan failed", true);
      setStatusStrip("is-error", err.message || "Scan failed");
      _lastCounts = null;
      _scanCache = null;
      updateDownloadButtons(null, false);
      return null;
    }
  }

  function syncReportDateHidden() {
    const el = document.getElementById("app-report-date");
    if (el) el.value = state.to || todayIso();
  }

  async function applyAndScan() {
    readFiltersFromState();

    const scanToken = ++_scanToken;
    setScanningUi(true, 0, "Starting scan…");
    updateDownloadButtons(null, true);

    try {
      if (state.quickRange === "all" && !state.from) {
        progressShow("Finding saved data…", 1);
        await resolveAllDataRange(scanToken);
        if (scanToken !== _scanToken) return;
      }

      const rangeError = validateDateRange();
      if (rangeError) {
        setStatus(rangeError, true);
        setStatusStrip("is-error", rangeError);
        progressShow("Invalid range", 0);
        progressLog(rangeError, "error");
        progressDone("Fix date range and try again", true);
        updateDownloadButtons(null, false);
        return;
      }

      syncReportDateHidden();
      updateRangeLabels();
      await refreshCounts(scanToken);
    } catch (err) {
      if (scanToken === _scanToken) {
        setStatus(err.message || String(err), true);
        setStatusStrip("is-error", err.message || "Scan failed");
        updateDownloadButtons(null, false);
      }
    }
  }

  function applyCustomRangeFromInputs() {
    const fromEl = document.getElementById("reports-date-from");
    const toEl = document.getElementById("reports-date-to");
    state.from = fromEl?.value || state.from || todayIso();
    state.to = toEl?.value || state.to || todayIso();
    state.quickRange = "custom";
    updateRangeLabels();
    closeDateDropdown();
    applyAndScan();
  }

  function selectPresetRange(key) {
    applyQuickRange(key);
    closeDateDropdown();
    applyAndScan();
  }

  function renderAnimalOptions(currentValue) {
    const panel = document.getElementById("reports-animal-panel");
    const hidden = document.getElementById("reports-animal-type");
    const label = document.getElementById("reports-animal-label");
    if (!panel || !hidden) return;

    const current = currentValue || hidden.value || "all";
    const options = [...ANIMAL_OPTIONS];
    panel.innerHTML = options
      .map(
        (o) =>
          `<button type="button" class="reports-dd-option${o.value === current ? " is-active" : ""}" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</button>`
      )
      .join("");
    panel.querySelectorAll(".reports-dd-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectAnimalFilter(btn.dataset.value || "all", btn.textContent || "All Animals");
      });
    });
    const active = options.find((o) => o.value === current) || options[0];
    hidden.value = active.value;
    state.animalType = active.value;
    if (label) label.textContent = active.label;
  }

  async function populateAnimalTypes() {
    renderAnimalOptions(state.animalType || "all");
  }

  function selectAnimalFilter(value, labelText) {
    setDropdownSelection("reports-dd-animal", "reports-animal-panel", "reports-animal-label", "reports-animal-type", value, labelText);
    state.animalType = value;
    closeReportsDropdown("reports-dd-animal");
    applyAndScan();
  }

  function selectTestFilter(value, labelText) {
    setDropdownSelection("reports-dd-test", "reports-test-panel", "reports-test-label", "reports-test-type", value, labelText);
    state.testType = value;
    closeReportsDropdown("reports-dd-test");
    applyAndScan();
  }

  function readFiltersFromUi() {
    readFiltersFromState();
  }

  async function downloadTemperature() {
    readFiltersFromState();
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
    readFiltersFromState();
    const from = state.from || todayIso();
    const to = state.to || todayIso();
    if (from > to) throw new Error("Start date must be on or before end date.");
    if (!global.VetExcelGenerator?.exportAudioZip) {
      throw new Error("Audio export unavailable.");
    }

    progressShow(`Preparing ${kind} sound ZIP…`, 0);
    progressLog(`Range: ${rangeLabel()}`);

    const logger = {
      log: (msg) => progressLog(msg),
      warn: (msg) => progressLog(msg),
      error: console.error,
    };

    const result = await global.VetExcelGenerator.exportAudioZip(
      buildExportFilters(kind === "heart" ? _lastCounts?.heart : _lastCounts?.lung),
      kind,
      logger,
      (pct, label) => progressUpdate(label || "Exporting audio…", Math.min(99, pct))
    );

    pushHistory({
      when: new Date().toLocaleString("en-IN", { hour12: true }),
      type: kind === "heart" ? "Heart Sound Data" : "Lung Sound Data",
      range: rangeLabel(),
      records: `${result.saved} file${result.saved === 1 ? "" : "s"}`,
      format: "ZIP",
      size: "—",
      actionHtml: '<span class="reports-hist-done">Downloaded</span>',
    });
    progressDone(`${kind === "heart" ? "Heart" : "Lung"} ZIP downloaded · ${result.saved} file(s)`);
    setStatus(`${kind === "heart" ? "Heart" : "Lung"} sound ZIP downloaded · ${result.saved} file(s) · ${rangeLabel()}`);
  }

  async function downloadComplete() {
    readFiltersFromState();
    const from = state.from || todayIso();
    const to = state.to || todayIso();
    if (from > to) throw new Error("Start date must be on or before end date.");
    if (!global.VetExcelGenerator?.exportCompleteZip) {
      throw new Error("Complete export unavailable.");
    }

    progressShow("Preparing complete export ZIP…", 0);
    progressLog(`Exporting all scanned data for: ${rangeLabel()}`);

    const logger = {
      log: (msg) => progressLog(msg),
      warn: (msg) => progressLog(msg),
      error: console.error,
      success: (msg) => progressLog(msg, "done"),
    };

    const result = await global.VetExcelGenerator.exportCompleteZip(
      buildExportFilters((_lastCounts?.temperature || 0) + (_lastCounts?.heart || 0) + (_lastCounts?.lung || 0)),
      logger,
      (pct, label) => progressUpdate(label || "Building complete ZIP…", Math.min(99, pct))
    );

    pushHistory({
      when: new Date().toLocaleString("en-IN", { hour12: true }),
      type: "Complete Data Export",
      range: rangeLabel(),
      records: `${result.tempRows} temp row(s) · ${result.audioSaved} audio file(s)`,
      format: "ZIP",
      size: "—",
      actionHtml: '<span class="reports-hist-done">Downloaded</span>',
    });
    progressDone(
      `Complete ZIP downloaded · ${result.tempFiles} Excel · ${result.audioSaved} audio file(s)` +
        (result.audioError ? " · audio partial" : "")
    );
    setStatus(
      `Complete export downloaded · ${result.tempFiles} temperature file(s), ${result.audioSaved} audio file(s) · ${rangeLabel()}`
    );
  }

  function openReportsDropdown(ddId, panelId, triggerId) {
    closeAllReportsDropdowns();
    const dd = document.getElementById(ddId);
    const panel = document.getElementById(panelId);
    const trigger = document.getElementById(triggerId);
    if (!dd || !panel || !trigger) return;
    dd.classList.add("is-open");
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
  }

  function closeReportsDropdown(ddId) {
    const dd = document.getElementById(ddId);
    if (!dd) return;
    const panel = dd.querySelector(".reports-dd-panel");
    const trigger = dd.querySelector(".reports-dd-trigger");
    dd.classList.remove("is-open");
    if (panel) panel.hidden = true;
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  }

  function closeAllReportsDropdowns() {
    ["reports-dd-date", "reports-dd-animal", "reports-dd-test"].forEach(closeReportsDropdown);
  }

  function toggleReportsDropdown(ddId, panelId, triggerId) {
    const dd = document.getElementById(ddId);
    if (dd?.classList.contains("is-open")) closeReportsDropdown(ddId);
    else openReportsDropdown(ddId, panelId, triggerId);
  }

  function openDateDropdown() {
    openReportsDropdown("reports-dd-date", "reports-date-panel", "reports-date-trigger");
  }

  function closeDateDropdown() {
    closeReportsDropdown("reports-dd-date");
  }

  function toggleDateDropdown() {
    toggleReportsDropdown("reports-dd-date", "reports-date-panel", "reports-date-trigger");
  }

  function bindUi() {
    document.getElementById("reports-date-trigger")?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDateDropdown();
    });

    document.querySelectorAll(".reports-dd-option[data-range]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectPresetRange(btn.dataset.range || "today");
      });
    });

    document.getElementById("reports-custom-range-apply")?.addEventListener("click", () => {
      applyCustomRangeFromInputs();
    });

    document.getElementById("reports-date-from")?.addEventListener("change", (e) => {
      if (_syncingDates) return;
      state.from = e.target.value;
      state.quickRange = "custom";
      document.querySelectorAll(".reports-dd-option[data-range]").forEach((b) => b.classList.remove("is-active"));
      document.querySelector(".reports-dd-custom")?.classList.add("is-active");
      updateDateDropdownUi();
    });

    document.getElementById("reports-date-to")?.addEventListener("change", (e) => {
      if (_syncingDates) return;
      state.to = e.target.value;
      state.quickRange = "custom";
      document.querySelectorAll(".reports-dd-option[data-range]").forEach((b) => b.classList.remove("is-active"));
      document.querySelector(".reports-dd-custom")?.classList.add("is-active");
      updateDateDropdownUi();
    });

    document.getElementById("reports-animal-trigger")?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleReportsDropdown("reports-dd-animal", "reports-animal-panel", "reports-animal-trigger");
    });

    document.getElementById("reports-test-trigger")?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleReportsDropdown("reports-dd-test", "reports-test-panel", "reports-test-trigger");
    });

    document.querySelectorAll("#reports-test-panel .reports-dd-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectTestFilter(btn.dataset.value || "all", btn.textContent || "All Tests");
      });
    });

    document.getElementById("reports-reset-filters")?.addEventListener("click", () => {
      setDropdownSelection("reports-dd-animal", "reports-animal-panel", "reports-animal-label", "reports-animal-type", "all", "All Animals");
      setDropdownSelection("reports-dd-test", "reports-test-panel", "reports-test-label", "reports-test-type", "all", "All Tests");
      state.animalType = "all";
      state.testType = "all";
      applyQuickRange("today");
      syncReportDateHidden();
      _lastCounts = null;
      const tempBadge = document.getElementById("reports-temp-count");
      const heartBadge = document.getElementById("reports-heart-count");
      const lungBadge = document.getElementById("reports-lung-count");
      if (tempBadge) tempBadge.textContent = "— Records";
      if (heartBadge) heartBadge.textContent = "— Files";
      if (lungBadge) lungBadge.textContent = "— Files";
      updateDownloadButtons(null, false);
      applyAndScan();
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".reports-dd")) closeAllReportsDropdowns();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAllReportsDropdowns();
    });

    document.querySelectorAll("[data-download]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const kind = btn.getAttribute("data-download");
        if (btn.disabled) return;
        btn.disabled = true;
        const origText = btn.textContent;
        btn.textContent = "Working…";
        setStatus("");
        try {
          readFiltersFromState();
          if (kind === "temperature") await downloadTemperature();
          else if (kind === "heart" || kind === "lung") await downloadAudioKind(kind);
        } catch (err) {
          progressLog(err.message || String(err), "error");
          progressDone("Download failed", true);
          setStatus(err.message || String(err), true);
        } finally {
          updateDownloadButtons(_lastCounts, false);
          if (kind === "temperature" && btn.textContent === "Working…") {
            btn.textContent = origText;
          }
        }
      });
    });

    document.getElementById("reports-download-complete")?.addEventListener("click", async () => {
      const btn = document.getElementById("reports-download-complete");
      if (!btn || btn.disabled) return;
      btn.disabled = true;
      btn.textContent = "Working…";
      setStatus("");
      try {
        readFiltersFromState();
        await downloadComplete();
      } catch (err) {
        progressLog(err.message || String(err), "error");
        progressDone("Export failed", true);
        setStatus(err.message || String(err), true);
      } finally {
        updateDownloadButtons(_lastCounts, false);
      }
    });
  }

  function onShow() {
    if (!state.from) applyQuickRange("today");
    else {
      syncDateInputs();
      updateRangeLabels();
    }
    syncReportDateHidden();
    populateAnimalTypes().then(() => applyAndScan());
    renderHistory();
  }

  function init() {
    applyQuickRange("today");
    renderAnimalOptions("all");
    syncReportDateHidden();
    bindUi();
    renderHistory();
    updateDownloadButtons(null, false);
    setStatusStrip("", "Open date range to load data");
  }

  document.addEventListener("DOMContentLoaded", init);

  global.VetReportsPage = { onShow, applyQuickRange, getFilters, refreshCounts, applyAndScan };
})(window);
