/**
 * Login panel FX — fixed diagonal ECG shooting-star logos.
 */
(function () {
  const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ECG_STAR_COUNT = 4;
  const ECG_STAR_SPEED = 100;
  const ECG_LANE_GAP = 100;
  const ECG_PATH_GAP = 0.26;
  const ECG_TRAIL_MAX = 200;

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function ecgOffset(dist, amp, seed) {
    const cycle = 70 + seed * 18;
    const t = ((dist % cycle) + cycle) % cycle;
    const p = t / cycle;
    if (p < 0.18) return Math.sin(p * 40) * amp * 0.08;
    if (p < 0.28) return Math.sin(((p - 0.18) / 0.1) * Math.PI) * amp * 0.25;
    if (p < 0.36) return 0;
    if (p < 0.4) return -amp * 0.2 * ((p - 0.36) / 0.04);
    if (p < 0.46) return amp * ((p - 0.4) / 0.06);
    if (p < 0.5) return amp * (1 - (p - 0.46) / 0.04) * 1.1;
    if (p < 0.56) return -amp * 0.28 * (1 - (p - 0.5) / 0.06);
    if (p < 0.7) return 0;
    if (p < 0.85) return Math.sin(((p - 0.7) / 0.15) * Math.PI) * amp * 0.35;
    return 0;
  }

  function initEffects() {
    const panel = document.getElementById("login-form-panel");
    const field = document.getElementById("login-logo-field");
    const canvas = document.getElementById("login-ecg-canvas");
    if (!panel || !field) return;

    panel.setAttribute("data-login-theme", "ecg");

    const marks = [...field.querySelectorAll(".login-logo-mark")].slice(0, ECG_STAR_COUNT);
    const ctx = canvas?.getContext?.("2d") || null;

    let raf = 0;
    let lastT = 0;
    let w = 1;
    let h = 1;

    const trails = [];
    const stars = [];
    const path = { ux: 0, uy: 0, pathLen: 1, margin: 0, size: 52, px: 0, py: 0 };

    function resizeCanvas() {
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = panel.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function computeDiagonalPath() {
      const size = 52;
      const margin = size + 12;
      const dx = w + margin * 2;
      const dy = h + margin * 2;
      const pathLen = Math.hypot(dx, dy) || 1;
      path.ux = dx / pathLen;
      path.uy = dy / pathLen;
      path.pathLen = pathLen;
      path.margin = margin;
      path.size = size;
      path.px = -path.uy;
      path.py = path.ux;
    }

    function initStarPool() {
      stars.length = 0;
      marks.forEach((el, i) => {
        stars.push({
          el,
          active: false,
          lane: i - (ECG_STAR_COUNT - 1) / 2,
          originX: 0,
          originY: 0,
          pathLen: 1,
          traveled: 0,
          x: -200,
          y: -200,
          size: 52,
          seed: 0.18 + i * 0.27,
          trail: [],
        });
      });
    }

    function placeStarOnLane(star, progress) {
      computeDiagonalPath();
      const laneOffset = star.lane * ECG_LANE_GAP;
      const startX = -path.margin + path.px * laneOffset;
      const startY = -path.margin + path.py * laneOffset;

      star.active = true;
      star.size = path.size;
      star.originX = startX;
      star.originY = startY;
      star.pathLen = path.pathLen;
      star.traveled = clamp(progress, 0, path.pathLen * 0.92);
      star.trail = [];
      star.x = startX + path.ux * star.traveled;
      star.y = startY + path.uy * star.traveled;
      star.el.style.width = `${path.size}px`;
      star.el.style.height = `${path.size}px`;
    }

    function resetStars() {
      trails.length = 0;
      initStarPool();
      if (ctx) ctx.clearRect(0, 0, w, h);
      computeDiagonalPath();
      stars.forEach((star, i) => {
        placeStarOnLane(star, path.pathLen * (i * ECG_PATH_GAP));
      });
    }

    function sampleTrail(star) {
      const amp = 12 + star.seed * 6;
      const off = ecgOffset(star.traveled, amp, star.seed);
      const cx = star.x + star.size / 2;
      const cy = star.y + star.size / 2;
      star.trail.push({
        x: cx + path.px * off,
        y: cy + path.py * off,
        a: 0.62,
      });
      if (star.trail.length > ECG_TRAIL_MAX) star.trail.shift();
    }

    function releaseTrail(star) {
      if (star.trail.length > 4) {
        trails.push({
          points: star.trail.map((p) => ({ ...p })),
        });
      }
      star.trail = [];
    }

    function drawTrails(dt) {
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 1.55;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      for (const star of stars) {
        if (!star.active || star.trail.length < 2) continue;
        ctx.beginPath();
        star.trail.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
          p.a = Math.max(0, p.a - dt * 0.16);
        });
        ctx.strokeStyle = "rgba(37, 99, 235, 0.38)";
        ctx.globalAlpha = 0.58;
        ctx.stroke();
        while (star.trail.length && star.trail[0].a <= 0.02) star.trail.shift();
      }

      for (let i = trails.length - 1; i >= 0; i--) {
        const trail = trails[i];
        let any = false;
        ctx.beginPath();
        trail.points.forEach((p, idx) => {
          p.a -= dt * 0.28;
          if (p.a > 0.02) any = true;
          if (idx === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        if (!any) {
          trails.splice(i, 1);
          continue;
        }
        const alpha = trail.points[trail.points.length - 1]?.a || 0;
        ctx.strokeStyle = `rgba(37, 99, 235, ${0.1 + alpha * 0.32})`;
        ctx.globalAlpha = Math.max(0.04, alpha);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    function updateStars(dt) {
      const angle = Math.atan2(path.uy, path.ux) * (180 / Math.PI);

      for (const star of stars) {
        if (!star.active) {
          placeStarOnLane(star, 0);
          continue;
        }

        star.traveled += ECG_STAR_SPEED * dt;
        star.x = star.originX + path.ux * star.traveled;
        star.y = star.originY + path.uy * star.traveled;
        sampleTrail(star);

        star.el.style.transform =
          `translate3d(${star.x.toFixed(1)}px, ${star.y.toFixed(1)}px, 0) rotate(${angle.toFixed(1)}deg)`;

        if (star.traveled >= star.pathLen) {
          releaseTrail(star);
          placeStarOnLane(star, 0);
        }
      }

      drawTrails(dt);
    }

    function tick(t) {
      const dt = Math.min(0.033, ((t - (lastT || t)) / 1000) || 0.016);
      lastT = t;
      updateStars(dt);
      raf = requestAnimationFrame(tick);
    }

    function start() {
      if (REDUCE) return;
      if (!raf) {
        lastT = 0;
        raf = requestAnimationFrame(tick);
      }
    }

    function stop() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    }

    resizeCanvas();
    resetStars();

    window.addEventListener("resize", () => {
      resizeCanvas();
      resetStars();
    });

    const screen = document.getElementById("login-screen");
    if (screen && typeof MutationObserver !== "undefined") {
      const obs = new MutationObserver(() => {
        if (screen.hasAttribute("hidden")) stop();
        else {
          resizeCanvas();
          resetStars();
          start();
        }
      });
      obs.observe(screen, { attributes: true, attributeFilter: ["hidden"] });
    }

    if (!screen?.hasAttribute("hidden")) start();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initEffects);
  } else {
    initEffects();
  }
})();
