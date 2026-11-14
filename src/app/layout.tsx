import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { FirebaseAnalytics } from "@/components/firebase-analytics";
import { OfflineProvider } from "@/components/offline/offline-provider";

/** Mirrors the optional GitHub Pages base path baked in at build time. */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * Satoshi — the app-wide brand typeface (via Fontshare).
 * Self-hosted variable font: one file covers weights 300–900.
 */
const satoshi = localFont({
  src: "./fonts/Satoshi-Variable.woff2",
  variable: "--font-satoshi",
  weight: "300 900",
  style: "normal",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pulse — Pharmacy Intelligence, Delivered.",
  description:
    "A live view of pharmacy stock, demand and delivery — so care never waits on medicine.",
  keywords: [
    "Pulse",
    "Pharmacy Intelligence",
    "Healthcare logistics",
    "Pharmacy management",
  ],
  authors: [{ name: "Pulse" }],
  openGraph: {
    title: "Pulse — Pharmacy Intelligence, Delivered.",
    description: "Track pharmacy stock, demand and delivery in real time with Pulse.",
    siteName: "Pulse",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Pulse — Pharmacy Intelligence, Delivered.",
    description: "Track pharmacy stock, demand and delivery in real time with Pulse.",
  },
  applicationName: "Pulse",
  manifest: `${basePath}/manifest.webmanifest`,
  appleWebApp: {
    capable: true,
    title: "Pulse",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#07030f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <body className={`${satoshi.variable} font-sans antialiased`}>
        {children}
        <FirebaseAnalytics />
        <OfflineProvider />
        <Toaster />
      </body>
    </html>
  );
}
