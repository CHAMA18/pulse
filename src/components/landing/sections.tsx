"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  ClipboardCheck,
  LayoutGrid,
  ScanLine,
  ShieldCheck,
  ShoppingCart,
  Store,
  type LucideIcon,
} from "lucide-react";
import { PulseMark } from "@/components/login/pulse-logo";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Shared section head                                                 */
/* ------------------------------------------------------------------ */

export function SectionHead({
  eyebrow,
  title,
  sub,
  align = "center",
}: {
  eyebrow: string;
  title: React.ReactNode;
  sub?: string;
  align?: "center" | "left";
}) {
  return (
    <div
      className={cn(
        "max-w-2xl",
        align === "center" ? "mx-auto text-center" : "text-left"
      )}
    >
      <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.26em] text-fuchsia-300/80">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-[clamp(1.9rem,3.4vw,2.9rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-white">
        {title}
      </h2>
      {sub ? (
        <p className="mt-4 text-[15px] leading-relaxed text-white/55">{sub}</p>
      ) : null}
    </div>
  );
}

/** Reveal-on-scroll wrapper — subtle rise, once. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 28, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* TrustStrip — a capability marquee                                   */
/* ------------------------------------------------------------------ */

const STRIP_ITEMS = [
  "Live stock vitals",
  "Audited movements",
  "Branded invitations",
  "Multi-store network",
  "Role-based access",
  "Dual portals",
  "Sales in < 2 minutes",
  "Offline-tolerant",
  "Privacy-first",
  "Static-fast pages",
];

