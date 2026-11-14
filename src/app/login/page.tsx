import type { Metadata } from "next";
import { LoginCard } from "@/components/login/login-card";
import {
  BackHomeLink,
  BrandHeader,
  PulseAtmosphere,
} from "@/components/login/site-chrome";

/**
 * Dedicated sign-in screen — the authentication area of the site.
 *
 * The landing page (/) is pure marketing with Register / Login calls to
 * action; this route hosts the actual login form so the two concerns stay
 * separate. `?intent=register` deep-links straight into unified account
 * creation (used by the landing page's Register button) — detected
 * client-side inside LoginCard to keep this route fully static-exportable.
 */
export const metadata: Metadata = {
  title: "Sign in — Pulse",
  description:
    "Sign in to Pulse, the pharmacy intelligence platform. Track stock, demand and delivery in real time — or create your account.",
};

export default function SignInPage() {
  return (
    <main id="top" className="pulse-space relative flex min-h-svh w-full flex-col overflow-hidden">
      {/* — atmosphere: aurora fields, living canvas, grain, vignette — */}
      <PulseAtmosphere />

      {/* — content — */}
      <div className="relative z-10 mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-5 py-6 sm:px-8 sm:py-8 lg:px-12">
        <BrandHeader right={<BackHomeLink />} />

        <div className="flex flex-1 items-center justify-center py-10 lg:py-0">
          {/* the sign-in card — now the star of its own screen */}
          <LoginCard />
        </div>
      </div>
    </main>
  );
}
