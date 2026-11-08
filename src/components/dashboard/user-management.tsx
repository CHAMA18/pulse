"use client";

import { motion } from "framer-motion";
import {
  CircleCheck,
  CirclePause,
  MoreHorizontal,
  Search,
  SearchX,
  ShieldCheck,
  UserMinus,
  UserPlus,
  UserRoundCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/firebase";
import { EmailPreviewDialog } from "@/components/cloud/email-preview-dialog";
import {
  callCloudFunction,
  CloudFunctionError,
  type InvitationMessage,
} from "@/lib/cloud/invitations";
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

type UserRole = "owner" | "admin" | "staff";
type UserStatus = "active" | "suspended";

type PulseUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
};

type RoleFilter = "all" | "admins" | "staff";

const STORAGE_KEY = "pulse.users.v1";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ROLE_META: Record<UserRole, { label: string; pill: string }> = {
  owner: {
    label: "Owner",
    pill: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300",
  },
  admin: {
    label: "Admin",
    pill: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  },
  staff: {
    label: "Staff",
    pill: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300",
  },
};

const ROLE_OPTIONS: UserRole[] = ["owner", "admin", "staff"];

/* ------------------------------------------------------------------ */
/* Seed — mirrors the live network console                             */
/* ------------------------------------------------------------------ */

/** The six accounts every fresh console opens with, exactly as shipped. */
const SEED_USERS: PulseUser[] = [
  {
    id: "usr-seed-chungu-chama",
    name: "Chungu Chama",
    email: "chungu90@thestackone.com",
    role: "owner",
    status: "active",
  },
  {
    id: "usr-seed-chungu-chipimo",
    name: "Chungu Chipimo Chama",
    email: "chungu424@gmail.com",
    role: "owner",
    status: "active",
  },
  {
    id: "usr-seed-e2e-po",
    name: "E2E PO",
    email: "popo1790656699@uberip.com",
    role: "owner",
    status: "active",
  },
  {
    id: "usr-seed-grimp",
    name: "GRImp Owner",
    email: "grimp1790659419@uberip.com",
    role: "owner",
    status: "active",
  },
  {
    id: "usr-seed-mwansa-chalo",
    name: "Mwansa Chalo",
    email: "mwansachalo@gmail.com",
    role: "owner",
    status: "active",
  },
  {
    id: "usr-seed-mwansa-mwale",
    name: "Mwansa Mwale",
    email: "mwansamwale@gmail.com",
    role: "owner",
    status: "active",
  },
];

