/**
 * VetInstant Bug & Clinical Issues Forensic Tracker
 * Allows tracking doctor notes, reported hardware/upload issues, and photo/video proof
 * for animals and exam sessions tested on any selected day.
 */
(function (global) {
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

  function formatDisplayDate(iso) {
    if (global.VetDashboardFilters?.formatDisplay) {
      return global.VetDashboardFilters.formatDisplay(iso);
    }
    return iso;
  }

  async function ensureClient() {
    if (global.VetLiveApi?.ensureClient) return global.VetLiveApi.ensureClient();
    const session = global.VetAuth?.getSession?.() || {};
    const token = String(session.sessionToken || "").trim();
    if (!token) throw new Error("Not signed in.");
    const cfg = {
      baseUrl: global.API_CONFIG?.baseUrl,
      deviceId: session.deviceId || global.VetAuth?.getDeviceId?.() || global.API_CONFIG?.deviceId || "BRUNO",
      sessionToken: token,
      timeoutMs: global.API_CONFIG?.timeoutMs || 25000,
    };
    const client = new global.VetApiClient(cfg);
    client.setSessionToken(token);
    return client;
  }

  // Internal state
  const state = {
    currentTab: "all",
    searchQuery: "",
    isLoading: false,
    date: null,
    items: [],
    allMedia: [],
    cachedNotes: new Map(), // key: `${petId}::${sessionId}`
  };

  /**
   * Concurrency-bounded map helper
   */
  async function mapPool(items, limit, fn) {
    const ret = [];
    const executing = [];
    for (const item of items) {
      const p = Promise.resolve().then(() => fn(item));
      ret.push(p);
      if (limit <= items.length) {
        const e = p.then(() => executing.splice(executing.indexOf(e), 1));
        executing.push(e);
        if (executing.length >= limit) {
          await Promise.race(executing);
        }
      }
    }
    return Promise.all(ret);
  }

  /**
   * Fetch bugs and issues for the selected date
   */
  async function loadBugData(targetDate) {
    state.isLoading = true;
    state.date = targetDate;
    renderSkeleton();

    try {
      const client = await ensureClient();

      // 1. Fetch global media list (up to 300 records)
      let mediaList = [];
      try {
        const mediaResp = await client.listMedia({ limit: 300 });
        mediaList = Array.isArray(mediaResp?.documents) ? mediaResp.documents : [];
      } catch (err) {
        console.warn("Failed to load clinical media list:", err);
      }
      state.allMedia = mediaList;

      // 2. Fetch tested cases for today from VetLiveApi
      let cases = global.VetLiveApi?.getLastCases?.() || [];
      if (!cases.length) {
        // Trigger background load or resolve pets for date
        try {
          const allPets = global.VetLiveApi?.getPets?.() || (await client.listPets().then(p => global.VetApiNormalize.normalizePets(p)));
          const resolved = await global.VetLiveApi?.resolvePetsForDate?.(client, targetDate, allPets);
          const rawPets = resolved?.list || [];
          cases = rawPets.map(p => ({
            id: p.pet_id || p.id,
            name: p.pet_name || p.name || "Animal",
            species: p.species || p.pet_species || "Animal",
            breed: p.breed || p.pet_breed || "—",
            displayId: p.display_id || p.id?.slice(0, 8),
            statusLabel: "In Progress",
            statusInfo: {},
            examSessionId: null,
          }));
        } catch (e) {
          console.warn("Failed resolving cases for date:", e);
        }
      }

      // Group media by pet_id
      const mediaByPet = new Map();
      mediaList.forEach(m => {
        const pid = String(m.pet_id || "").trim();
        if (!pid) return;
        if (!mediaByPet.has(pid)) mediaByPet.set(pid, []);
        mediaByPet.get(pid).push(m);
      });

      // 3. For each case, fetch sessions and bug notes concurrently (limit 5)
      const compiledItems = await mapPool(cases, 5, async (c) => {
        const petId = String(c.id || "").trim();
        const petName = c.name || "Animal";
        const species = c.species || "Animal";
        const breed = c.breed || "—";
        const displayId = c.displayId || (petId.length > 8 ? petId.slice(0, 8) : petId);
        const statusLabel = c.statusLabel || "In Progress";
        const missing = Array.isArray(c.statusInfo?.missing) ? c.statusInfo.missing : [];
        const attachedMedia = mediaByPet.get(petId) || [];

        // Sessions list
        let sessions = Array.isArray(c.sessions) && c.sessions.length ? c.sessions : [];
        let primarySessionId = c.examSessionId || null;

        if (!sessions.length) {
          try {
            const sessResp = await client.examSessions(petId);
            sessions = global.VetApiNormalize.normalizeSessions(sessResp);
          } catch (e) {
            /* ignore */
          }
        }

        if (sessions.length && !primarySessionId) {
          primarySessionId = sessions[0].exam_session_id || sessions[0].id || null;
        }

        // Fetch bug report / notes for this pet & session
        let bugNote = "";
        let bugDesc = "";
        let noteUpdatedAt = null;
        let bugReportImages = [];

        if (primarySessionId) {
          const cacheKey = `${petId}::${primarySessionId}`;
          if (state.cachedNotes.has(cacheKey)) {
            const cached = state.cachedNotes.get(cacheKey);
            bugNote = cached.notes || "";
            bugDesc = cached.description || "";
            noteUpdatedAt = cached.updated_at || null;
          } else {
            try {
              const bugResp = await client.petBugReports(petId, primarySessionId);
              if (bugResp) {
                const noteObj = bugResp.notes;
                if (typeof noteObj === "object" && noteObj !== null) {
                  bugNote = noteObj.notes || noteObj.description || "";
                  bugDesc = noteObj.description || "";
                  noteUpdatedAt = noteObj.updated_at || null;
                } else if (typeof noteObj === "string") {
                  bugNote = noteObj;
                }
                if (!bugNote && bugResp.description) {
                  bugNote = bugResp.description;
                }
                if (Array.isArray(bugResp.images) && bugResp.images.length) {
                  bugReportImages = bugResp.images;
                }
                state.cachedNotes.set(cacheKey, { notes: bugNote, description: bugDesc, updated_at: noteUpdatedAt });
              }
            } catch (err) {
              /* ignore individual fetch errors */
            }
          }
        }

        // Combine media
        const allImages = [...attachedMedia];
        bugReportImages.forEach(bri => {
          if (!allImages.some(img => img.id === bri.id)) {
            allImages.push(bri);
          }
        });

        // Determine session time
        let sessionTimeStr = "—";
        const primarySession = sessions.find(s => (s.exam_session_id || s.id) === primarySessionId) || sessions[0];
        if (primarySession) {
          const t = primarySession.session_start || primarySession.start_time || primarySession.created_at;
          if (t) {
            try {
              sessionTimeStr = istDateTimeFormatter.format(new Date(t));
            } catch {
              sessionTimeStr = String(t);
            }
          }
        }

        const hasNotes = Boolean(bugNote && bugNote.trim());
        const hasMedia = allImages.length > 0;
        const isIncomplete = statusLabel === "In Progress" || missing.length > 0;

        return {
          petId,
          petName,
          species,
          breed,
          displayId,
          primarySessionId,
          sessions,
          sessionTimeStr,
          statusLabel,
          missing,
          bugNote,
          bugDesc,
          noteUpdatedAt,
          media: allImages,
          hasNotes,
          hasMedia,
          isIncomplete,
        };
      });

      state.items = compiledItems;
      state.isLoading = false;
      renderUi();
    } catch (err) {
      state.isLoading = false;
      console.error("Failed to load bugs data:", err);
      renderError(err.message || String(err));
    }
  }

  /**
   * Render loading skeleton
   */
  function renderSkeleton() {
    const root = document.getElementById("bugs-content-root");
    if (!root) return;
    root.innerHTML = `
      <div class="bugs-loading-wrap">
        <div class="bugs-spinner"></div>
        <p>Scanning clinical validation sessions, bug notes, and failure proofs for ${escapeHtml(formatDisplayDate(state.date))}…</p>
      </div>`;
  }

  /**
   * Render error message
   */
  function renderError(msg) {
    const root = document.getElementById("bugs-content-root");
    if (!root) return;
    root.innerHTML = `
      <div class="empty-state bugs-empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="bugs-empty-icon">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <p class="bugs-error-title">Failed to load bug reports</p>
        <p class="bugs-error-desc">${escapeHtml(msg)}</p>
        <button type="button" class="btn-refresh-bugs" id="bugs-err-retry-btn">
          <span>Retry Loading</span>
        </button>
      </div>`;
    document.getElementById("bugs-err-retry-btn")?.addEventListener("click", () => {
      loadBugData(getSelectedDate());
    });
  }

  /**
   * Render main UI cards, metrics, and filter counts
   */
  function renderUi() {
    const items = state.items;
    const date = state.date;

    // Update KPI metrics
    const totalTested = items.length;
    const totalIssues = items.filter(i => i.hasNotes || i.isIncomplete).length;
    const totalMedia = items.reduce((acc, i) => acc + (i.media?.length || 0), 0);
    const totalClean = items.filter(i => !i.isIncomplete && !i.hasNotes).length;

    const elTested = document.getElementById("bugs-count-tested");
    const elIssues = document.getElementById("bugs-count-issues");
    const elMedia = document.getElementById("bugs-count-media");
    const elClean = document.getElementById("bugs-count-clean");

    if (elTested) elTested.textContent = totalTested;
    if (elIssues) elIssues.textContent = totalIssues;
    if (elMedia) elMedia.textContent = totalMedia;
    if (elClean) elClean.textContent = totalClean;

    // Tab counts
    const countAll = totalTested;
    const countWithIssues = items.filter(i => i.hasNotes).length;
    const countWithMedia = items.filter(i => i.hasMedia).length;
    const countIncomplete = items.filter(i => i.isIncomplete).length;

    const tabAll = document.getElementById("bugs-tab-all-count");
    const tabIssues = document.getElementById("bugs-tab-issues-count");
    const tabMedia = document.getElementById("bugs-tab-media-count");
    const tabIncomplete = document.getElementById("bugs-tab-incomplete-count");

    if (tabAll) tabAll.textContent = countAll;
    if (tabIssues) tabIssues.textContent = countWithIssues;
    if (tabMedia) tabMedia.textContent = countWithMedia;
    if (tabIncomplete) tabIncomplete.textContent = countIncomplete;

    // Filter items according to active tab
    let filtered = items.slice();
    if (state.currentTab === "with-issues") {
      filtered = filtered.filter(i => i.hasNotes);
    } else if (state.currentTab === "with-media") {
      filtered = filtered.filter(i => i.hasMedia);
    } else if (state.currentTab === "incomplete") {
      filtered = filtered.filter(i => i.isIncomplete);
    }

    // Apply search query filter
    const query = (state.searchQuery || "").trim().toLowerCase();
    if (query) {
      filtered = filtered.filter(i =>
        i.petName.toLowerCase().includes(query) ||
        i.displayId.toLowerCase().includes(query) ||
        i.petId.toLowerCase().includes(query) ||
        i.breed.toLowerCase().includes(query) ||
        i.species.toLowerCase().includes(query) ||
        i.bugNote.toLowerCase().includes(query)
      );
    }

    const root = document.getElementById("bugs-content-root");
    if (!root) return;

    if (!filtered.length) {
      let emptyMsg = `No cases found matching "${state.currentTab}" on ${formatDisplayDate(date)}.`;
      if (query) emptyMsg = `No results found matching "${query}" on ${formatDisplayDate(date)}.`;
      root.innerHTML = `
        <div class="empty-state bugs-empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="bugs-empty-icon">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M8 12h8"></path>
          </svg>
          <p class="bugs-error-title">No Bug Reports Found</p>
          <p class="bugs-error-desc">${escapeHtml(emptyMsg)}</p>
        </div>`;
      return;
    }

    // Render cards list
    const cardsHtml = filtered.map(item => {
      const speciesEmoji = getSpeciesIcon(item.species);
      const isComplete = !item.isIncomplete;

      // Badges
      const badges = [];
      if (item.hasNotes) {
        badges.push(`<span class="bug-tag bug-tag--note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg> Doctor Note Recorded</span>`);
      }
      if (item.hasMedia) {
        badges.push(`<span class="bug-tag bug-tag--media"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg> ${item.media.length} Proof Media Attached</span>`);
      }
      if (item.isIncomplete) {
        badges.push(`<span class="bug-tag bug-tag--warn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Protocol Incomplete (${item.missing.join(", ") || "Missing Measurements"})</span>`);
      } else {
        badges.push(`<span class="bug-tag bug-tag--pass"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Protocol Complete</span>`);
      }

      // Media gallery items
      let mediaGalleryHtml = "";
      if (item.media && item.media.length) {
        const thumbs = item.media.map(m => {
          const client = global.VetLiveApi?.ensureClient ? null : null;
          // Use view URL directly
          const auth = global.VetAuth?.getSession?.() || {};
          const token = auth.sessionToken || "";
          const dev = auth.deviceId || "BRUNO";
          const rawUrl = m.view_url || `/api/media/${m.id}/view`;
          const sep = rawUrl.includes("?") ? "&" : "?";
          const viewUrl = `${global.API_CONFIG?.baseUrl || "http://43.205.129.56:8000"}${rawUrl}${sep}token=${encodeURIComponent(token)}&dev=${encodeURIComponent(dev)}`;
          const categoryBadge = m.category === "bug_report" ? "Bug Proof" : (m.category === "case_sheet" ? "Case Sheet" : "Image");

          return `
            <div class="bug-media-thumb" data-media-id="${escapeHtml(m.id)}" data-media-title="${escapeHtml(m.title || m.original_filename)}" data-media-url="${escapeHtml(viewUrl)}" data-media-category="${escapeHtml(categoryBadge)}">
              <img src="${escapeHtml(viewUrl)}" alt="${escapeHtml(m.title || 'Attached proof')}" loading="lazy" onerror="this.src='assets/logo-vetinstant.png'; this.classList.add('is-fallback');" />
              <span class="bug-media-cat-badge">${escapeHtml(categoryBadge)}</span>
            </div>`;
        }).join("");

        mediaGalleryHtml = `
          <div class="bug-media-section">
            <div class="bug-media-header">
              <span class="bug-media-title">📸 Attached Clinical Proof & Screenshots (${item.media.length}):</span>
              <button type="button" class="btn-attach-media" data-pet-id="${escapeHtml(item.petId)}" data-session-id="${escapeHtml(item.primarySessionId || '')}">
                <span>+ Upload Proof</span>
              </button>
            </div>
            <div class="bug-media-grid">${thumbs}</div>
          </div>`;
      } else {
        mediaGalleryHtml = `
          <div class="bug-media-section bug-media-section--empty">
            <span class="bug-media-empty-label">No photo/video proof uploaded for this session yet.</span>
            <button type="button" class="btn-attach-media" data-pet-id="${escapeHtml(item.petId)}" data-session-id="${escapeHtml(item.primarySessionId || '')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
              <span>Upload Photo / Video Proof</span>
            </button>
          </div>`;
      }

      // Notes block
      let noteBlockHtml = "";
      if (item.hasNotes) {
        noteBlockHtml = `
          <div class="bug-note-card">
            <div class="bug-note-header">
              <div class="bug-note-header-left">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="bug-note-icon">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                  <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
                <strong>Doctor Observation / Reported Bug:</strong>
              </div>
              <button type="button" class="btn-edit-note" data-pet-id="${escapeHtml(item.petId)}" data-session-id="${escapeHtml(item.primarySessionId || '')}" data-note="${escapeHtml(item.bugNote)}">
                <span>✏️ Edit Note</span>
              </button>
            </div>
            <p class="bug-note-text">${escapeHtml(item.bugNote)}</p>
            ${item.noteUpdatedAt ? `<span class="bug-note-time">Updated: ${escapeHtml(item.noteUpdatedAt)}</span>` : ""}
          </div>`;
      } else {
        noteBlockHtml = `
          <div class="bug-note-card bug-note-card--empty">
            <div class="bug-note-empty-content">
              <span>No clinical observation or bug report written for this session yet.</span>
              <button type="button" class="btn-add-note" data-pet-id="${escapeHtml(item.petId)}" data-session-id="${escapeHtml(item.primarySessionId || '')}">
                <span>+ Add Doctor Observation / Issue Note</span>
              </button>
            </div>
          </div>`;
      }

      return `
        <article class="bug-card ${item.hasNotes ? 'bug-card--flagged' : ''}" data-pet-id="${escapeHtml(item.petId)}">
          <div class="bug-card-head">
            <div class="bug-animal-info">
              <span class="bug-avatar">${speciesEmoji}</span>
              <div>
                <h3 class="bug-animal-name">${escapeHtml(item.petName)}</h3>
                <span class="bug-animal-meta">
                  ${escapeHtml(item.species)} · ${escapeHtml(item.breed)} · ID: <span class="bug-id-pill">${escapeHtml(item.displayId)}</span>
                </span>
              </div>
            </div>
            <div class="bug-session-info">
              <span class="bug-session-time">🕒 ${escapeHtml(item.sessionTimeStr)}</span>
              ${item.primarySessionId ? `<span class="bug-session-id" title="${escapeHtml(item.primarySessionId)}">Session: ${escapeHtml(item.primarySessionId.slice(0, 8))}…</span>` : ""}
            </div>
          </div>

          <div class="bug-card-tags">
            ${badges.join("")}
          </div>

          <div class="bug-card-body">
            ${noteBlockHtml}
            ${mediaGalleryHtml}
          </div>

          <div class="bug-card-actions">
            <button type="button" class="btn-action-view-history" data-pet-id="${escapeHtml(item.petId)}">
              <span>View Temperature History</span>
            </button>
            <button type="button" class="btn-action-excel" data-pet-id="${escapeHtml(item.petId)}" title="Export decoded diagnostic forensic trace">
              <span>📊 Download Decoded Log (.xlsx)</span>
            </button>
          </div>
        </article>`;
    }).join("");

    root.innerHTML = `<div class="bug-cards-list">${cardsHtml}</div>`;
  }

  function getSpeciesIcon(species) {
    const s = String(species || "").toLowerCase();
    if (s.includes("dog") || s.includes("canine")) return "🐕";
    if (s.includes("cow") || s.includes("cattle") || s.includes("bovine")) return "🐄";
    if (s.includes("cat") || s.includes("feline")) return "🐈";
    if (s.includes("horse") || s.includes("equine")) return "🐎";
    return "🐾";
  }

  /**
   * Modal: Note Editor
   */
  function openNoteModal(petId, examSessionId, initialNote = "") {
    const item = state.items.find(i => i.petId === petId);
    const petName = item?.petName || "Animal";
    const sessionId = examSessionId || item?.primarySessionId || "";

    const overlay = document.createElement("div");
    overlay.className = "bug-modal-overlay";
    overlay.innerHTML = `
      <div class="bug-modal-dialog" role="dialog" aria-modal="true">
        <div class="bug-modal-head">
          <h3>📝 Report Issue / Doctor Observation</h3>
          <button type="button" class="bug-modal-close" aria-label="Close">✕</button>
        </div>
        <div class="bug-modal-body">
          <div class="bug-form-group">
            <label>Animal:</label>
            <input type="text" class="form-field-input" value="${escapeHtml(petName)} (${escapeHtml(petId.slice(0, 8))}…)" disabled />
          </div>
          <div class="bug-form-group">
            <label>Exam Session ID:</label>
            <input type="text" class="form-field-input" id="modal-session-id" value="${escapeHtml(sessionId)}" placeholder="Session ID" />
          </div>
          <div class="bug-form-group">
            <label>Doctor Notes / Bug Description:</label>
            <textarea id="modal-note-text" class="form-field-textarea" rows="4" placeholder="e.g. Screen stuck at 'Uploading...', Wi-Fi dropped at 10:39 AM, MQTT disconnect proof recorded.">${escapeHtml(initialNote)}</textarea>
          </div>
          <p id="modal-note-error" class="modal-err-msg" hidden></p>
        </div>
        <div class="bug-modal-footer">
          <button type="button" class="btn-modal-cancel">Cancel</button>
          <button type="button" class="btn-modal-save" id="modal-save-btn">
            <span>Save Bug Report</span>
          </button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector(".bug-modal-close").addEventListener("click", close);
    overlay.querySelector(".btn-modal-cancel").addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    const saveBtn = overlay.querySelector("#modal-save-btn");
    const noteInput = overlay.querySelector("#modal-note-text");
    const sessInput = overlay.querySelector("#modal-session-id");
    const errEl = overlay.querySelector("#modal-note-error");

    saveBtn.addEventListener("click", async () => {
      const noteText = noteInput.value.trim();
      const sid = sessInput.value.trim() || sessionId;
      if (!sid) {
        errEl.textContent = "Please provide an Exam Session ID.";
        errEl.hidden = false;
        return;
      }
      saveBtn.disabled = true;
      saveBtn.innerHTML = `<span class="diag-spinner"></span> Saving…`;
      errEl.hidden = true;

      try {
        const client = await ensureClient();
        await client.saveBugReportNotes(petId, {
          examSessionId: sid,
          notes: noteText,
          description: noteText,
        });

        // Update local cache
        const cacheKey = `${petId}::${sid}`;
        state.cachedNotes.set(cacheKey, { notes: noteText, description: noteText, updated_at: new Date().toISOString() });

        // Update item in state
        if (item) {
          item.bugNote = noteText;
          item.hasNotes = Boolean(noteText);
          item.primarySessionId = sid;
        }

        close();
        renderUi();
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = `<span>Save Bug Report</span>`;
        errEl.textContent = `Failed to save: ${err.message || err}`;
        errEl.hidden = false;
      }
    });
  }

  /**
   * Modal: Attach Media / Upload Proof
   */
  function openUploadModal(petId, examSessionId) {
    const item = state.items.find(i => i.petId === petId);
    const petName = item?.petName || "Animal";
    const sessionId = examSessionId || item?.primarySessionId || "";

    const overlay = document.createElement("div");
    overlay.className = "bug-modal-overlay";
    overlay.innerHTML = `
      <div class="bug-modal-dialog" role="dialog" aria-modal="true">
        <div class="bug-modal-head">
          <h3>📸 Upload Photo / Video Proof</h3>
          <button type="button" class="bug-modal-close" aria-label="Close">✕</button>
        </div>
        <div class="bug-modal-body">
          <div class="bug-form-group">
            <label>Animal:</label>
            <input type="text" class="form-field-input" value="${escapeHtml(petName)} (${escapeHtml(petId.slice(0, 8))}…)" disabled />
          </div>
          <div class="bug-form-group">
            <label>Exam Session ID:</label>
            <input type="text" class="form-field-input" id="upload-session-id" value="${escapeHtml(sessionId)}" placeholder="Session ID" />
          </div>
          <div class="bug-form-group">
            <label>Select Proof Image / Video / Screenshot:</label>
            <div class="bug-file-dropzone" id="upload-dropzone">
              <input type="file" id="upload-file-input" accept="image/*,video/*,.png,.jpg,.jpeg,.mp4,.mov" />
              <div class="dropzone-hint">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="dropzone-icon">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                <p>Click or drag photo/screenshot here</p>
                <span class="file-name-preview" id="upload-file-name">No file chosen</span>
              </div>
            </div>
          </div>
          <div class="bug-form-group">
            <label>Proof Title / Label:</label>
            <input type="text" class="form-field-input" id="upload-title" placeholder="e.g. Screen stuck on Uploading 10:39 AM" />
          </div>
          <p id="upload-error" class="modal-err-msg" hidden></p>
          <div class="upload-progress-bar" id="upload-progress-wrap" hidden>
            <div class="upload-progress-fill" id="upload-progress-fill"></div>
          </div>
        </div>
        <div class="bug-modal-footer">
          <button type="button" class="btn-modal-cancel">Cancel</button>
          <button type="button" class="btn-modal-save" id="upload-submit-btn">
            <span>Upload Proof</span>
          </button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector(".bug-modal-close").addEventListener("click", close);
    overlay.querySelector(".btn-modal-cancel").addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    const fileInput = overlay.querySelector("#upload-file-input");
    const namePreview = overlay.querySelector("#upload-file-name");
    const titleInput = overlay.querySelector("#upload-title");
    const sessInput = overlay.querySelector("#upload-session-id");
    const errEl = overlay.querySelector("#upload-error");
    const submitBtn = overlay.querySelector("#upload-submit-btn");
    const progressWrap = overlay.querySelector("#upload-progress-wrap");
    const progressFill = overlay.querySelector("#upload-progress-fill");

    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      if (file) {
        namePreview.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
        if (!titleInput.value) {
          titleInput.value = file.name.replace(/\.[^/.]+$/, "");
        }
      } else {
        namePreview.textContent = "No file chosen";
      }
    });

    submitBtn.addEventListener("click", async () => {
      const file = fileInput.files[0];
      if (!file) {
        errEl.textContent = "Please select a file to upload.";
        errEl.hidden = false;
        return;
      }
      const sid = sessInput.value.trim() || sessionId;
      if (!sid) {
        errEl.textContent = "Please provide an Exam Session ID.";
        errEl.hidden = false;
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span class="diag-spinner"></span> Uploading…`;
      errEl.hidden = true;
      progressWrap.hidden = false;
      progressFill.style.width = "20%";

      try {
        const client = await ensureClient();

        // 1. Request presigned upload URL
        const presigned = await client.presignedUploadUrl({
          petId,
          examSessionId: sid,
          filename: file.name,
          mimeType: file.type || "image/jpeg",
          category: "bug_report",
        });

        progressFill.style.width = "50%";

        const uploadUrl = presigned.upload_url || presigned.url;
        const s3Key = presigned.s3_key || presigned.key;
        const mediaId = presigned.media_id || presigned.id;

        if (!uploadUrl) {
          throw new Error("Server did not return S3 presigned upload URL.");
        }

        // 2. Direct upload to S3
        const s3Res = await fetch(uploadUrl, {
          method: "PUT",
          body: file,
          headers: {
            "Content-Type": file.type || "application/octet-stream",
          },
        });

        if (!s3Res.ok) {
          throw new Error(`S3 upload failed with HTTP ${s3Res.status}`);
        }

        progressFill.style.width = "85%";

        // 3. Confirm media upload
        await client.confirmMediaUpload({
          mediaId,
          s3Key,
          petId,
          examSessionId: sid,
          originalFilename: file.name,
          mimeType: file.type || "image/jpeg",
          fileSizeBytes: file.size,
          category: "bug_report",
          title: titleInput.value.trim() || file.name,
          notes: "",
        });

        progressFill.style.width = "100%";

        close();
        // Refresh page
        loadBugData(getSelectedDate());
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span>Upload Proof</span>`;
        progressWrap.hidden = true;
        errEl.textContent = `Upload failed: ${err.message || err}`;
        errEl.hidden = false;
      }
    });
  }

  /**
   * Modal: Image Preview / Lightbox
   */
  function openLightboxModal(imgUrl, title, category, mediaId) {
    const overlay = document.createElement("div");
    overlay.className = "bug-modal-overlay bug-lightbox-overlay";
    overlay.innerHTML = `
      <div class="bug-lightbox-dialog" role="dialog" aria-modal="true">
        <div class="bug-lightbox-head">
          <div class="lightbox-titles">
            <span class="lightbox-badge">${escapeHtml(category || 'Proof Media')}</span>
            <h4>${escapeHtml(title || 'Attached Clinical Proof')}</h4>
          </div>
          <div class="lightbox-actions">
            <a href="${escapeHtml(imgUrl)}" download target="_blank" class="btn-lightbox-action" title="Download image">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              <span>Download</span>
            </a>
            ${mediaId ? `
              <button type="button" class="btn-lightbox-action btn-lightbox-delete" id="lightbox-del-btn" title="Delete attached proof">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                <span>Delete</span>
              </button>
            ` : ""}
            <button type="button" class="bug-modal-close" aria-label="Close">✕</button>
          </div>
        </div>
        <div class="bug-lightbox-body">
          <img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(title)}" class="lightbox-full-img" />
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector(".bug-modal-close").addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    const delBtn = overlay.querySelector("#lightbox-del-btn");
    if (delBtn && mediaId) {
      delBtn.addEventListener("click", async () => {
        if (!confirm("Are you sure you want to delete this attached media file?")) return;
        delBtn.disabled = true;
        delBtn.innerHTML = `Deleting…`;
        try {
          const client = await ensureClient();
          await client.deleteMedia(mediaId);
          close();
          loadBugData(getSelectedDate());
        } catch (err) {
          alert(`Failed to delete: ${err.message || err}`);
          delBtn.disabled = false;
          delBtn.innerHTML = `<span>Delete</span>`;
        }
      });
    }
  }

  /**
   * Bind event listeners for the page
   */
  function bindUi() {
    // Refresh button
    document.getElementById("bugs-refresh-btn")?.addEventListener("click", () => {
      loadBugData(getSelectedDate());
    });

    // Add general bug button
    document.getElementById("bugs-new-report-btn")?.addEventListener("click", () => {
      if (!state.items.length) {
        alert("No animals evaluated for today yet to attach a report to.");
        return;
      }
      openNoteModal(state.items[0].petId, state.items[0].primarySessionId, "");
    });

    // Search input
    document.getElementById("bugs-search-input")?.addEventListener("input", (e) => {
      state.searchQuery = e.target.value;
      renderUi();
    });

    // Filter tabs
    document.querySelectorAll(".bugs-filter-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".bugs-filter-tab").forEach(t => t.classList.remove("is-active"));
        tab.classList.add("is-active");
        state.currentTab = tab.getAttribute("data-tab") || "all";
        renderUi();
      });
    });

    // Content root event delegation
    const contentRoot = document.getElementById("bugs-content-root");
    if (contentRoot) {
      contentRoot.addEventListener("click", async (e) => {
        // Edit / Add Note
        const noteBtn = e.target.closest(".btn-edit-note, .btn-add-note");
        if (noteBtn) {
          e.stopPropagation();
          const pid = noteBtn.getAttribute("data-pet-id");
          const sid = noteBtn.getAttribute("data-session-id");
          const currentNote = noteBtn.getAttribute("data-note") || "";
          openNoteModal(pid, sid, currentNote);
          return;
        }

        // Attach Media
        const mediaBtn = e.target.closest(".btn-attach-media");
        if (mediaBtn) {
          e.stopPropagation();
          const pid = mediaBtn.getAttribute("data-pet-id");
          const sid = mediaBtn.getAttribute("data-session-id");
          openUploadModal(pid, sid);
          return;
        }

        // Click media thumbnail to view full lightbox
        const thumb = e.target.closest(".bug-media-thumb");
        if (thumb) {
          e.stopPropagation();
          const mediaId = thumb.getAttribute("data-media-id");
          const title = thumb.getAttribute("data-media-title");
          const url = thumb.getAttribute("data-media-url");
          const cat = thumb.getAttribute("data-media-category");
          openLightboxModal(url, title, cat, mediaId);
          return;
        }

        // View animal history
        const histBtn = e.target.closest(".btn-action-view-history");
        if (histBtn) {
          e.stopPropagation();
          const pid = histBtn.getAttribute("data-pet-id");
          global.VetAppPages?.openAnimalHistory?.(pid);
          return;
        }

        // Decoded Excel export
        const excelBtn = e.target.closest(".btn-action-excel");
        if (excelBtn) {
          e.stopPropagation();
          const pid = excelBtn.getAttribute("data-pet-id");
          const date = getSelectedDate();
          const activeDev = global.VetAuth?.getDeviceId?.() || "BRUNO";
          const caseItem = state.items.find(i => i.petId === pid) || { id: pid, name: pid };

          const origText = excelBtn.innerHTML;
          excelBtn.disabled = true;
          excelBtn.innerHTML = `<span class="diag-spinner"></span> Generating Decoded Excel…`;
          try {
            await global.VetDiagInvestigator?.exportCaseDiagnosticExcel?.(caseItem, date, activeDev);
            excelBtn.innerHTML = `✓ Downloaded`;
            setTimeout(() => {
              excelBtn.innerHTML = origText;
              excelBtn.disabled = false;
            }, 2500);
          } catch (err) {
            alert(`Excel export failed: ${err.message || err}`);
            excelBtn.innerHTML = origText;
            excelBtn.disabled = false;
          }
          return;
        }
      });
    }

    // Subscribe to date filter changes
    global.VetDashboardFilters?.subscribe?.((f) => {
      const activeNav = document.querySelector(".nav-item.active")?.getAttribute("data-nav");
      if (activeNav === "bugs") {
        render(state.currentTab);
      }
    });
  }

  /**
   * Main render method invoked when navigating to #/bugs
   */
  function render(tab = "all") {
    state.currentTab = tab;
    const targetDate = getSelectedDate();
    const lbl = document.getElementById("bugs-date-label");
    if (lbl) lbl.textContent = formatDisplayDate(targetDate);
    loadBugData(targetDate);
  }

  function init() {
    bindUi();
  }

  document.addEventListener("DOMContentLoaded", init);

  global.VetBugsPage = {
    render,
    openNoteModal,
    openUploadModal,
    openLightboxModal,
  };
})(window);

