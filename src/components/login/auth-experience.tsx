import Link from "next/link";
import { LoginCard } from "@/components/login/login-card";
import { PulseBackground } from "@/components/login/pulse-background";
import { PulseHero } from "@/components/login/pulse-hero";
import { PulseMark } from "@/components/login/pulse-logo";

export function AuthExperience({
  initialMode,
}: {
  initialMode: "login" | "register";
}) {
  return (
    <main id="auth" className="pulse-space relative flex min-h-svh w-full flex-col overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="aurora-blob aurora-a" />
        <div className="aurora-blob aurora-b" />
        <div className="aurora-blob aurora-c" />
        <PulseBackground className="absolute inset-0 h-full w-full" />
        <div className="pulse-grain absolute inset-0 opacity-[0.05]" />
        <div className="absolute inset-0 bg-[radial-gradient(1100px_700px_at_30%_40%,transparent_0%,rgba(5,2,10,0.42)_72%,rgba(5,2,10,0.66)_100%)]" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-5 py-6 sm:px-8 sm:py-8 lg:px-12">
        <header className="flex items-center justify-between">
          <Link href="/" aria-label="Pulse home" className="inline-flex items-center gap-2.5 rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-fuchsia-400">
            <PulseMark className="h-8 w-8" glow={false} />
            <span className="text-brand-gradient text-xl font-bold tracking-tight">Pulse</span>
          </Link>
          <Link
            href="/"
            className="rounded text-[13px] font-medium text-white/55 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-fuchsia-400"
          >
            Back to home
          </Link>
        </header>

        <div className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(420px,470px)] lg:gap-16 lg:py-0">
          <PulseHero className="hidden lg:block" />
          <div className="flex justify-center lg:justify-end">
            <LoginCard key={initialMode} initialMode={initialMode} />
          </div>
        </div>
      </div>

      <footer className="relative z-10 border-t border-white/8 py-5">
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 sm:px-8 lg:px-12">
          <p className="text-[12px] text-white/35">
            © {new Date().getFullYear()} Duniya Healthcare · Pulse
          </p>
          <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-white/30">
            Secure account access
          </p>
        </div>
      </footer>
    </main>
  );
}
