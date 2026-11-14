"use client";

import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
} from "framer-motion";
import { useRef, useState } from "react";
import { Activity, ShieldCheck, Truck, type LucideIcon } from "lucide-react";
import { DownloadButtons } from "@/components/login/download-buttons";
import { HeroVideo } from "@/components/login/hero-video";
import { cn } from "@/lib/utils";

/**
 * PulseHero — the editorial half of the landing composition.
 *
 * Set on a pane of smoked glass (`.hero-stage`) over the living monitor, so the
 * EKG trace and constellation stay visible through the content rather than
 * being covered by it. The pane carries instrument detailing — a live readout
 * above the headline, a ruler edge, a vertical rail, registration grain — so
 * the hero reads as a vitals display rather than a text block on a background.
 */

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 26, filter: "blur(6px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const },
});

const VITALS: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: Activity, title: "Live vitals", desc: "Stock & demand in real time" },
  { icon: Truck, title: "Delivery tracking", desc: "Every shipment, end to end" },
  { icon: ShieldCheck, title: "Verified access", desc: "Dual portals, secured sessions" },
];

/**
 * The closing word of the headline rolls through these as the hero scrolls
 * upwards. Every line is a complete, natural sentence ending — no generated or
 * scrambled text — and each stays short enough to hold a single line.
 */
const HEADLINE_PHRASES = [
  "delivered.",
  "in one view.",
  "without delay.",
  "end to end.",
  "when it counts.",
] as const;

export function PulseHero({ className }: { className?: string }) {
  const heroRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const [phraseIndex, setPhraseIndex] = useState(0);

  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });

  // The pane travels up the screen as the page scrolls; step the phrase in
  // step with that travel. Reversing the scroll walks the phrases backwards,
  // so the copy always matches where the hero is on its way out.
  useMotionValueEvent(scrollYProgress, "change", (progress) => {
    const next = Math.min(
      HEADLINE_PHRASES.length - 1,
      Math.max(0, Math.floor((progress / 0.7) * (HEADLINE_PHRASES.length - 1)))
    );
    setPhraseIndex((current) => (current === next ? current : next));
  });

  const phrase = HEADLINE_PHRASES[phraseIndex];

  return (
    <div ref={heroRef} className={cn("hero-stage p-5 sm:p-7 lg:p-9", className)}>
      {/* one gradient for every instance of the EKG underline */}
      <svg aria-hidden="true" className="absolute h-0 w-0">
        <defs>
          <linearGradient
            id="hero-ekg-gradient"
            x1="0"
            y1="0"
            x2="220"
            y2="0"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#d946ef" />
            <stop offset="1" stopColor="#8b2fe8" />
          </linearGradient>
        </defs>
      </svg>
      {/* Background film — below the copy and the pane treatment. */}
      <HeroVideo className="absolute inset-0" />
      {/* pane texture — clipped to the glass, never over the copy */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-[30px]"
      >
        <span className="pulse-grain absolute inset-0 opacity-[0.05]" />
      </span>

      {/* ruler edge — measurement ticks on the pane's straight left border */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-1/2 hidden -translate-y-1/2 flex-col gap-3 lg:flex"
      >
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="block h-px w-2.5 bg-white/20" />
        ))}
      </span>

      {/* vertical rail — names the three vitals without spending layout width */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-3.5 top-1/2 hidden -translate-y-1/2 lg:block"
      >
        <span className="block font-mono text-[9px] uppercase tracking-[0.44em] text-white/25 [writing-mode:vertical-rl]">
          Stock · Demand · Delivery
        </span>
      </span>

      {/* Headline — sized to fit the pane without crowding the login card */}
      <motion.h1
        {...fadeUp(0.09)}
        className="relative mt-5 text-[clamp(2rem,3.8vw,3.75rem)] font-semibold leading-[0.98] tracking-[-0.045em] text-white"
      >
        <span className="block">Pharmacy intelligence,</span>
        <span className="relative mt-1 block h-[1.06em]">
          <AnimatePresence initial={false}>
            <motion.span
              key={phrase}
              initial={
                prefersReducedMotion
                  ? { opacity: 0 }
                  : { y: "0.55em", opacity: 0, filter: "blur(10px)" }
              }
              animate={
                prefersReducedMotion
                  ? { opacity: 1 }
                  : { y: "0em", opacity: 1, filter: "blur(0px)" }
              }
              exit={
                prefersReducedMotion
                  ? { opacity: 0 }
                  : { y: "-0.55em", opacity: 0, filter: "blur(10px)" }
              }
              transition={{ duration: prefersReducedMotion ? 0.15 : 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="absolute left-0 top-0 inline-block whitespace-nowrap"
            >
              <span className="text-brand-gradient animate-gradient">{phrase}</span>
              <svg
                aria-hidden="true"
                className="absolute -bottom-3 left-0 h-4 w-full"
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
              </svg>
            </motion.span>
          </AnimatePresence>
        </span>
      </motion.h1>

      {/* Sub-copy */}
      <motion.p
        {...fadeUp(0.17)}
        className="relative mt-7 w-full text-[16.5px] leading-[1.65] text-white/60"
      >
        One live view of stock, demand and delivery — so care never waits on
        medicine.
      </motion.p>

      {/* Desktop app downloads — Mac & Windows */}
      <DownloadButtons className="relative mt-8" />

      {/* Vitals strip — numbered, ruled, no boxes competing with the glass */}
      <motion.ul
        {...fadeUp(0.33)}
        className="relative mt-10 grid grid-cols-1 border-t border-white/10 sm:grid-cols-3 sm:divide-x sm:divide-white/10"
      >
        {VITALS.map(({ icon: Icon, title, desc }, i) => (
          <li
            key={title}
            className="flex items-start gap-3 border-b border-white/8 py-4 last:border-b-0 sm:border-b-0 sm:px-5 sm:py-5 sm:first:pl-0 sm:last:pr-0"
          >
            <span className="mt-0.5 font-mono text-[9.5px] tabular-nums tracking-[0.14em] text-white/35">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-[13px] font-medium tracking-[-0.01em] text-white/90">
                <Icon className="h-3.5 w-3.5 shrink-0 text-fuchsia-300" strokeWidth={2} aria-hidden="true" />
                {title}
              </span>
              <span className="mt-1 block text-[12px] leading-snug text-white/45">{desc}</span>
            </span>
          </li>
        ))}
      </motion.ul>
    </div>
  );
}
