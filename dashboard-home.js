/**
 * Clinical Validation Dashboard — charts, species KPIs, comparison stats.
 */
(function (global) {
  const SPECIES_STYLE = {
    dog: { color: "#3b82f6", icon: "🐕" },
    dogs: { color: "#3b82f6", icon: "🐕" },
    cattle: { color: "#22c55e", icon: "🐄" },
    cow: { color: "#22c55e", icon: "🐄" },
    cat: { color: "#f97316", icon: "🐈" },
    cats: { color: "#f97316", icon: "🐈" },
    horse: { color: "#a855f7", icon: "🐴" },
    horses: { color: "#a855f7", icon: "🐴" },
  };

  const TARGET_ANIMALS = 1000;
  const charts = {};

  function escapeHtml(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function speciesStyle(name) {
    const key = String(name || "").trim().toLowerCase();
    return SPECIES_STYLE[key] || { color: "#64748b", icon: "🐾" };
  }

  function destroyChart(id) {
    if (charts[id]) {
      charts[id].destroy();
      delete charts[id];
    }
  }

  function renderSpeciesCards(speciesCounts, total) {
    const root = document.getElementById("cv-species-cards");
    if (!root) return;

    const counts = speciesCounts || {};

    // Standard 4 species that must ALWAYS be visible in the strip
    const standardSpecies = [
      { id: "dogs", defaultLabel: "Dogs", match: (k) => /dog/i.test(k) },
      { id: "cats", defaultLabel: "Cats", match: (k) => /cat/i.test(k) },
      { id: "cattle", defaultLabel: "Cattle", match: (k) => /cattle|cow|bovine/i.test(k) },
      { id: "horses", defaultLabel: "Horses", match: (k) => /horse|equine/i.test(k) },
    ];

    const renderedItems = [];
    const usedKeys = new Set();

    standardSpecies.forEach(({ id, defaultLabel, match }) => {
      const foundKey = Object.keys(counts).find((k) => match(k));
      let count = 0;
      let label = defaultLabel;
      if (foundKey) {
        usedKeys.add(foundKey);
        count = Number(counts[foundKey]) || 0;
        label = foundKey;
      }
      renderedItems.push({ name: label, count, style: speciesStyle(id) });
    });

    // Also include any other species that might exist in counts
    Object.entries(counts).forEach(([k, v]) => {
      if (!usedKeys.has(k)) {
        renderedItems.push({ name: k, count: Number(v) || 0, style: speciesStyle(k) });
      }
    });

    root.innerHTML = renderedItems
      .map(({ name, count, style }) => {
        const pct = total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
        return `
          <article class="cv-species-card">
            <div class="cv-species-icon" style="background:${style.color}20;color:${style.color}">${style.icon}</div>
            <div class="cv-species-body">
              <span class="cv-species-name">${escapeHtml(name)}</span>
              <strong class="cv-species-count">${count}</strong>
              <div class="cv-species-bar"><div class="cv-species-bar-fill" style="width:${pct}%;background:${style.color}"></div></div>
            </div>
          </article>`;
      })
      .join("");
  }

  function chartDataKey(labels, values) {
    return JSON.stringify({ labels, values });
  }

  function renderDonut(canvasId, labels, values, colors) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !global.Chart) return;
    const filtered = labels
      .map((l, i) => ({ l, v: values[i], c: colors[i] }))
      .filter((x) => x.v > 0);
    const key = chartDataKey(
      filtered.map((x) => x.l),
      filtered.map((x) => x.v)
    );
    const existing = charts[canvasId];
    if (existing && existing._dataKey === key) return;

    destroyChart(canvasId);
    if (!filtered.length) {
      charts[canvasId] = new Chart(canvas, {
        type: "doughnut",
        data: { labels: ["No data"], datasets: [{ data: [1], backgroundColor: ["#e2e8f0"] }] },
        options: { plugins: { legend: { display: false } }, cutout: "65%" },
      });
      charts[canvasId]._dataKey = key;
      return;
    }
    charts[canvasId] = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: filtered.map((x) => x.l),
        datasets: [{ data: filtered.map((x) => x.v), backgroundColor: filtered.map((x) => x.c), borderWidth: 0 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "65%",
        plugins: {
          legend: { position: "right", labels: { boxWidth: 12, font: { size: 11 } } },
        },
      },
    });
    charts[canvasId]._dataKey = key;
  }

  function renderTimeline(hourly) {
    const canvas = document.getElementById("cv-timeline-chart");
    if (!canvas || !global.Chart) return;
    const labels = hourly.map((h) => h.label);
    const data = hourly.map((h) => h.count);
    const key = chartDataKey(labels, data);
    const existing = charts["cv-timeline-chart"];
    if (existing && existing._dataKey === key) return;

    destroyChart("cv-timeline-chart");
    charts["cv-timeline-chart"] = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: "#3b82f6",
            borderRadius: 4,
            barThickness: 14,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } }, grid: { color: "#f1f5f9" } },
        },
      },
    });
    charts["cv-timeline-chart"]._dataKey = key;
  }

  function fmtTemp(v) {
    if (v == null || !Number.isFinite(Number(v))) return "0.00";
    return Number(v).toFixed(2);
  }

  function renderRecentCases(cases) {
    const body = document.getElementById("cv-recent-cases-body");
    if (!body) return;
    if (!cases || !cases.length) {
      body.innerHTML = `<tr><td colspan="6" class="empty-state">No cases recorded on this date.</td></tr>`;
      return;
    }

    // Strict deduplication by Animal Name & ID so no animal is ever rendered twice
    const seen = new Set();
    const uniqueCases = [];
    for (const c of cases) {
      const name = String(c.name || "").trim().toLowerCase();
      const did = String(c.displayId || "").trim().toLowerCase();
      const id = String(c.id || "").trim().toLowerCase();
      const key = name && did && did !== "—" ? `${name}__${did}` : name || id;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueCases.push(c);
      }
    }

    body.innerHTML = uniqueCases
      .map((c) => {
        const badgeHtml = global.VetStatusEngine?.renderBadgeHtml
          ? global.VetStatusEngine.renderBadgeHtml(c.statusInfo || {
              statusLabel: c.statusLabel,
              statusClass: c.statusClass,
              condition: c.statusLabel,
              speciesName: c.species,
              measuredStr: c.temp || "—",
            })
          : `<span class="badge-status ${c.statusClass}"><span class="badge-status-dot"></span><span>${escapeHtml(c.statusLabel)}</span></span>`;

        return `
      <tr class="activity-row-clickable" data-pet-id="${escapeHtml(c.id)}" tabindex="0" role="link">
        <td class="time-col-text">${escapeHtml(c.time)}</td>
        <td><span class="animal-name-bold">${escapeHtml(c.name)}</span></td>
        <td>${escapeHtml(c.displayId || "—")}</td>
        <td>${escapeHtml(c.species)}</td>
        <td class="vitals-text-bold">${escapeHtml(c.tests)}</td>
        <td>${badgeHtml}</td>
      </tr>`;
      })
      .join("");

    body.querySelectorAll("tr[data-pet-id]").forEach((row) => {
      row.addEventListener("click", (e) => {
        if (e.target.closest(".cv-status-badge")) return;
        global.VetAppPages?.openAnimalHistory?.(row.getAttribute("data-pet-id"));
      });
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          if (e.target.closest(".cv-status-badge")) return;
          e.preventDefault();
          global.VetAppPages?.openAnimalHistory?.(row.getAttribute("data-pet-id"));
        }
      });
    });
  }

  function renderCompareTable(rows) {
    const body = document.getElementById("cv-compare-body");
    if (!body) return;
    const valid = (rows || []).filter((r) => r && r.metrics);
    if (!valid.length) {
      body.innerHTML = `<tr><td colspan="16" class="empty-state">No reference comparison data for this date.</td></tr>`;
      return;
    }

    body.innerHTML = valid
      .map((r, idx) => {
        const m = r.metrics || {};
        const pass = r.acceptancePass;
        const passLabel = pass === true ? "PASS" : pass === false ? "FAIL" : "—";
        const passCls =
          pass === true ? "cv-pass-ok" : pass === false ? "cv-pass-fail" : "";
        const errCls =
          pass === true ? "cv-pass-ok" : pass === false ? "cv-pass-fail" : "";

        const clinicalBadge = global.VetStatusEngine?.renderBadgeHtml
          ? global.VetStatusEngine.renderBadgeHtml(r.clinicalStatusInfo || {
              statusLabel: "Normal",
              statusClass: "normal",
              condition: "Normal Range",
              speciesName: r.species,
              measuredStr: r.examD != null ? `${Number(r.examD).toFixed(2)} °C` : "—",
            })
          : `<span class="badge-status normal"><span class="badge-status-dot"></span><span>Normal</span></span>`;

        return `
        <tr class="activity-row-clickable" data-pet-id="${escapeHtml(r.id)}" tabindex="0" role="link">
          <td>${idx + 1}</td>
          <td><span class="animal-name-bold">${escapeHtml(r.name || "—")}</span></td>
          <td>${escapeHtml(r.displayId || "—")}</td>
          <td>${escapeHtml(r.species)}</td>
          <td>${fmtTemp(m.t1)}</td>
          <td>${fmtTemp(m.t2)}</td>
          <td>${fmtTemp(m.t3)}</td>
          <td>${fmtTemp(r.reference)}</td>
          <td class="vitals-text-bold">${fmtTemp(m.mean ?? r.examD)}</td>
          <td>${fmtTemp(m.max)}</td>
          <td>${fmtTemp(m.sd)}</td>
          <td>${fmtTemp(m.range)}</td>
          <td>${fmtTemp(m.errMean)}</td>
          <td class="vitals-text-bold ${errCls}">${fmtTemp(r.errMax)}</td>
          <td class="vitals-text-bold ${passCls}">${passLabel}</td>
          <td>${clinicalBadge}</td>
        </tr>`;
      })
      .join("");

    body.querySelectorAll("tr[data-pet-id]").forEach((row) => {
      row.addEventListener("click", (e) => {
        if (e.target.closest(".cv-status-badge")) return;
        global.VetAppPages?.openAnimalHistory?.(row.getAttribute("data-pet-id"));
      });
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          if (e.target.closest(".cv-status-badge")) return;
          e.preventDefault();
          global.VetAppPages?.openAnimalHistory?.(row.getAttribute("data-pet-id"));
        }
      });
    });

  }

  function renderNotes(notes, dateLabel) {
    const list = document.getElementById("cv-notes-list");
    if (!list) return;
    if (!notes.length) {
      list.innerHTML = `<li>No observations recorded for ${escapeHtml(dateLabel)}.</li>`;
      return;
    }
    list.innerHTML = notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("");
  }

  function render(payload) {
    if (!payload) return;
    const {
      dateLabel,
      totalToday,
      yesterdayCount,
      speciesCounts,
      testCounts,
      hourly,
      statusCounts,
      completedAllTime,
      cases,
      comparisons,
      notes,
    } = payload;

    const elTotal = document.getElementById("kpi-total-animals");
    const elTrend = document.getElementById("kpi-trend-total");
    if (elTotal) elTotal.textContent = String(totalToday);
    if (elTrend) {
      if (yesterdayCount != null && yesterdayCount > 0) {
        const pct = Math.round(((totalToday - yesterdayCount) / yesterdayCount) * 100);
        const arrow = pct >= 0 ? "↑" : "↓";
        elTrend.textContent = `${arrow} ${Math.abs(pct)}% vs yesterday (${yesterdayCount})`;
        elTrend.className = `cv-kpi-trend ${pct >= 0 ? "trend-up" : "trend-down"}`;
      } else {
        elTrend.textContent = `${totalToday} animals on ${dateLabel}`;
        elTrend.className = "cv-kpi-trend";
      }
    }

    renderSpeciesCards(speciesCounts, totalToday);

    const remaining = Math.max(TARGET_ANIMALS - completedAllTime, 0);
    const pctDone = TARGET_ANIMALS > 0 ? (completedAllTime / TARGET_ANIMALS) * 100 : 0;
    document.getElementById("cv-target-count").textContent = String(TARGET_ANIMALS);
    document.getElementById("cv-completed-count").textContent = String(completedAllTime);
    document.getElementById("cv-remaining-count").textContent = String(remaining);
    document.getElementById("cv-progress-fill").style.width = `${Math.min(pctDone, 100)}%`;
    document.getElementById("cv-progress-caption").textContent = `${pctDone.toFixed(1)}% of target completed`;

    renderDonut(
      "cv-tests-chart",
      ["Temperature", "ECG", "SpO2", "Heart Sound", "Lung Sound"],
      [
        testCounts.temperature || 0,
        testCounts.ecg || 0,
        testCounts.spo2 || 0,
        testCounts.heart || 0,
        testCounts.lung || 0,
      ],
      ["#ec4899", "#3b82f6", "#8b5cf6", "#f97316", "#14b8a6"]
    );

    renderTimeline(hourly);

    const distLabels = Object.keys(speciesCounts);
    const distValues = Object.values(speciesCounts);
    const distColors = distLabels.map((l) => speciesStyle(l).color);
    renderDonut("cv-distribution-chart", distLabels, distValues, distColors);

    renderDonut(
      "cv-status-chart",
      ["Completed", "In Progress", "Incomplete"],
      [
        statusCounts?.completed || 0,
        statusCounts?.inProgress || 0,
        statusCounts?.failed || 0,
      ],
      ["#22c55e", "#f59e0b", "#ef4444"]
    );

    const success = statusCounts?.completed || 0;
    const failed = statusCounts?.failed || 0;
    const tested = totalToday || 0;
    const rate =
      tested > 0 ? ((success / tested) * 100).toFixed(1) : "0.0";
    const elTested = document.getElementById("cv-sum-tested");
    const elSuccess = document.getElementById("cv-sum-success");
    const elFailed = document.getElementById("cv-sum-failed");
    const elRate = document.getElementById("cv-sum-rate");
    if (elTested) elTested.textContent = String(tested);
    if (elSuccess) elSuccess.textContent = String(success);
    if (elFailed) elFailed.textContent = String(failed);
    if (elRate) elRate.textContent = `${rate}%`;

    renderRecentCases(cases);
    renderCompareTable(comparisons);
    renderNotes(notes, dateLabel);
  }

  function updateTestCounts(testCounts) {
    renderDonut(
      "cv-tests-chart",
      ["Temperature", "ECG", "SpO2", "Heart Sound", "Lung Sound"],
      [
        testCounts.temperature || 0,
        testCounts.ecg || 0,
        testCounts.spo2 || 0,
        testCounts.heart || 0,
        testCounts.lung || 0,
      ],
      ["#ec4899", "#3b82f6", "#8b5cf6", "#f97316", "#14b8a6"]
    );
  }

  global.VetDashboardHome = { render, updateTestCounts };
})(window);
