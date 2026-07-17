/**
 * In-app pages: animals by category, today's vitals, animal temperature history.
 * Hash routes: #/  #/animals  #/vitals-today  #/animal/:id
 */
(function (global) {
  const VIEW_IDS = {
    dashboard: "view-dashboard",
    animals: "view-animals",
    "vitals-today": "view-vitals-today",
    history: "view-animal-history",
    reports: "view-reports",
  };

  const istDateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const istDateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getSelectedDate() {
    return global.VetDashboardFilters?.getDate?.() || istDateFormatter.format(new Date());
  }

  function parseHash() {
    const raw = (location.hash || "#/").replace(/^#/, "") || "/";
    const parts = raw.split("/").filter(Boolean);
    if (!parts.length) return { name: "dashboard", petId: null };
    if (parts[0] === "animals") return { name: "animals", petId: null };
    if (parts[0] === "vitals-today") return { name: "vitals-today", petId: null };
    if (parts[0] === "reports") return { name: "reports", petId: null };
    if (parts[0] === "animal" && parts[1]) {
      return { name: "history", petId: decodeURIComponent(parts[1]) };
    }
    return { name: "dashboard", petId: null };
  }

  function navigate(path) {
    const next = path.startsWith("#") ? path : `#${path.startsWith("/") ? path : `/${path}`}`;
    if (location.hash === next) {
      route();
      return;
    }
    location.hash = next;
  }

  function setHeader(title, subtitle, showBack) {
    const titleEl = document.getElementById("page-title");
    const subEl = document.getElementById("page-subtitle");
    const backBtn = document.getElementById("page-back-btn");
    if (titleEl) titleEl.textContent = title;
    if (subEl) subEl.textContent = subtitle || "";
    if (backBtn) backBtn.hidden = !showBack;
  }

  function showView(name) {
    Object.entries(VIEW_IDS).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.hidden = key !== name;
    });

    document.querySelectorAll(".nav-item[data-nav]").forEach((item) => {
      const nav = item.getAttribute("data-nav");
      const active =
        (name === "dashboard" && nav === "dashboard") ||
        (name === "animals" && nav === "animals") ||
        (name === "history" && nav === "animals") ||
        (name === "vitals-today" && nav === "vitals-today") ||
        (name === "reports" && nav === "reports");
      item.classList.toggle("active", active);
    });
  }

  function petIdOf(pet) {
    return String(pet?.pet_id || pet?.id || "").trim();
  }

  function petNameOf(pet) {
    return String(pet?.pet_name || pet?.name || "Unknown").trim() || "Unknown";
  }

  function speciesOf(pet) {
    return String(pet?.species || pet?.pet_species || pet?.category || "Uncategorized").trim() || "Uncategorized";
  }

  function breedOf(pet) {
    return String(pet?.breed || pet?.pet_breed || "—").trim() || "—";
  }

  function parseTimestamp(raw) {
    const text = String(raw ?? "").trim();
    if (!text) return null;
    const normalized = text.replace("Z", "+00:00");
    if (/[+-]\d{2}:\d{2}$/.test(normalized)) {
      const d = new Date(normalized);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(`${normalized}+05:30`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function roundTempC(c) {
    const n = Number(c);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.trunc(n * 10 + 0.5) / 10;
  }

  function readingTemp(r) {
    const n = Number(r?.temperature_value ?? r?.temperature ?? r?.temp ?? r?.value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function readingSensor(r) {
    return String(r?.sensor_type || r?.type || r?.sensor || "—");
  }

  async function ensureClient() {
    if (global.VetLiveApi?.ensureClient) return global.VetLiveApi.ensureClient();
    const session = global.VetAuth?.getSession?.() || {};
    const cfg = {
      baseUrl: global.API_CONFIG?.baseUrl,
      deviceId: session.deviceId || "ARMY",
      timeoutMs: global.API_CONFIG?.timeoutMs || 25000,
    };
    const client = new global.VetApiClient(cfg);
    if (session.password) await client.login(cfg.deviceId, session.password);
    return client;
  }

  async function loadAllPets(client) {
    const cached = global.VetLiveApi?.getPets?.();
    if (Array.isArray(cached) && cached.length) return cached;
    const raw = await client.listPets();
    return global.VetApiNormalize.normalizePets(raw);
  }

  async function renderAnimalsPage() {
    const root = document.getElementById("animals-category-root");
    if (!root) return;
    root.innerHTML = `<p class="empty-state">Loading animals…</p>`;

    try {
      const client = await ensureClient();
      const pets = await loadAllPets(client);
      if (!pets.length) {
        root.innerHTML = `<p class="empty-state">No animals found for this device.</p>`;
        return;
      }

      const groups = {};
      pets.forEach((pet) => {
        const cat = speciesOf(pet);
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(pet);
      });

      const categories = Object.keys(groups).sort((a, b) => a.localeCompare(b));
      root.innerHTML = categories
        .map((cat) => {
          const list = groups[cat].slice().sort((a, b) => petNameOf(a).localeCompare(petNameOf(b)));
          const rows = list
            .map((pet) => {
              const id = petIdOf(pet);
              return `
                <button type="button" class="animal-list-row" data-pet-id="${escapeHtml(id)}">
                  <span class="animal-list-name">${escapeHtml(petNameOf(pet))}</span>
                  <span class="animal-list-meta">Breed: ${escapeHtml(breedOf(pet))} · ID: ${escapeHtml(id.slice(0, 10))}…</span>
                </button>`;
            })
            .join("");
          return `
            <section class="category-block">
              <div class="category-block-header">
                <h3 class="category-block-title">${escapeHtml(cat)}</h3>
                <span class="category-block-count">${list.length}</span>
              </div>
              <div class="animal-list">${rows}</div>
            </section>`;
        })
        .join("");
    } catch (err) {
      root.innerHTML = `<p class="empty-state">Failed to load animals: ${escapeHtml(err.message || err)}</p>`;
    }
  }

  async function renderVitalsTodayPage() {
    const root = document.getElementById("vitals-today-root");
    const sub = document.getElementById("vitals-today-subtitle");
    const date = getSelectedDate();
    if (sub) sub.textContent = `Animals with vitals on ${date}. Select one for temperature history.`;
    if (!root) return;
    root.innerHTML = `<p class="empty-state">Loading today’s animals…</p>`;

    try {
      const client = await ensureClient();
      const allPets = await loadAllPets(client);
      const resolved = global.VetLiveApi?.resolvePetsForDate
        ? await global.VetLiveApi.resolvePetsForDate(client, date, allPets)
        : { list: (await client.dailyPets(date))?.pets || [], source: "daily-pets" };
      const pets = resolved.list || [];
      if (!pets.length) {
        const hint =
          resolved.source === "none"
            ? " No exam sessions were recorded on this date — try 2026-07-02 or 2026-07-03 for recent data."
            : "";
        root.innerHTML = `<p class="empty-state">No animals with vitals on ${escapeHtml(date)}.${hint}</p>`;
        return;
      }

      const rows = pets
        .slice()
        .sort((a, b) => petNameOf(a).localeCompare(petNameOf(b)))
        .map((pet) => {
          const id = petIdOf(pet);
          return `
            <button type="button" class="animal-list-row" data-pet-id="${escapeHtml(id)}">
              <span class="animal-list-name">${escapeHtml(petNameOf(pet))}</span>
              <span class="animal-list-meta">${escapeHtml(speciesOf(pet))} · ${escapeHtml(breedOf(pet))} · ID: ${escapeHtml(id.slice(0, 10))}…</span>
            </button>`;
        })
        .join("");

      root.innerHTML = `
        <div class="animal-list-summary">${pets.length} animal${pets.length === 1 ? "" : "s"} checked</div>
        <div class="animal-list">${rows}</div>`;
    } catch (err) {
      root.innerHTML = `<p class="empty-state">Failed to load vitals: ${escapeHtml(err.message || err)}</p>`;
    }
  }

  function statusFromTemp(temp) {
    if (temp == null) return { label: "—", cls: "stable" };
    if (temp > 38.6) return { label: "Critical", cls: "critical" };
    if (temp < 37.2) return { label: "Low", cls: "low" };
    return { label: "Stable", cls: "stable" };
  }

  function sensorKeyOfSummary(row) {
    return String(row?.sensor_type || row?.type || row?.sensor || "").trim().toLowerCase();
  }

  function summaryRecordedAt(row) {
    return row?.recorded_at || row?.created_at || row?.timestamp || "";
  }

  function pickSummary(summaries, examSessionId, { want } = {}) {
    const sid = String(examSessionId || "").trim();
    if (!sid) return null;
    const list = Array.isArray(summaries) ? summaries : [];
    const filtered = list.filter((r) => String(r?.exam_session_id || r?.examSessionId || "") === sid);
    const wanted = want
      ? filtered.filter((r) => (want === "ir" ? /ir|mlx|90614|90632/.test(sensorKeyOfSummary(r)) : /tmp|rectal/.test(sensorKeyOfSummary(r))))
      : filtered;
    if (!wanted.length) return null;
    wanted.sort((a, b) => (parseTimestamp(summaryRecordedAt(b))?.getTime?.() || 0) - (parseTimestamp(summaryRecordedAt(a))?.getTime?.() || 0));
    return wanted[0] || null;
  }

  function normNum(n) {
    const x = Number(String(n ?? "").replace(/f$/i, ""));
    return Number.isFinite(x) ? x : null;
  }

  function fmtC(v) {
    const n = normNum(v);
    if (n == null || n <= 0) return "—";
    return `${n.toFixed(2)}°C`;
  }

  function fmtMaybe(v) {
    const n = normNum(v);
    if (n == null) return "—";
    return n.toFixed(2);
  }

  function summaryTriple(row, prefix) {
    return [1, 2, 3].map((i) => normNum(row?.[`${prefix}${i}`]) || 0);
  }

  async function renderAnimalHistory(petId) {
    const root = document.getElementById("animal-history-root");
    const nameEl = document.getElementById("history-animal-name");
    const metaEl = document.getElementById("history-animal-meta");
    if (!root) return;
    root.innerHTML = `<p class="empty-state">Loading temperature history…</p>`;
    if (nameEl) nameEl.textContent = "Loading…";
    if (metaEl) metaEl.textContent = `ID: ${petId}`;

    try {
      const client = await ensureClient();
      let petName = "Animal";
      let species = "";
      let breed = "";

      try {
        const detail = await client.petDetailWithContext(petId, {
          deviceId: client.deviceId,
          baseUrl: client.baseUrl,
        });
        petName = petNameOf(detail);
        species = speciesOf(detail);
        breed = breedOf(detail);
      } catch {
        const pets = await loadAllPets(client);
        const found = pets.find((p) => petIdOf(p) === String(petId));
        if (found) {
          petName = petNameOf(found);
          species = speciesOf(found);
          breed = breedOf(found);
        }
      }

      if (nameEl) nameEl.textContent = petName;
      if (metaEl) {
        metaEl.textContent = [species, breed ? `Breed: ${breed}` : "", `ID: ${petId}`]
          .filter(Boolean)
          .join(" · ");
      }

      const sessionsResponse = await client.examSessions(petId);
      const sessions = global.VetApiNormalize.normalizeSessions(sessionsResponse);
      const petSummaryResp = await client.petTemperatureSummary(petId).catch(() => null);
      const summaries = Array.isArray(petSummaryResp) ? petSummaryResp : petSummaryResp?.summaries || petSummaryResp?.temperature_summaries || petSummaryResp?.data || petSummaryResp?.results || [];
      const summaryList = Array.isArray(summaries) ? summaries.filter((x) => x && typeof x === "object") : [];

      const sessionIds = sessions
        .map((s) => String(s?.id || s?.exam_session_id || "").trim())
        .filter(Boolean);
      const uniqSessionIds = Array.from(new Set(sessionIds));

      const cards = [];
      for (const sid of uniqSessionIds) {
        const sObj = sessions.find((s) => String(s?.id || s?.exam_session_id || "").trim() === sid) || {};
        const started = parseTimestamp(sObj.started_at || sObj.created_at);
        const whenLabel = started ? istDateTimeFormatter.format(started) : "—";

        const ir = pickSummary(summaryList, sid, { want: "ir" });
        const rect = pickSummary(summaryList, sid, { want: "rectal" });
        const best = ir || rect;
        const recorded = best ? parseTimestamp(summaryRecordedAt(best)) : null;

        const irBody = normNum(ir?.t1) || normNum(ir?.t2) || normNum(ir?.t3) || null;
        const rectT = normNum(rect?.t1) || normNum(rect?.t2) || normNum(rect?.t3) || null;
        const displayTemp = rectT != null ? rectT : irBody;
        const st = statusFromTemp(displayTemp);

        const refs = best ? summaryTriple(best, "ref") : [0, 0, 0];
        const refMax = Math.max(...refs);

        cards.push({
          sid,
          whenSort: recorded?.getTime?.() || started?.getTime?.() || 0,
          whenLabel,
          recordedLabel: recorded ? istDateTimeFormatter.format(recorded) : "—",
          statusLabel: st.label,
          statusClass: st.cls,
          ir,
          rect,
          displayTemp,
          refMax,
        });
      }

      // Also show summaries that have no matching session object
      const known = new Set(uniqSessionIds);
      const orphan = summaryList
        .map((r) => String(r?.exam_session_id || r?.examSessionId || "").trim())
        .filter((sid) => sid && !known.has(sid));
      Array.from(new Set(orphan)).forEach((sid) => {
        const ir = pickSummary(summaryList, sid, { want: "ir" });
        const rect = pickSummary(summaryList, sid, { want: "rectal" });
        const best = ir || rect;
        const recorded = best ? parseTimestamp(summaryRecordedAt(best)) : null;
        const irBody = normNum(ir?.t1) || normNum(ir?.t2) || normNum(ir?.t3) || null;
        const rectT = normNum(rect?.t1) || normNum(rect?.t2) || normNum(rect?.t3) || null;
        const displayTemp = rectT != null ? rectT : irBody;
        const st = statusFromTemp(displayTemp);
        const refs = best ? summaryTriple(best, "ref") : [0, 0, 0];
        const refMax = Math.max(...refs);
        cards.push({
          sid,
          whenSort: recorded?.getTime?.() || 0,
          whenLabel: "—",
          recordedLabel: recorded ? istDateTimeFormatter.format(recorded) : "—",
          statusLabel: st.label,
          statusClass: st.cls,
          ir,
          rect,
          displayTemp,
          refMax,
        });
      });

      cards.sort((a, b) => b.whenSort - a.whenSort);

      if (!cards.length) {
        root.innerHTML = `<p class="empty-state">No temperature summaries found for this animal.</p>`;
        return;
      }

      root.innerHTML = `
        <div class="rounds-table-scroller history-table-wrap">
          <table class="rounds-log-table">
            <thead>
              <tr>
                <th>Session Start (IST)</th>
                <th>Summary Recorded (IST)</th>
                <th>IR (t1/t2/t3)</th>
                <th>Rectal (t1/t2/t3)</th>
                <th>Ref max</th>
                <th>Mean / Max / SD</th>
                <th>Notes</th>
                <th>Exam session</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${cards
                .map((row) => {
                  const irT = row.ir ? [row.ir.t1, row.ir.t2, row.ir.t3].map(fmtC).join(" · ") : "—";
                  const rectT = row.rect ? [row.rect.t1, row.rect.t2, row.rect.t3].map(fmtC).join(" · ") : "—";
                  const best = row.ir || row.rect || {};
                  const stats = [fmtMaybe(best.mean), fmtMaybe(best.max), fmtMaybe(best.sd)].join(" / ");
                  const note = String(best.notes || "").trim() || "—";
                  return `
                <tr>
                  <td class="time-col-text">${escapeHtml(row.whenLabel)}</td>
                  <td class="time-col-text">${escapeHtml(row.recordedLabel)}</td>
                  <td>${escapeHtml(irT)}</td>
                  <td>${escapeHtml(rectT)}</td>
                  <td class="vitals-text-bold">${row.refMax > 0 ? `${row.refMax.toFixed(2)}°C` : "—"}</td>
                  <td>${escapeHtml(stats)}</td>
                  <td class="animal-id-sub">${escapeHtml(note)}</td>
                  <td class="animal-id-sub">${escapeHtml(String(row.sid).slice(0, 12))}</td>
                  <td><span class="badge-status ${row.statusClass}">${escapeHtml(row.statusLabel)}</span></td>
                </tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>`;
    } catch (err) {
      root.innerHTML = `<p class="empty-state">Failed to load history: ${escapeHtml(err.message || err)}</p>`;
    }
  }

  async function route() {
    if (!global.VetAuth?.isLoggedIn?.()) return;
    const { name, petId } = parseHash();

    if (name === "animals") {
      showView("animals");
      setHeader("All Animals", "Browse animals category-wise and open temperature history.", true);
      document.body.classList.remove("reports-mode");
      global.VetDashboardFilters?.showBar?.(false);
      await renderAnimalsPage();
      return;
    }

    if (name === "vitals-today") {
      showView("vitals-today");
      setHeader("Vitals Checked Today", "Animals taken on the selected date.", true);
      document.body.classList.remove("reports-mode");
      global.VetDashboardFilters?.showBar?.(false);
      await renderVitalsTodayPage();
      return;
    }

    if (name === "history" && petId) {
      showView("history");
      setHeader("Temperature History", "DynamoDB session summaries (IR, rectal, ref, stats) for this animal.", true);
      document.body.classList.remove("reports-mode");
      global.VetDashboardFilters?.showBar?.(false);
      await renderAnimalHistory(petId);
      return;
    }

    if (name === "reports") {
      showView("reports");
      setHeader("Reports", "Download clinical validation data", false);
      document.body.classList.add("reports-mode");
      global.VetDashboardFilters?.showBar?.(false);
      global.VetReportsPage?.onShow?.();
      return;
    }

    document.body.classList.remove("reports-mode");
    global.VetDashboardFilters?.showBar?.(name === "dashboard");
    showView("dashboard");
    setHeader(
      "Clinical Validation Dashboard",
      "Real-time overview of ExamD clinical validation study.",
      false
    );
  }

  function bindUi() {
    document.getElementById("kpi-card-total-animals")?.addEventListener("click", () => {
      navigate("/animals");
    });
    document.getElementById("kpi-card-vitals-today")?.addEventListener("click", () => {
      navigate("/vitals-today");
    });
    document.getElementById("page-back-btn")?.addEventListener("click", () => {
      if (window.history.length > 1) history.back();
      else navigate("/");
    });

    document.getElementById("animals-category-root")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-pet-id]");
      if (!btn) return;
      navigate(`/animal/${encodeURIComponent(btn.getAttribute("data-pet-id"))}`);
    });

    document.getElementById("vitals-today-root")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-pet-id]");
      if (!btn) return;
      navigate(`/animal/${encodeURIComponent(btn.getAttribute("data-pet-id"))}`);
    });

    document.getElementById("cv-box-tested")?.addEventListener("click", () => {
      navigate("/vitals-today");
    });

    window.addEventListener("vet:dashboard-filters-changed", () => {
      const { name } = parseHash();
      if (name === "vitals-today") renderVitalsTodayPage();
    });

    window.addEventListener("hashchange", () => {
      route();
    });
  }

  function init() {
    bindUi();
    if (global.VetAuth?.isLoggedIn?.()) route();
  }

  document.addEventListener("DOMContentLoaded", init);
  window.addEventListener("dashboard:ready", () => {
    if (global.VetAuth?.isLoggedIn?.()) route();
  });

  global.VetAppPages = {
    navigate,
    route,
    openAnimalHistory(petId) {
      if (!petId) return;
      navigate(`/animal/${encodeURIComponent(petId)}`);
    },
  };
})(window);
