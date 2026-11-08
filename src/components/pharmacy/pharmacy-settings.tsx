"use client";

import { motion } from "framer-motion";
import {
  Bell,
  Database,
  LogOut,
  Moon,
  Settings,
  ShieldCheck,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  loadPharmacySettings,
  PHARMACY_DELIVERIES_KEY,
  PHARMACY_INVENTORY_KEY,
  PHARMACY_REQUESTS_KEY,
  PHARMACY_SETTINGS_KEY,
  savePharmacySettings,
  type PharmacySettings as Settings,
} from "@/components/pharmacy/pharmacy-data";
import { PageHeader, pharmacyCardCls } from "@/components/pharmacy/pharmacy-shared";
import { recordAudit } from "@/lib/audit-log";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";

type SettingsSectionProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  children: React.ReactNode;
};

/** Carded section with a purple tile header, matching the console language. */
function SettingsSection({ icon: Icon, title, description, children }: SettingsSectionProps) {
  return (
    <motion.section
      variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
      className={cn(pharmacyCardCls, "p-5 sm:p-6")}
      aria-labelledby={`settings-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="flex items-center gap-3.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400">
          <Icon className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3
            id={`settings-${title.toLowerCase().replace(/\s+/g, "-")}`}
            className="text-[15.5px] font-bold tracking-tight text-slate-900 dark:text-white"
          >
            {title}
          </h3>
          <p className="text-[12.5px] text-slate-500 dark:text-slate-400">{description}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </motion.section>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-slate-800 dark:text-slate-100">{label}</p>
        <p className="mt-0.5 text-[12.5px] leading-snug text-slate-500 dark:text-slate-400">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function PharmacySettings({
  user,
  dark,
  onDarkChange,
  onSignOut,
}: {
  user: { name: string; email: string };
  dark: boolean;
  onDarkChange: (on: boolean) => void;
  onSignOut: () => void;
}) {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<Settings>({
    lowStockAlerts: true,
    deliveryUpdates: true,
    requestStatus: true,
    weeklyDigest: false,
  });
  const [hydrated, setHydrated] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setPrefs(loadPharmacySettings());
      setHydrated(true);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const update = (patch: Partial<Settings>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePharmacySettings(next);
  };

  const resetData = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    for (const key of [PHARMACY_INVENTORY_KEY, PHARMACY_REQUESTS_KEY, PHARMACY_DELIVERIES_KEY, PHARMACY_SETTINGS_KEY]) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* best-effort */
      }
    }
    if (user.email) {
      recordAudit({
        title: "Workspace Data Reset",
        action: "Delete",
        detail: "Pharmacy demo stores restored to network defaults",
        actor: user.name,
        email: user.email,
      });
    }
    toast({
      title: "Workspace data reset",
      description: "Shelves, requests and deliveries are back to network defaults.",
    });
    setConfirmReset(false);
    window.location.reload();
  };

  return (
    <div aria-labelledby="pharmacy-settings-title">
      <PageHeader
        icon={Settings}
        title="Settings"
        subtitle="Preferences for this device and your pharmacy workspace"
      />
      <h2 id="pharmacy-settings-title" className="sr-only">
        Settings
      </h2>

      <motion.div
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
        initial="hidden"
        animate="show"
        className="mt-5 grid grid-cols-1 items-start gap-5 xl:grid-cols-2"
      >
        {/* Appearance */}
        <SettingsSection icon={Moon} title="Appearance" description="How the console looks on this device">
          <div className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-slate-800 dark:text-slate-100">Dark mode</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-slate-500 dark:text-slate-400">
                Easier on the eyes during late-night stock takes.
              </p>
            </div>
            <Switch checked={dark} onCheckedChange={onDarkChange} aria-label="Toggle dark mode" />
          </div>
        </SettingsSection>

        {/* Notifications */}
        <SettingsSection
          icon={Bell}
          title="Notifications"
          description="What the portal keeps you posted about"
        >
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            <ToggleRow
              label="Low stock alerts"
              hint="Ping when an item falls to its reorder level."
              checked={prefs.lowStockAlerts}
              onChange={(on) => update({ lowStockAlerts: on })}
            />
            <ToggleRow
              label="Delivery updates"
              hint="Confirmations when goods are verified and received."
              checked={prefs.deliveryUpdates}
              onChange={(on) => update({ deliveryUpdates: on })}
            />
            <ToggleRow
              label="Request status changes"
              hint="Follow your stock requests through approval and dispatch."
              checked={prefs.requestStatus}
              onChange={(on) => update({ requestStatus: on })}
            />
            <ToggleRow
              label="Weekly balance digest"
              hint="A Monday summary of stock value and movement."
              checked={prefs.weeklyDigest}
              onChange={(on) => update({ weeklyDigest: on })}
            />
          </div>
        </SettingsSection>

        {/* Session */}
        <SettingsSection
          icon={ShieldCheck}
          title="Session"
          description="Who is signed in on this device"
        >
          <div className="flex flex-wrap items-center gap-4 rounded-xl bg-slate-50 px-4 py-3.5 dark:bg-white/5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-600 to-fuchsia-600 text-[15px] font-bold text-white">
              {(user.name[0] ?? "P").toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-bold text-slate-900 dark:text-white">{user.name}</p>
              <p className="truncate text-[12.5px] text-slate-500 dark:text-slate-400">
                {user.email || "Signed in"} · Pharmacy portal
              </p>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md border border-rose-200 bg-white px-4 text-[13.5px] font-semibold text-rose-600 transition-colors hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 dark:border-rose-500/25 dark:bg-transparent dark:text-rose-400 dark:hover:bg-rose-500/10"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </button>
          </div>
          <p className="mt-3 text-[12px] text-slate-400 dark:text-slate-500">
            Preferences and adjustments stay on this device until you sign out.
          </p>
        </SettingsSection>

        {/* Data */}
        <SettingsSection
          icon={Database}
          title="Workspace data"
          description="Shelves, requests and deliveries on this device"
        >
          <div className="rounded-xl border border-rose-200/80 bg-rose-50/60 px-4 py-3.5 dark:border-rose-500/20 dark:bg-rose-500/10">
            <p className="text-[14px] font-semibold text-rose-700 dark:text-rose-300">Reset demo data</p>
            <p className="mt-0.5 text-[12.5px] leading-snug text-rose-600/90 dark:text-rose-300/80">
              Restores the network's starter shelves, request queue and delivery history. Adjustments
              you've made are lost.
            </p>
            <button
              type="button"
              onClick={resetData}
              className={cn(
                "mt-3 inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500",
                confirmReset
                  ? "bg-rose-600 text-white hover:bg-rose-700"
                  : "border border-rose-300 bg-white text-rose-600 hover:bg-rose-100 dark:border-rose-500/30 dark:bg-transparent dark:text-rose-400 dark:hover:bg-rose-500/15"
              )}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {confirmReset ? "Tap again to confirm" : "Reset workspace data"}
            </button>
          </div>
        </SettingsSection>
      </motion.div>
    </div>
  );
}
