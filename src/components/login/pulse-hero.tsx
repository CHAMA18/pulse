"use client";

import { motion } from "framer-motion";
import { Activity, ShieldCheck, Truck, type LucideIcon } from "lucide-react";
import { DownloadButtons } from "@/components/login/download-buttons";

/** PulseHero — the editorial half of the landing composition. */

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 26, filter: "blur(6px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const },
});

const FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: Activity, title: "Live vitals", desc: "Stock & demand in real time" },
  { icon: Truck, title: "Delivery tracking", desc: "Every shipment, end to end" },
  { icon: ShieldCheck, title: "Verified access", desc: "Dual portals, secured sessions" },
];

export function PulseHero({ className }: { className?: string }) {
  return (
    <div className={className}>
      {/* Headline */}
      <motion.h1
        {...fadeUp(0.09)}
        className="mt-0 text-[clamp(2.7rem,4.6vw,4.4rem)] font-semibold leading-[1.03] tracking-[-0.035em] text-white"
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
