/**
 * Clinical Media & Documents Controller
 * Manages clinical case sheets, echocardiograms, medical photography, and video records.
 * Excludes bug_report (handled in Bug Reports page).
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
    currentCategory: "all", // 'all', 'case_sheet', 'echo', 'image', 'video'
    searchQuery: "",
    isLoading: false,
    date: null,
    activeDevice: "BRUNO",
    documents: [],
    allPets: [],
    summary: null,
  };

  const VALID_CATEGORIES = new Set(["case_sheet", "echo", "image", "video"]);

  /**
   * Load media list and summary from backend
   */
  async function loadMediaData() {
    state.isLoading = true;
    renderLoading();

    try {
      const client = await ensureClient();
      const activeDev = (global.VetAuth?.getDeviceId?.() || client.deviceId || "BRUNO").trim();
      state.activeDevice = activeDev;

      // 1. Fetch summary and media list concurrently
      const [sumResp, listResp, petsResp] = await Promise.all([
        client.mediaSummary().catch(() => null),
        client.listMedia({ deviceId: activeDev, limit: 500 }).catch(() => ({ documents: [] })),
        client.listPets().catch(() => []),
      ]);

      state.summary = sumResp;
      state.allPets = global.VetApiNormalize.normalizePets(petsResp);

      const rawDocs = Array.isArray(listResp?.documents) ? listResp.documents : [];

      // Filter strictly to clinical categories (exclude bug_report)
      const clinicalDocs = rawDocs.filter((doc) => {
        const cat = String(doc.category || "").toLowerCase();
        return VALID_CATEGORIES.has(cat);
      });

      // Sort newest first
      clinicalDocs.sort((a, b) => {
        const ta = new Date(a.uploaded_at || 0).getTime();
        const tb = new Date(b.uploaded_at || 0).getTime();
        return tb - ta;
      });

      // Resolve session names (e.g. Session 1, Session 2) via Excel generator logic
      if (global.VetApiAdapter?.resolveSessionLabelsForItems) {
        await global.VetApiAdapter.resolveSessionLabelsForItems(clinicalDocs, client);
      }

      state.documents = clinicalDocs;
      state.isLoading = false;
      renderUi();
    } catch (err) {
      state.isLoading = false;
      console.error("Failed to load clinical media:", err);
      renderError(err.message || String(err));
    }
  }

  function renderLoading() {
    const root = document.getElementById("media-content-root");
    if (!root) return;
    root.innerHTML = `
      <div class="bugs-loading-wrap">
        <div class="bugs-spinner"></div>
        <p>Loading clinical media & documents…</p>
      </div>`;
  }

  function renderError(msg) {
    const root = document.getElementById("media-content-root");
    if (!root) return;
    root.innerHTML = `
      <div class="empty-state bugs-empty-state">
        <p class="bugs-error-title">Failed to load clinical media</p>
        <p class="bugs-error-desc">${escapeHtml(msg)}</p>
        <button type="button" class="btn-refresh-bugs" id="media-err-retry-btn">
          <span>Retry</span>
        </button>
      </div>`;
    document.getElementById("media-err-retry-btn")?.addEventListener("click", () => {
      loadMediaData();
    });
  }

  /**
   * Render media cards, metrics, and filter counts
   */
  function renderUi() {
    const docs = state.documents;

    // Counts by category
    const countCaseSheet = docs.filter((d) => d.category === "case_sheet").length;
    const countEcho = docs.filter((d) => d.category === "echo").length;
    const countImage = docs.filter((d) => d.category === "image").length;
    const countVideo = docs.filter((d) => d.category === "video").length;
    const totalCount = docs.length;

    // Total storage bytes
    const totalBytes = docs.reduce((acc, d) => acc + (Number(d.file_size_bytes) || 0), 0);
    const storageDisplay = formatBytes(totalBytes);

    // Update KPI cards
    const elCaseSheet = document.getElementById("media-count-casesheet");
    const elEcho = document.getElementById("media-count-echo");
    const elImage = document.getElementById("media-count-image");
    const elVideo = document.getElementById("media-count-video");
    const elStorage = document.getElementById("media-count-storage");

    if (elCaseSheet) elCaseSheet.textContent = countCaseSheet;
    if (elEcho) elEcho.textContent = countEcho;
    if (elImage) elImage.textContent = countImage;
    if (elVideo) elVideo.textContent = countVideo;
    if (elStorage) elStorage.textContent = storageDisplay;

    // Update Tab counts
    const tabAllCount = document.getElementById("media-tab-all-count");
    const tabCaseSheetCount = document.getElementById("media-tab-case_sheet-count");
    const tabEchoCount = document.getElementById("media-tab-echo-count");
    const tabImageCount = document.getElementById("media-tab-image-count");
    const tabVideoCount = document.getElementById("media-tab-video-count");

    if (tabAllCount) tabAllCount.textContent = totalCount;
    if (tabCaseSheetCount) tabCaseSheetCount.textContent = countCaseSheet;
    if (tabEchoCount) tabEchoCount.textContent = countEcho;
    if (tabImageCount) tabImageCount.textContent = countImage;
    if (tabVideoCount) tabVideoCount.textContent = countVideo;

    // Filter items based on active tab category
    let filtered = docs.slice();
    if (state.currentCategory && state.currentCategory !== "all") {
      filtered = filtered.filter((d) => d.category === state.currentCategory);
    }

    // Apply search query
    const query = (state.searchQuery || "").trim().toLowerCase();
    if (query) {
      filtered = filtered.filter((d) => {
        const title = String(d.title || d.original_filename || "").toLowerCase();
        const notes = String(d.notes || "").toLowerCase();
        const pet = String(d.pet_name || "").toLowerCase();
        const species = String(d.species || "").toLowerCase();
        const sid = String(d.session_id || "").toLowerCase();
        const cat = String(d.category || "").toLowerCase();
        const sLabel = String(global.VetApiAdapter?.formatSessionLabel?.(d.session_id, d.pet_id) || "").toLowerCase();
        return title.includes(query) || notes.includes(query) || pet.includes(query) || species.includes(query) || sid.includes(query) || cat.includes(query) || sLabel.includes(query);
      });
    }

    const root = document.getElementById("media-content-root");
    if (!root) return;

    if (!filtered.length) {
      let emptyMsg = `No clinical documents found in category "${state.currentCategory}".`;
      if (query) emptyMsg = `No results found matching "${query}".`;
      root.innerHTML = `
        <div class="empty-state bugs-empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="bugs-empty-icon">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
          <p class="bugs-error-title">No Clinical Media</p>
          <p class="bugs-error-desc">${escapeHtml(emptyMsg)}</p>
        </div>`;
      return;
    }

    // Auth config for URLs
    const auth = global.VetAuth?.getSession?.() || {};
    const token = auth.sessionToken || "";
    const dev = auth.deviceId || "BRUNO";
    const apiBase = global.API_CONFIG?.baseUrl || "http://43.205.129.56:8000";

    const cardsHtml = filtered.map((item) => {
      const mediaId = item.id;
      const title = item.title || item.original_filename || "Clinical Document";
      const notes = item.notes ? item.notes.trim() : "";
      const petName = item.pet_name || "Animal";
      const species = item.species || "";
      const deviceId = item.device_id || state.activeDevice;
      const dateStr = item.visit_date || (item.uploaded_at ? item.uploaded_at.slice(0, 10) : "");
      const sessionLabel = global.VetApiAdapter?.formatSessionLabel?.(item.session_id, item.pet_id) || (item.session_id ? `Session (${item.session_id.slice(0, 8)})` : "");
      const sizeStr = item.file_size_bytes ? formatBytes(item.file_size_bytes) : (item.file_size_mb ? `${item.file_size_mb} MB` : "");

      // URLs
      const rawView = item.view_url || `/api/media/${mediaId}/view`;
      const sep = rawView.includes("?") ? "&" : "?";
      const viewUrl = `${apiBase}${rawView}${sep}token=${encodeURIComponent(token)}&dev=${encodeURIComponent(dev)}`;

      const rawDl = item.download_url || `/api/media/${mediaId}/download`;
      const dlSep = rawDl.includes("?") ? "&" : "?";
      const downloadUrl = `${apiBase}${rawDl}${dlSep}token=${encodeURIComponent(token)}&dev=${encodeURIComponent(dev)}`;

      const catBadge = getCategoryBadge(item.category);
      const isVideo = item.category === "video" || item.mime_type?.startsWith("video/");
      const isImage = item.category === "image" || item.category === "echo" || item.mime_type?.startsWith("image/");
      const isPdf = item.mime_type?.includes("pdf") || item.original_filename?.endsWith(".pdf");

      return `
        <article class="clinical-media-card" data-media-id="${escapeHtml(mediaId)}">
          <div class="clinical-media-preview-wrap">
            <span class="clinical-media-badge ${catBadge.className}">${catBadge.label}</span>
            ${isImage ? `
              <img src="${escapeHtml(viewUrl)}" alt="${escapeHtml(title)}" class="clinical-media-img" loading="lazy" onerror="this.classList.add('is-fallback');" />
            ` : isVideo ? `
              <div class="clinical-media-video-thumb">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="video-play-icon">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
                <span>Play Video Clip</span>
              </div>
            ` : `
              <div class="clinical-media-doc-thumb">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                </svg>
                <span>${escapeHtml(isPdf ? 'PDF Document' : 'Clinical Record')}</span>
              </div>
            `}
          </div>

          <div class="clinical-media-details">
            <h4 class="clinical-media-title" title="${escapeHtml(title)}">${escapeHtml(title)}</h4>
            <div class="clinical-media-meta">
              <span>Date: ${escapeHtml(dateStr)}</span>
              ${sessionLabel ? `<span title="ID: ${escapeHtml(item.session_id)}">• ${escapeHtml(sessionLabel)}</span>` : ""}
              ${sizeStr ? `<span>• ${escapeHtml(sizeStr)}</span>` : ""}
              <span>• Device: ${escapeHtml(deviceId)}</span>
              ${petName !== "Animal" ? `<span>• Pet: <strong>${escapeHtml(petName)}</strong> (${escapeHtml(species)})</span>` : ""}
            </div>

            ${notes ? `
              <div class="clinical-media-notes-box">
                <p class="clinical-media-notes-text">${escapeHtml(notes)}</p>
              </div>
            ` : ""}

            <div class="clinical-media-actions">
              <button type="button" class="btn-media-action btn-media-view" data-url="${escapeHtml(viewUrl)}" data-title="${escapeHtml(title)}" data-is-video="${isVideo ? 'true' : 'false'}" data-is-pdf="${isPdf ? 'true' : 'false'}">
                <span>View</span>
              </button>
              <a href="${escapeHtml(downloadUrl)}" download class="btn-media-action btn-media-download" target="_blank">
                <span>Download</span>
              </a>
            </div>
          </div>
        </article>`;
    }).join("");

    root.innerHTML = `<div class="clinical-media-grid">${cardsHtml}</div>`;
  }

  function getCategoryBadge(cat) {
    const c = String(cat || "").toLowerCase();
    if (c === "case_sheet") return { label: "📋 Case Sheet", className: "badge-casesheet" };
    if (c === "echo") return { label: "🫀 Echo / Ultrasound", className: "badge-echo" };
    if (c === "video") return { label: "🎥 Video Record", className: "badge-video" };
    return { label: "📷 Medical Photo", className: "badge-image" };
  }

  /**
   * Modal Lightbox (supports image, video, and PDF)
   */
  function openLightbox(url, title, isVideo, isPdf) {
    const overlay = document.createElement("div");
    overlay.className = "bug-modal-overlay bug-lightbox-overlay";
    overlay.innerHTML = `
      <div class="bug-lightbox-dialog" role="dialog" aria-modal="true">
        <div class="bug-lightbox-head">
          <div class="lightbox-titles">
            <span class="lightbox-badge">Clinical Record</span>
            <h4>${escapeHtml(title || 'Document Preview')}</h4>
          </div>
          <div class="lightbox-actions">
            <a href="${escapeHtml(url)}" download target="_blank" class="btn-lightbox-action">
              <span>Download</span>
            </a>
            <button type="button" class="bug-modal-close" aria-label="Close">✕</button>
          </div>
        </div>
        <div class="bug-lightbox-body">
          ${isVideo ? `
            <video src="${escapeHtml(url)}" controls autoplay class="lightbox-full-video"></video>
          ` : isPdf ? `
            <iframe src="${escapeHtml(url)}" class="lightbox-full-frame" title="PDF Preview"></iframe>
          ` : `
            <img src="${escapeHtml(url)}" alt="${escapeHtml(title)}" class="lightbox-full-img" />
          `}
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
   * Modal: Upload Clinical Document / Media
   */
  function openUploadModal() {
    const overlay = document.createElement("div");
    overlay.className = "bug-modal-overlay";

    // Build pet options
    const petOptions = state.allPets.map((p) => {
      const pid = p.pet_id || p.id;
      const name = p.pet_name || p.name || "Animal";
      const sp = p.species || p.pet_species || "";
      return `<option value="${escapeHtml(pid)}">${escapeHtml(name)} ${sp ? `(${escapeHtml(sp)})` : ''} - ${escapeHtml(pid.slice(0, 8))}…</option>`;
    }).join("");

    overlay.innerHTML = `
      <div class="bug-modal-dialog" role="dialog" aria-modal="true">
        <div class="bug-modal-head">
          <h3>📁 Upload Clinical Document / Media</h3>
          <button type="button" class="bug-modal-close" aria-label="Close">✕</button>
        </div>
        <div class="bug-modal-body">
          <div class="bug-form-group">
            <label>Select Animal:</label>
            <select id="upload-doc-pet" class="form-field-input">
              <option value="">-- Choose Animal --</option>
              ${petOptions}
            </select>
          </div>
          <div class="bug-form-group">
            <label>Category:</label>
            <select id="upload-doc-category" class="form-field-input">
              <option value="case_sheet">📋 Case Sheet</option>
              <option value="image" selected>📷 Medical Photography / Image</option>
              <option value="echo">🫀 Echocardiogram / Ultrasound</option>
              <option value="video">🎥 Clinical Video</option>
            </select>
          </div>
          <div class="bug-form-group">
            <label>Exam Session:</label>
            <select id="upload-doc-session" class="form-field-input">
              <option value="">General (No specific session)</option>
            </select>
          </div>
          <div class="bug-form-group">
            <label>Select Document / File:</label>
            <div class="bug-file-dropzone" id="upload-doc-dropzone">
              <input type="file" id="upload-doc-file-input" accept="image/*,video/*,.pdf,.doc,.docx" />
              <div class="dropzone-hint">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="dropzone-icon">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                <p>Click or drag file here (Images, Videos, PDFs)</p>
                <span class="file-name-preview" id="upload-doc-file-name">No file chosen</span>
              </div>
            </div>
          </div>
          <div class="bug-form-group">
            <label>Document Title / Label:</label>
            <input type="text" class="form-field-input" id="upload-doc-title" placeholder="e.g. Pre-procedure Case Sheet or Thoracic Ultrasound" />
          </div>
          <div class="bug-form-group">
            <label>Clinical Notes / Observations:</label>
            <textarea id="upload-doc-notes" class="form-field-textarea" rows="3" placeholder="Enter any doctor clinical observations or notes..."></textarea>
          </div>
          <p id="upload-doc-error" class="modal-err-msg" hidden></p>
          <div class="upload-progress-bar" id="upload-doc-progress-wrap" hidden>
            <div class="upload-progress-fill" id="upload-doc-progress-fill"></div>
          </div>
        </div>
        <div class="bug-modal-footer">
          <button type="button" class="btn-modal-cancel">Cancel</button>
          <button type="button" class="btn-modal-save" id="upload-doc-submit-btn">
            <span>Upload Document</span>
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

    const fileInput = overlay.querySelector("#upload-doc-file-input");
    const namePreview = overlay.querySelector("#upload-doc-file-name");
    const titleInput = overlay.querySelector("#upload-doc-title");
    const petSelect = overlay.querySelector("#upload-doc-pet");
    const catSelect = overlay.querySelector("#upload-doc-category");
    const sessInput = overlay.querySelector("#upload-doc-session");
    const notesInput = overlay.querySelector("#upload-doc-notes");
    const errEl = overlay.querySelector("#upload-doc-error");
    const submitBtn = overlay.querySelector("#upload-doc-submit-btn");
    const progressWrap = overlay.querySelector("#upload-doc-progress-wrap");
    const progressFill = overlay.querySelector("#upload-doc-progress-fill");

    async function updatePetSessions() {
      const petId = petSelect.value.trim();
      sessInput.innerHTML = `<option value="">General (No specific session)</option>`;
      if (!petId) return;

      try {
        const client = await ensureClient();
        const resp = await client.examSessions(petId);
        const rawList = Array.isArray(resp) ? resp : resp?.exam_sessions || resp?.sessions || [];
        const mapping = global.VetApiAdapter?.sortAndIndexSessions?.(rawList) || {};

        rawList.forEach((s) => {
          const sid = String(s.id || s.exam_session_id || "").trim();
          if (!sid) return;
          const label = mapping[sid] || `Session (${sid.slice(0, 8)})`;
          const dt = s.started_at || s.created_at;
          const timeStr = dt ? new Date(dt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
          const opt = document.createElement("option");
          opt.value = sid;
          opt.textContent = `${label}${timeStr ? ` (${timeStr})` : ""}`;
          sessInput.appendChild(opt);
        });
      } catch (e) {
        console.warn("Failed to load sessions for dropdown:", e);
      }
    }

    petSelect.addEventListener("change", updatePetSessions);
    if (petSelect.value) {
      updatePetSessions();
    }

    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      if (file) {
        namePreview.textContent = `${file.name} (${formatBytes(file.size)})`;
        if (!titleInput.value) {
          titleInput.value = file.name.replace(/\.[^/.]+$/, "");
        }
      } else {
        namePreview.textContent = "No file chosen";
      }
    });

    submitBtn.addEventListener("click", async () => {
      const file = fileInput.files[0];
      const petId = petSelect.value.trim();
      if (!petId) {
        errEl.textContent = "Please select an animal.";
        errEl.hidden = false;
        return;
      }
      if (!file) {
        errEl.textContent = "Please select a file to upload.";
        errEl.hidden = false;
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span class="diag-spinner"></span> Uploading…`;
      errEl.hidden = true;
      progressWrap.hidden = false;
      progressFill.style.width = "25%";

      try {
        const client = await ensureClient();
        const category = catSelect.value || "image";
        const sessionId = sessInput.value.trim() || undefined;
        const title = titleInput.value.trim() || file.name;
        const notes = notesInput.value.trim();

        // 1. Get presigned upload URL
        const presigned = await client.presignedUploadUrl({
          petId,
          sessionId,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          category,
        });

        progressFill.style.width = "55%";

        const uploadUrl = presigned.upload_url || presigned.url;
        const s3Key = presigned.s3_key || presigned.key;
        const mediaId = presigned.media_id || presigned.id;

        if (!uploadUrl) {
          throw new Error("Server did not return S3 presigned upload URL.");
        }

        // 2. Direct S3 Upload
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

        // 3. Confirm media in database
        await client.confirmMediaUpload({
          mediaId,
          s3Key,
          petId,
          sessionId,
          originalFilename: file.name,
          mimeType: file.type || "application/octet-stream",
          fileSizeBytes: file.size,
          category,
          title,
          notes,
        });

        progressFill.style.width = "100%";

        close();
        loadMediaData();
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span>Upload Document</span>`;
        progressWrap.hidden = true;
        errEl.textContent = `Upload failed: ${err.message || err}`;
        errEl.hidden = false;
      }
    });
  }

  /**
   * Event bindings
   */
  function bindUi() {
    // Refresh button
    document.getElementById("media-refresh-btn")?.addEventListener("click", () => {
      loadMediaData();
    });

    // Upload button
    document.getElementById("media-upload-btn")?.addEventListener("click", () => {
      openUploadModal();
    });

    // Search input
    document.getElementById("media-search-input")?.addEventListener("input", (e) => {
      state.searchQuery = e.target.value;
      renderUi();
    });

    // Category filter tabs
    document.querySelectorAll(".media-filter-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".media-filter-tab").forEach((t) => t.classList.remove("is-active"));
        tab.classList.add("is-active");
        state.currentCategory = tab.getAttribute("data-tab") || "all";
        renderUi();
      });
    });

    // Content root event delegation (View)
    const contentRoot = document.getElementById("media-content-root");
    if (contentRoot) {
      contentRoot.addEventListener("click", async (e) => {
        // View button
        const viewBtn = e.target.closest(".btn-media-view");
        if (viewBtn) {
          e.stopPropagation();
          const url = viewBtn.getAttribute("data-url");
          const title = viewBtn.getAttribute("data-title");
          const isVideo = viewBtn.getAttribute("data-is-video") === "true";
          const isPdf = viewBtn.getAttribute("data-is-pdf") === "true";
          openLightbox(url, title, isVideo, isPdf);
          return;
        }
      });
    }
  }

  /**
   * Main render method invoked when navigating to #/media
   */
  function render(cat = "all") {
    state.currentCategory = cat;
    loadMediaData();
  }

  function init() {
    bindUi();
  }

  document.addEventListener("DOMContentLoaded", init);

  global.VetMediaPage = {
    render,
    openUploadModal,
  };
})(window);

