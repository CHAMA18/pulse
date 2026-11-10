import type { NextConfig } from "next";

/**
 * Build modes:
 * - Default: `output: "standalone"` — self-hosted Node server (`bun start`).
 * - `NEXT_EXPORT=1`: `output: "export"` — fully static site.
 * - `NEXT_BASE_PATH`: optional URL prefix for static hosting. Defaults to
 *   `/pulse` for GitHub Pages; leave empty for a site hosted at the domain root.
 *
 * GitHub project Pages are served from https://<owner>.github.io/<repo>/,
 * so the default basePath mirrors the repository name ("pulse").
 */
const isStaticExport = process.env.NEXT_EXPORT === "1";
const staticBasePath = process.env.NEXT_BASE_PATH ?? "/pulse";

const nextConfig: NextConfig = {
  ...(isStaticExport
    ? {
        output: "export" as const,
        ...(staticBasePath ? { basePath: staticBasePath } : {}),
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
