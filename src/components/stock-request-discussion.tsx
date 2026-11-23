"use client";

import { FileText, Loader2, Paperclip, Send } from "lucide-react";
import { useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  openStockRequestAttachment,
  respondToStockRequest,
  type NetworkStockRequest,
  type StockRequestComment,
} from "@/lib/cloud/stock-requests";

export function StockRequestDiscussion({
  docId,
  comments = [],
  returnToPharmacy = false,
  resubmitOnReply = true,
  readOnly = false,
  onUpdated,
}: {
  docId: string;
  comments?: StockRequestComment[];
  returnToPharmacy?: boolean;
  resubmitOnReply?: boolean;
  readOnly?: boolean;
  onUpdated: (request: NetworkStockRequest) => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [comment, setComment] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!comment.trim() && files.length === 0) {
      toast({ title: "Add a comment", description: "The request history needs a note for this update.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const updated = await respondToStockRequest({ docId, comment: comment.trim(), files, returnToPharmacy });
      onUpdated(updated);
      setComment("");
      setFiles([]);
      if (fileRef.current) fileRef.current.value = "";
      toast({
        title: returnToPharmacy ? "Request returned to pharmacy" : "Reply sent",
        description: "The comment and attachments are now in the request history.",
      });
    } catch (error) {
      toast({ title: "Could not send update", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 border-t border-slate-100 pt-4 dark:border-white/10">
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Request conversation</h3>
        {comments.length ? (
          <ol className="mt-3 grid gap-3">
            {comments.map((entry) => (
              <li key={entry.id} className="rounded-xl bg-slate-50 p-3 dark:bg-white/5">
                <div className="flex items-center justify-between gap-3 text-[11px] text-slate-500">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{entry.author} · {entry.side === "pulse" ? "Pulse" : "Pharmacy"}</span>
                  <time>{new Date(entry.createdAt).toLocaleString()}</time>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-[13px] text-slate-700 dark:text-slate-200">{entry.comment}</p>
                {entry.attachments?.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {entry.attachments.map((file) => (
                      <button key={file.path} type="button" onClick={() => void openStockRequestAttachment(file).catch((error) => toast({ title: "Could not open file", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" }))} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-50 dark:border-white/10 dark:bg-white/5 dark:text-purple-300">
                        <FileText className="h-3.5 w-3.5" />{file.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        ) : <p className="mt-2 text-xs text-slate-500">No comments or attachments yet.</p>}
      </div>
      {!readOnly && <div className="grid gap-2">
        <label className="text-xs font-semibold text-slate-700 dark:text-slate-200" htmlFor={`stock-request-comment-${docId}`}>
          {returnToPharmacy ? "Return note (required)" : "Comment or attachment"}
        </label>
        <textarea id={`stock-request-comment-${docId}`} rows={3} maxLength={2000} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={returnToPharmacy ? "Explain what the pharmacy should correct or provide…" : "Add a note for the Pulse desk…"} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-[13px] outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.rtf,.txt,.csv,image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} className="sr-only" />
            <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"><Paperclip className="h-3.5 w-3.5" />Attach files</button>
            <span className="max-w-[260px] truncate text-xs text-slate-500">{files.length ? files.map((file) => file.name).join(", ") : "PDF, Word, or image · max 10 MB each"}</span>
          </div>
          <button type="button" onClick={() => void submit()} disabled={busy || (!comment.trim() && files.length === 0)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-purple-600 px-3.5 text-xs font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {busy ? "Sending…" : returnToPharmacy ? "Return with note" : resubmitOnReply ? "Send & resubmit" : "Send comment"}
          </button>
        </div>
      </div>}
    </div>
  );
}
