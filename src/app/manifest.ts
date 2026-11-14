import type { MetadataRoute } from "next";

/** The static export needs this generated at build time. */
export const dynamic = "force-static";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pulse — Pharmacy Intelligence, Delivered.",
    short_name: "Pulse",
    description:
      "Stock, sales and deliveries for your pharmacy — online or offline.",
    start_url: `${basePath}/`,
    scope: `${basePath}/`,
    display: "standalone",
    background_color: "#07030f",
    theme_color: "#07030f",
    icons: [
      {
        src: `${basePath}/brand/pulse-192.png`,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `${basePath}/brand/pulse-512.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
