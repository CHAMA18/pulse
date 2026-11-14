"use client";

import {
  AlertCircle,
  Check,
  Copy,
  KeyRound,
  Loader2,
  MapPin,
  ShieldCheck,
  Store,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createPharmacyProvisioning,
  type CreatedPharmacyProvisioning,
} from "@/lib/cloud/pharmacy-provisioning";
import { CloudFunctionError } from "@/lib/cloud/invitations";
import { cn } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputCls =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[14px] text-slate-900 outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 hover:border-slate-300 focus:border-purple-400 focus:ring-4 focus:ring-purple-500/10 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:border-white/20";

export function CreatePharmacyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (result: CreatedPharmacyProvisioning) => void;
}) {
  const [pharmacyName, setPharmacyName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<CreatedPharmacyProvisioning | null>(null);
  const [copied, setCopied] = useState(false);

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setPharmacyName("");
      setOwnerName("");
      setOwnerEmail("");
      setAddress("");
      setPhone("");
      setError(null);
      setSaving(false);
      setResult(null);
      setCopied(false);
    }
  }

  const copyOtp = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.otp);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy automatically. Select the code and copy it manually.");
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;

    if (pharmacyName.trim().length < 2) {
      setError("Enter the pharmacy's name.");
      return;
    }
    if (ownerName.trim().length < 2) {
      setError("Enter the owner's full name.");
      return;
    }
    if (!EMAIL_RE.test(ownerEmail.trim())) {
      setError("That owner email doesn't look right.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const created = await createPharmacyProvisioning({
        pharmacyName: pharmacyName.trim(),
        ownerName: ownerName.trim(),
        ownerEmail: ownerEmail.trim(),
        address: address.trim(),
        phone: phone.trim(),
      });
      setResult(created);
      onCreated?.(created);
    } catch (err) {
      setError(
        err instanceof CloudFunctionError && err.message
          ? err.message
          : "The pharmacy profile couldn't be created. Check the connection and try again."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px]">
        {result ? (
          <>
            <DialogHeader>
              <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
                <ShieldCheck className="h-6 w-6" aria-hidden="true" />
              </span>
              <DialogTitle>Pharmacy profile created</DialogTitle>
              <DialogDescription>
                {result.pharmacyName} is ready. Give this one-time code to{" "}
                {result.ownerEmail} so the owner can activate the account.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-2 rounded-2xl border border-purple-200 bg-purple-50/70 p-4 dark:border-purple-400/30 dark:bg-purple-500/10">
              <div className="flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-[0.16em] text-purple-600 dark:text-purple-300">
                <KeyRound className="h-4 w-4" aria-hidden="true" />
                One-time password
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <code className="select-all font-mono text-[24px] font-bold tracking-[0.08em] text-purple-900 dark:text-white">
                  {result.otp}
                </code>
                <button
                  type="button"
                  onClick={copyOtp}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-purple-200 bg-white px-3 text-[12.5px] font-semibold text-purple-700 transition-colors hover:bg-purple-50 dark:border-purple-400/30 dark:bg-white/5 dark:text-purple-200 dark:hover:bg-white/10"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-emerald-500" aria-hidden="true" />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  )}
                  {copied ? "Copied" : "Copy OTP"}
                </button>
              </div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-purple-700/80 dark:text-purple-200/75">
                Valid until{" "}
                {new Date(result.expiresAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                . This code is shown once — copy it before closing.
              </p>
            </div>

            <div className="mt-3 rounded-xl bg-slate-50 p-3.5 text-[12.5px] leading-relaxed text-slate-600 dark:bg-white/5 dark:text-slate-300">
              <p className="font-semibold text-slate-800 dark:text-slate-100">How the owner activates it</p>
              <ol className="mt-1.5 list-decimal space-y-1 pl-4">
                <li>Open the Pulse login page and choose “Have a pharmacy OTP?”.</li>
                <li>Enter this code, then choose a password.</li>
                <li>The pharmacy profile goes live automatically.</li>
              </ol>
            </div>

            {error && (
              <p role="alert" className="flex items-center gap-1.5 text-[12.5px] text-rose-600">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                {error}
              </p>
            )}

            <DialogFooter>
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setPharmacyName("");
                  setOwnerName("");
                  setOwnerEmail("");
                  setAddress("");
                  setPhone("");
                  setCopied(false);
                  setError(null);
                }}
                className="h-10 rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
              >
                Create another
              </button>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="h-10 rounded-md bg-purple-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-purple-700"
              >
                Done
              </button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400">
                <Store className="h-6 w-6" aria-hidden="true" />
              </span>
              <DialogTitle>Create a pharmacy profile</DialogTitle>
              <DialogDescription>
                Pulse creates the profile and a one-time password. The pharmacy only
                needs that OTP to validate the account and set its password.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={submit} className="space-y-3.5">
              <label className="block">
                <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">
                  <Store className="h-3.5 w-3.5 text-purple-500" aria-hidden="true" />
                  Pharmacy name
                </span>
                <input
                  autoFocus
                  value={pharmacyName}
                  onChange={(event) => {
                    setPharmacyName(event.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="e.g. Riverside Pharmacy"
                  className={inputCls}
                />
              </label>

              <div className="grid gap-3.5 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">
                    <UserRound className="h-3.5 w-3.5 text-purple-500" aria-hidden="true" />
                    Owner name
                  </span>
                  <input
                    value={ownerName}
                    onChange={(event) => {
                      setOwnerName(event.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="Full name"
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">
                    <KeyRound className="h-3.5 w-3.5 text-purple-500" aria-hidden="true" />
                    Owner email
                  </span>
                  <input
                    type="email"
                    inputMode="email"
                    value={ownerEmail}
                    onChange={(event) => {
                      setOwnerEmail(event.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="owner@pharmacy.com"
                    className={inputCls}
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">
                  <MapPin className="h-3.5 w-3.5 text-purple-500" aria-hidden="true" />
                  Address <span className="font-normal text-slate-400">(optional)</span>
                </span>
                <input
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  placeholder="Street, city"
                  className={inputCls}
                />
              </label>

              <label className="block">
                <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">
                  Phone <span className="font-normal text-slate-400">(optional)</span>
                </span>
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+260 97 000 0000"
                  className={inputCls}
                />
              </label>

              {error && (
                <p
                  role="alert"
                  className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {error}
                </p>
              )}

              <DialogFooter className={cn("mt-1")}>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  disabled={saving}
                  className="h-10 rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-purple-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {saving ? "Creating…" : "Create and generate OTP"}
                </button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
