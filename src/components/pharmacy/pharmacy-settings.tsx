"use client";

import { motion } from "framer-motion";
import {
  Bell,
  LogOut,
  Moon,
  Settings as SettingsIcon,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  loadPharmacySettings,
  savePharmacySettings,
  type PharmacySettings as Settings,
} from "@/components/pharmacy/pharmacy-data";
import { PageHeader, pharmacyCardCls } from "@/components/pharmacy/pharmacy-shared";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";

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
  const [prefs, setPrefs] = useState<Settings>({
    lowStockAlerts: true,
    lowStockThreshold: 10,
    lowStockAlertEmail: "",
    deliveryUpdates: true,
    requestStatus: true,
    weeklyDigest: false,
  });

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setPrefs(loadPharmacySettings());
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const update = (patch: Partial<Settings>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePharmacySettings(next);
  };

  return (
    <div aria-labelledby="pharmacy-settings-title">
      <PageHeader
        icon={SettingsIcon}
        title="Settings"
        subtitle="Preferences for this device and your pharmacy workspace"
        tourId="ph-settings"
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
            <div>
              <ToggleRow
                label="Low stock alerts"
                hint="Email one consolidated alert when items reach the trigger limit."
                checked={prefs.lowStockAlerts}
                onChange={(on) => update({ lowStockAlerts: on })}
              />
              {prefs.lowStockAlerts && (
                <div className="mb-3 grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-3.5 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] dark:bg-white/5">
                  <label className="block min-w-0">
                    <span className="block text-[11px] font-bold uppercase tracking-[0.09em] text-slate-500 dark:text-slate-400">
                      Trigger limit
                    </span>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={String(prefs.lowStockThreshold)}
                      onChange={(event) => {
                        const next = Math.max(0, Math.round(Number(event.target.value) || 0));
                        update({ lowStockThreshold: next });
                      }}
                      aria-label="Low stock trigger limit in units"
                      className="mt-1.5"
                    />                      <span className="mt-1 block text-[11.5px] leading-snug text-slate-400 dark:text-slate-500">
                      Units on hand that trigger the alert. A store can set its own limit on the
                      Stores page, and items whose reorder level is higher alert at that level
                      instead.
                    </span>
                  </label>
                  <label className="block min-w-0">
                    <span className="block text-[11px] font-bold uppercase tracking-[0.09em] text-slate-500 dark:text-slate-400">
                      Send alerts to
                    </span>
                    <Input
                      type="text"
                      inputMode="email"
                      value={prefs.lowStockAlertEmail}
                      placeholder={user.email || "you@pharmacy.com, owner@pharmacy.com"}
                      onChange={(event) => update({ lowStockAlertEmail: event.target.value })}
                      aria-label="Low stock alert email addresses"
                      className="mt-1.5"
                    />
                    <span className="mt-1 block text-[11.5px] leading-snug text-slate-400 dark:text-slate-500">
                      One email lists every triggered item and goes to each address — separate
                      several with commas. Leave blank to use your sign-in email.
                    </span>
                  </label>
                </div>
              )}
            </div>
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

      </motion.div>
    </div>
  );
}
