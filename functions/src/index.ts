/* ------------------------------------------------------------------ */
/* Pulse Cloud Functions — invitation delivery                         */
/* ------------------------------------------------------------------ */
/* Callable functions the two portals invoke when someone is invited:  */
/*                                                                     */
/*   sendTeamInvite        — a Pharmacy-portal team invitation         */
/*   sendReceiptEmail      — a customer receipt from the POS           */
/*   sendPulseAdminInvite  — a Pulse-console invitation               */
/*   recordAuditEvents     — batched audit writes to Firestore        */
/*   listAuditLogs         — full audit feed for Pulse managers       */
/*   syncPharmacySales     — network mirror of POS sales              */
/*   syncPharmacyShifts    — cashier shift opens and closes           */
/*   deletePharmacyAccount — permanent cleanup of a removed pharmacy  */
/*   onPharmacyCreated     — welcome + team invites at registration    */
/*   onPharmacyDocCreated  — Firestore trigger: a Pharmacy document    */
/*                           carrying `inviteEmails` fires invites     */
/*                                                                     */
/* Delivery goes through Resend (key in Secret Manager as              */
/* RESEND_API_KEY); every message is archived to Firestore at          */
/* InvitationMail/{id} so both portals can show a delivery record.      */
/* Deploy with:                                                        */
/*                                                                     */
/*   firebase deploy --only functions                                  */
/*                                                                     */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { createHash, randomBytes, randomUUID } from "crypto";
import * as admin from "firebase-admin";
import {
  lowStockAlertEmail,
  pendingPharmacyRegistrationEmail,
  pharmacyWelcomeEmail,
  pulseAdminInviteEmail,
  receiptEmail,
  stockDeliveryCompletedEmail,
  stockRequestEmail,
  stockRequestFulfilledEmail,
  teamInviteEmail,
  type EmailContent,
  type ReceiptEmailLine,
} from "./emails";
import { PULSE_MARK_BASE64 } from "./logo";

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

/** Resend API key — provided by Secret Manager at runtime. */
const resendApiKey = defineSecret("RESEND_API_KEY");

/** Public app origin for links in email. GitHub Pages was the previous host;
 * links must always point at the deployed custom domain instead. */
const DEFAULT_APP_URL = "https://pulse.duniyahealthcare.com/";
const LEGACY_APP_HOSTS = new Set(["chama18.github.io"]);
/** Hosts whose Origin header may be reflected back into an email link. */
const TRUSTED_APP_HOSTS = new Set(["pulse.duniyahealthcare.com", "duniya-web.onrender.com"]);

function normalizeAppUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function configuredAppUrl(): string {
  const configured = normalizeAppUrl(process.env.APP_URL ?? "");
  if (!configured) return DEFAULT_APP_URL;
  try {
    // A stale GitHub Pages setting must never pull email links off the domain.
    if (LEGACY_APP_HOSTS.has(new URL(configured).hostname.toLowerCase())) return DEFAULT_APP_URL;
  } catch {
    return DEFAULT_APP_URL;
  }
  return configured;
}

function trustedAppOrigin(value: unknown): string | null {
  try {
    const parsed = new URL(String(value ?? ""));
    const host = parsed.hostname.toLowerCase();
    const isLocal = host === "localhost" || host === "127.0.0.1";
    if (isLocal ? !/^https?:$/.test(parsed.protocol) : !TRUSTED_APP_HOSTS.has(host)) return null;
    if (!isLocal && parsed.protocol !== "https:") return null;
    return `${parsed.origin}/`;
  } catch {
    return null;
  }
}

/** Email links follow the origin the caller is using, then the configured URL. */
function appUrlFor(request: {
  rawRequest?: { headers?: { [key: string]: unknown } };
}): string {
  return trustedAppOrigin(request.rawRequest?.headers?.origin) ?? configuredAppUrl();
}

/** Fallback for triggers with no caller (Firestore events). */
const APP_URL = configuredAppUrl();
// Send from the domain verified in Resend for this project.
const FROM = process.env.EMAIL_FROM ?? "Pulse <noreply@thestackone.com>";
const REPLY_TO = process.env.EMAIL_REPLY_TO ?? "noreply@thestackone.com";
const INVITE_TTL_DAYS = 7;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The inline mark attached to every message (matches cid:pulse-mark in HTML). */
const EMAIL_LOGO = {
  filename: "pulse-mark.png",
  content: PULSE_MARK_BASE64,
  content_id: "pulse-mark",
};

function assertEmail(value: unknown, field: string): string {
  const email = String(value ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new HttpsError("invalid-argument", `${field} must be a valid email address.`);
  }
  return email;
}

function requireString(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new HttpsError("invalid-argument", `${field} is required.`);
  return text;
}

/* ------------------------------------------------------------------ */
/* Console roles                                                       */
/* ------------------------------------------------------------------ */

type PulseConsoleRole = "owner" | "admin" | "staff";

const PULSE_ROLE_LABEL: Record<PulseConsoleRole, string> = {
  owner: "Owner",
  admin: "Admin",
  staff: "Staff",
};

/** Higher wins when the same email has more than one console profile. */
const PULSE_ROLE_PRIORITY: Record<PulseConsoleRole, number> = {
  owner: 3,
  admin: 2,
  staff: 1,
};

function pulseRole(value: unknown): PulseConsoleRole | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "owner") return "owner";
  if (normalized === "admin" || normalized === "administrator") return "admin";
  if (normalized === "staff" || normalized === "member" || normalized === "user") {
    return "staff";
  }
  return null;
}

type PulseActor = {
  uid: string;
  email: string;
  name: string;
  role: PulseConsoleRole;
};

type PharmacyActor = {
  uid: string;
  email: string;
  name: string;
  role: string;
  pharmacyId: string;
  pharmacyName: string;
};

const PHARMACY_ROLES = new Set(["owner", "manager", "pharmacist", "technician", "cashier"]);

const PHARMACY_ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  pharmacist: "Pharmacist",
  technician: "Technician",
  cashier: "Cashier",
};

function pharmacyRole(value: unknown): string {
  const role = String(value ?? "").trim().toLowerCase();
  if (role === "pharmacy manager") return "manager";
  if (role === "team member") return "cashier";
  return role;
}

async function ownerIdsByPharmacyName(
  profiles?: admin.firestore.QuerySnapshot
): Promise<Map<string, string>> {
  const snap =
    profiles ?? (await db.collection("User").where("account_type", "==", "Pharmacy").get());
  const owners = new Map<string, string>();
  for (const doc of snap.docs) {
    const data = doc.data();
    const name = String(data.pharmacy_name ?? "").trim().toLowerCase();
    if (name && pharmacyRole(data.role ?? data.role_label) === "owner") owners.set(name, doc.id);
  }
  return owners;
}

function resolvePharmacyId(
  data: admin.firestore.DocumentData,
  uid: string,
  owners: Map<string, string>
): string {
  const stored = String(data.pharmacy_id ?? "").trim();
  if (stored) return stored;
  const name = String(data.pharmacy_name ?? "").trim().toLowerCase();
  return owners.get(name) ?? uid;
}

/** Reads the caller's active Pulse profile, or refuses the call. */
async function requirePulseActor(request: { auth?: { uid: string } }): Promise<PulseActor> {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to manage console access.");
  }
  const snap = await db.collection("User").doc(request.auth.uid).get();
  const data = snap.data();
  if (!snap.exists || data?.account_type !== "Pulse" || data?.access_revoked === true) {
    throw new HttpsError("permission-denied", "This account has no Pulse console access.");
  }
  return {
    uid: request.auth.uid,
    email: String(data.email ?? "").trim().toLowerCase(),
    name: String(data.display_name ?? data.name ?? data.email ?? "Pulse user"),
    role: pulseRole(data.role ?? data.role_label) ?? "staff",
  };
}

/** Reads an active Pharmacy profile and resolves its shared pharmacy identity. */
async function requirePharmacyActor(request: { auth?: { uid: string } }): Promise<PharmacyActor> {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to sync pharmacy sales.");
  }
  const snap = await db.collection("User").doc(request.auth.uid).get();
  const data = snap.data();
  if (!snap.exists || data?.account_type !== "Pharmacy" || data?.access_revoked === true) {
    throw new HttpsError("permission-denied", "This account has no Pharmacy portal access.");
  }

  const pharmacyName = String(data.pharmacy_name ?? "").trim();
  if (!pharmacyName) {
    throw new HttpsError("failed-precondition", "This account is not linked to a pharmacy.");
  }

  let pharmacyId = String(data.pharmacy_id ?? "").trim();
  if (!pharmacyId) {
    pharmacyId = resolvePharmacyId(data, request.auth.uid, await ownerIdsByPharmacyName());
  }

  return {
    uid: request.auth.uid,
    email: String(data.email ?? "").trim().toLowerCase(),
    name: String(data.display_name ?? data.name ?? data.email ?? "Pharmacy staff"),
    role: pharmacyRole(data.role ?? data.role_label),
    pharmacyId,
    pharmacyName,
  };
}

async function requireConsoleManager(request: { auth?: { uid: string } }): Promise<PulseActor> {
  const actor = await requirePulseActor(request);
  if (actor.role !== "owner" && actor.role !== "admin") {
    throw new HttpsError("permission-denied", "Only Owners and Admins can view administrative console data.");
  }
  return actor;
}

