"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const VIDEO_SRC = `${BASE_PATH}/media/pulse-hero-loop-uhd.mp4`;
const POSTER_SRC = `${BASE_PATH}/media/pulse-hero-poster-uhd.jpg`;

/**
 * Background film for the editorial hero.
 *
 * The poster is always present so the pane has a finished still while the
 * video loads (and if it never does). The video only mounts on real desktop
 * viewports, never under reduced-motion, and never when the user has asked
 * their connection to save data.
 */
export function HeroVideo({ className }: { className?: string }) {
  const [isDesktop, setIsDesktop] = useState(false);
  const [canPlayVideo, setCanPlayVideo] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const update = () => {
      const saveData = Boolean(
        (navigator as Navigator & { connection?: { saveData?: boolean } })
          .connection?.saveData
      );
      setIsDesktop(desktopQuery.matches);
      setCanPlayVideo(
        desktopQuery.matches && !motionQuery.matches && !saveData
      );
      setIsReady(false);
    };

    update();
    desktopQuery.addEventListener("change", update);
    motionQuery.addEventListener("change", update);

    return () => {
      desktopQuery.removeEventListener("change", update);
      motionQuery.removeEventListener("change", update);
    };
  }, []);

  if (!isDesktop) return null;

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden rounded-[30px] bg-[#05020a]",
        className
      )}
    >
      <img
        src={POSTER_SRC}
        alt=""
        loading="eager"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
      />

      {canPlayVideo && (
        <video
          src={VIDEO_SRC}
          poster={POSTER_SRC}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          onCanPlay={() => setIsReady(true)}
          onPlaying={() => setIsReady(true)}
          onError={() => setIsReady(false)}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-[1400ms] ease-out",
            isReady ? "opacity-[0.88]" : "opacity-0"
          )}
        />
      )}

      {/* Keep the copy legible without flattening the film. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, rgba(5,2,10,0.88) 0%, rgba(5,2,10,0.62) 38%, rgba(5,2,10,0.14) 72%, rgba(5,2,10,0.42) 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(5,2,10,0.58) 0%, rgba(5,2,10,0.12) 26%, rgba(5,2,10,0.04) 58%, rgba(5,2,10,0.72) 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 56% 44%, transparent 0%, transparent 30%, rgba(5,2,10,0.16) 68%, rgba(5,2,10,0.55) 100%)",
        }}
      />
    </div>
  );
}
