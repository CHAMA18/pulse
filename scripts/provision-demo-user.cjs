#!/usr/bin/env node
/**
 * Provisions a demo user in the project's Firebase Auth via the public
 * Identity Toolkit REST API (the same web API the app itself uses).
 *
 * - Prints only status summaries; never tokens, keys, or passwords.
 * - Safe to re-run: if the account already exists it signs in instead,
 *   and refreshes the displayName so the dashboard matches the design.
 */
const fs = require("fs");
const path = require("path");

const DEMO_EMAIL = "demo@pulse.dev";
const DEMO_PASSWORD = "PulseDemo2026!";
const DEMO_NAME = "Chungu Chipimo Chama";

function readApiKey() {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src", "lib", "firebase.ts"),
    "utf8"
  );
  const m = src.match(/apiKey:\s*"([^"]+)"/);
  if (!m) throw new Error("apiKey not found in firebase.ts");
  return m[1];
}

async function identity(action, body) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:${action}?key=${readApiKey()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, error: data.error, data };
}

(async () => {
  let signUp = await identity("signUp", {
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    returnSecureToken: true,
  });

  if (!signUp.ok && signUp.error?.message === "EMAIL_EXISTS") {
    console.log("account: already exists — signing in to refresh profile");
    signUp = await identity("signInWithPassword", {
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      returnSecureToken: true,
    });
  }

  if (!signUp.ok) {
    console.error("FAILED:", signUp.error?.message ?? `HTTP ${signUp.status}`);
    process.exit(1);
  }

  const token = signUp.data.idToken;
  if (!token) {
    console.error("FAILED: no session token returned");
    process.exit(1);
  }

  const rename = await identity("update", {
    idToken: token,
    displayName: DEMO_NAME,
  });

  console.log(
    rename.ok
      ? `demo user ready: ${DEMO_EMAIL} / ${DEMO_PASSWORD} (name set to "${DEMO_NAME}")`
      : `demo user ready, but renaming failed: ${rename.error?.message ?? rename.status}`
  );
})();
