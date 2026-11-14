"use client";

import { motion } from "framer-motion";
import {
  Activity,
  BarChart3,
  Bell,
  Check,
  Eye,
  Fingerprint,
  Home,
  LayoutGrid,
  RefreshCw,
  Settings,
  ShieldCheck,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { AppleLogo, WindowsLogo } from "@/components/login/platform-icons";
import { PulseMark } from "@/components/login/pulse-logo";
import { DESKTOP_DOWNLOADS } from "@/lib/desktop-downloads";
import { trackEvent } from "@/lib/firebase";
import { cn } from "@/lib/utils";

/**
 * DesktopSection — the below-the-fold showcase for the Pulse desktop apps.
 *
 * Everything shown is deliberately honest:
 *  - the mock console mirrors the real dashboard's layout and data;
 *  - the EKG trace runs at the same 72 BPM as the hero background;
 *  - download buttons lead to the project's GitHub Releases, where builds
 *    are published with published SHA-256 checksums.
 */

const reveal = (delay = 0, y = 36) => ({
  initial: { opacity: 0, y, filter: "blur(6px)" },
  whileInView: { opacity: 1, y: 0, filter: "blur(0px)" },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const },
});

/* ------------------------------------------------------------------ */
/* Mock console window                                                 */
/* ------------------------------------------------------------------ */

const MINI_NAV: { icon: LucideIcon; label: string; active?: boolean }[] = [
  { icon: Home, label: "Home", active: true },
  { icon: LayoutGrid, label: "Pharmacies" },
  { icon: Eye, label: "Stock" },
  { icon: BarChart3, label: "Analytics" },
  { icon: Settings, label: "Settings" },
];

const MINI_STATS = [
  { label: "Inventory Value", value: "ZMW 7.44K", tone: "text-white" },
  { label: "Items Sold", value: "0", tone: "text-white" },
  { label: "Low Stock", value: "0", tone: "text-emerald-300" },
];

const MINI_PRODUCTS = [
  { name: "Panadol 500mg", pack: "Strip · 16 tabs", status: "In stock", ok: true },
  { name: "Amoxicillin 250mg", pack: "Bottle · 100 ml", status: "Low", ok: false },
];

