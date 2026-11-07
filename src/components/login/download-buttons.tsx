"use client";

import { motion } from "framer-motion";
import { AppleLogo, WindowsLogo } from "@/components/login/platform-icons";
import { trackEvent } from "@/lib/firebase";
import { cn } from "@/lib/utils";

/**
 * Release channel — every download button points at the project's real
 * GitHub releases page, where signed installers for each platform are
 * published alongside their checksums.
 */
export const RELEASES_URL = "https://github.com/CHAMA18/pulse/releases";

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 18, filter: "blur(5px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] as const },
});

const BUTTONS: {
  platform: "macos" | "windows";
  label: string;
  Icon: (props: { className?: string }) => React.ReactElement;
}[] = [
  { platform: "macos", label: "Download for Mac", Icon: AppleLogo },
  { platform: "windows", label: "Download for Windows", Icon: WindowsLogo },
];

/**
 * Hero download row — the two primary desktop CTAs on the landing page.
 * Compact by design so they complement (never compete with) the sign-in card.
 */
export function DownloadButtons({ className }: { className?: string }) {
  return (
    <div className={className}>
      <motion.div {...fadeUp(0.41)} className="flex flex-wrap items-center gap-3">
        {BUTTONS.map(({ platform, label, Icon }) => (
          <motion.a
            key={platform}
            href={RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => void trackEvent("download_click", { location: "hero", platform })}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            className={cn(
              "group inline-flex h-11 items-center gap-2.5 rounded-full border border-white/15 bg-white/[0.07] px-5",
              "text-[13.5px] font-semibold text-white/90 backdrop-blur-sm",
              "shadow-[0_10px_30px_-12px_rgba(168,85,247,0.45)] transition-colors duration-300",
              "hover:border-white/30 hover:bg-white/[0.13] hover:text-white",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400"
            )}
          >
            <Icon className="h-[17px] w-[17px] text-white/80 transition-colors group-hover:text-white" />
            {label}
          </motion.a>
        ))}
      </motion.div>
      <motion.p
        {...fadeUp(0.48)}
        className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.18em] text-white/35"
      >
        v1.0 · Early access · Free for Pulse network pharmacies
      </motion.p>
    </div>
  );
}
