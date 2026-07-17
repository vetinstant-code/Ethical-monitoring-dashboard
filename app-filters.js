/**
 * Dashboard-only filter state + custom pill dropdowns / calendar.
 */
(function (global) {
  const istDateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const displayFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const monthTitleFmt = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
  });

  const CANONICAL_SPECIES = ["Dogs", "Cattle", "Cats", "Horses"];

  const SPECIES_ALIASES = {
    dog: "Dogs",
    dogs: "Dogs",
    canine: "Dogs",
    canines: "Dogs",
    cat: "Cats",
    cats: "Cats",
    feline: "Cats",
    felines: "Cats",
    cattle: "Cattle",
    cow: "Cattle",
    cows: "Cattle",
    bull: "Cattle",
    buffalo: "Cattle",
    bovine: "Cattle",
    horse: "Horses",
    horses: "Horses",
    equine: "Horses",
    pony: "Horses",
  };

  const TEST_LABELS = {
    all: "All Tests",
    temperature: "Temperature",
    ecg: "ECG",
    spo2: "SpO2",
    heart: "Heart Sound",
    lung: "Lung Sound",
  };

  const listeners = [];
  let calViewYear = null;
  let calViewMonth = null; // 0-11

  function todayIso() {
    return istDateFormatter.format(new Date());
  }

  const filters = {
    date: todayIso(),
    animalType: "all",
    testType: "all",
  };

  function formatDisplay(iso) {
    try {
      return displayFormatter.format(new Date(`${iso}T12:00:00`));
    } catch {
      return iso;
    }
  }

  function canonicalizeSpecies(raw) {
    const text = String(raw || "").trim();
    if (!text) return "";
    const alias = SPECIES_ALIASES[text.toLowerCase()];
    if (alias) return alias;
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function parseIso(iso) {
    const [y, m, d] = String(iso || "").split("-").map(Number);
    if (!y || !m || !d) return new Date();
    return new Date(y, m - 1, d);
  }

  function toIso(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function get() {
    return { ...filters };
  }

  function syncUi() {
    const dateHidden = document.getElementById("dashboard-filter-date");
    const dateLabel = document.getElementById("dashboard-filter-date-label");
    const testLabel = document.getElementById("dashboard-filter-test-label");
    const animalLabel = document.getElementById("dashboard-filter-animal-label");

    if (dateHidden) dateHidden.value = filters.date;
    if (dateLabel) dateLabel.textContent = formatDisplay(filters.date);
    if (testLabel) testLabel.textContent = TEST_LABELS[filters.testType] || "All Tests";
    if (animalLabel) {
      animalLabel.textContent = filters.animalType === "all" ? "All Animals" : filters.animalType;
    }

    document.querySelectorAll("#dash-dd-test-panel .dash-dd-option").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.value === filters.testType);
    });
    document.querySelectorAll("#dash-dd-animal-panel .dash-dd-option").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.value === filters.animalType);
    });
  }

  function notify() {
    syncUi();
    const snapshot = get();
    listeners.forEach((fn) => {
      try {
        fn(snapshot);
      } catch (err) {
        console.warn("[VetDashboardFilters] listener error", err);
      }
    });
    global.dispatchEvent(new CustomEvent("vet:dashboard-filters-changed", { detail: snapshot }));
  }

  function set(next) {
    let changed = false;
    if (next.date && next.date !== filters.date) {
      filters.date = next.date;
      changed = true;
    }
    if (next.animalType != null && next.animalType !== filters.animalType) {
      filters.animalType = next.animalType;
      changed = true;
    }
    if (next.testType != null && next.testType !== filters.testType) {
      filters.testType = next.testType;
      changed = true;
    }
    if (changed) {
      notify();
      return true;
    }
    syncUi();
    return false;
  }

  function getDate() {
    return filters.date || todayIso();
  }

  function subscribe(fn) {
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function matchesAnimalType(species) {
    if (!filters.animalType || filters.animalType === "all") return true;
    const wanted = canonicalizeSpecies(filters.animalType).toLowerCase();
    const actual = canonicalizeSpecies(species).toLowerCase();
    return actual === wanted;
  }

  function matchesTestType(testsSet) {
    const key = filters.testType || "all";
    if (key === "all") return true;
    const map = {
      temperature: "Temperature",
      ecg: "ECG",
      spo2: "SpO2",
      heart: "Heart Sound",
      lung: "Lung Sound",
    };
    const label = map[key];
    if (!label) return true;
    return testsSet.has(label);
  }

  function petSpeciesOf(pet) {
    return canonicalizeSpecies(
      pet?.species ||
        pet?.pet_species ||
        pet?.animal_type ||
        pet?.animal_category ||
        pet?.category ||
        pet?.type ||
        ""
    );
  }

  function triggerDashboardSync() {
    if (typeof global.VetLiveApi?.scheduleForceRefresh === "function") {
      global.VetLiveApi.scheduleForceRefresh();
      return;
    }
    if (typeof global.VetLiveApi?.refreshTodayDashboard === "function") {
      global.VetLiveApi.refreshTodayDashboard({ force: true });
    }
  }

  function applyDate(iso) {
    const value = String(iso || "").trim() || todayIso();
    if (value !== filters.date) {
      filters.date = value;
      notify();
    } else {
      syncUi();
    }
    closeAllDropdowns();
    triggerDashboardSync();
  }

  function applyTest(value) {
    set({ testType: value });
    closeAllDropdowns();
    triggerDashboardSync();
  }

  function applyAnimal(value) {
    set({ animalType: value });
    closeAllDropdowns();
    triggerDashboardSync();
  }

  /* ---------- Custom dropdown open/close ---------- */

  function closeAllDropdowns() {
    document.querySelectorAll(".dash-dd").forEach((dd) => {
      dd.classList.remove("is-open");
      const panel = dd.querySelector(".dash-dd-panel");
      const trigger = dd.querySelector(".dash-dd-trigger");
      if (panel) panel.hidden = true;
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    });
  }

  function toggleDropdown(id) {
    const dd = document.getElementById(id);
    if (!dd) return;
    const wasOpen = dd.classList.contains("is-open");
    closeAllDropdowns();
    if (wasOpen) return;
    dd.classList.add("is-open");
    const panel = dd.querySelector(".dash-dd-panel");
    const trigger = dd.querySelector(".dash-dd-trigger");
    if (panel) panel.hidden = false;
    if (trigger) trigger.setAttribute("aria-expanded", "true");
    if (id === "dash-dd-date") {
      const d = parseIso(filters.date);
      calViewYear = d.getFullYear();
      calViewMonth = d.getMonth();
      renderCalendar();
    }
  }

  /* ---------- Calendar ---------- */

  function renderCalendar() {
    const grid = document.getElementById("dash-cal-grid");
    const title = document.getElementById("dash-cal-title");
    if (!grid) return;

    if (calViewYear == null || calViewMonth == null) {
      const d = parseIso(filters.date);
      calViewYear = d.getFullYear();
      calViewMonth = d.getMonth();
    }

    if (title) title.textContent = monthTitleFmt.format(new Date(calViewYear, calViewMonth, 1));

    const first = new Date(calViewYear, calViewMonth, 1);
    // Monday-first index
    let startDow = first.getDay(); // 0 Sun
    startDow = startDow === 0 ? 6 : startDow - 1;

    const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();
    const today = todayIso();
    const selected = filters.date;

    const cells = [];
    for (let i = 0; i < startDow; i++) {
      cells.push(`<span class="dash-cal-day is-empty"></span>`);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = toIso(calViewYear, calViewMonth, day);
      const cls = [
        "dash-cal-day",
        iso === selected ? "is-selected" : "",
        iso === today ? "is-today" : "",
      ]
        .filter(Boolean)
        .join(" ");
      cells.push(`<button type="button" class="${cls}" data-date="${iso}">${day}</button>`);
    }
    grid.innerHTML = cells.join("");
  }

  async function populateAnimalTypes() {
    const panel = document.getElementById("dash-dd-animal-panel");
    if (!panel) return;
    if (!global.VetAuth?.isLoggedIn?.()) return;

    const found = new Set(CANONICAL_SPECIES);
    try {
      const client = await global.VetLiveApi?.ensureClient?.();
      const pets =
        global.VetLiveApi?.getPets?.() ||
        (client && global.VetApiNormalize
          ? global.VetApiNormalize.normalizePets(await client.listPets())
          : []);
      (pets || []).forEach((p) => {
        const s = petSpeciesOf(p);
        if (s) found.add(s);
      });
    } catch {
      /* keep canonical */
    }

    const ordered = [
      ...CANONICAL_SPECIES,
      ...[...found].filter((s) => !CANONICAL_SPECIES.includes(s)).sort((a, b) => a.localeCompare(b)),
    ];

    const current = filters.animalType || "all";
    panel.innerHTML =
      `<button type="button" class="dash-dd-option${current === "all" ? " is-active" : ""}" data-value="all" role="option">All Animals</button>` +
      ordered
        .map(
          (s) =>
            `<button type="button" class="dash-dd-option${current === s ? " is-active" : ""}" data-value="${s.replace(/"/g, "&quot;")}" role="option">${s}</button>`
        )
        .join("");
  }

  function bindUi() {
    document.getElementById("dashboard-filter-date-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDropdown("dash-dd-date");
    });
    document.getElementById("dashboard-filter-test-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDropdown("dash-dd-test");
    });
    document.getElementById("dashboard-filter-animal-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDropdown("dash-dd-animal");
    });

    document.getElementById("dash-cal-prev")?.addEventListener("click", (e) => {
      e.stopPropagation();
      calViewMonth -= 1;
      if (calViewMonth < 0) {
        calViewMonth = 11;
        calViewYear -= 1;
      }
      renderCalendar();
    });
    document.getElementById("dash-cal-next")?.addEventListener("click", (e) => {
      e.stopPropagation();
      calViewMonth += 1;
      if (calViewMonth > 11) {
        calViewMonth = 0;
        calViewYear += 1;
      }
      renderCalendar();
    });
    document.getElementById("dash-cal-today")?.addEventListener("click", (e) => {
      e.stopPropagation();
      applyDate(todayIso());
    });

    document.getElementById("dash-cal-grid")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-date]");
      if (!btn) return;
      e.stopPropagation();
      applyDate(btn.getAttribute("data-date"));
    });

    document.getElementById("dash-dd-test-panel")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".dash-dd-option");
      if (!btn) return;
      e.stopPropagation();
      applyTest(btn.dataset.value);
    });

    document.getElementById("dash-dd-animal-panel")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".dash-dd-option");
      if (!btn) return;
      e.stopPropagation();
      applyAnimal(btn.dataset.value);
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".dash-dd")) closeAllDropdowns();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAllDropdowns();
    });
  }

  function showBar(visible) {
    const chrome = document.getElementById("dashboard-header-chrome");
    const bar = document.getElementById("dashboard-header-filters");
    if (chrome) chrome.hidden = !visible;
    if (bar) bar.hidden = !visible;
    document.body.classList.toggle("dashboard-chrome", !!visible);
    if (visible) syncUi();
    if (!visible) closeAllDropdowns();
  }

  function init() {
    const d = parseIso(filters.date);
    calViewYear = d.getFullYear();
    calViewMonth = d.getMonth();
    syncUi();
    bindUi();
    if (global.VetAuth?.isLoggedIn?.()) populateAnimalTypes();
    window.addEventListener("vet:session-changed", () => {
      populateAnimalTypes();
      syncUi();
    });
  }

  document.addEventListener("DOMContentLoaded", init);

  global.VetDashboardFilters = {
    get,
    set,
    getDate,
    todayIso,
    subscribe,
    matchesAnimalType,
    matchesTestType,
    populateAnimalTypes,
    canonicalizeSpecies,
    showBar,
    syncUi,
    formatDisplay,
    triggerDashboardSync,
  };
})(window);
