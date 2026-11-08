import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { FirebaseAnalytics } from "@/components/firebase-analytics";

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
    "Sign in to Pulse, the pharmacy intelligence platform. Track stock, demand and delivery in real time.",
  keywords: [
    "Pulse",
    "Pharmacy Intelligence",
    "Healthcare logistics",
    "Sign in",
  ],
  authors: [{ name: "Pulse" }],
  openGraph: {
    title: "Pulse — Pharmacy Intelligence, Delivered.",
    description: "Sign in to Pulse — the pharmacy intelligence platform.",
    siteName: "Pulse",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Pulse — Pharmacy Intelligence, Delivered.",
    description: "Sign in to Pulse — the pharmacy intelligence platform.",
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
        <Toaster />
      </body>
    </html>
  );
}
