/**
 * Streamlined Live API Monitoring & Synchronization script.
 * Feeds the clinical validation dashboard and hidden activity hooks.
 * Uses parallel fetches + progress percent for faster perceived load.
 */
(function (global) {
  const ALLOWED_DEVICE = "ARMY";
  const CONCURRENCY = 6;
  const REF_TEMPS_F = {
    GIZMO: 101.9,
    AVANI: 100.5,
    GANPAT: 101.0,
    "GOD FATHER": 100.4,
    "LUCKY BOY": 101.4,
    TARANG: 99.7,
    TOY: 100.6,
    TRISHUL: 100.5,
    TULIP: 99.5,
    VIDHI: 100.1,
    VIDYUT: 100.6,
    VINCENT: 100.2,
  };

  const store = {
    loading: false,
    error: null,
    apiClient: null,
    pets: [],
    petMeta: {},
    lastFingerprint: null,
    lastDate: null,
  };

  let syncGeneration = 0;
  let pendingRefresh = false;
  let pendingForce = false;

  const istDateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const istTimeFormatter = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  const istDisplayFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  function todayIsoIst() {
    return global.VetDashboardFilters?.todayIso?.() || istDateFormatter.format(new Date());
  }

  function getDashboardDate() {
    return global.VetDashboardFilters?.getDate?.() || todayIsoIst();
  }

  function addDaysIso(iso, delta) {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + delta);
    return istDateFormatter.format(d);
  }

  function parseApiTimestamp(raw) {
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

  function sessionStartedDateIst(session) {
    const parsed = parseApiTimestamp(session?.started_at ?? session?.created_at);
    if (!parsed) return null;
    return istDateFormatter.format(parsed);
  }

  function sessionTimeIst(session) {
    const parsed = parseApiTimestamp(session?.started_at ?? session?.created_at);
    if (!parsed) return "";
    return istTimeFormatter.format(parsed);
  }

  function sessionHourIst(session) {
    const parsed = parseApiTimestamp(session?.started_at ?? session?.created_at);
    if (!parsed) return null;
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hour12: false,
    }).formatToParts(parsed);
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    return Number.isFinite(hour) ? hour : null;
  }

  function roundTempC(c) {
    const n = Number(c);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.trunc(n * 100 + 0.5) / 100;
  }

  function fToC(f) {
    const n = Number(String(f).replace(/f$/i, ""));
    if (!Number.isFinite(n)) return null;
    return roundTempC(((n - 32) * 5) / 9);
  }

  function readingSensor(r) {
    return String(r?.sensor_type || r?.type || r?.sensor || "").toLowerCase();
  }

  function readingTemp(r) {
    const n = Number(r?.temperature_value ?? r?.temperature ?? r?.temp ?? r?.value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function getExamDFromReadings(readings) {
    const list = Array.isArray(readings) ? readings : [];
    const irs = list.filter((r) => /ir|ear|examd|exam_d/.test(readingSensor(r)));
    const irVals = irs.map(readingTemp).filter((n) => n != null);
    if (irVals.length) return irVals[irVals.length - 1];
    const any = list.map(readingTemp).filter((n) => n != null);
    return any.length ? any[any.length - 1] : null;
  }

  function getReferenceFromReadings(readings, petName) {
    const list = Array.isArray(readings) ? readings : [];
    const refs = list.filter((r) => /reference|rectal|mercury|clinical/.test(readingSensor(r)));
    const refVals = refs.map(readingTemp).filter((n) => n != null);
    if (refVals.length) return refVals[refVals.length - 1];
    const key = String(petName || "").trim().toUpperCase();
    if (REF_TEMPS_F[key] != null) return fToC(REF_TEMPS_F[key]);
    return null;
  }

  function normalizeSummaries(payload) {
    if (Array.isArray(payload)) return payload.filter((x) => x && typeof x === "object");
    if (payload && typeof payload === "object") {
      for (const key of ["summaries", "temperature_summaries", "data", "results"]) {
        const blob = payload[key];
        if (Array.isArray(blob)) return blob.filter((x) => x && typeof x === "object");
      }
    }
    return [];
  }

  function summarySensorKey(row) {
    return String(row?.sensor_type || row?.type || row?.sensor || "").trim().toLowerCase();
  }

  function isIrSummaryRow(row) {
    return /mlx|90614|90632|ir|ir_ear/.test(summarySensorKey(row));
  }

  function isRectalSummaryRow(row) {
    const s = summarySensorKey(row);
    return s === "tmp" || /rectal/.test(s);
  }

  function pickSessionSummary(summaries, examSessionId, wantIr) {
    const sid = String(examSessionId || "").trim();
    if (!sid) return null;
    const matches = summaries.filter((r) => {
      const rid = String(r.exam_session_id || r.examSessionId || "").trim();
      if (rid !== sid) return false;
      return wantIr ? isIrSummaryRow(r) : isRectalSummaryRow(r);
    });
    if (!matches.length) return null;
    matches.sort((a, b) => {
      const ta = parseApiTimestamp(a.recorded_at || a.created_at)?.getTime() || 0;
      const tb = parseApiTimestamp(b.recorded_at || b.created_at)?.getTime() || 0;
      return tb - ta;
    });
    return matches[0] || null;
  }

  function tempFromSummary(irSummary, rectSummary) {
    const meanIr = roundTempC(irSummary?.mean);
    if (meanIr != null) return meanIr;
    const body =
      roundTempC(irSummary?.t3) ?? roundTempC(irSummary?.t2) ?? roundTempC(irSummary?.t1) ?? null;
    if (body != null) return body;
    const rect =
      roundTempC(rectSummary?.t3) ?? roundTempC(rectSummary?.t2) ?? roundTempC(rectSummary?.t1) ?? null;
    return rect;
  }

  function refFromSummary(summary) {
    if (!summary) return null;
    const refs = [summary.ref1, summary.ref2, summary.ref3].map((v) => roundTempC(v)).filter((n) => n != null);
    if (refs.length) return Math.max(...refs);
    return roundTempC(summary.ref_max);
  }

  function normalizeRecordings(data) {
    if (Array.isArray(data)) return data.filter((x) => x && typeof x === "object");
    if (data && typeof data === "object") {
      if (data.heart || data.lung) {
        const out = [];
        ["heart", "lung"].forEach((kind) => {
          (data[kind] || []).forEach((r) => {
            if (r && typeof r === "object") out.push({ ...r, _audio_container: kind });
          });
        });
        return out;
      }
      for (const key of ["recordings", "items", "data"]) {
        if (Array.isArray(data[key])) return data[key].filter((x) => x && typeof x === "object");
      }
    }
    return [];
  }

  function dailyPetRowFrom(pet) {
    const petId = pet?.pet_id || pet?.id;
    return {
      ...pet,
      pet_id: petId,
      id: petId,
      pet_name: pet?.pet_name || pet?.name,
      name: pet?.pet_name || pet?.name,
    };
  }

  async function resolvePetsForDate(client, targetDate, allPets) {
    const dailyResponse = await client.dailyPets(targetDate).catch(() => null);
    let list = (dailyResponse?.pets || []).map(dailyPetRowFrom);
    if (list.length) return { list, source: "daily-pets" };

    const registered = (allPets || []).map(dailyPetRowFrom).filter((p) => p.pet_id || p.id);
    if (!registered.length) return { list: [], source: "none" };

    const hits = [];
    await mapPool(registered, CONCURRENCY, async (pet) => {
      const petId = pet.pet_id || pet.id;
      try {
        const sessionsResponse = await client.examSessions(petId);
        const sessions = global.VetApiNormalize.normalizeSessions(sessionsResponse);
        const hasDate = sessions.some((s) => sessionStartedDateIst(s) === targetDate);
        if (hasDate) hits.push(pet);
      } catch (err) {
        console.warn(`Failed session scan for pet ${petId}`, err);
      }
    });
    return { list: hits, source: hits.length ? "exam-sessions" : "none" };
  }

  function petMetaOf(petId, pet, dailyPet) {
    const cached = store.petMeta[petId];
    if (cached) return cached;
    const full = store.pets.find((p) => String(p.pet_id || p.id) === String(petId));
    const species =
      global.VetDashboardFilters?.canonicalizeSpecies?.(
        dailyPet?.species ||
          dailyPet?.pet_species ||
          dailyPet?.animal_type ||
          dailyPet?.animal_category ||
          dailyPet?.category ||
          full?.species ||
          full?.pet_species ||
          full?.animal_type ||
          full?.category ||
          "Uncategorized"
      ) ||
      String(
        dailyPet?.species ||
          dailyPet?.pet_species ||
          full?.species ||
          full?.pet_species ||
          "Uncategorized"
      ).trim() ||
      "Uncategorized";
    const name = dailyPet?.pet_name || dailyPet?.name || full?.pet_name || full?.name || "Unknown";
    const meta = { species: String(species).trim() || "Uncategorized", name: String(name).trim() || "Unknown" };
    store.petMeta[petId] = meta;
    return meta;
  }

  async function ensureClient() {
    if (store.apiClient) return store.apiClient;
    const session = global.VetAuth?.getSession() || {};
    const cfg = {
      baseUrl: global.API_CONFIG?.baseUrl || "https://wick-vehicular-dingy.ngrok-free.dev",
      deviceId: session.deviceId || ALLOWED_DEVICE,
      timeoutMs: global.API_CONFIG?.timeoutMs || 25000,
    };
    const client = new global.VetApiClient(cfg);
    if (session.password) {
      await client.login(cfg.deviceId, session.password);
    }
    store.apiClient = client;
    return client;
  }

  function setProgress(pct, label) {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    const syncText = document.getElementById("sync-text");
    const progress = document.getElementById("dash-progress");
    const fill = document.getElementById("dash-progress-fill");
    const pctEl = document.getElementById("dash-progress-pct");
    if (syncText && label) syncText.textContent = label;
    if (progress) progress.hidden = false;
    if (fill) fill.style.width = `${clamped}%`;
    if (pctEl) pctEl.textContent = `${clamped}%`;
  }

  function hideProgress() {
    const progress = document.getElementById("dash-progress");
    if (progress) progress.hidden = true;
  }

  async function mapPool(items, limit, worker) {
    if (!items.length) return [];
    const results = new Array(items.length);
    let next = 0;
    async function run() {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i], i);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
    return results;
  }

  function needsAudioTests() {
    const testType = global.VetDashboardFilters?.get?.()?.testType || "all";
    // Only pull recordings when user is filtering heart/lung specifically
    return testType === "heart" || testType === "lung";
  }

  async function processPet(client, pet, targetDate, fetchAudio) {
    const petId = pet.pet_id || pet.id;
    const meta = petMetaOf(petId, pet, pet);
    const local = {
      activities: [],
      cases: [],
      comparisons: [],
      speciesId: null,
      species: meta.species,
      testCounts: { temperature: 0, ecg: 0, spo2: 0, heart: 0, lung: 0 },
      hourly: {},
      statusCounts: { completed: 0, inProgress: 0, failed: 0 },
      riskFlaggedCount: 0,
    };

    try {
      const sessionsResponse = await client.examSessions(petId);
      const sessions = global.VetApiNormalize.normalizeSessions(sessionsResponse);
      const dateSessions = sessions.filter((s) => sessionStartedDateIst(s) === targetDate);

      const summaries = await client.petTemperatureSummary(petId).then(normalizeSummaries).catch(() => []);

      await Promise.all(
        dateSessions.map(async (s) => {
          const sid = s.id || s.exam_session_id;
          const timeStr = sessionTimeIst(s);
          const hour = sessionHourIst(s);

          let tempVal = null;
          let refVal = null;
          let statusLabel = "Completed";
          let statusClass = "stable";
          const tests = new Set();

          const irSummary = pickSessionSummary(summaries, sid, true);
          const rectSummary = pickSessionSummary(summaries, sid, false);
          tempVal = tempFromSummary(irSummary, rectSummary);
          refVal = refFromSummary(irSummary || rectSummary);

          if (tempVal == null) {
            const tempPromise = client.petTemperatureBySession(petId, sid).catch((err) => {
              console.warn(`Failed temperature for session ${sid}`, err);
              return null;
            });
            const tempResp = await tempPromise;
            if (tempResp) {
              const readings = tempResp?.readings || tempResp?.temperature_readings || tempResp || [];
              tempVal = getExamDFromReadings(readings);
              if (refVal == null) refVal = getReferenceFromReadings(readings, meta.name);
            }
          }

          if (tempVal != null) tests.add("Temperature");

          const recPromise = fetchAudio
            ? client.recordings(petId, sid).catch(() => null)
            : Promise.resolve(null);
          const recResp = await recPromise;
          if (recResp) {
            normalizeRecordings(recResp).forEach((r) => {
              const container = String(r._audio_container || r.organ || r.recording_type || "").toLowerCase();
              if (container.includes("heart")) tests.add("Heart Sound");
              else if (container.includes("lung")) tests.add("Lung Sound");
            });
          }

          if (!global.VetDashboardFilters?.matchesTestType?.(tests)) return;

          local.speciesId = String(petId);
          if (hour != null) local.hourly[hour] = (local.hourly[hour] || 0) + 1;
          if (tests.has("Temperature")) local.testCounts.temperature += 1;
          if (tests.has("Heart Sound")) local.testCounts.heart += 1;
          if (tests.has("Lung Sound")) local.testCounts.lung += 1;

          if (tempVal != null) {
            if (tempVal > 38.6 || tempVal < 37.2) {
              statusLabel = tempVal > 38.6 ? "Critical" : "Low";
              statusClass = "critical";
              local.statusCounts.failed += 1;
              local.riskFlaggedCount += 1;
            } else {
              local.statusCounts.completed += 1;
            }
          } else {
            local.statusCounts.inProgress += 1;
            statusLabel = "In Progress";
            statusClass = "low";
          }

          if (tempVal != null && refVal != null) {
            local.comparisons.push({
              id: petId,
              species: meta.species,
              examD: tempVal,
              reference: refVal,
            });
          }

          const testsLabel = tests.size ? [...tests].join(", ") : "—";
          const ts = parseApiTimestamp(s.started_at || s.created_at)?.getTime() || 0;

          local.activities.push({
            time: timeStr || "—",
            name: meta.name,
            id: petId,
            temp: tempVal != null ? `${tempVal.toFixed(1)}°C` : "No Reading",
            statusLabel,
            statusClass,
            timestamp: ts,
          });

          local.cases.push({
            time: timeStr || "—",
            name: meta.name,
            id: petId,
            species: meta.species,
            tests: testsLabel,
            statusLabel,
            statusClass,
            timestamp: ts,
          });
        })
      );
    } catch (err) {
      console.warn(`Failed sessions for pet ${petId}`, err);
    }

    return local;
  }

  async function enrichAudioCounts(client, cases, testCounts, gen, targetDate) {
    if (!cases.length) return;
    const uniquePets = [...new Map(cases.map((c) => [String(c.id), c])).values()].slice(0, 40);
    let heart = 0;
    let lung = 0;

    await mapPool(uniquePets, 4, async (c) => {
      if (gen !== syncGeneration) return;
      try {
        const sessionsResponse = await client.examSessions(c.id);
        const sessions = global.VetApiNormalize.normalizeSessions(sessionsResponse);
        const dateSessions = sessions.filter((s) => sessionStartedDateIst(s) === targetDate).slice(0, 2);
        for (const s of dateSessions) {
          const sid = s.id || s.exam_session_id;
          const recResp = await client.recordings(c.id, sid).catch(() => null);
          if (!recResp) continue;
          normalizeRecordings(recResp).forEach((r) => {
            const container = String(r._audio_container || r.organ || r.recording_type || "").toLowerCase();
            if (container.includes("heart")) heart += 1;
            else if (container.includes("lung")) lung += 1;
          });
        }
      } catch {
        /* ignore */
      }
    });

    if (gen !== syncGeneration) return;
    if (!heart && !lung) return;
    testCounts.heart = heart;
    testCounts.lung = lung;
    global.VetDashboardHome?.updateTestCounts?.(testCounts);
  }

  function payloadFingerprint(payload) {
    try {
      return JSON.stringify({
        dateLabel: payload.dateLabel,
        totalToday: payload.totalToday,
        yesterdayCount: payload.yesterdayCount,
        speciesCounts: payload.speciesCounts,
        testCounts: payload.testCounts,
        hourly: payload.hourly,
        statusCounts: payload.statusCounts,
        completedAllTime: payload.completedAllTime,
        cases: (payload.cases || []).map((c) => [c.id, c.time, c.species, c.tests, c.statusLabel]),
        comparisons: (payload.comparisons || []).map((c) => [c.id, c.examD, c.reference]),
        notes: payload.notes,
      });
    } catch {
      return String(Date.now());
    }
  }

  function renderIfChanged(payload, { force = false, stage = "final" } = {}) {
    if (!payload) return false;
    // Skip empty early paint when we already have detailed data for the same date
    if (stage === "early" && store.lastDate === getDashboardDate() && store.lastFingerprint) {
      return false;
    }
    const fp = payloadFingerprint(payload);
    if (!force && fp === store.lastFingerprint) return false;
    store.lastFingerprint = fp;
    store.lastDate = getDashboardDate();
    global.VetDashboardHome?.render?.(payload);
    return true;
  }

  async function refreshTodayDashboard(opts = {}) {
    const force = !!opts.force;

    // If a sync is already running, abort it and queue a fresh one for the new filters/date
    if (store.loading) {
      pendingRefresh = true;
      pendingForce = pendingForce || force;
      syncGeneration += 1;
      return;
    }

    store.loading = true;
    const gen = ++syncGeneration;
    if (force) {
      store.lastFingerprint = null;
    }

    const syncIcon = document.getElementById("sync-icon");
    const syncText = document.getElementById("sync-text");

    if (syncIcon) {
      syncIcon.classList.remove("spinning");
      void syncIcon.offsetWidth;
      syncIcon.classList.add("spinning");
    }
    setProgress(3, "Starting…");

    const targetDate = getDashboardDate();
    const fetchAudio = needsAudioTests();
    const dateChanged = store.lastDate != null && store.lastDate !== targetDate;

    try {
      const client = await ensureClient();
      if (gen !== syncGeneration) return;
      setProgress(8, "Loading pets…");

      const [rawPets, yResp] = await Promise.all([
        client.listPets(),
        client.dailyPets(addDaysIso(targetDate, -1)).catch(() => null),
      ]);
      if (gen !== syncGeneration) return;

      store.pets = global.VetApiNormalize.normalizePets(rawPets);
      store.petMeta = {};
      global.VetDashboardFilters?.populateAnimalTypes?.();

      const resolved = await resolvePetsForDate(client, targetDate, store.pets);
      if (gen !== syncGeneration) return;

      let dailyPetsList = resolved.list || [];
      dailyPetsList = dailyPetsList.filter((p) => {
        const meta = petMetaOf(p.pet_id || p.id, p, p);
        return global.VetDashboardFilters?.matchesAnimalType?.(meta.species);
      });

      const yesterdayCount = yResp ? (yResp.pets || []).length : null;

      const earlySpecies = {};
      dailyPetsList.forEach((p) => {
        const meta = petMetaOf(p.pet_id || p.id, p, p);
        earlySpecies[meta.species] = (earlySpecies[meta.species] || 0) + 1;
      });

      // Early paint only on first load or when the selected date/filters force a new view
      if (force || dateChanged || !store.lastFingerprint) {
        renderIfChanged(
          {
            dateLabel: istDisplayFormatter.format(new Date(`${targetDate}T12:00:00`)),
            totalToday: dailyPetsList.length,
            yesterdayCount,
            speciesCounts: earlySpecies,
            testCounts: { temperature: 0, ecg: 0, spo2: 0, heart: 0, lung: 0 },
            hourly: Array.from({ length: 11 }, (_, i) => ({
              label: `${String(i + 8).padStart(2, "0")}:00`,
              count: 0,
            })),
            statusCounts: { completed: 0, inProgress: 0, failed: 0 },
            completedAllTime: store.pets.length,
            cases: [],
            comparisons: [],
            notes: [`Loading detailed case data for ${dailyPetsList.length} animal(s)…`],
          },
          { force: true, stage: "early" }
        );
      }

      setProgress(18, "Calculating…");

      const activities = [];
      const cases = [];
      const comparisons = [];
      const speciesPetIds = {};
      const testCounts = { temperature: 0, ecg: 0, spo2: 0, heart: 0, lung: 0 };
      const hourlyMap = {};
      const statusCounts = { completed: 0, inProgress: 0, failed: 0 };
      const notes = [];
      let riskFlaggedCount = 0;
      for (let h = 8; h <= 18; h++) hourlyMap[h] = 0;

      let done = 0;
      const total = Math.max(dailyPetsList.length, 1);

      const partials = await mapPool(dailyPetsList, CONCURRENCY, async (pet) => {
        if (gen !== syncGeneration) return null;
        const result = await processPet(client, pet, targetDate, fetchAudio);
        done += 1;
        const pct = 18 + (done / total) * 78;
        setProgress(pct, `Calculating ${Math.round(pct)}%`);
        return result;
      });
      if (gen !== syncGeneration) return;

      partials.filter(Boolean).forEach((local) => {
        if (local.speciesId) {
          if (!speciesPetIds[local.species]) speciesPetIds[local.species] = new Set();
          speciesPetIds[local.species].add(local.speciesId);
        }
        activities.push(...local.activities);
        cases.push(...local.cases);
        comparisons.push(...local.comparisons);
        riskFlaggedCount += local.riskFlaggedCount;
        Object.keys(local.testCounts).forEach((k) => {
          testCounts[k] += local.testCounts[k] || 0;
        });
        Object.entries(local.hourly).forEach(([h, c]) => {
          const hour = Number(h);
          if (hourlyMap[hour] != null) hourlyMap[hour] += c;
        });
        statusCounts.completed += local.statusCounts.completed;
        statusCounts.inProgress += local.statusCounts.inProgress;
        statusCounts.failed += local.statusCounts.failed;
      });

      setProgress(97, "Rendering…");

      activities.sort((a, b) => b.timestamp - a.timestamp);
      cases.sort((a, b) => b.timestamp - a.timestamp);

      const hourly = Object.keys(hourlyMap)
        .map((h) => ({ label: `${String(h).padStart(2, "0")}:00`, count: hourlyMap[h] }))
        .sort((a, b) => a.label.localeCompare(b.label));

      const speciesCounts = {};
      Object.entries(speciesPetIds).forEach(([species, ids]) => {
        speciesCounts[species] = ids.size;
      });
      if (!Object.keys(speciesCounts).length) Object.assign(speciesCounts, earlySpecies);

      const uniquePetIds = new Set(cases.map((c) => c.id));
      const totalToday = uniquePetIds.size || dailyPetsList.length;

      const elVitals = document.getElementById("kpi-vitals-today");
      if (elVitals) elVitals.textContent = String(totalToday);

      const tableBody = document.getElementById("activity-table-body");
      if (tableBody) {
        if (!activities.length) {
          tableBody.innerHTML = `<tr><td colspan="4" class="empty-state">No rounds recorded on this date.</td></tr>`;
        } else {
          tableBody.innerHTML = activities
            .map(
              (act) => `
            <tr class="activity-row-clickable" data-pet-id="${String(act.id).replace(/"/g, "")}" tabindex="0" role="link">
              <td class="time-col-text">${act.time}</td>
              <td><span class="animal-name-bold">${act.name}</span></td>
              <td class="vitals-text-bold">${act.temp}</td>
              <td><span class="badge-status ${act.statusClass}">${act.statusLabel}</span></td>
            </tr>`
            )
            .join("");
        }
      }

      if (riskFlaggedCount > 0) {
        notes.push(`${riskFlaggedCount} case(s) flagged outside normal temperature range.`);
      }
      if (comparisons.length) {
        notes.push(`${comparisons.length} temperature reading(s) matched with reference for validation.`);
      } else if (dailyPetsList.length) {
        notes.push("Reference thermometer readings not yet available for all sessions today.");
      } else if (resolved.source === "none") {
        notes.push(`No exam sessions found on ${istDisplayFormatter.format(new Date(`${targetDate}T12:00:00`))}. Try Jul 2 or Jul 3 for recent ARMY data.`);
      } else {
        notes.push("Reference thermometer readings not yet available for all sessions today.");
      }
      if (resolved.source === "exam-sessions") {
        notes.push("Daily pets index was empty; animals were discovered from exam sessions.");
      }
      notes.push(`Data synced for ${istDisplayFormatter.format(new Date(`${targetDate}T12:00:00`))}.`);

      const finalPayload = {
        dateLabel: istDisplayFormatter.format(new Date(`${targetDate}T12:00:00`)),
        totalToday,
        yesterdayCount,
        speciesCounts,
        testCounts,
        hourly,
        statusCounts,
        completedAllTime: store.pets.length,
        cases,
        comparisons,
        notes,
      };

      const didRender = renderIfChanged(finalPayload, { force: force || dateChanged, stage: "final" });

      setProgress(100, didRender ? "Done" : "Up to date");
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      if (syncText) syncText.textContent = didRender ? `Updated ${timeStr}` : `Synced ${timeStr}`;
      hideProgress();
      store.error = null;

      if (!fetchAudio && cases.length) {
        enrichAudioCounts(client, cases, testCounts, gen, targetDate).catch(() => {});
      }
    } catch (err) {
      console.error("[Live API Sync Failed]", err);
      store.error = err.message || String(err);
      if (syncText) syncText.textContent = "Sync failed";
      hideProgress();
    } finally {
      store.loading = false;
      const shouldRunPending = pendingRefresh;
      const nextForce = pendingForce || force;
      pendingRefresh = false;
      pendingForce = false;

      if (shouldRunPending) {
        Promise.resolve().then(() => refreshTodayDashboard({ force: nextForce }));
      } else {
        setTimeout(() => {
          if (syncIcon && !store.loading) syncIcon.classList.remove("spinning");
        }, 400);
      }
    }
  }

  let pollingInterval = null;
  let coalesceTimer = null;

  function scheduleForceRefresh() {
    clearTimeout(coalesceTimer);
    coalesceTimer = setTimeout(() => {
      coalesceTimer = null;
      refreshTodayDashboard({ force: true });
    }, 40);
  }

  function startAutoPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    refreshTodayDashboard({ force: true });
    pollingInterval = setInterval(async () => {
      if (!global.VetAuth?.isLoggedIn?.()) return;
      await refreshTodayDashboard();
    }, 60000);
  }

  function stopAutoPolling() {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
    const syncText = document.getElementById("sync-text");
    if (syncText) syncText.textContent = "Paused";
    hideProgress();
  }

  function bootstrapIfLoggedIn() {
    if (!global.VetAuth?.isLoggedIn?.()) return;
    const pollingToggle = document.getElementById("chk-auto-polling");
    if (pollingToggle && pollingToggle.checked) {
      startAutoPolling();
    } else {
      refreshTodayDashboard({ force: true });
    }
  }

  function resetStore() {
    store.apiClient = null;
    store.pets = [];
    store.petMeta = {};
    store.lastFingerprint = null;
    store.lastDate = null;
    pendingRefresh = false;
    pendingForce = false;
    stopAutoPolling();
  }

  function init() {
    const pollingToggle = document.getElementById("chk-auto-polling");
    const tableBody = document.getElementById("activity-table-body");

    global.VetDashboardFilters?.subscribe?.(() => {
      scheduleForceRefresh();
    });

    document.getElementById("header-refresh-btn")?.addEventListener("click", () => {
      refreshTodayDashboard({ force: true });
    });

    window.addEventListener("vet:dashboard-filters-changed", () => {
      const hash = (location.hash || "#/").replace(/^#/, "");
      if (hash === "/vitals-today" || hash.startsWith("/vitals-today")) {
        global.VetAppPages?.route?.();
      }
    });

    if (pollingToggle) {
      pollingToggle.addEventListener("change", () => {
        if (pollingToggle.checked) startAutoPolling();
        else stopAutoPolling();
      });
    }

    if (tableBody) {
      tableBody.addEventListener("click", (e) => {
        const row = e.target.closest("tr[data-pet-id]");
        if (!row) return;
        global.VetAppPages?.openAnimalHistory?.(row.getAttribute("data-pet-id"));
      });
      tableBody.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const row = e.target.closest("tr[data-pet-id]");
        if (!row) return;
        e.preventDefault();
        global.VetAppPages?.openAnimalHistory?.(row.getAttribute("data-pet-id"));
      });
    }

    if (global.VetAuth?.isLoggedIn?.()) {
      bootstrapIfLoggedIn();
    }
  }

  document.addEventListener("DOMContentLoaded", init);

  global.VetLiveApi = {
    bootstrapIfLoggedIn,
    refreshTodayDashboard,
    scheduleForceRefresh,
    resetStore,
    todayIsoIst,
    ensureClient,
    resolvePetsForDate,
    getPets: () => store.pets.slice(),
  };
})(window);