/** Ensures an eligible Pulse email has a server-owned profile without changing an existing role. */
export const ensurePulseAdminProfile = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to create a Pulse profile.");
  const email = assertEmail(request.auth.token.email, "email");
  const allowed = email === "chungu424@gmail.com" || email.endsWith("@duniyahealthcare.com");
  if (!allowed) throw new HttpsError("permission-denied", "This email isn't eligible for a Pulse account.");
  const ref = db.collection("User").doc(request.auth.uid);
  const existing = await ref.get();
  const data = existing.data();
  if (existing.exists && data?.account_type !== "Pulse") {
    throw new HttpsError("failed-precondition", "This account is already assigned to another portal.");
  }
  if (existing.exists) return { ok: true };
  const emailProfile = await db.collection("User").where("email", "==", email).get();
  if (emailProfile.docs.some((profile) => profile.id !== request.auth!.uid)) {
    throw new HttpsError("failed-precondition", "This email is already linked to another portal account.");
  }
  const name = String(request.data?.name ?? request.auth.token.name ?? "").trim().slice(0, 120) || email.split("@")[0];
  await ref.create({
    uid: request.auth.uid,
    email,
    display_name: name,
    role: "admin",
    role_label: "Admin",
    account_type: "Pulse",
    approved_by_duniya: true,
    access_revoked: false,
    created_time: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

/** Deliver one email through Resend and archive it for the portals' outbox views. */
async function deliver(
  fn: string,
  to: string[],
  content: EmailContent,
  detail: string
): Promise<string> {
  if (process.env.FUNCTIONS_EMULATOR === "true") {
    throw new Error("Email delivery is disabled in the local Functions emulator.");
  }

  const id = `MSG-${Date.now().toString(36).toUpperCase()}`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey.value()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to,
      reply_to: REPLY_TO,
      subject: content.subject,
      html: content.html,
      text: content.text,
      attachments: [EMAIL_LOGO],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(
      `[${fn}] Resend rejected the message (${response.status}): ${body.slice(0, 500)}`
    );
    throw new HttpsError("internal", "Email delivery failed. Please try again.");
  }

  const provider = (await response.json().catch(() => ({}))) as { id?: string };

  await db.collection("InvitationMail").doc(id).set({
    id,
    fn,
    to,
    subject: content.subject,
    detail,
    status: "sent",
    provider: "resend",
    providerMessageId: provider.id ?? null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return id;
}

function acceptUrl(ref: string, appUrl: string): string {
  return `${appUrl}login/?invite=${encodeURIComponent(ref)}`;
}

const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Pharmacy OTP provisioning                                           */
/* ------------------------------------------------------------------ */

const PHARMACY_OTP_TTL_MS = 72 * 60 * 60 * 1000;
const PHARMACY_OTP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PHARMACY_OTP_BODY_RE = /^[A-HJ-NP-Z2-9]{10}$/;

/** A 50-bit code; the human-readable prefix is presentation only. */
function newPharmacyOtp(): { code: string; body: string } {
  const bytes = randomBytes(10);
  const body = Array.from(bytes, (byte) => PHARMACY_OTP_ALPHABET[byte % PHARMACY_OTP_ALPHABET.length]).join("");
  return { code: `PULSE-${body.slice(0, 5)}-${body.slice(5)}`, body };
}

/** Accepts the displayed code, or the ten-character body on its own. */
function normalizePharmacyOtp(value: unknown): string | null {
  const compact = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  // The displayed code is 15 characters (PULSE + 10 body characters). Accept
  // the ten-character body too, but only strip the prefix from the full form so
  // a body that happens to begin with P-U-L-S-E stays intact.
  const body =
    compact.length === 15 && compact.startsWith("PULSE") ? compact.slice(5) : compact;
  return PHARMACY_OTP_BODY_RE.test(body) ? body : null;
}

function hashPharmacyOtp(body: string): string {
  return createHash("sha256").update(`pharmacy-otp:${body}`).digest("hex");
}

function expiryDate(): Date {
  return new Date(Date.now() + INVITE_TTL_MS);
}

function expiryLabel(date: Date = expiryDate()): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** Unguessable id — the link is the only key to the invitation record. */
function newInviteId(): string {
  return `INV-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

type InvitationKind = "team" | "console";

/**
 * The durable side of an invitation. The email button carries only the id;
 * the landing page resolves it here to prefill registration, and accepting
 * marks the same record used so a link cannot be replayed.
 */
async function saveInvitation(input: {
  id: string;
  kind: InvitationKind;
  email: string;
  name: string;
  role: string;
  pharmacyName?: string | null;
  pharmacyId?: string | null;
  storeNames?: string[];
  inviterName: string;
  expiresAt: Date;
}): Promise<void> {
  await db.collection("Invitation").doc(input.id).set({
    id: input.id,
    kind: input.kind,
    portal: input.kind === "team" ? "pharmacy" : "pulse",
    email: input.email.trim().toLowerCase(),
    name: input.name.trim(),
    role: input.role.trim(),
    pharmacyName: input.pharmacyName?.trim() || null,
    pharmacyId: input.pharmacyId?.trim() || null,
    storeNames: input.storeNames ?? [],
    inviterName: input.inviterName.trim(),
    status: "pending",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromDate(input.expiresAt),
    acceptedBy: null,
    acceptedAt: null,
  });
}

async function markInvitationFailed(id: string): Promise<void> {
  try {
    await db.collection("Invitation").doc(id).update({ status: "failed" });
  } catch {
    /* best-effort — the original delivery error is what matters */
  }
}

/* ------------------------------------------------------------------ */
/* sendTeamInvite — Pharmacy portal team invitations                   */
/* ------------------------------------------------------------------ */

export const sendTeamInvite = onCall({ secrets: [resendApiKey] }, async (request) => {
  const actor = await requirePharmacyActor(request);

  // Only owners and managers may invite, only into known roles, and only an
  // owner may create another owner — regardless of what the client sends.
  const actorRole = pharmacyRole(actor.role);
  if (actorRole !== "owner" && actorRole !== "manager") {
    throw new HttpsError("permission-denied", "Only Owners and Managers can invite team members.");
  }
  const pharmacyName = actor.pharmacyName;
  const inviterName = requireString(request.data?.inviterName, "inviterName");
  const inviteeName = String(request.data?.inviteeName ?? "").trim();
  const inviteeEmail = assertEmail(request.data?.inviteeEmail, "inviteeEmail");
  const role = requireString(request.data?.role, "role");
  const normalizedRole = pharmacyRole(role);
  if (!PHARMACY_ROLES.has(normalizedRole)) {
    throw new HttpsError("invalid-argument", "Unknown pharmacy role.");
  }
  if (normalizedRole === "owner" && actorRole !== "owner") {
    throw new HttpsError("permission-denied", "Only an Owner can invite another Owner.");
  }
  const storeNames: string[] = Array.isArray(request.data?.storeNames)
    ? request.data.storeNames.map((entry: unknown) => String(entry))
    : ["All stores"];
  const personalMessage =
    typeof request.data?.personalMessage === "string" && request.data.personalMessage.trim()
      ? request.data.personalMessage.trim().slice(0, 600)
      : undefined;

  const inviteId = newInviteId();
  const expiresAt = expiryDate();
  await saveInvitation({
    id: inviteId,
    kind: "team",
    email: inviteeEmail,
    name: inviteeName,
    role: normalizedRole,
    pharmacyName,
    pharmacyId: actor.pharmacyId,
    storeNames,
    inviterName,
    expiresAt,
  });

  const content = teamInviteEmail({
    pharmacyName,
    inviterName,
    inviteeName,
    role,
    storeNames,
    personalMessage,
    inviteId,
    acceptUrl: acceptUrl(inviteId, appUrlFor(request)),
    expiresAt: expiryLabel(expiresAt),
  });

  let messageId: string;
  try {
    messageId = await deliver("sendTeamInvite", [inviteeEmail], content, "Team invitation");
  } catch (error) {
    await markInvitationFailed(inviteId);
    throw error;
  }
  return { messageId, inviteId };
});

/* ------------------------------------------------------------------ */
/* sendPulseAdminInvite — Pulse console invitations                    */
/* ------------------------------------------------------------------ */

export const sendPulseAdminInvite = onCall(
  { secrets: [resendApiKey] },
  async (request) => {
  const actor = await requireConsoleManager(request);

  const inviterName = requireString(request.data?.inviterName, "inviterName");
  const inviteeName = String(request.data?.inviteeName ?? "").trim();
  const inviteeEmail = assertEmail(request.data?.inviteeEmail, "inviteeEmail");
  const requestedRole = pulseRole(request.data?.role);
  if (!requestedRole) {
    throw new HttpsError("invalid-argument", "role must be Owner, Admin or Staff.");
  }
  if (requestedRole === "owner" && actor.role !== "owner") {
    throw new HttpsError("permission-denied", "Only an Owner can invite another Owner.");
  }
  const role = PULSE_ROLE_LABEL[requestedRole];

  // An email owns one console account. If it already exists, change that
  // account's role instead of creating a second seat with a second role.
  const existing = await db.collection("User").where("email", "==", inviteeEmail).get();
  if (
    existing.docs.some(
      (doc) => doc.data().account_type === "Pulse" && doc.data().access_revoked !== true
    )
  ) {
    throw new HttpsError(
      "already-exists",
      "An active Pulse account already uses this email. Change its role instead of inviting it again."
    );
  }

  const inviteId = newInviteId();
  const expiresAt = expiryDate();
  await saveInvitation({
    id: inviteId,
    kind: "console",
    email: inviteeEmail,
    name: inviteeName || inviteeEmail.split("@")[0],
    role,
    inviterName,
    expiresAt,
  });

  const content = pulseAdminInviteEmail({
    inviterName,
    inviteeName,
    inviteeEmail,
    role,
    inviteId,
    acceptUrl: acceptUrl(inviteId, appUrlFor(request)),
    expiresAt: expiryLabel(expiresAt),
  });

  let messageId: string;
  try {
    messageId = await deliver(
      "sendPulseAdminInvite",
      [inviteeEmail],
      content,
      "Console invitation"
    );
  } catch (error) {
    await markInvitationFailed(inviteId);
    throw error;
  }
  return { messageId, inviteId };
});

/* ------------------------------------------------------------------ */
/* Console directory + Owner-only access controls                      */
/* ------------------------------------------------------------------ */

export const listPulseConsoleUsers = onCall(async (request) => {
  await requireConsoleManager(request);
  const snap = await db
    .collection("User")
    .where("account_type", "==", "Pulse")
    .get();
  // Auth providers can produce more than one UID for the same email. An
  // account must still present one role, so collapse profiles by email, keep
  // the highest role, and align any stale duplicate records to that role.
  type ConsoleProfile = {
    uid: string;
    name: string;
    email: string;
    role: PulseConsoleRole;
    roleLabel: string;
    ref: admin.firestore.DocumentReference;
  };
  const profilesByEmail = new Map<string, ConsoleProfile[]>();
  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.access_revoked === true) continue;
    const role = pulseRole(data.role ?? data.role_label) ?? "staff";
    const email = String(data.email ?? "").trim().toLowerCase();
    const profile: ConsoleProfile = {
      uid: doc.id,
      name: String(data.display_name ?? data.name ?? data.email ?? "Pulse user"),
      email,
      role,
      roleLabel: PULSE_ROLE_LABEL[role],
      ref: doc.ref,
    };
    const key = email || `uid:${doc.id}`;
    const group = profilesByEmail.get(key) ?? [];
    group.push(profile);
    profilesByEmail.set(key, group);
  }

  const users: Omit<ConsoleProfile, "ref">[] = [];
  const batch = db.batch();
  let repairs = 0;
  for (const group of profilesByEmail.values()) {
    const canonical = group.reduce((best, profile) =>
      PULSE_ROLE_PRIORITY[profile.role] > PULSE_ROLE_PRIORITY[best.role]
        ? profile
        : best
    );
    const { ref: _ref, ...user } = canonical;
    users.push(user);

    // Same email means same account. A stale duplicate must never keep a
    // second role; bring every duplicate in line with the canonical role.
    for (const profile of group) {
      if (profile.uid === canonical.uid || profile.role === canonical.role) continue;
      batch.update(profile.ref, {
        role: canonical.role,
        role_label: canonical.roleLabel,
        role_updated_at: admin.firestore.FieldValue.serverTimestamp(),
        role_updated_by: "system:duplicate-role-repair",
      });
      repairs += 1;
    }
  }
  if (repairs > 0) await batch.commit();

  return { users };
});

/** Complete application directory for Pulse Owners and Admins. */
export const listApplicationUsers = onCall(async (request) => {
  await requireConsoleManager(request);
  const profiles = await db.collection("User").get();
  const users = await Promise.all(profiles.docs.map(async (doc) => {
    const data = doc.data();
    const rawAccountType = String(data.account_type ?? "").trim();
    const accountType = rawAccountType === "Pulse" || rawAccountType === "Pharmacy"
      ? rawAccountType
      : "Other";
    const rawRole = String(data.role ?? data.role_label ?? "").trim();
    const pulseUserRole = accountType === "Pulse" ? pulseRole(rawRole) : undefined;
    const pharmacyUserRole = accountType === "Pharmacy" ? pharmacyRole(rawRole) : "";
    const roleLabel = pulseUserRole
      ? PULSE_ROLE_LABEL[pulseUserRole]
      : PHARMACY_ROLE_LABEL[pharmacyUserRole] ?? (rawRole || "User");
    let authDisabled = false;
    try {
      authDisabled = (await admin.auth().getUser(doc.id)).disabled;
    } catch (error) {
      if ((error as { code?: string } | null)?.code === "auth/user-not-found") authDisabled = true;
      else throw error;
    }
    const status = data.status === "removed"
      ? "removed"
      : data.access_revoked === true || data.status === "suspended" || authDisabled
        ? "suspended"
        : "active";
    return {
      uid: doc.id,
      name: String(data.display_name ?? data.name ?? data.email ?? "Application user"),
      email: String(data.email ?? ""),
      accountType,
      role: pulseUserRole ?? (pharmacyUserRole ? "pharmacy" : "user"),
      roleLabel,
      status,
      source: "profile" as const,
    };
  }));
  const inviteSnap = await db.collection("Invitation").where("status", "==", "pending").get();
  const now = Date.now();
  const activeEmails = new Set(users.map((user) => user.email.trim().toLowerCase()).filter(Boolean));
  const invitations = inviteSnap.docs.flatMap((doc) => {
    const data = doc.data();
    const email = String(data.email ?? "").trim().toLowerCase();
    const expiry = data.expiresAt as admin.firestore.Timestamp | undefined;
    if (!email || activeEmails.has(email) || (expiry?.toMillis && expiry.toMillis() <= now)) return [];
    const accountType = data.kind === "console" || data.portal === "pulse" ? "Pulse" : "Pharmacy";
    const rawRole = String(data.role ?? "").trim();
    const pulseUserRole = accountType === "Pulse" ? pulseRole(rawRole) : undefined;
    const teamRole = accountType === "Pharmacy" ? pharmacyRole(rawRole) : "";
    return [{
      uid: `invite:${doc.id}`,
      name: String(data.name ?? email.split("@")[0]),
      email,
      accountType,
      role: pulseUserRole ?? (teamRole ? "pharmacy" : "user"),
      roleLabel: pulseUserRole ? PULSE_ROLE_LABEL[pulseUserRole] : PHARMACY_ROLE_LABEL[teamRole] ?? (rawRole || "User"),
      status: "invited" as const,
      source: "invitation" as const,
    }];
  });
  return { users: [...users, ...invitations] };
});

/** Pulse Owners and Admins can suspend, restore, or delete individual users. */
export const manageApplicationUser = onCall(async (request) => {
  const actor = await requireConsoleManager(request);
  const uid = requireString(request.data?.uid, "uid");
  const action = String(request.data?.action ?? "").trim().toLowerCase();
  if (!["suspend", "reactivate", "delete"].includes(action)) {
    throw new HttpsError("invalid-argument", "Choose suspend, reactivate, or delete.");
  }
  if (uid === actor.uid) {
    throw new HttpsError("failed-precondition", "You can't change or delete your own account.");
  }

  const targetRef = db.collection("User").doc(uid);
  const target = await targetRef.get();
  const profile = target.data();
  if (!target.exists || !profile) {
    throw new HttpsError("not-found", "That application user no longer exists.");
  }

  if (profile.account_type === "Pulse" && pulseRole(profile.role ?? profile.role_label) === "owner" && action !== "reactivate") {
    const others = await db.collection("User").where("account_type", "==", "Pulse").get();
    const otherActiveOwners = others.docs.filter((doc) => {
      if (doc.id === uid) return false;
      const data = doc.data();
      return data.access_revoked !== true && data.status !== "suspended" &&
        pulseRole(data.role ?? data.role_label) === "owner";
    });
    if (otherActiveOwners.length === 0) {
      throw new HttpsError("failed-precondition", "The network needs one active Owner. Promote another Owner first.");
    }
  }

  if (action === "suspend") {
    await admin.auth().updateUser(uid, { disabled: true });
    await admin.auth().revokeRefreshTokens(uid);
    await targetRef.update({
      access_revoked: true,
      status: "suspended",
      status_updated_at: admin.firestore.FieldValue.serverTimestamp(),
      status_updated_by: actor.uid,
    });
  } else if (action === "reactivate") {
    if (profile.status === "removed") {
      throw new HttpsError("failed-precondition", "A removed account can't be reactivated.");
    }
    await admin.auth().updateUser(uid, { disabled: false });
    await targetRef.update({
      access_revoked: false,
      status: "active",
      status_updated_at: admin.firestore.FieldValue.serverTimestamp(),
      status_updated_by: actor.uid,
    });
  } else {
    await admin.auth().deleteUser(uid).catch((error: unknown) => {
      if ((error as { code?: string } | null)?.code !== "auth/user-not-found") throw error;
    });
    await targetRef.delete();
  }

  const eventId = randomUUID();
  await db.collection("AuditLog").doc(`${actor.uid}_${eventId}`).set({
    eventId,
    title: action === "delete" ? "User deleted" : action === "suspend" ? "User suspended" : "User reactivated",
    detail: `${String(profile.display_name ?? profile.name ?? profile.email ?? uid)} (${String(profile.email ?? uid)})`,
    action: "Update",
    ts: Date.now(),
    actor: actor.name,
    email: actor.email,
    scope: "pulse",
    portal: "pulse",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { uid, action };
});

/** Counts the other active Owners while a transaction holds the target doc. */
async function otherOwnerCount(
  transaction: admin.firestore.Transaction,
  targetUid: string,
  excludeEmail = ""
): Promise<number> {
  const snap = await transaction.get(
    db.collection("User").where("account_type", "==", "Pulse")
  );
  return snap.docs.filter((doc) => {
    if (doc.id === targetUid) return false;
    const data = doc.data();
    if (
      excludeEmail &&
      String(data.email ?? "").trim().toLowerCase() === excludeEmail
    ) {
      return false;
    }
    return data.access_revoked !== true && pulseRole(data.role ?? data.role_label) === "owner";
  }).length;
}

export const updatePulseConsoleUserRole = onCall(async (request) => {
  const actor = await requireConsoleManager(request);
  const uid = requireString(request.data?.uid, "uid");
  if (uid === actor.uid) {
    throw new HttpsError("failed-precondition", "You can't change your own role.");
  }
  const nextRole = pulseRole(request.data?.role);
  if (!nextRole) {
    throw new HttpsError("invalid-argument", "role must be Owner, Admin or Staff.");
  }
  if (actor.role !== "owner" && nextRole === "owner") {
    throw new HttpsError("permission-denied", "Only an Owner can hand out the Owner role.");
  }

  await db.runTransaction(async (transaction) => {
    const ref = db.collection("User").doc(uid);
    const target = await transaction.get(ref);
    const data = target.data();
    if (!target.exists || data?.account_type !== "Pulse" || data?.access_revoked === true) {
      throw new HttpsError("not-found", "That console user no longer exists.");
    }
    const currentRole = pulseRole(data.role ?? data.role_label) ?? "staff";
    const targetEmail = String(data.email ?? "").trim().toLowerCase();
    // One email can have more than one Auth profile (for example password and
    // Google). They are the same account, so every console profile for this
    // email must carry the same single role.
    const pulseSnap = targetEmail
      ? await transaction.get(db.collection("User").where("account_type", "==", "Pulse"))
      : null;
    const duplicates = (pulseSnap?.docs ?? []).filter((doc) => {
      if (doc.id === uid) return false;
      return String(doc.data().email ?? "").trim().toLowerCase() === targetEmail;
    });
    const duplicateHasOwner = duplicates.some(
      (doc) => pulseRole(doc.data().role ?? doc.data().role_label) === "owner"
    );

    if (actor.role !== "owner" && (currentRole === "owner" || duplicateHasOwner)) {
      throw new HttpsError("permission-denied", "Only an Owner can change an Owner's role.");
    }
    if ((currentRole === "owner" || duplicateHasOwner) && nextRole !== "owner") {
      const owners = pulseSnap
        ? pulseSnap.docs.filter((doc) => {
            if (doc.id === uid) return false;
            const profile = doc.data();
            if (
              String(profile.email ?? "").trim().toLowerCase() === targetEmail
            ) {
              return false;
            }
            return (
              profile.access_revoked !== true &&
              pulseRole(profile.role ?? profile.role_label) === "owner"
            );
          }).length
        : await otherOwnerCount(transaction, uid);
      if (owners === 0) {
        throw new HttpsError(
          "failed-precondition",
          "The network needs at least one Owner. Promote another Owner first."
        );
      }
    }

    const rolePatch = {
      role: nextRole,
      role_label: PULSE_ROLE_LABEL[nextRole],
      role_updated_at: admin.firestore.FieldValue.serverTimestamp(),
      role_updated_by: actor.uid,
    };
    transaction.update(ref, rolePatch);
    for (const duplicate of duplicates) {
      transaction.update(duplicate.ref, rolePatch);
    }
  });

  return { uid, role: nextRole, roleLabel: PULSE_ROLE_LABEL[nextRole] };
});

export const removePulseConsoleUser = onCall(async (request) => {
  const actor = await requireConsoleManager(request);
  const uid = requireString(request.data?.uid, "uid");
  if (uid === actor.uid) {
    throw new HttpsError("failed-precondition", "You can't remove your own account.");
  }

  await db.runTransaction(async (transaction) => {
    const ref = db.collection("User").doc(uid);
    const target = await transaction.get(ref);
    const data = target.data();
    if (!target.exists || data?.account_type !== "Pulse" || data?.access_revoked === true) {
      throw new HttpsError("not-found", "That console user no longer exists.");
    }
    const targetEmail = String(data.email ?? "").trim().toLowerCase();
    const pulseSnap = targetEmail
      ? await transaction.get(db.collection("User").where("account_type", "==", "Pulse"))
      : null;
    const duplicates = (pulseSnap?.docs ?? []).filter((doc) => {
      if (doc.id === uid) return false;
      return String(doc.data().email ?? "").trim().toLowerCase() === targetEmail;
    });
    const duplicateHasOwner = duplicates.some(
      (doc) => pulseRole(doc.data().role ?? doc.data().role_label) === "owner"
    );

    if (
      actor.role !== "owner" &&
      (pulseRole(data.role ?? data.role_label) === "owner" || duplicateHasOwner)
    ) {
      throw new HttpsError("permission-denied", "Only an Owner can remove another Owner.");
    }
    if (pulseRole(data.role ?? data.role_label) === "owner" || duplicateHasOwner) {
      const owners = pulseSnap
        ? pulseSnap.docs.filter((doc) => {
            if (doc.id === uid) return false;
            const profile = doc.data();
            if (
              String(profile.email ?? "").trim().toLowerCase() === targetEmail
            ) {
              return false;
            }
            return (
              profile.access_revoked !== true &&
              pulseRole(profile.role ?? profile.role_label) === "owner"
            );
          }).length
        : await otherOwnerCount(transaction, uid);
      if (owners === 0) {
        throw new HttpsError(
          "failed-precondition",
          "The network needs at least one Owner. Promote another Owner first."
        );
      }
    }

    const removalPatch = {
      access_revoked: true,
      status: "removed",
      removed_at: admin.firestore.FieldValue.serverTimestamp(),
      removed_by: actor.uid,
    };
    transaction.update(ref, removalPatch);
    for (const duplicate of duplicates) {
      transaction.update(duplicate.ref, removalPatch);
    }
  });

  // The profile flag blocks the app immediately; disabling every Auth profile
  // for the email and revoking refresh tokens stops duplicate sign-ins too.
  const authUids = await db
    .collection("User")
    .where("account_type", "==", "Pulse")
    .get()
    .then((snap) => {
      const email = String(snap.docs.find((doc) => doc.id === uid)?.data().email ?? "")
        .trim()
        .toLowerCase();
      return email
        ? snap.docs
            .filter(
              (doc) => String(doc.data().email ?? "").trim().toLowerCase() === email
            )
            .map((doc) => doc.id)
        : [uid];
    })
    .catch(() => [uid]);

  for (const authUid of authUids) {
    try {
      await admin.auth().updateUser(authUid, { disabled: true });
      await admin.auth().revokeRefreshTokens(authUid);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code !== "auth/user-not-found") {
        console.error(`[removePulseConsoleUser] could not disable ${authUid}:`, error);
      }
    }
  }

  return { uid, removed: true };
});

/* ------------------------------------------------------------------ */
/* Audit trail                                                         */
/* ------------------------------------------------------------------ */

type StoredAuditAction = "View" | "Update" | "Activity";

function storedAuditAction(value: unknown): StoredAuditAction | null {
  return value === "View" || value === "Update" || value === "Activity"
    ? value
    : null;
}

/** Resolve the signed-in profile into the identity/scope stamped on an event. */
async function resolveAuditActor(request: {
  auth?: { uid: string; token?: { email?: string } };
}): Promise<{
  uid: string;
  name: string;
  email: string;
  scope: string;
  portal: "pulse" | "pharmacy";
}> {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to record audit activity.");
  }
  const snap = await db.collection("User").doc(request.auth.uid).get();
  const data = snap.data();
  if (!snap.exists || data?.access_revoked === true) {
    throw new HttpsError("permission-denied", "This account cannot record audit activity.");
  }
  const accountType = data?.account_type;
  if (accountType !== "Pulse" && accountType !== "Pharmacy") {
    throw new HttpsError("permission-denied", "This account has no audit workspace.");
  }
  const email = String(
    data?.email ?? request.auth.token?.email ?? ""
  )
    .trim()
    .toLowerCase();
  return {
    uid: request.auth.uid,
    name: String(data?.display_name ?? data?.name ?? email.split("@")[0] ?? "Pulse user"),
    email,
    scope:
      accountType === "Pulse"
        ? "pulse"
        : String(data?.pharmacy_id ?? data?.pharmacy_name ?? request.auth.uid),
    portal: accountType === "Pulse" ? "pulse" : "pharmacy",
  };
}

/** Persist a client-batched set of audit events with server-side identity. */
export const recordAuditEvents = onCall(async (request) => {
  const actor = await resolveAuditActor(request);
  const raw: unknown[] = Array.isArray(request.data?.events) ? request.data.events : [];
  if (raw.length > 100) {
    throw new HttpsError("invalid-argument", "Send no more than 100 audit events at a time.");
  }
  const now = Date.now();
  const events = raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const data = entry as Record<string, unknown>;
      const id = String(data.id ?? "").trim();
      const title = String(data.title ?? "").trim().slice(0, 200);
      const detail = String(data.detail ?? "Pulse workspace").trim().slice(0, 500);
      const action = storedAuditAction(data.action);
      const eventEmail = String(data.email ?? "").trim().toLowerCase();
      // Queued/backfilled events may only be attributed to the signed-in user.
      if (eventEmail && eventEmail !== actor.email) return null;
      if (!/^aud-[a-z0-9-]{4,80}$/i.test(id) || !title || !action) return null;
      const clientTs = Number(data.ts);
      // Keep historical ordering for migrated events, but never trust a future clock.
      const ts =
        Number.isFinite(clientTs) && clientTs > 0 && clientTs < now + 5 * 60 * 1000
          ? clientTs
          : now;
      return { id, title, detail, action, ts };
    })
    .filter((event): event is NonNullable<typeof event> => event !== null);

  // Never report success after silently dropping another user's events. Older
  // clients may share a local queue between accounts; rejecting the batch lets
  // them retain it until the updated client can split it by signed-in user.
  if (events.length !== raw.length) {
    throw new HttpsError("failed-precondition", "Some audit events belong to a different account or are invalid.");
  }

  if (events.length === 0) return { recorded: 0 };

  const batch = db.batch();
  for (const event of events) {
    batch.set(db.collection("AuditLog").doc(`${actor.uid}_${event.id}`), {
      eventId: event.id,
      title: event.title,
      detail: event.detail,
      action: event.action,
      ts: event.ts,
      actor: actor.name,
      email: actor.email,
      scope: actor.scope,
      portal: actor.portal,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  return { recorded: events.length };
});

/** The full Firestore trail for the Pulse console. Owners/Admins only. */
export const listAuditLogs = onCall(async (request) => {
  await requireConsoleManager(request);
  const events: Array<{
    id: string;
    title: string;
    action: StoredAuditAction;
    actor: string;
    detail: string;
    email: string;
    ts: number;
  }> = [];

  let cursor: admin.firestore.QueryDocumentSnapshot | null = null;
  const seenIds = new Set<string>();
  for (let page = 0; page < 100; page += 1) {
    let query: admin.firestore.Query = db
      .collection("AuditLog")
      .orderBy("ts", "desc")
      .limit(500);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    for (const doc of snap.docs) {
      const data = doc.data();
      const eventId = String(data.eventId ?? doc.id);
      const email = String(data.email ?? "").trim().toLowerCase();
      const uniqueId = `${email}:${eventId}`;
      if (seenIds.has(uniqueId)) continue;
      seenIds.add(uniqueId);
      const created = data.createdAt as admin.firestore.Timestamp | undefined;
      const ts = Number(data.ts);
      events.push({
        id: eventId,
        title: String(data.title ?? "Activity"),
        action: storedAuditAction(data.action) ?? "Activity",
        actor: String(data.actor ?? "Pulse user"),
        detail: String(data.detail ?? "Pulse workspace"),
        email,
        ts: Number.isFinite(ts) ? ts : created?.toMillis?.() ?? 0,
      });
    }
    if (snap.size < 500) break;
    cursor = snap.docs[snap.docs.length - 1];
  }

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const people = new Set<string>();
  let today = 0;
  for (const event of events) {
    if (event.ts >= cutoff) today += 1;
    if (event.email) people.add(event.email);
  }
  return { events, total: events.length, today, people: people.size };
});

/** Delete every document in a collection matching one equality filter. */
async function deleteDocsWhere(
  collectionName: string,
  field: string,
  value: string
): Promise<number> {
  const snap = await db.collection(collectionName).where(field, "==", value).get();
  let deleted = 0;
  for (let offset = 0; offset < snap.docs.length; offset += 400) {
    const batch = db.batch();
    for (const doc of snap.docs.slice(offset, offset + 400)) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    deleted += Math.min(400, snap.docs.length - offset);
  }
  return deleted;
}

/**
 * Permanently clean up a pharmacy that was already removed from the roster.
 * Deletes linked sign-in accounts and pharmacy-owned operational records;
 * PharmacySales is deliberately kept as the network's audit/report history.
 */
export const deletePharmacyAccount = onCall(async (request) => {
  await requireConsoleManager(request);
  const uid = requireString(request.data?.uid, "uid");
  const targetRef = db.collection("User").doc(uid);
  const target = await targetRef.get();
  const data = target.data();

  if (!target.exists || data?.account_type !== "Pharmacy") {
    throw new HttpsError("not-found", "That pharmacy account no longer exists.");
  }
  if (String(data.role ?? data.role_label ?? "").trim().toLowerCase() !== "owner") {
    throw new HttpsError(
      "failed-precondition",
      "Only a pharmacy owner listing can be permanently deleted."
    );
  }
  if (data.access_revoked !== true && data.listing_removed !== true) {
    throw new HttpsError(
      "failed-precondition",
      "Remove the pharmacy listing before permanently deleting it."
    );
  }

  const pharmacyId = String(data.pharmacy_id ?? "").trim() || uid;
  const profileSnap = await db
    .collection("User")
    .where("account_type", "==", "Pharmacy")
    .get();
  // The owner profile plus every pharmacy staff seat that belongs to the same
  // canonical pharmacy id. Do not match by name: pharmacies can share one.
  const linkedProfiles = profileSnap.docs.filter((doc) => {
    if (doc.id === uid) return true;
    return String(doc.data().pharmacy_id ?? "").trim() === pharmacyId;
  });

  let deletedAuthUsers = 0;
  const authErrors: string[] = [];
  for (const profile of linkedProfiles) {
    try {
      await admin.auth().deleteUser(profile.id);
      deletedAuthUsers += 1;
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code !== "auth/user-not-found") {
        authErrors.push(profile.id);
        console.error(`[deletePharmacyAccount] could not delete auth ${profile.id}:`, error);
      }
    }
  }

  const profileBatch = db.batch();
  for (const profile of linkedProfiles) profileBatch.delete(profile.ref);
  await profileBatch.commit();

  const [deletedInventory, deletedAlerts, deletedInvitations] = await Promise.all([
    deleteDocsWhere("PharmacyInventory", "pharmacyId", pharmacyId),
    deleteDocsWhere("LowStockAlert", "pharmacyId", pharmacyId),
    deleteDocsWhere("Invitation", "pharmacyId", pharmacyId),
  ]);

  return {
    uid,
    deletedAuthUsers,
    deletedProfiles: linkedProfiles.length,
    deletedInventory,
    deletedAlerts,
    deletedInvitations,
    authErrors,
  };
});

/* ------------------------------------------------------------------ */
/* Pharmacy directory + approval (Pulse Owners and Admins)             */
/* ------------------------------------------------------------------ */

export const listPulsePharmacies = onCall(async (request) => {
  await requirePulseActor(request);
  const profiles = await db.collection("User").where("account_type", "==", "Pharmacy").get();
  const owners = await ownerIdsByPharmacyName(profiles);
  type Row = {
    uid: string;
    id: string;
    name: string;
    email: string | null;
    address: string;
    approved: boolean;
    status: "active" | "pending" | "rejected" | "removed";
    previousStatus: "active" | "pending" | "rejected" | null;
    registeredAt: number | null;
    removedAt: number | null;
  };
  const pharmacies: Row[] = [];
  for (const doc of profiles.docs) {
    const data = doc.data();
    if (pharmacyRole(data.role ?? data.role_label) !== "owner") continue;
    const name = String(data.pharmacy_name ?? "").trim();
    if (!name) continue;
    const listed = String(data.listing_status ?? "").trim().toLowerCase();
    const removed = data.listing_removed === true || data.access_revoked === true;
    const previousStatus =
      listed === "pending" || listed === "rejected" || listed === "active"
        ? listed
        : data.approved_by_duniya === true
          ? "active"
          : "pending";
    const status: Row["status"] = removed
      ? "removed"
      : listed === "pending" || listed === "rejected" || listed === "active"
        ? listed
        : data.approved_by_duniya === true
          ? "active"
          : "pending";
    const created = data.created_time as admin.firestore.Timestamp | undefined;
    const removedAt = data.removed_at as admin.firestore.Timestamp | undefined;
    pharmacies.push({
      uid: doc.id,
      id: resolvePharmacyId(data, doc.id, owners),
      name,
      email: String(data.email ?? "").trim().toLowerCase() || null,
      address: String(data.address ?? "").trim(),
      approved: status === "removed" ? previousStatus === "active" : status === "active",
      status,
      previousStatus: status === "removed" ? previousStatus : null,
      registeredAt: created?.toMillis?.() ?? null,
      removedAt: removed ? removedAt?.toMillis?.() ?? null : null,
    });
  }
  return { pharmacies: pharmacies.sort((a, b) => a.name.localeCompare(b.name)) };
});

export const setPharmacyApproval = onCall(async (request) => {
  const actor = await requireConsoleManager(request);
  const uid = requireString(request.data?.uid, "uid");
  const status = String(request.data?.status ?? "pending").trim().toLowerCase();
  if (!["active", "pending", "rejected"].includes(status)) {
    throw new HttpsError("invalid-argument", "Unknown pharmacy approval status.");
  }
  const approved = status === "active";
  const profiles = await db.collection("User").where("account_type", "==", "Pharmacy").get();
  const owners = await ownerIdsByPharmacyName(profiles);
  const target = profiles.docs.find((doc) => doc.id === uid);
  if (!target) throw new HttpsError("not-found", "That pharmacy is not on the Pulse network.");
  const pharmacyId = resolvePharmacyId(target.data(), target.id, owners);
  const batch = db.batch();
  let updated = 0;
  for (const doc of profiles.docs) {
    if (doc.data().access_revoked === true || doc.data().listing_removed === true) continue;
    if (resolvePharmacyId(doc.data(), doc.id, owners) !== pharmacyId) continue;
    batch.update(doc.ref, {
      approved_by_duniya: approved,
      listing_status: status,
      approval_updated_at: admin.firestore.FieldValue.serverTimestamp(),
      approval_updated_by: actor.uid,
    });
    updated += 1;
  }
  await batch.commit();
  return { uid, pharmacyId, approved, status, updated };
});

/* ------------------------------------------------------------------ */
/* Pharmacy team management (pharmacy Owners and Managers)             */
/* ------------------------------------------------------------------ */

export const updatePharmacyTeamMember = onCall(async (request) => {
  const actor = await requirePharmacyActor(request);
  const actorRole = pharmacyRole(actor.role);
  if (actorRole !== "owner" && actorRole !== "manager") {
    throw new HttpsError("permission-denied", "Only Owners and Managers can manage team access.");
  }
  const email = assertEmail(request.data?.email, "email");
  const action = String(request.data?.action ?? "").trim().toLowerCase();
  if (!["role", "suspend", "reactivate", "remove"].includes(action)) {
    throw new HttpsError("invalid-argument", "Unknown team action.");
  }
  const nextRole = action === "role" ? pharmacyRole(request.data?.role) : "";
  if (action === "role" && !PHARMACY_ROLES.has(nextRole)) {
    throw new HttpsError("invalid-argument", "Unknown pharmacy role.");
  }
  if (nextRole === "owner" && actorRole !== "owner") {
    throw new HttpsError("permission-denied", "Only an Owner can hand out the Owner role.");
  }
  const matches = await db.collection("User").where("email", "==", email).get();
  const allProfiles = await db.collection("User").where("account_type", "==", "Pharmacy").get();
  const owners = await ownerIdsByPharmacyName(allProfiles);
  const targets = matches.docs.filter((doc) => {
    const data = doc.data();
    return data.account_type === "Pharmacy" &&
      resolvePharmacyId(data, doc.id, owners) === actor.pharmacyId;
  });
  if (targets.length === 0) {
    throw new HttpsError("not-found", "That teammate isn't part of your pharmacy.");
  }
  if (targets.some((doc) => doc.id === actor.uid)) {
    throw new HttpsError("failed-precondition", "You can't change your own access.");
  }
  const target = targets[0];
  const targetData = target.data();
  const currentRole = pharmacyRole(targetData.role ?? targetData.role_label);
  if (currentRole === "owner") {
    throw new HttpsError("failed-precondition", "The account owner can't be changed here.");
  }
  if (actorRole === "manager" && currentRole === "manager") {
    throw new HttpsError("permission-denied", "Only an Owner can change another Manager.");
  }
  const patch: Record<string, unknown> = {
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_by: actor.uid,
  };
  if (action === "role") {
    patch.role = nextRole;
    patch.role_label = PHARMACY_ROLE_LABEL[nextRole] ?? nextRole;
  }
  if (action === "suspend") patch.access_revoked = true;
  if (action === "reactivate") patch.access_revoked = false;
  if (action === "remove") {
    patch.access_revoked = true;
    patch.status = "removed";
  }
  const batch = db.batch();
  for (const doc of targets) batch.update(doc.ref, patch);
  await batch.commit();
  for (const doc of targets) {
    try {
      if (action === "suspend" || action === "remove") {
        await admin.auth().updateUser(doc.id, { disabled: true });
        await admin.auth().revokeRefreshTokens(doc.id);
      } else if (action === "reactivate") {
        await admin.auth().updateUser(doc.id, { disabled: false });
      }
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code !== "auth/user-not-found") {
        console.error(`[updatePharmacyTeamMember] could not update ${doc.id}:`, error);
      }
    }
  }
  return { email, action, role: action === "role" ? nextRole : currentRole, updated: targets.length };
});

export const updatePharmacyListing = onCall(async (request) => {
  const actor = await requireConsoleManager(request);
  const uid = requireString(request.data?.uid, "uid");
  const action = String(request.data?.action ?? "").trim().toLowerCase();
  if (!["remove", "restore"].includes(action)) {
    throw new HttpsError("invalid-argument", "Unknown pharmacy listing action.");
  }
  const target = await db.collection("User").doc(uid).get();
  const data = target.data();
  if (!target.exists || data?.account_type !== "Pharmacy" || pharmacyRole(data.role ?? data.role_label) !== "owner") {
    throw new HttpsError("not-found", "That pharmacy owner listing no longer exists.");
  }
  if (action === "remove") {
    const patch = {
      access_revoked: true,
      listing_removed: true,
      listing_status: String(request.data?.previousStatus ?? "pending"),
      removed_at: admin.firestore.FieldValue.serverTimestamp(),
      removed_by: actor.uid,
    };
    const pharmacyId = String(data.pharmacy_id ?? uid).trim() || uid;
    const profiles = await db.collection("User").where("account_type", "==", "Pharmacy").get();
    const owners = await ownerIdsByPharmacyName(profiles);
    const batch = db.batch();
    for (const profile of profiles.docs) {
      if (resolvePharmacyId(profile.data(), profile.id, owners) === pharmacyId) {
        batch.update(profile.ref, patch);
      }
    }
    await batch.commit();
    for (const profile of profiles.docs) {
      if (resolvePharmacyId(profile.data(), profile.id, owners) !== pharmacyId) continue;
      try {
        await admin.auth().updateUser(profile.id, { disabled: true });
        await admin.auth().revokeRefreshTokens(profile.id);
      } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        if (code !== "auth/user-not-found") console.error(`[updatePharmacyListing] could not disable ${profile.id}:`, error);
      }
    }
  } else {
    const pharmacyId = String(data.pharmacy_id ?? uid).trim() || uid;
    const profiles = await db.collection("User").where("account_type", "==", "Pharmacy").get();
    const owners = await ownerIdsByPharmacyName(profiles);
    const batch = db.batch();
    for (const profile of profiles.docs) {
      if (resolvePharmacyId(profile.data(), profile.id, owners) !== pharmacyId) continue;
      batch.update(profile.ref, {
        access_revoked: false,
        listing_removed: false,
        approved_by_duniya:
          request.data?.status === "active" ||
          (request.data?.status === undefined && request.data?.approved === true),
        listing_status: ["active", "pending", "rejected"].includes(String(request.data?.status))
          ? String(request.data.status)
          : request.data?.approved === true
            ? "active"
            : "pending",
        restored_at: admin.firestore.FieldValue.serverTimestamp(),
        restored_by: actor.uid,
      });
    }
    await batch.commit();
    for (const profile of profiles.docs) {
      if (resolvePharmacyId(profile.data(), profile.id, owners) !== pharmacyId) continue;
      try {
        await admin.auth().updateUser(profile.id, { disabled: false });
      } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        if (code !== "auth/user-not-found") console.error(`[updatePharmacyListing] could not enable ${profile.id}:`, error);
      }
    }
  }
  return { uid, action };
});

/* ------------------------------------------------------------------ */
/* Pharmacy OTP provisioning                                           */
/* ------------------------------------------------------------------ */
/* Pulse Owner/Admin/Staff create the pharmacy profile here. The OTP is */
/* the only thing the pharmacy needs to activate it: the owner enters   */
/* the code on the login screen, sets a password, and the profile is    */
/* attached to the new Firebase Auth account in one transaction.        */

export const createPharmacyProvisioning = onCall(async (request) => {
  const actor = await requirePulseActor(request);
  const pharmacyName = requireString(request.data?.pharmacyName, "pharmacyName").slice(0, 160);
  const ownerName = requireString(request.data?.ownerName, "ownerName").slice(0, 120);
  const ownerEmail = assertEmail(request.data?.ownerEmail, "ownerEmail");
  const address = String(request.data?.address ?? "").trim().slice(0, 300);
  const phone = String(request.data?.phone ?? "").trim().slice(0, 40);

  if (pharmacyName.length < 2) {
    throw new HttpsError("invalid-argument", "Enter the pharmacy's name.");
  }
  if (ownerName.length < 2) {
    throw new HttpsError("invalid-argument", "Enter the owner's full name.");
  }

  // The email must be free across both portals. A Pulse console account can
  // never be claimed by a pharmacy, so reject it before an unusable OTP exists.
  const emailProfile = await db.collection("User").where("email", "==", ownerEmail).limit(1).get();
  if (!emailProfile.empty) {
    throw new HttpsError(
      "already-exists",
      "This email already has a Pulse account. Use a different owner email."
    );
  }

  const profiles = await db.collection("User").where("account_type", "==", "Pharmacy").get();
  const duplicate = profiles.docs.find((doc) => {
    const data = doc.data();
    return String(data.pharmacy_name ?? "").trim().toLowerCase() === pharmacyName.toLowerCase();
  });
  if (duplicate) {
    throw new HttpsError(
      "already-exists",
      "A pharmacy with this name is already on the Pulse network."
    );
  }

  const expiresAt = Date.now() + PHARMACY_OTP_TTL_MS;
  let code = "";
  let codeHash = "";
  // A collision is astronomically unlikely, but never reuse a live code.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = newPharmacyOtp();
    const candidateHash = hashPharmacyOtp(candidate.body);
    const collision = await db
      .collection("PharmacyProvisioning")
      .where("code_hash", "==", candidateHash)
      .limit(1)
      .get();
    if (collision.empty) {
      code = candidate.code;
      codeHash = candidateHash;
      break;
    }
  }
  if (!code) {
    throw new HttpsError("internal", "Could not create a secure OTP. Please try again.");
  }

  // Re-issuing for the same pharmacy or owner invalidates the old pending
  // code, so there is only ever one live route into the account.
  const pendingSnap = await db
    .collection("PharmacyProvisioning")
    .where("status", "==", "pending")
    .get();
  const stale = pendingSnap.docs.filter((doc) => {
    const data = doc.data();
    return (
      String(data.owner_email ?? "").trim().toLowerCase() === ownerEmail ||
      String(data.pharmacy_name ?? "").trim().toLowerCase() === pharmacyName.toLowerCase()
    );
  });

  const ref = db.collection("PharmacyProvisioning").doc();
  const batch = db.batch();
  for (const doc of stale) {
    batch.update(doc.ref, {
      status: "revoked",
      revoked_at: admin.firestore.FieldValue.serverTimestamp(),
      revoked_by_uid: actor.uid,
    });
  }
  batch.set(ref, {
    pharmacy_name: pharmacyName,
    owner_name: ownerName,
    owner_email: ownerEmail,
    address,
    phone,
    code_hash: codeHash,
    status: "pending",
    attempts: 0,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    created_at_ms: Date.now(),
    expires_at: expiresAt,
    created_by_uid: actor.uid,
    created_by_name: actor.name,
    created_by_email: actor.email,
    created_by_role: actor.role,
  });
  await batch.commit();

  return {
    id: ref.id,
    otp: code,
    expiresAt,
    pharmacyName,
    ownerName,
    ownerEmail,
    address,
  };
});

/** Pending OTP invitations, visible to every Pulse console role. */
export const listPharmacyProvisioning = onCall(async (request) => {
  await requirePulseActor(request);
  const snap = await db
    .collection("PharmacyProvisioning")
    .where("status", "==", "pending")
    .get();
  const now = Date.now();
  const provisioning = snap.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        pharmacyName: String(data.pharmacy_name ?? ""),
        ownerName: String(data.owner_name ?? ""),
        ownerEmail: String(data.owner_email ?? ""),
        address: String(data.address ?? ""),
        createdAt: Number(data.created_at_ms ?? 0),
        expiresAt: Number(data.expires_at ?? 0),
        expired: Number(data.expires_at ?? 0) <= now,
        createdByName: String(data.created_by_name ?? ""),
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 100);
  return { provisioning };
});

/** Resolve an OTP without claiming it, so the login can prefill the account. */
export const resolvePharmacyOtp = onCall(async (request) => {
  const body = normalizePharmacyOtp(request.data?.otp);
  if (!body) {
    throw new HttpsError("not-found", "That OTP is invalid. Check the code and try again.");
  }

  const snap = await db
    .collection("PharmacyProvisioning")
    .where("code_hash", "==", hashPharmacyOtp(body))
    .limit(1)
    .get();
  if (snap.empty) {
    throw new HttpsError("not-found", "That OTP is invalid. Check the code and try again.");
  }

  const doc = snap.docs[0];
  const data = doc.data();
  if (data.status === "claimed") {
    throw new HttpsError("failed-precondition", "This OTP has already been used.");
  }
  if (data.status !== "pending") {
    throw new HttpsError("failed-precondition", "This OTP is no longer valid. Ask Pulse for a new one.");
  }
  if (Number(data.expires_at ?? 0) <= Date.now()) {
    throw new HttpsError("failed-precondition", "This OTP has expired. Ask Pulse for a new one.");
  }

  return {
    provisioningId: doc.id,
    pharmacyName: String(data.pharmacy_name ?? ""),
    ownerName: String(data.owner_name ?? ""),
    ownerEmail: String(data.owner_email ?? ""),
    address: String(data.address ?? ""),
    expiresAt: Number(data.expires_at ?? 0),
  };
});

/** Claim an OTP for the signed-in, matching owner account. */
export const claimPharmacyOtp = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Create the pharmacy sign-in before claiming the OTP.");
  }
  const uid = request.auth.uid;
  const authEmail = String(request.auth.token.email ?? "").trim().toLowerCase();
  if (!authEmail) {
    throw new HttpsError("failed-precondition", "The signed-in account has no email address.");
  }

  const body = normalizePharmacyOtp(request.data?.otp);
  if (!body) {
    throw new HttpsError("not-found", "That OTP is invalid. Check the code and try again.");
  }
  const snap = await db
    .collection("PharmacyProvisioning")
    .where("code_hash", "==", hashPharmacyOtp(body))
    .limit(1)
    .get();
  if (snap.empty) {
    throw new HttpsError("not-found", "That OTP is invalid. Check the code and try again.");
  }

  const emailProfile = await db.collection("User").where("email", "==", authEmail).get();
  if (emailProfile.docs.some((profile) => profile.id !== uid)) {
    throw new HttpsError("already-exists", "This email is already linked to another account.");
  }

  const provisioningRef = snap.docs[0].ref;
  const userRef = db.collection("User").doc(uid);
  const result = await db.runTransaction(async (transaction) => {
    const fresh = await transaction.get(provisioningRef);
    const existing = await transaction.get(userRef);
    if (!fresh.exists) {
      throw new HttpsError("not-found", "That OTP is no longer available.");
    }
    const data = fresh.data() ?? {};
    if (data.status === "claimed" && data.claimed_by_uid === uid) {
      const profile = existing.data() ?? {};
      if (profile.account_type === "Pharmacy" && profile.provisioning_id === provisioningRef.id) {
        return {
          uid,
          email: authEmail,
          pharmacyName: String(profile.pharmacy_name ?? data.pharmacy_name ?? ""),
          ownerName: String(profile.display_name ?? data.owner_name ?? authEmail.split("@")[0]),
        };
      }
    }
    if (data.status === "claimed") {
      throw new HttpsError("failed-precondition", "This OTP has already been used.");
    }
    if (data.status !== "pending") {
      throw new HttpsError("failed-precondition", "This OTP is no longer valid. Ask Pulse for a new one.");
    }
    if (Number(data.expires_at ?? 0) <= Date.now()) {
      throw new HttpsError("failed-precondition", "This OTP has expired. Ask Pulse for a new one.");
    }
    const ownerEmail = String(data.owner_email ?? "").trim().toLowerCase();
    if (ownerEmail !== authEmail) {
      throw new HttpsError(
        "permission-denied",
        "Sign in with the owner email this OTP was created for."
      );
    }

    if (existing.exists) {
      const profile = existing.data() ?? {};
      const accountType = String(profile.account_type ?? "");
      const pharmacyId = String(profile.pharmacy_id ?? "").trim();
      if (accountType === "Pulse") {
        throw new HttpsError(
          "failed-precondition",
          "This email belongs to a Pulse console account, not a pharmacy."
        );
      }
      if (accountType === "Pharmacy" && pharmacyId && pharmacyId !== uid) {
        throw new HttpsError(
          "failed-precondition",
          "This sign-in is already linked to another pharmacy."
        );
      }
      if (accountType === "Pharmacy" && profile.provisioning_id !== provisioningRef.id) {
        throw new HttpsError(
          "failed-precondition",
          "This account already has a pharmacy profile. Use that pharmacy sign-in instead."
        );
      }
    }

    const pharmacyName = String(data.pharmacy_name ?? "").trim();
    const ownerName = String(data.owner_name ?? "").trim() || authEmail.split("@")[0];
    const profile: Record<string, unknown> = {
      email: authEmail,
      uid,
      display_name: ownerName,
      role: "owner",
      role_label: "Owner",
      account_type: "Pharmacy",
      pharmacy_name: pharmacyName,
      pharmacy_id: uid,
      approved_by_duniya: true,
      listing_status: "active",
      listing_removed: false,
      access_revoked: false,
      created_time: admin.firestore.FieldValue.serverTimestamp(),
      provisioning_id: provisioningRef.id,
      otp_validated_at: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (data.address) profile.address = String(data.address);
    if (data.phone) profile.phone = String(data.phone);
    transaction.set(userRef, profile, { merge: true });
    transaction.update(provisioningRef, {
      status: "claimed",
      claimed_by_uid: uid,
      claimed_email: authEmail,
      claimed_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      uid,
      email: authEmail,
      pharmacyName,
      ownerName,
    };
  });

  return result;
});

/* ------------------------------------------------------------------ */
/* Cross-pharmacy POS sales                                            */
/* ------------------------------------------------------------------ */

function cleanPharmacySale(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new HttpsError("invalid-argument", "Each sale must be an object.");
  }
  const raw = value as Record<string, unknown>;
  const id = String(raw.id ?? "").trim();
  const method = String(raw.method ?? "").trim();
  const soldAt = Number(raw.soldAt);
  const subtotal = Number(raw.subtotal);
  const discount = Number(raw.discount);
  const total = Number(raw.total);
  const lines = Array.isArray(raw.lines) ? raw.lines : [];
  if (!id || id.length > 100 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new HttpsError("invalid-argument", "Sale id is invalid.");
  }
  if (!Number.isFinite(soldAt) || soldAt <= 0 || soldAt > Date.now() + 24 * 60 * 60 * 1000) {
    throw new HttpsError("invalid-argument", "Sale time is invalid.");
  }
  if (!["cash", "mobile", "card"].includes(method)) {
    throw new HttpsError("invalid-argument", "Sale payment method is invalid.");
  }
  if (lines.length === 0 || lines.length > 100) {
    throw new HttpsError("invalid-argument", "Sale lines are invalid.");
  }
  if (![subtotal, discount, total].every((amount) => Number.isFinite(amount) && amount >= 0)) {
    throw new HttpsError("invalid-argument", "Sale totals are invalid.");
  }

  const cleanLines = lines.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new HttpsError("invalid-argument", "A sale line is invalid.");
    }
    const line = entry as Record<string, unknown>;
    const qty = Number(line.qty);
    const unitPrice = Number(line.unitPrice);
    const name = String(line.name ?? "").trim();
    const productId = String(line.productId ?? "").trim();
    if (!name || name.length > 200 || !productId || productId.length > 120 ||
        !Number.isInteger(qty) || qty <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new HttpsError("invalid-argument", "A sale line has invalid product details.");
    }
    const allocations = Array.isArray(line.stockAllocations)
      ? line.stockAllocations.slice(0, 100).map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const allocation = entry as Record<string, unknown>;
          return {
            inventoryItemId: String(allocation.inventoryItemId ?? "").slice(0, 120),
            qty: Math.max(0, Number(allocation.qty) || 0),
            storeId: String(allocation.storeId ?? "").slice(0, 120),
            category: String(allocation.category ?? "").slice(0, 120),
            batch: String(allocation.batch ?? "").slice(0, 120),
            expiry: String(allocation.expiry ?? "").slice(0, 30),
            reorderLevel: Math.max(0, Number(allocation.reorderLevel) || 0),
          };
        }).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      : [];
    return { productId, name, qty, unitPrice, stockAllocations: allocations };
  });

  const reversedAt = raw.reversedAt === undefined ? undefined : Number(raw.reversedAt);
  if (reversedAt !== undefined && (!Number.isFinite(reversedAt) || reversedAt <= 0)) {
    throw new HttpsError("invalid-argument", "Sale reversal time is invalid.");
  }

  return {
    id,
    lines: cleanLines,
    subtotal,
    discount,
    total,
    method,
    ...(Number.isFinite(Number(raw.tendered)) ? { tendered: Number(raw.tendered) } : {}),
    ...(Number.isFinite(Number(raw.change)) ? { change: Number(raw.change) } : {}),
    soldAt,
    storeId: String(raw.storeId ?? "").slice(0, 120),
    storeName: String(raw.storeName ?? "").trim().slice(0, 160),
    servedBy: String(raw.servedBy ?? "Front counter").trim().slice(0, 120),
    ...(raw.cashierEmail
      ? { cashierEmail: String(raw.cashierEmail).trim().toLowerCase().slice(0, 254) }
      : {}),
    ...(raw.shiftId ? { shiftId: String(raw.shiftId).trim().slice(0, 80) } : {}),
    ...(reversedAt !== undefined ? { reversedAt } : {}),
    ...(raw.reversedBy ? { reversedBy: String(raw.reversedBy).slice(0, 120) } : {}),
    ...(raw.reversalReason ? { reversalReason: String(raw.reversalReason).slice(0, 500) } : {}),
    ...(typeof raw.refundHandled === "boolean" ? { refundHandled: raw.refundHandled } : {}),
  };
}

/** Pharmacy users mirror their own POS sales; identity comes from User/{uid}. */
export const syncPharmacySales = onCall(async (request) => {
  const actor = await requirePharmacyActor(request);
  const sales = Array.isArray(request.data?.sales) ? request.data.sales : [];
  if (sales.length > 40) {
    throw new HttpsError("invalid-argument", "Sync at most 40 sales at a time.");
  }

  const batch = db.batch();
  for (const entry of sales) {
    const sale = cleanPharmacySale(entry);
    const saleKey = createHash("sha256")
      .update(`${actor.pharmacyId}:${String(sale.id)}:${String(sale.soldAt)}`)
      .digest("hex");
    const ref = db.collection("PharmacySales").doc(`sale_${saleKey}`);
    batch.set(ref, {
      ...sale,
      pharmacyId: actor.pharmacyId,
      pharmacyName: actor.pharmacyName,
      sourceUid: actor.uid,
      syncedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
  return { synced: sales.length };
});

/* ------------------------------------------------------------------ */
/* Pharmacy shifts — open/close cash accountability                    */
/* ------------------------------------------------------------------ */

function cleanPharmacyShift(
  value: unknown,
  actor: PharmacyActor
): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new HttpsError("invalid-argument", "Each shift must be an object.");
  }
  const raw = value as Record<string, unknown>;
  const id = String(raw.id ?? "").trim();
  const cashierEmail = String(raw.cashierEmail ?? "").trim().toLowerCase();
  const storeId = String(raw.storeId ?? "").trim().slice(0, 120);
  const storeName = String(raw.storeName ?? "").trim().slice(0, 160);
  const status = String(raw.status ?? "").trim();
  const openedAt = Number(raw.openedAt);
  const openingFloat = Number(raw.openingFloat);
  const now = Date.now();

  if (!/^SHIFT-\d{1,12}$/.test(id)) {
    throw new HttpsError("invalid-argument", "Shift id is invalid.");
  }
  if (cashierEmail !== actor.email) {
    throw new HttpsError("permission-denied", "A cashier can only sync their own shift.");
  }
  if (!storeId || !storeName) {
    throw new HttpsError("invalid-argument", "Shift store details are invalid.");
  }
  if (status !== "open" && status !== "closed") {
    throw new HttpsError("invalid-argument", "Shift status is invalid.");
  }
  if (!Number.isFinite(openedAt) || openedAt <= 0 || openedAt > now + 5 * 60 * 1000) {
    throw new HttpsError("invalid-argument", "Shift opening time is invalid.");
  }
  if (!Number.isFinite(openingFloat) || openingFloat < 0) {
    throw new HttpsError("invalid-argument", "Shift opening float is invalid.");
  }

  const base = {
    id,
    cashierName: actor.name.slice(0, 120),
    cashierEmail,
    storeId,
    storeName,
    status,
    openedAt,
    openingFloat: Math.round(openingFloat * 100) / 100,
  };

  if (status === "open") return base;

  const closedAt = Number(raw.closedAt);
  const countedCash = Number(raw.countedCash);
  const expectedCash = Number(raw.expectedCash);
  const cashSales = Number(raw.cashSales ?? 0);
  const cashRefunds = Number(raw.cashRefunds ?? 0);
  const mobileSales = Number(raw.mobileSales ?? 0);
  const cardSales = Number(raw.cardSales ?? 0);
  const totalSales = Number(raw.totalSales ?? 0);
  const transactionCount = Number(raw.transactionCount ?? 0);
  const itemsSold = Number(raw.itemsSold ?? 0);

  if (!Number.isFinite(closedAt) || closedAt < openedAt || closedAt > now + 5 * 60 * 1000) {
    throw new HttpsError("invalid-argument", "Shift closing time is invalid.");
  }
  if (![countedCash, expectedCash, cashSales, cashRefunds, mobileSales, cardSales, totalSales]
    .every((amount) => Number.isFinite(amount) && amount >= 0)) {
    throw new HttpsError("invalid-argument", "Shift cash totals are invalid.");
  }

  return {
    ...base,
    closedAt,
    countedCash: Math.round(countedCash * 100) / 100,
    expectedCash: Math.round(expectedCash * 100) / 100,
    // The variance is derived, never trusted from the client.
    variance: Math.round((countedCash - expectedCash) * 100) / 100,
    cashSales: Math.round(cashSales * 100) / 100,
    cashRefunds: Math.round(cashRefunds * 100) / 100,
    mobileSales: Math.round(mobileSales * 100) / 100,
    cardSales: Math.round(cardSales * 100) / 100,
    totalSales: Math.round(totalSales * 100) / 100,
    transactionCount: Math.max(0, Math.round(transactionCount)),
    itemsSold: Math.max(0, Math.round(itemsSold)),
    closedBy: actor.name.slice(0, 120),
    ...(raw.closingNotes
      ? { closingNotes: String(raw.closingNotes).trim().slice(0, 1000) }
      : {}),
    ...(raw.handoverTo
      ? { handoverTo: String(raw.handoverTo).trim().slice(0, 120) }
      : {}),
  };
}

/** Pharmacy cashiers mirror their own shift opens and closes to Firestore. */
export const syncPharmacyShifts = onCall(async (request) => {
  const actor = await requirePharmacyActor(request);
  const shifts = Array.isArray(request.data?.shifts) ? request.data.shifts : [];
  if (shifts.length > 20) {
    throw new HttpsError("invalid-argument", "Sync at most 20 shifts at a time.");
  }

  const batch = db.batch();
  for (const entry of shifts) {
    const shift = cleanPharmacyShift(entry, actor);
    const key = createHash("sha256")
      .update(`${actor.pharmacyId}:${String(shift.id)}`)
      .digest("hex");
    batch.set(
      db.collection("PharmacyShifts").doc(`shift_${key}`),
      {
        ...shift,
        pharmacyId: actor.pharmacyId,
        pharmacyName: actor.pharmacyName,
        sourceUid: actor.uid,
        syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  await batch.commit();
  return { synced: shifts.length };
});

/** Pulse Owners and Admins can review network sales; Staff cannot read them. */
export const listNetworkPharmacySales = onCall(async (request) => {
  await requireConsoleManager(request);
  const requestedLimit = Number(request.data?.limit ?? 100);
  const limit = Number.isInteger(requestedLimit) ? Math.min(200, Math.max(1, requestedLimit)) : 100;
  const startAt = request.data?.startAt === undefined ? undefined : Number(request.data.startAt);
  const endAt = request.data?.endAt === undefined ? undefined : Number(request.data.endAt);
  if ((startAt !== undefined && !Number.isFinite(startAt)) ||
      (endAt !== undefined && !Number.isFinite(endAt)) ||
      (startAt !== undefined && endAt !== undefined && startAt >= endAt)) {
    throw new HttpsError("invalid-argument", "The requested sales date range is invalid.");
  }

  const collection = db.collection("PharmacySales");
  let query: admin.firestore.Query = collection;
  if (startAt !== undefined) query = query.where("soldAt", ">=", startAt);
  if (endAt !== undefined) query = query.where("soldAt", "<", endAt);
  query = query.orderBy("soldAt", "desc");

  const cursor = typeof request.data?.cursor === "string" ? request.data.cursor.trim() : "";
  if (cursor) {
    const cursorDoc = await collection.doc(cursor).get();
    if (cursorDoc.exists) query = query.startAfter(cursorDoc);
  }

  const snap = await query.limit(limit + 1).get();
  const hasMore = snap.docs.length > limit;
  const page = snap.docs.slice(0, limit);
  const profileSnap = await db.collection("User").where("account_type", "==", "Pharmacy").get();
  const activeProfiles = profileSnap.docs.filter((doc) => doc.data().access_revoked !== true);
  const ownerIdsByName = new Map<string, string>();
  for (const profile of activeProfiles) {
    const data = profile.data();
    const name = String(data.pharmacy_name ?? "").trim();
    if (name && String(data.role ?? data.role_label ?? "").trim().toLowerCase() === "owner") {
      ownerIdsByName.set(name.toLowerCase(), profile.id);
    }
  }
  const pharmaciesById = new Map<string, { id: string; name: string }>();
  for (const profile of activeProfiles) {
    const data = profile.data();
    const name = String(data.pharmacy_name ?? "").trim();
    if (!name) continue;
    // Same resolution as requirePharmacyActor and the sales sync stamp:
    // stored pharmacy_id, then the owner's uid, then this profile's uid —
    // never a name slug, which orphaned the directory row from its sales.
    const id = String(data.pharmacy_id ?? "").trim() ||
      ownerIdsByName.get(name.toLowerCase()) ||
      profile.id;
    pharmaciesById.set(id, { id, name });
  }
  const pharmacies = Array.from(pharmaciesById.values()).sort((a, b) => a.name.localeCompare(b.name));
  return {
    sales: page.map((doc) => ({ docId: doc.id, ...doc.data() })),
    pharmacies,
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    hasMore,
  };
});

/* ------------------------------------------------------------------ */
/* Pharmacy inventory sync — the network stock picture                 */
/* ------------------------------------------------------------------ */

function cleanInventoryItem(entry: unknown) {
  if (!entry || typeof entry !== "object") {
    throw new HttpsError("invalid-argument", "Inventory item is invalid.");
  }
  const raw = entry as Record<string, unknown>;
  const id = String(raw.id ?? "").trim().slice(0, 120);
  const name = String(raw.name ?? "").trim().slice(0, 200);
  if (!id || !name) throw new HttpsError("invalid-argument", "Inventory item needs an id and a name.");
  return {
    id,
    name,
    category: String(raw.category ?? "General").trim().slice(0, 120),
    batch: String(raw.batch ?? "").slice(0, 120),
    expiry: String(raw.expiry ?? "").slice(0, 30),
    qty: Math.max(0, Math.round(Number(raw.qty) || 0)),
    reorderLevel: Math.max(0, Math.round(Number(raw.reorderLevel) || 0)),
    unitPrice: Math.max(0, Number(raw.unitPrice) || 0),
    ...(Number.isFinite(Number(raw.costPrice))
      ? { costPrice: Math.max(0, Number(raw.costPrice)) }
      : {}),
    ...(Number.isFinite(Number(raw.markupPercent))
      ? { markupPercent: Math.min(100, Math.max(0, Number(raw.markupPercent))) }
      : {}),
    storeId: String(raw.storeId ?? "st-main").slice(0, 120),
    storeName: String(raw.storeName ?? "").trim().slice(0, 160),
    ...(raw.productId ? { productId: String(raw.productId).slice(0, 120) } : {}),
  };
}

/** Pharmacy users mirror their shelf stock; identity comes from User/{uid}. */
export const syncPharmacyInventory = onCall(async (request) => {
  const actor = await requirePharmacyActor(request);
  const items = Array.isArray(request.data?.items) ? request.data.items : [];
  if (items.length > 200) {
    throw new HttpsError("invalid-argument", "Sync at most 200 inventory items at a time.");
  }
  const cleaned: ReturnType<typeof cleanInventoryItem>[] = items.map((entry: unknown) => cleanInventoryItem(entry));
  const collection = db.collection("PharmacyInventory");

  // Snapshot semantics: rows the pharmacy no longer holds leave the network view.
  const existing = await collection.where("pharmacyId", "==", actor.pharmacyId).get();
  const incomingIds = new Set(cleaned.map((item) => item.id));
  const stale = existing.docs.filter((doc) => !incomingIds.has(String(doc.data().id ?? "")));
  for (let offset = 0; offset < stale.length; offset += 400) {
    const batch = db.batch();
    for (const doc of stale.slice(offset, offset + 400)) batch.delete(doc.ref);
    await batch.commit();
  }

  for (let offset = 0; offset < cleaned.length; offset += 400) {
    const batch = db.batch();
    for (const item of cleaned.slice(offset, offset + 400)) {
      const key = createHash("sha256").update(`${actor.pharmacyId}:${item.id}`).digest("hex");
      batch.set(collection.doc(`inv_${key}`), {
        ...item,
        pharmacyId: actor.pharmacyId,
        pharmacyName: actor.pharmacyName,
        sourceUid: actor.uid,
        syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await batch.commit();
  }
  return { synced: cleaned.length, removed: stale.length };
});

type MedicalProductRecord = {
  id: string;
  name: string;
  category: string;
  normalizedName: string;
  createdAt?: number;
};

function medicalProductSearchPrefixes(name: string): string[] {
  const words = name.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? [];
  const prefixes = new Set<string>();
  const indexedParts = [...words];
  for (const word of words) {
    const parts = [word, ...(word.match(/[\p{L}]+|[\p{N}]+/gu) ?? [])];
    indexedParts.push(...parts.slice(1));
  }
  for (let index = 0; index < words.length - 1; index += 1) {
    const left = words[index];
    const right = words[index + 1];
    if ((/^\p{N}+$/u.test(left) && /^\p{L}+$/u.test(right)) || (/^\p{L}+$/u.test(left) && /^\p{N}+$/u.test(right))) {
      indexedParts.push(`${left}${right}`);
    }
  }
  for (const part of indexedParts) for (let length = 2; length <= part.length; length += 1) prefixes.add(part.slice(0, length));
  return [...prefixes];
}

function normalizedMedicalProductSearchTerms(query: string): string[] {
  return [...new Set(
    query.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? []
  )].filter((term) => term.length >= 2);
}

/** The shared medical register is independent of warehouse batch quantities. */
export const listMedicalProducts = onCall(async (request) => {
  await requirePulseActor(request);
  const collection = db.collection("MedicalProductCatalogue");
  const query = String(request.data?.query ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US");
  const cursor = String(request.data?.cursor ?? "").trim();
  const terms = normalizedMedicalProductSearchTerms(query);
  const pageSize = 100;
  let pageQuery: admin.firestore.Query;
  if (terms.length) {
    const primaryTerm = [...terms].sort((left, right) => right.length - left.length)[0];
    pageQuery = collection.where("searchPrefixes", "array-contains", primaryTerm);
  } else {
    pageQuery = collection.orderBy("normalizedName");
  }
  if (cursor) {
    const cursorSnap = await collection.doc(cursor).get();
    if (cursorSnap.exists) pageQuery = pageQuery.startAfter(cursorSnap);
  }
  const snap = await pageQuery.limit(pageSize).get();
  const docs = snap.docs.filter((doc) => {
    if (!terms.length) return true;
    const prefixes = new Set(Array.isArray(doc.get("searchPrefixes")) ? doc.get("searchPrefixes") as string[] : []);
    return terms.every((term) => prefixes.has(term));
  });
  return {
    products: docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: String(data.name ?? ""),
        category: String(data.category ?? "General"),
        normalizedName: String(data.normalizedName ?? ""),
        ...(typeof data.createdAt === "number" ? { createdAt: data.createdAt } : {}),
      } satisfies MedicalProductRecord;
    }),
    nextCursor: snap.size === pageSize ? snap.docs[snap.docs.length - 1].id : null,
  };
});

/** Reindex existing register documents in resumable batches without creating products. */
export const backfillMedicalProductSearchIndex = onCall(async (request) => {
  await requirePulseActor(request);
  const products = db.collection("MedicalProductCatalogue");
  const progressRef = db.collection("MedicalProductCatalogueMeta").doc("search-prefixes-v1");
  const claim = await db.runTransaction(async (transaction) => {
    const progressSnap = await transaction.get(progressRef);
    const progress = progressSnap.data() ?? {};
    if (progress.done === true) return { done: true as const };
    const now = Date.now();
    if (String(progress.lockId ?? "") && Number(progress.lockedUntil ?? 0) > now) {
      return { done: false as const, busy: true as const };
    }
    const lockId = randomUUID();
    transaction.set(progressRef, { lockId, lockedUntil: now + 120_000 }, { merge: true });
    return {
      done: false as const,
      busy: false as const,
      lockId,
      cursor: String(progress.cursor ?? ""),
    };
  });
  if (claim.done || claim.busy) return claim;

  let pageQuery: admin.firestore.Query = products.orderBy(admin.firestore.FieldPath.documentId());
  if (claim.cursor) {
    const cursorSnap = await products.doc(claim.cursor).get();
    if (cursorSnap.exists) pageQuery = pageQuery.startAfter(cursorSnap);
  }
  const page = await pageQuery.limit(400).get();
  const nextCursor = page.size === 400 ? page.docs[page.docs.length - 1].id : null;
  const updates = page.docs.flatMap((doc) => {
    const name = String(doc.get("name") ?? "");
    const searchPrefixes = medicalProductSearchPrefixes(name);
    const current = doc.get("searchPrefixes");
    const alreadyIndexed = Array.isArray(current) && current.length === searchPrefixes.length &&
      searchPrefixes.every((prefix) => current.includes(prefix));
    return alreadyIndexed ? [] : [{ ref: doc.ref, searchPrefixes }];
  });

  return db.runTransaction(async (transaction) => {
    const progressSnap = await transaction.get(progressRef);
    if (progressSnap.get("lockId") !== claim.lockId) return { done: false, busy: true };
    for (const update of updates) transaction.update(update.ref, { searchPrefixes: update.searchPrefixes });
    transaction.set(progressRef, {
      cursor: nextCursor,
      done: nextCursor === null,
      lockId: admin.firestore.FieldValue.delete(),
      lockedUntil: admin.firestore.FieldValue.delete(),
      processed: admin.firestore.FieldValue.increment(page.size),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { done: nextCursor === null, busy: false, processed: page.size, indexed: updates.length };
  });
});

/** Mirror each pharmacy's existing local catalogue into the shared register. */
export const syncPharmacyMedicalProducts = onCall(async (request) => {
  await requirePharmacyActor(request);
  const input: unknown = request.data?.products;
  if (!Array.isArray(input) || input.length > 400) {
    throw new HttpsError("invalid-argument", "Sync up to 400 catalogue products at a time.");
  }
  const unique = new Map<string, { ref: admin.firestore.DocumentReference; product: MedicalProductRecord }>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const product = raw as Record<string, unknown>;
    const name = String(product.name ?? "").trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 180) continue;
    const normalizedName = name.normalize("NFKC").toLocaleLowerCase("en-US");
    const id = `med_${createHash("sha256").update(normalizedName).digest("hex").slice(0, 40)}`;
    const category = String(product.category ?? "General").trim().slice(0, 80) || "General";
    unique.set(id, {
      ref: db.collection("MedicalProductCatalogue").doc(id),
      product: { id, name, category, normalizedName },
    });
  }
  const entries = [...unique.values()];
  if (!entries.length) return { synced: 0 };
  const existing = await db.getAll(...entries.map((entry) => entry.ref));
  const batch = db.batch();
  let synced = 0;
  for (const [index, snapshot] of existing.entries()) {
    const entry = entries[index];
    const searchPrefixes = medicalProductSearchPrefixes(entry.product.name);
    if (!snapshot.exists) {
      batch.set(entry.ref, { ...entry.product, searchPrefixes, createdAt: Date.now() });
      synced += 1;
    } else if (!Array.isArray(snapshot.get("searchPrefixes"))) {
      batch.set(entry.ref, { searchPrefixes }, { merge: true });
      synced += 1;
    }
  }
  if (synced) await batch.commit();
  return { synced };
});

/** Add a shared medical product definition without creating any stock. */
export const registerMedicalProduct = onCall(async (request) => {
  await requirePulseActor(request);
  const name = String(request.data?.name ?? "").trim().replace(/\s+/g, " ");
  const category = String(request.data?.category ?? "General").trim().slice(0, 80) || "General";
  if (name.length < 2 || name.length > 180) {
    throw new HttpsError("invalid-argument", "Enter a product name between 2 and 180 characters.");
  }
  const normalizedName = name.normalize("NFKC").toLocaleLowerCase("en-US");
  const id = `med_${createHash("sha256").update(normalizedName).digest("hex").slice(0, 40)}`;
  const searchPrefixes = medicalProductSearchPrefixes(name);
  const ref = db.collection("MedicalProductCatalogue").doc(id);
  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists) {
      const data = existing.data() ?? {};
      if (!Array.isArray(data.searchPrefixes)) transaction.update(ref, { searchPrefixes });
      return {
        product: {
          id: existing.id,
          name: String(data.name ?? name),
          category: String(data.category ?? category),
          normalizedName: String(data.normalizedName ?? normalizedName),
          ...(typeof data.createdAt === "number" ? { createdAt: data.createdAt } : {}),
        } satisfies MedicalProductRecord,
        created: false,
      };
    }
    const product: MedicalProductRecord = { id, name, category, normalizedName, createdAt: Date.now() };
    transaction.create(ref, { ...product, searchPrefixes });
    return { product, created: true };
  });
});

/** Registered pharmacies for network views, resolved exactly like sales. */
async function networkPharmacyDirectory() {
  const profileSnap = await db.collection("User").where("account_type", "==", "Pharmacy").get();
  const activeProfiles = profileSnap.docs.filter((doc) => doc.data().access_revoked !== true);
  const ownerIdsByName = new Map<string, string>();
  for (const profile of activeProfiles) {
    const data = profile.data();
    const name = String(data.pharmacy_name ?? "").trim();
    if (name && String(data.role ?? data.role_label ?? "").trim().toLowerCase() === "owner") {
      ownerIdsByName.set(name.toLowerCase(), profile.id);
    }
  }
  const pharmaciesById = new Map<string, { id: string; name: string }>();
  for (const profile of activeProfiles) {
    const data = profile.data();
    const name = String(data.pharmacy_name ?? "").trim();
    if (!name) continue;
    const id = String(data.pharmacy_id ?? "").trim() ||
      ownerIdsByName.get(name.toLowerCase()) ||
      profile.id;
    pharmaciesById.set(id, { id, name });
  }
  return Array.from(pharmaciesById.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every active Pulse console user can review the network's shelves — Staff
 * needs this to run stock work. Sales and account management stay restricted.
 */
export const listNetworkInventory = onCall(async (request) => {
  await requirePulseActor(request);
  const requestedLimit = Number(request.data?.limit ?? 500);
  const limit = Number.isInteger(requestedLimit) ? Math.min(1000, Math.max(1, requestedLimit)) : 500;
  const snap = await db.collection("PharmacyInventory").orderBy("pharmacyName").limit(limit).get();
  return {
    items: snap.docs.map((doc) => ({ docId: doc.id, ...doc.data() })),
    pharmacies: await networkPharmacyDirectory(),
  };
});

/* ------------------------------------------------------------------ */
/* Stock requests — the pharmacy queue and the Pulse receiving desk    */
/* ------------------------------------------------------------------ */
/* A request is written to Firestore first, then the Owners and Admins */
/* on the Pulse console are emailed immediately. Email failure never   */
/* loses the request; the queue remains the source of truth.           */

type StockRequestRecordStatus =
  | "pending"
  | "returned"
  | "approved"
  | "dispatched"
  | "delivered"
  | "rejected"
  | "cancelled";

const DUNIYA_MARKUP = 20;
const RECONCILIATION_CADENCE_MS = 14 * 24 * 60 * 60 * 1000;

function money(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function markupOf(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DUNIYA_MARKUP;
  return Math.round(Math.min(100, Math.max(0, parsed)) * 100) / 100;
}

function duniyaPriceOf(cost: number, markup: number): number {
  return money(Math.max(0, money(cost)) * (1 + markupOf(markup) / 100));
}

function stockRequestDocId(pharmacyId: string, syncId: string): string {
  return `req_${createHash("sha256").update(`${pharmacyId}:${syncId}`).digest("hex")}`;
}

function cleanStockRequest(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new HttpsError("invalid-argument", "Each stock request must be an object.");
  }
  const raw = value as Record<string, unknown>;
  const requestId = String(raw.requestId ?? raw.id ?? "").trim().slice(0, 40);
  const syncId = String(raw.syncId ?? requestId).trim().slice(0, 120);
  const item = String(raw.item ?? "").trim().slice(0, 200);
  const qty = Number(raw.qty);
  const priority = String(raw.priority ?? "routine").trim().toLowerCase();
  const storeId = String(raw.storeId ?? "st-main").trim().slice(0, 120);
  const storeName = String(raw.storeName ?? "Main store").trim().slice(0, 160);
  const notes = String(raw.notes ?? "").trim().slice(0, 1000);
  const productId = String(raw.productId ?? "").trim().slice(0, 120);

  if (!requestId || !/^[A-Za-z0-9_-]{3,40}$/.test(requestId)) {
    throw new HttpsError("invalid-argument", "A stock request has an invalid reference.");
  }
  if (!syncId || !/^[A-Za-z0-9_-]{3,120}$/.test(syncId)) {
    throw new HttpsError("invalid-argument", "A stock request has an invalid sync id.");
  }
  if (!item) throw new HttpsError("invalid-argument", "A stock request needs an item name.");
  if (!Number.isInteger(qty) || qty < 1 || qty > 10000) {
    throw new HttpsError("invalid-argument", "A stock request quantity is invalid.");
  }
  if (priority !== "routine" && priority !== "urgent") {
    throw new HttpsError("invalid-argument", "A stock request priority is invalid.");
  }
  return {
    requestId,
    syncId,
    item,
    qty,
    priority: priority as "routine" | "urgent",
    storeId,
    storeName,
    notes,
    ...(productId ? { productId } : {}),
  };
}

function stockRequestView(doc: admin.firestore.DocumentSnapshot) {
  const data = doc.data() ?? {};
  return { docId: doc.id, ...data } as Record<string, unknown> & { docId: string };
}

/** Supplier acquisition figures are for Pulse staff only. Pharmacies see the
 * Duniya price, which is their purchase price for a dispatched batch. */
function pharmacyStockRequestView(value: Record<string, unknown>) {
  const view = { ...value };
  delete view.unitCost;
  delete view.totalCost;
  delete view.costPrice;
  delete view.supplierCost;
  delete view.supplierUnitCost;
  delete view.totalSupplierCost;
  return view;
}

async function pulseAdminRecipients(): Promise<string[]> {
  const snap = await db.collection("User").where("account_type", "==", "Pulse").get();
  const recipients = new Set<string>();
  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.access_revoked === true) continue;
    const role = pulseRole(data.role ?? data.role_label);
    if (role !== "owner" && role !== "admin") continue;
    const email = String(data.email ?? "").trim().toLowerCase();
    if (EMAIL_RE.test(email)) recipients.add(email);
  }
  return [...recipients];
}

/** One approved, active owner mailbox per pharmacy, with duplicate emails removed. */
async function registeredPharmacyRecipients(): Promise<string[]> {
  const snap = await db.collection("User").where("account_type", "==", "Pharmacy").get();
  const recipients = new Set<string>();
  for (const doc of snap.docs) {
    const data = doc.data();
    if (
      pharmacyRole(data.role ?? data.role_label) !== "owner" ||
      data.approved_by_duniya !== true ||
      data.access_revoked === true ||
      data.listing_removed === true ||
      data.status === "suspended" ||
      data.status === "removed"
    ) continue;
    const email = String(data.email ?? "").trim().toLowerCase();
    if (EMAIL_RE.test(email)) recipients.add(email);
  }
  return [...recipients];
}

/** Send individually so pharmacy addresses are never visible to other recipients. */
async function notifyEmailRecipients(
  fn: string,
  recipients: string[],
  content: EmailContent,
  detail: string
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (let offset = 0; offset < recipients.length; offset += 5) {
    const batch = recipients.slice(offset, offset + 5);
    const results = await Promise.allSettled(
      batch.map((email) => deliver(fn, [email], content, detail))
    );
    sent += results.filter((result) => result.status === "fulfilled").length;
    failed += results.length - results.filter((result) => result.status === "fulfilled").length;
  }
  return { sent, failed };
}

function lusakaTimestamp(value: unknown): string {
  const timestamp = Number(value);
  return new Date(Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now())
    .toLocaleString("en-GB", {
      timeZone: "Africa/Lusaka",
      dateStyle: "medium",
      timeStyle: "short",
    });
}

/** Pharmacy submits one or more lines; the receiving desk is emailed once. */
export const createPharmacyStockRequests = onCall(
  { secrets: [resendApiKey] },
  async (request) => {
    const actor = await requirePharmacyActor(request);
    const rows: unknown[] = Array.isArray(request.data?.requests) ? request.data.requests : [];
    if (rows.length === 0 || rows.length > 50) {
      throw new HttpsError("invalid-argument", "Send between 1 and 50 stock requests at a time.");
    }

    const now = Date.now();
    const cleaned = rows.map((entry: unknown) => cleanStockRequest(entry));
    const refs = cleaned.map((entry) =>
      db.collection("PharmacyStockRequests").doc(stockRequestDocId(actor.pharmacyId, entry.syncId))
    );

    const created = await db.runTransaction(async (transaction) => {
      // Firestore requires every read before the first write. Read the whole
      // batch first so a retry can skip existing requests safely.
      const existing: boolean[] = [];
      for (const ref of refs) {
        const snap = await transaction.get(ref as admin.firestore.DocumentReference);
        existing.push(snap.exists);
      }
      const fresh: typeof cleaned = [];
      for (const [index, ref] of refs.entries()) {
        if (existing[index]) continue;
        const entry = cleaned[index];
        transaction.create(ref, {
          ...entry,
          pharmacyId: actor.pharmacyId,
          pharmacyName: actor.pharmacyName,
          submittedByUid: actor.uid,
          submittedByName: actor.name,
          submittedByEmail: actor.email,
          status: "pending" satisfies StockRequestRecordStatus,
          submittedAt: now,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        fresh.push(entry);
      }
      return fresh;
    });

    let emailed = 0;
    let emailError: string | undefined;
    if (created.length > 0) {
      try {
        const recipients = await pulseAdminRecipients();
        if (recipients.length > 0) {
          const content = stockRequestEmail({
            pharmacyName: actor.pharmacyName,
            storeName: created[0]?.storeName ?? "Main store",
            submittedBy: actor.name,
            submittedByEmail: actor.email,
            submittedAt: new Date(now).toLocaleString("en-GB", {
              timeZone: "Africa/Lusaka",
              dateStyle: "medium",
              timeStyle: "short",
            }),
            items: created.map((entry) => ({
              requestId: entry.requestId,
              item: entry.item,
              qty: entry.qty,
              priority: entry.priority,
              ...(entry.notes ? { note: entry.notes } : {}),
            })),
            consoleUrl: `${appUrlFor(request)}dashboard/?page=requests`,
          });
          const results = await Promise.allSettled(
            recipients.map((email) =>
              deliver("createPharmacyStockRequests", [email], content, "Stock request received")
            )
          );
          emailed = results.filter((result) => result.status === "fulfilled").length;
          if (emailed === 0) emailError = "The request was saved but no notification email was delivered.";
        } else {
          emailError = "No active Pulse Owners or Admins were found to notify.";
        }
      } catch (error) {
        emailError = error instanceof Error ? error.message.slice(0, 300) : "Notification email failed.";
        console.error("[createPharmacyStockRequests] notification failed", error);
      }
    }

    return {
      created: created.length,
      skipped: cleaned.length - created.length,
      emailed,
      requestDocs: refs.map((ref, index) => ({
        docId: ref.id,
        requestId: cleaned[index].requestId,
        syncId: cleaned[index].syncId,
      })),
      ...(emailError ? { emailError } : {}),
    };
  }
);

/** The pharmacy's own network queue, used to merge statuses back into the device. */
export const listMyPharmacyStockRequests = onCall(async (request) => {
  const actor = await requirePharmacyActor(request);
  const snap = await db
    .collection("PharmacyStockRequests")
    .where("pharmacyId", "==", actor.pharmacyId)
    .limit(500)
    .get();
  return {
    requests: snap.docs
      .map((doc) => pharmacyStockRequestView(stockRequestView(doc)))
      .sort((a, b) => Number(b.submittedAt ?? 0) - Number(a.submittedAt ?? 0)),
  };
});

/** Pulse receiving desk: every pharmacy request, newest first. */
export const listReceivedStockRequests = onCall(async (request) => {
  await requirePulseActor(request);
  const requestedLimit = Number(request.data?.limit ?? 500);
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(1000, Math.max(1, requestedLimit))
    : 500;
  const snap = await db
    .collection("PharmacyStockRequests")
    .orderBy("submittedAt", "desc")
    .limit(limit)
    .get();
  return { requests: snap.docs.map(stockRequestView) };
});

/** Shared stock request discussion. Pulse may return a request for edits; the
 * pharmacy replies to that return and moves it back into the review queue. */
export const respondToStockRequest = onCall(async (request) => {
  const docId = String(request.data?.docId ?? "").trim();
  const suppliedComment = String(request.data?.comment ?? "").trim().slice(0, 2000);
  const shouldReturn = request.data?.returnToPharmacy === true;
  const attachments = Array.isArray(request.data?.attachments) ? request.data.attachments : [];
  if (!docId || (!suppliedComment && attachments.length === 0)) {
    throw new HttpsError("invalid-argument", "Add a comment or an attachment before sending.");
  }
  if (attachments.length > 5) throw new HttpsError("invalid-argument", "Attach up to 5 files per comment.");

  let actor: PulseActor | PharmacyActor;
  let side: "pulse" | "pharmacy";
  if (shouldReturn) {
    actor = await requirePulseActor(request);
    side = "pulse";
  } else {
    // Resolve the actor from the profile while keeping the request scoped to
    // its pharmacy below. A Pulse user cannot use this path to impersonate one.
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to reply to this request.");
    const profile = await db.collection("User").doc(request.auth.uid).get();
    if (profile.data()?.account_type === "Pulse") {
      actor = await requirePulseActor(request);
      side = "pulse";
    } else {
      actor = await requirePharmacyActor(request);
      side = "pharmacy";
    }
  }

  const safeAttachments = attachments.map((raw: unknown) => {
    if (!raw || typeof raw !== "object") throw new HttpsError("invalid-argument", "An attachment is invalid.");
    const value = raw as Record<string, unknown>;
    const path = String(value.path ?? "");
    const name = String(value.name ?? "").trim().slice(0, 180);
    const contentType = String(value.contentType ?? "").toLowerCase();
    const size = Number(value.size);
    if (!path.startsWith(`stock-request-attachments/${docId}/${actor.uid}/`) || !name ||
      !Number.isInteger(size) || size < 1 || size > 10 * 1024 * 1024 ||
      !["application/pdf", "application/msword", "image/jpeg", "image/png", "image/webp", "image/gif", "text/plain", "text/csv", "application/rtf", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation"].includes(contentType)) {
      throw new HttpsError("invalid-argument", "An attachment is invalid or too large.");
    }
    return { path, name, contentType, size };
  });
  const comment = suppliedComment || "Supporting files attached with this request.";
  for (const attachment of safeAttachments) {
    const [exists] = await admin.storage().bucket().file(attachment.path).exists();
    if (!exists) throw new HttpsError("failed-precondition", "An attachment did not finish uploading. Try again.");
  }

  const ref = db.collection("PharmacyStockRequests").doc(docId);
  const result = await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "That stock request no longer exists.");
    const data = snap.data() ?? {};
    if (side === "pulse" && !shouldReturn) {
      throw new HttpsError("failed-precondition", "Use the return action to request changes from the pharmacy.");
    }
    if (side === "pharmacy" && String(data.pharmacyId ?? "") !== (actor as PharmacyActor).pharmacyId) {
      throw new HttpsError("permission-denied", "This stock request belongs to another pharmacy.");
    }
    const status = String(data.status ?? "");
    if (shouldReturn && (status !== "pending" && status !== "approved")) {
      throw new HttpsError("failed-precondition", "Only pending or approved requests can be returned.");
    }
    if (side === "pharmacy" && status !== "returned" && status !== "pending" && status !== "approved") {
      throw new HttpsError("failed-precondition", "This request can no longer be updated by the pharmacy.");
    }
    const entry = {
      id: randomUUID(),
      side,
      author: actor.name,
      authorUid: actor.uid,
      comment,
      attachments: safeAttachments,
      createdAt: Date.now(),
    };
    const updatedAt = Date.now();
    const patch: Record<string, unknown> = {
      comments: admin.firestore.FieldValue.arrayUnion(entry),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (shouldReturn) {
      patch.status = "returned";
      patch.approvedAt = admin.firestore.FieldValue.delete();
      patch.approvedBy = admin.firestore.FieldValue.delete();
      patch.approvedByUid = admin.firestore.FieldValue.delete();
      patch.returnedAt = Date.now();
      patch.returnedBy = actor.name;
      patch.returnedByUid = actor.uid;
    } else if (side === "pharmacy" && status === "returned") {
      patch.status = "pending";
      patch.resubmittedAt = Date.now();
      patch.resubmittedBy = actor.name;
      patch.resubmittedByUid = actor.uid;
    }
    transaction.update(ref, patch);
    const returnedFields = shouldReturn
      ? { status: "returned", returnedAt: entry.createdAt, returnedBy: actor.name, returnedByUid: actor.uid }
      : side === "pharmacy" && status === "returned"
        ? { status: "pending", resubmittedAt: entry.createdAt, resubmittedBy: actor.name, resubmittedByUid: actor.uid }
        : { status };
    const view: Record<string, unknown> = {
      docId,
      ...data,
      ...returnedFields,
      comments: [...(Array.isArray(data.comments) ? data.comments : []), entry],
      updatedAt,
    };
    if (shouldReturn) {
      delete view.approvedAt;
      delete view.approvedBy;
      delete view.approvedByUid;
    }
    return view;
  });
  return { request: side === "pharmacy" ? pharmacyStockRequestView(result) : result };
});

/** Approve, reject or dispatch a request. Prices are computed server-side. */
export const updateReceivedStockRequest = onCall({ secrets: [resendApiKey] }, async (request) => {
  const actor = await requirePulseActor(request);
  const docId = String(request.data?.docId ?? "").trim();
  const action = String(request.data?.action ?? "").trim();
  if (!docId || !["approve", "reject", "dispatch"].includes(action)) {
    throw new HttpsError("invalid-argument", "The stock request action is invalid.");
  }

  const ref = db.collection("PharmacyStockRequests").doc(docId);
  const updated = await db.runTransaction<Record<string, unknown>>(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "That stock request no longer exists.");
    const data = snap.data() ?? {};
    const status = String(data.status ?? "") as StockRequestRecordStatus;
    let patch: Record<string, unknown>;

    if (action === "approve") {
      if (status !== "pending") {
        throw new HttpsError("failed-precondition", "Only a pending request can be approved.");
      }
      patch = {
        status: "approved",
        approvedAt: Date.now(),
        approvedBy: actor.name,
        approvedByUid: actor.uid,
      };
    } else if (action === "reject") {
      if (status !== "pending" && status !== "approved") {
        throw new HttpsError("failed-precondition", "This request can no longer be rejected.");
      }
      const reason = String(request.data?.reason ?? "").trim().slice(0, 500);
      patch = {
        status: "rejected",
        decisionNote: reason,
        rejectedAt: Date.now(),
        rejectedBy: actor.name,
        rejectedByUid: actor.uid,
      };
    } else {
      if (status !== "approved") {
        throw new HttpsError("failed-precondition", "Approve the request before dispatching it.");
      }
      const unitCost = money(Number(request.data?.unitCost));
      const markupPercent = markupOf(request.data?.markupPercent);
      const batch = String(request.data?.batch ?? "").trim().slice(0, 120);
      const expiry = String(request.data?.expiry ?? "").trim().slice(0, 30);
      const note = String(request.data?.note ?? "").trim().slice(0, 500);
      if (!Number.isFinite(unitCost) || unitCost <= 0) {
        throw new HttpsError("invalid-argument", "Enter the supplier cost for this dispatch.");
      }
      if (!batch) throw new HttpsError("invalid-argument", "Choose or enter the batch being dispatched.");
      if (!expiry) throw new HttpsError("invalid-argument", "Enter the batch expiry date.");
      const qty = Number(data.qty ?? 0);
      const duniyaUnitPrice = duniyaPriceOf(unitCost, markupPercent);
      patch = {
        status: "dispatched",
        unitCost,
        markupPercent,
        duniyaUnitPrice,
        totalCost: money(unitCost * qty),
        totalDuniya: money(duniyaUnitPrice * qty),
        batch,
        expiry,
        ...(note ? { dispatchNote: note } : {}),
        dispatchedAt: Date.now(),
        dispatchedBy: actor.name,
        dispatchedByUid: actor.uid,
      };
    }

    transaction.update(ref, {
      ...patch,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { docId: ref.id, ...data, ...patch };
  });

  if (action === "dispatch") {
    try {
      const recipients = await registeredPharmacyRecipients();
      if (recipients.length === 0) {
        console.warn("[updateReceivedStockRequest] no active pharmacy owners to notify about dispatch");
      } else {
        const content = stockRequestFulfilledEmail({
          item: String(updated.item ?? "Requested stock"),
          qty: Math.max(0, Math.round(Number(updated.qty ?? 0))),
          batch: String(updated.batch ?? ""),
          expiry: String(updated.expiry ?? ""),
          dispatchedAt: lusakaTimestamp(updated.dispatchedAt),
          pharmacyUrl: `${appUrlFor(request)}pharmacy/`,
        });
        const result = await notifyEmailRecipients(
          "updateReceivedStockRequest",
          recipients,
          content,
          `Stock dispatched: ${String(updated.item ?? "requested stock")}`
        );
        if (result.failed > 0) {
          console.warn(`[updateReceivedStockRequest] fulfillment email sent to ${result.sent}; failed for ${result.failed} pharmacies`);
        }
      }
    } catch (error) {
      console.error("[updateReceivedStockRequest] dispatch saved but pharmacy notification failed", error);
    }
  }

  return { request: updated };
});

/** Pharmacy withdraws a request that has not left the hub yet. */
export const cancelPharmacyStockRequest = onCall(async (request) => {
  const actor = await requirePharmacyActor(request);
  const docId = String(request.data?.docId ?? "").trim();
  if (!docId) throw new HttpsError("invalid-argument", "The stock request is missing.");
  const ref = db.collection("PharmacyStockRequests").doc(docId);
  const updated = await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "That stock request no longer exists.");
    const data = snap.data() ?? {};
    if (String(data.pharmacyId ?? "") !== actor.pharmacyId) {
      throw new HttpsError("permission-denied", "This stock request belongs to another pharmacy.");
    }
    const status = String(data.status ?? "");
    if (status === "dispatched" || status === "delivered") {
      throw new HttpsError("failed-precondition", "Dispatched stock can no longer be cancelled.");
    }
    if (status === "rejected" || status === "cancelled") {
      return pharmacyStockRequestView(stockRequestView(snap));
    }
    const reason = String(request.data?.reason ?? "Withdrawn by pharmacy").trim().slice(0, 500);
    const patch = {
      status: "cancelled",
      decisionNote: reason,
      cancelledAt: Date.now(),
      cancelledBy: actor.name,
      cancelledByUid: actor.uid,
    };
    transaction.update(ref, {
      ...patch,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return pharmacyStockRequestView({ docId: ref.id, ...data, ...patch });
  });
  return { request: updated };
});

/** Pharmacy receives a dispatched line and records the retail price it chose. */
export const receivePharmacyStockRequest = onCall({ secrets: [resendApiKey] }, async (request) => {
  const actor = await requirePharmacyActor(request);
  const docId = String(request.data?.docId ?? "").trim();
  const retailUnitPrice = money(Number(request.data?.retailUnitPrice));
  if (!docId) throw new HttpsError("invalid-argument", "The stock request is missing.");
  if (!Number.isFinite(retailUnitPrice) || retailUnitPrice <= 0) {
    throw new HttpsError("invalid-argument", "Set a retail price for this delivery.");
  }

  const ref = db.collection("PharmacyStockRequests").doc(docId);
  const outcome = await db.runTransaction<{
    request: Record<string, unknown>;
    newlyDelivered: boolean;
  }>(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "That stock request no longer exists.");
    const data = snap.data() ?? {};
    if (String(data.pharmacyId ?? "") !== actor.pharmacyId) {
      throw new HttpsError("permission-denied", "This stock request belongs to another pharmacy.");
    }
    const status = String(data.status ?? "");
    if (status === "delivered") {
      return {
        request: pharmacyStockRequestView({ ...stockRequestView(snap), alreadyDelivered: true }),
        newlyDelivered: false,
      };
    }
    if (status !== "dispatched") {
      throw new HttpsError("failed-precondition", "This request has not been dispatched yet.");
    }
    const qty = Number(data.qty ?? 0);
    const patch = {
      status: "delivered",
      retailUnitPrice,
      totalRetail: money(retailUnitPrice * qty),
      deliveredAt: Date.now(),
      receivedBy: actor.name,
      receivedByUid: actor.uid,
    };
    transaction.update(ref, {
      ...patch,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return {
      request: pharmacyStockRequestView({ docId: ref.id, ...data, ...patch }),
      newlyDelivered: true,
    };
  });
  if (outcome.newlyDelivered) {
    try {
      const recipients = await pulseAdminRecipients();
      if (recipients.length === 0) {
        console.warn("[receivePharmacyStockRequest] no active Pulse Owners or Admins to notify about delivery");
      } else {
        const content = stockDeliveryCompletedEmail({
          pharmacyName: String(outcome.request.pharmacyName ?? actor.pharmacyName),
          item: String(outcome.request.item ?? "Requested stock"),
          qty: Math.max(0, Math.round(Number(outcome.request.qty ?? 0))),
          batch: String(outcome.request.batch ?? ""),
          receivedBy: actor.name,
          deliveredAt: lusakaTimestamp(outcome.request.deliveredAt),
          consoleUrl: `${appUrlFor(request)}dashboard/?page=requests`,
        });
        const result = await notifyEmailRecipients(
          "receivePharmacyStockRequest",
          recipients,
          content,
          `Delivery completed: ${String(outcome.request.item ?? "requested stock")}`
        );
        if (result.failed > 0) {
          console.warn(`[receivePharmacyStockRequest] delivery email sent to ${result.sent}; failed for ${result.failed} Pulse admins`);
        }
      }
    } catch (error) {
      console.error("[receivePharmacyStockRequest] delivery saved but Pulse notification failed", error);
    }
  }
  return { request: outcome.request };
});

/* ------------------------------------------------------------------ */
/* Two-week stock reconciliation (physical count audit)               */
/* ------------------------------------------------------------------ */

function cleanReconciliationLine(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new HttpsError("invalid-argument", "Each audit line must be an object.");
  }
  const raw = value as Record<string, unknown>;
  const name = String(raw.name ?? "").trim().slice(0, 200);
  if (!name) throw new HttpsError("invalid-argument", "Every audit line needs a product name.");
  const expectedQty = Number(raw.expectedQty);
  const countedQty = Number(raw.countedQty);
  const retailPrice = Math.max(0, money(Number(raw.retailPrice ?? 0)));
  const markupPercent = markupOf(raw.markupPercent);
  const rawCost = Number(raw.costPrice);
  const costPrice = Math.max(
    0,
    money(Number.isFinite(rawCost) ? rawCost : retailPrice / (1 + markupPercent / 100))
  );
  if (!Number.isFinite(expectedQty) || expectedQty < 0 || expectedQty > 1_000_000) {
    throw new HttpsError("invalid-argument", "An audit expected quantity is invalid.");
  }
  if (!Number.isFinite(countedQty) || countedQty < 0 || countedQty > 1_000_000) {
    throw new HttpsError("invalid-argument", "An audit physical count is invalid.");
  }
  return {
    ...(raw.itemId ? { itemId: String(raw.itemId).slice(0, 120) } : {}),
    ...(raw.productId ? { productId: String(raw.productId).slice(0, 120) } : {}),
    name,
    category: String(raw.category ?? "General").trim().slice(0, 120),
    batch: String(raw.batch ?? "").trim().slice(0, 120),
    expiry: String(raw.expiry ?? "").trim().slice(0, 30),
    storeId: String(raw.storeId ?? "").trim().slice(0, 120),
    storeName: String(raw.storeName ?? "").trim().slice(0, 160),
    expectedQty: Math.round(expectedQty),
    countedQty: Math.round(countedQty),
    costPrice,
    markupPercent,
    retailPrice,
  };
}

function reconciliationView(doc: admin.firestore.DocumentSnapshot) {
  const data = doc.data() ?? {};
  return { id: doc.id, ...data };
}

/** Pulse records a completed two-week physical count for a pharmacy/store. */
export const savePharmacyReconciliation = onCall(async (request) => {
  const actor = await requirePulseActor(request);
  const pharmacyId = String(request.data?.pharmacyId ?? "").trim();
  const pharmacyName = String(request.data?.pharmacyName ?? "").trim().slice(0, 160);
  const storeId = String(request.data?.storeId ?? "").trim().slice(0, 120);
  const storeName = String(request.data?.storeName ?? "").trim().slice(0, 160);
  const notes = String(request.data?.notes ?? "").trim().slice(0, 2000);
  const rawLines: unknown[] = Array.isArray(request.data?.lines) ? request.data.lines : [];
  if (!pharmacyId || !pharmacyName) {
    throw new HttpsError("invalid-argument", "Choose the pharmacy being counted.");
  }
  if (!storeId || !storeName) {
    throw new HttpsError("invalid-argument", "Choose the store being counted.");
  }
  if (rawLines.length === 0 || rawLines.length > 500) {
    throw new HttpsError("invalid-argument", "An audit needs between 1 and 500 lines.");
  }

  const lines = rawLines.map((entry: unknown) => cleanReconciliationLine(entry)).map((line) => {
    const varianceQty = line.countedQty - line.expectedQty;
    const duniyaPrice = duniyaPriceOf(line.costPrice, line.markupPercent);
    return {
      ...line,
      varianceQty,
      duniyaPrice,
      expectedCostValue: money(line.expectedQty * line.costPrice),
      expectedDuniyaValue: money(line.expectedQty * duniyaPrice),
      expectedRetailValue: money(line.expectedQty * line.retailPrice),
      varianceCostValue: money(varianceQty * line.costPrice),
      varianceDuniyaValue: money(varianceQty * duniyaPrice),
      varianceRetailValue: money(varianceQty * line.retailPrice),
    };
  });

  const totals = lines.reduce(
    (acc, line) => {
      acc.expectedUnits += line.expectedQty;
      acc.countedUnits += line.countedQty;
      acc.varianceUnits += line.varianceQty;
      if (line.varianceQty < 0) {
        acc.shortageUnits += Math.abs(line.varianceQty);
        acc.shortLines += 1;
      } else if (line.varianceQty > 0) {
        acc.overageUnits += line.varianceQty;
        acc.overLines += 1;
      } else {
        acc.balancedLines += 1;
      }
      acc.expectedCostValue = money(acc.expectedCostValue + line.expectedCostValue);
      acc.expectedDuniyaValue = money(acc.expectedDuniyaValue + line.expectedDuniyaValue);
      acc.expectedRetailValue = money(acc.expectedRetailValue + line.expectedRetailValue);
      acc.varianceCostValue = money(acc.varianceCostValue + line.varianceCostValue);
      acc.varianceDuniyaValue = money(acc.varianceDuniyaValue + line.varianceDuniyaValue);
      acc.varianceRetailValue = money(acc.varianceRetailValue + line.varianceRetailValue);
      return acc;
    },
    {
      expectedUnits: 0,
      countedUnits: 0,
      varianceUnits: 0,
      shortageUnits: 0,
      overageUnits: 0,
      balancedLines: 0,
      shortLines: 0,
      overLines: 0,
      expectedCostValue: 0,
      expectedDuniyaValue: 0,
      expectedRetailValue: 0,
      varianceCostValue: 0,
      varianceDuniyaValue: 0,
      varianceRetailValue: 0,
    }
  );

  const now = Date.now();
  const ref = db.collection("PharmacyReconciliations").doc();
  await ref.set({
    pharmacyId,
    pharmacyName,
    storeId,
    storeName,
    status: "completed",
    lines,
    totals: { ...totals, lineCount: lines.length },
    notes,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
    completedAtMs: now,
    nextDueAt: now + RECONCILIATION_CADENCE_MS,
    auditor: actor.name,
    auditorEmail: actor.email,
    auditorUid: actor.uid,
  });

  return {
    id: ref.id,
    pharmacyId,
    pharmacyName,
    storeId,
    storeName,
    completedAtMs: now,
    nextDueAt: now + RECONCILIATION_CADENCE_MS,
    totals: { ...totals, lineCount: lines.length },
    notes,
    auditor: actor.name,
    auditorEmail: actor.email,
  };
});

/** Audit history for the Pulse reconciliation desk. */
export const listPharmacyReconciliations = onCall(async (request) => {
  await requirePulseActor(request);
  const requestedLimit = Number(request.data?.limit ?? 100);
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(300, Math.max(1, requestedLimit))
    : 100;
  const snap = await db
    .collection("PharmacyReconciliations")
    .orderBy("completedAtMs", "desc")
    .limit(limit)
    .get();
  return {
    reconciliations: snap.docs.map((doc) => {
      const data = doc.data();
      const lines = Array.isArray(data.lines) ? data.lines : [];
      return {
        id: doc.id,
        pharmacyId: data.pharmacyId,
        pharmacyName: data.pharmacyName,
        storeId: data.storeId,
        storeName: data.storeName,
        completedAtMs: data.completedAtMs,
        nextDueAt: data.nextDueAt,
        auditor: data.auditor,
        auditorEmail: data.auditorEmail,
        notes: data.notes,
        lineCount: lines.length,
        totals: data.totals ?? {},
        shortLines: Array.isArray(lines) ? lines.filter((line: { varianceQty?: number }) => Number(line.varianceQty) < 0).length : 0,
      };
    }),
  };
});

/** One audit with every line, for the detail drawer. */
export const getPharmacyReconciliation = onCall(async (request) => {
  await requirePulseActor(request);
  const id = String(request.data?.id ?? "").trim();
  if (!id) throw new HttpsError("invalid-argument", "The audit reference is missing.");
  const snap = await db.collection("PharmacyReconciliations").doc(id).get();
  if (!snap.exists) throw new HttpsError("not-found", "That audit no longer exists.");
  return { reconciliation: reconciliationView(snap) };
});

/* ------------------------------------------------------------------ */
/* sendLowStockAlert — one consolidated low-stock email per trigger     */
/* ------------------------------------------------------------------ */
/* The pharmacy console posts every item that reached its trigger limit */
/* after a stock change; this sends them as a single message and then   */
/* throttles repeats so a busy counter cannot flood the inbox.          */

/** Repeats for the same pharmacy are held to one alert per window. */
const LOW_STOCK_ALERT_WINDOW_MS = 12 * 60 * 60 * 1000;

export const sendLowStockAlert = onCall({ secrets: [resendApiKey] }, async (request) => {
  const actor = await requirePharmacyActor(request);

  const triggerLimit = Math.max(0, Math.round(Number(request.data?.triggerLimit) || 0));
  const rawItems: unknown[] = Array.isArray(request.data?.items) ? request.data.items : [];

  const items = rawItems
    .slice(0, 100)
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const raw = entry as Record<string, unknown>;
      const name = String(raw.name ?? "").trim().slice(0, 200);
      if (!name) return null;
      return {
        name,
        category: String(raw.category ?? "General").trim().slice(0, 120) || "General",
        batch: String(raw.batch ?? "").trim().slice(0, 120),
        qty: Math.max(0, Math.round(Number(raw.qty) || 0)),
        reorderLevel: Math.max(0, Math.round(Number(raw.reorderLevel) || 0)),
        storeName: String(raw.storeName ?? "").trim().slice(0, 160),
        // The store's own limit (or the account default) that this shelf crossed.
        triggerLimit: Math.max(0, Math.round(Number(raw.triggerLimit) || triggerLimit)),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => a.qty - b.qty || a.name.localeCompare(b.name));

  if (items.length === 0) return { sent: false, reason: "no-triggers" };

  // Configured mailboxes win (comma/semicolon separated); otherwise the person
  // who triggered the alert gets it. Ten addresses is plenty for one branch list.
  const requested = String(request.data?.email ?? "")
    .split(/[,;\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => EMAIL_RE.test(entry));
  const fallback = String(actor.email ?? "").trim().toLowerCase();
  const recipients = Array.from(new Set(requested.length > 0 ? requested : [fallback].filter(Boolean))).slice(0, 10);
  if (recipients.length === 0) return { sent: false, reason: "no-recipient" };

  const stateRef = db
    .collection("LowStockAlert")
    .doc(createHash("sha256").update(String(actor.pharmacyId ?? recipients[0])).digest("hex"));

  const now = Date.now();
  const state = await stateRef.get();
  const lastSentAt = Number(state.data()?.lastSentAt ?? 0);
  if (lastSentAt > 0 && now - lastSentAt < LOW_STOCK_ALERT_WINDOW_MS) {
    return {
      sent: false,
      reason: "throttled",
      nextEligibleAt: new Date(lastSentAt + LOW_STOCK_ALERT_WINDOW_MS).toISOString(),
    };
  }

  const pharmacyName = String(
    request.data?.pharmacyName ?? state.data()?.pharmacyName ?? "Your pharmacy"
  ).trim();

  const content = lowStockAlertEmail({
    pharmacyName,
    items,
    consoleUrl: appUrlFor(request),
    triggeredAt: new Date(now).toLocaleString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Africa/Lusaka",
    }),
  });

  const messageId = await deliver(
    "sendLowStockAlert",
    recipients,
    content,
    `${items.length} item(s) at or below their trigger limit`
  );

  await stateRef.set(
    {
      pharmacyId: actor.pharmacyId ?? null,
      pharmacyName,
      recipients,
      triggerLimit,
      itemCount: items.length,
      lastSentAt: now,
      lastSentAtIso: new Date(now).toISOString(),
      lastSignature: createHash("sha256")
        .update(items.map((item) => `${item.name}:${item.qty}`).join("|"))
        .digest("hex"),
    },
    { merge: true }
  );

  return { sent: true, messageId, recipients, itemCount: items.length };
});

/* ------------------------------------------------------------------ */
/* sendReceiptEmail — email the generated POS receipt                  */
/* ------------------------------------------------------------------ */
/* Called from the sale-complete dialog. The pharmacy identity and logo */
/* stamp come from the authenticated User profile, never the client, so */
/* a receipt can't be sent under another pharmacy's name.               */

type CleanReceipt = {
  id: string;
  storeName: string;
  soldAt: number;
  lines: ReceiptEmailLine[];
  subtotal: number;
  discount: number;
  total: number;
  method: "cash" | "mobile" | "card";
  tendered?: number;
  change?: number;
  servedBy: string;
};

function receiptAmount(value: unknown): number {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000) {
    throw new HttpsError("invalid-argument", "The receipt contains an invalid amount.");
  }
  return Math.round(amount * 100) / 100;
}

function cleanReceipt(value: unknown): CleanReceipt {
  if (!value || typeof value !== "object") {
    throw new HttpsError("invalid-argument", "The receipt is missing.");
  }
  const raw = value as Record<string, unknown>;
  const id = String(raw.id ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
    throw new HttpsError("invalid-argument", "The receipt number is invalid.");
  }
  const soldAt = Number(raw.soldAt);
  if (!Number.isFinite(soldAt) || soldAt <= 0 || soldAt > Date.now() + 24 * 60 * 60 * 1000) {
    throw new HttpsError("invalid-argument", "The receipt time is invalid.");
  }
  const method = String(raw.method ?? "").trim().toLowerCase();
  if (!["cash", "mobile", "card"].includes(method)) {
    throw new HttpsError("invalid-argument", "The receipt payment method is invalid.");
  }
  const rawLines = Array.isArray(raw.lines) ? raw.lines : [];
  if (rawLines.length === 0 || rawLines.length > 100) {
    throw new HttpsError("invalid-argument", "The receipt has no items.");
  }

  const lines = rawLines.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new HttpsError("invalid-argument", "A receipt line is invalid.");
    }
    const line = entry as Record<string, unknown>;
    const name = String(line.name ?? "").trim();
    const qty = Number(line.qty);
    if (!name || name.length > 200 || !Number.isInteger(qty) || qty <= 0 || qty > 10_000) {
      throw new HttpsError("invalid-argument", "A receipt line has invalid details.");
    }
    return { name, qty, unitPrice: receiptAmount(line.unitPrice) };
  });

  // Amounts are recomputed from the lines; the client's totals are display
  // hints only, so a tampered receipt cannot show a different total by email.
  const subtotal = Math.round(lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0) * 100) / 100;
  const discount = Math.min(subtotal, receiptAmount(raw.discount));
  const total = Math.round((subtotal - discount) * 100) / 100;
  const typedMethod = method as "cash" | "mobile" | "card";

  return {
    id,
    storeName: String(raw.storeName ?? "").trim().slice(0, 160) || "Main store",
    soldAt,
    lines,
    subtotal,
    discount,
    total,
    method: typedMethod,
    ...(typedMethod === "cash"
      ? {
          tendered: receiptAmount(raw.tendered),
          change: receiptAmount(raw.change),
        }
      : {}),
    servedBy: String(raw.servedBy ?? "").trim().slice(0, 120),
  };
}

export const sendReceiptEmail = onCall({ secrets: [resendApiKey] }, async (request) => {
  const actor = await requirePharmacyActor(request);
  const recipient = assertEmail(request.data?.email, "email");
  const receipt = cleanReceipt(request.data?.receipt);

  const content = receiptEmail({
    pharmacyName: actor.pharmacyName,
    storeName: receipt.storeName,
    receiptId: receipt.id,
    soldAt: new Date(receipt.soldAt).toLocaleString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Africa/Lusaka",
    }),
    lines: receipt.lines,
    subtotal: receipt.subtotal,
    discount: receipt.discount,
    total: receipt.total,
    method: receipt.method,
    ...(receipt.method === "cash"
      ? { tendered: receipt.tendered ?? 0, change: receipt.change ?? 0 }
      : {}),
    servedBy: receipt.servedBy || actor.name || "Front counter",
  });

  const messageId = await deliver(
    "sendReceiptEmail",
    [recipient],
    content,
    `Receipt ${receipt.id}`
  );

  return { messageId, to: recipient };
});

/* ------------------------------------------------------------------ */
/* getInvitation — public lookup for the accept link                  */
/* ------------------------------------------------------------------ */

/**
 * Resolves the id carried by an invitation email into the fields the
 * registration screen needs. Unknown, expired and already-used ids all
 * return null so the link never leaks whether an address exists.
 */
export const getInvitation = onCall(async (request) => {
  const inviteId = String(request.data?.inviteId ?? "").trim();
  if (!inviteId) throw new HttpsError("invalid-argument", "inviteId is required.");

  const snap = await db.collection("Invitation").doc(inviteId).get();
  if (!snap.exists) return { invitation: null };

  const data = snap.data() ?? {};
  const expiresAt =
    data.expiresAt && typeof data.expiresAt.toDate === "function"
      ? (data.expiresAt.toDate() as Date)
      : null;

  if (data.status !== "pending" || (expiresAt && expiresAt.getTime() < Date.now())) {
    return { invitation: null };
  }

  return {
    invitation: {
      id: inviteId,
      kind: data.kind === "console" ? "console" : "team",
      portal: data.kind === "console" ? "pulse" : "pharmacy",
      email: String(data.email ?? ""),
      name: String(data.name ?? ""),
      role: String(data.role ?? ""),
      pharmacyName: data.pharmacyName ? String(data.pharmacyName) : null,
      pharmacyId: data.pharmacyId ? String(data.pharmacyId) : null,
      storeNames: Array.isArray(data.storeNames) ? data.storeNames.map(String) : [],
      inviterName: String(data.inviterName ?? "Your team"),
      expiresAt: expiresAt ? expiresAt.toISOString() : "",
    },
  };
});

/* ------------------------------------------------------------------ */
/* acceptInvitation — claims the seat for the signed-in recipient      */
/* ------------------------------------------------------------------ */

export const acceptInvitation = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to accept this invitation.");
  }

  const inviteId = String(request.data?.inviteId ?? "").trim();
  if (!inviteId) throw new HttpsError("invalid-argument", "inviteId is required.");

  const email = String(request.auth.token.email ?? "").trim().toLowerCase();
  if (!email) {
    throw new HttpsError("failed-precondition", "Your account has no email address.");
  }

  const linkedProfiles = await db.collection("User").where("email", "==", email).get();
  if (linkedProfiles.docs.some((profile) => profile.id !== request.auth!.uid)) {
    throw new HttpsError("failed-precondition", "This email is already linked to another account.");
  }

  const ref = db.collection("Invitation").doc(inviteId);
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) {
      throw new HttpsError("not-found", "This invitation no longer exists.");
    }
    const data = snap.data() ?? {};
    if (data.status !== "pending") {
      if (data.status === "accepted" && data.acceptedBy === request.auth!.uid) return;
      throw new HttpsError("failed-precondition", "This invitation has already been used.");
    }
    const expiresAt =
      data.expiresAt && typeof data.expiresAt.toDate === "function"
        ? (data.expiresAt.toDate() as Date)
        : null;
    if (expiresAt && expiresAt.getTime() < Date.now()) {
      throw new HttpsError("failed-precondition", "This invitation has expired.");
    }
    if (email !== String(data.email ?? "").trim().toLowerCase()) {
      throw new HttpsError(
        "permission-denied",
        "Sign in with the email address this invitation was sent to."
      );
    }
    const targetProfile = await transaction.get(db.collection("User").doc(request.auth!.uid));
    const invitedAccountType = data.kind === "console" ? "Pulse" : "Pharmacy";
    const currentAccountType = String(targetProfile.data()?.account_type ?? "");
    if (currentAccountType && currentAccountType !== invitedAccountType) {
      throw new HttpsError(
        "failed-precondition",
        "This account is already assigned to the other portal. Use a separate sign-in for the invitation."
      );
    }

    const invitedPharmacyId = String(data.pharmacyId ?? "").trim();
    let inheritedApproval = false;
    if (data.kind !== "console" && invitedPharmacyId) {
      const pharmacySnap = await transaction.get(db.collection("User").doc(invitedPharmacyId));
      inheritedApproval = pharmacySnap.data()?.approved_by_duniya === true;
    }

    transaction.update(ref, {
      status: "accepted",
      acceptedBy: request.auth!.uid,
      acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const displayName = String(request.auth!.token.name ?? "").trim() || email.split("@")[0];
    const shared = {
      uid: request.auth!.uid,
      email,
      display_name: displayName,
      access_revoked: false,
    };

    // The invitation is the authority for a console seat — never trust the
    // role the browser wrote while registering.
    if (data.kind === "console") {
      const invitedRole = pulseRole(data.role);
      if (invitedRole) {
        transaction.set(
          db.collection("User").doc(request.auth!.uid),
          {
            ...shared,
            role: invitedRole,
            role_label: PULSE_ROLE_LABEL[invitedRole],
            account_type: "Pulse",
            // A console seat is Pulse-only. Remove any pharmacy identity left
            // on an account that previously belonged to the Pharmacy side.
            pharmacy_name: admin.firestore.FieldValue.delete(),
            pharmacy_id: admin.firestore.FieldValue.delete(),
            approved_by_duniya: true,
            invited: true,
          },
          { merge: true }
        );
      }
    } else {
      const acceptedRole = pharmacyRole(data.role || "Team member");
      transaction.set(
        db.collection("User").doc(request.auth!.uid),
        {
          ...shared,
          role: acceptedRole,
          role_label: PHARMACY_ROLE_LABEL[acceptedRole] ?? acceptedRole,
          account_type: "Pharmacy",
          pharmacy_name: data.pharmacyName ?? null,
          pharmacy_id: data.pharmacyId ?? null,
          approved_by_duniya: inheritedApproval,
          invited: true,
        },
        { merge: true }
      );
    }
  });

  return { ok: true };
});

/* ------------------------------------------------------------------ */
/* onPharmacyCreated — called by the registration flow                 */
/*                                                                     */
/* Sends the owner's welcome email plus one branded team invitation    */
/* per address the pharmacy listed at registration (inviteEmails).     */
/* ------------------------------------------------------------------ */

export const onPharmacyCreated = onCall(
  { secrets: [resendApiKey] },
  async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to create a pharmacy.");
  }

  const pharmacyName = requireString(request.data?.pharmacyName, "pharmacyName");
  const ownerName = requireString(request.data?.ownerName, "ownerName");
  const ownerEmail = assertEmail(request.data?.ownerEmail, "ownerEmail");
  const signedInEmail = String(request.auth.token.email ?? "").trim().toLowerCase();
  if (signedInEmail && signedInEmail !== ownerEmail) {
    throw new HttpsError("permission-denied", "Register the pharmacy with the email address you signed in with.");
  }
  const teamEmails: string[] = Array.isArray(request.data?.teamEmails)
    ? request.data.teamEmails.map((entry: unknown) => assertEmail(entry, "teamEmails"))
    : [];

  const sent: string[] = [];

  const welcome = pharmacyWelcomeEmail({
    pharmacyName,
    ownerName,
    ownerEmail,
    teamEmails,
    consoleUrl: `${appUrlFor(request)}pharmacy/`,
  });
  sent.push(await deliver("onPharmacyCreated", [ownerEmail], welcome, "Pharmacy welcome"));

  const seen = new Set([ownerEmail]);
  for (const email of teamEmails) {
    if (seen.has(email)) continue;
    seen.add(email);
    const inviteId = newInviteId();
    const expiresAt = expiryDate();
    const inviteeName = email.split("@")[0];
    const storeNames = ["All stores"];
    const personalMessage = `Welcome aboard — your ${pharmacyName} account is live and this is your seat at the counter.`;
    await saveInvitation({
      id: inviteId,
      kind: "team",
      email,
      name: inviteeName,
      role: "Team member",
      pharmacyName,
      pharmacyId: request.auth.uid,
      storeNames,
      inviterName: ownerName,
      expiresAt,
    });
    const content = teamInviteEmail({
      pharmacyName,
      inviterName: ownerName,
      inviteeName,
      role: "Team member",
      storeNames,
      personalMessage,
      inviteId,
      acceptUrl: acceptUrl(inviteId, appUrlFor(request)),
      expiresAt: expiryLabel(expiresAt),
    });
    try {
      sent.push(await deliver("onPharmacyCreated", [email], content, "Registration invite"));
    } catch (error) {
      await markInvitationFailed(inviteId);
      throw error;
    }
  }

  // Alert the Pulse team once per pharmacy that is still pending review.
  // Best-effort by design: a mail failure must never undo a registration,
  // and the marker document stops client retries from re-notifying the team.
  let notifiedAdmins = { sent: 0, failed: 0 };
  const pharmacyId = request.auth.uid;
  try {
    const profile = await db.collection("User").doc(pharmacyId).get();
    if (profile.get("approved_by_duniya") !== true) {
      const alertRef = db.collection("PharmacyRegistrationAlert").doc(pharmacyId);
      const claimed = await db.runTransaction(async (transaction) => {
        const existing = await transaction.get(alertRef);
        if (existing.exists) return false;
        transaction.set(alertRef, {
          pharmacyId,
          pharmacyName,
          ownerName,
          ownerEmail,
          teamInvites: seen.size - 1,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return true;
      });
      if (claimed) {
        const admins = await pulseAdminRecipients();
        if (admins.length) {
          notifiedAdmins = await notifyEmailRecipients(
            "onPharmacyCreated",
            admins,
            pendingPharmacyRegistrationEmail({
              pharmacyName,
              ownerName,
              ownerEmail,
              teamEmails: seen.size - 1,
              registeredAt: lusakaTimestamp(Date.now()),
              consoleUrl: `${appUrlFor(request)}dashboard/?page=pharmacies`,
            }),
            "Pending pharmacy registration"
          );
        }
      }
    }
  } catch (error) {
    console.error("[onPharmacyCreated] Pending-registration alert failed", error);
  }

  return { messageIds: sent, invited: sent.length - 1, notifiedAdmins };
});

/* ------------------------------------------------------------------ */
/* onPharmacyDocCreated — Firestore trigger                            */
/*                                                                     */
/* Creating a Pharmacy/{id} document with an `inviteEmails` array      */
/* fires the same welcome + invitation pipeline without a client call. */
/* ------------------------------------------------------------------ */

export const onPharmacyDocCreated = onDocumentCreated(
  { document: "Pharmacy/{pharmacyId}", secrets: [resendApiKey] },
  async (event) => {
  const data = event.data?.data();
  if (!data) return;

  const pharmacyName = String(data.name ?? "Your pharmacy");
  const ownerName = String(data.ownerName ?? data.display_name ?? "The owner");
  const ownerEmail = String(data.email ?? "").trim().toLowerCase();
  const teamEmails: string[] = Array.isArray(data.inviteEmails)
    ? data.inviteEmails.map((entry: unknown) => String(entry).trim().toLowerCase()).filter((entry) => EMAIL_RE.test(entry))
    : [];

  if (!EMAIL_RE.test(ownerEmail)) return;

  const welcome = pharmacyWelcomeEmail({
    pharmacyName,
    ownerName,
    ownerEmail,
    teamEmails,
    consoleUrl: `${APP_URL}pharmacy/`,
  });
  await deliver("onPharmacyDocCreated", [ownerEmail], welcome, "Pharmacy welcome");

  const seen = new Set([ownerEmail]);
  for (const email of teamEmails) {
    if (seen.has(email)) continue;
    seen.add(email);
    const inviteId = newInviteId();
    const expiresAt = expiryDate();
    const inviteeName = email.split("@")[0];
    const storeNames = ["All stores"];
    await saveInvitation({
      id: inviteId,
      kind: "team",
      email,
      name: inviteeName,
      role: "Team member",
      pharmacyName,
      pharmacyId: event.params.pharmacyId,
      storeNames,
      inviterName: ownerName,
      expiresAt,
    });
    const content = teamInviteEmail({
      pharmacyName,
      inviterName: ownerName,
      inviteeName,
      role: "Team member",
      storeNames,
      inviteId,
      acceptUrl: acceptUrl(inviteId, APP_URL),
      expiresAt: expiryLabel(expiresAt),
    });
    try {
      await deliver("onPharmacyDocCreated", [email], content, "Registration invite");
    } catch (error) {
      await markInvitationFailed(inviteId);
      throw error;
    }
  }
});