function loadUsers(): PulseUser[] {
  if (typeof window === "undefined") return SEED_USERS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return SEED_USERS;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return SEED_USERS;
    return parsed.filter(
      (u): u is PulseUser =>
        !!u &&
        typeof u === "object" &&
        typeof (u as PulseUser).name === "string" &&
        typeof (u as PulseUser).email === "string"
    );
  } catch {
    return SEED_USERS;
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `usr-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `usr-${Date.now().toString(36)}`;
}

function initialOf(name: string): string {
  return (name.trim()[0] ?? "P").toUpperCase();
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

const cardCls =
  "rounded-2xl bg-white shadow-[0_1px_3px_rgba(88,28,135,0.06),0_10px_28px_-18px_rgba(88,28,135,0.14)] dark:bg-white/[0.045] dark:shadow-none dark:ring-1 dark:ring-white/10";

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
    <motion.div
      variants={item}
      className={cn(cardCls, "flex items-center gap-4 p-5")}
    >
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

function RolePill({ role }: { role: UserRole }) {
  const meta = ROLE_META[role];
  return (
    <span
      className={cn(
        "inline-flex w-28 items-center justify-center rounded-lg px-3 py-1.5 text-[12.5px] font-semibold",
        meta.pill
      )}
    >
      {meta.label}
    </span>
  );
}

function StatusBadge({ status }: { status: UserStatus }) {
  const active = status === "active";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-[13.5px] font-medium",
        active
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-rose-500 dark:text-rose-400"
      )}
    >
      <span
        aria-hidden="true"
        className={cn("h-2 w-2 rounded-full", active ? "bg-emerald-500" : "bg-rose-500")}
      />
      {active ? "Active" : "Suspended"}
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
/* Add-user dialog                                                     */
/* ------------------------------------------------------------------ */

function AddUserDialog({
  open,
  onOpenChange,
  existingEmails,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingEmails: Set<string>;
  onAdd: (user: { name: string; email: string; role: UserRole }) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("staff");
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setName("");
    setEmail("");
    setRole("staff");
    setError(null);
    onOpenChange(false);
  };

  const submit = () => {
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanName) {
      setError("Please enter the user's full name.");
      return;
    }
    if (!EMAIL_RE.test(cleanEmail)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (existingEmails.has(cleanEmail)) {
      setError("An account with this email already exists.");
      return;
    }
    onAdd({ name: cleanName, email: cleanEmail, role });
    close();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setName("");
          setEmail("");
          setRole("staff");
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Add Pulse user</DialogTitle>
          <DialogDescription>
            Grant someone access to this network. They can sign in with the
            email you provide.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          <div className="grid gap-1.5">
            <label
              htmlFor="add-user-name"
              className="text-[13px] font-semibold text-slate-700 dark:text-slate-200"
            >
              Full name
            </label>
            <input
              id="add-user-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Chanda Bwalya"
              autoComplete="off"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[14px] text-slate-900 outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/10 dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus:border-purple-400"
            />
          </div>

          <div className="grid gap-1.5">
            <label
              htmlFor="add-user-email"
              className="text-[13px] font-semibold text-slate-700 dark:text-slate-200"
            >
              Email address
            </label>
            <input
              id="add-user-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              autoComplete="off"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[14px] text-slate-900 outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/10 dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus:border-purple-400"
            />
          </div>

          <div className="grid gap-1.5">
            <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">
              Role
            </span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Role">
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
                      "inline-flex h-9 items-center rounded-full px-4 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500",
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
          </div>

          {error && (
            <p className="text-[13px] font-medium text-rose-600 dark:text-rose-400" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <button
            type="button"
            onClick={close}
            className="h-10 rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="btn-brand inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(147,51,234,0.7)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Add user
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function UserManagement() {
  const { toast } = useToast();

  const [users, setUsers] = useState<PulseUser[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  const [addOpen, setAddOpen] = useState(false);
  // The delivered console invitation, rendered in the inbox-style preview.
  const [preview, setPreview] = useState<InvitationMessage | null>(null);
  const [inviter, setInviter] = useState("Pulse Network");

  // The signed-in identity signs the invitation email.
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
      if (active) {
        setInviter(
          auth?.currentUser?.displayName ??
            auth?.currentUser?.email?.split("@")[0] ??
            "Pulse Network"
        );
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Hydrate once on mount, then persist every change. Deferred to a frame
  // so we never setState synchronously inside the effect body.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setUsers(loadUsers());
      setHydrated(true);
    });
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(users));
    } catch {
      /* storage full or unavailable — in-memory state still works */
    }
  }, [users, hydrated]);

  /* ---------------- derived data ---------------- */

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = users.filter((u) => {
      if (roleFilter === "admins" && u.role !== "owner" && u.role !== "admin")
        return false;
      if (roleFilter === "staff" && u.role !== "staff") return false;
      if (!q) return true;
      return `${u.name} ${u.email}`.toLowerCase().includes(q);
    });
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [users, query, roleFilter]);

  const stats = useMemo(() => {
    let owners = 0;
    let active = 0;
    let suspended = 0;
    for (const u of users) {
      if (u.role === "owner") owners += 1;
      if (u.status === "active") active += 1;
      else suspended += 1;
    }
    return { total: users.length, owners, active, suspended };
  }, [users]);

  /* ---------------- mutations ---------------- */

  const changeRole = (user: PulseUser, role: UserRole) => {
    if (user.role === role) return;
    setUsers((prev) =>
      prev.map((u) => (u.id === user.id ? { ...u, role } : u))
    );
    toast({
      title: "Role updated",
      description: `${user.name} is now ${ROLE_META[role].label === "Owner" ? "an" : "a"} ${ROLE_META[role].label.toLowerCase()} on this network.`,
    });
    void trackEvent("user_role_changed", { to: role });
  };

  const toggleStatus = (user: PulseUser) => {
    const next: UserStatus = user.status === "active" ? "suspended" : "active";
    setUsers((prev) =>
      prev.map((u) => (u.id === user.id ? { ...u, status: next } : u))
    );
    toast({
      title: next === "suspended" ? "Account suspended" : "Account reactivated",
      description:
        next === "suspended"
          ? `${user.name} can no longer sign in until reactivated.`
          : `${user.name} has access to the network again.`,
    });
    void trackEvent("user_status_changed", { to: next });
  };

  const removeUser = (user: PulseUser) => {
    setUsers((prev) => prev.filter((u) => u.id !== user.id));
    toast({
      title: "User removed",
      description: `${user.name} no longer has access to this network.`,
    });
    void trackEvent("user_removed");
  };

  const addUser = ({ name, email, role }: { name: string; email: string; role: UserRole }) => {
    setUsers((prev) => [...prev, { id: newId(), name, email, role, status: "active" }]);
    toast({
      title: "User added",
      description: `${name} was granted ${ROLE_META[role].label.toLowerCase()} access to the network.`,
    });
    void trackEvent("user_added", { role });

    // Trigger the sendPulseAdminInvite cloud function — a branded email
    // lands in their inbox and opens here for a final look.
    void callCloudFunction("sendPulseAdminInvite", {
      inviterName: inviter,
      inviteeName: name,
      inviteeEmail: email,
      role: ROLE_META[role].label,
    })
      .then(({ messages }) => setPreview(messages[0] ?? null))
      .catch((err: unknown) => {
        const code = err instanceof CloudFunctionError ? err.code : "unknown";
        toast({
          title: "Email delivery failed",
          description: `The cloud function rejected the invitation (${code}). The account exists — resend from the row menu.`,
        });
      });
  };

  /* ---------------- render ---------------- */

  const filterChips: { id: RoleFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "admins", label: "Admins" },
    { id: "staff", label: "Staff" },
  ];

  const userMenu = (user: PulseUser) => (
    <DropdownMenuContent align="end" className="w-52">
      <DropdownMenuLabel>
        <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
          {user.name}
        </p>
        <p className="truncate text-xs font-normal text-slate-500 dark:text-slate-400">
          {user.email}
        </p>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <UserRoundCog className="mr-2 h-4 w-4 text-slate-400" aria-hidden="true" />
          Change role
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {ROLE_OPTIONS.map((role) => (
            <DropdownMenuItem
              key={role}
              disabled={user.role === role}
              onClick={() => changeRole(user, role)}
            >
              Make {ROLE_META[role].label.toLowerCase()}
              {user.role === role && (
                <span className="ml-auto text-[11px] font-semibold text-purple-600 dark:text-purple-400">
                  current
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem onClick={() => toggleStatus(user)}>
        {user.status === "active" ? (
          <>
            <CirclePause className="mr-2 h-4 w-4 text-amber-500" aria-hidden="true" />
            Suspend account
          </>
        ) : (
          <>
            <CircleCheck className="mr-2 h-4 w-4 text-emerald-500" aria-hidden="true" />
            Reactivate account
          </>
        )}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={() => removeUser(user)}
        className="text-rose-600 focus:text-rose-600 dark:text-rose-400 dark:focus:text-rose-300"
      >
        <UserMinus className="mr-2 h-4 w-4" aria-hidden="true" />
        Remove user
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col" data-tour="pulse-users">
      {/* — Page header — */}
      <motion.section
        variants={item}
        aria-labelledby="user-management-title"
        className="flex flex-wrap items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3.5">
          <span className="btn-brand flex h-12 w-12 shrink-0 items-center justify-center rounded-xl shadow-[0_8px_18px_-8px_rgba(147,51,234,0.7)]">
            <UserRoundCog className="h-6 w-6 text-white" strokeWidth={2.1} aria-hidden="true" />
          </span>
          <div>
            <h1
              id="user-management-title"
              className="text-[24px] font-bold tracking-tight text-slate-900 dark:text-white sm:text-[26px]"
            >
              User Management
            </h1>
            <p className="mt-0.5 text-[13.5px] text-slate-500 dark:text-slate-400">
              Control network access, roles, and account status.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setAddOpen(true);
            void trackEvent("user_add_opened");
          }}
          className="btn-brand inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(147,51,234,0.7)] transition-transform hover:scale-[1.02] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 active:scale-[0.99]"
        >
          <UserPlus className="h-[18px] w-[18px]" aria-hidden="true" />
          Add Pulse user
        </button>
      </motion.section>

      {/* — Stat cards — */}
      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          value={String(stats.total)}
          label="Total accounts"
          icon={Users}
          tile="bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400"
        />
        <StatCard
          value={String(stats.owners)}
          label="Owners"
          icon={ShieldCheck}
          tile="bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400"
        />
        <StatCard
          value={String(stats.active)}
          label="Active"
          icon={CircleCheck}
          tile="bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
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
        <div className={cn(cardCls, "p-4 sm:p-5")}>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-purple-500"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Pulse users by name or email..."
              aria-label="Search Pulse users"
              className="h-12 w-full rounded-xl border border-transparent bg-slate-50 pl-11 pr-4 text-[14.5px] text-slate-900 outline-none transition-[border-color,box-shadow,background-color] placeholder:text-slate-400 hover:border-slate-200 focus:border-purple-400 focus:bg-white focus:ring-4 focus:ring-purple-500/10 dark:border-transparent dark:bg-white/5 dark:text-white dark:hover:border-white/10 dark:focus:border-purple-400 dark:focus:bg-white/5"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by role">
              {filterChips.map(({ id, label }) => {
                const active = roleFilter === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setRoleFilter(id)}
                    className={cn(
                      "inline-flex h-10 items-center rounded-full px-5 text-[13.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500",
                      active
                        ? "bg-purple-600 text-white shadow-[0_6px_16px_-6px_rgba(147,51,234,0.7)]"
                        : "bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 hover:bg-purple-50 dark:bg-white/5 dark:text-slate-200 dark:ring-white/10 dark:hover:bg-white/10"
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
              {filtered.length} user{filtered.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </motion.section>

      {/* — Directory — */}
      {filtered.length === 0 ? (
        <motion.div
          variants={item}
          className={cn(
            cardCls,
            "mt-6 flex min-h-[180px] flex-col items-center justify-center gap-3 p-8 text-center"
          )}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-white/5">
            <SearchX className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[15px] font-semibold text-slate-800 dark:text-white">
              No users found
            </p>
            <p className="mt-1 text-[13.5px] text-slate-500 dark:text-slate-400">
              {query
                ? `Nothing matches “${query}”. Try a different name or email.`
                : roleFilter === "staff"
                  ? "No staff accounts yet — add one with “Add Pulse user”."
                  : roleFilter === "admins"
                    ? "No admin-level accounts match this view."
                    : "Adjust the filters to see more of the directory."}
            </p>
          </div>
        </motion.div>
      ) : (
        <motion.section variants={item} aria-label="Pulse users" className={cn(cardCls, "mt-6")}>
          {/* Desktop table */}
          <div className="hidden md:block">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="text-[12.5px] font-medium text-slate-500 dark:text-slate-400">
                  <th scope="col" className="py-4 pl-6 pr-3 font-medium">Name</th>
                  <th scope="col" className="px-3 py-4 font-medium">Email</th>
                  <th scope="col" className="px-3 py-4 font-medium">Role</th>
                  <th scope="col" className="px-3 py-4 font-medium">Status</th>
                  <th scope="col" className="w-16 py-4 pl-3 pr-6">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => (
                  <tr
                    key={user.id}
                    className="group transition-colors hover:bg-slate-50/70 dark:hover:bg-white/[0.03]"
                  >
                    <td className="py-4 pl-6 pr-3">
                      <span className="flex items-center gap-3.5">
                        <Avatar name={user.name} />
                        <span className="truncate text-[15px] font-bold text-slate-900 dark:text-white">
                          {user.name}
                        </span>
                      </span>
                    </td>
                    <td className="max-w-[240px] truncate px-3 py-4 text-[14px] text-slate-500 dark:text-slate-400">
                      {user.email}
                    </td>
                    <td className="px-3 py-4">
                      <RolePill role={user.role} />
                    </td>
                    <td className="px-3 py-4">
                      <StatusBadge status={user.status} />
                    </td>
                    <td className="py-4 pl-3 pr-6 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label={`Actions for ${user.name}`}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-purple-100 bg-white text-slate-400 transition-colors hover:bg-purple-50 hover:text-purple-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-purple-300"
                          >
                            <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden="true" />
                          </button>
                        </DropdownMenuTrigger>
                        {userMenu(user)}
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="flex flex-col divide-y divide-slate-100 md:hidden dark:divide-white/5">
            {filtered.map((user) => (
              <div key={user.id} className="flex items-start gap-3 p-4">
                <Avatar name={user.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-bold text-slate-900 dark:text-white">
                    {user.name}
                  </p>
                  <p className="mt-0.5 truncate text-[13px] text-slate-500 dark:text-slate-400">
                    {user.email}
                  </p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-3">
                    <RolePill role={user.role} />
                    <StatusBadge status={user.status} />
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Actions for ${user.name}`}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-purple-100 bg-white text-slate-400 transition-colors hover:bg-purple-50 hover:text-purple-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:hover:bg-white/10"
                    >
                      <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                  {userMenu(user)}
                </DropdownMenu>
              </div>
            ))}
          </div>
        </motion.section>
      )}

      {/* — dialogs — */}
      <AddUserDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        existingEmails={new Set(users.map((u) => u.email.trim().toLowerCase()))}
        onAdd={addUser}
      />

      {/* — the delivered console invitation — */}
      <EmailPreviewDialog
        message={preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        headline="Pulse console invitation email"
      />
    </motion.div>
  );
}
