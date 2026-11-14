"use client";

import { CloudOff } from "lucide-react";
import { formatCachedAt } from "@/lib/offline/read-cache";
import { cn } from "@/lib/utils";

/**
 * Shown above a view that is rendering its last successful network read.
 * The timestamp tells staff how stale the snapshot is; the banner provider
 * already explains that saved changes will sync when the connection returns.
 */
export function CachedNotice({
  cachedAt,
  className,
}: {
  cachedAt: number;
  className?: string;
}) {
  return (
    <p
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-[13px] text-amber-800 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/25",
        className
      )}
    >
      <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      Showing the last saved snapshot from {formatCachedAt(cachedAt)} — reconnect to refresh.
    </p>
  );
}
