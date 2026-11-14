import { PulseHero } from "@/components/login/pulse-hero";
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
  TrustStrip,
} from "@/components/landing/sections";

/**
 * Landing page — pure marketing, world-class on purpose.
 *
 * The composition: a sticky glass nav; the editorial hero set on its own glass
 * pane over the living monitor; the DemoTheater (Pulse rendering itself on a scrubbable
 * timeline — no video file, no fakery); a capability marquee; a bento of
 * live micro-visuals; three beats of onboarding; the two portals; the
 * desktop apps; and one closing CTA. The authentication form itself lives
 * at /login.
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
        {/* hero — editorial lead onto the living monitor */}
        <div className="mx-auto w-full max-w-[1400px] px-5 pb-8 pt-28 sm:px-8 sm:pt-32 lg:px-12 lg:pt-36">
          <PulseHero />
        </div>

        {/* the demo — Pulse rendering itself */}
        <DemoTheater />

        {/* capability marquee */}
        <TrustStrip />

        {/* bento features */}
        <BentoFeatures />

        {/* three beats */}
        <HowItWorks />

        {/* the two consoles */}
        <PortalsShowcase />

        {/* desktop apps — Mac & Windows showcase */}
        <div className="mx-auto w-full max-w-[1400px] px-5 sm:px-8 lg:px-12">
          <DesktopSection />
        </div>

        {/* closing CTA */}
        <FinalCta />
      </div>

      <SiteFooter />
    </main>
  );
}
