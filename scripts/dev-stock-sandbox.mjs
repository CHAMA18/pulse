import { spawn } from "node:child_process";

const projectId = "demo-pulse-stock-sandbox";
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "-p", "3100"],
  {
    env: {
      ...process.env,
      NEXT_PUBLIC_FIREBASE_EMULATORS: "true",
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: projectId,
      NEXT_STOCK_SANDBOX: "1",
    },
    stdio: "inherit",
  }
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
