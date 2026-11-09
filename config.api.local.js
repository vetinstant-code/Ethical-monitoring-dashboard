/**
 * LOCAL DEVELOPMENT config — points the dashboard at the local proxy server.
 *
 * HOW TO USE
 * ----------
 * 1. Start the local server:
 *      python local_diag_server.py
 *    (or: python local_diag_server.py --offline  to run fully offline from cache)
 *
 * 2. Open index.html in a browser (or serve with a local HTTP server like Live Server).
 *
 * 3. Temporarily replace config.api.js with this file, OR open index.html and in the
 *    browser console run:
 *       window.API_CONFIG.baseUrl = "http://localhost:8765";
 *
 * TO SWITCH BACK TO GITHUB/PRODUCTION
 * ------------------------------------
 *    Restore config.api.js to use the ngrok URL.
 *
 * PERMANENT SWAP (easiest)
 * ------------------------
 *    Rename config.api.js  → config.api.ngrok.js
 *    Rename this file      → config.api.js
 *    (remember to undo before pushing to GitHub)
 */
window.API_CONFIG = {
  baseUrl: "http://localhost:8765",
  deviceId: "ARMY",
  allowedDevices: ["ARMY", "BRUNO", "ARCHIT", "ZARA", "ROCKY"],
  password: "army",
  timeoutMs: 30000,
};
