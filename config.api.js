/**
 * API config for GitHub Pages dashboard → ngrok → EC2.
 * Device ID is just the default shown on load; users can switch at login.
 */
window.API_CONFIG = {
  baseUrl: "https://wick-vehicular-dingy.ngrok-free.dev",
  deviceId: "ARMY",
  allowedDevices: ["ARMY", "BRUNO", "ARCHIT", "ZARA"],
  password: "army",
  timeoutMs: 25000,
};
