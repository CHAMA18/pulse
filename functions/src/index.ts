/* ------------------------------------------------------------------ */
/* Pulse Cloud Functions — invitation delivery                         */
/* ------------------------------------------------------------------ */
/* Callable functions the two portals invoke when someone is invited:  */
/*                                                                     */
/*   sendTeamInvite        — a Pharmacy-portal team invitation         */
/*   sendPulseAdminInvite  — a Pulse-console invitation                */
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
import { createHash, randomUUID } from "crypto";
import * as admin from "firebase-admin";
import {
  pharmacyWelcomeEmail,
  pulseAdminInviteEmail,
  teamInviteEmail,
  type EmailContent,
} from "./emails";
import { PULSE_MARK_BASE64 } from "./logo";

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

/** Resend API key — provided by Secret Manager at runtime. */
const resendApiKey = defineSecret("RESEND_API_KEY");

const APP_URL = process.env.APP_URL ?? "https://chama18.github.io/pulse/";
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
  pharmacyId: string;
  pharmacyName: string;
};

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
    const sameName = await db.collection("User").where("pharmacy_name", "==", pharmacyName).get();
    const owner = sameName.docs.find((candidate) => {
      const profile = candidate.data();
      return profile.account_type === "Pharmacy" &&
        String(profile.role ?? profile.role_label ?? "").trim().toLowerCase() === "owner";
    });
    pharmacyId = owner?.id ?? pharmacyName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  }

  return {
    uid: request.auth.uid,
    email: String(data.email ?? "").trim().toLowerCase(),
    name: String(data.display_name ?? data.name ?? data.email ?? "Pharmacy staff"),
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

async function requireConsoleOwner(request: { auth?: { uid: string } }): Promise<PulseActor> {
  const actor = await requirePulseActor(request);
  if (actor.role !== "owner") {
    throw new HttpsError("permission-denied", "Only an Owner can change or remove console users.");
  }
  return actor;
}

/** Deliver one email through Resend and archive it for the portals' outbox views. */
async function deliver(
  fn: string,
  to: string[],
  content: EmailContent,
  detail: string
): Promise<string> {
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

function acceptUrl(ref: string): string {
  return `${APP_URL}login/?invite=${encodeURIComponent(ref)}`;
}

const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

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

  const pharmacyName = actor.pharmacyName;
  const inviterName = requireString(request.data?.inviterName, "inviterName");
  const inviteeName = String(request.data?.inviteeName ?? "").trim();
  const inviteeEmail = assertEmail(request.data?.inviteeEmail, "inviteeEmail");
  const role = requireString(request.data?.role, "role");
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
    role,
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
    acceptUrl: acceptUrl(inviteId),
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
    acceptUrl: acceptUrl(inviteId),
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
  const users = snap.docs
    .map((doc) => {
      const data = doc.data();
      if (data.access_revoked === true) return null;
      const role = pulseRole(data.role ?? data.role_label) ?? "staff";
      return {
        uid: doc.id,
        name: String(data.display_name ?? data.name ?? data.email ?? "Pulse user"),
        email: String(data.email ?? "").trim().toLowerCase(),
        role,
        roleLabel: PULSE_ROLE_LABEL[role],
      };
    })
    .filter((user): user is NonNullable<typeof user> => user !== null);
  return { users };
});

/** Counts the other active Owners while a transaction holds the target doc. */
async function otherOwnerCount(
  transaction: admin.firestore.Transaction,
  targetUid: string
): Promise<number> {
  const snap = await transaction.get(
    db.collection("User").where("account_type", "==", "Pulse")
  );
  return snap.docs.filter((doc) => {
    if (doc.id === targetUid) return false;
    const data = doc.data();
    return data.access_revoked !== true && pulseRole(data.role ?? data.role_label) === "owner";
  }).length;
}

