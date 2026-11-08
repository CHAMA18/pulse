import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PulseMark } from "@/components/login/pulse-logo";
import { PulseBackground } from "@/components/login/pulse-background";
import { RELEASES_URL } from "@/components/login/download-buttons";

/**
 * Shared page chrome for the marketing landing (/) and the dedicated
 * sign-in screen (/login): the aurora/canvas/grain atmosphere and the
 * site footer live here so both routes stay pixel-identical.
 */

/** Fixed, pointer-transparent backdrop — aurora fields, starfield, grain. */
export function PulseAtmosphere() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="aurora-blob aurora-a" />
      <div className="aurora-blob aurora-b" />
      <div className="aurora-blob aurora-c" />
      <PulseBackground className="absolute inset-0 h-full w-full" />
      <div className="pulse-grain absolute inset-0 opacity-[0.05]" />
      <div className="absolute inset-0 bg-[radial-gradient(1100px_700px_at_30%_40%,transparent_0%,rgba(5,2,10,0.42)_72%,rgba(5,2,10,0.66)_100%)]" />
    </div>
  );
}

/** Compact brand row — links home. Pass `className="lg:hidden"` on pages
 *  where the hero already carries the brand lockup at desktop widths. */
export function BrandHeader({
  right,
  className = "",
}: {
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={`relative z-10 flex items-center justify-between ${className}`}>
      <Link
        href="/"
        aria-label="Pulse — back to home"
        className="inline-flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400"
      >
        <PulseMark className="h-8 w-8" glow={false} />
        <span className="text-brand-gradient text-xl font-bold tracking-tight">Pulse</span>
      </Link>
      {right ?? (
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
          Pharmacy intelligence
        </span>
      )}
    </header>
  );
}

/** "Back to home" ghost link for the dedicated sign-in screen. */
export function BackHomeLink({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`inline-flex items-center gap-1.5 rounded-md text-[12.5px] font-medium text-white/55 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400 ${className}`}
    >
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
      Back to home
    </Link>
  );
}

/** Site footer — sticks to the bottom on short pages. */
export function SiteFooter() {
  return (
    <footer className="relative z-10 mt-16 border-t border-white/8 py-7">
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 sm:px-8 lg:px-12">
        <p className="text-[12px] text-white/35">
          © {new Date().getFullYear()} Duniya Healthcare · Pulse
        </p>
        <nav aria-label="Downloads" className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded text-[12px] font-medium text-white/50 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400"
          >
            Download for Mac
          </a>
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded text-[12px] font-medium text-white/50 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400"
          >
            Download for Windows
          </a>
        </nav>
        <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-white/30">
          Privacy-first · Secured sessions
        </p>
      </div>
    </footer>
  );
}
