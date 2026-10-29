/**
 * REMOTE API config — points to the live EC2 backend via ngrok.
 */
window.API_CONFIG = {
  baseUrl: "https://vetinstant-dashboard.duckdns.org",
  deviceId: "ARMY",
  allowedDevices: ["ARMY", "BRUNO", "ARCHIT", "ZARA", "ROCKY"],
  password: "army",
  timeoutMs: 25000,
};
