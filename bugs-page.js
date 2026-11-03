/**
 * VetInstant Bug Reports Tracker
 * Displays only the actual bugs reported, descriptions, and uploaded proof media.
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

  function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return "—";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
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

  // State
  const state = {
    currentTab: "today", // 'today' or 'all'
    searchQuery: "",
    isLoading: false,
    date: null,
    activeDevice: "BRUNO",
    allBugDocs: [],
  };

  /**
   * Check if a document matches the target ISO date (YYYY-MM-DD)
   */
  function matchesTargetDate(doc, targetIso) {
    if (!targetIso) return true;
    const parts = targetIso.split("-");
    if (parts.length !== 3) return false;
    const [y, m, d] = parts;
    const ddmmyyyy = `${d}/${m}/${y}`; // e.g. 04/11/2026

    const uploadedIso = String(doc.uploaded_at || "").slice(0, 10);
    const visitDate = String(doc.visit_date || "").trim();

    return uploadedIso === targetIso || visitDate === ddmmyyyy || visitDate === targetIso;
  }

  /**
   * Load bug reports from media list and notes
   */
  async function loadBugReports(targetDate) {
    state.isLoading = true;
    state.date = targetDate;
    renderLoading();

    try {
      const client = await ensureClient();
      const activeDevice = (global.VetAuth?.getDeviceId?.() || client.deviceId || "BRUNO").trim().toUpperCase();
      state.activeDevice = activeDevice;

      // Fetch strictly for current logged-in device and category=bug_report
      const mediaResp = await client.listMedia({
        category: "bug_report",
        deviceId: activeDevice,
        limit: 500,
      }).catch(() => ({ documents: [] }));
      const docs = Array.isArray(mediaResp?.documents) ? mediaResp.documents : [];

      // Filter strictly for category === "bug_report" AND matching active device (case-insensitive)
      const targetDevLower = activeDevice.toLowerCase();
      const bugDocs = docs.filter(doc => {
        const cat = String(doc.category || "").toLowerCase();
        const docDev = String(doc.device_id || "").toLowerCase();
        return cat === "bug_report" && (!targetDevLower || docDev === targetDevLower);
      });

      // Sort newest first
      bugDocs.sort((a, b) => {
        const ta = new Date(a.uploaded_at || 0).getTime();
        const tb = new Date(b.uploaded_at || 0).getTime();
        return tb - ta;
      });

      state.allBugDocs = bugDocs;
      state.isLoading = false;
      renderUi();
    } catch (err) {
      state.isLoading = false;
      console.error("Failed to load bug reports:", err);
      renderError(err.message || String(err));
    }
  }

  function renderLoading() {
    const root = document.getElementById("bugs-content-root");
    if (!root) return;
    root.innerHTML = `
      <div class="bugs-loading-wrap">
        <div class="bugs-spinner"></div>
        <p>Loading bug reports…</p>
      </div>`;
  }

  function renderError(msg) {
    const root = document.getElementById("bugs-content-root");
    if (!root) return;
    root.innerHTML = `
      <div class="empty-state bugs-empty-state">
        <p class="bugs-error-title">Failed to load bug reports</p>
        <p class="bugs-error-desc">${escapeHtml(msg)}</p>
        <button type="button" class="btn-refresh-bugs" id="bugs-err-retry-btn">
          <span>Retry</span>
        </button>
      </div>`;
    document.getElementById("bugs-err-retry-btn")?.addEventListener("click", () => {
      loadBugReports(getSelectedDate());
    });
  }

  /**
   * Render bug cards and metrics
   */
  function renderUi() {
    const allBugs = state.allBugDocs;
    const targetDate = state.date || getSelectedDate();

    // Today's bugs vs all bugs
    const todayBugs = allBugs.filter(b => matchesTargetDate(b, targetDate));

    // Update KPI metrics
    const elToday = document.getElementById("bugs-count-tested");
    const elAll = document.getElementById("bugs-count-issues");
    const elMedia = document.getElementById("bugs-count-media");
    const elClean = document.getElementById("bugs-count-clean");

    if (elToday) elToday.textContent = todayBugs.length;
    if (elAll) elAll.textContent = allBugs.length;
    if (elMedia) elMedia.textContent = allBugs.filter(b => b.mime_type?.startsWith("image/")).length;
    if (elClean) elClean.textContent = state.activeDevice;
    const elCleanLabel = elClean?.parentElement?.querySelector(".bugs-kpi-label");
    if (elCleanLabel) elCleanLabel.textContent = `Active Device (${state.activeDevice})`;

    // Tab counts
    const tabTodayCount = document.getElementById("bugs-tab-today-count");
    const tabAllCount = document.getElementById("bugs-tab-all-count");
    if (tabTodayCount) tabTodayCount.textContent = todayBugs.length;
    if (tabAllCount) tabAllCount.textContent = allBugs.length;

    // Filter items based on active tab
    let itemsToDisplay = state.currentTab === "today" ? todayBugs : allBugs;

    // Apply search filter if query entered
    const query = (state.searchQuery || "").trim().toLowerCase();
    if (query) {
      itemsToDisplay = itemsToDisplay.filter(item => {
        const title = String(item.title || item.original_filename || "").toLowerCase();
        const notes = String(item.notes || "").toLowerCase();
        const pet = String(item.pet_name || "").toLowerCase();
        const species = String(item.species || "").toLowerCase();
        const device = String(item.device_id || "").toLowerCase();
        const sid = String(item.session_id || "").toLowerCase();
        return title.includes(query) || notes.includes(query) || pet.includes(query) || species.includes(query) || device.includes(query) || sid.includes(query);
      });
    }

    const root = document.getElementById("bugs-content-root");
    if (!root) return;

    if (!itemsToDisplay.length) {
      const msg = state.currentTab === "today"
        ? `No bugs reported for device ${state.activeDevice} on ${formatDisplayDate(targetDate)}. Switch to "All Bug Reports" tab above to view previous reports.`
        : `No bug reports found for device ${state.activeDevice}.`;
      root.innerHTML = `
        <div class="empty-state bugs-empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="bugs-empty-icon">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M8 12h8"></path>
          </svg>
          <p class="bugs-error-title">No Bug Reports</p>
          <p class="bugs-error-desc">${escapeHtml(msg)}</p>
        </div>`;
      return;
    }

    // Build auth URLs for viewing / downloading
    const auth = global.VetAuth?.getSession?.() || {};
    const token = auth.sessionToken || "";
    const dev = auth.deviceId || "BRUNO";
    const apiBase = global.API_CONFIG?.baseUrl || "http://43.205.129.56:8000";

    const cardsHtml = itemsToDisplay.map(item => {
      const mediaId = item.id;
      const title = item.title || item.original_filename || "Bug Report Attachment";
      const notes = item.notes ? item.notes.trim() : "";
      const petName = item.pet_name || "Animal";
      const species = item.species || "";
      const deviceId = item.device_id || "BRUNO";
      const dateStr = item.visit_date || (item.uploaded_at ? item.uploaded_at.slice(0, 10) : "");
      const sessionStr = item.session_id ? `Session: ${item.session_id.slice(0, 8)}…` : "";
      const sizeStr = item.file_size_bytes ? formatBytes(item.file_size_bytes) : (item.file_size_mb ? `${item.file_size_mb} MB` : "");

      // Media URLs
      const rawView = item.view_url || `/api/media/${mediaId}/view`;
      const sep = rawView.includes("?") ? "&" : "?";
      const viewUrl = `${apiBase}${rawView}${sep}token=${encodeURIComponent(token)}&dev=${encodeURIComponent(dev)}`;

      const rawDl = item.download_url || `/api/media/${mediaId}/download`;
      const dlSep = rawDl.includes("?") ? "&" : "?";
      const downloadUrl = `${apiBase}${rawDl}${dlSep}token=${encodeURIComponent(token)}&dev=${encodeURIComponent(dev)}`;

      const isImage = !item.mime_type || item.mime_type.startsWith("image/");

      return `
        <article class="bug-report-card" data-media-id="${escapeHtml(mediaId)}">
          <div class="bug-preview-wrap">
            <span class="bug-badge-pill">BUG</span>
            ${isImage ? `
              <img src="${escapeHtml(viewUrl)}" alt="${escapeHtml(title)}" class="bug-preview-img" loading="lazy" onerror="this.classList.add('is-fallback');" />
            ` : `
              <div class="bug-preview-placeholder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                <span>${escapeHtml(item.mime_type || 'Attachment')}</span>
              </div>
            `}
          </div>

          <div class="bug-card-details">
            <h4 class="bug-report-title">${escapeHtml(title)}</h4>
            <div class="bug-report-meta">
              <span>Date: ${escapeHtml(dateStr)}</span>
              ${sessionStr ? `<span>• ${escapeHtml(sessionStr)}</span>` : ""}
              ${sizeStr ? `<span>• ${escapeHtml(sizeStr)}</span>` : ""}
              <span>• Device: ${escapeHtml(deviceId)}</span>
              ${petName !== "Animal" ? `<span>• Pet: ${escapeHtml(petName)} (${escapeHtml(species)})</span>` : ""}
            </div>

            ${notes ? `
              <div class="bug-report-desc-box">
                <p class="bug-report-desc-text">${escapeHtml(notes)}</p>
              </div>
            ` : ""}

            <div class="bug-report-actions">
              <button type="button" class="btn-bug-action btn-bug-view" data-url="${escapeHtml(viewUrl)}" data-title="${escapeHtml(title)}">
                <span>View</span>
              </button>
              <a href="${escapeHtml(downloadUrl)}" download class="btn-bug-action btn-bug-download" target="_blank">
                <span>Download</span>
              </a>
              <button type="button" class="btn-bug-action btn-bug-delete" data-media-id="${escapeHtml(mediaId)}">
                <span>Delete</span>
              </button>
            </div>
          </div>
        </article>`;
    }).join("");

    root.innerHTML = `<div class="bug-report-grid">${cardsHtml}</div>`;
  }

  /**
   * Modal Lightbox
   */
  function openLightbox(url, title) {
    const overlay = document.createElement("div");
    overlay.className = "bug-modal-overlay bug-lightbox-overlay";
    overlay.innerHTML = `
      <div class="bug-lightbox-dialog" role="dialog" aria-modal="true">
        <div class="bug-lightbox-head">
          <div class="lightbox-titles">
            <span class="bug-badge-pill">BUG PROOF</span>
            <h4>${escapeHtml(title || 'Bug Attachment')}</h4>
          </div>
          <div class="lightbox-actions">
            <a href="${escapeHtml(url)}" download target="_blank" class="btn-lightbox-action">
              <span>Download</span>
            </a>
            <button type="button" class="bug-modal-close" aria-label="Close">✕</button>
          </div>
        </div>
        <div class="bug-lightbox-body">
          <img src="${escapeHtml(url)}" alt="${escapeHtml(title)}" class="lightbox-full-img" />
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector(".bug-modal-close").addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
  }

  /**
   * Event bindings
   */
  function bindUi() {
    // Refresh button
    document.getElementById("bugs-refresh-btn")?.addEventListener("click", () => {
      loadBugReports(getSelectedDate());
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
        state.currentTab = tab.getAttribute("data-tab") || "today";
        renderUi();
      });
    });

    // Content root event delegation (View, Delete)
    const contentRoot = document.getElementById("bugs-content-root");
    if (contentRoot) {
      contentRoot.addEventListener("click", async (e) => {
        // View button
        const viewBtn = e.target.closest(".btn-bug-view");
        if (viewBtn) {
          e.stopPropagation();
          const url = viewBtn.getAttribute("data-url");
          const title = viewBtn.getAttribute("data-title");
          openLightbox(url, title);
          return;
        }

        // Delete button
        const delBtn = e.target.closest(".btn-bug-delete");
        if (delBtn) {
          e.stopPropagation();
          const mediaId = delBtn.getAttribute("data-media-id");
          if (!mediaId) return;
          if (!confirm("Are you sure you want to delete this bug report?")) return;

          delBtn.disabled = true;
          delBtn.textContent = "Deleting…";

          try {
            const client = await ensureClient();
            await client.deleteMedia(mediaId);
            state.allBugDocs = state.allBugDocs.filter(d => d.id !== mediaId);
            renderUi();
          } catch (err) {
            alert(`Failed to delete: ${err.message || err}`);
            delBtn.disabled = false;
            delBtn.textContent = "Delete";
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
  function render(tab = "today") {
    state.currentTab = tab;
    const targetDate = getSelectedDate();
    loadBugReports(targetDate);
  }

  function init() {
    bindUi();
  }

  document.addEventListener("DOMContentLoaded", init);

  global.VetBugsPage = {
    render,
  };
})(window);
