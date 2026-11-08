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
import { randomUUID } from "crypto";
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
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to send team invitations.");
  }

  const pharmacyName = requireString(request.data?.pharmacyName, "pharmacyName");
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
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to send console invitations.");
  }

  const inviterName = requireString(request.data?.inviterName, "inviterName");
  const inviteeName = String(request.data?.inviteeName ?? "").trim();
  const inviteeEmail = assertEmail(request.data?.inviteeEmail, "inviteeEmail");
  const role = requireString(request.data?.role, "role");

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
