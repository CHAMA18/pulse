/**
 * Moves the static Next.js export into the Electron app directory before
 * packaging, so the installed app can run entirely from disk.
 */
import { access, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const source = path.resolve("out");
const target = path.resolve("desktop/app");

try {
  await access(path.join(source, "index.html"));
} catch {
  throw new Error("Static export missing at ./out — run `NEXT_EXPORT=1 next build` first.");
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });

console.log("Staged static export into desktop/app.");
