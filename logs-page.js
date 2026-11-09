/**
 * VetInstant System & Device Logs Explorer
 * View, search, inspect, and download decoded multi-stream timelines (.xlsx),
 * forensic network speed & telemetry reports (.md), and server/CloudWatch logs.
 * Includes interactive Timing Selection & Filtering across sessions, reports, and log streams.
 */
(function (global) {
  let manifestData = null;
  let activeTab = "all";
  let searchQuery = "";
  let activeTimeSlot = "all";
  let customFromTime = "";
  let customToTime = "";
  let currentModal = null;

  // Stream text cache for full file inspection
  const streamCache = new Map();

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return "—";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  function formatSessionDate(dateStr) {
    if (!dateStr) return "Unknown Date";
    try {
      const parts = dateStr.split("-");
      if (parts.length === 3) {
        const d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
        return new Intl.DateTimeFormat("en-IN", {
          timeZone: "UTC",
          day: "2-digit",
          month: "short",
          year: "numeric",
        }).format(d);
      }
    } catch (_) {}
    return dateStr;
  }

  function timeToMinutes(tStr) {
    if (!tStr) return null;
    const parts = String(tStr).trim().split(":");
    if (parts.length < 2) return null;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
  }

  function extractIstTimeFromLine(line) {
    if (!line) return null;

    // Pattern 1: UTC ISO timestamp e.g. 2026-11-03T03:54:16.944235 or 2026-11-03T04:06:31Z
    const isoMatch = line.match(/T(\d{2}):(\d{2}):(\d{2})/);
    if (isoMatch) {
      const utcHours = parseInt(isoMatch[1], 10);
      const utcMins = parseInt(isoMatch[2], 10);
      const secs = isoMatch[3];
      // Convert UTC to IST (+5:30 = +330 mins)
      const istTotalMinutes = utcHours * 60 + utcMins + 330;
      const istHours = Math.floor(istTotalMinutes / 60) % 24;
      const istMins = istTotalMinutes % 60;
      return {
        hours: istHours,
        minutes: istMins,
        seconds: parseInt(secs, 10),
        timeStr: `${String(istHours).padStart(2, "0")}:${String(istMins).padStart(2, "0")}`,
        fullStr: `${String(istHours).padStart(2, "0")}:${String(istMins).padStart(2, "0")}:${secs}`,
        totalMinutes: istHours * 60 + istMins,
      };
    }

    // Pattern 2: Explicit IST date & time e.g. 2026-11-03 09:36:31
    const istMatch = line.match(/\b(\d{2}):(\d{2}):(\d{2})\b/);
    if (istMatch) {
      const h = parseInt(istMatch[1], 10);
      const m = parseInt(istMatch[2], 10);
      const s = parseInt(istMatch[3], 10);
      return {
        hours: h,
        minutes: m,
        seconds: s,
        timeStr: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
        fullStr: istMatch[0],
        totalMinutes: h * 60 + m,
      };
    }

    // Pattern 3: e.g. 09:49 IST
    const shortMatch = line.match(/\b(\d{2}):(\d{2})\s*IST\b/i);
    if (shortMatch) {
      const h = parseInt(shortMatch[1], 10);
      const m = parseInt(shortMatch[2], 10);
      return {
        hours: h,
        minutes: m,
        seconds: 0,
        timeStr: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
        fullStr: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`,
        totalMinutes: h * 60 + m,
      };
    }

    return null;
  }

  async function loadManifest() {
    const endpoints = [
      "data/logs_manifest.json",
      "/api/logs/manifest",
      "../new_dashboard/data/logs_manifest.json",
    ];

    for (const url of endpoints) {
      try {
        const resp = await fetch(url, { cache: "no-cache" });
        if (resp.ok) {
          const data = await resp.json();
          if (data && Array.isArray(data.sessions)) {
            manifestData = data;
            return manifestData;
          }
        }
      } catch (err) {
        // try next
      }
    }

    throw new Error("Unable to load log manifest from server or local data directory.");
  }

  function parseMarkdownToHtml(md) {
    if (!md) return "<p>No report content available.</p>";

    let text = escapeHtml(md);

    // Code blocks
    text = text.replace(/```([\s\S]*?)```/g, (match, code) => {
      return `<pre class="log-code-block"><code>${code.trim()}</code></pre>`;
    });

    // Inline code
    text = text.replace(/`([^`]+)`/g, '<code class="log-inline-code">$1</code>');

    // Headings with IDs for quick jumping
    text = text.replace(/^### (.*$)/gim, (match, h) => {
      const id = "heading-" + h.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      return `<h3 class="log-report-h3" id="${id}">${h}</h3>`;
    });
    text = text.replace(/^## (.*$)/gim, (match, h) => {
      const id = "heading-" + h.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      return `<h2 class="log-report-h2" id="${id}">${h}</h2>`;
    });
    text = text.replace(/^# (.*$)/gim, '<h1 class="log-report-h1">$1</h1>');

    // Bold
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');

    // Convert Markdown tables
    const lines = text.split("\n");
    const out = [];
    let inTable = false;
    let tableRows = [];

    function flushTable() {
      if (!tableRows.length) return;
      let html = '<div class="log-table-wrapper"><table class="log-report-table">';
      tableRows.forEach((row, idx) => {
        const isHeader = idx === 0;
        const tag = isHeader ? "th" : "td";
        html += "<tr>";
        row.forEach((cell) => {
          let c = cell.trim();
          if (c === "FAIL") c = '<span class="sev-badge sev-fail">FAIL</span>';
          else if (c === "BAD") c = '<span class="sev-badge sev-bad">BAD</span>';
          else if (c === "WEAK") c = '<span class="sev-badge sev-weak">WEAK</span>';
          else if (c === "OK") c = '<span class="sev-badge sev-ok">OK</span>';
          html += `<${tag}>${c}</${tag}>`;
        });
        html += "</tr>";
      });
      html += "</table></div>";
      out.push(html);
      tableRows = [];
      inTable = false;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("|") && line.endsWith("|")) {
        if (/^\|[\s:-|-]+\|$/.test(line)) continue;
        const cells = line.split("|").slice(1, -1);
        tableRows.push(cells);
        inTable = true;
      } else {
        if (inTable) flushTable();
        if (line.startsWith("- ")) {
          let item = line.substring(2);
          item = item.replace(/(\d{2}:\d{2}(?:–\d{2}:\d{2})?\s*IST)/g, '<span class="report-timestamp-tag">⏱️ $1</span>');
          item = item.replace(/\bFAIL\b/g, '<span class="sev-badge sev-fail">FAIL</span>');
          item = item.replace(/\bBAD\b/g, '<span class="sev-badge sev-bad">BAD</span>');
          item = item.replace(/\bWEAK\b/g, '<span class="sev-badge sev-weak">WEAK</span>');
          out.push(`<li class="log-report-bullet">${item}</li>`);
        } else if (line) {
          out.push(`<p class="log-report-p">${line}</p>`);
        } else {
          out.push("");
        }
      }
    }
    if (inTable) flushTable();

    return out.join("\n");
  }

  function downloadFile(url, filename) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || url.split("/").pop();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function openMarkdownModal(session) {
    closeModal();
    const rep = session.report;
    if (!rep || !rep.markdown_content) {
      alert("No markdown report text found for this session.");
      return;
    }

    const modal = document.createElement("div");
    modal.className = "vet-modal-backdrop log-modal-backdrop";
    modal.id = "log-report-modal";

    const title = `${session.date} (${session.time_window}) — Network Speed & Telemetry Forensic Report`;
    const htmlContent = parseMarkdownToHtml(rep.markdown_content);

    // Extract incident moments for timing jump
    const incidentMoments = [];
    const momentRegex = /-\s*\*\*(\d{2}:\d{2}[^\*]*)\*\*\s*—\s*([^\n]+)/g;
    let match;
    while ((match = momentRegex.exec(rep.markdown_content)) !== null) {
      incidentMoments.push({
        time: match[1],
        desc: match[2].substring(0, 40),
      });
    }

    modal.innerHTML = `
      <div class="vet-modal-dialog log-modal-dialog log-modal-report">
        <div class="log-modal-header">
          <div class="log-modal-titles">
            <span class="log-modal-badge">📑 Forensic Speed Analysis</span>
            <h3 class="log-modal-title">${escapeHtml(title)}</h3>
          </div>
          <div class="log-modal-actions">
            <button type="button" class="btn-log-action" id="btn-copy-report" title="Copy markdown text">
              <span>📋 Copy Raw</span>
            </button>
            <button type="button" class="btn-log-action" id="btn-download-md" title="Download .md file">
              <span>📥 Download .md</span>
            </button>
            <button type="button" class="btn-log-close" id="btn-close-log-modal" aria-label="Close">✕</button>
          </div>
        </div>

        <!-- Quick Timing Jump Toolbar -->
        <div class="log-report-timing-jump-bar">
          <div class="jump-bar-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            <span>Jump to Time Window (IST):</span>
          </div>

          <div class="jump-pills-group">
            <button type="button" class="jump-pill-btn" data-target="02_11_2026">02 Nov (09:30 - 12:00)</button>
            <button type="button" class="jump-pill-btn" data-target="03_11_2026">03 Nov (09:30 - 12:00)</button>
            <button type="button" class="jump-pill-btn jump-pill-warn" data-target="bad">⚠️ Problem Timings</button>
          </div>

          ${incidentMoments.length > 0 ? `
            <div class="jump-incident-select-wrap">
              <select class="jump-incident-select" id="report-incident-time-select">
                <option value="">⏱️ Jump to Incident Time...</option>
                ${incidentMoments.map(m => `
                  <option value="${escapeHtml(m.time)}">${escapeHtml(m.time)} — ${escapeHtml(m.desc)}</option>
                `).join("")}
              </select>
            </div>
          ` : ""}
        </div>

        <!-- Quick Summary Ribbon -->
        ${rep.metrics && rep.metrics.has_metrics ? `
          <div class="log-report-metric-ribbon">
            <div class="metric-ribbon-item">
              <span class="m-val">${rep.metrics.speed_samples}</span>
              <span class="m-lbl">Speed Probes</span>
            </div>
            <div class="metric-ribbon-item ribbon-ok">
              <span class="m-val">${rep.metrics.ok}</span>
              <span class="m-lbl">OK Samples</span>
            </div>
            <div class="metric-ribbon-item ribbon-weak">
              <span class="m-val">${rep.metrics.weak}</span>
              <span class="m-lbl">WEAK Samples</span>
            </div>
            <div class="metric-ribbon-item ribbon-bad">
              <span class="m-val">${rep.metrics.bad}</span>
              <span class="m-lbl">BAD Samples</span>
            </div>
            <div class="metric-ribbon-item ribbon-fail">
              <span class="m-val">${rep.metrics.fail}</span>
              <span class="m-lbl">FAIL Probes</span>
            </div>
            <div class="metric-ribbon-item">
              <span class="m-val">${rep.metrics.mean_dl_kbps ? `${rep.metrics.mean_dl_kbps} kbps` : "—"}</span>
              <span class="m-lbl">Mean Download</span>
            </div>
            <div class="metric-ribbon-item">
              <span class="m-val">${rep.metrics.mean_ping_ms ? `${rep.metrics.mean_ping_ms} ms` : "—"}</span>
              <span class="m-lbl">Mean Latency</span>
            </div>
          </div>
        ` : ""}

        <div class="log-modal-body log-markdown-rendered" id="log-markdown-body">
          ${htmlContent}
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    currentModal = modal;

    modal.querySelector("#btn-close-log-modal").addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });

    modal.querySelector("#btn-copy-report")?.addEventListener("click", () => {
      navigator.clipboard.writeText(rep.markdown_content).then(() => {
        const btn = modal.querySelector("#btn-copy-report");
        const orig = btn.innerHTML;
        btn.innerHTML = "<span>✓ Copied!</span>";
        setTimeout(() => (btn.innerHTML = orig), 2000);
      });
    });

    modal.querySelector("#btn-download-md")?.addEventListener("click", () => {
      downloadFile(rep.storage_url, rep.name);
    });

    // Timing jump handlers
    const bodyEl = modal.querySelector("#log-markdown-body");

    modal.querySelectorAll(".jump-pill-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-target");
        let headingMatch = null;
        if (target === "02_11_2026") {
          headingMatch = Array.from(bodyEl.querySelectorAll("h2")).find(h => h.textContent.includes("02_11_2026"));
        } else if (target === "03_11_2026") {
          headingMatch = Array.from(bodyEl.querySelectorAll("h2")).find(h => h.textContent.includes("03_11_2026"));
        } else if (target === "bad") {
          headingMatch = Array.from(bodyEl.querySelectorAll("h3")).find(h => h.textContent.includes("bad") || h.textContent.includes("FAIL"));
        }
        if (headingMatch) {
          headingMatch.scrollIntoView({ behavior: "smooth", block: "start" });
          headingMatch.classList.add("log-heading-highlight");
          setTimeout(() => headingMatch.classList.remove("log-heading-highlight"), 2500);
        }
      });
    });

    modal.querySelector("#report-incident-time-select")?.addEventListener("change", (e) => {
      const selectedTime = e.target.value;
      if (!selectedTime) return;
      const allBullets = Array.from(bodyEl.querySelectorAll("li, p"));
      const matchEl = allBullets.find(el => el.textContent.includes(selectedTime));
      if (matchEl) {
        matchEl.scrollIntoView({ behavior: "smooth", block: "center" });
        matchEl.classList.add("log-incident-highlight");
        setTimeout(() => matchEl.classList.remove("log-incident-highlight"), 3000);
      }
    });
  }

  async function openStreamsModal(session) {
    closeModal();
    const streams = session.log_streams || [];
    if (!streams.length) {
      alert("No raw text streams available for this session.");
      return;
    }

    let activeStreamIdx = 0;
    let streamTimeSlot = "all";
    let streamFromTime = "";
    let streamToTime = "";
    let streamSearchQuery = "";
    let streamText = streams[0]?.snippet || "";
    let isLoadingFull = false;

    const modal = document.createElement("div");
    modal.className = "vet-modal-backdrop log-modal-backdrop";
    modal.id = "log-streams-modal";

    // Build timing slots dynamically based on session time window
    const startM = timeToMinutes(session.start_time) || timeToMinutes("09:30");
    const endM = timeToMinutes(session.end_time) || timeToMinutes("12:00");
    const timeSlots = [{ id: "all", label: `Full Session (${session.time_window})` }];

    if (startM && endM && endM > startM) {
      for (let cur = startM; cur < endM; cur += 30) {
        const next = Math.min(cur + 30, endM);
        const sH = Math.floor(cur / 60);
        const sM = cur % 60;
        const eH = Math.floor(next / 60);
        const eM = next % 60;
        const sStr = `${String(sH).padStart(2, "0")}:${String(sM).padStart(2, "0")}`;
        const eStr = `${String(eH).padStart(2, "0")}:${String(eM).padStart(2, "0")}`;
        timeSlots.push({
          id: `${sStr}-${eStr}`,
          label: `${sStr} - ${eStr}`,
          from: sStr,
          to: eStr,
        });
      }
    }

    async function loadStreamFullText(stream) {
      if (!stream || !stream.storage_url) return stream?.snippet || "";
      if (streamCache.has(stream.storage_url)) {
        return streamCache.get(stream.storage_url);
      }

      isLoadingFull = true;
      updateLoadingNotice(true);
      try {
        const resp = await fetch(stream.storage_url);
        if (resp.ok) {
          const fullText = await resp.text();
          streamCache.set(stream.storage_url, fullText);
          return fullText;
        }
      } catch (err) {
        console.warn("Could not fetch full stream file:", err);
      } finally {
        isLoadingFull = false;
        updateLoadingNotice(false);
      }
      return stream.snippet || "";
    }

    function updateLoadingNotice(loading) {
      const el = modal.querySelector("#stream-loading-notice");
      if (el) el.hidden = !loading;
    }

    function renderModalContent() {
      const activeStream = streams[activeStreamIdx] || streams[0];
      const title = `${session.date} (${session.time_window}) — Subsystem Log Streams`;

      modal.innerHTML = `
        <div class="vet-modal-dialog log-modal-dialog log-modal-terminal">
          <div class="log-modal-header">
            <div class="log-modal-titles">
              <span class="log-modal-badge terminal-badge">🖥️ Telemetry & System Logs</span>
              <h3 class="log-modal-title">${escapeHtml(title)}</h3>
            </div>
            <div class="log-modal-actions">
              <button type="button" class="btn-log-action" id="btn-copy-stream">
                <span>📋 Copy View</span>
              </button>
              <button type="button" class="btn-log-action" id="btn-download-stream">
                <span>📥 Download File</span>
              </button>
              <button type="button" class="btn-log-close" id="btn-close-stream-modal">✕</button>
            </div>
          </div>

          <!-- Stream tabs -->
          <div class="log-stream-tabs">
            ${streams
              .map(
                (s, idx) => `
              <button type="button" class="log-stream-tab ${idx === activeStreamIdx ? "is-active" : ""}" data-idx="${idx}">
                <span class="tab-type-tag">${escapeHtml(s.type)}</span>
                <span class="tab-label">${escapeHtml(s.label)}</span>
                <span class="tab-size">${formatBytes(s.size_bytes)}</span>
              </button>
            `
              )
              .join("")}
          </div>

          <!-- Interactive Timing Filter Bar -->
          <div class="log-stream-timing-bar">
            <div class="stream-timing-label">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              <span>Timing Filter (IST):</span>
            </div>

            <!-- Time slot preset buttons -->
            <div class="stream-time-slot-btns">
              ${timeSlots.map(ts => `
                <button type="button" class="btn-stream-time-slot ${ts.id === streamTimeSlot ? "is-active" : ""}" data-slot="${ts.id}" data-from="${ts.from || ""}" data-to="${ts.to || ""}">
                  ${escapeHtml(ts.label)}
                </button>
              `).join("")}
            </div>

            <!-- Custom From / To Time inside stream viewer -->
            <div class="stream-custom-time-inputs">
              <span class="c-lbl">From:</span>
              <input type="time" class="stream-time-input" id="stream-filter-from" value="${escapeHtml(streamFromTime)}" />
              <span class="c-lbl">To:</span>
              <input type="time" class="stream-time-input" id="stream-filter-to" value="${escapeHtml(streamToTime)}" />
              <button type="button" id="btn-apply-stream-time" class="btn-apply-stream-time">Filter</button>
            </div>
          </div>

          <!-- Search strip inside viewer -->
          <div class="log-viewer-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input type="text" id="log-stream-search-input" value="${escapeHtml(streamSearchQuery)}" placeholder="Search keywords in log (e.g. Heart P, IR, error, connect, upload)..." />
            
            <div class="log-viewer-count-badge" id="stream-lines-counter">
              <span>Lines: 0</span>
            </div>

            <div id="stream-loading-notice" class="stream-loading-notice" hidden>
              <span class="diag-spinner"></span> Loading full file…
            </div>

            <span class="log-viewer-file-info">${escapeHtml(activeStream.filename)} · ${formatBytes(activeStream.size_bytes)}</span>
          </div>

          <div class="log-modal-body log-terminal-body" id="log-terminal-output">
            <div class="empty-terminal-search">Loading log lines…</div>
          </div>
        </div>
      `;

      bindEvents(activeStream);
      applyFilterAndUpdateViewer(activeStream);
    }

    function applyFilterAndUpdateViewer(activeStream) {
      const outEl = modal.querySelector("#log-terminal-output");
      const counterEl = modal.querySelector("#stream-lines-counter");
      if (!outEl) return;

      const lines = streamText.split("\n");
      const totalRawLines = lines.length;
      const q = streamSearchQuery.toLowerCase().trim();

      // Timing bounds in minutes
      let fMin = timeToMinutes(streamFromTime);
      let tMin = timeToMinutes(streamToTime);

      if (streamTimeSlot !== "all" && streamTimeSlot.includes("-")) {
        const parts = streamTimeSlot.split("-");
        fMin = timeToMinutes(parts[0]);
        tMin = timeToMinutes(parts[1]);
      }

      let lastSeenTime = null;
      let matchedCount = 0;
      const renderedLines = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line && !line.trim()) continue;

        const timeInfo = extractIstTimeFromLine(line);
        if (timeInfo) {
          lastSeenTime = timeInfo;
        }

        // Apply Timing Filter if active
        if (fMin !== null && tMin !== null) {
          const curTime = timeInfo || lastSeenTime;
          if (curTime) {
            if (curTime.totalMinutes < fMin || curTime.totalMinutes > tMin) {
              continue;
            }
          }
        }

        // Apply Keyword Filter if active
        if (q && !line.toLowerCase().includes(q)) {
          continue;
        }

        matchedCount++;
        let safe = escapeHtml(line);

        // Highlight matching query
        if (q) {
          const re = new RegExp(`(${escapeRegExp(q)})`, "gi");
          safe = safe.replace(re, '<mark class="log-search-match">$1</mark>');
        }

        // Highlight keywords
        safe = safe.replace(/\b(ERROR|FAIL|FAILED)\b/g, '<span class="log-kw-err">$1</span>');
        safe = safe.replace(/\b(WARN|WARNING)\b/g, '<span class="log-kw-warn">$1</span>');
        safe = safe.replace(/\b(INFO|DEBUG_ON_MSG)\b/g, '<span class="log-kw-info">$1</span>');
        safe = safe.replace(/\b(OK|SUCCESS|CONNECTED)\b/g, '<span class="log-kw-ok">$1</span>');

        // Show IST time badge when present
        const timeBadge = timeInfo ? `<span class="log-ist-badge">IST ${timeInfo.timeStr}</span>` : "";

        renderedLines.push(
          `<div class="log-line"><span class="log-line-num">${matchedCount}</span>${timeBadge}<span class="log-line-text">${safe}</span></div>`
        );

        if (renderedLines.length >= 2000) {
          renderedLines.push(
            `<div class="log-line-overflow">… Truncated for display: showing first 2,000 matches. Use time filters to inspect specific 30-min windows.</div>`
          );
          break;
        }
      }

      if (counterEl) {
        const timeLabel = fMin !== null && tMin !== null ? ` | Time: ${streamTimeSlot}` : "";
        counterEl.innerHTML = `<span><strong>${matchedCount}</strong> lines${timeLabel} (total ${totalRawLines})</span>`;
      }

      if (!renderedLines.length) {
        outEl.innerHTML = `<div class="empty-terminal-search">No log events matching timing "${escapeHtml(streamTimeSlot)}" and query "${escapeHtml(q)}".</div>`;
      } else {
        outEl.innerHTML = renderedLines.join("");
      }
    }

    function escapeRegExp(string) {
      return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function bindEvents(activeStream) {
      modal.querySelector("#btn-close-stream-modal").addEventListener("click", closeModal);
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal();
      });

      // Stream tabs
      modal.querySelectorAll(".log-stream-tab").forEach((btn) => {
        btn.addEventListener("click", async () => {
          activeStreamIdx = Number(btn.getAttribute("data-idx"));
          const nextStream = streams[activeStreamIdx];
          renderModalContent();
          streamText = await loadStreamFullText(nextStream);
          applyFilterAndUpdateViewer(nextStream);
        });
      });

      // Copy
      modal.querySelector("#btn-copy-stream")?.addEventListener("click", () => {
        navigator.clipboard.writeText(streamText || "").then(() => {
          const btn = modal.querySelector("#btn-copy-stream");
          const orig = btn.innerHTML;
          btn.innerHTML = "<span>✓ Copied!</span>";
          setTimeout(() => (btn.innerHTML = orig), 2000);
        });
      });

      // Download
      modal.querySelector("#btn-download-stream")?.addEventListener("click", () => {
        downloadFile(activeStream.storage_url, activeStream.filename);
      });

      // Search input
      const searchInput = modal.querySelector("#log-stream-search-input");
      searchInput?.addEventListener("input", (e) => {
        streamSearchQuery = e.target.value;
        applyFilterAndUpdateViewer(activeStream);
      });

      // Timing preset buttons
      modal.querySelectorAll(".btn-stream-time-slot").forEach(btn => {
        btn.addEventListener("click", () => {
          modal.querySelectorAll(".btn-stream-time-slot").forEach(b => b.classList.remove("is-active"));
          btn.classList.add("is-active");
          streamTimeSlot = btn.getAttribute("data-slot");
          streamFromTime = btn.getAttribute("data-from") || "";
          streamToTime = btn.getAttribute("data-to") || "";

          const fromInp = modal.querySelector("#stream-filter-from");
          const toInp = modal.querySelector("#stream-filter-to");
          if (fromInp) fromInp.value = streamFromTime;
          if (toInp) toInp.value = streamToTime;

          applyFilterAndUpdateViewer(activeStream);
        });
      });

      // Custom time filter inputs inside viewer
      modal.querySelector("#btn-apply-stream-time")?.addEventListener("click", () => {
        const fromVal = modal.querySelector("#stream-filter-from")?.value;
        const toVal = modal.querySelector("#stream-filter-to")?.value;
        if (fromVal && toVal) {
          streamFromTime = fromVal;
          streamToTime = toVal;
          streamTimeSlot = `${fromVal}-${toVal}`;
          modal.querySelectorAll(".btn-stream-time-slot").forEach(b => b.classList.remove("is-active"));
          applyFilterAndUpdateViewer(activeStream);
        }
      });
    }

    renderModalContent();
    document.body.appendChild(modal);
    currentModal = modal;

    // Load full text file in background
    loadStreamFullText(streams[0]).then(full => {
      streamText = full;
      applyFilterAndUpdateViewer(streams[0]);
    });
  }

  function openExcelInfoModal(session) {
    closeModal();
    const xl = session.excel;
    if (!xl) return;

    const modal = document.createElement("div");
    modal.className = "vet-modal-backdrop log-modal-backdrop";
    modal.id = "log-excel-modal";

    const title = `${session.date} — Decoded Multi-Stream Timeline Architecture`;

    modal.innerHTML = `
      <div class="vet-modal-dialog log-modal-dialog log-modal-excel">
        <div class="log-modal-header">
          <div class="log-modal-titles">
            <span class="log-modal-badge excel-badge">📊 Multi-Stream Decoded Spreadsheet</span>
            <h3 class="log-modal-title">${escapeHtml(title)}</h3>
          </div>
          <div class="log-modal-actions">
            <button type="button" class="btn-log-action btn-action-download-xl" id="btn-modal-dl-xl">
              <span>📥 Download ${escapeHtml(xl.name)} (${formatBytes(xl.size_bytes)})</span>
            </button>
            <button type="button" class="btn-log-close" id="btn-close-xl-modal">✕</button>
          </div>
        </div>

        <div class="log-modal-body log-excel-body">
          <div class="excel-overview-box">
            <h4>Synchronized Multi-Layer Forensic Architecture</h4>
            <p>
              This Excel spreadsheet correlates the asynchronous microsecond device telemetry from both microcontrollers
              and the server ingestion database, cross-referencing every sensor reading, packet ACK, and upload state.
            </p>
          </div>

          <div class="excel-sheets-grid">
            <div class="excel-sheet-card">
              <div class="sheet-card-header">
                <span class="sheet-icon">📑</span>
                <h5>Master_Timeline_All_Events</h5>
              </div>
              <p>Full chronological stream combining STM32, ESP32, AWS IoT MQTT ingestion, and Server DB timestamps.</p>
              <div class="sheet-cols">Columns: Seq_No · Time_IST · Layer · Event_Code · Category · Status · Decoded_Meaning · Raw_Payload</div>
            </div>

            <div class="excel-sheet-card">
              <div class="sheet-card-header">
                <span class="sheet-icon">🎧</span>
                <h5>Audio_Flow_Events</h5>
              </div>
              <p>Traces cardiac/pulmonary digital auscultation start commands, 516-byte chunk uploads, sequence tokens, and completion.</p>
              <div class="sheet-cols">Columns: Seq_No · Time_IST · Layer · Event_Code · Status · Decoded_Meaning</div>
            </div>

            <div class="excel-sheet-card">
              <div class="sheet-card-header">
                <span class="sheet-icon">🌡️</span>
                <h5>Temperature_Flow_Events</h5>
              </div>
              <p>Forensic trace of MLX90632 IR ambient/forehead/body temperatures and probe contact states.</p>
              <div class="sheet-cols">Columns: Seq_No · Time_IST · Layer · Event_Code · Status · Decoded_Meaning</div>
            </div>

            <div class="excel-sheet-card">
              <div class="sheet-card-header">
                <span class="sheet-icon">⚙️</span>
                <h5>STM32_Log_Events</h5>
              </div>
              <p>Hardware sensor bus transactions, button presses, battery levels, and UART handshakes.</p>
              <div class="sheet-cols">Columns: Seq_No · Time_IST · Event_Code · Category · Status · Decoded_Meaning</div>
            </div>

            <div class="excel-sheet-card">
              <div class="sheet-card-header">
                <span class="sheet-icon">📶</span>
                <h5>ESP32_Log_Events</h5>
              </div>
              <p>Wi-Fi network connection, RSSI levels, AWS IoT MQTT publish tokens, and server ACKs.</p>
              <div class="sheet-cols">Columns: Seq_No · Time_IST · Event_Code · Category · Status · Decoded_Meaning</div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    currentModal = modal;

    modal.querySelector("#btn-close-xl-modal").addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });

    modal.querySelector("#btn-modal-dl-xl")?.addEventListener("click", () => {
      downloadFile(xl.storage_url, xl.name);
    });
  }

  function closeModal() {
    if (currentModal) {
      currentModal.remove();
      currentModal = null;
    }
    const existing = document.querySelectorAll(".log-modal-backdrop");
    existing.forEach((el) => el.remove());
  }

  function renderCard(session) {
    const formattedDate = formatSessionDate(session.date);
    const xl = session.excel;
    const rep = session.report;
    const streams = session.log_streams || [];

    const hasExcel = Boolean(xl);
    const hasReport = Boolean(rep);

    return `
      <article class="log-session-card" data-session-id="${escapeHtml(session.id)}">
        <!-- Card Header -->
        <div class="log-card-header">
          <div class="log-card-title-group">
            <div class="log-card-date-badge">
              <span class="date-icon">📅</span>
              <span class="date-text">${escapeHtml(formattedDate)}</span>
              <span class="time-window-pill">⏱️ ${escapeHtml(session.time_window)}</span>
            </div>
            <div class="log-card-id">Session: <code>${escapeHtml(session.id)}</code></div>
          </div>

          <div class="log-card-badges">
            <span class="badge-device-tag">BRUNO</span>
            <span class="badge-files-count">${session.total_files} files · ${session.total_size_mb} MB</span>
          </div>
        </div>

        <!-- Forensic Highlights Ribbon (if report present) -->
        ${
          rep && rep.metrics && rep.metrics.has_metrics
            ? `
          <div class="log-card-forensic-bar">
            <div class="forensic-bar-title">Forensic Speed Metrics:</div>
            <div class="forensic-pills">
              <span class="pill-metric pill-ok">OK: ${rep.metrics.ok}</span>
              <span class="pill-metric pill-weak">WEAK: ${rep.metrics.weak}</span>
              <span class="pill-metric pill-bad">BAD: ${rep.metrics.bad}</span>
              <span class="pill-metric pill-fail">FAIL: ${rep.metrics.fail}</span>
              <span class="pill-metric pill-speed">${rep.metrics.speed_samples} probes</span>
              ${rep.metrics.mean_dl_kbps ? `<span class="pill-metric pill-stat">DL: ${rep.metrics.mean_dl_kbps} kbps</span>` : ""}
              ${rep.metrics.mean_ping_ms ? `<span class="pill-metric pill-stat">Ping: ${rep.metrics.mean_ping_ms} ms</span>` : ""}
            </div>
          </div>
        `
            : ""
        }

        <!-- Artifacts Grid -->
        <div class="log-card-artifacts-grid">
          <!-- Decoded Excel Timeline Artifact -->
          <div class="artifact-tile ${hasExcel ? "is-available" : "is-missing"}">
            <div class="tile-icon-box">📊</div>
            <div class="tile-info">
              <div class="tile-title">Decoded Multi-Stream Timeline (.xlsx)</div>
              <div class="tile-desc">
                ${
                  hasExcel
                    ? `${escapeHtml(xl.name)} (${formatBytes(xl.size_bytes)})`
                    : "Raw event decoding not processed for this date."
                }
              </div>
            </div>
            <div class="tile-actions">
              ${
                hasExcel
                  ? `
                <button type="button" class="btn-tile-action btn-tile-download-xl" data-session-id="${escapeHtml(session.id)}" title="Download Excel timeline spreadsheet">
                  <span>📥 Download .xlsx</span>
                </button>
                <button type="button" class="btn-tile-action btn-tile-preview-xl" data-session-id="${escapeHtml(session.id)}" title="View spreadsheet sheet architecture">
                  <span>👁️ Sheets Info</span>
                </button>
              `
                  : `<span class="tile-unavailable-tag">Not Generated</span>`
              }
            </div>
          </div>

          <!-- Forensic Markdown Report Artifact -->
          <div class="artifact-tile ${hasReport ? "is-available" : "is-missing"}">
            <div class="tile-icon-box">📑</div>
            <div class="tile-info">
              <div class="tile-title">Forensic Speed & Telemetry Report (.md)</div>
              <div class="tile-desc">
                ${
                  hasReport
                    ? `${escapeHtml(rep.name)} (${formatBytes(rep.size_bytes)})`
                    : "Network speed audit report not compiled for this date."
                }
              </div>
            </div>
            <div class="tile-actions">
              ${
                hasReport
                  ? `
                <button type="button" class="btn-tile-action btn-tile-view-report" data-session-id="${escapeHtml(session.id)}" title="View report directly in website">
                  <span>👁️ View on Website</span>
                </button>
                <button type="button" class="btn-tile-action btn-tile-download-md" data-session-id="${escapeHtml(session.id)}" title="Download .md report">
                  <span>📥 Download .md</span>
                </button>
                ${
                  session.docx
                    ? `
                  <button type="button" class="btn-tile-action btn-tile-download-docx" data-session-id="${escapeHtml(session.id)}" title="Download formal investigation Word report (.docx)">
                    <span>📄 Download Word (.docx)</span>
                  </button>
                `
                    : ""
                }
              `
                  : `<span class="tile-unavailable-tag">Not Compiled</span>`
              }
            </div>
          </div>

          <!-- Server & CloudWatch Log Streams -->
          <div class="artifact-tile ${streams.length > 0 ? "is-available" : "is-missing"}">
            <div class="tile-icon-box">🖥️</div>
            <div class="tile-info">
              <div class="tile-title">Subsystem & CloudWatch Log Streams</div>
              <div class="tile-desc">
                ${
                  streams.length > 0
                    ? `${streams.length} streams available (Server logs, MQTT traces, CloudWatch telemetry)`
                    : "No text log streams archived in this folder."
                }
              </div>
            </div>
            <div class="tile-actions">
              ${
                streams.length > 0
                  ? `
                <button type="button" class="btn-tile-action btn-tile-view-streams" data-session-id="${escapeHtml(session.id)}" title="Inspect log streams in browser terminal with time filtering">
                  <span>👁️ Inspect Streams (${streams.length})</span>
                </button>
              `
                  : `<span class="tile-unavailable-tag">None Archived</span>`
              }
            </div>
          </div>
        </div>
      </article>
    `;
  }

  function filterSessions() {
    if (!manifestData || !Array.isArray(manifestData.sessions)) return [];

    let list = manifestData.sessions.slice();
    const q = searchQuery.toLowerCase().trim();

    // 1. Keyword search filter
    if (q) {
      list = list.filter((s) => {
        const idMatch = s.id.toLowerCase().includes(q);
        const dateMatch = s.date.toLowerCase().includes(q);
        const timeMatch = (s.time_window || "").toLowerCase().includes(q);
        const xlMatch = s.excel && s.excel.name.toLowerCase().includes(q);
        const repMatch = s.report && s.report.name.toLowerCase().includes(q);
        const subMatch = (s.subdirectories || []).some((sub) => sub.toLowerCase().includes(q));
        return idMatch || dateMatch || timeMatch || xlMatch || repMatch || subMatch;
      });
    }

    // 2. Tab filter
    if (activeTab === "timeline") {
      list = list.filter((s) => Boolean(s.excel));
    } else if (activeTab === "report") {
      list = list.filter((s) => Boolean(s.report));
    } else if (activeTab === "recent") {
      list = list.slice(0, 3);
    }

    // 3. Timing Filter
    if (activeTimeSlot !== "all" || (customFromTime && customToTime)) {
      list = list.filter((s) => {
        const sFrom = timeToMinutes(s.start_time);
        const sTo = timeToMinutes(s.end_time);

        if (sFrom === null || sTo === null) {
          return activeTimeSlot === "all";
        }

        if (customFromTime && customToTime) {
          const reqFrom = timeToMinutes(customFromTime);
          const reqTo = timeToMinutes(customToTime);
          if (reqFrom !== null && reqTo !== null) {
            return Math.max(sFrom, reqFrom) <= Math.min(sTo, reqTo);
          }
        }

        if (activeTimeSlot === "morning") {
          return Math.max(sFrom, 480) <= Math.min(sTo, 720);
        } else if (activeTimeSlot === "afternoon") {
          return Math.max(sFrom, 720) <= Math.min(sTo, 1020);
        } else if (activeTimeSlot === "night") {
          return Math.max(sFrom, 1020) <= Math.min(sTo, 1439);
        } else if (activeTimeSlot.includes("-")) {
          const parts = activeTimeSlot.split("-");
          const reqFrom = timeToMinutes(parts[0]);
          const reqTo = timeToMinutes(parts[1]);
          if (reqFrom !== null && reqTo !== null) {
            return Math.max(sFrom, reqFrom) <= Math.min(sTo, reqTo);
          }
        }

        return true;
      });
    }

    return list;
  }

  function updateKpiAndCounts() {
    if (!manifestData) return;

    const allSessions = manifestData.sessions || [];
    const withXl = allSessions.filter((s) => Boolean(s.excel)).length;
    const withRep = allSessions.filter((s) => Boolean(s.report)).length;
    const recentCount = Math.min(3, allSessions.length);

    const kpiTotal = document.getElementById("logs-kpi-total-sessions");
    const kpiExcel = document.getElementById("logs-kpi-excel-count");
    const kpiRep = document.getElementById("logs-kpi-reports-count");
    const kpiDev = document.getElementById("logs-kpi-device");

    if (kpiTotal) kpiTotal.textContent = String(allSessions.length);
    if (kpiExcel) kpiExcel.textContent = String(withXl);
    if (kpiRep) kpiRep.textContent = String(withRep);
    if (kpiDev) kpiDev.textContent = manifestData.device || "BRUNO";

    const tabAll = document.getElementById("logs-tab-all-count");
    const tabTl = document.getElementById("logs-tab-timeline-count");
    const tabRep = document.getElementById("logs-tab-report-count");
    const tabRec = document.getElementById("logs-tab-recent-count");

    if (tabAll) tabAll.textContent = String(allSessions.length);
    if (tabTl) tabTl.textContent = String(withXl);
    if (tabRep) tabRep.textContent = String(withRep);
    if (tabRec) tabRec.textContent = String(recentCount);

    // Update timing badge
    const badge = document.getElementById("logs-active-timing-badge");
    const badgeTxt = document.getElementById("logs-active-timing-text");
    if (badge && badgeTxt) {
      if (customFromTime && customToTime) {
        badge.hidden = false;
        badgeTxt.textContent = `${customFromTime} - ${customToTime} IST`;
      } else if (activeTimeSlot !== "all") {
        badge.hidden = false;
        const sel = document.getElementById("logs-time-slot-select");
        const optText = sel?.options[sel.selectedIndex]?.text || activeTimeSlot;
        badgeTxt.textContent = optText;
      } else {
        badge.hidden = true;
      }
    }
  }

  function renderList() {
    const root = document.getElementById("logs-content-root");
    if (!root) return;

    const filtered = filterSessions();

    if (!filtered.length) {
      root.innerHTML = `
        <div class="empty-state log-empty-state">
          <div class="empty-icon">📁</div>
          <h3>No matching log sessions found</h3>
          <p>Try clearing your timing window or switching to "All Timings" and "All Sessions".</p>
          <button type="button" class="btn-refresh" id="btn-reset-filters">Reset All Filters</button>
        </div>
      `;
      root.querySelector("#btn-reset-filters")?.addEventListener("click", () => {
        activeTab = "all";
        searchQuery = "";
        activeTimeSlot = "all";
        customFromTime = "";
        customToTime = "";

        const searchInp = document.getElementById("logs-search-input");
        if (searchInp) searchInp.value = "";
        const slotSel = document.getElementById("logs-time-slot-select");
        if (slotSel) slotSel.value = "all";
        const fromInp = document.getElementById("logs-time-from");
        if (fromInp) fromInp.value = "";
        const toInp = document.getElementById("logs-time-to");
        if (toInp) toInp.value = "";

        document.querySelectorAll(".logs-filter-tab").forEach(t => t.classList.toggle("is-active", t.getAttribute("data-tab") === "all"));
        updateKpiAndCounts();
        renderList();
      });
      return;
    }

    root.innerHTML = filtered.map(renderCard).join("\n");
  }

  async function render(filter = "all") {
    activeTab = filter || "all";

    document.querySelectorAll(".logs-filter-tab").forEach((tab) => {
      tab.classList.toggle("is-active", tab.getAttribute("data-tab") === activeTab);
    });

    const root = document.getElementById("logs-content-root");
    if (root && !manifestData) {
      root.innerHTML = `<div class="empty-state"><span class="diag-spinner"></span> Loading forensic log manifests and decoded sessions…</div>`;
    }

    try {
      if (!manifestData) {
        await loadManifest();
      }
      updateKpiAndCounts();
      renderList();
    } catch (err) {
      console.error("[logs] Failed to load manifest:", err);
      if (root) {
        root.innerHTML = `
          <div class="empty-state log-empty-error">
            <div class="empty-icon">⚠️</div>
            <h3>Could not load log manifest</h3>
            <p>${escapeHtml(err.message)}</p>
            <button type="button" class="btn-refresh" id="btn-retry-manifest">Retry Connection</button>
          </div>
        `;
        document.getElementById("btn-retry-manifest")?.addEventListener("click", () => render(activeTab));
      }
    }
  }

  function bindEvents() {
    // Search input
    const searchInput = document.getElementById("logs-search-input");
    searchInput?.addEventListener("input", (e) => {
      searchQuery = e.target.value;
      renderList();
    });

    // Filter tabs
    document.querySelector(".logs-filter-tabs")?.addEventListener("click", (e) => {
      const tab = e.target.closest(".logs-filter-tab");
      if (!tab) return;
      const t = tab.getAttribute("data-tab");
      if (t) {
        activeTab = t;
        document.querySelectorAll(".logs-filter-tab").forEach((b) => {
          b.classList.toggle("is-active", b === tab);
        });
        renderList();
      }
    });

    // Timing Slot Select
    document.getElementById("logs-time-slot-select")?.addEventListener("change", (e) => {
      activeTimeSlot = e.target.value;
      customFromTime = "";
      customToTime = "";
      const fromInp = document.getElementById("logs-time-from");
      const toInp = document.getElementById("logs-time-to");
      if (fromInp) fromInp.value = "";
      if (toInp) toInp.value = "";

      updateKpiAndCounts();
      renderList();
    });

    // Custom Time Filter Apply
    document.getElementById("btn-apply-time-filter")?.addEventListener("click", () => {
      const fromVal = document.getElementById("logs-time-from")?.value;
      const toVal = document.getElementById("logs-time-to")?.value;
      if (fromVal && toVal) {
        customFromTime = fromVal;
        customToTime = toVal;
        activeTimeSlot = "custom";
        const slotSel = document.getElementById("logs-time-slot-select");
        if (slotSel) slotSel.value = "all";
        updateKpiAndCounts();
        renderList();
      }
    });

    // Custom Time Filter Clear
    document.getElementById("btn-clear-time-filter")?.addEventListener("click", () => {
      customFromTime = "";
      customToTime = "";
      activeTimeSlot = "all";
      const fromInp = document.getElementById("logs-time-from");
      const toInp = document.getElementById("logs-time-to");
      const slotSel = document.getElementById("logs-time-slot-select");
      if (fromInp) fromInp.value = "";
      if (toInp) toInp.value = "";
      if (slotSel) slotSel.value = "all";
      updateKpiAndCounts();
      renderList();
    });

    // Refresh button
    document.getElementById("logs-btn-refresh")?.addEventListener("click", async () => {
      const btn = document.getElementById("logs-btn-refresh");
      const origHtml = btn.innerHTML;
      btn.innerHTML = `<span class="diag-spinner"></span> Refreshing…`;
      manifestData = null;
      streamCache.clear();
      try {
        await render(activeTab);
      } finally {
        setTimeout(() => (btn.innerHTML = origHtml), 600);
      }
    });

    // Delegated card actions
    document.getElementById("logs-content-root")?.addEventListener("click", (e) => {
      const card = e.target.closest(".log-session-card");
      if (!card) return;
      const sid = card.getAttribute("data-session-id");
      const session = (manifestData?.sessions || []).find((s) => s.id === sid);
      if (!session) return;

      // 1. Download Excel
      const dlXlBtn = e.target.closest(".btn-tile-download-xl");
      if (dlXlBtn && session.excel) {
        e.stopPropagation();
        downloadFile(session.excel.storage_url, session.excel.name);
        return;
      }

      // 2. Excel Sheets Info Preview
      const prevXlBtn = e.target.closest(".btn-tile-preview-xl");
      if (prevXlBtn) {
        e.stopPropagation();
        openExcelInfoModal(session);
        return;
      }

      // 3. View Report on Website
      const viewRepBtn = e.target.closest(".btn-tile-view-report");
      if (viewRepBtn) {
        e.stopPropagation();
        openMarkdownModal(session);
        return;
      }

      // 4. Download Markdown
      const dlMdBtn = e.target.closest(".btn-tile-download-md");
      if (dlMdBtn && session.report) {
        e.stopPropagation();
        downloadFile(session.report.storage_url, session.report.name);
        return;
      }

      // 4b. Download Word Document (.docx)
      const dlDocxBtn = e.target.closest(".btn-tile-download-docx");
      if (dlDocxBtn && session.docx) {
        e.stopPropagation();
        downloadFile(session.docx.storage_url, session.docx.name);
        return;
      }

      // 5. Inspect Log Streams
      const viewStreamsBtn = e.target.closest(".btn-tile-view-streams");
      if (viewStreamsBtn) {
        e.stopPropagation();
        openStreamsModal(session);
        return;
      }
    });

    // Close modal on Escape
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && currentModal) {
        closeModal();
      }
    });
  }

  document.addEventListener("DOMContentLoaded", bindEvents);

  global.VetLogsPage = {
    render,
    openMarkdownModal,
    openStreamsModal,
    openExcelInfoModal,
    getManifest: () => manifestData,
  };
})(window);
