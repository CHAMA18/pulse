import { PulseBackground } from "@/components/login/pulse-background";
import { LoginCard } from "@/components/login/login-card";

export default function LoginPage() {
  return (
    <main className="duniya-space relative min-h-svh w-full overflow-hidden">
      <PulseBackground className="pointer-events-none fixed inset-0 z-0 h-full w-full" />
      {/* vignette to focus the card */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(900px_600px_at_50%_44%,transparent_0%,rgba(4,2,8,0.35)_78%,rgba(4,2,8,0.6)_100%)]"
      />
      <div className="relative z-10 flex min-h-svh w-full items-center justify-center px-4 py-10 sm:px-6 sm:py-14">
        <LoginCard />
      </div>
    </main>
  );
}
