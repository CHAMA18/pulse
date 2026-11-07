import type { Metadata } from "next";
import { AuthGuard } from "@/components/dashboard/auth-guard";
import { DashboardApp } from "@/components/dashboard/dashboard-app";

export const metadata: Metadata = {
  title: "Dashboard — Pulse",
  description: "Pharmacy intelligence, delivered — your Pulse home console.",
};

export default function DashboardPage() {
  return (
    <AuthGuard>
      <DashboardApp />
    </AuthGuard>
  );
}