export function TrustStrip() {
  return (
    <section
      aria-label="Pulse capabilities"
      className="marquee-pause relative overflow-hidden border-y border-white/8 bg-white/[0.02] py-5"
    >
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-[#08030f] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-[#08030f] to-transparent" />
      <div className="animate-marquee flex w-max items-center gap-8 pr-8">
        {[...STRIP_ITEMS, ...STRIP_ITEMS].map((item, i) => (
          <span
            key={`${item}-${i}`}
            className="flex items-center gap-8 whitespace-nowrap"
            aria-hidden={i >= STRIP_ITEMS.length}
          >
            <span className="text-[12.5px] font-semibold uppercase tracking-[0.2em] text-white/45">
              {item}
            </span>
            {/* EKG tick between items */}
            <svg
              aria-hidden="true"
              viewBox="0 0 28 12"
              className="h-3 w-7 text-fuchsia-400/70"
              fill="none"
            >
              <path
                d="M0 6 H8 L11 2 15 10 18 4 20 6 H28"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* BentoFeatures — the capability grid                                 */
/* ------------------------------------------------------------------ */

type BentoCell = {
  title: string;
  body: string;
  Icon: LucideIcon;
  span: string;
  visual: React.ReactNode;
  foot?: string;
};

function MiniReceipt() {
  return (
    <div className="mt-5 space-y-2 rounded-xl border border-white/8 bg-[#120a20]/80 p-3.5">
      {[
        ["Coartem 20/60 ×1", "K 85"],
        ["ORS Sachet ×2", "K 10"],
        ["Paracetamol ×1", "K 15"],
      ].map(([name, amt], i) => (
        <div
          key={name}
          className="flex items-center justify-between border-b border-dashed border-white/8 pb-2 text-[11.5px]"
        >
          <span className="text-white/70">{name}</span>
          <span className="font-mono tabular-nums text-white/50">{amt}</span>
          <span
            aria-hidden="true"
            className="animate-float-delayed h-1.5 w-1.5 rounded-full bg-emerald-400"
            style={{ animationDelay: `${i * 0.6}s` }}
          />
        </div>
      ))}
      <div className="flex items-center justify-between pt-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
          Total
        </span>
        <span className="font-mono text-[15px] font-bold tabular-nums text-white">
          K 110
        </span>
      </div>
      <p className="flex items-center gap-1.5 pt-1 font-mono text-[9px] uppercase tracking-[0.16em] text-emerald-300/90">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Paid · change K 10 · shelf updated
      </p>
    </div>
  );
}

function MiniLedger() {
  const rows = [
    { ref: "MOV-5020", qty: "+24", in: true, note: "CarePlus delivery" },
    { ref: "MOV-5021", qty: "−6", in: false, note: "Makeni issue" },
    { ref: "MOV-5022", qty: "−2", in: false, note: "Count correction" },
  ];
  return (
    <div className="mt-5 space-y-1.5 rounded-xl border border-white/8 bg-[#120a20]/80 p-3">
      {rows.map((r) => (
        <div
          key={r.ref}
          className="flex items-center gap-2.5 rounded-md bg-white/[0.03] px-2.5 py-1.5 text-[10.5px]"
        >
          <span className="font-mono text-[9px] text-white/40">{r.ref}</span>
          <span
            className={cn(
              "ml-auto font-mono font-bold tabular-nums",
              r.in ? "text-emerald-300" : "text-amber-300"
            )}
          >
            {r.qty}
          </span>
          <span className="hidden text-white/40 sm:block">{r.note}</span>
        </div>
      ))}
      <p className="pt-1 font-mono text-[9px] uppercase tracking-[0.16em] text-purple-300/80">
        one ledger · every reason · every actor
      </p>
    </div>
  );
}

function MiniStores() {
  const stores = [
    { name: "Cairo Road Main", on: true },
    { name: "Kabwata Branch", on: false },
    { name: "Makeni Clinic Pt", on: false },
  ];
  return (
    <div className="mt-5 flex flex-wrap gap-1.5">
      {stores.map((s, i) => (
        <span
          key={s.name}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium",
            i === 0
              ? "border-purple-400/40 bg-purple-500/15 text-white"
              : "border-white/10 bg-white/[0.04] text-white/55"
          )}
        >
          <Store className="h-3 w-3" aria-hidden="true" />
          {s.name}
          {i === 0 ? (
            <span className="rounded-full bg-purple-400/25 px-1.5 py-px font-mono text-[7.5px] uppercase tracking-wide text-purple-100">
              main
            </span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

function MiniRoles() {
  const roles = ["Owner", "Manager", "Pharmacist", "Technician", "Cashier"];
  return (
    <div className="mt-5 flex flex-wrap gap-1.5">
      {roles.map((r, i) => (
        <span
          key={r}
          className={cn(
            "rounded-full px-2.5 py-1 text-[10px] font-semibold",
            i === 0
              ? "bg-purple-600 text-white"
              : "bg-white/6 text-white/60"
          )}
        >
          {r}
        </span>
      ))}
      <p className="mt-2 w-full font-mono text-[9px] uppercase tracking-[0.16em] text-white/35">
        11 permissions · 5 roles · audit-logged
      </p>
    </div>
  );
}

function MiniCatalogue() {
  return (
    <div className="mt-5 grid grid-cols-4 gap-1.5">
      {["CTM", "PCM", "AMX", "IBU", "MTZ", "ORS", "ZNS", "FES"].map((sku, i) => (
        <span
          key={sku}
          className="flex flex-col items-center gap-1 rounded-lg border border-white/8 bg-white/[0.04] py-2"
        >
          <LayoutGrid
            className="h-3 w-3 text-fuchsia-300/70"
            aria-hidden="true"
            style={{ opacity: 0.5 + 0.5 * Math.sin(i) }}
          />
          <span className="font-mono text-[8px] text-white/45">{sku}</span>
        </span>
      ))}
    </div>
  );
}

const CELLS: BentoCell[] = [
  {
    title: "A sale in under two minutes",
    body: "Tap products onto the receipt, take cash, and the shelf updates itself. Built for the lunchtime queue.",
    Icon: ShoppingCart,
    span: "lg:col-span-2 lg:row-span-2",
    visual: <MiniReceipt />,
    foot: "Tap · total · cash · change — the shelf stays true",
  },
  {
    title: "Every unit accounted for",
    body: "Receipts, issues, transfers, returns and count corrections — one auditable ledger is the only way stock changes.",
    Icon: ScanLine,
    span: "lg:col-span-2",
    visual: <MiniLedger />,
  },
  {
    title: "One network, many shelves",
    body: "Create stores, declare the main shelf, and switch the whole console with one tap.",
    Icon: Store,
    span: "",
    visual: <MiniStores />,
  },
  {
    title: "Roles that hold the line",
    body: "Owners see billing; cashiers see the counter. Permissions are explicit, expiring invites keep the door honest.",
    Icon: ShieldCheck,
    span: "lg:col-span-2",
    visual: <MiniRoles />,
  },
  {
    title: "A catalogue that scales",
    body: "Batches, expiry dates and reorder levels on every SKU — searchable by product, category or batch.",
    Icon: LayoutGrid,
    span: "lg:col-span-2",
    visual: <MiniCatalogue />,
  },
];

export function BentoFeatures() {
  return (
    <section id="features" aria-labelledby="features-title" className="relative scroll-mt-20 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-[1180px] px-5 sm:px-8 lg:px-12">
        <SectionHead
          eyebrow="Everything on one pulse"
          title={
            <>
              Built for the counter,
              <br />
              <span className="text-brand-gradient">wired to the network.</span>
            </>
          }
          sub="Six surfaces, one heartbeat — the pharmacy portal and the Pulse console share the same live stock, the same audit trail, the same rhythm."
        />
        <Reveal className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CELLS.map(({ title, body, Icon, span, visual, foot }, i) => (
            <motion.article
              key={title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.55, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                "group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] p-6 backdrop-blur-sm transition-colors duration-300 hover:border-white/20",
                span
              )}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-purple-500/10 blur-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100"
              />
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-fuchsia-300">
                <Icon className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-[16.5px] font-semibold leading-snug text-white">
                {title}
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed text-white/50">{body}</p>
              {visual}
              {foot ? (
                <p className="mt-auto pt-5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-white/35">
                  {foot}
                </p>
              ) : null}
            </motion.article>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* HowItWorks — three steps                                            */
/* ------------------------------------------------------------------ */

const STEPS: { n: string; title: string; body: string; Icon: LucideIcon }[] = [
  {
    n: "01",
    title: "Register your pharmacy",
    body: "One form creates the account, the owner and the first store — and every team email you list receives a branded Pulse invitation within seconds.",
    Icon: BadgeCheck,
  },
  {
    n: "02",
    title: "Stock your shelves",
    body: "Load the catalogue with batches and expiry dates, record supplier receipts, and let the movement ledger keep every unit honest.",
    Icon: ClipboardCheck,
  },
  {
    n: "03",
    title: "Sell, watch, scale",
    body: "Run the counter with the POS, read the stock balance at a glance, and add stores when the network asks for more.",
    Icon: Activity,
  },
];

export function HowItWorks() {
  return (
    <section aria-labelledby="how-title" className="relative py-16 sm:py-24">
      <div className="mx-auto w-full max-w-[1180px] px-5 sm:px-8 lg:px-12">
        <SectionHead
          eyebrow="Three beats"
          title={
            <>
              From zero to counter
              <br />
              <span className="text-brand-gradient">in one sitting.</span>
            </>
          }
        />
        <div className="relative mt-14 grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-6">
          {/* connecting line */}
          <div
            aria-hidden="true"
            className="absolute left-0 right-0 top-6 hidden h-px bg-gradient-to-r from-transparent via-purple-400/30 to-transparent md:block"
          />
          {STEPS.map(({ n, title, body, Icon }, i) => (
            <Reveal key={n} delay={i * 0.12} className="relative">
              <div className="flex items-center gap-3">
                <span className="relative z-10 flex h-12 w-12 items-center justify-center rounded-2xl border border-purple-400/30 bg-[#150b26] font-mono text-[13px] font-bold text-fuchsia-300 shadow-[0_0_24px_-6px_rgba(168,85,247,0.6)]">
                  {n}
                </span>
                <Icon className="h-5 w-5 text-white/30" aria-hidden="true" />
              </div>
              <h3 className="mt-5 text-[18px] font-semibold text-white">{title}</h3>
              <p className="mt-2.5 max-w-sm text-[13.5px] leading-relaxed text-white/50">
                {body}
              </p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* PortalsShowcase — the two consoles                                  */
/* ------------------------------------------------------------------ */

const PORTALS = [
  {
    name: "Pharmacy portal",
    tag: "For the counter",
    desc: "Point of Sale, Stock Balance, Inventory, Stock Movement, Purchase Orders, Deliveries, Suppliers, Stores, Team — the daily heartbeat of one pharmacy.",
    href: "/login?intent=register",
    cta: "Register your pharmacy",
    items: ["Point of Sale", "Stock Movement", "Purchase Orders", "User Management"],
  },
  {
    name: "Pulse console",
    tag: "For the network",
    desc: "Every pharmacy on the map — onboarding requests, stock-balance visibility, network analytics, supplier management and a tamper-evident audit log.",
    href: "/login",
    cta: "Sign in to the console",
    items: ["Pulse Pharmacies", "Network Analytics", "Audit Logs", "Suppliers"],
  },
];

export function PortalsShowcase() {
  return (
    <section id="portals" aria-labelledby="portals-title" className="relative scroll-mt-20 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-[1180px] px-5 sm:px-8 lg:px-12">
        <SectionHead
          eyebrow="Two doors, one pulse"
          title={
            <>
              A portal for the counter.
              <br />
              <span className="text-brand-gradient">A console for the network.</span>
            </>
          }
        />
        <div className="mt-12 grid grid-cols-1 gap-5 lg:grid-cols-2">
          {PORTALS.map(({ name, tag, desc, href, cta, items }, i) => (
            <Reveal key={name} delay={i * 0.1}>
              <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] p-7 backdrop-blur-sm transition-colors duration-300 hover:border-white/20 sm:p-9">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -left-20 -top-20 h-56 w-56 rounded-full bg-purple-600/12 blur-3xl"
                />
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-fuchsia-300/80">
                  {tag}
                </p>
                <h3 className="mt-2.5 text-[24px] font-semibold tracking-tight text-white">
                  {name}
                </h3>
                <p className="mt-3 text-[13.5px] leading-relaxed text-white/50">{desc}</p>
                <ul className="mt-6 flex flex-wrap gap-2">
                  {items.map((item) => (
                    <li
                      key={item}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11.5px] font-medium text-white/65"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
                <Link
                  href={href}
                  className="mt-8 inline-flex items-center gap-2 text-[14px] font-semibold text-fuchsia-300 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400"
                >
                  {cta}
                  <ArrowRight
                    className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1"
                    aria-hidden="true"
                  />
                </Link>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* FinalCta — the closing band                                         */
/* ------------------------------------------------------------------ */

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="relative py-16 sm:py-24">
      <div className="mx-auto w-full max-w-[1180px] px-5 sm:px-8 lg:px-12">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-purple-400/25 bg-gradient-to-br from-[#1b0b33] via-[#16082b] to-[#0e0519] px-6 py-14 text-center sm:px-12 sm:py-20">
            {/* aura + ekg line */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(640px_280px_at_50%_0%,rgba(168,85,247,0.28),transparent_70%)]"
            />
            <svg
              aria-hidden="true"
              viewBox="0 0 900 60"
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-x-0 bottom-6 h-10 w-full text-purple-400/25"
              fill="none"
            >
              <path
                d="M0 30 H300 L330 30 348 8 370 52 388 16 404 30 H900"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>

            <span className="relative inline-flex">
              <span
                aria-hidden="true"
                className="animate-beat-ring absolute inset-0 rounded-full bg-fuchsia-500/30 blur-lg"
              />
              <PulseMark className="animate-beat-thump relative h-14 w-14" />
            </span>
            <h2
              id="cta-title"
              className="relative mx-auto mt-6 max-w-xl text-[clamp(2rem,4vw,3.1rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-white"
            >
              Give your pharmacy{" "}
              <span className="text-brand-gradient">a pulse.</span>
            </h2>
            <p className="relative mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-white/55">
              Register in one form, invite the team with their roles attached,
              and take your first sale before the kettle boils.
            </p>
            <div className="relative mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/login?intent=register"
                className="btn-brand inline-flex h-12 items-center rounded-full px-7 text-[15px] font-semibold text-white shadow-[0_18px_44px_-12px_rgba(168,85,247,0.8)] transition-shadow hover:shadow-[0_22px_54px_-12px_rgba(168,85,247,0.95)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400"
              >
                Register your pharmacy
              </Link>
              <Link
                href="/login"
                className="inline-flex h-12 items-center rounded-full border border-white/15 bg-white/5 px-7 text-[15px] font-semibold text-white/85 transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400"
              >
                Sign in
              </Link>
            </div>
            <p className="relative mt-6 font-mono text-[10.5px] uppercase tracking-[0.2em] text-white/35">
              Free for network pharmacies · No card, no lock-in
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
