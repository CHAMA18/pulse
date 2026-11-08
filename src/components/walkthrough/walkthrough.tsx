"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Compass, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Walkthrough engine — a spotlight tour of the console                */
/* ------------------------------------------------------------------ */
/* The tour dims the whole console and cuts a single bright window     */
/* around the section a step talks about ("only highlight the          */
/* relevant section"). Steps may navigate between pages before         */
/* anchoring; the host wires `onNavigate` to its own page switcher.    */

export type WalkthroughStep = {
  /** Stable step id. */
  id: string;
  title: string;
  body: string;
  /** `[data-tour]` attribute of the element to spotlight. */
  target?: string;
  /** Page the host should switch to before looking for the target. */
  page?: string;
};

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 8; // breathing room around the spotlighted element
const CARD_W = 348;
const VIEW_MARGIN = 16;

function measure(el: HTMLElement): Rect {
  const rect = el.getBoundingClientRect();
  return {
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  };
}

export function WalkthroughTour({
  steps,
  onNavigate,
  onFinish,
  portalLabel,
}: {
  steps: WalkthroughStep[];
  /** Switch the console to the step's page (skip when undefined). */
  onNavigate?: (page: string) => void;
  onFinish: () => void;
  /** e.g. "Pharmacy portal" — shown in the step counter. */
  portalLabel: string;
}) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [trackedStep, setTrackedStep] = useState<string | null>(null);
  const frame = useRef<number | null>(null);
  const timer = useRef<number | null>(null);

  const step = steps[index];
  const last = index === steps.length - 1;
  // Anchor-free steps (welcome / finish) always render a centered card.
  const anchorless = !step?.target;

  // Reset the spotlight state when the step changes — during render, per the
  // React-documented alternative to a reset effect.
  const stepId = step?.id ?? null;
  if (stepId !== trackedStep) {
    setTrackedStep(stepId);
    setRect(null);
    setTimedOut(false);
  }

  const stop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (timer.current !== null) window.clearTimeout(timer.current);
    frame.current = null;
    timer.current = null;
  }, []);

  // Resolve the step: navigate, wait for the anchor to mount, then keep a
  // per-frame measurement so the spotlight tracks scrolls and layout shifts.
  useEffect(() => {
    stop();

    if (step?.page) onNavigate?.(step.page);

    if (!step?.target) return;

    const startedAt = Date.now();
    const look = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        const tick = () => {
          setRect(measure(el));
          frame.current = requestAnimationFrame(tick);
        };
        tick();
        return;
      }
      if (Date.now() - startedAt < 4000) {
        timer.current = window.setTimeout(look, 90);
      } else {
        setTimedOut(true); // fallback: centered card, dim everything
      }
    };
    look();

    return stop;
  }, [step, onNavigate, stop]);

  useEffect(() => stop, [stop]);

  const go = (next: number) => {
    if (next < 0) return;
    if (next >= steps.length) {
      onFinish();
      return;
    }
    setIndex(next);
  };

  // Keyboard: arrows to move, Esc to leave.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onFinish();
      if (event.key === "ArrowRight" || event.key === "Enter") go(index + 1);
      if (event.key === "ArrowLeft") go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, steps.length, onFinish]);

  if (!step) return null;

  const centered = !rect;
  // Tall targets (e.g. a full-height sidebar) read best with the card
  // placed beside the spotlight; everything else sits above or below.
  const tallTarget = rect ? rect.height > 380 : false;
  const spaceRight = rect ? window.innerWidth - (rect.left + rect.width) > CARD_W + 32 : false;
  const beside = tallTarget && spaceRight;
  const cardBelow = rect ? rect.top + rect.height + 16 + 210 < window.innerHeight : true;

  const cardStyle: React.CSSProperties = centered
    ? {
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: `min(${CARD_W}px, calc(100vw - ${VIEW_MARGIN * 2}px))`,
      }
    : beside
      ? {
          left: Math.min(
            rect.left + rect.width + 20,
            window.innerWidth - CARD_W - VIEW_MARGIN
          ),
          top: Math.max(
            VIEW_MARGIN,
            Math.min(
              rect.top + rect.height / 2 - 130,
              window.innerHeight - 330
            )
          ),
          width: `min(${CARD_W}px, calc(100vw - ${VIEW_MARGIN * 2}px))`,
        }
      : {
          left: Math.max(
            VIEW_MARGIN,
            Math.min(rect.left + rect.width / 2 - CARD_W / 2, window.innerWidth - CARD_W - VIEW_MARGIN)
          ),
          top: cardBelow ? rect.top + rect.height + 14 : undefined,
          bottom: cardBelow ? undefined : window.innerHeight - rect.top + 14,
          width: `min(${CARD_W}px, calc(100vw - ${VIEW_MARGIN * 2}px))`,
        };

  const progress = ((index + 1) / steps.length) * 100;

  return (
    <>
      {/* Dim everything except the spotlighted section. The cutout is a
          rounded window whose colossal box-shadow paints the dim world
          around it — clicks land on the dim layer, never the page. */}
      <div
        className="fixed inset-0 z-[95] cursor-pointer"
        onClick={() => go(index + 1)}
        aria-hidden="true"
      >
        {rect && (
          <div
            className="absolute rounded-2xl ring-2 ring-purple-400/90 transition-all duration-200 ease-out"
            style={{
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
              boxShadow: "0 0 0 200vmax rgba(6, 2, 16, 0.68)",
            }}
          >
            {/* animated halo — the section breathes while it is spoken about */}
            <div className="pointer-events-none absolute -inset-[3px] animate-ping rounded-2xl bg-purple-400/20" />
          </div>
        )}
        {!rect && (anchorless || timedOut) && (
          <div className="absolute inset-0" style={{ background: "rgba(6, 2, 16, 0.68)" }} />
        )}
      </div>

      {/* Step card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step.id}
          role="dialog"
          aria-modal="true"
          aria-label={`Walkthrough step ${index + 1} of ${steps.length}: ${step.title}`}
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          className="fixed z-[96] rounded-2xl border border-purple-100/60 bg-white p-5 shadow-[0_24px_60px_-16px_rgba(76,29,149,0.55)] dark:border-white/10 dark:bg-[#150b2b]"
          style={cardStyle}
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-purple-600 to-fuchsia-600 text-white">
              <Compass className="h-4 w-4" aria-hidden="true" />
            </span>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-purple-600 dark:text-purple-300">
              Step {index + 1} of {steps.length} · {portalLabel}
            </p>
            <button
              type="button"
              onClick={onFinish}
              aria-label="Skip walkthrough"
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/10"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <h3 className="mt-3 text-[17px] font-bold leading-snug tracking-tight text-slate-900 dark:text-white">
            {step.title}
          </h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
            {step.body}
          </p>

          {/* progress */}
          <div className="mt-4 h-1 overflow-hidden rounded-full bg-purple-100 dark:bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-purple-600 to-fuchsia-500 transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => go(index - 1)}
              disabled={index === 0}
              className={cn(
                "inline-flex h-9 items-center gap-1 rounded-md px-3 text-[13px] font-semibold text-slate-600 transition-colors dark:text-slate-300",
                index === 0
                  ? "cursor-not-allowed opacity-40"
                  : "hover:bg-slate-100 dark:hover:bg-white/10"
              )}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </button>
            <span className="ml-auto flex items-center gap-1" aria-hidden="true">
              {steps.map((entry, dot) => (
                <span
                  key={entry.id}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-200",
                    dot === index
                      ? "w-4 bg-purple-600 dark:bg-purple-400"
                      : "w-1.5 bg-slate-200 dark:bg-white/20"
                  )}
                />
              ))}
            </span>
            <button
              type="button"
              onClick={() => go(index + 1)}
              className={cn(
                "inline-flex h-9 items-center gap-1 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-3.5 text-[13px] font-semibold text-white",
                "shadow-[0_8px_20px_-8px_rgba(147,51,234,0.7)] transition-shadow hover:shadow-[0_12px_26px_-8px_rgba(147,51,234,0.85)]"
              )}
            >
              {last ? "Finish tour" : "Next"}
              {!last && <ChevronRight className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    </>
  );
}
