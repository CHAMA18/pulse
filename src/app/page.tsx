import { PulseHero } from "@/components/login/pulse-hero";
import { AccessCta } from "@/components/login/access-cta";
import { DesktopSection } from "@/components/login/desktop-section";
import {
  BrandHeader,
  PulseAtmosphere,
  SiteFooter,
} from "@/components/login/site-chrome";

/**
 * Landing page — pure marketing.
 *
 * The hero tells the story; the AccessCta panel hands visitors over to the
 * dedicated sign-in screen (/login) via Register and Login actions. The
 * authentication form itself lives at /login so this page stays focused.
 */
export default function LandingPage() {
  return (
    <main id="top" className="pulse-space relative flex min-h-svh w-full flex-col overflow-hidden">
      {/* — atmosphere: aurora fields, living canvas, grain, vignette — */}
      <PulseAtmosphere />

      {/* — content — */}
      <div className="relative z-10 mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-5 py-6 sm:px-8 sm:py-8 lg:px-12">
        {/* compact brand row — desktop uses the hero's lockup instead */}
        <BrandHeader className="lg:hidden" />

        <div className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(420px,470px)] lg:gap-16 lg:py-0">
          {/* editorial hero — now the landing's leading act on every screen */}
          <PulseHero />

          {/* route into the product: Register / Login → /login */}
          <div className="flex justify-center lg:justify-end">
            <AccessCta className="w-full max-w-[470px]" />
          </div>
        </div>

        {/* desktop apps — Mac & Windows showcase (below the fold) */}
        <DesktopSection />
      </div>

      <SiteFooter />
    </main>
  );
}
