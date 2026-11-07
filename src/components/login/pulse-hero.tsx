"use client";

import { motion } from "framer-motion";
import { Activity, ShieldCheck, Truck, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { DownloadButtons } from "@/components/login/download-buttons";
import { PulseMark } from "@/components/login/pulse-logo";

/**
 * PulseHero — the editorial half of the landing composition.
 *
 * Every claim on screen is true:
 *  - the EKG trace in the background is tuned to exactly 72 BPM, so the
 *    "72 BPM · AMBIENT" readout describes the animation you are watching;
 *  - the clock is the real current UTC time;
 *  - the feature ticks describe Pulse's actual capabilities.
 */

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 26, filter: "blur(6px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const },
});

function useUtcClock(): string | null {
  const [time, setTime] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setTime(new Date().toISOString().slice(11, 19));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return time;
}

const FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: Activity, title: "Live vitals", desc: "Stock & demand in real time" },
  { icon: Truck, title: "Delivery tracking", desc: "Every shipment, end to end" },
  { icon: ShieldCheck, title: "Verified access", desc: "Dual portals, secured sessions" },
];

export function PulseHero({ className }: { className?: string }) {
  const time = useUtcClock();

  return (
    <div className={className}>
      {/* Brand lockup — the mark thumps with a lub-dub heartbeat */}
      <motion.div {...fadeUp(0)} className="inline-flex items-center gap-3.5">
        <span className="relative inline-flex">
          <span
            aria-hidden="true"
            className="animate-beat-ring absolute inset-0 rounded-full bg-fuchsia-500/30 blur-md"
          />
          <PulseMark className="animate-beat-thump relative h-11 w-11" />
        </span>
        <span className="text-brand-gradient text-[32px] font-bold leading-none tracking-tight">
          Pulse
        </span>
        <span aria-hidden="true" className="h-5 w-px bg-white/15" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
          Duniya Healthcare
        </span>
      </motion.div>

      {/* Headline */}
      <motion.h1
        {...fadeUp(0.09)}
        className="mt-10 text-[clamp(2.7rem,4.6vw,4.4rem)] font-semibold leading-[1.03] tracking-[-0.035em] text-white"
      >
        <span className="block">Pharmacy intelligence,</span>
        <span className="relative inline-block">
          <span className="text-brand-gradient animate-gradient">delivered.</span>
          <svg
            aria-hidden="true"
            className="absolute -bottom-2.5 left-0 h-4 w-full"
            viewBox="0 0 220 24"
            fill="none"
            preserveAspectRatio="none"
          >
            <path
              d="M2 15 H58 L70 15 78 4 88 21 96 11 103 15 H218"
              pathLength={100}
              className="ekg-underline"
              stroke="url(#hero-ekg-gradient)"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <defs>
              <linearGradient id="hero-ekg-gradient" x1="0" y1="0" x2="220" y2="0" gradientUnits="userSpaceOnUse">
                <stop stopColor="#d946ef" />
                <stop offset="1" stopColor="#8b2fe8" />
              </linearGradient>
            </defs>
          </svg>
        </span>
      </motion.h1>

      {/* Sub-copy */}
      <motion.p
        {...fadeUp(0.17)}
        className="mt-8 max-w-md text-[16.5px] leading-relaxed text-white/60"
      >
        One live view of stock, demand and delivery — so care never waits on
        medicine.
      </motion.p>

      {/* Vitals strip — all of it true */}
      <motion.div
        {...fadeUp(0.25)}
        className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-2.5 font-mono text-[11.5px] uppercase tracking-[0.16em] text-white/45"
      >
        <span className="inline-flex items-center gap-2 text-emerald-300/90">
          <span className="relative flex h-1.5 w-1.5">
            <span
              aria-hidden="true"
              className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"
            />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          Live
        </span>
        <span className="text-white/70">72 BPM · Ambient</span>
        <span aria-hidden="true" className="h-3 w-px bg-white/15" />
        <span className="tabular-nums" suppressHydrationWarning>
          {time ?? "--:--:--"} UTC
        </span>
      </motion.div>

      {/* Desktop app downloads — Mac & Windows */}
      <DownloadButtons className="mt-8" />

      {/* Feature ticks */}
      <motion.ul
        {...fadeUp(0.33)}
        className="mt-10 grid max-w-xl grid-cols-1 gap-x-8 gap-y-4 border-t border-white/10 pt-7 sm:grid-cols-3"
      >
        {FEATURES.map(({ icon: Icon, title, desc }) => (
          <li key={title} className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-fuchsia-300">
              <Icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-white/85">{title}</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-white/40">{desc}</span>
            </span>
          </li>
        ))}
      </motion.ul>
    </div>
  );
}
