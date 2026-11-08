import type { Metadata } from "next";
import { AuthGuard } from "@/components/dashboard/auth-guard";
import { PharmacyApp } from "@/components/pharmacy/pharmacy-app";

export const metadata: Metadata = {
  title: "Pharmacy Portal — Pulse",
  description:
    "The Pharmacy Portal console — inventory, stock requests and deliveries for your pharmacy, powered by Pulse.",
};

export default function PharmacyPortalPage() {
  return (
    <AuthGuard>
      <PharmacyApp />
    </AuthGuard>
  );
}
