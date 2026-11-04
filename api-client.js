/**
 * Browser client — mirrors DATASET_DOWNLOAD_APPLIC/src/api.py (ApiClient).
 * Pets/report routes require X-Device-Id + X-Session-Token (from POST /api/login).
 * Diag routes do not require a session token.
 */
(function (global) {
  const NO_SESSION_PREFIXES = ["/api/login", "/api/diag/"];

  class VetApiClient {
    constructor(config) {
      const c = config || global.API_CONFIG || {};
      this.baseUrl = String(c.baseUrl || "").replace(/\/$/, "");
      this.deviceId = String(c.deviceId || "").trim().toUpperCase();
      this.sessionToken = String(c.sessionToken || "").trim();
      this.timeoutMs = Number(c.timeoutMs) || 35000;
      if (!this.baseUrl) throw new Error("API baseUrl is required (config.api.js).");
    }

    _url(endpoint, baseUrl = null) {
      if (/^https?:\/\//i.test(endpoint)) return endpoint;
      const base = baseUrl ? String(baseUrl).replace(/\/$/, "") : this.baseUrl;
      return `${base}/${String(endpoint).replace(/^\//, "")}`;
    }

    _pathOf(endpoint) {
      try {
        if (/^https?:\/\//i.test(endpoint)) return new URL(endpoint).pathname;
      } catch {
        /* ignore */
      }
      return `/${String(endpoint || "").replace(/^\//, "")}`;
    }

    _needsSession(endpoint, { skipSession } = {}) {
      if (skipSession) return false;
      const path = this._pathOf(endpoint);
      return !NO_SESSION_PREFIXES.some((p) => path === p || path.startsWith(p));
    }

    _resolveSessionToken(explicit) {
      if (explicit != null && String(explicit).trim()) return String(explicit).trim();
      if (this.sessionToken) return this.sessionToken;
      const fromAuth = global.VetAuth?.getSession?.()?.sessionToken;
      return String(fromAuth || "").trim();
    }

    _headers({ deviceId, sessionToken, skipSession, endpoint, json } = {}) {
      const headers = {
        "X-Device-Id": deviceId || this.deviceId,
        "ngrok-skip-browser-warning": "1",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
      };
      if (json != null) headers["Content-Type"] = "application/json";
      if (this._needsSession(endpoint, { skipSession })) {
        const token = this._resolveSessionToken(sessionToken);
        if (token) headers["X-Session-Token"] = token;
      }
      return headers;
    }

    async _request(method, endpoint, { params, json, baseUrl, deviceId, sessionToken, skipSession } = {}) {
      const url = new URL(this._url(endpoint, baseUrl));
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          if (v != null && v !== "") url.searchParams.set(k, String(v));
        });
      }
      if (method === "GET") {
        url.searchParams.set("_t", String(Date.now()));
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const headers = this._headers({ deviceId, sessionToken, skipSession, endpoint, json });
      if (this._needsSession(endpoint, { skipSession }) && !headers["X-Session-Token"]) {
        clearTimeout(timer);
        throw new Error("Missing X-Session-Token. Sign in again.");
      }
      const init = { method, headers, signal: controller.signal, cache: "no-store" };
      if (json != null) init.body = JSON.stringify(json);
      try {
        const res = await fetch(url.toString(), init);
        if (res.status === 401 && this._needsSession(endpoint, { skipSession })) {
          global.VetAuth?.onSessionExpired?.(await res.text().catch(() => ""));
          throw new Error("Session expired or invalid. Login again.");
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status} ${endpoint}${text ? `: ${text.slice(0, 200)}` : ""}`);
        }
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) return res.json();
        return res.text();
      } catch (err) {
        if (controller.signal.aborted || err.name === "AbortError") {
          throw new Error(`Request to ${endpoint} timed out after ${Math.round(this.timeoutMs / 1000)}s. Please check connection.`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }

    async downloadBinary(endpoint, { baseUrl, deviceId, sessionToken, params, timeoutMs, skipSession } = {}) {
      const url = new URL(this._url(endpoint, baseUrl));
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          if (v != null && v !== "") url.searchParams.set(k, String(v));
        });
      }
      url.searchParams.set("_t", String(Date.now()));
      const headers = this._headers({ deviceId, sessionToken, skipSession, endpoint });
      if (this._needsSession(endpoint, { skipSession }) && !headers["X-Session-Token"]) {
        throw new Error("Missing X-Session-Token. Sign in again.");
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Number(timeoutMs) || this.timeoutMs);
      try {
        const res = await fetch(url.toString(), {
          method: "GET",
          headers,
          signal: controller.signal,
          cache: "no-store",
        });
        if (res.status === 401 && this._needsSession(endpoint, { skipSession })) {
          global.VetAuth?.onSessionExpired?.(await res.text().catch(() => ""));
          throw new Error("Session expired or invalid. Login again.");
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} when downloading binary ${endpoint}`);
        }
        return res.arrayBuffer();
      } catch (err) {
        if (controller.signal.aborted || err.name === "AbortError") {
          throw new Error(`Download of ${endpoint} timed out. Please try again.`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }

    setDeviceId(deviceId) {
      const clean = String(deviceId || "").trim().toUpperCase();
      if (!clean) throw new Error("Device ID cannot be empty.");
      this.deviceId = clean;
    }

    setSessionToken(token) {
      this.sessionToken = String(token || "").trim();
    }

    /**
     * POST /api/login — body is device_id (password optional for older servers).
     * Stores session_token on this client.
     */
    async login(deviceId, password) {
      this.setDeviceId(deviceId);
      const json = { device_id: this.deviceId };
      if (password) json.password = password;
      const data = await this._request("POST", "/api/login", {
        json,
        skipSession: true,
      });
      const token = String(data?.session_token || "").trim();
      if (!token) throw new Error("Login succeeded but no session_token was returned.");
      this.setSessionToken(token);
      if (data?.device_id) this.setDeviceId(data.device_id);
      return data;
    }

    logout() {
      return this._request("POST", "/api/logout", {}).catch(() => null);
    }

    health() {
      return this._request("GET", "/api/health");
    }

    listPets() {
      return this._request("GET", "/api/pets/");
    }

    examSessions(petId) {
      return this._request("GET", `/api/pets/${encodeURIComponent(petId)}/exam-sessions`);
    }

    examSessionsWithContext(petId, { baseUrl, deviceId, sessionToken } = {}) {
      return this._request("GET", `/api/pets/${encodeURIComponent(petId)}/exam-sessions`, {
        baseUrl,
        deviceId,
        sessionToken,
      });
    }

    petDetailWithContext(petId, { baseUrl, deviceId, sessionToken } = {}) {
      return this._request("GET", `/api/pets/${encodeURIComponent(petId)}`, {
        baseUrl,
        deviceId,
        sessionToken,
      });
    }

    recordings(petId, examSessionId) {
      return this._request("GET", `/api/pets/${encodeURIComponent(petId)}/recordings`, {
        params: { exam_session_id: examSessionId },
      });
    }

    recordingsWithContext(petId, examSessionId, { baseUrl, deviceId, sessionToken } = {}) {
      return this._request("GET", `/api/pets/${encodeURIComponent(petId)}/recordings`, {
        params: { exam_session_id: examSessionId },
        baseUrl,
        deviceId,
        sessionToken,
      });
    }

    petTemperature(petId) {
      return this._request("GET", `/api/pets/${encodeURIComponent(petId)}/temperature`);
    }

    petTemperatureBySession(petId, examSessionId) {
      return this._request("GET", `/api/pets/${encodeURIComponent(petId)}/temperature`, {
        params: { exam_session_id: examSessionId },
      });
    }

    petTemperatureBySessionWithContext(petId, examSessionId, { baseUrl, deviceId, sessionToken } = {}) {
      return this._request("GET", `/api/pets/${encodeURIComponent(petId)}/temperature`, {
        params: { exam_session_id: examSessionId },
        baseUrl,
        deviceId,
        sessionToken,
      });
    }

    dailyPets(date) {
      return this._request("GET", "/api/device/daily-pets", {
        params: date ? { date } : undefined,
      });
    }

    dailyPetsWithContext(date, { baseUrl, deviceId, sessionToken } = {}) {
      return this._request("GET", "/api/device/daily-pets", {
        params: date ? { date } : undefined,
        baseUrl,
        deviceId,
        sessionToken,
      });
    }

    petTemperatureSummary(petId) {
      return this._request("GET", `/api/pets/${encodeURIComponent(petId)}/temperature/summary`);
    }

    petTemperatureSummaryWithContext(petId, { baseUrl, deviceId, sessionToken } = {}) {
      return this._request("GET", `/api/pets/${encodeURIComponent(petId)}/temperature/summary`, {
        baseUrl,
        deviceId,
        sessionToken,
      });
    }

    examSessionTemperatureSummary(examSessionId) {
      return this._request("GET", `/api/exam-sessions/${encodeURIComponent(examSessionId)}/temperature/summary`);
    }

    examSessionTemperatureSummaryWithContext(examSessionId, { baseUrl, deviceId, sessionToken } = {}) {
      return this._request("GET", `/api/exam-sessions/${encodeURIComponent(examSessionId)}/temperature/summary`, {
        baseUrl,
        deviceId,
        sessionToken,
      });
    }

    temperatureExcelFilesWithContext(petId, { baseUrl, deviceId, sessionToken } = {}) {
      return this._request("GET", `/api/pets/${encodeURIComponent(petId)}/temperature/excel-files`, {
        baseUrl,
        deviceId,
        sessionToken,
      });
    }

    temperatureNotes(petId, examSessionId) {
      return this._request("GET", `/api/pets/${encodeURIComponent(petId)}/temperature/notes`, {
        params: examSessionId ? { exam_session_id: examSessionId } : undefined,
      });
    }

    temperatureNotesWithContext(petId, examSessionId, { baseUrl, deviceId, sessionToken } = {}) {
      return this._request("GET", `/api/pets/${encodeURIComponent(petId)}/temperature/notes`, {
        params: examSessionId ? { exam_session_id: examSessionId } : undefined,
        baseUrl,
        deviceId,
        sessionToken,
      });
    }

    downloadTemperatureExcelByUrl(url, { baseUrl, deviceId, sessionToken } = {}) {
      return this.downloadBinary(url, { baseUrl, deviceId, sessionToken });
    }

    downloadTemperatureExcelByS3Key(petId, s3Key, { baseUrl, deviceId, sessionToken } = {}) {
      return this.downloadBinary(`/api/pets/${encodeURIComponent(petId)}/temperature/excel-files/download`, {
        params: { s3_key: s3Key },
        baseUrl,
        deviceId,
        sessionToken,
      });
    }

    recordingAudioMetadata(recordingId, petId, recType = "session", { baseUrl, deviceId, sessionToken } = {}) {
      return this._request("GET", `/api/recordings/${encodeURIComponent(recordingId)}/audio`, {
        params: { pet_id: petId, type: recType },
        baseUrl,
        deviceId,
        sessionToken,
      });
    }

    /** Queue ESP to upload sealed/partial diag buckets (no session required). */
    diagFlush(deviceId) {
      const id = String(deviceId || this.deviceId || "").trim();
      return this._request("POST", "/api/diag/flush", {
        json: { device_id: id },
        deviceId: id,
        skipSession: true,
      });
    }

    /** List UTC days that have stored diag events for a device (no session required). */
    diagEventDays(deviceId, { limit } = {}) {
      const id = String(deviceId || this.deviceId || "").trim();
      return this._request("GET", "/api/diag/events/days", {
        params: { device_id: id, limit },
        deviceId: id,
        skipSession: true,
      });
    }

    /**
     * Query stored diag events (one UTC day). No session required.
     * @param {{ deviceId?: string, date?: string, from?: string, to?: string, limit?: number, newestFirst?: boolean }} opts
     */
    diagEvents({ deviceId, date, from, to, limit, newestFirst } = {}) {
      const id = String(deviceId || this.deviceId || "").trim();
      const params = { device_id: id };
      if (date) params.date = date;
      if (from) params.from = from;
      if (to) params.to = to;
      if (limit != null) params.limit = limit;
      if (newestFirst != null) params.newest_first = newestFirst ? "true" : "false";
      return this._request("GET", "/api/diag/events", {
        params,
        deviceId: id,
        skipSession: true,
      });
    }

    async downloadBinaryByHref(href, { baseUrl, deviceId, sessionToken, skipSession } = {}) {
      const clean = String(href || "").trim();
      if (!clean) throw new Error("Missing audio download URL.");
      const url = /^https?:\/\//i.test(clean) ? clean : this._url(clean, baseUrl);
      const endpoint = this._pathOf(url);
      const headers = this._headers({ deviceId, sessionToken, skipSession, endpoint });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(url.toString(), {
          method: "GET",
          headers,
          signal: controller.signal,
          cache: "no-store",
        });
        if (res.status === 401 && this._needsSession(endpoint, { skipSession })) {
          global.VetAuth?.onSessionExpired?.(await res.text().catch(() => ""));
          throw new Error("Session expired or invalid. Login again.");
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} when downloading audio`);
        }
        return res.arrayBuffer();
      } catch (err) {
        if (controller.signal.aborted || err.name === "AbortError") {
          throw new Error(`Audio download timed out. Please try again.`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }

    /* ==========================================================================
     * Bug Reports & Clinical Media APIs
     * ========================================================================== */

    petBugReports(petId, examSessionId) {
      const params = {};
      if (examSessionId) params.exam_session_id = examSessionId;
      return this._request("GET", `/api/pets/${encodeURIComponent(petId)}/bug-reports`, { params });
    }

    sessionBugReports(examSessionId) {
      return this._request("GET", `/api/exam-sessions/${encodeURIComponent(examSessionId)}/bug-reports`);
    }

    getBugReportNotes(petId, examSessionId) {
      const params = {};
      if (examSessionId) params.exam_session_id = examSessionId;
      return this._request("GET", `/api/pets/${encodeURIComponent(petId)}/bug-reports/notes`, { params });
    }

    saveBugReportNotes(petId, { examSessionId, notes, description }) {
      const json = {};
      if (examSessionId) json.exam_session_id = examSessionId;
      if (notes != null) json.notes = notes;
      if (description != null) json.description = description;
      return this._request("PUT", `/api/pets/${encodeURIComponent(petId)}/bug-reports/notes`, { json });
    }

    getMediaViewUrl(mediaId) {
      const token = this._resolveSessionToken();
      const dev = this.deviceId;
      return `${this._url(`/api/media/${encodeURIComponent(mediaId)}/view`)}?token=${encodeURIComponent(token)}&dev=${encodeURIComponent(dev)}`;
    }

    getMediaDownloadUrl(mediaId) {
      const token = this._resolveSessionToken();
      const dev = this.deviceId;
      return `${this._url(`/api/media/${encodeURIComponent(mediaId)}/download`)}?token=${encodeURIComponent(token)}&dev=${encodeURIComponent(dev)}`;
    }

    getMediaUrlInfo(mediaId) {
      return this._request("GET", `/api/media/${encodeURIComponent(mediaId)}/url`);
    }

    deleteMedia(mediaId) {
      return this._request("DELETE", `/api/media/${encodeURIComponent(mediaId)}`);
    }

    petMedia(petId, { visitDate, sessionId, category } = {}) {
      const params = {};
      if (visitDate) params.visit_date = visitDate;
      if (sessionId) params.session_id = sessionId;
      if (category) params.category = category;
      return this._request("GET", `/api/pets/${encodeURIComponent(petId)}/media`, { params });
    }

    mediaSummary() {
      return this._request("GET", "/api/media/summary");
    }

    listMedia({ petId, deviceId, category, limit = 100, offset = 0 } = {}) {
      const params = { limit, offset };
      if (petId) params.pet_id = petId;
      if (deviceId) params.device_id = deviceId;
      if (category) params.category = category;
      return this._request("GET", "/api/media/list", { params });
    }

    presignedUploadUrl({ petId, examSessionId, sessionId, filename, mimeType, category = "image", visitDate }) {
      const json = {
        pet_id: petId,
        session_id: sessionId || examSessionId,
        exam_session_id: examSessionId || sessionId,
        filename: filename,
        mime_type: mimeType,
        category: category,
      };
      if (visitDate) json.visit_date = visitDate;
      return this._request("POST", "/api/media/presigned-upload-url", { json });
    }

    confirmMediaUpload({ mediaId, fileId, s3Key, petId, examSessionId, sessionId, originalFilename, mimeType, fileSizeBytes, category = "image", title, notes, visitDate }) {
      const json = {
        media_id: mediaId || fileId,
        file_id: fileId || mediaId,
        s3_key: s3Key,
        pet_id: petId,
        session_id: sessionId || examSessionId,
        exam_session_id: examSessionId || sessionId,
        original_filename: originalFilename,
        mime_type: mimeType,
        file_size_bytes: fileSizeBytes,
        category: category,
        title: title || originalFilename,
        notes: notes || "",
      };
      if (visitDate) json.visit_date = visitDate;
      return this._request("POST", "/api/media/confirm", { json });
    }

    multipartInitiate({ petId, examSessionId, sessionId, filename, mimeType, category = "video", visitDate }) {
      const json = {
        pet_id: petId,
        session_id: sessionId || examSessionId,
        filename,
        mime_type: mimeType,
        category,
      };
      if (visitDate) json.visit_date = visitDate;
      return this._request("POST", "/api/media/multipart/initiate", { json });
    }

    multipartPartUrl({ s3Key, uploadId, partNumber }) {
      const json = { s3_key: s3Key, upload_id: uploadId, part_number: partNumber };
      return this._request("POST", "/api/media/multipart/part-url", { json });
    }

    multipartComplete({ s3Key, uploadId, parts }) {
      const json = { s3_key: s3Key, upload_id: uploadId, parts };
      return this._request("POST", "/api/media/multipart/complete", { json });
    }

    multipartAbort({ s3Key, uploadId }) {
      const json = { s3_key: s3Key, upload_id: uploadId };
      return this._request("POST", "/api/media/multipart/abort", { json });
    }
  }

  /** Normalize list responses like ui.py does */
  function normalizePets(response) {
    if (Array.isArray(response)) return response;
    return response?.pets || [];
  }

  function normalizeSessions(response) {
    if (Array.isArray(response)) return response;
    return response?.exam_sessions || [];
  }

  global.VetApiClient = VetApiClient;
  global.VetApiNormalize = { normalizePets, normalizeSessions };
})(window);
