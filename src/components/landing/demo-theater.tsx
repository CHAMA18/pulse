"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
/* ReactNode is used by Shell's children slot below. */
import {
  Check,
  Mail,
  Pause,
  Play,
  Repeat,
  ArrowDownLeft,
  ArrowUpRight,
  ScanLine,
  Users,
  ShoppingCart,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Clock helpers — every pixel on this stage is a pure function of t.  */
/* That is what makes the demo scrubbable, pausable and deterministic: */
/* it is not a video, it is Pulse rendering itself on a timeline.      */
/* ------------------------------------------------------------------ */

const DURATION = 18; // three chapters × 6 s
const CHAPTER = 6;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Progress of `t` through the window [start, start+dur], clamped 0→1. */
const seg = (t: number, start: number, dur: number) => clamp01((t - start) / dur);
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x: number) =>
  x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
const lerp = (a: number, b: number, x: number) => a + (b - a) * x;

/** Piecewise-linear cursor track: [[time, x%, y%], …] → position at t. */
function track(points: [number, number, number][], t: number) {
  if (t <= points[0][0]) return { x: points[0][1], y: points[0][2] };
  for (let i = 0; i < points.length - 1; i++) {
    const [t0, x0, y0] = points[i];
    const [t1, x1, y1] = points[i + 1];
    if (t >= t0 && t <= t1) {
      const x = easeInOut(clamp01((t - t0) / Math.max(0.0001, t1 - t0)));
      return { x: lerp(x0, x1, x), y: lerp(y0, y1, x) };
    }
  }
  return {
    x: points[points.length - 1][1],
    y: points[points.length - 1][2],
  };
}

/** Enter/slide+fade style for an element appearing at [at, at+0.45]. */
function enter(t: number, at: number, dy = 14, dur = 0.45): CSSProperties {
  const x = easeOut(seg(t, at, dur));
  return { opacity: x, transform: `translateY(${(1 - x) * dy}px)` };
}

/* ------------------------------------------------------------------ */
/* Shared mini-shell                                                   */
/* ------------------------------------------------------------------ */

const SHELF_NAV: { id: string; label: string; Icon: typeof ShoppingCart }[] = [
  { id: "pos", label: "Point of Sale", Icon: ShoppingCart },
  { id: "movement", label: "Stock Movement", Icon: ScanLine },
  { id: "team", label: "User Management", Icon: Users },
];

/** The little pharmacy shell that hosts every chapter — sidebar + topbar. */
function Shell({
  active,
  children,
}: {
  active: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0">
      {/* mini sidebar */}
      <div className="hidden w-[26%] max-w-[168px] shrink-0 flex-col gap-1 border-r border-white/8 bg-[#0d0716]/80 p-3 sm:flex">
        <div className="mb-3 flex items-center gap-2 px-1">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-purple-700 text-[9px] font-bold text-white">
            C
          </span>
          <div className="min-w-0">
            <p className="truncate text-[10px] font-semibold text-white/85">
              Chungu Chemist
            </p>
            <p className="text-[8px] font-medium uppercase tracking-[0.14em] text-white/35">
              Owner
            </p>
          </div>
        </div>
        {SHELF_NAV.map(({ id, label, Icon }) => {
          const on = active === id;
          return (
            <div
              key={id}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2.5 py-2 text-[10.5px] font-medium transition-colors duration-300",
                on
                  ? "bg-purple-500/20 text-white"
                  : "text-white/40"
              )}
            >
              <Icon
                className={cn("h-3.5 w-3.5", on ? "text-fuchsia-300" : "text-white/35")}
                aria-hidden="true"
              />
              {label}
              {on ? (
                <span
                  aria-hidden="true"
                  className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400"
                />
              ) : null}
            </div>
          );
        })}
        <div className="mt-auto space-y-1.5 px-1">
          <div className="h-1.5 w-3/4 rounded-full bg-white/8" />
          <div className="h-1.5 w-1/2 rounded-full bg-white/6" />
        </div>
      </div>

      {/* stage column */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* console topbar */}
        <div className="flex items-center justify-between gap-3 border-b border-white/8 bg-[#0d0716]/60 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="hidden h-1.5 w-1.5 rounded-full bg-emerald-400 sm:block" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">
              {active === "pos"
                ? "Counter — new sale"
                : active === "movement"
                  ? "Stock Movement — ledger"
                  : "Team — invitations"}
            </p>
          </div>
          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
            pulse.zm · live
          </p>
        </div>
        <div className="relative min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chapter 1 — the counter (a sale, start to finish)                   */
