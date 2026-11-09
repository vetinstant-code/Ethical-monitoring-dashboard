/**
 * In-app pages: animals by category, today's vitals, animal temperature history.
 * Hash routes: #/  #/animals  #/vitals-today  #/animal/:id  #/reports
 */
(function (global) {
  const VIEW_IDS = {
    dashboard: "view-dashboard",
    animals: "view-animals",
    "vitals-today": "view-vitals-today",
    history: "view-animal-history",
    reports: "view-reports",
    bugs: "view-bugs",
    media: "view-media",
    logs: "view-logs",
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
    if (!parts.length) return { name: "dashboard", petId: null, filter: null };
    if (parts[0] === "animals") return { name: "animals", petId: null, filter: null };
    if (parts[0] === "vitals-today") {
      const filter = parts[1] || "all";
      return { name: "vitals-today", petId: null, filter };
    }
    if (parts[0] === "reports") return { name: "reports", petId: null, filter: null };
    if (parts[0] === "bugs") return { name: "bugs", petId: null, filter: parts[1] || "today" };
    if (parts[0] === "media") return { name: "media", petId: null, filter: parts[1] || "today" };
    if (parts[0] === "logs") return { name: "logs", petId: null, filter: parts[1] || "all" };
    if (parts[0] === "animal" && parts[1]) {
      return { name: "history", petId: decodeURIComponent(parts[1]), filter: null };
    }
    return { name: "dashboard", petId: null, filter: null };
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
        (name === "reports" && nav === "reports") ||
        (name === "bugs" && nav === "bugs") ||
        (name === "media" && nav === "media") ||
        (name === "logs" && nav === "logs");
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
    const token = String(session.sessionToken || "").trim();
    if (!token) throw new Error("Not signed in.");
    const cfg = {
      baseUrl: global.API_CONFIG?.baseUrl,
      deviceId: session.deviceId || global.VetAuth?.getDeviceId?.() || global.API_CONFIG?.deviceId || "ARMY",
      sessionToken: token,
      timeoutMs: global.API_CONFIG?.timeoutMs || 25000,
    };
    const client = new global.VetApiClient(cfg);
    client.setSessionToken(token);
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

  async function renderVitalsTodayPage(filter = "all") {
    const root = document.getElementById("vitals-today-root");
    const sub = document.getElementById("vitals-today-subtitle");
    const cardTitle = document.getElementById("vitals-today-card-title");
    const date = getSelectedDate();
    if (!root) return;

    const normalizedFilter = String(filter || "all").toLowerCase();

    if (cardTitle) {
      if (normalizedFilter === "successful") {
        cardTitle.textContent = "Successful Cases Today";
      } else if (normalizedFilter === "incomplete") {
        cardTitle.textContent = "Incomplete Cases Today";
      } else {
        cardTitle.textContent = "Animals Tested Today";
      }
    }

    if (sub) {
      if (normalizedFilter === "successful") {
        sub.textContent = `Successful cases on ${date} meeting full validation protocol. Select an animal to view detailed history.`;
      } else if (normalizedFilter === "incomplete") {
        sub.textContent = `Incomplete cases on ${date}. Detailed checklist shows which measurements (audio or temperature) are missing.`;
      } else {
        sub.textContent = `All animals evaluated on ${date}. Review protocol completion status and select any animal for detailed history.`;
      }
    }

    try {
      let cases = global.VetLiveApi?.getLastCases?.() || [];

    if (!cases.length) {
      root.innerHTML = `
        <div class="empty-state">
          <p>Loading today’s clinical validation cases…</p>
        </div>`;
      if (global.VetLiveApi?.refreshTodayDashboard) {
        await global.VetLiveApi.refreshTodayDashboard();
        cases = global.VetLiveApi?.getLastCases?.() || [];
      }
    }

    // Fallback: If still no cases from live API, load daily pets
    if (!cases.length) {
      try {
        const client = await ensureClient();
        let pets = global.VetLiveApi?.getDailyPetsList?.(date);
        if (!pets || !pets.length) {
          const resp = await client.dailyPets(date).catch(() => null);
          pets = (resp?.pets || []).map((p) => ({
            ...p,
            pet_id: p.pet_id || p.id,
            id: p.pet_id || p.id,
            name: p.pet_name || p.name,
            pet_name: p.pet_name || p.name,
          }));
        }
        if (Array.isArray(pets) && pets.length) {
          cases = pets.map((p) => {
            const petId = petIdOf(p);
            const name = petNameOf(p);
            const species = speciesOf(p);
            const breed = breedOf(p);
            const evalResult = global.VetStatusEngine?.evaluateProtocol
              ? global.VetStatusEngine.evaluateProtocol({
                  heartCount: 0,
                  lungCount: 0,
                  hasIr: false,
                  hasRef: false,
                  isScheduled: true,
                  animalName: name,
                  species,
                })
              : { statusLabel: "In Progress", statusClass: "in-progress" };
            return {
              id: petId,
              name,
              species,
              breed,
              displayId: petId.slice(0, 10),
              time: "—",
              statusLabel: evalResult.statusLabel,
              statusClass: evalResult.statusClass,
              statusInfo: evalResult,
            };
          });
        }
      } catch (err) {
        console.warn("Fallback dailyPets load failed", err);
      }
    }

    if (!cases.length) {
      root.innerHTML = `<p class="empty-state">No animals recorded on ${escapeHtml(date)}.</p>`;
      return;
    }

    // Deduplicate cases by canonical animal UUID (or name if missing) so each physical animal appears once
    const caseMapByPet = new Map();
    cases.forEach((c) => {
      const petId = String(c.id || c.pet_id || "").trim().toLowerCase();
      const cleanName = String(c.name || "").trim().toLowerCase();
      const pKey = petId || cleanName;
      if (!pKey) return;
      if (!caseMapByPet.has(pKey)) {
        caseMapByPet.set(pKey, c);
      } else {
        const cur = caseMapByPet.get(pKey);
        // Prioritize completed records
        if (c.statusLabel === "Completed" && cur.statusLabel !== "Completed") {
          caseMapByPet.set(pKey, c);
        } else if (cur.statusLabel === "Completed" && c.statusLabel !== "Completed") {
          // keep existing completed record
        } else if (c.statusInfo?.checklist && !cur.statusInfo?.checklist) {
          caseMapByPet.set(pKey, c);
        } else if (!c.statusInfo?.checklist && cur.statusInfo?.checklist) {
          // keep existing record with checklist
        } else if ((c.timestamp || 0) > (cur.timestamp || 0)) {
          caseMapByPet.set(pKey, c);
        }
      }
    });
    const uniqueCases = Array.from(caseMapByPet.values());

    const totalAll = uniqueCases.length;
    const totalSuccess = uniqueCases.filter((c) => c.statusLabel === "Completed").length;
    const totalIncomplete = uniqueCases.filter((c) => c.statusLabel === "Incomplete" || c.statusLabel === "In Progress").length;

    let filteredList = uniqueCases;
    if (normalizedFilter === "successful") {
      filteredList = uniqueCases.filter((c) => c.statusLabel === "Completed");
    } else if (normalizedFilter === "incomplete") {
      filteredList = uniqueCases.filter((c) => c.statusLabel === "Incomplete" || c.statusLabel === "In Progress");
    }

    // Sort: Alphabetical by animal name
    filteredList.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    const tabsHtml = `
      <div class="vitals-tabs-strip" role="tablist">
        <button type="button" class="vitals-tab-btn ${normalizedFilter === 'all' ? 'is-active' : ''}" data-filter="all" role="tab">
          <span>All Animals</span>
          <span class="vitals-tab-count">${totalAll}</span>
        </button>
        <button type="button" class="vitals-tab-btn vitals-tab-btn--success ${normalizedFilter === 'successful' ? 'is-active' : ''}" data-filter="successful" role="tab">
          <span>Successful Cases</span>
          <span class="vitals-tab-count">${totalSuccess}</span>
        </button>
        <button type="button" class="vitals-tab-btn vitals-tab-btn--incomplete ${normalizedFilter === 'incomplete' ? 'is-active' : ''}" data-filter="incomplete" role="tab">
          <span>Incomplete Cases</span>
          <span class="vitals-tab-count">${totalIncomplete}</span>
        </button>
      </div>`;

    if (!filteredList.length) {
      root.innerHTML = `
        ${tabsHtml}
        <div class="empty-state">
          <p>No ${escapeHtml(normalizedFilter)} cases found for ${escapeHtml(date)}.</p>
        </div>`;
      return;
    }

    const cardsHtml = filteredList
      .map((c) => {
        const ch = c.statusInfo?.checklist || {};
        const hPass = !!ch.heart?.pass;
        const lPass = !!ch.lung?.pass;
        const irPass = !!ch.ir?.pass;
        const refPass = !!ch.ref?.pass;
        const missing = Array.isArray(c.statusInfo?.missing) ? c.statusInfo.missing : [];
        const isComplete = c.statusLabel === "Completed";
        const isPending = c.statusLabel === "In Progress";
        const speciesIcon = c.statusInfo?.speciesIcon || "🐾";
        const speciesName = c.statusInfo?.speciesName || c.species || "Animal";
        const breed = c.breed ? ` · ${c.breed}` : "";
        const displayId = c.displayId && c.displayId !== "—" ? ` · ID: ${c.displayId}` : (c.id ? ` · ID: ${c.id.slice(0, 10)}…` : "");

        let alertBanner = "";
        if (isComplete) {
          alertBanner = `
            <div class="case-protocol-alert case-protocol-alert--complete">
              <span class="case-alert-icon">✓</span>
              <div class="case-alert-body">
                <strong>Protocol Complete:</strong> All 4 clinical validation requirements satisfied (4 Heart audio files, 4 Lung audio files, IR sensor reading, and Reference thermometer).
              </div>
            </div>`;
        } else if (isPending) {
          alertBanner = `
            <div class="case-protocol-alert case-protocol-alert--pending">
              <span class="case-alert-icon">⏳</span>
              <div class="case-alert-body">
                <strong>Scheduled / In Progress:</strong> Animal scheduled for today's clinical trial rounds. Awaiting vital sensors and stethoscope auscultation.
              </div>
            </div>`;
        } else {
          const missingText = missing.length
            ? missing.join("; ")
            : "Measurements missing for full protocol";
          alertBanner = `
            <div class="case-protocol-alert case-protocol-alert--incomplete">
              <span class="case-alert-icon">⚠️</span>
              <div class="case-alert-body">
                <strong>Missing for complete protocol:</strong> ${escapeHtml(missingText)}. All 4 files for heart, 4 files for lung, IR temp, and reference temp are required.
              </div>
            </div>`;
        }

        let diagHtml = "";
        if (!isComplete) {
          const activeDev = global.VetAuth?.getDeviceId?.() || "BRUNO";
          const verdict = global.VetDiagInvestigator?.getVerdict?.(c.id, c.sessionId, date, activeDev);
          const prog = global.VetDiagInvestigator?.getProgress?.(c.id);

          if (verdict) {
            const auditList = Array.isArray(verdict.auditItems) && verdict.auditItems.length > 0 ? verdict.auditItems : [
              { label: "Device Link", val: `${activeDev} · Operational`, highlight: "highlight-pass" },
              { label: "Screen Triggers", val: "Measurements Incomplete", highlight: "highlight-warn" },
              { label: "Telemetry Trace", val: "0 Hardware / UART Faults", highlight: "highlight-pass" },
            ];

            diagHtml = `
              <div class="case-root-cause-banner case-root-cause-banner--${verdict.type}">
                <div class="case-root-cause-header">
                  <span class="case-root-cause-icon">${verdict.icon || "ℹ️"}</span>
                  <div class="case-root-cause-titles">
                    <span class="case-root-cause-tag ${verdict.badgeClass || 'verdict-skipped'}">${escapeHtml(verdict.tag || "Diagnosis")}</span>
                    <strong class="case-root-cause-title">${escapeHtml(verdict.title || "Root Cause")}</strong>
                  </div>
                </div>
                <p class="case-root-cause-desc">${escapeHtml(verdict.message || "")}</p>
                ${verdict.evidence ? `<div class="case-root-cause-evidence"><span>${escapeHtml(verdict.evidence)}</span></div>` : ""}
                <div class="case-root-cause-audit">
                  <div class="case-audit-title">📡 Subsystem Telemetry & Command Audit:</div>
                  <div class="case-audit-grid">
                    ${auditList.map(item => `
                      <div class="case-audit-cell ${item.highlight || ''}">
                        <span class="audit-cell-label">${escapeHtml(item.label)}</span>
                        <span class="audit-cell-val">${escapeHtml(item.val)}</span>
                      </div>
                    `).join("")}
                  </div>
                </div>
                <div class="case-root-cause-actions">
                  <button type="button" class="btn-banner-excel" data-pet-id="${escapeHtml(c.id)}" title="Download complete forensic decoded Excel">
                    <span>📊 Download Decoded Log (.xlsx)</span>
                  </button>
                </div>
              </div>`;
          } else {
            const currentPct = prog?.pct || 15;
            const currentStage = prog?.stage || "Scanning device telemetry…";
            diagHtml = `
              <div class="case-diag-progress-block" id="diag-progress-${escapeHtml(c.id)}" data-pet-id="${escapeHtml(c.id)}">
                <div class="diag-progress-header">
                  <span class="diag-progress-label">
                    <span class="diag-spinner"></span>
                    <span class="diag-progress-text">Investigating Root Cause: ${escapeHtml(currentStage)}</span>
                  </span>
                  <span class="diag-progress-pct">${currentPct}%</span>
                </div>
                <div class="diag-progress-track">
                  <div class="diag-progress-fill" style="width:${currentPct}%"></div>
                </div>
              </div>`;
          }
        }

        return `
          <article class="case-detail-card" data-pet-id="${escapeHtml(c.id)}">
            <div class="case-card-header">
              <div class="case-card-identity">
                <div class="case-card-avatar" aria-hidden="true">${speciesIcon}</div>
                <div>
                  <div class="case-card-title-row">
                    <h4 class="case-card-name">${escapeHtml(c.name || "Unknown Animal")}</h4>
                    <span class="case-card-time">${escapeHtml(c.time || "—")}</span>
                  </div>
                  <div class="case-card-meta">
                    <span>${escapeHtml(speciesName)}${escapeHtml(breed)}${escapeHtml(displayId)}</span>
                  </div>
                </div>
              </div>
              <div class="case-card-badge-wrap">
                <span class="cv-status-badge ${c.statusClass || (isComplete ? 'completed' : 'incomplete')}">
                  <span class="badge-status-dot"></span>
                  ${escapeHtml(c.statusLabel || (isComplete ? 'Completed' : 'Incomplete'))}
                </span>
              </div>
            </div>

            <div class="case-checklist-grid">
              <div class="case-check-item ${hPass ? 'pass' : 'fail'}">
                <span class="case-check-icon">${hPass ? '✓' : '✗'}</span>
                <div class="case-check-content">
                  <span class="case-check-name">🫀 Heart Audio (4 files)</span>
                  <span class="case-check-status">${ch.heart?.current || 0} / 4 recordings ${hPass ? '(Complete)' : '(Need 4)'}</span>
                </div>
              </div>

              <div class="case-check-item ${lPass ? 'pass' : 'fail'}">
                <span class="case-check-icon">${lPass ? '✓' : '✗'}</span>
                <div class="case-check-content">
                  <span class="case-check-name">🫁 Lung Audio (4 files)</span>
                  <span class="case-check-status">${ch.lung?.current || 0} / 4 recordings ${lPass ? '(Complete)' : '(Need 4)'}</span>
                </div>
              </div>

              <div class="case-check-item ${irPass ? 'pass' : 'fail'}">
                <span class="case-check-icon">${irPass ? '✓' : '✗'}</span>
                <div class="case-check-content">
                  <span class="case-check-name">🌡️ Infrared (IR) Temp</span>
                  <span class="case-check-status">${ch.ir?.val ? escapeHtml(ch.ir.val) : 'Missing'}</span>
                </div>
              </div>

              <div class="case-check-item ${refPass ? 'pass' : 'fail'}">
                <span class="case-check-icon">${refPass ? '✓' : '✗'}</span>
                <div class="case-check-content">
                  <span class="case-check-name">🩺 Reference Thermometer</span>
                  <span class="case-check-status">${ch.ref?.val ? escapeHtml(ch.ref.val) : 'Missing'}</span>
                </div>
              </div>
            </div>

            ${alertBanner}
            ${diagHtml}

            <div class="case-card-actions">
              <button type="button" class="btn-case-excel" data-pet-id="${escapeHtml(c.id)}" title="Generate and download full multi-sheet decoded log Excel">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                <span>Download Decoded Log (.xlsx)</span>
              </button>
              <button type="button" class="btn-case-history" data-pet-id="${escapeHtml(c.id)}">
                <span>View Animal History & Recordings</span>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
              </button>
            </div>
          </article>`;
      })
      .join("");

    root.innerHTML = `
      ${tabsHtml}
      <div class="case-cards-list">${cardsHtml}</div>`;

    // Enqueue incomplete cases for background root cause investigation
    const activeDev = global.VetAuth?.getDeviceId?.() || "BRUNO";
    global.VetDiagInvestigator?.enqueueCases?.(uniqueCases, date, activeDev);
  } catch (err) {
    console.error("renderVitalsTodayPage error:", err);
    root.innerHTML = `<p class="empty-state">Failed to load vitals: ${escapeHtml(err.message || err)}</p>`;
  }
}

  function statusFromTemp(temp, species = "dog") {
    if (global.VetStatusEngine?.evaluate) {
      return global.VetStatusEngine.evaluate(temp, species);
    }
    if (temp == null) return { statusLabel: "—", statusClass: "normal", label: "—", cls: "normal" };
    if (temp > 39.2 || temp < 37.2) return { statusLabel: "Critical", statusClass: "critical", label: "Critical", cls: "critical" };
    return { statusLabel: "Normal", statusClass: "normal", label: "Normal", cls: "normal" };
  }

  function sensorKeyOfSummary(row) {
    return String(row?.sensor_type || row?.type || row?.sensor || "").trim().toLowerCase();
  }

  function summaryRecordedAt(row) {
    return row?.recorded_at || row?.timestamp || row?.created_at || row?.date || "";
  }

  function summaryRecordedAtTime(row) {
    const raw = summaryRecordedAt(row);
    const parsed = parseTimestamp(raw);
    if (parsed) return parsed.getTime();
    const sid = String(row?.session_id || "");
    const m = sid.match(/_(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})(20\d{2})_/);
    if (m) {
      const [, hh, mm, ss, d, mo, y] = m;
      const dt = new Date(`${y}-${mo}-${d}T${hh}:${mm}:${ss}+05:30`);
      if (!Number.isNaN(dt.getTime())) return dt.getTime();
    }
    return 0;
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
    wanted.sort((a, b) => {
      const diff = summaryRecordedAtTime(b) - summaryRecordedAtTime(a);
      if (diff !== 0) return diff;
      return String(b?.session_id || "").localeCompare(String(a?.session_id || ""));
    });
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

  /**
   * Session Audio Recordings & Doctor Notes Modal
   */
  async function openSessionAudioModal(petId, sid, sessionLabel, whenLabel, sObj, sNotes) {
    const overlay = document.createElement("div");
    overlay.className = "bug-modal-overlay session-audio-overlay";

    const closingNote = String(sObj?.closing_notes || "").trim();
    const sessionTitle = String(sObj?.title || "").trim();
    const irNote = String(sNotes?.ir_ear || "").trim();
    const rectNote = String(sNotes?.rectal_sensor || "").trim();
    const refNote = String(sNotes?.reference_thermometer || "").trim();
    const sessionStatus = String(sObj?.status || "closed").toLowerCase();

    overlay.innerHTML = `
      <div class="bug-modal-dialog session-audio-dialog" role="dialog" aria-modal="true">
        <div class="bug-modal-head">
          <div class="session-modal-titles">
            <span class="session-modal-badge">${escapeHtml(sessionLabel || "Exam Session")}</span>
            <h3>Session Clinical Notes & Audio Recordings</h3>
            <p class="session-modal-subtitle">Started: ${escapeHtml(whenLabel || "—")} • Status: <span class="badge-status ${sessionStatus === 'closed' ? 'normal' : 'active'}">${escapeHtml(sessionStatus)}</span></p>
          </div>
          <button type="button" class="bug-modal-close" aria-label="Close">✕</button>
        </div>

        <div class="bug-modal-body session-modal-body">
          <!-- 1. CLINICAL & SENSOR NOTES -->
          <div class="session-modal-section">
            <h4 class="session-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
              Doctor Clinical Observations & Notes
            </h4>
            <div class="session-notes-grid">
              ${closingNote ? `
                <div class="session-note-card session-note-card--closing">
                  <span class="note-card-label">Session Closing Note / Protocol Reason:</span>
                  <p class="note-card-text">${escapeHtml(closingNote)}</p>
                </div>
              ` : ""}
              ${sessionTitle ? `
                <div class="session-note-card">
                  <span class="note-card-label">Session Title:</span>
                  <p class="note-card-text">${escapeHtml(sessionTitle)}</p>
                </div>
              ` : ""}
              ${irNote ? `
                <div class="session-note-card session-note-card--ir">
                  <span class="note-card-label">IR Ear Sensor Note:</span>
                  <p class="note-card-text">${escapeHtml(irNote)}</p>
                </div>
              ` : ""}
              ${rectNote ? `
                <div class="session-note-card session-note-card--rectal">
                  <span class="note-card-label">Rectal Probe Note:</span>
                  <p class="note-card-text">${escapeHtml(rectNote)}</p>
                </div>
              ` : ""}
              ${refNote ? `
                <div class="session-note-card session-note-card--ref">
                  <span class="note-card-label">Reference Thermometer Note:</span>
                  <p class="note-card-text">${escapeHtml(refNote)}</p>
                </div>
              ` : ""}
              ${!closingNote && !sessionTitle && !irNote && !rectNote && !refNote ? `
                <p class="text-muted" style="margin: 0; padding: 8px 0;">No written clinical observation notes for this session.</p>
              ` : ""}
            </div>
          </div>

          <!-- 2. AUSCULTATION AUDIO RECORDINGS & AUDIO NOTES -->
          <div class="session-modal-section">
            <h4 class="session-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path></svg>
              Auscultation Audio Recordings & Audio Notes
            </h4>
            <div id="session-audio-list-root" class="session-audio-list">
              <div class="bugs-loading-wrap" style="padding: 16px 0;">
                <div class="bugs-spinner"></div>
                <p>Loading session audio recordings…</p>
              </div>
            </div>
          </div>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector(".bug-modal-close").addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    try {
      const client = await ensureClient();
      const recResp = await client.recordings(petId, sid).catch(() => ({ heart: [], lung: [] }));
      const heart = Array.isArray(recResp?.heart) ? recResp.heart : [];
      const lung = Array.isArray(recResp?.lung) ? recResp.lung : [];
      const allRecs = [
        ...heart.map((r) => ({ ...r, _container: "heart" })),
        ...lung.map((r) => ({ ...r, _container: "lung" }))
      ];

      const audioRoot = overlay.querySelector("#session-audio-list-root");
      if (!audioRoot) return;

      if (!allRecs.length) {
        audioRoot.innerHTML = `<p class="text-muted" style="padding: 10px 0;">No audio recordings uploaded for this session.</p>`;
        return;
      }

      const pointLabels = {
        M: "Mitral Point (M)",
        A: "Aortic Point (A)",
        P: "Pulmonic Point (P)",
        T: "Tricuspid Point (T)",
        LL1: "Left Lung 1 (LL1)",
        LL2: "Left Lung 2 (LL2)",
        RL1: "Right Lung 1 (RL1)",
        RL2: "Right Lung 2 (RL2)",
      };

      audioRoot.innerHTML = `
        <div class="session-recordings-grid">
          ${allRecs.map((rec) => {
            const isHeart = rec._container === "heart";
            const pt = String(rec.point || "").toUpperCase();
            const ptName = pointLabels[pt] || `Point ${pt}`;
            const dur = rec.duration_seconds ? `${Number(rec.duration_seconds).toFixed(1)}s` : "";
            const note = String(rec.notes || "").trim();
            const recId = rec.id;

            return `
              <div class="session-rec-card ${isHeart ? 'session-rec-card--heart' : 'session-rec-card--lung'}" data-rec-id="${escapeHtml(recId)}">
                <div class="session-rec-header">
                  <span class="session-rec-badge ${isHeart ? 'badge-heart' : 'badge-lung'}">
                    ${isHeart ? '🫀 Heart' : '🫁 Lung'} • ${escapeHtml(ptName)}
                  </span>
                  <span class="session-rec-dur">${escapeHtml(dur)}</span>
                </div>

                ${note ? `
                  <div class="session-rec-note-box">
                    <span class="rec-note-label">Audio Note:</span>
                    <p class="rec-note-text">${escapeHtml(note)}</p>
                  </div>
                ` : ""}

                <div class="session-rec-player-area" id="rec-player-area-${escapeHtml(recId)}">
                  <button type="button" class="btn-play-session-audio" data-rec-id="${escapeHtml(recId)}" data-pet-id="${escapeHtml(petId)}" data-type="${escapeHtml(rec._container)}">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                    <span>Play Audio Clip</span>
                  </button>
                </div>
              </div>`;
          }).join("")}
        </div>`;

      // Wire play buttons
      audioRoot.querySelectorAll(".btn-play-session-audio").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const recId = btn.getAttribute("data-rec-id");
          const pId = btn.getAttribute("data-pet-id");
          const rType = btn.getAttribute("data-type");
          const playerArea = audioRoot.querySelector(`#rec-player-area-${recId}`);
          if (!playerArea) return;

          btn.disabled = true;
          btn.innerHTML = `<span class="diag-spinner" style="width:12px;height:12px;"></span> Loading WAV…`;

          try {
            const streamHref = `/api/recordings/${encodeURIComponent(recId)}/audio-stream?pet_id=${encodeURIComponent(pId)}&type=${encodeURIComponent(rType)}`;
            const buf = await client.downloadBinaryByHref(streamHref, {
              deviceId: client.deviceId,
              sessionToken: client.sessionToken,
            });
            const blob = new Blob([buf], { type: "audio/wav" });
            const objUrl = URL.createObjectURL(blob);

            playerArea.innerHTML = `
              <div class="audio-inline-player">
                <audio controls autoplay src="${objUrl}" style="width: 100%; height: 32px;"></audio>
              </div>`;
          } catch (err) {
            console.error("Audio playback error:", err);
            btn.disabled = false;
            btn.innerHTML = `⚠️ Play Failed`;
          }
        });
      });
    } catch (err) {
      console.error("Failed to load session recordings:", err);
    }
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

      const [sessionsResponse, petSummaryResp, tempNotesResp] = await Promise.all([
        client.examSessions(petId).catch(() => []),
        client.petTemperatureSummary(petId).catch(() => null),
        client.temperatureNotes(petId).catch(() => null),
      ]);

      const sessions = global.VetApiNormalize.normalizeSessions(sessionsResponse);
      const sessionLabelMap = global.VetApiAdapter?.sortAndIndexSessions?.(sessions) || {};
      const summaries = Array.isArray(petSummaryResp) ? petSummaryResp : petSummaryResp?.summaries || petSummaryResp?.temperature_summaries || petSummaryResp?.data || petSummaryResp?.results || [];
      const summaryList = Array.isArray(summaries) ? summaries.filter((x) => x && typeof x === "object") : [];

      const sessionIds = sessions
        .map((s) => String(s?.id || s?.exam_session_id || "").trim())
        .filter(Boolean);
      const uniqSessionIds = Array.from(new Set(sessionIds));

      // Fetch per-session temperature notes concurrently
      const sessionNotesMap = {};
      await Promise.all(
        uniqSessionIds.map(async (sid) => {
          try {
            const res = await client.temperatureNotes(petId, sid);
            if (res && typeof res === "object") {
              sessionNotesMap[sid] = res;
            }
          } catch {}
        })
      );

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
        const st = statusFromTemp(displayTemp, species);

        const refs = best ? summaryTriple(best, "ref") : [0, 0, 0];
        const refMax = Math.max(...refs);
        const sessionLabel = sessionLabelMap[sid] || global.VetApiAdapter?.formatSessionLabel?.(sid, petId) || (sid ? `Session (${sid.slice(0, 8)})` : "—");

        const sNotes = sessionNotesMap[sid] || tempNotesResp || {};
        const closingNote = String(sObj.closing_notes || "").trim();
        const irNote = String(sNotes.ir_ear || "").trim();
        const rectNote = String(sNotes.rectal_sensor || "").trim();
        const refNote = String(sNotes.reference_thermometer || "").trim();
        const summaryNote = String(best?.notes || "").trim();

        const notesList = [];
        if (closingNote) {
          notesList.push({ type: "session", label: "Session Note", text: closingNote });
        }
        if (irNote) {
          notesList.push({ type: "ir", label: "IR Ear", text: irNote });
        }
        if (rectNote) {
          notesList.push({ type: "rectal", label: "Rectal", text: rectNote });
        }
        if (refNote) {
          notesList.push({ type: "ref", label: "Ref", text: refNote });
        }
        if (summaryNote && !notesList.some((n) => n.text === summaryNote)) {
          notesList.push({ type: "general", label: "Summary", text: summaryNote });
        }

        cards.push({
          sid,
          sObj,
          sNotes,
          notesList,
          sessionLabel,
          whenSort: recorded?.getTime?.() || started?.getTime?.() || 0,
          whenLabel,
          recordedLabel: recorded ? istDateTimeFormatter.format(recorded) : "—",
          statusLabel: st.statusLabel || st.label,
          statusClass: st.statusClass || st.cls,
          statusInfo: st,
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
        const st = statusFromTemp(displayTemp, species);
        const refs = best ? summaryTriple(best, "ref") : [0, 0, 0];
        const refMax = Math.max(...refs);
        const sessionLabel = sessionLabelMap[sid] || global.VetApiAdapter?.formatSessionLabel?.(sid, petId) || (sid ? `Session (${sid.slice(0, 8)})` : "—");
        const summaryNote = String(best?.notes || "").trim();
        const notesList = summaryNote ? [{ type: "general", label: "Summary", text: summaryNote }] : [];

        cards.push({
          sid,
          sObj: null,
          sNotes: null,
          notesList,
          sessionLabel,
          whenSort: recorded?.getTime?.() || 0,
          whenLabel: "—",
          recordedLabel: recorded ? istDateTimeFormatter.format(recorded) : "—",
          statusLabel: st.statusLabel || st.label,
          statusClass: st.statusClass || st.cls,
          statusInfo: st,
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
                <th>Doctor Notes & Observations</th>
                <th>Exam Session & Audio</th>
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
                  const badgeHtml = global.VetStatusEngine?.renderBadgeHtml
                    ? global.VetStatusEngine.renderBadgeHtml(row.statusInfo || {
                        statusLabel: row.statusLabel,
                        statusClass: row.statusClass,
                        condition: row.statusLabel,
                        speciesName: species,
                        measuredStr: row.displayTemp != null ? `${row.displayTemp.toFixed(2)} °C` : "—",
                      })
                    : `<span class="badge-status ${row.statusClass}">${escapeHtml(row.statusLabel)}</span>`;
                  return `
                <tr>
                  <td class="time-col-text">${escapeHtml(row.whenLabel)}</td>
                  <td class="time-col-text">${escapeHtml(row.recordedLabel)}</td>
                  <td>${escapeHtml(irT)}</td>
                  <td>${escapeHtml(rectT)}</td>
                  <td class="vitals-text-bold">${row.refMax > 0 ? `${row.refMax.toFixed(2)}°C` : "—"}</td>
                  <td>${escapeHtml(stats)}</td>
                  <td class="history-notes-col">
                    ${row.notesList && row.notesList.length > 0 ? `
                      <div class="history-notes-stack">
                        ${row.notesList.map((n) => `
                          <div class="history-note-badge history-note-badge--${n.type}">
                            <span class="note-badge-tag">${escapeHtml(n.label)}:</span>
                            <span class="note-badge-text">${escapeHtml(n.text)}</span>
                          </div>
                        `).join("")}
                      </div>
                    ` : `<span class="text-muted">—</span>`}
                  </td>
                  <td class="history-session-col">
                    <div class="history-session-cell">
                      <strong class="session-label-strong" title="Session ID: ${escapeHtml(row.sid)}">${escapeHtml(row.sessionLabel)}</strong>
                      <button type="button" class="btn-session-details" data-sid="${escapeHtml(row.sid)}" data-label="${escapeHtml(row.sessionLabel)}" data-when="${escapeHtml(row.whenLabel)}" title="Open complete audio recordings & doctor notes for this session">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                        </svg>
                        <span>Audio & Notes</span>
                      </button>
                    </div>
                  </td>
                  <td>${badgeHtml}</td>
                </tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>`;

      // Wire session detail clicks
      root.querySelectorAll(".btn-session-details").forEach((btn) => {
        btn.addEventListener("click", () => {
          const sid = btn.getAttribute("data-sid");
          const label = btn.getAttribute("data-label");
          const when = btn.getAttribute("data-when");
          const targetCard = cards.find((c) => c.sid === sid);
          const sObj = targetCard?.sObj || sessions.find((s) => String(s?.id || s?.exam_session_id || "").trim() === sid) || {};
          const sNotes = targetCard?.sNotes || sessionNotesMap[sid] || tempNotesResp || {};
          openSessionAudioModal(petId, sid, label, when, sObj, sNotes);
        });
      });
    } catch (err) {
      root.innerHTML = `<p class="empty-state">Failed to load history: ${escapeHtml(err.message || err)}</p>`;
    }
  }

  async function route() {
    if (!global.VetAuth?.isLoggedIn?.()) return;
    const { name, petId, filter } = parseHash();

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
      const currentFilter = filter || "all";
      if (currentFilter === "successful") {
        setHeader("Successful Cases Today", "Animals meeting all 4 clinical validation protocol requirements.", true);
      } else if (currentFilter === "incomplete") {
        setHeader("Incomplete Cases Today", "Animals with incomplete validation protocols and missing measurements.", true);
      } else {
        setHeader("Animals Tested Today", "All animals evaluated during today's clinical validation study.", true);
      }
      document.body.classList.remove("reports-mode");
      global.VetDashboardFilters?.showBar?.(false);
      await renderVitalsTodayPage(currentFilter);
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

    if (name === "bugs") {
      showView("bugs");
      setHeader("Bug Reports & Issues", "Forensic issue tracking, doctor notes, and photo/video proofs.", false);
      document.body.classList.remove("reports-mode");
      global.VetDashboardFilters?.showBar?.(true);
      global.VetBugsPage?.render?.(filter || "today");
      return;
    }

    if (name === "media") {
      showView("media");
      setHeader("Clinical Media & Documents", "Case sheets, echo/ultrasound, medical photography, and video records.", false);
      document.body.classList.remove("reports-mode");
      global.VetDashboardFilters?.showBar?.(true);
      global.VetMediaPage?.render?.(filter || "today", "all");
      return;
    }

    if (name === "logs") {
      showView("logs");
      setHeader("System & Device Logs", "Decoded multi-stream timeline spreadsheets (.xlsx), speed reports (.md), and CloudWatch raw traces.", false);
      document.body.classList.remove("reports-mode");
      global.VetDashboardFilters?.showBar?.(true);
      global.VetLogsPage?.render?.(filter || "all");
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
    if (name === "dashboard") {
      global.VetLiveApi?.onDashboardShow?.();
    }
  }

  function bindUi() {
    document.getElementById("kpi-card-total-animals")?.addEventListener("click", () => {
      navigate("/vitals-today/all");
    });
    document.getElementById("kpi-card-vitals-today")?.addEventListener("click", () => {
      navigate("/vitals-today/all");
    });
    document.getElementById("kpi-card-bugs-today")?.addEventListener("click", () => {
      navigate("/bugs");
    });
    document.getElementById("kpi-card-media-today")?.addEventListener("click", () => {
      navigate("/media");
    });
    document.getElementById("cv-box-tested")?.addEventListener("click", () => {
      navigate("/vitals-today/all");
    });
    document.getElementById("cv-box-success")?.addEventListener("click", () => {
      navigate("/vitals-today/successful");
    });
    document.getElementById("cv-box-failed")?.addEventListener("click", () => {
      navigate("/vitals-today/incomplete");
    });
    document.getElementById("cv-box-bugs")?.addEventListener("click", () => {
      navigate("/bugs");
    });
    document.getElementById("cv-box-media")?.addEventListener("click", () => {
      navigate("/media");
    });
    document.getElementById("btn-view-all-cases")?.addEventListener("click", () => {
      navigate("/vitals-today/all");
    });
    document.getElementById("cv-progress-card-box")?.addEventListener("click", () => {
      navigate("/reports");
    });

    // Species card clicks in cv-species-cards
    document.getElementById("cv-species-cards")?.addEventListener("click", (e) => {
      const card = e.target.closest("[data-species]");
      if (card) {
        navigate("/animals");
      }
    });

    ["cv-box-tested", "cv-box-success", "cv-box-failed", "cv-box-bugs", "cv-box-media", "cv-progress-card-box"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          el.click();
        }
      });
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

    document.getElementById("vitals-today-root")?.addEventListener("click", async (e) => {
      const tab = e.target.closest("[data-filter]");
      if (tab) {
        const f = tab.getAttribute("data-filter") || "all";
        navigate(`/vitals-today/${f}`);
        return;
      }

      const excelBtn = e.target.closest(".btn-case-excel, .btn-banner-excel");
      if (excelBtn) {
        e.stopPropagation();
        e.preventDefault();
        const petId = excelBtn.getAttribute("data-pet-id");
        const date = getSelectedDate();
        const activeDev = global.VetAuth?.getDeviceId?.() || "BRUNO";
        const cases = global.VetLiveApi?.getLastCases?.() || [];
        const caseItem = cases.find((c) => String(c.id) === String(petId)) || { id: petId, name: petId };

        const originalHtml = excelBtn.innerHTML;
        excelBtn.disabled = true;
        excelBtn.innerHTML = `<span class="diag-spinner"></span> Generating Decoded Excel…`;
        try {
          await global.VetDiagInvestigator?.exportCaseDiagnosticExcel?.(caseItem, date, activeDev);
          excelBtn.innerHTML = `✓ Downloaded`;
          setTimeout(() => {
            excelBtn.innerHTML = originalHtml;
            excelBtn.disabled = false;
          }, 2500);
        } catch (err) {
          console.error("Export error:", err);
          excelBtn.innerHTML = `⚠️ Export Failed`;
          setTimeout(() => {
            excelBtn.innerHTML = originalHtml;
            excelBtn.disabled = false;
          }, 3000);
        }
        return;
      }

      const btn = e.target.closest("[data-pet-id]");
      if (!btn) return;
      navigate(`/animal/${encodeURIComponent(btn.getAttribute("data-pet-id"))}`);
    });

    window.addEventListener("vet:cases-updated", () => {
      const { name, filter } = parseHash();
      if (name === "vitals-today") {
        renderVitalsTodayPage(filter || "all");
      }
    });

    window.addEventListener("vet:dashboard-filters-changed", () => {
      const { name, filter } = parseHash();
      if (name === "vitals-today") renderVitalsTodayPage(filter || "all");
    });

    window.addEventListener("vet:diag-progress", (e) => {
      const { petId, pct, stage } = e.detail || {};
      if (!petId) return;
      const el = document.getElementById(`diag-progress-${petId}`);
      if (!el) return;
      const txt = el.querySelector(".diag-progress-text");
      const pctEl = el.querySelector(".diag-progress-pct");
      const fill = el.querySelector(".diag-progress-fill");
      if (txt) txt.textContent = `Investigating Root Cause: ${stage || "Analyzing…"}`;
      if (pctEl) pctEl.textContent = `${pct || 0}%`;
      if (fill) fill.style.width = `${pct || 0}%`;
    });

    window.addEventListener("vet:diag-complete", (e) => {
      const { petId, verdict } = e.detail || {};
      if (!petId || !verdict) return;
      const el = document.getElementById(`diag-progress-${petId}`);
      if (!el) return;
      el.outerHTML = `
        <div class="case-root-cause-banner case-root-cause-banner--${verdict.type}">
          <div class="case-root-cause-header">
            <span class="case-root-cause-icon">${verdict.icon || "ℹ️"}</span>
            <div class="case-root-cause-titles">
              <span class="case-root-cause-tag ${verdict.badgeClass || 'verdict-skipped'}">${escapeHtml(verdict.tag || "Diagnosis")}</span>
              <strong class="case-root-cause-title">${escapeHtml(verdict.title || "Root Cause")}</strong>
            </div>
          </div>
          <p class="case-root-cause-desc">${escapeHtml(verdict.message || "")}</p>
          ${verdict.evidence ? `<div class="case-root-cause-evidence"><span>${escapeHtml(verdict.evidence)}</span></div>` : ""}
          <div class="case-root-cause-audit">
            <div class="case-audit-title">📡 Subsystem Telemetry & Command Audit:</div>
            <div class="case-audit-grid">
              ${(Array.isArray(verdict.auditItems) && verdict.auditItems.length > 0 ? verdict.auditItems : [
                { label: "Device Link", val: `${verdict.deviceId || "BRUNO"} · Operational`, highlight: "highlight-pass" },
                { label: "Protocol Status", val: "Measurements Incomplete", highlight: "highlight-warn" },
                { label: "Telemetry Trace", val: "0 Hardware / UART Faults", highlight: "highlight-pass" },
              ]).map(item => `
                <div class="case-audit-cell ${item.highlight || ''}">
                  <span class="audit-cell-label">${escapeHtml(item.label)}</span>
                  <span class="audit-cell-val">${escapeHtml(item.val)}</span>
                </div>
              `).join("")}
            </div>
          </div>
          <div class="case-root-cause-actions">
            <button type="button" class="btn-banner-excel" data-pet-id="${escapeHtml(petId)}" title="Download complete forensic decoded Excel">
              <span>📊 Download Decoded Log (.xlsx)</span>
            </button>
          </div>
        </div>`;
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
