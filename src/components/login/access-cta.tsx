"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { LogIn, UserPlus, type LucideIcon } from "lucide-react";
import { PulseMark } from "@/components/login/pulse-logo";

/**
 * AccessCta — the landing page's route into the product.
 *
 * With the sign-in form living on its own dedicated screen (/login), the
 * landing hero pairs with this panel: two clear entry points — Register
 * (primary) and Login (secondary) — that navigate to the auth screen.
 * The Register deep link pre-opens the pharmacy registration dialog.
 */

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 26, filter: "blur(6px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const },
});

const ACTIONS: {
  href: string;
  label: string;
  hint: string;
  Icon: LucideIcon;
  primary?: boolean;
}[] = [
  {
    href: "/login?intent=register",
    label: "Register",
    hint: "Join the Pulse network — register your pharmacy",
    Icon: UserPlus,
    primary: true,
  },
  {
    href: "/login",
    label: "Login",
    hint: "Already a member? Sign in to your console",
    Icon: LogIn,
  },
];

export function AccessCta({ className }: { className?: string }) {
  return (
    <motion.section
      {...fadeUp(0.25)}
      aria-label="Access Pulse"
      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.045] p-7 backdrop-blur-sm sm:p-9 ${className ?? ""}`}
    >
      {/* gradient hairline border (radius follows the panel) */}
      <span aria-hidden="true" className="card-hairline opacity-60" />

      <div className="mb-6 inline-flex items-center gap-2.5">
        <PulseMark className="h-9 w-9" glow={false} />
        <span className="text-brand-gradient text-[27px] font-bold leading-none tracking-tight">
          Pulse
        </span>
      </div>

      <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300/80">
        Pulse access
      </p>
      <h2 className="mt-3 text-[clamp(1.55rem,2.1vw,2rem)] font-semibold leading-tight tracking-tight text-white">
        Enter your console.
      </h2>
      <p className="mt-2.5 max-w-sm text-[14.5px] leading-relaxed text-white/55">
        Track stock, demand and delivery in real time — or register your
        pharmacy to join the network.
      </p>

      <div className="mt-7 flex flex-col gap-3">
        {ACTIONS.map(({ href, label, hint, Icon, primary }) => (
          <Link
            key={label}
            href={href}
            className={
              primary
                ? "btn-brand group inline-flex h-12 items-center justify-between gap-3 rounded-md px-5 text-[15px] font-semibold text-white shadow-[0_14px_34px_-10px_rgba(168,85,247,0.65)] transition-shadow hover:shadow-[0_18px_44px_-10px_rgba(168,85,247,0.8)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400"
                : "group inline-flex h-12 items-center justify-between gap-3 rounded-md border border-white/12 bg-white/5 px-5 text-[15px] font-medium text-white/85 transition-colors hover:border-white/20 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400"
            }
          >
            <span className="inline-flex items-center gap-3">
              <Icon
                className={`h-[18px] w-[18px] ${primary ? "text-white" : "text-fuchsia-300"}`}
                strokeWidth={2.1}
                aria-hidden="true"
              />
              {label}
            </span>
            <span
              className={`text-[11.5px] font-normal leading-tight ${
                primary ? "text-white/70" : "text-white/35"
              } hidden sm:block`}
            >
              {hint}
            </span>
          </Link>
        ))}
      </div>

      <p className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] uppercase tracking-[0.18em] text-white/35">
        <span>Dual portals</span>
        <span aria-hidden="true" className="h-3 w-px bg-white/15" />
        <span>Secured sessions</span>
        <span aria-hidden="true" className="h-3 w-px bg-white/15" />
        <span className="text-emerald-300/70">Free for network pharmacies</span>
      </p>
    </motion.section>
  );
}