export const updatePulseConsoleUserRole = onCall(async (request) => {
  const actor = await requireConsoleOwner(request);
  const uid = requireString(request.data?.uid, "uid");
  if (uid === actor.uid) {
    throw new HttpsError("failed-precondition", "You can't change your own role.");
  }
  const nextRole = pulseRole(request.data?.role);
  if (!nextRole) {
    throw new HttpsError("invalid-argument", "role must be Owner, Admin or Staff.");
  }

  await db.runTransaction(async (transaction) => {
    const ref = db.collection("User").doc(uid);
    const target = await transaction.get(ref);
    const data = target.data();
    if (!target.exists || data?.account_type !== "Pulse" || data?.access_revoked === true) {
      throw new HttpsError("not-found", "That console user no longer exists.");
    }
    const currentRole = pulseRole(data.role ?? data.role_label) ?? "staff";
    if (currentRole === "owner" && nextRole !== "owner") {
      const owners = await otherOwnerCount(transaction, uid);
      if (owners === 0) {
        throw new HttpsError(
          "failed-precondition",
          "The network needs at least one Owner. Promote another Owner first."
        );
      }
    }
    transaction.update(ref, {
      role: nextRole,
      role_label: PULSE_ROLE_LABEL[nextRole],
      role_updated_at: admin.firestore.FieldValue.serverTimestamp(),
      role_updated_by: actor.uid,
    });
  });

  return { uid, role: nextRole, roleLabel: PULSE_ROLE_LABEL[nextRole] };
});

export const removePulseConsoleUser = onCall(async (request) => {
  const actor = await requireConsoleOwner(request);
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
    if (pulseRole(data.role ?? data.role_label) === "owner") {
      const owners = await otherOwnerCount(transaction, uid);
      if (owners === 0) {
        throw new HttpsError(
          "failed-precondition",
          "The network needs at least one Owner. Promote another Owner first."
        );
      }
    }
    transaction.update(ref, {
      access_revoked: true,
      status: "removed",
      removed_at: admin.firestore.FieldValue.serverTimestamp(),
      removed_by: actor.uid,
    });
  });

  // The profile flag blocks the app immediately; disabling the Auth user and
  // revoking refresh tokens stops any new session from being minted.
  try {
    await admin.auth().updateUser(uid, { disabled: true });
    await admin.auth().revokeRefreshTokens(uid);
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code !== "auth/user-not-found") {
      console.error(`[removePulseConsoleUser] could not disable ${uid}:`, error);
    }
  }

  return { uid, removed: true };
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
    const id = String(data.pharmacy_id ?? "").trim() ||
      ownerIdsByName.get(name.toLowerCase()) ||
      name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
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

  const ref = db.collection("Invitation").doc(inviteId);
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) {
      throw new HttpsError("not-found", "This invitation no longer exists.");
    }
    const data = snap.data() ?? {};
    if (data.status !== "pending") {
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
    transaction.update(ref, {
      status: "accepted",
      acceptedBy: request.auth!.uid,
      acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // The invitation is the authority for a console seat — never trust the
    // role the browser wrote while registering.
    if (data.kind === "console") {
      const invitedRole = pulseRole(data.role);
      if (invitedRole) {
        transaction.set(
          db.collection("User").doc(request.auth!.uid),
          {
            role: invitedRole,
            role_label: PULSE_ROLE_LABEL[invitedRole],
            account_type: "Pulse",
            approved_by_duniya: true,
            access_revoked: false,
          },
          { merge: true }
        );
      }
    } else {
      transaction.set(
        db.collection("User").doc(request.auth!.uid),
        {
          role: String(data.role ?? "Team member").trim().toLowerCase(),
          role_label: String(data.role ?? "Team member").trim(),
          account_type: "Pharmacy",
          pharmacy_name: data.pharmacyName ?? null,
          pharmacy_id: data.pharmacyId ?? null,
          approved_by_duniya: false,
          access_revoked: false,
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
  const teamEmails: string[] = Array.isArray(request.data?.teamEmails)
    ? request.data.teamEmails.map((entry: unknown) => assertEmail(entry, "teamEmails"))
    : [];

  const sent: string[] = [];

  const welcome = pharmacyWelcomeEmail({
    pharmacyName,
    ownerName,
    ownerEmail,
    teamEmails,
    consoleUrl: `${APP_URL}pharmacy/`,
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
      acceptUrl: acceptUrl(inviteId),
      expiresAt: expiryLabel(expiresAt),
    });
    try {
      sent.push(await deliver("onPharmacyCreated", [email], content, "Registration invite"));
    } catch (error) {
      await markInvitationFailed(inviteId);
      throw error;
    }
  }

  return { messageIds: sent, invited: sent.length - 1 };
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
      acceptUrl: acceptUrl(inviteId),
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
