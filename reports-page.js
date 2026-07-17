/**
 * Reports page — filters, download cards, history UI.
 */
(function (global) {
  const HISTORY_KEY = "vet_reports_download_history";

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

  function rangeLabel() {
    if (state.quickRange === "all") return "All Data";
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
      state.from = "2020-01-01";
      state.to = today;
    }
    syncDateInputs();
    updateRangeLabels();
  }

  function syncDateInputs() {
    const fromEl = document.getElementById("reports-date-from");
    const toEl = document.getElementById("reports-date-to");
    if (fromEl) fromEl.value = state.from || "";
    if (toEl) toEl.value = state.to || "";
  }

  function updateRangeLabels() {
    const label = rangeLabel();
    document.querySelectorAll("[data-card-range]").forEach((el) => {
      el.textContent = label;
    });
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

    try {
      if (!global.VetExcelGenerator?.countReportInventory) {
        throw new Error("Report counter unavailable.");
      }
      const counts = await global.VetExcelGenerator.countReportInventory({
        from,
        to,
        animalType: state.animalType,
        testType: state.testType,
        deviceId: "ARMY",
      });

      const showTemp = state.testType === "all" || state.testType === "temperature";
      const showHeart = state.testType === "all" || state.testType === "heart";
      const showLung = state.testType === "all" || state.testType === "lung";

      if (tempBadge) tempBadge.textContent = showTemp ? formatCountBadge("temperature", counts.temperature) : "— Records";
      if (heartBadge) heartBadge.textContent = showHeart ? formatCountBadge("heart", counts.heart) : "— Files";
      if (lungBadge) lungBadge.textContent = showLung ? formatCountBadge("lung", counts.lung) : "— Files";
    } catch {
      if (tempBadge) tempBadge.textContent = "— Records";
      if (heartBadge) heartBadge.textContent = "— Files";
      if (lungBadge) lungBadge.textContent = "— Files";
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
    setStatus("Preparing temperature Excel download…");
    const from = state.from || todayIso();
    const to = state.to || todayIso();
    if (from > to) throw new Error("Start date must be on or before end date.");

    if (!global.VetExcelGenerator?.compileDailySummary) {
      throw new Error("Excel report generator unavailable.");
    }

    const logger = {
      log: () => {},
      warn: () => {},
      error: console.error,
      success: () => {},
    };

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

    let totalRows = 0;
    for (const day of days) {
      setStatus(`Generating temperature Excel for ${formatDisplay(day)}…`);
      const result = await global.VetExcelGenerator.compileDailySummary(day, "ARMY", logger, {
        animalType: state.animalType,
      });
      totalRows += Number(result?.rows_written) || 0;
    }

    pushHistory({
      when: new Date().toLocaleString("en-IN", { hour12: true }),
      type: "Temperature Data",
      range: rangeLabel(),
      records: `${totalRows} row${totalRows === 1 ? "" : "s"}`,
      format: "Excel",
      size: "—",
      actionHtml: '<span class="reports-hist-done">Downloaded</span>',
    });
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
    setStatus("Preparing complete export…");
    const from = state.from || todayIso();
    const to = state.to || todayIso();
    if (from > to) throw new Error("Start date must be on or before end date.");

    if (global.VetExcelGenerator?.compileDailySummary) {
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

      let totalRows = 0;
      for (const day of days) {
        setStatus(`Exporting temperature data for ${formatDisplay(day)}…`);
        const result = await global.VetExcelGenerator.compileDailySummary(day, "ARMY", {
          log() {},
          warn() {},
          error: console.error,
          success() {},
        }, { animalType: state.animalType });
        totalRows += Number(result?.rows_written) || 0;
      }

      pushHistory({
        when: new Date().toLocaleString("en-IN", { hour12: true }),
        type: "Complete Data Export",
        range: rangeLabel(),
        records: `${totalRows} temperature row${totalRows === 1 ? "" : "s"}`,
        format: "Excel",
        size: "—",
        actionHtml: '<span class="reports-hist-done">Downloaded</span>',
      });
      setStatus(`Complete export started with ${totalRows} temperature row(s). Full ZIP requires audio batch API.`);
      return;
    }
    setStatus("Export generator unavailable.", true);
  }

  function bindUi() {
    document.querySelectorAll(".reports-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".reports-chip").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        applyQuickRange(btn.dataset.range || "today");
      });
    });

    document.getElementById("reports-date-from")?.addEventListener("change", (e) => {
      state.from = e.target.value;
      state.quickRange = "custom";
      document.querySelectorAll(".reports-chip").forEach((b) => b.classList.remove("is-active"));
      updateRangeLabels();
    });
    document.getElementById("reports-date-to")?.addEventListener("change", (e) => {
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
      if (state.from && state.to && state.from > state.to) {
        setStatus("Start date must be on or before end date.", true);
        return;
      }
      applyFiltersToReports();
      updateRangeLabels();
      setStatus(`Scanning data for ${rangeLabel()}…`);
      await refreshCounts();
      setStatus(`Filters applied · ${rangeLabel()}`);
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
      setStatus("Filters reset.");
      refreshCounts();
    });

    document.querySelectorAll("[data-download]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const kind = btn.getAttribute("data-download");
        btn.disabled = true;
        try {
          if (kind === "temperature") await downloadTemperature();
          else if (kind === "heart" || kind === "lung") await downloadAudioKind(kind);
        } catch (err) {
          setStatus(err.message || String(err), true);
        } finally {
          btn.disabled = false;
        }
      });
    });

    document.getElementById("reports-download-complete")?.addEventListener("click", async () => {
      const btn = document.getElementById("reports-download-complete");
      if (btn) btn.disabled = true;
      try {
        await downloadComplete();
      } catch (err) {
        setStatus(err.message || String(err), true);
      } finally {
        if (btn) btn.disabled = false;
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
    refreshCounts();
    renderHistory();
  }

  function init() {
    applyQuickRange("today");
    applyFiltersToReports();
    bindUi();
    renderHistory();
  }

  document.addEventListener("DOMContentLoaded", init);

  global.VetReportsPage = { onShow, applyQuickRange, getFilters, refreshCounts };
})(window);
