"use client";

import { useEffect, useRef } from "react";

/**
 * PulseBackground — the living Pulse universe.
 *
 * Layers (bottom → top), all on one transparent canvas above CSS aurora:
 *   1. Three depth-layered starfields with slow twinkle and pointer parallax.
 *   2. A drifting constellation network whose links brighten near the cursor.
 *   3. The signature EKG heartbeat trace — a luminous monitor sweep tuned to
 *      exactly 72 BPM (a resting heart), so the hero's vitals readout is
 *      honest: the animation beats once every 60/72 seconds. Each R-peak the
 *      head crosses flares with a soft cardiac glow.
 *   4. Occasional shooting stars.
 *   5. Click ripples.
 *
 * Honors prefers-reduced-motion by rendering a single static frame, and
 * pauses the loop when the tab is hidden.
 */

/** A resting heart: 72 beats per minute. */
const BEAT_PERIOD = 60 / 72; // 0.8333s
/** Spatial beats visible across the screen at once. */
const BEATS_PER_SCREEN = 5.6;
/** Seconds for the monitor head to travel the full width (+ margins). */
const SWEEP_DURATION = BEATS_PER_SCREEN * BEAT_PERIOD; // ≈ 4.67s

const LINK_DIST = 132;
const MOUSE_RADIUS = 170;

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  tw: number;
  twSpeed: number;
  bright: boolean;
};

type StarLayer = {
  stars: { x: number; y: number; r: number; tw: number; twSpeed: number; base: number }[];
  parallax: number; // 0..1 — how strongly this layer follows the pointer
  drift: number; // px/s of slow lateral drift
};

type ShootingStar = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
};

type Ripple = { x: number; y: number; t: number };

