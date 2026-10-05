/**
 * Device diagnostic Logs page — flush, fetch, preview, Excel (Story / All / Faults).
 * Loads only when user presses Load. Date + From/To (IST) are required.
 */
(function (global) {
  const HISTORY_KEY = "vet_diag_log_download_history";
  const FLUSH_POLL_MS = 5000;
  const FLUSH_WAIT_MS = 120000;
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  const CHUNK_LIMIT = 2000;
  const MAX_CHUNKS = 50;

  const state = {
    date: null, // IST YYYY-MM-DD
    from: "", // IST HH:MM[:SS]
    to: "",
    chip: "all",
    daysWithData: new Set(), // IST dates that overlap server UTC days with logs
    daysCount: 0,
    eventsPayload: null,
    model: null,
    loading: false,
    flushing: false,
    flushTimer: null,
    fetchToken: 0,
  };

  const istDateFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const displayFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const monthTitleFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    month: "long",
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

  function todayIst() {
    return istDateFmt.format(new Date());
  }

  function formatDateLabel(iso) {
    if (!iso) return "—";
    try {
      return `${displayFmt.format(new Date(`${iso}T12:00:00+05:30`))} IST`;
    } catch {
      return `${iso} IST`;
    }
  }

  function normalizeTimeInput(raw) {
    const t = String(raw || "").trim();
    if (!t) return "";
    if (/^\d{2}:\d{2}:\d{2}$/.test(t)) return t;
    if (/^\d{2}:\d{2}$/.test(t)) return `${t}:00`;
    return "";
  }

  function timeToSeconds(t) {
    const n = normalizeTimeInput(t);
    if (!n) return NaN;
    const [h, m, s] = n.split(":").map(Number);
    return h * 3600 + m * 60 + s;
  }

  /** IST calendar date + time → UTC ISO string. */
  function istDateTimeToUtcIso(dateIso, timeText) {
    const time = normalizeTimeInput(timeText);
    const dm = String(dateIso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const tm = time.match(/^(\d{2}):(\d{2}):(\d{2})$/);
    if (!dm || !tm) return null;
    const y = Number(dm[1]);
    const mo = Number(dm[2]);
    const d = Number(dm[3]);
    const hh = Number(tm[1]);
    const mm = Number(tm[2]);
    const ss = Number(tm[3]);
    const utcMs = Date.UTC(y, mo - 1, d, hh, mm, ss) - IST_OFFSET_MS;
    return new Date(utcMs).toISOString();
  }

  function utcIsoToDate(iso) {
    return istDateFmt.format(new Date(iso));
  }

  function addDaysIso(iso, delta) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + delta));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
      dt.getUTCDate()
    ).padStart(2, "0")}`;
  }

  /** Map server UTC days → IST calendar days that may contain those events. */
  function utcDaysToIstSet(utcDays) {
    const out = new Set();
    (utcDays || []).forEach((utcDay) => {
      const startUtc = `${utcDay}T00:00:00.000Z`;
      const endUtc = `${utcDay}T23:59:59.999Z`;
      out.add(utcIsoToDate(startUtc));
      out.add(utcIsoToDate(endUtc));
    });
    return out;
  }

  function readTimeInputs() {
    state.from = normalizeTimeInput($("logs-from-time")?.value || "");
    state.to = normalizeTimeInput($("logs-to-time")?.value || "");
  }

  function validateSelection() {
    readTimeInputs();
    if (!state.date) return "Select an IST date.";
    if (!state.from || !state.to) return "From and To times (IST) are required.";
    if (!(timeToSeconds(state.from) < timeToSeconds(state.to))) {
      return "From time must be earlier than To time (IST).";
    }
    const fromIso = istDateTimeToUtcIso(state.date, state.from);
    const toIso = istDateTimeToUtcIso(state.date, state.to);
    if (!fromIso || !toIso) return "Invalid date/time.";
    return null;
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
    if (dateLabel) dateLabel.textContent = state.date ? formatDateLabel(state.date) : "Select date (IST)";
    const daysBadge = $("logs-days-badge");
    if (daysBadge) {
      daysBadge.textContent = state.daysCount
        ? `${state.daysWithData.size} IST day(s) with logs`
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
        listEl.innerHTML =
          '<li class="logs-preview-empty">Select IST date + From/To times, then press Load events.</li>';
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
          "Many events have unsynced device time (U). Device times may be boot-relative / approximate. Prefer Server received (IST) when unsure.";
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

  function num(v, fb = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  }

  async function loadDays() {
    try {
      const client = getClient();
      const resp = await client.diagEventDays(deviceId(), { limit: 60 });
      const utcDays = Array.isArray(resp?.days) ? resp.days.map(String) : [];
      state.daysWithData = utcDaysToIstSet(utcDays);
      state.daysCount = num(resp?.count, utcDays.length);
      syncLabels();
      renderCalendar();
    } catch (err) {
      console.warn("diag days failed", err);
      state.daysWithData = new Set();
      state.daysCount = 0;
      syncLabels();
    }
  }

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

  function isoMinusOneMicro(iso) {
    const raw = String(iso || "").trim();
    if (!raw) return null;
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms)) return raw;
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

  async function fetchAllDiagEventsForUtcDay(client, { deviceId: id, date, fromIso, toIso, onProgress, chunkBase }) {
    const all = [];
    const seen = new Set();
    let pageTo = toIso || undefined;
    let chunks = 0;
    let lastPayload = null;

    while (chunks < MAX_CHUNKS) {
      chunks += 1;
      onProgress?.((chunkBase || 0) + chunks, all.length);
      const payload = await client.diagEvents({
        deviceId: id,
        date,
        from: fromIso || undefined,
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
        const srv = Date.parse(ev.server_received_at || "");
        if (fromIso && Number.isFinite(srv) && srv < Date.parse(fromIso)) return;
        if (toIso && Number.isFinite(srv) && srv > Date.parse(toIso)) return;
        seen.add(key);
        all.push(ev);
      });

      if (count < CHUNK_LIMIT || batch.length === 0) break;
      const oldest = oldestServerReceivedAt(batch);
      if (!oldest) break;
      const nextTo = isoMinusOneMicro(oldest);
      if (!nextTo || nextTo === pageTo) break;
      if (fromIso) {
        const nextMs = Date.parse(nextTo);
        const fromMs = Date.parse(fromIso);
        if (Number.isFinite(fromMs) && Number.isFinite(nextMs) && nextMs < fromMs) break;
      }
      pageTo = nextTo;
    }

    return {
      events: all,
      chunks,
      capped: chunks >= MAX_CHUNKS,
      lastPayload,
    };
  }

  /** IST window may span 1–2 UTC days — fetch each and merge. */
  async function fetchAllDiagEventsIstWindow(client, { deviceId: id, istDate, fromTime, toTime, onProgress }) {
    const fromIso = istDateTimeToUtcIso(istDate, fromTime);
    const toIso = istDateTimeToUtcIso(istDate, toTime);

    // API `date` is UTC day of server_received_at.
    const fromUtcDay = new Date(fromIso).toISOString().slice(0, 10);
    const toUtcDay = new Date(toIso).toISOString().slice(0, 10);
    const days = [];
    let cursor = fromUtcDay;
    days.push(cursor);
    while (cursor < toUtcDay) {
      cursor = addDaysIso(cursor, 1);
      days.push(cursor);
    }

    const all = [];
    const seen = new Set();
    let chunks = 0;
    let capped = false;
    let lastPayload = null;

    for (const day of days) {
      const dayStart = `${day}T00:00:00.000Z`;
      const dayEnd = `${day}T23:59:59.999Z`;
      const winFrom = Date.parse(fromIso) > Date.parse(dayStart) ? fromIso : dayStart;
      const winTo = Date.parse(toIso) < Date.parse(dayEnd) ? toIso : dayEnd;
      const part = await fetchAllDiagEventsForUtcDay(client, {
        deviceId: id,
        date: day,
        fromIso: winFrom,
        toIso: winTo,
        onProgress,
        chunkBase: chunks,
      });
      chunks += part.chunks;
      if (part.capped) capped = true;
      lastPayload = part.lastPayload || lastPayload;
      part.events.forEach((ev) => {
        const key = eventKey(ev);
        if (seen.has(key)) return;
        seen.add(key);
        all.push(ev);
      });
    }

    return {
      device_id: lastPayload?.device_id || id,
      day: istDate,
      from: fromIso,
      to: toIso,
      count: all.length,
      chunks,
      capped,
      events: all,
      ist_from: `${istDate} ${normalizeTimeInput(fromTime)} IST`,
      ist_to: `${istDate} ${normalizeTimeInput(toTime)} IST`,
    };
  }

  async function fetchEvents(opts = {}) {
    if (!opts.userClicked) {
      console.warn("fetchEvents blocked — only Load events button may fetch");
      return;
    }

    const errMsg = validateSelection();
    if (errMsg) {
      setStatus(errMsg, "warn");
      setGenerateEnabled(false);
      return;
    }

    const token = ++state.fetchToken;
    state.loading = true;
    setStatus("Loading diagnostic events (IST window, chunked)…", "info");
    setGenerateEnabled(false);
    try {
      const client = getClient();
      const payload = await fetchAllDiagEventsIstWindow(client, {
        deviceId: deviceId(),
        istDate: state.date,
        fromTime: state.from,
        toTime: state.to,
        onProgress: (chunk, soFar) => {
          if (token !== state.fetchToken) return;
          setStatus(`Loading events… chunk ${chunk} · ${soFar} so far`, "info");
        },
      });
      if (token !== state.fetchToken) return;
      state.eventsPayload = payload;
      state.model = global.VetDiagLogDecode.buildReportModel(payload, {
        deviceId: deviceId(),
        date: state.date,
      });
      renderPreview();
      const n = state.model.summary.totalEvents;
      const chunkNote = payload.chunks > 1 ? ` · ${payload.chunks} chunk(s)` : "";
      const capNote = payload.capped ? " · hit safety cap, may be incomplete" : "";
      setStatus(
        n
          ? `Loaded ${n} event(s) · ${payload.ist_from} → ${payload.ist_to}${chunkNote}${capNote} · ${state.model.summary.faultCount} fault(s).`
          : `No events in ${payload.ist_from} → ${payload.ist_to}. Try Flush, then Load again.`,
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

    const waitDate = new Date().toISOString().slice(0, 10); // UTC day for server storage
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
          await loadDays();
          setStatus("Device upload detected. Set IST date + From/To, then press Load events.", "ok");
          setGenerateEnabled(!!state.model?.summary?.totalEvents);
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
          "No upload (device offline or empty). You can still Load with date + From/To if data was already stored.",
          "warn"
        );
        setGenerateEnabled(!!state.model?.summary?.totalEvents);
      }
    }, FLUSH_POLL_MS);
  }

  async function generateExcel() {
    if (!state.model || !state.model.summary.totalEvents) {
      setStatus("Nothing to generate — Load events first (date + From/To required).", "warn");
      return;
    }
    try {
      setStatus("Building Excel report…", "info");
      const { buffer, filename, byteLength } = await global.VetDiagLogExcel.exportDiagWorkbook(state.model, {
        deviceId: deviceId(),
        date: state.date || state.model.summary.date,
        from: state.eventsPayload?.ist_from || state.from,
        to: state.eventsPayload?.ist_to || state.to,
        chunks: state.eventsPayload?.chunks,
      });
      global.VetDiagLogExcel.downloadBuffer(buffer, filename);
      writeHistory({
        when: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        device: deviceId(),
        range: `${state.date} ${state.from}–${state.to} IST`,
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
    const selected = state.date || todayIst();
    if (calYear == null || calMonth == null) {
      const [y, m] = selected.split("-").map(Number);
      calYear = y;
      calMonth = m - 1;
    }
    if (title) {
      title.textContent = monthTitleFmt.format(new Date(Date.UTC(calYear, calMonth, 15)));
    }
    // Build grid in plain calendar months (IST date numbers = civil calendar)
    const first = new Date(calYear, calMonth, 1);
    let startDow = first.getDay();
    startDow = startDow === 0 ? 6 : startDow - 1;
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const today = todayIst();
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
    $("logs-load-btn")?.addEventListener("click", () => fetchEvents({ userClicked: true }));
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
      state.from = normalizeTimeInput(e.target.value || "");
      state.model = null;
      state.eventsPayload = null;
      renderPreview();
    });
    $("logs-to-time")?.addEventListener("change", (e) => {
      state.to = normalizeTimeInput(e.target.value || "");
      state.model = null;
      state.eventsPayload = null;
      renderPreview();
    });

    $("logs-date-trigger")?.addEventListener("click", () => {
      const panel = $("logs-date-panel");
      const open = panel && !panel.hidden;
      if (panel) panel.hidden = !!open;
      $("logs-date-trigger")?.setAttribute("aria-expanded", open ? "false" : "true");
      if (!open) {
        renderCalendar();
        // Lazy-load which days have data only when opening calendar
        if (!state.daysCount) loadDays();
      }
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
      state.date = todayIst();
      const [y, m] = state.date.split("-").map(Number);
      calYear = y;
      calMonth = m - 1;
      state.model = null;
      state.eventsPayload = null;
      syncLabels();
      renderCalendar();
      renderPreview();
      $("logs-date-panel").hidden = true;
      setStatus("Date set to today (IST). Set From/To times, then press Load events.", "info");
    });
    $("logs-cal-grid")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-date]");
      if (!btn || btn.disabled) return;
      state.date = btn.getAttribute("data-date");
      state.model = null;
      state.eventsPayload = null;
      syncLabels();
      renderCalendar();
      renderPreview();
      $("logs-date-panel").hidden = true;
      setStatus(`Date set to ${formatDateLabel(state.date)}. Set From/To times, then press Load events.`, "info");
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
    // Never auto-fetch events. Clear previous results so page looks idle.
    state.fetchToken += 1; // cancel in-flight loads
    state.loading = false;
    state.model = null;
    state.eventsPayload = null;
    if (!state.date) state.date = null;
    if ($("logs-from-time")) $("logs-from-time").value = state.from || "";
    if ($("logs-to-time")) $("logs-to-time").value = state.to || "";
    syncLabels();
    renderHistory();
    renderPreview();
    bindUiOnce();
    setStatus("Select IST date + From/To times, then press Load events. Nothing loads until then.", "info");
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
