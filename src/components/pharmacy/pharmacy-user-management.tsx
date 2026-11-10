"use client";

import { motion } from "framer-motion";
import {
  BadgeCheck,
  Check,
  CircleCheck,
  CirclePause,
  Clock,
  Mail,
  Minus,
  MoreHorizontal,
  RotateCw,
  Search,
  SearchX,
  Send,
  ShieldCheck,
  Store,
  UserMinus,
  UserPlus,
  UserRoundCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { PharmacyStore } from "@/components/pharmacy/pharmacy-data";
import { PageHeader, pharmacyCardCls } from "@/components/pharmacy/pharmacy-shared";
import { EmailPreviewDialog } from "@/components/cloud/email-preview-dialog";
import {
  callCloudFunction,
  CloudFunctionError,
  type InvitationMessage,
} from "@/lib/cloud/invitations";
import { recordAudit } from "@/lib/audit-log";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/firebase";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

/** The roles on the Pharmacy side of the interface. */
export type PharmacyRole = "owner" | "manager" | "pharmacist" | "technician" | "cashier";
type MemberStatus = "active" | "invited" | "suspended";

type PharmacyMember = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: PharmacyRole;
  /** Stores this member may access; ["all"] covers every store. */
  storeIds: string[];
  status: MemberStatus;
  invitedAt: number | null;
  lastActive: number | null;
};

// v2 excludes the locally fabricated roster that older builds persisted.
const STORAGE_KEY = "pulse.pharmacy-members.v2";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY = 24 * 60 * 60 * 1000;

const ROLE_OPTIONS: PharmacyRole[] = ["owner", "manager", "pharmacist", "technician", "cashier"];

export const ROLE_META: Record<PharmacyRole, { label: string; pill: string; blurb: string }> = {
  owner: {
    label: "Owner",
    pill: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300",
    blurb: "Full control of the account — billing, stores, the team and ownership.",
  },
  manager: {
    label: "Pharmacy Manager",
    pill: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300",
    blurb: "Runs day-to-day operations across stores and manages the team.",
  },
  pharmacist: {
    label: "Pharmacist",
    pill: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    blurb: "Dispensing, inventory and stock-request approvals.",
  },
  technician: {
    label: "Pharmacy Technician",
    pill: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    blurb: "Prepares stock, submits requests and receives deliveries.",
  },
  cashier: {
    label: "Cashier",
    pill: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300",
    blurb: "Serves the counter with read-only stock visibility.",
  },
};

/** Capability matrix — what each role may do on the Pharmacy side. */
const CAPABILITIES: string[] = [
  "Dashboard & reports",
  "Stock balance",
  "Adjust inventory",
  "Create stock requests",
  "Approve stock requests",
  "Record deliveries",
  "Supplier directory",
  "Manage stores",
  "Invite & manage users",
  "Billing & subscription",
  "Transfer ownership",
];

const ROLE_ACCESS: Record<PharmacyRole, boolean[]> = {
  owner: [true, true, true, true, true, true, true, true, true, true, true],
  manager: [true, true, true, true, true, true, true, true, true, false, false],
  pharmacist: [true, true, true, true, true, true, true, false, false, false, false],
  technician: [true, true, true, true, false, true, false, false, false, false, false],
  cashier: [true, true, false, true, false, false, false, false, false, false, false],
};

