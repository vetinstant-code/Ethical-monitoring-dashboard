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

  function mean(nums) {
    const v = nums.filter((n) => Number.isFinite(n));
    if (!v.length) return null;
    return v.reduce((a, b) => a + b, 0) / v.length;
  }

  function stdev(nums) {
    const v = nums.filter((n) => Number.isFinite(n));
    if (v.length < 2) return 0;
    const m = mean(v);
    const variance = v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1);
    return Math.sqrt(variance);
  }

  function rSquared(exam, ref) {
    const pairs = exam
      .map((e, i) => [e, ref[i]])
      .filter(([e, r]) => Number.isFinite(e) && Number.isFinite(r));
    if (pairs.length < 2) return null;
    const xs = pairs.map((p) => p[0]);
    const ys = pairs.map((p) => p[1]);
    const mx = mean(xs);
    const my = mean(ys);
    let ssRes = 0;
    let ssTot = 0;
    pairs.forEach(([x, y]) => {
      ssRes += (y - x) ** 2;
      ssTot += (y - my) ** 2;
    });
    if (ssTot === 0) return 1;
    return 1 - ssRes / ssTot;
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
    const entries = Object.entries(speciesCounts).sort((a, b) => b[1] - a[1]);
    if (!entries.length) {
      root.innerHTML = `<div class="cv-species-empty">No species data for this date.</div>`;
      return;
    }
    root.innerHTML = entries
      .map(([name, count]) => {
        const style = speciesStyle(name);
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

  function renderRecentCases(cases) {
    const body = document.getElementById("cv-recent-cases-body");
    if (!body) return;
    if (!cases.length) {
      body.innerHTML = `<tr><td colspan="5" class="empty-state">No cases recorded on this date.</td></tr>`;
      return;
    }
    body.innerHTML = cases
      .slice(0, 12)
      .map(
        (c) => `
      <tr class="activity-row-clickable" data-pet-id="${escapeHtml(c.id)}" tabindex="0" role="link">
        <td class="time-col-text">${escapeHtml(c.time)}</td>
        <td><span class="animal-name-bold">${escapeHtml(c.name)}</span></td>
        <td>${escapeHtml(c.species)}</td>
        <td class="vitals-text-bold">${escapeHtml(c.tests)}</td>
        <td><span class="badge-status ${c.statusClass}">${escapeHtml(c.statusLabel)}</span></td>
      </tr>`
      )
      .join("");

    body.querySelectorAll("tr[data-pet-id]").forEach((row) => {
      row.addEventListener("click", () => {
        global.VetAppPages?.openAnimalHistory?.(row.getAttribute("data-pet-id"));
      });
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          global.VetAppPages?.openAnimalHistory?.(row.getAttribute("data-pet-id"));
        }
      });
    });
  }

  function renderCompareTable(rows) {
    const body = document.getElementById("cv-compare-body");
    if (!body) return;
    const valid = rows.filter((r) => r.examD != null && r.reference != null);
    if (!valid.length) {
      body.innerHTML = `<tr><td colspan="5" class="empty-state">No reference comparison data for this date.</td></tr>`;
      document.getElementById("cv-stat-mean").textContent = "—";
      document.getElementById("cv-stat-mae").textContent = "—";
      document.getElementById("cv-stat-sd").textContent = "—";
      document.getElementById("cv-stat-r2").textContent = "—";
      const passEl = document.getElementById("cv-stat-pass");
      if (passEl) {
        passEl.textContent = "—";
        passEl.className = "";
      }
      return;
    }

    body.innerHTML = valid
      .map((r) => {
        const diff = r.examD - r.reference;
        const diffCls = diff <= 0 ? "cv-diff-neg" : "cv-diff-pos";
        return `
        <tr>
          <td class="animal-id-sub">${escapeHtml(String(r.id).slice(0, 10))}</td>
          <td>${escapeHtml(r.species)}</td>
          <td>${r.examD.toFixed(2)}</td>
          <td>${r.reference.toFixed(2)}</td>
          <td class="${diffCls}">${diff >= 0 ? "+" : ""}${diff.toFixed(2)}</td>
        </tr>`;
      })
      .join("");

    const diffs = valid.map((r) => r.examD - r.reference);
    const absDiffs = diffs.map((d) => Math.abs(d));
    const mae = mean(absDiffs);
    const sd = stdev(diffs);
    const r2 = rSquared(
      valid.map((r) => r.examD),
      valid.map((r) => r.reference)
    );
    const pass = mae != null && mae <= 0.2;

    document.getElementById("cv-stat-mean").textContent = `${mean(diffs).toFixed(2)} °C`;
    document.getElementById("cv-stat-mae").textContent = `${mae.toFixed(2)} °C`;
    document.getElementById("cv-stat-sd").textContent = `${sd.toFixed(2)} °C`;
    document.getElementById("cv-stat-r2").textContent = r2 != null ? r2.toFixed(2) : "—";
    const passEl = document.getElementById("cv-stat-pass");
    if (passEl) {
      passEl.textContent = pass ? "PASS" : "FAIL";
      passEl.className = pass ? "cv-pass-ok" : "cv-pass-fail";
    }
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
      ["Completed", "In Progress", "Failed"],
      [statusCounts.completed || 0, statusCounts.inProgress || 0, statusCounts.failed || 0],
      ["#22c55e", "#f59e0b", "#ef4444"]
    );

    const success = statusCounts.completed || 0;
    const failed = statusCounts.failed || 0;
    const tested = totalToday;
    const rate = tested > 0 ? ((success / tested) * 100).toFixed(1) : "0.0";
    document.getElementById("cv-sum-tested").textContent = String(tested);
    document.getElementById("cv-sum-success").textContent = String(success);
    document.getElementById("cv-sum-failed").textContent = String(failed);
    document.getElementById("cv-sum-rate").textContent = `${rate}%`;

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
