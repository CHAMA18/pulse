const projectId = "demo-pulse-stock-sandbox";

if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId) {
  throw new Error("Refusing to seed a project other than the stock sandbox.");
}

process.env.GCLOUD_PROJECT = projectId;
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const admin = require("../functions/node_modules/firebase-admin");
admin.initializeApp({ projectId });

const testUsers = [
  {
    email: "pharmacy.owner@sandbox.test",
    password: "SandboxPharmacy!2026",
    displayName: "Sandbox Pharmacy Owner",
    profile: {
      account_type: "Pharmacy",
      role: "owner",
      role_label: "Owner",
      pharmacy_name: "Sandbox Pharmacy",
      pharmacy_id: "sandbox-pharmacy-001",
      approved_by_duniya: true,
      access_revoked: false,
      listing_status: "active",
    },
  },
  {
    email: "pulse.admin@sandbox.test",
    password: "SandboxPulse!2026",
    displayName: "Sandbox Pulse Admin",
    profile: {
      account_type: "Pulse",
      role: "admin",
      role_label: "Admin",
      approved_by_duniya: true,
      access_revoked: false,
    },
  },
];

async function ensureUser(auth, input) {
  try {
    return await auth.getUserByEmail(input.email);
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    return auth.createUser({
      email: input.email,
      password: input.password,
      displayName: input.displayName,
      emailVerified: true,
    });
  }
}

async function main() {
  const auth = admin.auth();
  const db = admin.firestore();
  for (const input of testUsers) {
    const user = await ensureUser(auth, input);
    await auth.updateUser(user.uid, {
      password: input.password,
      displayName: input.displayName,
      emailVerified: true,
      disabled: false,
    });
    await db.collection("User").doc(user.uid).set(
      {
        uid: user.uid,
        email: input.email,
        display_name: input.displayName,
        created_time: admin.firestore.FieldValue.serverTimestamp(),
        ...input.profile,
      },
      { merge: true }
    );
  }
  console.log(`Seeded two test-only accounts in ${projectId}.`);
  console.log("Pharmacy: pharmacy.owner@sandbox.test / SandboxPharmacy!2026");
  console.log("Pulse Admin: pulse.admin@sandbox.test / SandboxPulse!2026");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
