import path from "node:path";
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
// The Electron shell serves the export from the app root, so it has no basePath.
const isDesktopExport = process.env.NEXT_DESKTOP === "1";
const staticBasePath = isDesktopExport ? "" : process.env.NEXT_BASE_PATH ?? "/pulse";

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
  // Pin the tracing root so the standalone server lands where the start
  // script expects it, and let TypeScript errors fail the build again.
  outputFileTracingRoot: path.join(__dirname),
  reactStrictMode: false,
  // Exposed to the client so the service worker and manifest resolve under
  // the GitHub Pages base path as well as at the domain root.
  env: {
    NEXT_PUBLIC_BASE_PATH: isStaticExport ? staticBasePath : "",
  },
};

export default nextConfig;
