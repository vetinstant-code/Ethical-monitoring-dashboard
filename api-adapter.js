/**
 * Map Vet API pets → cattle dashboard row shape (extend as you wire more screens).
 */
(function (global) {
  function petToHerdRow(pet) {
    const id = String(pet.id ?? pet.pet_id ?? "");
    const name = String(pet.name ?? pet.pet_name ?? "Unknown").trim() || "Unknown";
    return {
      id,
      name,
      breed: pet.breed || pet.species || "—",
      age: pet.age != null ? `${pet.age} Years` : "—",
      status: "healthy",
      lastCheck: pet.last_check || pet.updated_at || "—",
      vitals: [],
      history: [],
      resultTitle: "—",
      resultNote: "",
      advice: [],
      reports: [],
      _raw: pet,
    };
  }

  function petsToCattleMap(pets) {
    const map = {};
    for (const pet of pets) {
      const row = petToHerdRow(pet);
      if (row.id) map[row.id] = row;
    }
    return map;
  }

  function kpiFromPets(pets) {
    const n = pets.length;
    return { total: n, healthy: n, atRisk: 0, sick: 0 };
  }

  // --- Session Resolution & Naming (matches excel-generator.js logic) ---
  const _petSessionsCache = new Map();
  const _sessionLabelCache = new Map();

  function parseApiTimestamp(val) {
    if (!val) return null;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }

  function sessionDatetimeForSort(session) {
    const raw = String(session.started_at || session.created_at || session.activated_at || "").trim();
    if (raw) {
      const d = parseApiTimestamp(raw);
      if (d) return d;
    }
    return new Date(0);
  }

  function examSessionStartedDateIst(session) {
    const raw = String(session.started_at || session.created_at || session.date || "").trim();
    if (!raw) return null;
    const d = parseApiTimestamp(raw);
    if (!d) return null;
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  }

  function sortAndIndexSessions(sessions) {
    const seen = new Set();
    const unique = [];
    (sessions || []).forEach((s) => {
      if (!s || typeof s !== "object") return;
      const sid = String(s.id || s.exam_session_id || "").trim();
      if (sid) {
        if (!seen.has(sid)) {
          seen.add(sid);
          unique.push(s);
        }
      } else {
        unique.push(s);
      }
    });

    unique.sort((a, b) => sessionDatetimeForSort(a) - sessionDatetimeForSort(b));

    const byDate = {};
    unique.forEach((s) => {
      const dt = examSessionStartedDateIst(s) || "all";
      if (!byDate[dt]) byDate[dt] = [];
      byDate[dt].push(s);
    });

    const mapping = {};
    const keys = ["session_index", "session_number", "session_no", "number", "sequence"];

    Object.values(byDate).forEach((dateSessions) => {
      dateSessions.forEach((s, idx) => {
        const sid = String(s.id || s.exam_session_id || "").trim();
        if (!sid) return;

        let num = null;
        for (const k of keys) {
          const raw = s[k];
          if (raw !== undefined && raw !== null) {
            const n = parseInt(raw, 10);
            if (n >= 1) {
              num = n;
              break;
            }
          }
        }
        if (num === null) {
          num = idx + 1;
        }
        mapping[sid] = `Session ${num}`;
      });
    });

    return mapping;
  }

  async function resolveSessionLabelsForItems(items, client) {
    if (!items || !items.length || !client) return;

    const petIds = Array.from(new Set(
      items
        .map((it) => it.pet_id || it.petId)
        .filter((pid) => pid && typeof pid === "string")
    ));

    await Promise.all(
      petIds.map(async (petId) => {
        if (_petSessionsCache.has(petId)) {
          const cachedMap = _petSessionsCache.get(petId);
          for (const [sid, label] of Object.entries(cachedMap)) {
            _sessionLabelCache.set(`${petId}::${sid}`, label);
            _sessionLabelCache.set(sid, label);
          }
          return;
        }
        try {
          const resp = await client.examSessions(petId);
          const rawList = Array.isArray(resp) ? resp : resp?.exam_sessions || resp?.sessions || [];
          const mapping = sortAndIndexSessions(rawList);
          _petSessionsCache.set(petId, mapping);
          for (const [sid, label] of Object.entries(mapping)) {
            _sessionLabelCache.set(`${petId}::${sid}`, label);
            _sessionLabelCache.set(sid, label);
          }
        } catch (e) {
          console.warn(`[SessionResolver] Failed to load sessions for pet ${petId}:`, e);
        }
      })
    );
  }

  function formatSessionLabel(sessionId, petId) {
    if (!sessionId) return "";
    const cleanSid = String(sessionId).trim();
    if (!cleanSid) return "";

    const m = cleanSid.match(/^session[_\s\-]?(\d+)$/i);
    if (m) return `Session ${m[1]}`;

    if (petId && _sessionLabelCache.has(`${petId}::${cleanSid}`)) {
      return _sessionLabelCache.get(`${petId}::${cleanSid}`);
    }
    if (_sessionLabelCache.has(cleanSid)) {
      return _sessionLabelCache.get(cleanSid);
    }

    return `Session (${cleanSid.slice(0, 8)})`;
  }

  global.VetApiAdapter = {
    petToHerdRow,
    petsToCattleMap,
    kpiFromPets,
    sortAndIndexSessions,
    resolveSessionLabelsForItems,
    formatSessionLabel,
  };
})(window);
