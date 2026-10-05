/**
 * Device diagnostic Logs page — flush, fetch, preview, Excel (Story / All / Faults).
 */
(function (global) {
  const HISTORY_KEY = "vet_diag_log_download_history";
  const FLUSH_POLL_MS = 5000;
  const FLUSH_WAIT_MS = 120000;

  const state = {
    date: null,
    from: "",
    to: "",
    chip: "all",
    daysWithData: new Set(),
    daysCount: 0,
    eventsPayload: null,
    model: null,
    loading: false,
    flushing: false,
    flushTimer: null,
    fetchToken: 0,
  };

  const utcDateFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const displayFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  function $(id) {
    return document.getElementById(id);
  }

  function deviceId() {
    return String(global.VetAuth?.getDeviceId?.() || global.API_CONFIG?.deviceId || "ARMY")
      .trim()
      .toUpperCase();
  }

  function todayUtc() {
    return utcDateFmt.format(new Date());
  }

  function formatDateLabel(iso) {
    if (!iso) return "—";
    try {
      return displayFmt.format(new Date(`${iso}T12:00:00Z`));
    } catch {
      return iso;
    }
  }

  function getClient() {
    if (!global.API_CONFIG?.baseUrl || !global.VetApiClient) {
      throw new Error("API is not configured.");
    }
    const session = global.VetAuth?.getSession?.() || {};
    const client = new global.VetApiClient({
      baseUrl: global.API_CONFIG.baseUrl,
      deviceId: deviceId(),
      sessionToken: session.sessionToken || "",
      timeoutMs: global.API_CONFIG.timeoutMs || 25000,
    });
    if (session.sessionToken) client.setSessionToken(session.sessionToken);
    return client;
  }

  function setStatus(msg, kind = "info") {
    const el = $("logs-status");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      el.dataset.kind = "";
      return;
    }
    el.hidden = false;
    el.textContent = msg;
    el.dataset.kind = kind;
  }

  function setGenerateEnabled(on) {
    const btn = $("logs-generate-btn");
    if (btn) btn.disabled = !on || state.flushing;
  }

  function syncLabels() {
    const dateLabel = $("logs-date-label");
    if (dateLabel) dateLabel.textContent = formatDateLabel(state.date || todayUtc());
    const daysBadge = $("logs-days-badge");
    if (daysBadge) {
      daysBadge.textContent = state.daysCount
        ? `${state.daysCount} day(s) have logs`
        : "No log days yet";
    }
    const deviceEl = $("logs-device-label");
    if (deviceEl) deviceEl.textContent = deviceId();
  }

  function readHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function writeHistory(entry) {
    const list = readHistory();
    list.unshift(entry);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 40)));
    renderHistory();
  }

  function formatBytes(n) {
    if (!n) return "—";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function renderHistory() {
    const body = $("logs-history-body");
    if (!body) return;
    const list = readHistory();
    if (!list.length) {
      body.innerHTML =
        '<tr><td colspan="5" class="empty-state">No downloads yet. Generated log reports will appear here.</td></tr>';
      return;
    }
    body.innerHTML = list
      .map(
        (row) => `<tr>
          <td>${escapeHtml(row.when || "—")}</td>
          <td>${escapeHtml(row.device || "—")}</td>
          <td>${escapeHtml(row.range || "—")}</td>
          <td>${escapeHtml(String(row.events ?? "—"))}</td>
          <td>${escapeHtml(row.filename || "—")} · ${escapeHtml(formatBytes(row.size))}</td>
        </tr>`
      )
      .join("");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderPreview() {
    const listEl = $("logs-preview-list");
    const countEl = $("logs-fault-count");
    const totalEl = $("logs-event-count");
    const banner = $("logs-time-banner");
    if (!state.model) {
      if (listEl) {
        listEl.innerHTML = '<li class="logs-preview-empty">Select a date and load events to preview the story.</li>';
      }
      if (countEl) countEl.textContent = "0";
      if (totalEl) totalEl.textContent = "0";
      if (banner) banner.hidden = true;
      setGenerateEnabled(false);
      return;
    }

    const { summary } = state.model;
    if (countEl) countEl.textContent = String(summary.faultCount);
    if (totalEl) totalEl.textContent = String(summary.totalEvents);
    if (banner) {
      const show = summary.unsyncedRatio >= 0.25 && summary.totalEvents > 0;
      banner.hidden = !show;
      if (show) {
        banner.textContent =
          "Many events have unsynced device time (U). Device times may be boot-relative / approximate. Prefer Server received times for ordering when unsure.";
      }
    }

    const lines = global.VetDiagLogDecode.filterPreviewRows(state.model, state.chip).slice(0, 80);
    if (listEl) {
      if (!lines.length) {
        listEl.innerHTML = '<li class="logs-preview-empty">No preview lines for this filter.</li>';
      } else {
        listEl.innerHTML = lines
          .map(
            (line) => `<li class="logs-preview-item logs-preview-item--${escapeHtml(line.category)}">
              <div class="logs-preview-time">
                <strong>${escapeHtml(line.time)}</strong>
                <span>Server: ${escapeHtml(line.serverTime || "—")}</span>
              </div>
              <p>${escapeHtml(line.text)}</p>
            </li>`
          )
          .join("");
      }
    }
    setGenerateEnabled(summary.totalEvents > 0);
  }

  async function loadDays() {
    try {
      const client = getClient();
      const resp = await client.diagEventDays(deviceId(), { limit: 60 });
      const days = Array.isArray(resp?.days) ? resp.days : [];
      state.daysWithData = new Set(days.map((d) => String(d)));
      state.daysCount = num(resp?.count, days.length);
      syncLabels();
      renderCalendar();
    } catch (err) {
      console.warn("diag days failed", err);
      state.daysWithData = new Set();
      state.daysCount = 0;
      syncLabels();
    }
  }

  function num(v, fb = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  }

  const CHUNK_LIMIT = 2000;
  const MAX_CHUNKS = 50; // safety: up to 100k events

  function eventKey(ev) {
    return [
      ev.server_received_at || "",
      ev.sk || "",
      ev.code || "",
      ev.event_time_s || "",
      ev.bucket_id || "",
      ev.session_hex || "",
      ev.sequence_hex || "",
    ].join("|");
  }

  /** Subtract 1 microsecond from an ISO timestamp for exclusive upper bound. */
  function isoMinusOneMicro(iso) {
    const raw = String(iso || "").trim();
    if (!raw) return null;
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms)) return raw;
    // Prefer keeping fractional precision when present
    const match = raw.match(/^(.*\.)(\d+)(Z)$/i);
    if (match) {
      const frac = match[2];
      const digits = frac.length;
      let n = BigInt(frac.padEnd(6, "0").slice(0, 6));
      if (n > 0n) {
        n -= 1n;
        const nextFrac = String(n).padStart(6, "0").slice(0, digits);
        return `${match[1]}${nextFrac}${match[3]}`;
      }
      return new Date(ms - 1).toISOString();
    }
    return new Date(ms - 1).toISOString();
  }

  function oldestServerReceivedAt(events) {
    let oldest = null;
    let oldestMs = Infinity;
    (events || []).forEach((ev) => {
      const iso = String(ev.server_received_at || "").trim();
      const ms = Date.parse(iso);
      if (!iso || !Number.isFinite(ms)) return;
      if (ms < oldestMs) {
        oldestMs = ms;
        oldest = iso;
      }
    });
    return oldest;
  }

  /**
   * Full-day fetch via time windows (API hard-caps at 2000 per GET).
   * Walks newest → older using `to` = oldest.server_received_at − 1µs until a short page.
   */
  async function fetchAllDiagEvents(client, { deviceId: id, date, from, to, onProgress } = {}) {
    const all = [];
    const seen = new Set();
    let pageTo = to || undefined;
    let chunks = 0;
    let lastPayload = null;

    while (chunks < MAX_CHUNKS) {
      chunks += 1;
      onProgress?.(chunks, all.length);
      const payload = await client.diagEvents({
        deviceId: id,
        date,
        from: from || undefined,
        to: pageTo,
        limit: CHUNK_LIMIT,
        newestFirst: true,
      });
      lastPayload = payload;
      const batch = Array.isArray(payload?.events) ? payload.events : [];
      const count = num(payload?.count, batch.length);

      batch.forEach((ev) => {
        const key = eventKey(ev);
        if (seen.has(key)) return;
        seen.add(key);
        all.push(ev);
      });

      if (count < CHUNK_LIMIT || batch.length === 0) break;

      const oldest = oldestServerReceivedAt(batch);
      if (!oldest) break;
      const nextTo = isoMinusOneMicro(oldest);
      if (!nextTo || nextTo === pageTo) break;
      // Don't walk past user-supplied from bound
      if (from) {
        const fromMs = Date.parse(from.includes("T") ? from : `${date}T${from}Z`);
        const nextMs = Date.parse(nextTo);
        if (Number.isFinite(fromMs) && Number.isFinite(nextMs) && nextMs < fromMs) break;
      }
      pageTo = nextTo;
    }

    return {
      device_id: lastPayload?.device_id || id,
      day: lastPayload?.day || date,
      from: from || lastPayload?.from || null,
      to: to || lastPayload?.to || null,
      count: all.length,
      chunks,
      capped: chunks >= MAX_CHUNKS,
      events: all,
    };
  }

  async function fetchEvents({ quiet } = {}) {
    const token = ++state.fetchToken;
    state.loading = true;
    if (!quiet) setStatus("Loading diagnostic events (chunked)…", "info");
    setGenerateEnabled(false);
    try {
      const client = getClient();
      const day = state.date || todayUtc();
      const payload = await fetchAllDiagEvents(client, {
        deviceId: deviceId(),
        date: day,
        from: state.from || undefined,
        to: state.to || undefined,
        onProgress: (chunk, soFar) => {
          if (token !== state.fetchToken) return;
          setStatus(`Loading events… chunk ${chunk} · ${soFar} so far`, "info");
        },
      });
      if (token !== state.fetchToken) return;
      state.eventsPayload = payload;
      state.model = global.VetDiagLogDecode.buildReportModel(payload, {
        deviceId: deviceId(),
        date: day,
      });
      renderPreview();
      const n = state.model.summary.totalEvents;
      const chunkNote = payload.chunks > 1 ? ` · ${payload.chunks} chunk(s)` : "";
      const capNote = payload.capped ? " · hit safety cap, may be incomplete" : "";
      setStatus(
        n
          ? `Loaded ${n} event(s) for ${formatDateLabel(state.date)}${chunkNote}${capNote} · ${state.model.summary.faultCount} fault(s).`
          : `No stored events for ${formatDateLabel(state.date)}. Try Flush if the device is online.`,
        n ? (payload.capped ? "warn" : "ok") : "warn"
      );
    } catch (err) {
      if (token !== state.fetchToken) return;
      state.eventsPayload = null;
      state.model = null;
      renderPreview();
      setStatus(`Failed to load events: ${err.message || err}`, "error");
    } finally {
      if (token === state.fetchToken) state.loading = false;
    }
  }

  function clearFlushTimer() {
    if (state.flushTimer) {
      clearInterval(state.flushTimer);
      state.flushTimer = null;
    }
  }

  async function runFlushWait() {
    if (state.flushing) return;
    const client = getClient();
    const id = deviceId();
    const t0 = Date.now();
    const t0Iso = new Date(t0).toISOString();
    state.flushing = true;
    setGenerateEnabled(false);
    $("logs-flush-btn")?.setAttribute("disabled", "disabled");
    setStatus("Flush queued — waiting for device upload (up to 2 minutes)…", "info");

    try {
      await client.diagFlush(id);
    } catch (err) {
      state.flushing = false;
      $("logs-flush-btn")?.removeAttribute("disabled");
      setStatus(`Flush failed: ${err.message || err}`, "error");
      setGenerateEnabled(!!state.model?.summary?.totalEvents);
      return;
    }

    // Prefer today's UTC while waiting for new uploads
    const waitDate = todayUtc();
    let baselineCount = 0;
    try {
      const snap = await client.diagEvents({ deviceId: id, date: waitDate, limit: 50, newestFirst: true });
      baselineCount = num(snap?.count, (snap?.events || []).length);
    } catch {
      baselineCount = 0;
    }

    clearFlushTimer();
    const started = Date.now();
    state.flushTimer = setInterval(async () => {
      const elapsed = Date.now() - started;
      const remainS = Math.max(0, Math.ceil((FLUSH_WAIT_MS - elapsed) / 1000));
      setStatus(`Waiting for device upload… ${remainS}s left`, "info");
      try {
        const probe = await client.diagEvents({
          deviceId: id,
          date: waitDate,
          limit: 50,
          newestFirst: true,
        });
        const events = Array.isArray(probe?.events) ? probe.events : [];
        const count = num(probe?.count, events.length);
        const fresh = events.some((ev) => {
          const srv = Date.parse(ev.server_received_at || "");
          return Number.isFinite(srv) && srv > t0;
        });
        if (fresh || count > baselineCount) {
          clearFlushTimer();
          state.flushing = false;
          $("logs-flush-btn")?.removeAttribute("disabled");
          state.date = waitDate;
          syncLabels();
          renderCalendar();
          setStatus("Device upload detected — refreshing full day…", "ok");
          await loadDays();
          await fetchEvents();
          return;
        }
      } catch (err) {
        console.warn("flush poll failed", err);
      }
      if (elapsed >= FLUSH_WAIT_MS) {
        clearFlushTimer();
        state.flushing = false;
        $("logs-flush-btn")?.removeAttribute("disabled");
        setStatus(
          "No upload (device offline or empty). You can still Generate from whatever is already stored for the selected day.",
          "warn"
        );
        state.date = state.date || waitDate;
        await fetchEvents();
      }
    }, FLUSH_POLL_MS);

    // silence unused
    void t0Iso;
  }

  async function generateExcel() {
    if (!state.model || !state.model.summary.totalEvents) {
      setStatus("Nothing to generate — load a day with events first.", "warn");
      return;
    }
    try {
      setStatus("Building Excel report…", "info");
      const { buffer, filename, byteLength } = await global.VetDiagLogExcel.exportDiagWorkbook(state.model, {
        deviceId: deviceId(),
        date: state.date || state.model.summary.date,
        from: state.from,
        to: state.to,
        chunks: state.eventsPayload?.chunks,
      });
      global.VetDiagLogExcel.downloadBuffer(buffer, filename);
      writeHistory({
        when: new Date().toLocaleString(),
        device: deviceId(),
        range: state.from || state.to
          ? `${state.date} ${state.from || "…"}–${state.to || "…"}`
          : state.date,
        events: state.model.summary.totalEvents,
        filename,
        size: byteLength,
      });
      setStatus(`Downloaded ${filename} · ${state.model.summary.totalEvents} event(s)`, "ok");
    } catch (err) {
      setStatus(`Excel failed: ${err.message || err}`, "error");
    }
  }

  let calYear = null;
  let calMonth = null;

  function renderCalendar() {
    const grid = $("logs-cal-grid");
    const title = $("logs-cal-title");
    if (!grid) return;
    const selected = state.date || todayUtc();
    if (calYear == null || calMonth == null) {
      const [y, m] = selected.split("-").map(Number);
      calYear = y;
      calMonth = m - 1;
    }
    if (title) {
      title.textContent = new Intl.DateTimeFormat("en-GB", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(calYear, calMonth, 1)));
    }
    const firstDow = new Date(Date.UTC(calYear, calMonth, 1)).getUTCDay();
    const startDow = firstDow === 0 ? 6 : firstDow - 1;
    const daysInMonth = new Date(Date.UTC(calYear, calMonth + 1, 0)).getUTCDate();
    const today = todayUtc();
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push('<span class="dash-cal-day is-empty"></span>');
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const has = state.daysWithData.has(iso);
      const classes = ["dash-cal-day"];
      if (iso === selected) classes.push("is-selected");
      if (iso === today) classes.push("is-today");
      if (!has && state.daysCount > 0) classes.push("is-disabled");
      if (has) classes.push("has-data");
      cells.push(
        `<button type="button" class="${classes.join(" ")}" data-date="${iso}" ${
          !has && state.daysCount > 0 ? "disabled" : ""
        }>${day}</button>`
      );
    }
    grid.innerHTML = cells.join("");
  }

  function bindUi() {
    $("logs-load-btn")?.addEventListener("click", () => fetchEvents());
    $("logs-flush-btn")?.addEventListener("click", () => runFlushWait());
    $("logs-generate-btn")?.addEventListener("click", () => generateExcel());

    document.querySelectorAll("[data-logs-chip]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.chip = btn.getAttribute("data-logs-chip") || "all";
        document.querySelectorAll("[data-logs-chip]").forEach((b) => {
          b.classList.toggle("is-active", b === btn);
        });
        renderPreview();
      });
    });

    $("logs-from-time")?.addEventListener("change", (e) => {
      state.from = e.target.value || "";
    });
    $("logs-to-time")?.addEventListener("change", (e) => {
      state.to = e.target.value || "";
    });

    $("logs-date-trigger")?.addEventListener("click", () => {
      const panel = $("logs-date-panel");
      const open = panel && !panel.hidden;
      if (panel) panel.hidden = !!open;
      $("logs-date-trigger")?.setAttribute("aria-expanded", open ? "false" : "true");
      if (!open) renderCalendar();
    });

    $("logs-cal-prev")?.addEventListener("click", () => {
      calMonth -= 1;
      if (calMonth < 0) {
        calMonth = 11;
        calYear -= 1;
      }
      renderCalendar();
    });
    $("logs-cal-next")?.addEventListener("click", () => {
      calMonth += 1;
      if (calMonth > 11) {
        calMonth = 0;
        calYear += 1;
      }
      renderCalendar();
    });
    $("logs-cal-today")?.addEventListener("click", () => {
      state.date = todayUtc();
      const [y, m] = state.date.split("-").map(Number);
      calYear = y;
      calMonth = m - 1;
      syncLabels();
      renderCalendar();
      $("logs-date-panel").hidden = true;
      fetchEvents();
    });
    $("logs-cal-grid")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-date]");
      if (!btn || btn.disabled) return;
      state.date = btn.getAttribute("data-date");
      syncLabels();
      renderCalendar();
      $("logs-date-panel").hidden = true;
      fetchEvents();
    });

    document.addEventListener("click", (e) => {
      const dd = $("logs-dd-date");
      if (!dd) return;
      if (!dd.contains(e.target)) {
        const panel = $("logs-date-panel");
        if (panel) panel.hidden = true;
        $("logs-date-trigger")?.setAttribute("aria-expanded", "false");
      }
    });
  }

  async function onShow() {
    if (!state.date) state.date = todayUtc();
    syncLabels();
    renderHistory();
    renderPreview();
    bindUiOnce();
    await loadDays();
    await fetchEvents({ quiet: true });
  }

  let bound = false;
  function bindUiOnce() {
    if (bound) return;
    bound = true;
    bindUi();
  }

  global.VetLogsPage = {
    onShow,
  };
})(window);
