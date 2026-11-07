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
