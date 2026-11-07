import { PulseBackground } from "@/components/login/pulse-background";
import { LoginCard } from "@/components/login/login-card";
import { PulseHero } from "@/components/login/pulse-hero";
import { PulseMark } from "@/components/login/pulse-logo";

export default function LoginPage() {
  return (
    <main className="pulse-space relative flex min-h-svh w-full flex-col overflow-hidden">
      {/* — atmosphere: aurora fields, living canvas, grain, vignette — */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="aurora-blob aurora-a" />
        <div className="aurora-blob aurora-b" />
        <div className="aurora-blob aurora-c" />
        <PulseBackground className="absolute inset-0 h-full w-full" />
        <div className="pulse-grain absolute inset-0 opacity-[0.05]" />
        <div className="absolute inset-0 bg-[radial-gradient(1100px_700px_at_30%_40%,transparent_0%,rgba(5,2,10,0.42)_72%,rgba(5,2,10,0.66)_100%)]" />
      </div>

      {/* — content — */}
      <div className="relative z-10 mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-5 py-6 sm:px-8 sm:py-8 lg:px-12">
        {/* compact brand row (mobile / tablet) */}
        <header className="flex items-center justify-between lg:hidden">
          <span className="inline-flex items-center gap-2.5">
            <PulseMark className="h-8 w-8" glow={false} />
            <span className="text-brand-gradient text-xl font-bold tracking-tight">Pulse</span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
            Pharmacy intelligence
          </span>
        </header>

        <div className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(420px,470px)] lg:gap-16 lg:py-0">
          {/* editorial hero (desktop) */}
          <PulseHero className="hidden lg:block" />

          {/* sign-in card */}
          <div className="flex justify-center lg:justify-end">
            <LoginCard />
          </div>
        </div>
      </div>

      {/* — footer (sticks to the bottom, never floats) — */}
      <footer className="relative z-10 mt-auto">
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-x-6 gap-y-1.5 px-5 pb-6 sm:px-8 lg:px-12">
          <p className="text-[12px] text-white/35">
            © {new Date().getFullYear()} Duniya Healthcare · Pulse
          </p>
          <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-white/30">
            Privacy-first · Secured sessions
          </p>
        </div>
      </footer>
    </main>
  );
}
