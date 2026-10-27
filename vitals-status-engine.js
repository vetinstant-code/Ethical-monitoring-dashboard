/**
 * Clinical Veterinary Vitals & Temperature Range Engine
 * 
 * Defines species-specific physiological temperature baselines, evaluates clinical status
 * (Critical, Mild, Normal, In Progress), and manages interactive clinical rationale popovers.
 */
(function (global) {
  function cToF(c) {
    if (c == null || !Number.isFinite(Number(c))) return null;
    return Number((Number(c) * 1.8 + 32).toFixed(1));
  }

  function fmtTempStr(c) {
    if (c == null || !Number.isFinite(Number(c))) return "—";
    const numC = Number(c);
    const numF = (numC * 1.8 + 32).toFixed(1);
    return `${numC.toFixed(2)} °C (${numF} °F)`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const SPECIES_CONFIGS = {
    dog: {
      key: "dog",
      speciesName: "Dog (Canine)",
      icon: "🐕",
      hypothermiaThreshold: 37.2,
      normalMin: 38.3,
      normalMax: 39.2,
      mildFeverMax: 40.0,
      ranges: {
        hypothermia: "< 37.2 °C (< 99.0 °F)",
        subnormal: "37.2 °C – 38.2 °C (99.0 °F – 100.9 °F)",
        normal: "38.3 °C – 39.2 °C (101.0 °F – 102.5 °F)",
        mildFever: "39.2 °C – 40.0 °C (102.6 °F – 104.0 °F)",
        hyperthermia: "> 40.0 °C (> 104.0 °F)",
      },
      explanations: {
        hypothermia: "A critical emergency that can indicate shock, severe cold exposure, or poor circulation. (Note: Newborn puppies naturally have a lower baseline of 35.0 °C–37.2 °C / 95 °F–99 °F, which rises to the adult range as they mature).",
        subnormal: "Slightly below healthy adult canine baseline (38.3 °C). Can reflect cooler ambient conditions, mild sedation, or young puppy baseline. Keep animal warm and recheck.",
        normal: "Healthy baseline for adult and senior dogs within standard clinical reference limits.",
        mildFever: "Can occur due to excitement, recent exercise, stress, or a mild immune response. Let your dog rest and recheck; consult a veterinarian if it persists or shows symptoms like lethargy.",
        hyperthermia: "A medical emergency. Core temperatures exceeding 40.0 °C (104.0 °F), especially 40.5 °C to 41.0 °C+ (105 °F–106 °F+), risk organ damage, heatstroke, or fatal systemic complications.",
      },
    },
    cat: {
      key: "cat",
      speciesName: "Cat (Feline)",
      icon: "🐈",
      hypothermiaThreshold: 37.2,
      normalMin: 38.1,
      normalMax: 39.2,
      mildFeverMax: 40.0,
      ranges: {
        hypothermia: "< 37.2 °C (< 99.0 °F)",
        subnormal: "37.2 °C – 38.0 °C (99.0 °F – 100.4 °F)",
        normal: "38.1 °C – 39.2 °C (100.5 °F – 102.5 °F)",
        mildFever: "39.2 °C – 40.0 °C (102.6 °F – 104.0 °F)",
        hyperthermia: "> 40.0 °C (> 104.0 °F)",
      },
      explanations: {
        hypothermia: "Critical medical emergency in felines indicating shock, sepsis, severe cold exposure, or cardiovascular collapse.",
        subnormal: "Slightly below standard feline resting baseline (38.1 °C). Monitor for environmental chilling or lethargy.",
        normal: "Healthy baseline for adult cats within standard feline veterinary limits.",
        mildFever: "Mild temperature elevation in felines often triggered by stress, clinic visits, excitement, or early inflammatory response.",
        hyperthermia: "Critical emergency in cats. Temperatures over 40.0 °C risk severe dehydration, cellular damage, and heatstroke.",
      },
    },
    cattle: {
      key: "cattle",
      speciesName: "Cow / Cattle (Bovine)",
      icon: "🐄",
      hypothermiaThreshold: 36.7,
      normalMin: 38.0,
      normalMax: 39.3,
      mildFeverMax: 40.0,
      ranges: {
        hypothermia: "< 36.7 °C (< 98.0 °F)",
        subnormal: "36.7 °C – 37.9 °C (98.0 °F – 100.3 °F)",
        normal: "38.0 °C – 39.3 °C (100.4 °F – 102.8 °F)",
        mildFever: "39.3 °C – 40.0 °C (102.9 °F – 104.0 °F)",
        hyperthermia: "> 40.0 °C (> 104.0 °F)",
      },
      explanations: {
        hypothermia: "Critical emergency in cattle indicating severe shock, milk fever (hypocalcemia), end-stage toxemia, or cold exposure.",
        subnormal: "Below standard bovine resting range. Observe for metabolic disturbances or ruminal stasis.",
        normal: "Normal resting physiological range for adult cattle (calves typically up to 39.5 °C).",
        mildFever: "Mild pyrexia often indicating early bovine respiratory disease, mastitis, or heat stress.",
        hyperthermia: "High fever / severe hyperthermia requiring urgent bovine veterinary assessment and anti-pyretic therapy.",
      },
    },
    horse: {
      key: "horse",
      speciesName: "Horse (Equine)",
      icon: "🐴",
      hypothermiaThreshold: 36.7,
      normalMin: 37.2,
      normalMax: 38.6,
      mildFeverMax: 39.5,
      ranges: {
        hypothermia: "< 36.7 °C (< 98.0 °F)",
        subnormal: "36.7 °C – 37.1 °C (98.0 °F – 98.9 °F)",
        normal: "37.2 °C – 38.6 °C (99.0 °F – 101.5 °F)",
        mildFever: "38.6 °C – 39.5 °C (101.6 °F – 103.1 °F)",
        hyperthermia: "> 39.5 °C (> 103.1 °F)",
      },
      explanations: {
        hypothermia: "Critical low in equines indicating circulatory collapse, severe colic endotoxemia, or profound shock.",
        subnormal: "Slightly subnormal resting temperature. Check equine pulse and peripheral warmth.",
        normal: "Standard healthy resting temperature for adult horses within normal physiological limits.",
        mildFever: "Mild fever or post-exercise elevation. Can indicate early viral infection or inflammatory response.",
        hyperthermia: "Serious equine fever. Temperatures exceeding 39.5 °C – 40.0 °C risk laminitis, dehydration, or systemic endotoxemia.",
      },
    },
  };

  function normalizeSpeciesKey(speciesStr) {
    const raw = String(speciesStr || "").trim().toLowerCase();
    if (raw.includes("cat") || raw.includes("feline")) return "cat";
    if (raw.includes("cow") || raw.includes("cattle") || raw.includes("bovine") || raw.includes("bull") || raw.includes("calf")) return "cattle";
    if (raw.includes("horse") || raw.includes("equine") || raw.includes("mare") || raw.includes("stallion") || raw.includes("foal")) return "horse";
    return "dog"; // Default canine baseline
  }

  function getSpeciesConfig(speciesStr) {
    const key = normalizeSpeciesKey(speciesStr);
    return SPECIES_CONFIGS[key] || SPECIES_CONFIGS.dog;
  }

  /**
   * Evaluates temperature against species clinical ranges.
   * 
   * Returns:
   *  - statusLabel: "Critical" | "Mild" | "Normal" | "In Progress"
   *  - statusClass: "critical" | "mild" | "normal" | "in-progress"
   *  - condition: "Hypothermia (Low)" | "Severe Fever / Hyperthermia" | "Mild Fever / Elevation" | "Subnormal (Mild Low)" | "Normal Range" | "In Progress"
   *  - severity: "Medical Emergency" | "Mild Elevation" | "Healthy Baseline" | "Pending"
   *  - clinicalSummary: human-friendly description
   */
  function evaluateTemperature(temp, species, tests = null) {
    const cfg = getSpeciesConfig(species);
    const hasAudioOnly =
      temp == null &&
      tests &&
      (tests.has?.("Heart Sound") ||
        tests.has?.("Lung Sound") ||
        String(tests).includes("Heart") ||
        String(tests).includes("Lung"));

    if (temp == null) {
      if (hasAudioOnly) {
        return {
          statusLabel: "Normal",
          statusClass: "normal",
          condition: "Auscultation Completed",
          severity: "Healthy Baseline",
          speciesKey: cfg.key,
          speciesName: cfg.speciesName,
          speciesIcon: cfg.icon,
          measuredTempC: null,
          measuredTempF: null,
          measuredStr: "Audio Only (No Temp)",
          ranges: cfg.ranges,
          activeRangeType: "normal",
          clinicalSummary: "Heart/lung acoustic recordings successfully collected. No temperature readings recorded for this session.",
        };
      }

      return {
        statusLabel: "In Progress",
        statusClass: "in-progress",
        condition: "Scheduled / In Progress",
        severity: "Pending",
        speciesKey: cfg.key,
        speciesName: cfg.speciesName,
        speciesIcon: cfg.icon,
        measuredTempC: null,
        measuredTempF: null,
        measuredStr: "No Reading Yet",
        ranges: cfg.ranges,
        activeRangeType: "none",
        clinicalSummary: "Animal scheduled for checkup on this date. Awaiting vitals measurements.",
      };
    }

    const t = Number(temp);
    const measuredStr = fmtTempStr(t);
    const measuredTempF = cToF(t);

    // 1. Critical: Hypothermia (< hypothermiaThreshold)
    if (t < cfg.hypothermiaThreshold) {
      return {
        statusLabel: "Critical",
        statusClass: "critical",
        condition: "Hypothermia (Low)",
        severity: "Medical Emergency",
        speciesKey: cfg.key,
        speciesName: cfg.speciesName,
        speciesIcon: cfg.icon,
        measuredTempC: t,
        measuredTempF,
        measuredStr,
        ranges: cfg.ranges,
        activeRangeType: "hypothermia",
        clinicalSummary: cfg.explanations.hypothermia,
      };
    }

    // 2. Mild: Subnormal (between hypothermiaThreshold and normalMin)
    if (t < cfg.normalMin) {
      return {
        statusLabel: "Mild",
        statusClass: "mild",
        condition: "Subnormal (Mild Low)",
        severity: "Mild Low / Monitor",
        speciesKey: cfg.key,
        speciesName: cfg.speciesName,
        speciesIcon: cfg.icon,
        measuredTempC: t,
        measuredTempF,
        measuredStr,
        ranges: cfg.ranges,
        activeRangeType: "subnormal",
        clinicalSummary: cfg.explanations.subnormal,
      };
    }

    // 3. Normal Range (between normalMin and normalMax)
    if (t <= cfg.normalMax) {
      return {
        statusLabel: "Normal",
        statusClass: "normal",
        condition: "Normal Range",
        severity: "Healthy Baseline",
        speciesKey: cfg.key,
        speciesName: cfg.speciesName,
        speciesIcon: cfg.icon,
        measuredTempC: t,
        measuredTempF,
        measuredStr,
        ranges: cfg.ranges,
        activeRangeType: "normal",
        clinicalSummary: cfg.explanations.normal,
      };
    }

    // 4. Mild: Mild Fever / Elevation (between normalMax and mildFeverMax)
    if (t <= cfg.mildFeverMax) {
      return {
        statusLabel: "Mild",
        statusClass: "mild",
        condition: "Mild Fever / Elevation",
        severity: "Mild Elevation",
        speciesKey: cfg.key,
        speciesName: cfg.speciesName,
        speciesIcon: cfg.icon,
        measuredTempC: t,
        measuredTempF,
        measuredStr,
        ranges: cfg.ranges,
        activeRangeType: "mildFever",
        clinicalSummary: cfg.explanations.mildFever,
      };
    }

    // 5. Critical: Severe Fever / Hyperthermia (> mildFeverMax)
    return {
      statusLabel: "Critical",
      statusClass: "critical",
      condition: "Severe Fever / Hyperthermia",
      severity: "Medical Emergency",
      speciesKey: cfg.key,
      speciesName: cfg.speciesName,
      speciesIcon: cfg.icon,
      measuredTempC: t,
      measuredTempF,
      measuredStr,
      ranges: cfg.ranges,
      activeRangeType: "hyperthermia",
      clinicalSummary: cfg.explanations.hyperthermia,
    };
  }

  // =========================================================================
  // Clinical Trial Protocol Completion Evaluation (Recent Cases)
  // Required: 4 Heart audio + 4 Lung audio + IR Temp + Reference Temp
  // =========================================================================

  function evaluateProtocol({
    heartCount = 0,
    lungCount = 0,
    hasIr = false,
    hasRef = false,
    irTemp = null,
    refTemp = null,
    isScheduled = false,
    animalName = "",
    species = "",
  } = {}) {
    const cfg = getSpeciesConfig(species);
    const hCount = Number(heartCount || 0);
    const lCount = Number(lungCount || 0);
    const heartPass = hCount >= 4;
    const lungPass = lCount >= 4;
    const irPass = Boolean(hasIr || (irTemp != null && Number(irTemp) > 0));
    const refPass = Boolean(hasRef || (refTemp != null && Number(refTemp) > 0));

    const isComplete = heartPass && lungPass && irPass && refPass;
    const hasAnyData = hCount > 0 || lCount > 0 || irPass || refPass;

    let statusLabel = "Completed";
    let statusClass = "completed";
    let condition = "Protocol Completed";
    let severity = "All 4 Protocol Requirements Met";

    const missing = [];
    if (!heartPass) missing.push(`Heart Audio: ${hCount}/4 files recorded`);
    if (!lungPass) missing.push(`Lung Audio: ${lCount}/4 files recorded`);
    if (!irPass) missing.push("Infrared (IR) Temperature missing");
    if (!refPass) missing.push("Reference Thermometer reading missing");

    let clinicalSummary = "";

    if (!hasAnyData && isScheduled) {
      statusLabel = "In Progress";
      statusClass = "in-progress";
      condition = "Scheduled / In Progress";
      severity = "Pending Checkup";
      clinicalSummary = "Animal scheduled on daily roster. Awaiting vital sensors and stethoscope auscultation.";
    } else if (isComplete) {
      statusLabel = "Completed";
      statusClass = "completed";
      condition = "Full Protocol Completed";
      severity = "Complete";
      clinicalSummary = "All clinical validation trial protocol requirements fulfilled: 4 Heart audio files, 4 Lung audio files, IR sensor temperature, and Reference thermometer validation.";
    } else {
      statusLabel = "Incomplete";
      statusClass = "incomplete";
      condition = "Protocol Incomplete";
      severity = `${4 - missing.length}/4 Requirements Met`;
      clinicalSummary = `Missing for complete protocol: ${missing.join("; ")}. All 4 files for heart, 4 files for lung, IR temp, and reference temp are required.`;
    }

    return {
      isProtocol: true,
      statusLabel,
      statusClass,
      condition,
      severity,
      speciesKey: cfg.key,
      speciesName: cfg.speciesName,
      speciesIcon: cfg.icon,
      checklist: {
        heart: { label: "Heart Audio (4 files)", current: hCount, target: 4, pass: heartPass },
        lung: { label: "Lung Audio (4 files)", current: lCount, target: 4, pass: lungPass },
        ir: { label: "IR Temperature", val: irTemp != null ? `${Number(irTemp).toFixed(2)} °C` : null, pass: irPass },
        ref: { label: "Reference Thermometer", val: refTemp != null ? `${Number(refTemp).toFixed(2)} °C` : null, pass: refPass },
      },
      missing,
      clinicalSummary,
    };
  }

  // =========================================================================
  // Popover UI Implementation
  // =========================================================================

  let popoverEl = null;
  let pinnedBadge = null;
  let hoverTimeout = null;

  function ensurePopoverEl() {
    if (popoverEl && document.body.contains(popoverEl)) return popoverEl;
    popoverEl = document.createElement("div");
    popoverEl.className = "vitals-status-popover";
    popoverEl.setAttribute("role", "dialog");
    popoverEl.setAttribute("aria-live", "polite");

    // Allow user to hover into popover smoothly without it closing
    popoverEl.addEventListener("mouseenter", () => {
      clearTimeout(hoverTimeout);
    });
    popoverEl.addEventListener("mouseleave", (e) => {
      if (pinnedBadge) return;
      if (e.relatedTarget && e.relatedTarget.closest?.(".cv-status-badge")) return;
      hoverTimeout = setTimeout(() => hidePopover(false), 150);
    });

    document.body.appendChild(popoverEl);
    return popoverEl;
  }

  function positionPopover(badge, pop) {
    const rect = badge.getBoundingClientRect();
    const popWidth = Math.min(320, window.innerWidth - 32);
    pop.style.width = `${popWidth}px`;

    // Force style compute to get real, rendered height
    pop.style.left = "-9999px";
    pop.style.top = "-9999px";
    pop.style.display = "block";
    const popHeight = pop.offsetHeight || 320;

    const gap = 10;
    const vpHeight = window.innerHeight;
    const vpWidth = window.innerWidth;

    const spaceBelow = vpHeight - rect.bottom;
    const spaceAbove = rect.top;

    let top = 0;
    let left = rect.left + rect.width / 2 - popWidth / 2;

    if (spaceBelow >= popHeight + gap + 10) {
      // Room below
      top = rect.bottom + gap;
    } else if (spaceAbove >= popHeight + gap + 10) {
      // Cleanly above badge: top is rect.top - popHeight - gap, ending strictly gap px above badge
      top = rect.top - popHeight - gap;
    } else {
      // If neither full top nor bottom fits comfortably, place to the side or prioritize larger space
      if (rect.left >= popWidth + gap + 16) {
        left = rect.left - popWidth - gap;
        top = Math.max(12, Math.min(rect.top, vpHeight - popHeight - 12));
      } else if (spaceAbove > spaceBelow) {
        top = Math.max(12, rect.top - popHeight - gap);
      } else {
        top = Math.min(vpHeight - popHeight - 12, rect.bottom + gap);
      }
    }

    // Clamp horizontally inside viewport
    if (left < 16) left = 16;
    if (left + popWidth > vpWidth - 16) {
      left = vpWidth - popWidth - 16;
    }

    // Anti-collision safeguard: ensure popover NEVER overlaps badge bounding rect under mouse cursor
    const vOverlap = (top < rect.bottom && (top + popHeight) > rect.top);
    const hOverlap = (left < rect.right && (left + popWidth) > rect.left);
    if (vOverlap && hOverlap) {
      if (rect.left >= popWidth + gap + 16) {
        left = rect.left - popWidth - gap;
      } else if (spaceAbove >= spaceBelow) {
        top = rect.top - popHeight - gap;
      } else {
        top = rect.bottom + gap;
      }
    }

    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }

  function showPopover(badge, evalData, isClick = false) {
    if (!badge || !evalData) return;
    clearTimeout(hoverTimeout);

    const pop = ensurePopoverEl();
    const badgeCls = evalData.statusClass || "normal";
    const conditionTitle = escapeHtml(evalData.condition || evalData.statusLabel);
    const speciesTitle = `${evalData.speciesIcon || "🐾"} ${escapeHtml(evalData.speciesName || "Animal")}`;

    if (evalData.isProtocol) {
      // Protocol Checklist Popover (Recent Cases)
      const ch = evalData.checklist || {};
      const hPass = !!ch.heart?.pass;
      const lPass = !!ch.lung?.pass;
      const irPass = !!ch.ir?.pass;
      const refPass = !!ch.ref?.pass;

      pop.innerHTML = `
        <div class="vsp-header">
          <span class="vsp-badge-tag ${badgeCls}">
            <span class="badge-status-dot"></span>
            ${escapeHtml(evalData.statusLabel)}
          </span>
          <button type="button" class="vsp-close-btn" aria-label="Close" title="Close">✕</button>
        </div>

        <div class="vsp-species-row">
          <span>${speciesTitle}</span>
          <span style="color:#94a3b8">·</span>
          <span style="font-size:11px;color:#64748b">${escapeHtml(evalData.severity || "Trial Protocol")}</span>
        </div>

        <h4 class="vsp-title">${conditionTitle}</h4>

        <div class="vsp-checklist">
          <div class="vsp-check-item ${hPass ? "pass" : "fail"}">
            <span class="vsp-check-icon">${hPass ? "✓" : "✗"}</span>
            <div class="vsp-check-content">
              <span class="vsp-check-name">🫀 Heart Audio (4 files)</span>
              <span class="vsp-check-status">${ch.heart?.current || 0} / 4 recordings ${hPass ? "(Complete)" : "(Need 4)"}</span>
            </div>
          </div>

          <div class="vsp-check-item ${lPass ? "pass" : "fail"}">
            <span class="vsp-check-icon">${lPass ? "✓" : "✗"}</span>
            <div class="vsp-check-content">
              <span class="vsp-check-name">🫁 Lung Audio (4 files)</span>
              <span class="vsp-check-status">${ch.lung?.current || 0} / 4 recordings ${lPass ? "(Complete)" : "(Need 4)"}</span>
            </div>
          </div>

          <div class="vsp-check-item ${irPass ? "pass" : "fail"}">
            <span class="vsp-check-icon">${irPass ? "✓" : "✗"}</span>
            <div class="vsp-check-content">
              <span class="vsp-check-name">🌡️ Infrared (IR) Temp</span>
              <span class="vsp-check-status">${ch.ir?.val ? escapeHtml(ch.ir.val) : "Missing"}</span>
            </div>
          </div>

          <div class="vsp-check-item ${refPass ? "pass" : "fail"}">
            <span class="vsp-check-icon">${refPass ? "✓" : "✗"}</span>
            <div class="vsp-check-content">
              <span class="vsp-check-name">🩺 Reference Thermometer</span>
              <span class="vsp-check-status">${ch.ref?.val ? escapeHtml(ch.ref.val) : "Missing"}</span>
            </div>
          </div>
        </div>

        <p class="vsp-desc">${escapeHtml(evalData.clinicalSummary || "")}</p>
      `;
    } else {
      // Temperature Clinical Evaluation Popover (Reference vs ExamD Comparison Table)
      const r = evalData.ranges || {};
      const activeType = evalData.activeRangeType;

      pop.innerHTML = `
        <div class="vsp-header">
          <span class="vsp-badge-tag ${badgeCls}">
            <span class="badge-status-dot"></span>
            ${escapeHtml(evalData.statusLabel)}
          </span>
          <button type="button" class="vsp-close-btn" aria-label="Close" title="Close">✕</button>
        </div>

        <div class="vsp-species-row">
          <span>${speciesTitle}</span>
          <span style="color:#94a3b8">·</span>
          <span style="font-size:11px;color:#64748b">${escapeHtml(evalData.severity || "")}</span>
        </div>

        <h4 class="vsp-title">${conditionTitle}</h4>

        <div class="vsp-temp-display">
          <span class="vsp-temp-label">Recorded Temp</span>
          <span class="vsp-temp-val">${escapeHtml(evalData.measuredStr || "—")}</span>
        </div>

        <div class="vsp-ranges-grid">
          <div class="vsp-range-row ${activeType === "normal" ? "highlight" : ""}">
            <span class="vsp-range-label">Normal Range:</span>
            <span class="vsp-range-val">${escapeHtml(r.normal || "—")}</span>
          </div>
          <div class="vsp-range-row ${activeType === "mildFever" ? "highlight" : ""}">
            <span class="vsp-range-label">Mild Fever:</span>
            <span class="vsp-range-val">${escapeHtml(r.mildFever || "—")}</span>
          </div>
          <div class="vsp-range-row ${activeType === "hypothermia" ? "highlight" : ""}">
            <span class="vsp-range-label">Hypothermia (Low):</span>
            <span class="vsp-range-val">${escapeHtml(r.hypothermia || "—")}</span>
          </div>
          <div class="vsp-range-row ${activeType === "hyperthermia" ? "highlight" : ""}">
            <span class="vsp-range-label">Hyperthermia (High):</span>
            <span class="vsp-range-val">${escapeHtml(r.hyperthermia || "—")}</span>
          </div>
        </div>

        <p class="vsp-desc">${escapeHtml(evalData.clinicalSummary || "")}</p>
      `;
    }

    pop.querySelector(".vsp-close-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      hidePopover(true);
    });

    // Position safely without collision
    positionPopover(badge, pop);
    pop.classList.add("is-visible");

    if (isClick) {
      pinnedBadge = badge;
    }
  }

  function hidePopover(force = false) {
    if (pinnedBadge && !force) return;
    if (popoverEl) {
      popoverEl.classList.remove("is-visible");
    }
    pinnedBadge = null;
  }

  function initGlobalListeners() {
    document.addEventListener("click", (e) => {
      const badge = e.target.closest(".cv-status-badge");
      if (badge) {
        e.stopPropagation();
        const raw = badge.getAttribute("data-status-info");
        try {
          const evalData = raw ? JSON.parse(raw) : null;
          if (evalData) {
            if (pinnedBadge === badge) {
              hidePopover(true);
            } else {
              showPopover(badge, evalData, true);
            }
          }
        } catch (err) {
          console.warn("Failed to parse status-info payload", err);
        }
        return;
      }

      if (popoverEl && !popoverEl.contains(e.target)) {
        hidePopover(true);
      }
    });

    document.addEventListener("mouseover", (e) => {
      const badge = e.target.closest(".cv-status-badge");
      if (!badge) return;
      if (pinnedBadge) return; // Keep clicked popover open
      // If moving between elements inside the same badge, do nothing
      if (e.relatedTarget && badge.contains(e.relatedTarget)) {
        return;
      }
      clearTimeout(hoverTimeout);
      const raw = badge.getAttribute("data-status-info");
      try {
        const evalData = raw ? JSON.parse(raw) : null;
        if (evalData) showPopover(badge, evalData, false);
      } catch {
        /* ignore */
      }
    });

    document.addEventListener("mouseout", (e) => {
      const badge = e.target.closest(".cv-status-badge");
      if (!badge) return;
      if (pinnedBadge) return;
      // If moving between child elements of the same badge, do not hide
      if (e.relatedTarget && badge.contains(e.relatedTarget)) {
        return;
      }
      // If moving directly into the popover, keep it open
      if (e.relatedTarget && popoverEl && popoverEl.contains(e.relatedTarget)) {
        return;
      }
      hoverTimeout = setTimeout(() => hidePopover(false), 150);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        hidePopover(true);
      }
    });
  }

  // Helper to render HTML for a badge button with attached status data
  function renderBadgeHtml(evalData) {
    if (!evalData) return `<span class="badge-status normal">—</span>`;
    const jsonStr = escapeHtml(JSON.stringify(evalData));
    const ariaLabel = `${evalData.condition || evalData.statusLabel} (${evalData.speciesName || ""})`;
    return `
      <button type="button" class="badge-status ${evalData.statusClass} cv-status-badge"
        data-status-info="${jsonStr}"
        aria-haspopup="dialog"
        aria-label="${ariaLabel}">
        <span class="badge-status-dot"></span>
        <span>${escapeHtml(evalData.statusLabel)}</span>
      </button>
    `.trim();
  }

  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", initGlobalListeners);
    if (document.readyState === "complete" || document.readyState === "interactive") {
      initGlobalListeners();
    }
  }

  global.VetStatusEngine = {
    evaluate: evaluateTemperature,
    evaluateTemperature,
    evaluateProtocol,
    renderBadgeHtml,
    getSpeciesConfig,
    showPopover,
    hidePopover,
    SPECIES_CONFIGS,
  };
})(window);
