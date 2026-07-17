/**
 * ARMY device login gate — dashboard after sign-in.
 */
(function (global) {
  const SESSION_KEY = "vet_auth_session";
  const ALLOWED_DEVICE = "ARMY";

  function $(id) {
    return document.getElementById(id);
  }

  function getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (s.deviceId !== ALLOWED_DEVICE || !s.password) return null;
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

  function applyHorseOnlyMode(resetKpiCounts) {
    document.body.classList.add("device-army", "species-horse-only");
    document.title = "VetInstant — Animal Health Intelligence";

    if (global.API_CONFIG) {
      global.API_CONFIG.deviceId = ALLOWED_DEVICE;
    }

    const deviceField = $("excel-device-id");
    if (deviceField) deviceField.value = ALLOWED_DEVICE;

    if (resetKpiCounts) {
      ["kpi-total-animals", "kpi-vitals-today"].forEach((id) => {
        const el = $(id);
        if (el) el.textContent = "0";
      });
    }
  }

  function onDashboardReady() {
    applyHorseOnlyMode(false);
    if (global.VetLiveApi?.bootstrapIfLoggedIn) {
      global.VetLiveApi.bootstrapIfLoggedIn();
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    const deviceId = ($("login-device")?.value || ALLOWED_DEVICE).trim().toUpperCase();
    const password = ($("login-password")?.value || "").trim();
    const submit = $("login-submit");
    const err = $("login-error");

    if (deviceId !== ALLOWED_DEVICE) {
      if (err) {
        err.textContent = "Only ARMY device login is allowed.";
        err.hidden = false;
      }
      return;
    }
    if (!password) {
      if (err) {
        err.textContent = "Enter the ARMY device password.";
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
      const client = new global.VetApiClient({ ...global.API_CONFIG, deviceId });
      await client.login(deviceId, password);

      saveSession(deviceId, password);
      sessionStorage.setItem("vet_device_password", password);
      global.__vetApiClient = client;

      showApp();
      applyHorseOnlyMode(true);
      onDashboardReady();
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
    clearSession();
    global.__vetApiClient = null;
    if (global.VetLiveApi?.resetStore) {
      global.VetLiveApi.resetStore();
    }
    showLogin();
  }

  function init() {
    $("login-form")?.addEventListener("submit", handleLogin);
    $("logout-btn")?.addEventListener("click", handleLogout);

    window.addEventListener("dashboard:ready", () => {
      if (isLoggedIn()) onDashboardReady();
    });

    if (isLoggedIn()) {
      showApp();
      applyHorseOnlyMode(false);
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
    getDeviceId: () => ALLOWED_DEVICE,
    onDashboardReady,
    applyHorseOnlyMode,
    showLogin,
    logout: handleLogout,
  };
})(window);