export function PulseBackground({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let raf = 0;
    let running = false;
    let last = performance.now();

    let layers: StarLayer[] = [];
    let particles: Particle[] = [];
    let shooting: ShootingStar[] = [];
    let ripples: Ripple[] = [];
    let sweep = 0; // 0..1 across the screen
    let nextShootingAt = 3;

    // Pointer position, raw + smoothed (for parallax easing).
    const mouse = { x: -9999, y: -9999, active: false };
    const parallax = { x: 0, y: 0, tx: 0, ty: 0 };

    const rand = (min: number, max: number) => min + Math.random() * (max - min);

    /* ------- EKG waveform: P wave, QRS complex, T wave (R at t = 0.35) ------- */
    const cycleFor = (w: number) => Math.min(700, Math.max(280, w / BEATS_PER_SCREEN));
    const ekgValue = (x: number, w: number) => {
      const cycle = cycleFor(w);
      const t = (((x % cycle) + cycle) % cycle) / cycle; // 0..1 within one beat
      const g = (center: number, sigma: number, amp: number) =>
        amp * Math.exp(-((t - center) * (t - center)) / (2 * sigma * sigma));
      return (
        g(0.17, 0.028, 0.13) + // P
        g(0.315, 0.008, -0.11) + // Q
        g(0.35, 0.012, 1.0) + // R
        g(0.385, 0.009, -0.24) + // S
        g(0.58, 0.035, 0.19) // T
      );
    };

    const seed = () => {
      const area = width * height;
      layers = [
        { parallax: 0.1, drift: 1.1, stars: [] },
        { parallax: 0.26, drift: 1.8, stars: [] },
        { parallax: 0.48, drift: 2.6, stars: [] },
      ];
      const counts = [
        Math.round(Math.min(90, Math.max(34, area / 15000))),
        Math.round(Math.min(64, Math.max(24, area / 24000))),
        Math.round(Math.min(40, Math.max(14, area / 40000))),
      ];
      layers.forEach((layer, i) => {
        layer.stars = Array.from({ length: counts[i] }, () => ({
          x: rand(0, width),
          y: rand(0, height),
          r: rand(0.35, 0.9) + i * 0.42, // nearer layers = bigger stars
          tw: rand(0, Math.PI * 2),
          twSpeed: rand(0.25, 0.9),
          base: rand(0.22, 0.5 + i * 0.16),
        }));
      });
      const pCount = Math.round(Math.min(88, Math.max(30, area / 18000)));
      particles = Array.from({ length: pCount }, () => ({
        x: rand(0, width),
        y: rand(0, height),
        vx: rand(-0.15, 0.15),
        vy: rand(-0.11, 0.11),
        r: rand(1, 2.3),
        tw: rand(0, Math.PI * 2),
        twSpeed: rand(0.4, 1.3),
        bright: Math.random() < 0.16,
      }));
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
      if (reduced) drawFrame(0, true);
    };

    /* ------------------------------ draw ------------------------------ */

    const drawFrame = (dt: number, staticFrame = false) => {
      ctx.clearRect(0, 0, width, height);

      /* 1 — depth starfield with pointer parallax */
      for (const layer of layers) {
        const ox = parallax.x * 26 * layer.parallax;
        const oy = parallax.y * 18 * layer.parallax;
        for (const s of layer.stars) {
          s.tw += s.twSpeed * dt;
          if (!staticFrame) {
            s.x += layer.drift * dt;
            if (s.x > width + 4) s.x = -4;
          }
          const a = staticFrame ? s.base : s.base * (0.55 + 0.45 * Math.sin(s.tw));
          ctx.beginPath();
          ctx.arc(s.x + ox, s.y + oy, s.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(226, 214, 255, ${(a * 0.85).toFixed(3)})`;
          ctx.fill();
        }
      }

      /* 2 — constellation network */
      for (const p of particles) {
        if (!staticFrame) {
          p.x += p.vx * dt * 60;
          p.y += p.vy * dt * 60;
          p.tw += p.twSpeed * dt;
          if (p.x < -20) p.x = width + 20;
          if (p.x > width + 20) p.x = -20;
          if (p.y < -20) p.y = height + 20;
          if (p.y > height + 20) p.y = -20;

          // gentle attraction toward an active cursor
          if (mouse.active) {
            const dx = mouse.x - p.x;
            const dy = mouse.y - p.y;
            const d = Math.hypot(dx, dy);
            if (d < MOUSE_RADIUS && d > 0.001) {
              const pull = ((MOUSE_RADIUS - d) / MOUSE_RADIUS) * 0.012;
              p.x += (dx / d) * pull * 60 * dt;
              p.y += (dy / d) * pull * 60 * dt;
            }
          }
        }
      }

      ctx.lineWidth = 1;
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < LINK_DIST * LINK_DIST) {
            const d = Math.sqrt(d2);
            const baseA = (1 - d / LINK_DIST) * 0.14;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(216, 180, 254, ${baseA.toFixed(3)})`;
            ctx.stroke();
          }
        }
        // cursor link
        if (mouse.active) {
          const d = Math.hypot(mouse.x - a.x, mouse.y - a.y);
          if (d < MOUSE_RADIUS) {
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(mouse.x, mouse.y);
            ctx.strokeStyle = `rgba(232, 121, 249, ${((1 - d / MOUSE_RADIUS) * 0.28).toFixed(3)})`;
            ctx.stroke();
          }
        }
      }
      for (const p of particles) {
        const twinkle = staticFrame ? 0.8 : 0.55 + 0.45 * Math.sin(p.tw);
        const alpha = (p.bright ? 0.9 : 0.5) * twinkle;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.bright ? p.r + 0.6 : p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.bright
          ? `rgba(240, 171, 252, ${alpha.toFixed(3)})`
          : `rgba(216, 180, 254, ${(alpha * 0.8).toFixed(3)})`;
        ctx.fill();
        if (p.bright) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r + 3.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(217, 70, 239, ${(alpha * 0.13).toFixed(3)})`;
          ctx.fill();
        }
      }

      /* 3 — EKG heartbeat trace, tuned to exactly 72 BPM */
      const baseline = height * (height < 640 ? 0.54 : 0.58);
      const amp = Math.min(118, height * 0.14);
      const step = 4;

      const tracePath = () => {
        ctx.beginPath();
        for (let x = -step; x <= width + step; x += step) {
          const y = baseline - ekgValue(x, width) * amp;
          if (x <= 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      };

      // ambient halo under the whole line
      ctx.save();
      tracePath();
      ctx.strokeStyle = "rgba(168, 85, 247, 0.09)";
      ctx.lineWidth = 7;
      ctx.shadowColor = "rgba(168, 85, 247, 0.5)";
      ctx.shadowBlur = 24;
      ctx.stroke();
      ctx.restore();

      // faint full trace
      ctx.save();
      tracePath();
      ctx.strokeStyle = "rgba(233, 213, 255, 0.13)";
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();

      // luminous monitor sweep — one crossing per SWEEP_DURATION
      let beatFlash = 0;
      if (!staticFrame) {
        sweep = (sweep + dt / SWEEP_DURATION) % 1;
      } else {
        sweep = 0.44; // a beautiful mid-screen position for the static frame
      }
      const head = sweep * (width + 260) - 130;
      const tail = head - 300;

      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      for (let x = Math.max(tail, -step); x < Math.min(head, width + step); x += step) {
        const fade = (x - tail) / (head - tail);
        const eased = Math.pow(Math.max(0, fade), 1.6);
        const y = baseline - ekgValue(x, width) * amp;
        const yPrev = baseline - ekgValue(x - step, width) * amp;
        ctx.beginPath();
        ctx.moveTo(x - step, yPrev);
        ctx.lineTo(x, y);
        const near = Math.max(0, fade - 0.82) / 0.18; // hottest near the head
        ctx.strokeStyle = `rgba(${Math.round(216 + near * 39)}, ${Math.round(208 + near * 47)}, 254, ${(0.12 + eased * 0.72).toFixed(3)})`;
        ctx.lineWidth = 2 + near * 1.6;
        ctx.shadowColor = "rgba(217, 70, 239, 0.85)";
        ctx.shadowBlur = 6 + near * 22;
        ctx.stroke();
      }
      // leading pulse dot
      if (head > 0 && head < width) {
        const hy = baseline - ekgValue(head, width) * amp;
        const grad = ctx.createRadialGradient(head, hy, 0, head, hy, 14);
        grad.addColorStop(0, "rgba(255, 255, 255, 0.95)");
        grad.addColorStop(0.25, "rgba(240, 171, 252, 0.85)");
        grad.addColorStop(1, "rgba(217, 70, 239, 0)");
        ctx.beginPath();
        ctx.arc(head, hy, 14, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(head, hy, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 255, 255, 0.98)";
        ctx.fill();
      }
      ctx.restore();

      // cardiac flash when the head crosses an R-peak (R sits at 0.35 of a beat)
      const beatPhase = (sweep * BEATS_PER_SCREEN) % 1;
      beatFlash = Math.exp(-Math.pow(beatPhase - 0.35, 2) / (2 * 0.022 * 0.022));
      if (beatFlash > 0.12 && head > 0 && head < width) {
        const hy = baseline - ekgValue(head, width) * amp;
        const glow = ctx.createRadialGradient(head, hy, 0, head, hy, 64);
        glow.addColorStop(0, `rgba(240, 171, 252, ${(beatFlash * 0.22).toFixed(3)})`);
        glow.addColorStop(1, "rgba(217, 70, 239, 0)");
        ctx.beginPath();
        ctx.arc(head, hy, 64, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();
      }

      /* 4 — shooting stars */
      if (!staticFrame) {
        nextShootingAt -= dt;
        if (nextShootingAt <= 0 && shooting.length < 2) {
          nextShootingAt = rand(7, 14);
          const fromLeft = Math.random() < 0.5;
          shooting.push({
            x: fromLeft ? rand(-60, width * 0.3) : rand(width * 0.7, width + 60),
            y: rand(-40, height * 0.3),
            vx: (fromLeft ? 1 : -1) * rand(320, 460),
            vy: rand(120, 200),
            life: 0,
            maxLife: rand(0.9, 1.4),
          });
        }
        shooting = shooting.filter((s) => s.life < s.maxLife);
        for (const s of shooting) {
          s.life += dt;
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          const k = 1 - s.life / s.maxLife;
          const tailX = s.x - s.vx * 0.11;
          const tailY = s.y - s.vy * 0.11;
          const grad = ctx.createLinearGradient(s.x, s.y, tailX, tailY);
          grad.addColorStop(0, `rgba(245, 230, 255, ${(0.75 * k).toFixed(3)})`);
          grad.addColorStop(1, "rgba(217, 70, 239, 0)");
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(tailX, tailY);
          ctx.stroke();
        }
      }

      /* 5 — click ripples */
      if (!staticFrame) {
        ripples = ripples.filter((r) => r.t < 1);
        for (const r of ripples) {
          r.t += dt * 1.1;
          const radius = r.t * 190;
          const alpha = (1 - r.t) * 0.32;
          ctx.beginPath();
          ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(232, 121, 249, ${alpha.toFixed(3)})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    };

    const loop = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // ease the parallax toward its pointer target
      parallax.x += (parallax.tx - parallax.x) * Math.min(1, dt * 3.4);
      parallax.y += (parallax.ty - parallax.y) * Math.min(1, dt * 3.4);

      drawFrame(dt);
      raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (reduced) {
        drawFrame(0, true);
        return;
      }
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const onVisibility = () => (document.hidden ? stop() : start());

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.active = true;
      parallax.tx = (mouse.x / Math.max(1, rect.width)) - 0.5;
      parallax.ty = (mouse.y / Math.max(1, rect.height)) - 0.5;
    };
    const onPointerLeave = () => {
      mouse.active = false;
      mouse.x = -9999;
      mouse.y = -9999;
      parallax.tx = 0;
      parallax.ty = 0;
    };
    const isInteractiveTarget = (el: EventTarget | null) =>
      el instanceof HTMLElement &&
      !!el.closest(
        "button, a, input, textarea, select, [role='checkbox'], [role='dialog'], [data-radix-popper-content-wrapper]"
      );
    const onPointerDown = (e: PointerEvent) => {
      if (isInteractiveTarget(e.target)) return;
      const rect = canvas.getBoundingClientRect();
      ripples.push({ x: e.clientX - rect.left, y: e.clientY - rect.top, t: 0 });
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.documentElement.addEventListener("mouseleave", onPointerLeave);
    document.addEventListener("visibilitychange", onVisibility);

    resize();
    start();

    return () => {
      stop();
      ro.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      document.documentElement.removeEventListener("mouseleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className ?? "fixed inset-0 h-full w-full"}
    />
  );
}
