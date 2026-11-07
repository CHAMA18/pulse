"use client";

import { useEffect, useRef } from "react";

/**
 * PulseBackground — the living Duniya universe.
 *
 * Layers (bottom → top), all on one transparent canvas above a CSS gradient:
 *   1. Deep-space starfield with slow twinkle.
 *   2. A drifting constellation network whose links brighten near the cursor.
 *   3. The signature EKG heartbeat trace — a luminous monitor sweep that
 *      continuously travels across the screen with a glowing leading edge.
 *   4. Occasional shooting stars.
 *
 * Honors prefers-reduced-motion by rendering a single static frame.
 */

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  tw: number; // twinkle phase
  twSpeed: number;
  bright: boolean;
};

type Star = {
  x: number;
  y: number;
  r: number;
  tw: number;
  twSpeed: number;
  base: number;
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

const LINK_DIST = 132;
const MOUSE_RADIUS = 170;

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

    let particles: Particle[] = [];
    let stars: Star[] = [];
    let shooting: ShootingStar[] = [];
    let ripples: Ripple[] = [];
    let sweep = 0; // 0..1 across the screen
    let nextShootingAt = 0;

    const mouse = { x: -9999, y: -9999, active: false };

    const rand = (min: number, max: number) => min + Math.random() * (max - min);

    /* ---------- EKG waveform: P wave, QRS complex, T wave ---------- */
    const cycleFor = (w: number) => Math.min(640, Math.max(330, w / 4.2));
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
      const pCount = Math.round(Math.min(96, Math.max(34, area / 16500)));
      particles = Array.from({ length: pCount }, () => ({
        x: rand(0, width),
        y: rand(0, height),
        vx: rand(-0.16, 0.16),
        vy: rand(-0.12, 0.12),
        r: rand(1, 2.4),
        tw: rand(0, Math.PI * 2),
        twSpeed: rand(0.4, 1.4),
        bright: Math.random() < 0.18,
      }));
      const sCount = Math.round(Math.min(150, Math.max(60, area / 9500)));
      stars = Array.from({ length: sCount }, () => ({
        x: rand(0, width),
        y: rand(0, height),
        r: rand(0.4, 1.4),
        tw: rand(0, Math.PI * 2),
        twSpeed: rand(0.25, 0.9),
        base: rand(0.25, 0.75),
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

      /* 1 — starfield */
      for (const s of stars) {
        s.tw += s.twSpeed * dt;
        const a = staticFrame ? s.base : s.base * (0.55 + 0.45 * Math.sin(s.tw));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(226, 214, 255, ${(a * 0.8).toFixed(3)})`;
        ctx.fill();
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
            const baseA = (1 - d / LINK_DIST) * 0.17;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(167, 139, 250, ${baseA.toFixed(3)})`;
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
            ctx.strokeStyle = `rgba(192, 132, 252, ${((1 - d / MOUSE_RADIUS) * 0.3).toFixed(3)})`;
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
          ? `rgba(216, 180, 254, ${alpha.toFixed(3)})`
          : `rgba(196, 181, 253, ${(alpha * 0.8).toFixed(3)})`;
        ctx.fill();
        if (p.bright) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r + 3.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(168, 85, 247, ${(alpha * 0.14).toFixed(3)})`;
          ctx.fill();
        }
      }

      /* 3 — EKG heartbeat trace */
      const baseline = height * (height < 640 ? 0.52 : 0.56);
      const amp = Math.min(130, height * 0.15);
      const step = 4;

      // ambient halo under the whole line
      ctx.save();
      ctx.beginPath();
      for (let x = -step; x <= width + step; x += step) {
        const y = baseline - ekgValue(x, width) * amp;
        if (x <= 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "rgba(147, 51, 234, 0.10)";
      ctx.lineWidth = 7;
      ctx.shadowColor = "rgba(147, 51, 234, 0.5)";
      ctx.shadowBlur = 22;
      ctx.stroke();
      ctx.restore();

      // faint full trace
      ctx.save();
      ctx.beginPath();
      for (let x = -step; x <= width + step; x += step) {
        const y = baseline - ekgValue(x, width) * amp;
        if (x <= 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "rgba(221, 214, 254, 0.14)";
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();

      // luminous monitor sweep
      if (!staticFrame) {
        sweep = (sweep + (dt / 6.5) % 1) % 1;
        const head = sweep * (width + 260) - 130; // let it glide slightly past the edges
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
          ctx.strokeStyle = `rgba(${Math.round(216 + near * 39)}, ${Math.round(208 + near * 47)}, 254, ${(0.12 + eased * 0.75).toFixed(3)})`;
          ctx.lineWidth = 2 + near * 1.6;
          ctx.shadowColor = "rgba(168, 85, 247, 0.85)";
          ctx.shadowBlur = 6 + near * 22;
          ctx.stroke();
        }
        // leading pulse dot
        if (head > 0 && head < width) {
          const hy = baseline - ekgValue(head, width) * amp;
          const grad = ctx.createRadialGradient(head, hy, 0, head, hy, 14);
          grad.addColorStop(0, "rgba(255, 255, 255, 0.95)");
          grad.addColorStop(0.25, "rgba(224, 170, 255, 0.85)");
          grad.addColorStop(1, "rgba(168, 85, 247, 0)");
          ctx.beginPath();
          ctx.arc(head, hy, 14, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(head, hy, 2.4, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,0.98)";
          ctx.fill();
        }
        ctx.restore();
      }

      /* 4 — shooting stars */
      if (!staticFrame) {
        nextShootingAt -= dt;
        if (nextShootingAt <= 0 && shooting.length < 2) {
          nextShootingAt = rand(5, 11);
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
          const tailX = s.x - s.vx * 0.09;
          const tailY = s.y - s.vy * 0.09;
          const grad = ctx.createLinearGradient(s.x, s.y, tailX, tailY);
          grad.addColorStop(0, `rgba(240, 220, 255, ${(0.8 * k).toFixed(3)})`);
          grad.addColorStop(1, "rgba(168, 85, 247, 0)");
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.6;
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
          const alpha = (1 - r.t) * 0.35;
          ctx.beginPath();
          ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(192, 132, 252, ${alpha.toFixed(3)})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    };

    const loop = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
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
    };
    const onPointerLeave = () => {
      mouse.active = false;
      mouse.x = -9999;
      mouse.y = -9999;
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
