import { cn } from "@/lib/utils";

/**
 * Pulse brand mark — a constellation ring carrying a heartbeat trace,
 * pure SVG so it stays crisp at any size.
 */
export function PulseMark({
  className,
  glow = true,
}: {
  className?: string;
  glow?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label="Pulse logo"
      className={cn("h-14 w-14", glow && "drop-shadow-[0_0_14px_rgba(176,38,255,0.45)]", className)}
    >
      <defs>
        <linearGradient id="pulse-g" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#d946ef" />
          <stop offset="0.5" stopColor="#b026ff" />
          <stop offset="1" stopColor="#8b2fe8" />
        </linearGradient>
      </defs>
      {/* constellation ring links */}
      <g stroke="url(#pulse-g)" strokeWidth="2" opacity="0.5" fill="none">
        <line x1="32" y1="7" x2="50" y2="16" />
        <line x1="50" y1="16" x2="57" y2="32" />
        <line x1="57" y1="32" x2="50" y2="48" />
        <line x1="50" y1="48" x2="32" y2="57" />
        <line x1="32" y1="57" x2="14" y2="48" />
        <line x1="14" y1="48" x2="7" y2="32" />
        <line x1="7" y1="32" x2="14" y2="16" />
        <line x1="14" y1="16" x2="32" y2="7" />
      </g>
      {/* constellation nodes */}
      <g fill="url(#pulse-g)">
        <circle cx="32" cy="7" r="4.4" />
        <circle cx="50" cy="16" r="4.4" />
        <circle cx="57" cy="32" r="4.4" />
        <circle cx="50" cy="48" r="4.4" />
        <circle cx="32" cy="57" r="4.4" />
        <circle cx="14" cy="48" r="4.4" />
        <circle cx="7" cy="32" r="4.4" />
        <circle cx="14" cy="16" r="4.4" />
      </g>
      {/* heartbeat trace */}
      <polyline
        points="6,32 22,32 27,23 32,41 36,16 41,34 44,32 58,32"
        fill="none"
        stroke="url(#pulse-g)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Full lockup: mark + gradient wordmark. */
export function PulseLogo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center justify-center gap-3", className)}>
      <PulseMark className="h-12 w-12 sm:h-14 sm:w-14" />
      <span
        aria-hidden="true"
        className="text-brand-gradient select-none text-[40px] font-bold leading-none tracking-tight sm:text-[44px]"
      >
        Pulse
      </span>
      <span className="sr-only">Pulse — Pharmacy Intelligence, Delivered</span>
    </span>
  );
}

/**
 * PulseBeatMark — the brand mark with a living heartbeat, for moments where
 * the logo itself should feel alive (the sign-in card's crown).
 *
 * Every layer is locked to the shared 1.2s beat clock (72 BPM, same clock as
 * the landing hero) and driven purely by CSS so it loops without JS:
 *   1. halo            — a soft violet aura that swells on every beat
 *   2. ripple rings    — two staggered pulse waves radiating outward
 *   3. lub-dub thump   — systole/diastole scale on the mark itself
 *   4. node glow       — the constellation brightens at each contraction
 *   5. EKG sweep       — a bright trace redraws the heartbeat left-to-right
 *   6. apex spark      — a spark flashes as the sweep crosses the R-wave
 * The base brand trace always stays on underneath, so between beats the mark
 * reads exactly like the static PulseMark.
 */
export function PulseBeatMark({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex items-center justify-center", className)}>
      {/* halo — swells softly on every beat */}
      <span
        aria-hidden="true"
        className="animate-beat-halo absolute -inset-[42%] rounded-full bg-[radial-gradient(closest-side,rgba(217,70,239,0.30),rgba(139,47,232,0.10)_55%,transparent_76%)] blur-[10px]"
      />
      {/* ripple rings — two staggered pulse waves */}
      <span
        aria-hidden="true"
        className="animate-beat-ring absolute inset-[4%] rounded-full border border-fuchsia-400/50"
      />
      <span
        aria-hidden="true"
        className="animate-beat-ring-late absolute inset-[4%] rounded-full border border-purple-500/35"
      />

      {/* the mark — lub-dub thump */}
      <span className="animate-beat-thump relative inline-flex h-full w-full">
        <svg
          viewBox="0 0 64 64"
          aria-hidden="true"
          focusable="false"
          className="h-full w-full drop-shadow-[0_0_16px_rgba(176,38,255,0.45)]"
        >
          <defs>
            <linearGradient id="pulse-g-beat" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#d946ef" />
              <stop offset="0.5" stopColor="#b026ff" />
              <stop offset="1" stopColor="#8b2fe8" />
            </linearGradient>
          </defs>

          {/* constellation — breathes brighter at each contraction */}
          <g className="pulse-beat-nodes">
            <g stroke="url(#pulse-g-beat)" strokeWidth="2" opacity="0.5" fill="none">
              <line x1="32" y1="7" x2="50" y2="16" />
              <line x1="50" y1="16" x2="57" y2="32" />
              <line x1="57" y1="32" x2="50" y2="48" />
              <line x1="50" y1="48" x2="32" y2="57" />
              <line x1="32" y1="57" x2="14" y2="48" />
              <line x1="14" y1="48" x2="7" y2="32" />
              <line x1="7" y1="32" x2="14" y2="16" />
              <line x1="14" y1="16" x2="32" y2="7" />
            </g>
            <g fill="url(#pulse-g-beat)">
              <circle cx="32" cy="7" r="4.4" />
              <circle cx="50" cy="16" r="4.4" />
              <circle cx="57" cy="32" r="4.4" />
              <circle cx="50" cy="48" r="4.4" />
              <circle cx="32" cy="57" r="4.4" />
              <circle cx="14" cy="48" r="4.4" />
              <circle cx="7" cy="32" r="4.4" />
              <circle cx="14" cy="16" r="4.4" />
            </g>
          </g>

          {/* base heartbeat trace — always on, brand gradient */}
          <polyline
            points="6,32 22,32 27,23 32,41 36,16 41,34 44,32 58,32"
            fill="none"
            stroke="url(#pulse-g-beat)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* live EKG sweep — redraws the trace every beat */}
          <polyline
            className="pulse-beat-sweep"
            pathLength={1}
            points="6,32 22,32 27,23 32,41 36,16 41,34 44,32 58,32"
            fill="none"
            stroke="#f0abfc"
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* apex spark — flashes as the sweep crosses the R-wave */}
          <circle className="pulse-beat-spark" cx="36" cy="16" r="2.3" fill="#f0abfc" />
        </svg>
      </span>
    </span>
  );
}