/* ------------------------------------------------------------------ */

const TILES = [
  { name: "Coartem 20/60", price: "K 85", stock: 46, sold: 1, x: "8%", y: "26%" },
  { name: "ORS Sachet", price: "K 5", stock: 150, sold: 2, x: "8%", y: "44%" },
  { name: "Paracetamol", price: "K 15", stock: 120, sold: 1, x: "8%", y: "62%" },
];

function PosScene({ t }: { t: number }) {
  // local time inside the chapter
  const τ = t;
  const items = [
    { name: "Coartem 20/60 ×1", amt: 85, at: 0.45 },
    { name: "ORS Sachet ×2", amt: 10, at: 1.25 },
    { name: "Paracetamol ×1", amt: 15, at: 2.05 },
  ];
  const shown = items.filter((i) => τ >= i.at);
  const total = Math.round(
    lerp(0, 110, easeOut(seg(τ, 2.55, 0.7)))
  );
  const paid = seg(τ, 3.5, 0.5);
  const change = seg(τ, 4.1, 0.4);
  const toast = seg(τ, 4.55, 0.4);
  const pressScale = 1 - 0.08 * Math.sin(Math.PI * clamp01(paid));

  // stock ticks as the receipt lines land
  const stockNow = [
    TILES[0].stock - (τ >= 0.45 ? TILES[0].sold : 0),
    TILES[1].stock - (τ >= 1.25 ? TILES[1].sold : 0),
    TILES[2].stock - (τ >= 2.05 ? TILES[2].sold : 0),
  ];

  const cursor = track(
    [
      [0.2, 62, 78],
      [0.6, 30, 30],
      [1.4, 30, 48],
      [2.2, 30, 66],
      [3.3, 72, 86],
      [6, 72, 86],
    ],
    τ
  );

  return (
    <div className="relative flex h-full min-h-0 gap-3 p-3 sm:p-4">
      {/* product tiles */}
      <div className="relative flex w-[46%] min-w-0 flex-col gap-2 sm:w-[42%]">
        {TILES.map((tile, i) => (
          <div
            key={tile.name}
            style={enter(τ, 0.1 + i * 0.06)}
            className="flex items-center justify-between gap-2 rounded-lg border border-white/8 bg-white/[0.04] px-2.5 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-[10.5px] font-semibold text-white/85">
                {tile.name}
              </p>
              <p className="text-[9px] text-white/40">{tile.price}</p>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[8.5px] font-semibold tabular-nums transition-colors",
                stockNow[i] <= 45
                  ? "bg-amber-400/15 text-amber-300"
                  : "bg-emerald-400/12 text-emerald-300"
              )}
            >
              {stockNow[i]}
            </span>
          </div>
        ))}
      </div>

      {/* receipt */}
      <div className="relative flex min-w-0 flex-1 flex-col rounded-lg border border-white/8 bg-[#120a20]/90 p-3">
        <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-white/40">
          Counter 1 — receipt
        </p>
        <div className="mt-2 space-y-1.5">
          {shown.map((item) => (
            <div
              key={item.name}
              style={enter(τ, item.at)}
              className="flex items-center justify-between gap-2 border-b border-dashed border-white/8 pb-1.5"
            >
              <span className="truncate text-[10.5px] text-white/75">{item.name}</span>
              <span className="font-mono text-[10.5px] tabular-nums text-white/60">
                K {item.amt}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-auto space-y-2">
          <div className="flex items-center justify-between border-t border-white/10 pt-2">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/45">
              Total
            </span>
            <span className="font-mono text-[15px] font-bold tabular-nums text-white">
              K {total}
            </span>
          </div>
          <div
            style={{
              transform: `scale(${pressScale})`,
              opacity: 0.55 + 0.45 * clamp01(paid),
            }}
            className="btn-brand flex items-center justify-center gap-1.5 rounded-md py-2 text-[10.5px] font-semibold text-white"
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Cash · K 120
          </div>
          {τ >= 4.1 ? (
            <p
              style={enter(τ, 4.1, 8, 0.35)}
              className="text-center font-mono text-[9.5px] uppercase tracking-[0.14em] text-emerald-300/90"
            >
              Change · K {Math.round(lerp(0, 10, change))}
            </p>
          ) : null}
        </div>
      </div>

      {/* sale toast */}
      {τ >= 4.55 ? (
        <div
          style={{
            opacity: easeOut(toast),
            transform: `translate(-50%, ${(1 - easeOut(toast)) * 16}px)`,
          }}
          className="absolute left-1/2 top-3 z-10 flex items-center gap-2 rounded-full border border-emerald-400/25 bg-[#0c1a12]/95 py-1.5 pl-2 pr-3.5 shadow-[0_14px_34px_-12px_rgba(16,185,129,0.5)] backdrop-blur"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/20">
            <Check className="h-3 w-3 text-emerald-300" aria-hidden="true" />
          </span>
          <span className="whitespace-nowrap text-[10px] font-semibold text-emerald-200">
            Sale complete · 58 s
          </span>
        </div>
      ) : null}

      {/* cursor */}
      <DemoCursor x={cursor.x} y={cursor.y} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chapter 2 — the ledger (every unit accounted for)                   */
/* ------------------------------------------------------------------ */

const MOVES = [
  {
    ref: "MOV-5020",
    name: "Ibuprofen 400mg",
    dir: "in" as const,
    qty: "+24",
    route: "Main store · CarePlus #8817",
    at: 0.35,
    shelf: 814,
  },
  {
    ref: "MOV-5021",
    name: "ORS Sachet",
    dir: "out" as const,
    qty: "−6",
    route: "Makeni Clinic Point",
    at: 1.35,
    shelf: 808,
  },
  {
    ref: "MOV-5022",
    name: "Amoxicillin 250mg",
    dir: "out" as const,
    qty: "−2",
    route: "Damaged — write-off",
    at: 2.35,
    shelf: 806,
  },
];

function LedgerScene({ t }: { t: number }) {
  const τ = t;
  const shown = MOVES.filter((m) => τ >= m.at);
  const shelf = shown.length ? shown[shown.length - 1].shelf : 790;
  const typed = Math.floor(seg(τ, 3.3, 0.8) * "amox".length);
  const query = "amox".slice(0, typed);
  const caretOn = Math.floor(τ * 2.4) % 2 === 0;
  const highlight = seg(τ, 4.25, 0.4);

  const cursor = track(
    [
      [0.15, 70, 70],
      [3.0, 30, 16],
      [4.4, 40, 44],
      [6, 40, 44],
    ],
    τ
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col gap-2.5 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <div
          className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5"
          style={enter(τ, 0.1)}
        >
          <span className="truncate font-mono text-[10px] text-white/60">
            {query}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              "h-3 w-px bg-fuchsia-300 transition-opacity",
              caretOn && τ >= 3.3 ? "opacity-100" : "opacity-0"
            )}
          />
          <span className="ml-auto hidden text-[8.5px] text-white/25 sm:block">
            product, batch, reason…
          </span>
        </div>
        <div
          style={enter(τ, 0.18)}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="whitespace-nowrap font-mono text-[9.5px] font-semibold tabular-nums text-emerald-200">
            {shelf} on hand
          </span>
        </div>
      </div>

      <div
        style={enter(τ, 0.22)}
        className="flex items-center gap-1.5 overflow-hidden"
      >
        {["All", "Receipts", "Issues", "Adjustments"].map((chip, i) => (
          <span
            key={chip}
            className={cn(
              "whitespace-nowrap rounded-full px-2 py-0.5 text-[8.5px] font-semibold",
              (chip === "Adjustments" && τ >= 2.35) || (i === 0 && τ < 2.35)
                ? "bg-purple-600 text-white"
                : "bg-white/5 text-white/45"
            )}
          >
            {chip}
          </span>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-hidden rounded-lg border border-white/8 bg-[#120a20]/90 p-2">
        <div className="flex items-center gap-2 border-b border-white/8 px-1.5 pb-1.5 font-mono text-[8px] uppercase tracking-[0.14em] text-white/30">
          <span className="w-14 shrink-0">Ref</span>
          <span className="min-w-0 flex-1">Product</span>
          <span className="w-10 shrink-0 text-right">Qty</span>
          <span className="hidden w-20 shrink-0 sm:block">Route</span>
        </div>
        {shown.map((m) => (
          <div
            key={m.ref}
            style={enter(τ, m.at, 10)}
            className={cn(
              "flex items-center gap-2 rounded-md px-1.5 py-1.5",
              m.ref === "MOV-5022" && highlight > 0
                ? "bg-purple-500/15 ring-1 ring-purple-400/30"
                : "bg-white/[0.03]"
            )}
          >
            <span className="w-14 shrink-0 font-mono text-[9px] text-white/45">
              {m.ref}
            </span>
            <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-white/80">
              {m.name}
            </span>
            <span
              className={cn(
                "inline-flex w-10 shrink-0 items-center justify-end gap-0.5 font-mono text-[10px] font-bold tabular-nums",
                m.dir === "in" ? "text-emerald-300" : "text-amber-300"
              )}
            >
              {m.dir === "in" ? (
                <ArrowDownLeft className="h-2.5 w-2.5" aria-hidden="true" />
              ) : (
                <ArrowUpRight className="h-2.5 w-2.5" aria-hidden="true" />
              )}
              {m.qty}
            </span>
            <span className="hidden w-20 shrink-0 truncate text-[8.5px] text-white/35 sm:block">
              {m.route}
            </span>
          </div>
        ))}
        {τ >= 4.25 ? (
          <p
            style={enter(τ, 4.25, 6, 0.35)}
            className="px-1.5 pt-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-purple-300/80"
          >
            Quantities change here only — the shelf updated instantly
          </p>
        ) : null}
      </div>

      <DemoCursor x={cursor.x} y={cursor.y} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chapter 3 — the team (a branded invitation, accepted)               */
/* ------------------------------------------------------------------ */

function TeamScene({ t }: { t: number }) {
  const τ = t;
  const accept = seg(τ, 2.25, 0.35);
  const ring = seg(τ, 2.6, 0.7);
  const audit = seg(τ, 3.7, 0.45);
  const pulse = 1 + 0.05 * Math.sin(τ * 5.2);

  const cursor = track(
    [
      [0.2, 74, 60],
      [2.05, 31, 62],
      [2.35, 31, 62],
      [6, 31, 62],
    ],
    τ
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col items-center justify-center gap-3 p-3 sm:p-4">
      {/* branded email card */}
      <div
        style={{
          opacity: easeOut(seg(τ, 0.15, 0.5)),
          transform: `translateY(${(1 - easeOut(seg(τ, 0.15, 0.5))) * -18}px) scale(${
            1 - 0.06 * easeInOut(clamp01(accept))
          })`,
        }}
        className="w-full max-w-[320px] overflow-hidden rounded-xl border border-white/10 bg-[#140b22]/95 shadow-[0_24px_60px_-24px_rgba(147,51,234,0.55)]"
      >
        {/* email brand header */}
        <div className="flex items-center justify-between bg-gradient-to-r from-fuchsia-600 via-purple-600 to-purple-800 px-3.5 py-2.5">
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-white">
            <span aria-hidden="true" className="text-[13px] leading-none">
              ∿
            </span>
            Pulse
          </span>
          <span className="font-mono text-[7.5px] uppercase tracking-[0.18em] text-white/70">
            Pharmacy, in rhythm
          </span>
        </div>
        <div className="space-y-2 p-3.5">
          <p className="font-mono text-[7.5px] uppercase tracking-[0.18em] text-fuchsia-300">
            Team invitation
          </p>
          <p className="text-[12.5px] font-bold leading-snug text-white">
            Join Chungu Chemist Lusaka on Pulse
          </p>
          <p className="text-[9.5px] leading-relaxed text-white/55">
            Chungu Chipimo Chama has invited you as{" "}
            <span className="font-semibold text-white/85">Pharmacist</span> —
            Cairo Road Main Store. Accept below to set your password and step
            in.
          </p>
          <div
            style={{
              transform: `scale(${pulse})`,
              opacity: 0.6 + 0.4 * clamp01(seg(τ, 1.3, 0.5)),
            }}
            className="btn-brand mt-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[10px] font-semibold text-white"
          >
            <Mail className="h-3 w-3" aria-hidden="true" />
            Accept invitation
          </div>
          <p className="text-center font-mono text-[7.5px] uppercase tracking-[0.14em] text-white/30">
            Invitations expire · every accept lands in the audit trail
          </p>
        </div>
        {/* accept ring */}
        {τ >= 2.6 && ring < 1 ? (
          <span
            aria-hidden="true"
            style={{
              opacity: (1 - ring) * 0.8,
              transform: `scale(${0.4 + ring * 1.6})`,
            }}
            className="pointer-events-none absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-fuchsia-400/60"
          />
        ) : null}
      </div>

      {/* team row */}
      <div className="flex w-full max-w-[320px] flex-wrap items-center gap-1.5">
        <span
          style={enter(τ, 0.35)}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[9.5px] font-medium text-white/75"
        >
          Chungu C.
          <span className="rounded-full bg-purple-500/25 px-1.5 py-px font-mono text-[7.5px] uppercase tracking-wide text-purple-200">
            Owner
          </span>
        </span>
        {τ >= 2.95 ? (
          <span
            style={enter(τ, 2.95, 12)}
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[9.5px] font-medium text-emerald-200"
          >
            <Check className="h-2.5 w-2.5" aria-hidden="true" />
            Bupe Mwansa
            <span className="rounded-full bg-emerald-400/20 px-1.5 py-px font-mono text-[7.5px] uppercase tracking-wide text-emerald-200">
              Pharmacist
            </span>
          </span>
        ) : (
          <span
            style={{ opacity: 0.5 + 0.3 * Math.sin(τ * 3) }}
            className="inline-flex items-center rounded-full border border-dashed border-white/15 px-2.5 py-1 font-mono text-[9px] text-white/30"
          >
            awaiting acceptance…
          </span>
        )}
      </div>

      {τ >= 3.7 ? (
        <p
          style={enter(τ, 3.7, 6, 0.4)}
          className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-white/35"
        >
          09:41 · invitation accepted · audit logged
        </p>
      ) : null}

      <DemoCursor x={cursor.x} y={cursor.y} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cursor + theater                                                    */
/* ------------------------------------------------------------------ */

/* prefers-reduced-motion as an external store (the React-documented way). */
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const getReducedMotion = () => window.matchMedia(REDUCED_QUERY).matches;
const getReducedMotionServer = () => false;

function DemoCursor({ x, y }: { x: number; y: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ left: `${x}%`, top: `${y}%` }}
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2"
    >
      <span className="block h-4 w-4 rounded-full border-2 border-fuchsia-300/90 bg-fuchsia-400/20 shadow-[0_0_12px_rgba(217,70,239,0.65)]" />
    </span>
  );
}

const CHAPTERS = [
  { id: "pos", label: "The counter", blurb: "A sale in under two minutes" },
  { id: "movement", label: "The ledger", blurb: "Every unit accounted for" },
  { id: "team", label: "The team", blurb: "Invites, branded and audited" },
];

function ChapterIcon({ chapter, className }: { chapter: number; className?: string }) {
  const Icon = chapter === 0 ? ShoppingCart : chapter === 1 ? ScanLine : Users;
  return <Icon className={className} aria-hidden="true" />;
}

function StaticPoster() {
  return (
    <div className="grid h-full grid-cols-1 gap-2 p-3 sm:grid-cols-3 sm:gap-3 sm:p-4">
      {/* Static, reduced-motion preview: each chapter frozen at its beat. */}
      <div className="min-h-0 rounded-lg border border-white/8 bg-[#120a20]/90">
        <PosScene t={5.2} />
      </div>
      <div className="hidden min-h-0 rounded-lg border border-white/8 bg-[#120a20]/90 sm:block">
        <LedgerScene t={11.2} />
      </div>
      <div className="hidden min-h-0 rounded-lg border border-white/8 bg-[#120a20]/90 sm:block">
        <TeamScene t={16.2} />
      </div>
    </div>
  );
}

export function DemoTheater() {
  // The visitor's motion preference as an external store — hydration-safe
  // (server snapshot: false) and reactive if the preference flips mid-visit.
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotion,
    getReducedMotionServer
  );
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [inView, setInView] = useState(false);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number>(0);
  const frameRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);

  // autoplay only while on screen
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (reduced || !playing || !inView) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    lastRef.current = performance.now();
    let acc = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastRef.current) / 1000);
      lastRef.current = now;
      acc += dt;
      // ~40 fps is plenty for a demo this size — keeps phones cool.
      if (acc >= 0.025) {
        acc = 0;
        setT((prev) => (prev + dt > DURATION ? prev + dt - DURATION : prev + dt));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [reduced, playing, inView]);

  const chapter = Math.min(2, Math.floor(t / CHAPTER));

  // playhead + time label via refs (no re-render needed for these)
  useEffect(() => {
    if (barRef.current) {
      barRef.current.style.transform = `scaleX(${t / DURATION})`;
    }
    if (timeRef.current) {
      const s = Math.floor(t);
      timeRef.current.textContent = `0:${String(s).padStart(2, "0")} / 0:${DURATION}`;
    }
  }, [t]);

  // subtle hyperframe tilt — springs handled by CSS transition
  const onTilt = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--tilt-x", `${(-py * 2.2).toFixed(2)}deg`);
    el.style.setProperty("--tilt-y", `${(px * 2.6).toFixed(2)}deg`);
  };
  const untilt = (e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.setProperty("--tilt-x", "0deg");
    e.currentTarget.style.setProperty("--tilt-y", "0deg");
  };

  const seek = (k: number) => {
    setT(k * CHAPTER + 0.01);
    setPlaying(true);
  };

  const sceneOpacity = (() => {
    const local = t - chapter * CHAPTER;
    const fadeIn = seg(local, 0, 0.35);
    const fadeOut = 1 - seg(local, CHAPTER - 0.42, 0.42);
    return Math.min(fadeIn, fadeOut);
  })();

  return (
    <section id="demo" aria-labelledby="demo-title" className="relative scroll-mt-20 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-[1180px] px-5 sm:px-8 lg:px-12">
        {/* section head */}
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.26em] text-fuchsia-300/80">
            The product, playing
          </p>
          <h2
            id="demo-title"
            className="mt-3 text-[clamp(1.9rem,3.4vw,2.9rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-white"
          >
            No video.{" "}
            <span className="text-brand-gradient">Pulse, rendering itself.</span>
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/55">
            This is not a screen recording — every pixel below is drawn live by
            the same code your pharmacy runs. Press play, or jump to a chapter.
          </p>
        </div>

        {/* hyperframe */}
        <div
          ref={frameRef}
          onMouseMove={reduced ? undefined : onTilt}
          onMouseLeave={reduced ? undefined : untilt}
          className="demo-theater group relative mx-auto mt-10 max-w-[980px] [perspective:1200px]"
        >
          {/* ambient glow */}
          <div
            aria-hidden="true"
            className="absolute -inset-8 -z-10 rounded-[36px] bg-[radial-gradient(60%_60%_at_50%_40%,rgba(147,51,234,0.28),transparent_70%)] blur-2xl transition-opacity duration-500 group-hover:opacity-100"
          />
          <div
            style={{ "--tilt-x": "0deg", "--tilt-y": "0deg" } as CSSProperties}
            className="demo-frame rounded-2xl border border-white/12 bg-[#0d0716]/90 p-1.5 shadow-[0_50px_120px_-40px_rgba(124,45,218,0.55),0_0_0_1px_rgba(255,255,255,0.04)_inset] backdrop-blur-sm sm:p-2"
          >
            {/* browser chrome */}
            <div className="flex items-center gap-3 px-3 py-2">
              <span className="flex gap-1.5" aria-hidden="true">
                <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
              </span>
              <span className="mx-auto hidden items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.04] px-3 py-1 font-mono text-[10px] text-white/45 sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                pulse.zm/pharmacy
              </span>
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-fuchsia-400/30 bg-fuchsia-500/10 px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-fuchsia-300 sm:ml-0">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute h-full w-full rounded-full bg-fuchsia-400 opacity-70" />
                  <span className="relative h-1.5 w-1.5 rounded-full bg-fuchsia-400" />
                </span>
                Live demo
              </span>
            </div>

            {/* screen — square on phones, 16:9 from sm up (a min-height would
                fight the aspect ratio and inflate the box past its parent) */}
            <div className="relative aspect-square min-h-0 overflow-hidden rounded-xl border border-white/8 bg-[#0b0514] sm:aspect-[16/9]">
              {reduced ? (
                <StaticPoster />
              ) : (
                <Shell active={CHAPTERS[chapter].id}>
                  <div
                    className="absolute inset-0"
                    style={{ opacity: sceneOpacity }}
                    key={chapter}
                  >
                    {chapter === 0 ? <PosScene t={t} /> : null}
                    {chapter === 1 ? <LedgerScene t={t - CHAPTER} /> : null}
                    {chapter === 2 ? <TeamScene t={t - 2 * CHAPTER} /> : null}
                  </div>
                </Shell>
              )}
            </div>

            {/* player bar */}
            <div className="flex items-center gap-2.5 px-2.5 py-2.5 sm:gap-3.5 sm:px-3.5">
              <button
                type="button"
                onClick={() => setPlaying((v) => !v)}
                aria-label={playing ? "Pause demo" : "Play demo"}
                disabled={reduced}
                className="btn-brand inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow-[0_10px_24px_-8px_rgba(168,85,247,0.7)] transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400 disabled:opacity-50"
              >
                {playing && !reduced ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="ml-0.5 h-4 w-4" />
                )}
              </button>

              {/* chapter chips */}
              <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
                {CHAPTERS.map((c, k) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => seek(k)}
                    aria-current={chapter === k ? "true" : undefined}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400",
                      chapter === k && !reduced
                        ? "bg-white/12 text-white"
                        : "text-white/40 hover:bg-white/5 hover:text-white/75"
                    )}
                  >
                    <ChapterIcon
                      chapter={k}
                      className={cn(
                        "h-3.5 w-3.5",
                        chapter === k && !reduced ? "text-fuchsia-300" : ""
                      )}
                    />
                    <span className="hidden sm:inline">{c.label}</span>
                    <span className="sm:hidden">{k + 1}</span>
                  </button>
                ))}
              </div>

              {/* progress + time */}
              <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2.5">
                <div
                  className="relative h-1.5 w-24 overflow-hidden rounded-full bg-white/10 sm:w-40"
                  role="progressbar"
                  aria-label="Demo timeline"
                  aria-valuemin={0}
                  aria-valuemax={DURATION}
                  aria-valuenow={Math.round(t)}
                >
                  <div
                    ref={barRef}
                    className="h-full w-full origin-left rounded-full bg-gradient-to-r from-fuchsia-500 to-purple-500"
                    style={{ transform: "scaleX(0)" }}
                  />
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-1/3 w-px bg-white/20"
                  />
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-2/3 w-px bg-white/20"
                  />
                </div>
                <span
                  ref={timeRef}
                  suppressHydrationWarning
                  className="hidden font-mono text-[10px] tabular-nums text-white/40 sm:block"
                >
                  0:00 / 0:{DURATION}
                </span>
                <Repeat
                  className="hidden h-3.5 w-3.5 text-white/30 sm:block"
                  aria-hidden="true"
                />
              </div>
            </div>
          </div>

          {/* chapter caption */}
          <div className="mt-4 flex items-center justify-center gap-2 text-center">
            <ChapterIcon chapter={chapter} className="h-3.5 w-3.5 text-fuchsia-300" />
            <p className="text-[12.5px] font-medium text-white/55">
              <span className="text-white/85">{CHAPTERS[chapter].label}</span>
              <span className="mx-2 text-white/20" aria-hidden="true">
                ·
              </span>
              {CHAPTERS[chapter].blurb}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}