function MockWindow() {
  return (
    <div className="group relative [perspective:1400px]">
      {/* glow bed */}
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 -z-10 h-[70%] w-[86%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-600/25 blur-[110px] transition-opacity duration-700 group-hover:opacity-100"
      />
      <motion.div
        {...reveal(0.1, 48)}
        className="relative origin-top transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] max-lg:[transform:none] lg:[transform:rotateX(14deg)] lg:group-hover:[transform:rotateX(4deg)]"
      >
        {/* window */}
        <div className="overflow-hidden rounded-2xl bg-[#0c0616]/95 shadow-[0_60px_140px_-40px_rgba(139,47,232,0.6),0_24px_60px_-24px_rgba(0,0,0,0.7)] ring-1 ring-white/12 backdrop-blur-md">
          {/* chrome */}
          <div className="relative flex h-11 items-center gap-2 border-b border-white/8 bg-white/[0.03] px-4">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" aria-hidden="true" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e]" aria-hidden="true" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" aria-hidden="true" />
            <span className="absolute left-1/2 -translate-x-1/2 font-mono text-[11px] tracking-wide text-white/40">
              Pulse — Pharmacy Console
            </span>
            <Bell className="ml-auto h-3.5 w-3.5 text-white/30" aria-hidden="true" />
          </div>

          {/* body */}
          <div className="grid sm:grid-cols-[168px_1fr]">
            {/* mini sidebar */}
            <div className="hidden flex-col gap-1 border-r border-white/8 bg-white/[0.02] p-3 sm:flex">
              <span className="mb-2 inline-flex items-center gap-2 px-1">
                <PulseMark className="h-5 w-5" glow={false} />
                <span className="text-[13px] font-bold text-white/90">Pulse</span>
              </span>
              {MINI_NAV.map(({ icon: Icon, label, active }) => (
                <span
                  key={label}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[11.5px] font-medium",
                    active
                      ? "bg-purple-500/20 text-purple-200"
                      : "text-white/40"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {label}
                </span>
              ))}
              <span className="mt-auto rounded-lg border border-white/8 bg-white/[0.03] p-2.5">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
                  Sync
                </span>
                <span className="mt-1 flex items-center gap-1.5 text-[11px] text-emerald-300/90">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  </span>
                  Live · just now
                </span>
              </span>
            </div>

            {/* mini main pane */}
            <div className="p-4 sm:p-5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[14px] font-semibold text-white/90">Good evening, Chungu</p>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
                  Chingola · ZM
                </p>
              </div>

              {/* stat tiles */}
              <div className="mt-3.5 grid grid-cols-3 gap-2.5">
                {MINI_STATS.map(({ label, value, tone }) => (
                  <div
                    key={label}
                    className="rounded-xl border border-white/8 bg-white/[0.04] px-3 py-2.5"
                  >
                    <p className={cn("text-[15px] font-bold leading-none tracking-tight", tone)}>
                      {value}
                    </p>
                    <p className="mt-1.5 truncate text-[10px] text-white/40">{label}</p>
                  </div>
                ))}
              </div>

              {/* vitals panel with live EKG */}
              <div className="mt-2.5 overflow-hidden rounded-xl border border-white/8 bg-white/[0.04]">
                <div className="flex items-center justify-between px-3.5 pt-2.5">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
                    Movement Pulse
                  </span>
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-white/35">
                    72 BPM
                  </span>
                </div>
                <svg
                  viewBox="0 0 320 56"
                  fill="none"
                  preserveAspectRatio="none"
                  className="mt-1 h-12 w-full"
                  aria-hidden="true"
                >
                  <path
                    d="M0 34 H48 L60 34 68 34 74 12 82 50 90 26 96 34 H150 L162 34 170 34 176 10 184 52 192 24 198 34 H252 L264 34 272 34 278 13 286 49 294 27 300 34 H320"
                    pathLength={100}
                    className="ekg-underline"
                    stroke="url(#window-ekg)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <defs>
                    <linearGradient id="window-ekg" x1="0" y1="0" x2="320" y2="0" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#d946ef" />
                      <stop offset="1" stopColor="#8b2fe8" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>

              {/* product rows */}
              <div className="mt-2.5 flex flex-col gap-1.5">
                {MINI_PRODUCTS.map(({ name, pack, status, ok }) => (
                  <div
                    key={name}
                    className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.04] px-3.5 py-2.5"
                  >
                    <Activity
                      className={cn("h-3.5 w-3.5 shrink-0", ok ? "text-emerald-400" : "text-amber-400")}
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-semibold text-white/85">{name}</span>
                      <span className="block truncate text-[10px] text-white/40">{pack}</span>
                    </span>
                    <span
                      className={cn(
                        "ml-auto rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide",
                        ok
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-amber-500/15 text-amber-300"
                      )}
                    >
                      {status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* floor reflection */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-10 -bottom-10 h-16 rounded-full bg-purple-500/20 blur-2xl"
        />
      </motion.div>

      {/* floating glass chips */}
      <motion.span
        {...reveal(0.5)}
        className="animate-float absolute -left-5 top-16 hidden rounded-xl border border-white/12 bg-white/[0.07] px-3.5 py-2 font-mono text-[10.5px] tracking-wide text-white/70 shadow-lg backdrop-blur-md md:block lg:-left-14"
      >
        ⌘K · Command palette
      </motion.span>
      <motion.span
        {...reveal(0.65)}
        className="animate-float-delayed absolute -right-5 bottom-20 hidden rounded-xl border border-white/12 bg-white/[0.07] px-3.5 py-2 font-mono text-[10.5px] tracking-wide text-white/70 shadow-lg backdrop-blur-md md:block lg:-right-12"
      >
        ⇧⌘V · Stock vitals
      </motion.span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Platform cards                                                      */
/* ------------------------------------------------------------------ */

type Platform = {
  id: "macos" | "windows";
  name: string;
  tagline: string;
  chip: string;
  requirements: string;
  bullets: string[];
  Icon: (props: { className?: string }) => React.ReactElement;
  primary: boolean;
};

const PLATFORMS: Platform[] = [
  {
    id: "macos",
    name: "Pulse for Mac",
    tagline: "Native macOS, tuned for the pharmacy floor.",
    chip: "v1.0 · Universal",
    requirements: "macOS 13+ · Apple silicon & Intel",
    bullets: ["Touch ID unlock", "Native delivery alerts", "Menu-bar vitals at a glance"],
    Icon: AppleLogo,
    primary: true,
  },
  {
    id: "windows",
    name: "Pulse for Windows",
    tagline: "Built for back-office counters and depot PCs.",
    chip: "v1.0 · x64 + ARM64",
    requirements: "Windows 10 (1809+) or newer",
    bullets: ["Windows Hello sign-in", "Toast notifications", "Jump-list quick actions"],
    Icon: WindowsLogo,
    primary: false,
  },
];

function PlatformCard({ platform }: { platform: Platform }) {
  const { id, name, tagline, chip, requirements, bullets, Icon, primary } = platform;
  return (
    <motion.article
      {...reveal(0.15)}
      className="relative flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/[0.045] p-7 backdrop-blur-sm transition-colors duration-300 hover:border-white/20 hover:bg-white/[0.06]"
    >
      {/* corner glow */}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full blur-3xl",
          primary ? "bg-fuchsia-500/15" : "bg-purple-500/15"
        )}
      />
      <div className="flex items-center gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.07] text-white">
          <Icon className="h-6 w-6" />
        </span>
        <div>
          <h3 className="text-[17px] font-semibold tracking-tight text-white">{name}</h3>
          <p className="mt-0.5 text-[12.5px] text-white/45">{tagline}</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em]">
        <span className="rounded-full border border-purple-400/30 bg-purple-500/10 px-2.5 py-1 text-purple-200">
          {chip}
        </span>
        <span className="text-white/35">{requirements}</span>
      </div>

      <ul className="mt-5 flex flex-col gap-2.5">
        {bullets.map((b) => (
          <li key={b} className="flex items-center gap-2.5 text-[13.5px] text-white/70">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
              <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
            </span>
            {b}
          </li>
        ))}
      </ul>

      <a
        href={DESKTOP_DOWNLOADS[id]}
        onClick={() => void trackEvent("download_click", { location: "desktop_section", platform: id })}
        className={cn(
          "mt-7 inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-xl text-[14.5px] font-semibold transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400",
          primary
            ? "bg-white text-slate-900 shadow-[0_16px_40px_-14px_rgba(255,255,255,0.4)] hover:-translate-y-0.5 hover:bg-white/90"
            : "btn-brand text-white shadow-[0_16px_40px_-14px_rgba(168,85,247,0.75)] hover:-translate-y-0.5 hover:shadow-[0_20px_46px_-14px_rgba(168,85,247,0.9)]"
        )}
      >
        <Icon className="h-[18px] w-[18px]" />
        Download for {id === "macos" ? "macOS" : "Windows"}
      </a>
    </motion.article>
  );
}

/* ------------------------------------------------------------------ */
/* Section                                                             */
/* ------------------------------------------------------------------ */

const TRUST: { icon: LucideIcon; label: string }[] = [
  { icon: ShieldCheck, label: "Signed & notarized builds" },
  { icon: RefreshCw, label: "Silent auto-updates" },
  { icon: WifiOff, label: "Offline-first, syncs on return" },
  { icon: Fingerprint, label: "Biometric unlock" },
];

export function DesktopSection({ className }: { className?: string }) {
  return (
    <section
      id="desktop"
      aria-labelledby="desktop-heading"
      className={cn("relative mt-20 border-t border-white/8 pt-16 sm:mt-28 sm:pt-20", className)}
    >
      {/* top beam */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-px mx-auto h-px w-2/3 bg-gradient-to-r from-transparent via-fuchsia-400/50 to-transparent"
      />

      {/* header */}
      <motion.div {...reveal(0)} className="mx-auto max-w-2xl text-center">
        <p className="inline-flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.24em] text-white/45">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          Pulse for Desktop
        </p>
        <h2
          id="desktop-heading"
          className="mt-5 text-[clamp(2rem,4vw,3.2rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-white"
        >
          The whole console,{" "}
          <span className="text-brand-gradient animate-gradient">off the browser.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-[15.5px] leading-relaxed text-white/55">
          Pulse for Mac and Windows keeps your pharmacy&rsquo;s heartbeat in the
          dock — native alerts, offline-first stock views and biometric unlock,
          wrapped in the same dark-room interface you already know.
        </p>
      </motion.div>

      {/* mock window */}
      <div className="mx-auto mt-14 max-w-4xl px-2 sm:px-6">
        <MockWindow />
      </div>

      {/* platform cards */}
      <div className="mx-auto mt-16 grid max-w-4xl grid-cols-1 gap-6 px-2 sm:px-6 md:grid-cols-2">
        {PLATFORMS.map((platform) => (
          <PlatformCard key={platform.id} platform={platform} />
        ))}
      </div>

      {/* checksums note — sits on the live EKG backdrop, so it carries the
          same contrast + dark halo as the hero's release line */}
      <motion.p
        {...reveal(0.1)}
        className="mx-auto mt-5 max-w-4xl px-2 text-center font-mono text-[10.5px] uppercase tracking-[0.16em] text-white/60 [text-shadow:0_0_2px_rgba(5,2,10,0.95),0_1px_14px_rgba(5,2,10,0.95)] sm:px-6"
      >
        SHA-256 checksums published with every release
      </motion.p>

      {/* trust row */}
      <motion.ul
        {...reveal(0.15)}
        className="mx-auto mt-10 flex max-w-4xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-2 sm:px-6"
      >
        {TRUST.map(({ icon: Icon, label }) => (
          <li
            key={label}
            className="inline-flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-white/40"
          >
            <Icon className="h-3.5 w-3.5 text-purple-300/80" aria-hidden="true" />
            {label}
          </li>
        ))}
      </motion.ul>

      {/* tie back to the browser console */}
      <motion.p
        {...reveal(0.2)}
        className="mx-auto mt-12 max-w-xl px-2 text-center text-[13.5px] text-white/40 sm:px-6"
      >
        Prefer the browser?{" "}
        <a
          href="#top"
          className="rounded font-medium text-fuchsia-300 underline-offset-4 transition-colors hover:text-fuchsia-200 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400"
        >
          The console above
        </a>{" "}
        runs anywhere — no install required.
      </motion.p>
    </section>
  );
}
