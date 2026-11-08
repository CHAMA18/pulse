"use client";

import { motion } from "framer-motion";
import {
  Building2,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  Mail,
  ShieldQuestion,
  UserRound,
} from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import {
  PageHeader,
  pharmacyCardCls,
} from "@/components/pharmacy/pharmacy-shared";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  getFirebaseDb,
  getPharmacyRegistrations,
} from "@/lib/firebase";

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

type PharmacyProfileData = {
  pharmacyName: string;
  ownerName: string;
  email: string;
  uid: string;
  /** Registration timestamp, if known. */
  registeredAt: number | null;
  /** true = approved on the network; false/undefined = pending review. */
  approved: boolean | null;
  source: "registration" | "firestore" | "session";
};

type StepState = "done" | "pending";

const STEPS: { title: string; desc: string }[] = [
  { title: "Account created", desc: "Your pharmacy account is live on Pulse." },
  { title: "Profile submitted", desc: "Pharmacy name and ownership are on file." },
  { title: "Network review", desc: "The Pulse network team verifies your pharmacy." },
  { title: "Shelf go-live", desc: "Your storefront joins the Pulse network." },
];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function PharmacyProfile({
  user,
}: {
  user: { name: string; email: string; initial: string };
}) {
  const { toast } = useToast();

  const [profile, setProfile] = useState<PharmacyProfileData | null>(null);
  const [loading, setLoading] = useState(true);

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
      const email = current?.email ?? user.email;
      const uid = current?.uid ?? "";

      // 1. Local registration registry (the device that registered knows best)
      const registration = getPharmacyRegistrations().find(
        (r) => (uid && r.uid === uid) || (email && r.email === email.toLowerCase())
      );

      // 2. The Firestore User profile — same document the network console reads
      let firestoreProfile: { pharmacy_name?: string; approved_by_duniya?: boolean } | null = null;
      const store = getFirebaseDb();
      if (store && uid) {
        try {
          const snap = await getDoc(doc(store, "User", uid));
          const data = snap.data() as
            | { pharmacy_name?: string; approved_by_duniya?: boolean }
            | undefined;
          if (data) firestoreProfile = data;
        } catch {
          /* rules or offline — the registry and session still cover the page */
        }
      }

      if (!active) return;

      setProfile({
        pharmacyName:
          registration?.pharmacyName ?? firestoreProfile?.pharmacy_name ?? user.name,
        ownerName: registration?.ownerName ?? user.name,
        email,
        uid,
        registeredAt: registration ? new Date(registration.at).getTime() : null,
        approved:
          registration !== undefined
            ? Boolean(firestoreProfile?.approved_by_duniya) // self-registered → pending until approved
            : (firestoreProfile?.approved_by_duniya ?? null),
        source: registration ? "registration" : firestoreProfile ? "firestore" : "session",
      });
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [user.email, user.name]);

  const copyUid = () => {
    if (!profile?.uid) return;
    void navigator.clipboard
      ?.writeText(profile.uid)
      .then(() => toast({ title: "Copied", description: "Pharmacy ID copied to clipboard." }))
      .catch(() => toast({ title: "Couldn't copy", description: "Copy it manually instead." }));
  };

  const stepStates: StepState[] = profile
    ? [
        "done",
        profile.source === "session" ? "pending" : "done",
        profile.approved === true ? "done" : "pending",
        profile.approved === true ? "done" : "pending",
      ]
    : ["pending", "pending", "pending", "pending"];

  return (
    <div aria-labelledby="pharmacy-profile-title">
      <PageHeader
        icon={Building2}
        title="My Pharmacy"
        subtitle="Registration details and network status"
      />
      <h2 id="pharmacy-profile-title" className="sr-only">
        My Pharmacy
      </h2>

      {loading ? (
        <div className={cn(pharmacyCardCls, "mt-5 flex min-h-[160px] items-center justify-center gap-2.5 text-[13.5px] text-slate-500 dark:text-slate-400")}>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading your pharmacy profile…
        </div>
      ) : profile ? (
        <div className="mt-5 grid grid-cols-1 gap-6 xl:grid-cols-2">
          {/* Profile card */}
          <motion.section
            variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
            className={cn(pharmacyCardCls, "p-6")}
          >
            <div className="flex items-start gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-fuchsia-600 text-[20px] font-bold text-white shadow-[0_10px_24px_-10px_rgba(147,51,234,0.7)]">
                {(profile.pharmacyName[0] ?? "P").toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h3 className="truncate text-[18px] font-bold tracking-tight text-slate-900 dark:text-white">
                    {profile.pharmacyName}
                  </h3>
                  {profile.approved === true ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Active
                    </span>
                  ) : profile.approved === false ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-[11.5px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      Pending network review
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-2.5 py-1 text-[11.5px] font-semibold text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                      <ShieldQuestion className="h-3.5 w-3.5" aria-hidden="true" />
                      On file
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
                  {profile.source === "registration"
                    ? "Registered on this device through the Pharmacy portal."
                    : profile.source === "firestore"
                      ? "Provisioned by the Pulse network."
                      : "Session profile — no pharmacy registration found yet."}
                </p>
              </div>
            </div>

            <dl className="mt-6 flex flex-col gap-4 text-[13.5px]">
              <div className="flex items-center gap-3">
                <UserRound className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <dt className="w-24 shrink-0 text-slate-500 dark:text-slate-400">Owner</dt>
                <dd className="min-w-0 truncate font-semibold text-slate-900 dark:text-white">
                  {profile.ownerName}
                </dd>
              </div>
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <dt className="w-24 shrink-0 text-slate-500 dark:text-slate-400">Email</dt>
                <dd className="min-w-0 truncate font-semibold text-slate-900 dark:text-white">
                  {profile.email || "—"}
                </dd>
              </div>
              <div className="flex items-center gap-3">
                <Building2 className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <dt className="w-24 shrink-0 text-slate-500 dark:text-slate-400">Pharmacy ID</dt>
                <dd className="flex min-w-0 items-center gap-2">
                  <code className="truncate rounded bg-slate-100 px-2 py-0.5 font-mono text-[12px] text-slate-600 dark:bg-white/10 dark:text-slate-300">
                    {profile.uid ? `${profile.uid.slice(0, 12)}…` : "—"}
                  </code>
                  {profile.uid && (
                    <button
                      type="button"
                      onClick={copyUid}
                      className="text-[12px] font-semibold text-purple-600 hover:underline dark:text-purple-400"
                    >
                      Copy
                    </button>
                  )}
                </dd>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <dt className="w-24 shrink-0 text-slate-500 dark:text-slate-400">Registered</dt>
                <dd className="font-semibold text-slate-900 dark:text-white">
                  {profile.registeredAt
                    ? new Date(profile.registeredAt).toLocaleDateString("en-US", {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })
                    : "—"}
                </dd>
              </div>
            </dl>
          </motion.section>

          {/* Onboarding checklist */}
          <motion.section
            variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
            className={cn(pharmacyCardCls, "p-6")}
          >
            <h3 className="text-[16px] font-bold tracking-tight text-slate-900 dark:text-white">
              Onboarding progress
            </h3>
            <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
              Where your pharmacy stands on its way to go-live.
            </p>

            <ol className="mt-5 flex flex-col">
              {STEPS.map((step, index) => {
                const state = stepStates[index];
                return (
                  <li key={step.title} className="relative flex gap-3.5 pb-6 last:pb-0">
                    {/* connector */}
                    {index < STEPS.length - 1 && (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-px",
                          state === "done" && stepStates[index + 1] === "done"
                            ? "bg-purple-400"
                            : "bg-slate-200 dark:bg-white/10"
                        )}
                      />
                    )}
                    <span
                      className={cn(
                        "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                        state === "done"
                          ? "bg-purple-600 text-white shadow-[0_4px_12px_-4px_rgba(147,51,234,0.8)]"
                          : "border-2 border-dashed border-slate-300 bg-white text-slate-300 dark:border-white/20 dark:bg-transparent dark:text-slate-500"
                      )}
                    >
                      {state === "done" ? (
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Circle className="h-3 w-3" aria-hidden="true" />
                      )}
                    </span>
                    <div className="min-w-0 pt-0.5">
                      <p
                        className={cn(
                          "text-[14px] font-semibold",
                          state === "done"
                            ? "text-slate-900 dark:text-white"
                            : "text-slate-500 dark:text-slate-400"
                        )}
                      >
                        {step.title}
                      </p>
                      <p className="mt-0.5 text-[12.5px] text-slate-500 dark:text-slate-400">
                        {step.desc}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>

            {profile.approved !== true && (
              <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-[13px] leading-relaxed text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
                <span className="font-semibold">What happens next?</span> The Pulse network team
                reviews new pharmacies within two business days. You can keep managing inventory and
                requesting stock in the meantime — approved shelves go live automatically.
              </div>
            )}
          </motion.section>
        </div>
      ) : null}
    </div>
  );
}
