import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PulseMark } from "@/components/login/pulse-logo";
import { PulseBackground } from "@/components/login/pulse-background";
import { RELEASES_URL } from "@/components/login/download-buttons";

/**
 * Shared page chrome for the marketing landing (/) and sign-in screen
 * (/login). The site footer is rendered on the landing page only.
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

/** Site footer — multi-column, shared by the landing and sign-in screens. */
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="relative z-10 mt-20 border-t border-white/8">
      <div className="mx-auto w-full max-w-[1400px] px-5 py-12 sm:px-8 lg:px-12">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-3">
          {/* brand column */}
          <div className="col-span-2 md:col-span-1">
            <Link
              href="/"
              aria-label="Pulse — home"
              className="inline-flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400"
            >
              <PulseMark className="h-8 w-8" glow={false} />
              <span className="text-brand-gradient text-xl font-bold tracking-tight">
                Pulse
              </span>
            </Link>
            <p className="mt-4 max-w-[240px] text-[12.5px] leading-relaxed text-white/40">
              Pharmacy intelligence, delivered — stock, sales and teams in one
              live rhythm.
            </p>
            <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium text-white/55">
              <span className="relative flex h-1.5 w-1.5">
                <span
                  aria-hidden="true"
                  className="animate-ping absolute h-full w-full rounded-full bg-emerald-400 opacity-60"
                />
                <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              All systems beating
            </p>
          </div>

          {/* product */}
          <nav aria-label="Product">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">
              Product
            </p>
            <ul className="mt-4 space-y-2.5 text-[13px]">
              <li><a className="footer-link" href="/#demo">Live demo</a></li>
              <li><a className="footer-link" href="/#features">Features</a></li>
              <li><a className="footer-link" href="/#portals">Portals</a></li>
              <li>
                <a
                  className="footer-link"
                  href={RELEASES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Desktop apps
                </a>
              </li>
            </ul>
          </nav>

          {/* access */}
          <nav aria-label="Access">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">
              Access
            </p>
            <ul className="mt-4 space-y-2.5 text-[13px]">
              <li>
                <Link className="footer-link" href="/login?intent=register">
                  Register a pharmacy
                </Link>
              </li>
              <li><Link className="footer-link" href="/login">Sign in</Link></li>
              <li><Link className="footer-link" href="/pharmacy">Pharmacy portal</Link></li>
              <li><Link className="footer-link" href="/dashboard">Pulse console</Link></li>
            </ul>
          </nav>

        </div>

        <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-white/8 pt-6">
          <p className="text-[12px] text-white/35">
            © {year} Duniya Healthcare · Pulse
          </p>
        </div>
      </div>

      <style>{`
        .footer-link {
          color: rgb(255 255 255 / 0.5);
          transition: color 0.2s ease;
          border-radius: 4px;
        }
        .footer-link:hover { color: rgb(255 255 255 / 0.92); }
        .footer-link:focus-visible {
          outline: 2px solid rgb(217 70 239);
          outline-offset: 2px;
        }
      `}</style>
    </footer>
  );
}
