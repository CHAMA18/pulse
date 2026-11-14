"use client";

import Link from "next/link";
import { useEffect, useState, type MouseEvent } from "react";
import { Menu, X } from "lucide-react";
import { PulseMark } from "@/components/login/pulse-logo";
import { cn } from "@/lib/utils";

/**
 * SiteNav — the landing page's sticky glass navigation.
 *
 * Transparent over the hero, then condenses into a frosted bar the moment
 * the visitor scrolls. Anchor links glide to each section; Register and
 * Sign in hand over to the dedicated auth screen.
 */

const LINKS = [
  { href: "#demo", label: "Demo" },
  { href: "#features", label: "Features" },
  { href: "#portals", label: "Portals" },
  { href: "#desktop", label: "Desktop" },
];

/**
 * Auth is a handoff to a different app surface, so it deliberately performs a
 * full document navigation. The rendered href already includes the deployment
 * base path; using it directly bypasses a stale client router or service worker
 * shell that can otherwise leave a returning visitor on the landing page.
 * Modifier clicks keep their native new-tab behaviour.
 */
function hardNavigate(event: MouseEvent<HTMLAnchorElement>) {
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  event.preventDefault();
  window.location.assign(event.currentTarget.href);
}

export function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 18);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,box-shadow,backdrop-filter] duration-300",
        scrolled || open
          ? "border-b border-white/10 bg-[#0a0514]/80 shadow-[0_10px_40px_-18px_rgba(168,85,247,0.35)] backdrop-blur-xl"
          : "border-b border-transparent bg-transparent"
      )}
    >
      <nav
        aria-label="Primary"
        className="mx-auto flex h-16 w-full max-w-[1400px] items-center justify-between gap-4 px-5 sm:px-8 lg:px-12"
      >
        {/* brand */}
        <Link
          href="/"
          aria-label="Pulse — home"
          className="group inline-flex shrink-0 items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400"
        >
          <span className="relative inline-flex">
            <span
              aria-hidden="true"
              className="animate-beat-ring absolute inset-0 rounded-full bg-fuchsia-500/25 blur-md"
            />
            <PulseMark className="animate-beat-thump relative h-8 w-8" glow={false} />
          </span>
          <span className="text-brand-gradient text-[22px] font-bold leading-none tracking-tight">
            Pulse
          </span>
          <span
            aria-hidden="true"
            className="ml-1 hidden h-4 w-px bg-white/15 sm:block"
          />
          <span className="hidden text-[10px] font-semibold uppercase tracking-[0.24em] text-white/40 sm:block">
            Duniya Healthcare
          </span>
        </Link>

        {/* center links */}
        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map(({ href, label }) => (
            <a
              key={href}
              href={href}
              className="rounded-md px-3.5 py-2 text-[13.5px] font-medium text-white/60 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400"
            >
              {label}
            </a>
          ))}
        </div>

        {/* actions */}
        <div className="relative z-10 flex items-center gap-2.5">
          <Link
            href="/login"
            onClick={hardNavigate}
            className="hidden h-9 items-center rounded-full border border-white/12 bg-white/5 px-4 text-[13px] font-semibold text-white/85 transition-colors hover:border-white/25 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400 sm:inline-flex"
          >
            Sign in
          </Link>
          <Link
            href="/login?intent=register"
            onClick={hardNavigate}
            className="btn-brand inline-flex h-9 items-center rounded-full px-4 text-[13px] font-semibold text-white shadow-[0_10px_28px_-10px_rgba(168,85,247,0.7)] transition-shadow hover:shadow-[0_14px_36px_-10px_rgba(168,85,247,0.85)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400"
          >
            Register
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-white/5 text-white/80 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400 md:hidden"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </nav>

      {/* mobile sheet */}
      {open ? (
        <div className="border-t border-white/10 bg-[#0a0514]/95 px-5 pb-5 pt-2 backdrop-blur-xl md:hidden">
          {LINKS.map(({ href, label }) => (
            <a
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-3 text-[15px] font-medium text-white/75 transition-colors hover:bg-white/5 hover:text-white"
            >
              {label}
            </a>
          ))}
          <Link
            href="/login"
            onClick={(event) => {
              setOpen(false);
              hardNavigate(event);
            }}
            className="mt-2 block rounded-lg px-3 py-3 text-[15px] font-medium text-white/75 transition-colors hover:bg-white/5 hover:text-white"
          >
            Sign in
          </Link>
        </div>
      ) : null}
    </header>
  );
}
