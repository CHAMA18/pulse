"use client";

import { CheckCircle2, Download, Mail } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { downloadEml, type InvitationMessage } from "@/lib/cloud/invitations";

/* ------------------------------------------------------------------ */
/* Email preview — an inbox-grade look at the invitation               */
/* ------------------------------------------------------------------ */
/* Renders the exact HTML the cloud function would deliver, framed     */
/* like a mail client (From / To / Subject) with a real .eml export.   */

export function EmailPreviewDialog({
  message,
  onOpenChange,
  headline,
}: {
  message: InvitationMessage | null;
  onOpenChange: (open: boolean) => void;
  headline?: string;
}) {
  return (
    <Dialog open={Boolean(message)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94dvh] overflow-hidden rounded-2xl bg-[#f3effc] p-0 sm:max-w-[720px] dark:bg-[#150b2b]">
        {message && (
          <div className="flex max-h-[94dvh] flex-col">
            <DialogHeader className="shrink-0 space-y-1 border-b border-slate-200/70 bg-white/80 px-6 py-4 backdrop-blur dark:border-white/10 dark:bg-transparent">
              <DialogTitle className="flex items-center gap-2 text-[16px] font-bold tracking-tight text-slate-900 dark:text-white">
                <Mail className="h-4 w-4 text-purple-600 dark:text-purple-400" aria-hidden="true" />
                {headline ?? "Invitation email"}
              </DialogTitle>
              <DialogDescription className="text-[12.5px] text-slate-500 dark:text-slate-400">
                Rendered exactly as the cloud function delivers it — download the .eml to see it in
                your own mail client.
              </DialogDescription>
            </DialogHeader>

            {/* Client chrome */}
            <div className="shrink-0 border-b border-slate-200/70 px-6 py-3.5 text-[12.5px] dark:border-white/10">
              <div className="flex gap-2">
                <span className="w-14 shrink-0 font-semibold text-slate-400 dark:text-slate-500">From</span>
                <span className="min-w-0 truncate font-medium text-slate-800 dark:text-slate-200">{message.from}</span>
              </div>
              <div className="mt-1 flex gap-2">
                <span className="w-14 shrink-0 font-semibold text-slate-400 dark:text-slate-500">To</span>
                <span className="min-w-0 truncate font-medium text-slate-800 dark:text-slate-200">{message.to.join(", ")}</span>
              </div>
              <div className="mt-1 flex gap-2">
                <span className="w-14 shrink-0 font-semibold text-slate-400 dark:text-slate-500">Subject</span>
                <span className="min-w-0 truncate font-bold text-slate-900 dark:text-white">{message.subject}</span>
              </div>
            </div>

            {/* The email itself */}
            <div className="min-h-[320px] flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              <iframe
                title={`Preview of ${message.subject}`}
                sandbox=""
                srcDoc={message.html}
                className="h-[52dvh] min-h-[320px] w-full rounded-xl border border-slate-200/70 bg-white shadow-[0_14px_40px_-18px_rgba(76,29,149,0.4)] dark:border-white/10"
              />
            </div>

            {/* Actions */}
            <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-slate-200/70 bg-white/80 px-6 py-3.5 backdrop-blur dark:border-white/10 dark:bg-transparent">
              <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Delivered via {message.detail ?? message.fn} · {message.id}
              </p>
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadEml(message)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3.5 text-[13px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  Download .eml
                </button>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="inline-flex h-9 items-center justify-center rounded-md bg-gradient-to-br from-purple-600 to-fuchsia-600 px-4 text-[13px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(147,51,234,0.7)] transition-shadow hover:shadow-[0_12px_26px_-8px_rgba(147,51,234,0.85)]"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
