import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
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
    <html lang="en" suppressHydrationWarning>
      <body className={`${poppins.variable} antialiased`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
