/**
 * Multi-device login gate — dashboard after sign-in.
 */
(function (global) {
  const SESSION_KEY = "vet_auth_session";
  const DEFAULT_ALLOWED_DEVICES = ["ARMY", "BRUNO", "ARCHIT", "ZARA"];

  function $(id) {
    return document.getElementById(id);
  }

  function getAllowedDevices() {
    const configured = global.API_CONFIG?.allowedDevices;
    const list = Array.isArray(configured) && configured.length ? configured : DEFAULT_ALLOWED_DEVICES;
    return [...new Set(list.map((v) => String(v || "").trim().toUpperCase()).filter(Boolean))];
  }

  function defaultDeviceId() {
    const configured = String(global.API_CONFIG?.deviceId || "").trim().toUpperCase();
    const allowed = getAllowedDevices();
    if (configured && allowed.includes(configured)) return configured;
    return allowed[0] || "ARMY";
  }

  function currentDeviceId() {
    return getSession()?.deviceId || defaultDeviceId();
  }

  function getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      const deviceId = String(s.deviceId || "").trim().toUpperCase();
      if (!getAllowedDevices().includes(deviceId) || !s.password) return null;
      s.deviceId = deviceId;
      return s;
    } catch {
      return null;
    }
  }

  function saveSession(deviceId, password) {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ deviceId, password, loggedInAt: Date.now() })
    );
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem("vet_device_password");
  }

  function isLoggedIn() {
    return !!getSession();
  }

  function showLogin(errMsg) {
    $("login-screen")?.removeAttribute("hidden");
    $("app-root")?.setAttribute("hidden", "");
    const err = $("login-error");
    if (err) {
      if (errMsg) {
        err.textContent = errMsg;
        err.hidden = false;
      } else {
        err.textContent = "";
        err.hidden = true;
      }
    }
    const pwd = $("login-password");
    if (pwd) pwd.value = "";
  }

  function showApp() {
    $("login-screen")?.setAttribute("hidden", "");
    $("app-root")?.removeAttribute("hidden");
  }

  function populateDeviceOptions() {
    const field = $("login-device");
    if (!field) return;
    const allowed = getAllowedDevices();
    const selected = currentDeviceId();
    field.innerHTML = allowed
      .map((deviceId) => `<option value="${deviceId}">${deviceId}</option>`)
      .join("");
    field.value = allowed.includes(selected) ? selected : allowed[0] || "";
  }

  function applyDeviceMode(resetKpiCounts, deviceId = currentDeviceId()) {
    document.body.classList.remove("device-army", "device-bruno", "device-archit", "device-zara");
    document.body.classList.add(`device-${String(deviceId || "").toLowerCase()}`, "species-horse-only");
    document.title = "VetInstant — Animal Health Intelligence";

    if (global.API_CONFIG) {
      global.API_CONFIG.deviceId = deviceId;
    }

    const deviceField = $("excel-device-id");
    if (deviceField) deviceField.value = deviceId;

    if (resetKpiCounts) {
      ["kpi-total-animals", "kpi-vitals-today"].forEach((id) => {
        const el = $(id);
        if (el) el.textContent = "0";
      });
    }
  }

  function onDashboardReady() {
    applyDeviceMode(false);
    if (global.VetLiveApi?.bootstrapIfLoggedIn) {
      global.VetLiveApi.bootstrapIfLoggedIn();
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    const deviceId = ($("login-device")?.value || defaultDeviceId()).trim().toUpperCase();
    const password = ($("login-password")?.value || "").trim();
    const submit = $("login-submit");
    const err = $("login-error");

    if (!getAllowedDevices().includes(deviceId)) {
      if (err) {
        err.textContent = `Allowed devices: ${getAllowedDevices().join(", ")}.`;
        err.hidden = false;
      }
      return;
    }
    if (!password) {
      if (err) {
        err.textContent = `Enter the ${deviceId} device password.`;
        err.hidden = false;
      }
      return;
    }

    if (submit) {
      submit.disabled = true;
      submit.textContent = "Signing in…";
    }
    if (err) err.hidden = true;

    try {
      if (!global.API_CONFIG?.baseUrl) throw new Error("API not configured (config.api.js).");

      if (global.VetLiveApi?.resetStore) global.VetLiveApi.resetStore();
      global.__vetApiClient = null;

      const client = new global.VetApiClient({ ...global.API_CONFIG, deviceId });
      await client.login(deviceId, password);

      saveSession(deviceId, password);
      sessionStorage.setItem("vet_device_password", password);
      global.__vetApiClient = client;
      if (global.VetLiveApi?.setApiClient) global.VetLiveApi.setApiClient(client);

      global.VetReportsPage?.resetSession?.({ full: true });
      showApp();
      applyDeviceMode(true, deviceId);
      if (location.hash !== "#/" && location.hash !== "#") {
        location.hash = "#/";
      }
      global.VetAppPages?.route?.();
      onDashboardReady();
      global.VetDashboardFilters?.populateAnimalTypes?.();
      window.dispatchEvent(new CustomEvent("vet:session-changed", { detail: { deviceId } }));
    } catch (e) {
      if (err) {
        err.textContent = e.message || "Login failed. Check password and API connection.";
        err.hidden = false;
      }
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = "Sign in to dashboard";
      }
    }
  }

  function handleLogout() {
    window.dispatchEvent(new CustomEvent("vet:session-ended"));
    global.VetReportsPage?.resetSession?.({ full: true });
    clearSession();
    global.__vetApiClient = null;
    if (global.VetLiveApi?.resetStore) {
      global.VetLiveApi.resetStore();
    }
    if (location.hash !== "#/" && location.hash !== "#") {
      location.hash = "#/";
    }
    showLogin();
  }

  function init() {
    populateDeviceOptions();
    $("login-form")?.addEventListener("submit", handleLogin);
    $("logout-btn")?.addEventListener("click", handleLogout);

    window.addEventListener("dashboard:ready", () => {
      if (isLoggedIn()) global.VetAppPages?.route?.();
    });

    window.addEventListener("storage", (e) => {
      if (e.key !== SESSION_KEY) return;
      if (!e.newValue) {
        handleLogout();
        return;
      }
      try {
        const next = JSON.parse(e.newValue);
        const nextDevice = String(next.deviceId || "").trim().toUpperCase();
        let prevDevice = "";
        if (e.oldValue) {
          prevDevice = String(JSON.parse(e.oldValue).deviceId || "").trim().toUpperCase();
        }
        if (nextDevice && nextDevice !== prevDevice) {
          global.VetLiveApi?.resetStore?.();
          global.__vetApiClient = null;
          global.VetReportsPage?.resetSession?.({ full: true });
          applyDeviceMode(false, nextDevice);
          if (location.hash !== "#/" && location.hash !== "#") {
            location.hash = "#/";
          }
          global.VetAppPages?.route?.();
          onDashboardReady();
          global.VetDashboardFilters?.populateAnimalTypes?.();
          window.dispatchEvent(new CustomEvent("vet:session-changed", { detail: { deviceId: nextDevice } }));
        }
      } catch {
        /* ignore malformed session */
      }
    });

    if (isLoggedIn()) {
      showApp();
      applyDeviceMode(false);
      global.VetAppPages?.route?.();
      if (global.VetLiveApi?.bootstrapIfLoggedIn) {
        global.VetLiveApi.bootstrapIfLoggedIn();
      }
    } else {
      showLogin();
    }
  }

  document.addEventListener("DOMContentLoaded", init);

  window.addEventListener("pageshow", () => {
    if (!isLoggedIn()) showLogin();
  });

  global.VetAuth = {
    isLoggedIn,
    getSession,
    getDeviceId: currentDeviceId,
    getAllowedDevices,
    onDashboardReady,
    applyDeviceMode,
    showLogin,
    logout: handleLogout,
  };
})(window);
