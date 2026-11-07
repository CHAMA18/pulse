"use client";

import { useEffect } from "react";
import { initAnalytics } from "@/lib/firebase";

/**
 * Mounts once in the root layout and boots Firebase Analytics in the
 * browser (SSR-safe, no-op on the server). Renders nothing.
 */
export function FirebaseAnalytics() {
  useEffect(() => {
    void initAnalytics();
  }, []);

  return null;
}
