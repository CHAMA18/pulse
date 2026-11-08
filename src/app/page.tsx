import { PulseHero } from "@/components/login/pulse-hero";
import { AccessCta } from "@/components/login/access-cta";
import { DesktopSection } from "@/components/login/desktop-section";
import {
  PulseAtmosphere,
  SiteFooter,
} from "@/components/login/site-chrome";
import { SiteNav } from "@/components/landing/site-nav";
import { DemoTheater } from "@/components/landing/demo-theater";
import {
  BentoFeatures,
  FinalCta,
  HowItWorks,
  PortalsShowcase,
  StatsBand,
  TrustStrip,
  Voices,
} from "@/components/landing/sections";

/**
 * Landing page — pure marketing, world-class on purpose.
 *
 * The composition: a sticky glass nav; the editorial hero pairing with the
 * access panel; the DemoTheater (Pulse rendering itself on a scrubbable
 * timeline — no video file, no fakery); a capability marquee; a bento of
 * live micro-visuals; honest animated stats; three beats of onboarding;
 * the two portals; the desktop apps; voices from the network; and one
 * closing CTA. The authentication form itself lives at /login.
 */
export default function LandingPage() {
  return (
    <main id="top" className="pulse-space relative flex min-h-svh w-full flex-col overflow-x-clip">
      {/* — atmosphere: aurora fields, living canvas, grain, vignette — */}
      <PulseAtmosphere />

      {/* — sticky glass navigation — */}
      <SiteNav />

      {/* — content — */}
      <div className="relative z-10 flex w-full flex-1 flex-col">
        {/* hero — editorial lead + route into the product */}
        <div className="mx-auto w-full max-w-[1400px] px-5 pb-8 pt-28 sm:px-8 sm:pt-32 lg:px-12 lg:pt-36">
          <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(380px,470px)] lg:gap-16">
            <PulseHero />
            <div className="flex justify-center lg:justify-end">
              <AccessCta className="w-full max-w-[470px]" />
            </div>
          </div>
        </div>

        {/* the demo — Pulse rendering itself */}
        <DemoTheater />

        {/* capability marquee */}
        <TrustStrip />

        {/* bento features */}
        <BentoFeatures />

        {/* honest numbers */}
        <StatsBand />

        {/* three beats */}
        <HowItWorks />

        {/* the two consoles */}
        <PortalsShowcase />

        {/* desktop apps — Mac & Windows showcase */}
        <div className="mx-auto w-full max-w-[1400px] px-5 sm:px-8 lg:px-12">
          <DesktopSection />
        </div>

        {/* voices from the network */}
        <Voices />

        {/* closing CTA */}
        <FinalCta />
      </div>

      <SiteFooter />
    </main>
  );
}
