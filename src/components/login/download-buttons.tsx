"use client";

import { motion } from "framer-motion";
import { AppleLogo, WindowsLogo } from "@/components/login/platform-icons";
import { DESKTOP_DOWNLOADS } from "@/lib/desktop-downloads";
import { trackEvent } from "@/lib/firebase";
import { cn } from "@/lib/utils";

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
            href={DESKTOP_DOWNLOADS[platform]}
            onClick={() => void trackEvent("download_click", { location: "hero", platform })}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            className={cn(
              "group inline-flex h-11 items-center gap-2.5 rounded-full border border-white/20 bg-black px-5",
              "text-[13.5px] font-semibold text-white",
              "shadow-[0_10px_30px_-12px_rgba(0,0,0,0.9)] transition-[border-color,background-color] duration-300",
              "hover:border-white/35 hover:bg-black",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400"
            )}
          >
            <Icon className="h-[17px] w-[17px] text-white transition-colors" />
            {label}
          </motion.a>
        ))}
      </motion.div>
    </div>
  );
}
