import type { NextConfig } from "next";

/**
 * Build modes:
 * - Default: `output: "standalone"` — self-hosted Node server (`bun start`).
 * - `NEXT_EXPORT=1`: `output: "export"` — fully static site for GitHub Pages.
 *
 * GitHub project Pages are served from https://<owner>.github.io/<repo>/,
 * so basePath must mirror the repository name ("pulse").
 */
const isStaticExport = process.env.NEXT_EXPORT === "1";

const nextConfig: NextConfig = {
  ...(isStaticExport
    ? {
        output: "export" as const,
        basePath: "/pulse",
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {
        output: "standalone" as const,
      }),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