function loadMembers(): PharmacyMember[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is PharmacyMember =>
        !!m &&
        typeof m === "object" &&
        typeof (m as PharmacyMember).name === "string" &&
        typeof (m as PharmacyMember).email === "string" &&
        (m as PharmacyMember).status === "invited"
    );
  } catch {
    return [];
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `mem-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `mem-${Date.now().toString(36)}`;
}

function initialOf(name: string): string {
  return (name.trim()[0] ?? "P").toUpperCase();
}

function timeAgo(ts: number | null, now: number): string {
  if (!ts) return "—";
  const mins = Math.round((now - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** "an Owner" / "a Cashier" — the invite email gets this right. */
function articleFor(roleLabel: string): string {
  return /^[aeiou]/i.test(roleLabel) ? "an" : "a";
}

/* ------------------------------------------------------------------ */
/* Motion                                                              */
/* ------------------------------------------------------------------ */

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
};

const item = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const },
  },
};

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function StatCard({
  value,
  label,
  icon: Icon,
  tile,
}: {
  value: string;
  label: string;
  icon: LucideIcon;
  tile: string;
}) {
  return (
    <motion.div variants={item} className={cn(pharmacyCardCls, "flex items-center gap-4 p-5")}>
      <span
        className={cn(
          "flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl",
          tile
        )}
      >
        <Icon className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="whitespace-nowrap text-[28px] font-bold leading-none tracking-tight text-slate-900 dark:text-white">
          {value}
        </p>
        <p className="mt-1.5 whitespace-nowrap text-[14px] font-medium leading-none text-slate-600 dark:text-slate-300">
          {label}
        </p>
      </div>
    </motion.div>
  );
}

function RolePill({ role }: { role: PharmacyRole }) {
  const meta = ROLE_META[role];
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-[12.5px] font-semibold",
        meta.pill
      )}
    >
      {meta.label}
    </span>
  );
}

function StatusBadge({ member, now }: { member: PharmacyMember; now: number }) {
  if (member.status === "active") {
    return (
      <span className="inline-flex items-center gap-2 whitespace-nowrap text-[13.5px] font-medium text-emerald-600 dark:text-emerald-400">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-500" />
        Active
      </span>
    );
  }
  if (member.status === "invited") {
    return (
      <span className="inline-flex items-center gap-2 whitespace-nowrap text-[13.5px] font-medium text-amber-600 dark:text-amber-400">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-500" />
        Invited · {timeAgo(member.invitedAt, now)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-[13.5px] font-medium text-rose-500 dark:text-rose-400">
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-rose-500" />
      Suspended
    </span>
  );
}

function StoreAccessChips({
  member,
  stores,
}: {
  member: PharmacyMember;
  stores: PharmacyStore[];
}) {
  if (member.storeIds.includes("all")) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-purple-100 px-2.5 py-1 text-[11.5px] font-semibold text-purple-700 dark:bg-purple-500/15 dark:text-purple-300">
        <Store className="h-3 w-3" aria-hidden="true" />
        All stores
      </span>
    );
  }
  const names = member.storeIds
    .map((id) => stores.find((store) => store.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  if (names.length === 0) {
    return <span className="text-[13px] text-slate-400 dark:text-slate-500">—</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-1 text-[11.5px] font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">
        {names[0]}
      </span>
      {names.length > 1 && (
        <span className="whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-1 text-[11.5px] font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">
          +{names.length - 1} more
        </span>
      )}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-purple-100 text-[15px] font-bold text-purple-700 dark:bg-purple-500/15 dark:text-purple-300"
    >
      {initialOf(name)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Invite dialog — the detailed email invitation                       */
/* ------------------------------------------------------------------ */

type InviteDraft = {
  name: string;
  email: string;
  phone: string;
  role: PharmacyRole;
  storeIds: string[];
  expiresInDays: number;
  message: string;
};

function InviteDialog({
  open,
  onOpenChange,
  stores,
  existingEmails,
  inviterName,
  pharmacyName,
  onInvite,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stores: PharmacyStore[];
  existingEmails: Set<string>;
  inviterName: string;
  pharmacyName: string;
  onInvite: (draft: InviteDraft) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<PharmacyRole>("cashier");
  const [allStores, setAllStores] = useState(false);
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string; stores?: string }>({});

  // Reopening starts a fresh form (render-time reset, like the register dialog).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setName("");
      setEmail("");
      setPhone("");
      setRole("cashier");
      setAllStores(false);
      setStoreIds([]);
      setExpiresInDays(7);
      setMessage("");
      setErrors({});
    }
  }

  const accessLabel = allStores
    ? "All stores"
    : storeIds.length === 0
      ? "—"
      : storeIds
          .map((id) => stores.find((store) => store.id === id)?.name ?? id)
          .join(", ");

  const validate = () => {
    const next: typeof errors = {};
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (cleanName.length < 2) next.name = "Enter the person's full name.";
    if (!EMAIL_RE.test(cleanEmail)) next.email = "Enter a valid email address.";
    else if (existingEmails.has(cleanEmail))
      next.email = "Someone on the team already uses this email.";
    if (!allStores && storeIds.length === 0) next.stores = "Pick at least one store.";
    setErrors(next);
    return Object.keys(next).length === 0 ? cleanName : null;
  };

  const submit = () => {
    const cleanName = validate();
    if (cleanName === null) return;
    onInvite({
      name: cleanName,
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      role,
      storeIds: allStores ? ["all"] : [...storeIds],
      expiresInDays,
      message: message.trim(),
    });
    onOpenChange(false);
  };

  const fieldCls =
    "h-11 w-full rounded-md border bg-white px-3.5 text-[14px] text-slate-900 outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-slate-400 dark:bg-white/5 dark:text-white";
  const fieldState = (hasError?: string) =>
    hasError
      ? "border-rose-300 focus:border-rose-400 focus:ring-4 focus:ring-rose-500/10"
      : "border-slate-200 hover:border-slate-300 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto rounded-2xl p-6 sm:max-w-[760px]">
        <DialogHeader className="space-y-1.5 text-left sm:text-left">
          <DialogTitle className="text-[19px] font-bold tracking-tight text-slate-900 dark:text-white">
            Invite to the pharmacy team
          </DialogTitle>
          <DialogDescription className="text-[13.5px] text-slate-500 dark:text-slate-400">
            They'll receive an email invitation with their role, store access and a personal note
            from you.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-[1fr_280px]">
          {/* — Form — */}
          <div className="flex flex-col gap-4">
            <div>
              <label htmlFor="invite-name" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                Full name
              </label>
              <input
                id="invite-name"
                type="text"
                placeholder="e.g. Chanda Bwalya"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (errors.name) setErrors((p) => ({ ...p, name: undefined }));
                }}
                aria-invalid={!!errors.name}
                autoComplete="off"
                className={cn(fieldCls, fieldState(errors.name))}
              />
              {errors.name && (
                <p role="alert" className="mt-1.5 text-xs text-rose-600">
                  {errors.name}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="invite-email" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                  Work email
                </label>
                <input
                  id="invite-email"
                  type="email"
                  placeholder="name@pharmacy.zm"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (errors.email) setErrors((p) => ({ ...p, email: undefined }));
                  }}
                  aria-invalid={!!errors.email}
                  autoComplete="off"
                  className={cn(fieldCls, fieldState(errors.email))}
                />
                {errors.email && (
                  <p role="alert" className="mt-1.5 text-xs text-rose-600">
                    {errors.email}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="invite-phone" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                  Phone <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <input
                  id="invite-phone"
                  type="tel"
                  placeholder="e.g. +260 96 774 5510"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="off"
                  className={cn(fieldCls, fieldState())}
                />
              </div>
            </div>

            {/* Role */}
            <div>
              <span className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                Role
              </span>
              <div role="radiogroup" aria-label="Role" className="flex flex-wrap gap-2">
                {ROLE_OPTIONS.map((option) => {
                  const active = role === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setRole(option)}
                      className={cn(
                        "inline-flex h-9 items-center whitespace-nowrap rounded-full px-4 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500",
                        active
                          ? "bg-purple-600 text-white shadow-[0_6px_16px_-6px_rgba(147,51,234,0.7)]"
                          : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-purple-50 dark:bg-white/5 dark:text-slate-200 dark:ring-white/10 dark:hover:bg-white/10"
                      )}
                    >
                      {ROLE_META[option].label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[12.5px] leading-snug text-slate-500 dark:text-slate-400">
                {ROLE_META[role].blurb}
              </p>
            </div>

            {/* Store access */}
            <div>
              <span className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                Store access
              </span>
              <div role="group" aria-label="Store access" className="flex flex-wrap gap-2">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={allStores}
                  onClick={() => {
                    setAllStores((v) => !v);
                    if (errors.stores) setErrors((p) => ({ ...p, stores: undefined }));
                  }}
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500",
                    allStores
                      ? "bg-purple-600 text-white shadow-[0_6px_16px_-6px_rgba(147,51,234,0.7)]"
                      : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-purple-50 dark:bg-white/5 dark:text-slate-200 dark:ring-white/10 dark:hover:bg-white/10"
                  )}
                >
                  <Check className={cn("h-3.5 w-3.5", !allStores && "opacity-30")} aria-hidden="true" />
                  All stores
                </button>
                {stores.map((store) => {
                  const checked = allStores || storeIds.includes(store.id);
                  return (
                    <button
                      key={store.id}
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      onClick={() => {
                        if (allStores) return;
                        setStoreIds((prev) =>
                          prev.includes(store.id)
                            ? prev.filter((id) => id !== store.id)
                            : [...prev, store.id]
                        );
                        if (errors.stores) setErrors((p) => ({ ...p, stores: undefined }));
                      }}
                      disabled={allStores}
                      className={cn(
                        "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 disabled:opacity-40",
                        checked
                          ? "bg-purple-100 text-purple-700 ring-1 ring-purple-300 dark:bg-purple-500/20 dark:text-purple-200 dark:ring-purple-500/40"
                          : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-purple-50 dark:bg-white/5 dark:text-slate-200 dark:ring-white/10 dark:hover:bg-white/10"
                      )}
                    >
                      {store.isMain && (
                        <Check className="h-3 w-3 text-purple-600 dark:text-purple-300" aria-hidden="true" />
                      )}
                      {store.name}
                    </button>
                  );
                })}
              </div>
              {errors.stores && (
                <p role="alert" className="mt-1.5 text-xs text-rose-600">
                  {errors.stores}
                </p>
              )}
            </div>

            {/* Expiry */}
            <div>
              <label htmlFor="invite-expiry" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                Invitation expires in
              </label>
              <select
                id="invite-expiry"
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(Number.parseInt(e.target.value, 10))}
                className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-[14px] text-slate-900 outline-none transition-[border-color,box-shadow] focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white [&>option]:bg-white [&>option]:text-slate-900 dark:[&>option]:bg-[#100823] dark:[&>option]:text-white"
              >
                <option value={7}>7 days — recommended</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
              </select>
            </div>

            {/* Personal message */}
            <div>
              <label htmlFor="invite-message" className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                Personal note <span className="font-normal text-slate-400">(included in the email)</span>
              </label>
              <textarea
                id="invite-message"
                rows={3}
                placeholder={`e.g. Welcome to the team — we're glad to have you on board.\n— ${inviterName}`}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white px-3.5 py-2.5 text-[14px] text-slate-900 outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
            </div>
          </div>

          {/* — Email preview — */}
          <aside
            aria-label="Email invitation preview"
            className="flex h-fit flex-col rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5"
          >
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
              <Mail className="h-3.5 w-3.5" aria-hidden="true" />
              Email preview
            </p>
            <div className="mt-3 rounded-lg bg-white p-3 text-[12.5px] shadow-sm ring-1 ring-slate-100 dark:bg-white/[0.06] dark:ring-white/10">
              <p className="truncate text-slate-500 dark:text-slate-400">
                <span className="font-semibold text-slate-700 dark:text-slate-200">From:</span>{" "}
                Pulse Pharmacy Portal
              </p>
              <p className="truncate text-slate-500 dark:text-slate-400">
                <span className="font-semibold text-slate-700 dark:text-slate-200">To:</span>{" "}
                {email || "name@pharmacy.zm"}
              </p>
              <p className="mt-1 border-t border-slate-100 pt-2 font-semibold text-slate-900 dark:border-white/10 dark:text-white">
                You're invited to join {pharmacyName} on Pulse
              </p>
              <div className="mt-2 flex flex-col gap-1.5 text-slate-600 dark:text-slate-300">
                <p>
                  <span className="font-semibold">Role:</span> {ROLE_META[role].label}
                </p>
                <p>
                  <span className="font-semibold">Stores:</span> {accessLabel}
                </p>
                <p>
                  <span className="font-semibold">Accept within:</span> {expiresInDays} days
                </p>
              </div>
              {message && (
                <p className="mt-2 whitespace-pre-line border-t border-slate-100 pt-2 italic leading-relaxed text-slate-600 dark:border-white/10 dark:text-slate-300">
                  {message}
                </p>
              )}
              <p className="mt-2 border-t border-slate-100 pt-2 text-[11.5px] leading-snug text-slate-500 dark:border-white/10 dark:text-slate-400">
                {ROLE_META[role].blurb}
              </p>
              <span className="btn-brand mt-3 flex h-9 items-center justify-center rounded-md text-[12.5px] font-semibold text-white">
                Accept invitation
              </span>
            </div>
          </aside>
        </div>

        <DialogFooter className="mt-2 gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-10 rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(147,51,234,0.7)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            Send invitation
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

type RoleFilter = "all" | PharmacyRole;

export function PharmacyUserManagement({
  stores,
  pharmacyName,
}: {
  stores: PharmacyStore[];
  pharmacyName: string;
}) {
  const { toast } = useToast();

  const [members, setMembers] = useState<PharmacyMember[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [actor, setActor] = useState({ name: "", email: "" });
  // The delivered invitation, rendered in the preview dialog.
  const [preview, setPreview] = useState<InvitationMessage | null>(null);

  // Hydrate once on mount, then persist every change.
  useEffect(() => {
    let active = true;
    void (async () => {
      const { getFirebaseAuth } = await import("@/lib/firebase");
      const auth = getFirebaseAuth();
      try {
        await auth?.authStateReady();
      } catch {
        /* fall through */
      }
      if (!active) return;
      const current = auth?.currentUser;
      setActor({
        name: current?.displayName ?? current?.email?.split("@")[0] ?? "Pharmacy Owner",
        email: current?.email ?? "",
      });
    })();

    const raf = requestAnimationFrame(() => {
      setMembers(loadMembers());
      setNow(Date.now());
      setHydrated(true);
    });
    return () => {
      active = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(members));
    } catch {
      /* storage full or unavailable — in-memory state still works */
    }
  }, [members, hydrated]);

  const audit = (title: string, detail: string) => {
    if (!actor.email) return;
    recordAudit({ title, action: "Update", detail, actor: actor.name, email: actor.email });
  };

  /* ---------------- derived data ---------------- */

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter((m) => {
        if (roleFilter !== "all" && m.role !== roleFilter) return false;
        if (!q) return true;
        return `${m.name} ${m.email} ${m.phone}`.toLowerCase().includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [members, query, roleFilter]);

  const stats = useMemo(() => {
    let active = 0;
    let invited = 0;
    let suspended = 0;
    for (const m of members) {
      if (m.status === "active") active += 1;
      else if (m.status === "invited") invited += 1;
      else suspended += 1;
    }
    return { total: members.length, active, invited, suspended };
  }, [members]);

  /* ---------------- mutations ---------------- */

  const invite = (draft: InviteDraft) => {
    const storeNames = draft.storeIds.includes("all")
      ? ["All stores"]
      : draft.storeIds.map(
          (id) => stores.find((store) => store.id === id)?.name ?? "Store"
        );
    void callCloudFunction("sendTeamInvite", {
      pharmacyName,
      inviterName: actor.name || "The team",
      inviteeName: draft.name,
      inviteeEmail: draft.email,
      role: ROLE_META[draft.role].label,
      storeNames,
      personalMessage: draft.message,
    })
      .then(({ messages }) => {
        const member: PharmacyMember = {
          id: newId(),
          name: draft.name,
          email: draft.email,
          phone: draft.phone,
          role: draft.role,
          storeIds: draft.storeIds,
          status: "invited",
          invitedAt: Date.now(),
          lastActive: null,
        };
        setMembers((prev) => [...prev, member]);
        setPreview(messages[0] ?? null);
        toast({
          title: "Invitation sent",
          description: `${draft.name} (${draft.email}) was invited as ${articleFor(
            ROLE_META[draft.role].label
          )} ${ROLE_META[draft.role].label.toLowerCase()}. Their account is pending registration.`,
        });
        audit(
          "Team Member Invited",
          `${draft.email} · ${ROLE_META[draft.role].label} · ${
            draft.storeIds.includes("all")
              ? "all stores"
              : `${draft.storeIds.length} store${draft.storeIds.length === 1 ? "" : "s"}`
          }`
        );
        void trackEvent("pharmacy_user_invited", { role: draft.role, stores: draft.storeIds.length });
      })
      .catch((err: unknown) => {
        const code = err instanceof CloudFunctionError ? err.code : "unknown";
        toast({
          title: "Invitation failed",
          description: `No account was added because the invitation could not be sent (${code}).`,
        });
      });
  };

  const resendInvite = (member: PharmacyMember) => {
    void callCloudFunction("sendTeamInvite", {
      pharmacyName,
      inviterName: actor.name || "The team",
      inviteeName: member.name,
      inviteeEmail: member.email,
      role: ROLE_META[member.role].label,
      storeNames: member.storeIds.includes("all")
        ? ["All stores"]
        : member.storeIds.map((id) => stores.find((store) => store.id === id)?.name ?? "Store"),
    })
      .then(({ messages }) => {
        setMembers((prev) =>
          prev.map((m) => (m.id === member.id ? { ...m, invitedAt: Date.now() } : m))
        );
        setPreview(messages[0] ?? null);
        toast({ title: "Invitation re-sent", description: `${member.email} received a new invite link.` });
        audit("Team Invite Re-sent", `${member.email}`);
        void trackEvent("pharmacy_user_invite_resent");
      })
      .catch((err: unknown) => {
        const code = err instanceof CloudFunctionError ? err.code : "unknown";
        toast({ title: "Invitation failed", description: `The invitation could not be sent (${code}).` });
      });
  };

  const changeRole = (member: PharmacyMember, role: PharmacyRole) => {
    if (member.role === role) return;
    setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, role } : m)));
    toast({
      title: "Role updated",
      description: `${member.name} is now ${articleFor(ROLE_META[role].label)} ${ROLE_META[
        role
      ].label.toLowerCase()} on your team.`,
    });
    audit(
      "Team Member Role Changed",
      `${member.email} · ${ROLE_META[member.role].label} → ${ROLE_META[role].label}`
    );
    void trackEvent("pharmacy_user_role_changed", { to: role });
  };

  const toggleStatus = (member: PharmacyMember) => {
    if (member.role === "owner") {
      toast({
        title: "The account owner can't be suspended",
        description: "Ownership has to be transferred first.",
      });
      return;
    }
    const next: MemberStatus = member.status === "suspended" ? "active" : "suspended";
    setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, status: next } : m)));
    toast({
      title: next === "suspended" ? "Account suspended" : "Account reactivated",
      description:
        next === "suspended"
          ? `${member.name} can no longer sign in until reactivated.`
          : `${member.name} has access to the pharmacy again.`,
    });
    audit(
      next === "suspended" ? "Team Member Suspended" : "Team Member Reactivated",
      `${member.email}`
    );
    void trackEvent("pharmacy_user_status_changed", { to: next });
  };

  const removeMember = (member: PharmacyMember) => {
    if (member.role === "owner") {
      toast({
        title: "The account owner can't be removed",
        description: "Ownership has to be transferred first.",
      });
      return;
    }
    setMembers((prev) => prev.filter((m) => m.id !== member.id));
    toast({
      title: "User removed",
      description: `${member.name} no longer has access to this pharmacy.`,
    });
    audit("Team Member Removed", `${member.email}`);
    void trackEvent("pharmacy_user_removed");
  };

  /* ---------------- render ---------------- */

  const filterChips: { id: RoleFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "owner", label: "Owners" },
    { id: "manager", label: "Managers" },
    { id: "pharmacist", label: "Pharmacists" },
    { id: "technician", label: "Technicians" },
    { id: "cashier", label: "Cashiers" },
  ];

  const memberMenu = (member: PharmacyMember) => (
    <DropdownMenuContent align="end" className="w-56">
      <DropdownMenuLabel>
        <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
          {member.name}
        </p>
        <p className="truncate text-xs font-normal text-slate-500 dark:text-slate-400">
          {member.email}
        </p>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {member.status === "invited" && (
        <DropdownMenuItem onClick={() => resendInvite(member)}>
          <RotateCw className="mr-2 h-4 w-4 text-purple-500" aria-hidden="true" />
          Re-send invitation
        </DropdownMenuItem>
      )}
      {member.status !== "invited" && (
        <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <UserRoundCog className="mr-2 h-4 w-4 text-slate-400" aria-hidden="true" />
          Change role
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {ROLE_OPTIONS.map((role) => (
            <DropdownMenuItem
              key={role}
              disabled={member.role === role}
              onClick={() => changeRole(member, role)}
            >
              {ROLE_META[role].label}
              {member.role === role && (
                <span className="ml-auto text-[11px] font-semibold text-purple-600 dark:text-purple-400">
                  current
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem
        disabled={member.role === "owner"}
        onClick={() => toggleStatus(member)}
      >
        {member.status === "suspended" ? (
          <>
            <CircleCheck className="mr-2 h-4 w-4 text-emerald-500" aria-hidden="true" />
            Reactivate account
          </>
        ) : (
          <>
            <CirclePause className="mr-2 h-4 w-4 text-amber-500" aria-hidden="true" />
            Suspend account
          </>
        )}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={member.role === "owner"}
        onClick={() => removeMember(member)}
        className="text-rose-600 focus:text-rose-600 dark:text-rose-400 dark:focus:text-rose-300"
      >
        <UserMinus className="mr-2 h-4 w-4" aria-hidden="true" />
        Remove user
      </DropdownMenuItem>
        </>
      )}
    </DropdownMenuContent>
  );

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col">
      {/* — Page header — */}
      <motion.section
        variants={item}
        aria-labelledby="pharmacy-users-title"
        className="flex flex-wrap items-center justify-between gap-4"
        data-tour="ph-users"
      >
        <div className="flex items-center gap-3.5">
          <span className="btn-brand flex h-12 w-12 shrink-0 items-center justify-center rounded-xl shadow-[0_8px_18px_-8px_rgba(147,51,234,0.7)]">
            <UserRoundCog className="h-6 w-6 text-white" strokeWidth={2.1} aria-hidden="true" />
          </span>
          <div>
            <h2
              id="pharmacy-users-title"
              className="text-[24px] font-bold tracking-tight text-slate-900 dark:text-white sm:text-[26px]"
            >
              User Management
            </h2>
            <p className="mt-0.5 text-[13.5px] text-slate-500 dark:text-slate-400">
              Invite your team by email and define who can do what across your stores.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setInviteOpen(true);
            void trackEvent("pharmacy_user_invite_opened");
          }}
          className="btn-brand inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(147,51,234,0.7)] transition-transform hover:scale-[1.02] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 active:scale-[0.99]"
        >
          <UserPlus className="h-[18px] w-[18px]" aria-hidden="true" />
          Invite user
        </button>
      </motion.section>

      {/* — Stat cards — */}
      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          value={String(stats.total)}
          label="Team members"
          icon={Users}
          tile="bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400"
        />
        <StatCard
          value={String(stats.active)}
          label="Active"
          icon={CircleCheck}
          tile="bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
        />
        <StatCard
          value={String(stats.invited)}
          label="Pending invitations"
          icon={Clock}
          tile="bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"
        />
        <StatCard
          value={String(stats.suspended)}
          label="Suspended"
          icon={CirclePause}
          tile="bg-rose-100 text-rose-500 dark:bg-rose-500/15 dark:text-rose-400"
        />
      </div>

      {/* — Search & filters — */}
      <motion.section variants={item} aria-label="Search and filters" className="mt-6">
        <div className={cn(pharmacyCardCls, "p-4 sm:p-5")}>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-purple-500"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search team members by name, email or phone..."
              aria-label="Search team members"
              className="h-12 w-full rounded-xl border border-transparent bg-slate-50 pl-11 pr-4 text-[14.5px] text-slate-900 outline-none transition-[border-color,box-shadow,background-color] placeholder:text-slate-400 hover:border-slate-200 focus:border-purple-400 focus:bg-white focus:ring-4 focus:ring-purple-500/10 dark:border-transparent dark:bg-white/5 dark:text-white dark:hover:border-white/10 dark:focus:border-purple-400 dark:focus:bg-white/5"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Filter by role" className="flex flex-wrap items-center gap-2">
              {filterChips.map(({ id, label }) => {
                const active = roleFilter === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setRoleFilter(id)}
                    className={cn(
                      "inline-flex h-9 items-center whitespace-nowrap rounded-full px-4 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500",
                      active
                        ? "bg-purple-600 text-white shadow-[0_6px_16px_-6px_rgba(147,51,234,0.7)]"
                        : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-purple-50 dark:bg-white/5 dark:text-slate-200 dark:ring-white/10 dark:hover:bg-white/10"
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p
              className="ml-auto text-[13.5px] text-slate-500 dark:text-slate-400"
              aria-live="polite"
            >
              {filtered.length} member{filtered.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </motion.section>

      {/* — Directory — */}
      {filtered.length === 0 ? (
        <motion.div
          variants={item}
          className={cn(
            pharmacyCardCls,
            "mt-6 flex min-h-[180px] flex-col items-center justify-center gap-3 p-8 text-center"
          )}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-white/5">
            <SearchX className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[15px] font-semibold text-slate-800 dark:text-white">
              {members.length === 0 ? "No team members yet" : "No members found"}
            </p>
            <p className="mt-1 text-[13.5px] text-slate-500 dark:text-slate-400">
              {members.length === 0
                ? "Invite your first colleague — only invitations you actually sent appear here."
                : query
                  ? `Nothing matches “${query}”. Try a different name or email.`
                  : "Adjust the role filters to see more of the team."}
            </p>
          </div>
        </motion.div>
      ) : (
        <motion.section variants={item} aria-label="Pharmacy team members" className={cn(pharmacyCardCls, "mt-6")}>
          {/* Desktop table */}
          <div className="hidden md:block">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="text-[12.5px] font-medium text-slate-500 dark:text-slate-400">
                  <th scope="col" className="py-4 pl-6 pr-3 font-medium">Member</th>
                  <th scope="col" className="px-3 py-4 font-medium">Email</th>
                  <th scope="col" className="px-3 py-4 font-medium">Role</th>
                  <th scope="col" className="px-3 py-4 font-medium">Store access</th>
                  <th scope="col" className="px-3 py-4 font-medium">Status</th>
                  <th scope="col" className="px-3 py-4 font-medium">Last active</th>
                  <th scope="col" className="w-16 py-4 pl-3 pr-6">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((member) => (
                  <tr
                    key={member.id}
                    className="group transition-colors hover:bg-slate-50/70 dark:hover:bg-white/[0.03]"
                  >
                    <td className="py-4 pl-6 pr-3">
                      <span className="flex items-center gap-3.5">
                        <Avatar name={member.name} />
                        <span className="min-w-0">
                          <span className="block truncate text-[15px] font-bold text-slate-900 dark:text-white">
                            {member.name}
                          </span>
                          {member.phone && (
                            <span className="block truncate text-[12px] text-slate-500 dark:text-slate-400">
                              {member.phone}
                            </span>
                          )}
                        </span>
                      </span>
                    </td>
                    <td className="max-w-[200px] truncate px-3 py-4 text-[14px] text-slate-500 dark:text-slate-400">
                      {member.email}
                    </td>
                    <td className="px-3 py-4">
                      <RolePill role={member.role} />
                    </td>
                    <td className="px-3 py-4">
                      <StoreAccessChips member={member} stores={stores} />
                    </td>
                    <td className="px-3 py-4">
                      <StatusBadge member={member} now={now} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-[13.5px] text-slate-500 dark:text-slate-400">
                      {member.status === "invited"
                        ? `Invited ${timeAgo(member.invitedAt, now)}`
                        : timeAgo(member.lastActive, now)}
                    </td>
                    <td className="py-4 pl-3 pr-6 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label={`Actions for ${member.name}`}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-purple-100 bg-white text-slate-400 transition-colors hover:bg-purple-50 hover:text-purple-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-purple-300"
                          >
                            <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden="true" />
                          </button>
                        </DropdownMenuTrigger>
                        {memberMenu(member)}
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="flex flex-col divide-y divide-slate-100 md:hidden dark:divide-white/5">
            {filtered.map((member) => (
              <div key={member.id} className="flex items-start gap-3 p-4">
                <Avatar name={member.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-bold text-slate-900 dark:text-white">
                    {member.name}
                  </p>
                  <p className="mt-0.5 truncate text-[13px] text-slate-500 dark:text-slate-400">
                    {member.email}
                  </p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
                    <RolePill role={member.role} />
                    <StatusBadge member={member} now={now} />
                    <StoreAccessChips member={member} stores={stores} />
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Actions for ${member.name}`}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-purple-100 bg-white text-slate-400 transition-colors hover:bg-purple-50 hover:text-purple-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:hover:bg-white/10"
                    >
                      <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                  {memberMenu(member)}
                </DropdownMenu>
              </div>
            ))}
          </div>
        </motion.section>
      )}

      {/* — Role-based access matrix — */}
      <motion.section
        variants={item}
        aria-labelledby="pharmacy-role-matrix"
        className={cn(pharmacyCardCls, "mt-6 p-5 sm:p-6")}
      >
        <div className="flex items-center gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400">
            <ShieldCheck className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
          </span>
          <div>
            <h3
              id="pharmacy-role-matrix"
              className="text-[17px] font-bold tracking-tight text-slate-900 dark:text-white"
            >
              Role-based access
            </h3>
            <p className="text-[13px] text-slate-500 dark:text-slate-400">
              What each role can do across the Pharmacy portal
            </p>
          </div>
          <span className="ml-auto hidden items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-[12px] font-semibold text-emerald-700 sm:inline-flex dark:bg-emerald-500/15 dark:text-emerald-300">
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Enforced on every sign-in
          </span>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 text-[11.5px] uppercase tracking-[0.1em] text-slate-400 dark:border-white/5">
                <th scope="col" className="py-2.5 pr-4 font-semibold">Capability</th>
                {ROLE_OPTIONS.map((role) => (
                  <th key={role} scope="col" className="w-[108px] px-2 py-2.5 text-center font-semibold">
                    {ROLE_META[role].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {CAPABILITIES.map((capability, index) => (
                <tr key={capability} className="transition-colors hover:bg-slate-50/70 dark:hover:bg-white/[0.03]">
                  <td className="py-2.5 pr-4 font-medium text-slate-700 dark:text-slate-200">
                    {capability}
                  </td>
                  {ROLE_OPTIONS.map((role) => (
                    <td key={role} className="px-2 py-2.5 text-center">
                      {ROLE_ACCESS[role][index] ? (
                        <>
                          <Check
                            className="mx-auto h-4 w-4 text-purple-600 dark:text-purple-400"
                            aria-label="Allowed"
                          />
                          <span className="sr-only">Allowed for {ROLE_META[role].label}</span>
                        </>
                      ) : (
                        <>
                          <Minus
                            className="mx-auto h-4 w-4 text-slate-300 dark:text-slate-600"
                            aria-label="Not allowed"
                          />
                          <span className="sr-only">Not allowed for {ROLE_META[role].label}</span>
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-slate-500 dark:text-slate-400">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Cashiers see stock balances read-only · invitations expire if not accepted · every invite,
          role change and suspension lands in the audit trail.
        </p>
      </motion.section>

      {/* — Invite dialog — */}
      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        stores={stores}
        existingEmails={new Set(members.map((m) => m.email.trim().toLowerCase()))}
        inviterName={actor.name || "The pharmacy team"}
        pharmacyName={pharmacyName}
        onInvite={invite}
      />

      {/* — The delivered invitation, rendered like an inbox — */}
      <EmailPreviewDialog
        message={preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        headline="Team invitation email"
      />
    </motion.div>
  );
}
