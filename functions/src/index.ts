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
/* Delivery goes through Nodemailer (SMTP configured via env vars);    */
/* every message is archived to Firestore at InvitationMail/{id} so    */
/* both portals can show a delivery record. Deploy with:               */
/*                                                                     */
/*   firebase deploy --only functions                                  */
/*                                                                     */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import * as admin from "firebase-admin";
import * as nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import {
  pharmacyWelcomeEmail,
  pulseAdminInviteEmail,
  teamInviteEmail,
  type EmailContent,
} from "./emails";

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

const APP_URL = process.env.APP_URL ?? "https://chama18.github.io/pulse/";
const FROM = process.env.EMAIL_FROM ?? "Pulse <invitations@pulse.network>";
const REPLY_TO = process.env.EMAIL_REPLY_TO ?? "hello@pulse.network";
const INVITE_TTL_DAYS = 7;

let cachedTransport: Transporter | null = null;

/** SMTP transport built from runtime env (configure with `functions:config` or .env). */
function transport(): Transporter {
  if (cachedTransport) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return cachedTransport;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

/** Deliver one email and archive it for the portals' outbox views. */
async function deliver(
  fn: string,
  to: string[],
  content: EmailContent,
  detail: string
): Promise<string> {
  const id = `MSG-${Date.now().toString(36).toUpperCase()}`;
  const info = await transport().sendMail({
    from: FROM,
    replyTo: REPLY_TO,
    to: to.join(", "),
    subject: content.subject,
    text: content.text,
    html: content.html,
    headers: { "X-Pulse-Function": fn, "X-Pulse-Message": id },
  });

  await db.collection("InvitationMail").doc(id).set({
    id,
    fn,
    to,
    subject: content.subject,
    detail,
    status: "sent",
    providerMessageId: info.messageId ?? null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return id;
}

function acceptUrl(ref: string): string {
  return `${APP_URL}login/?invite=${encodeURIComponent(ref)}`;
}

function expiryLabel(): string {
  return new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toLocaleDateString(
    "en-US",
    { weekday: "long", month: "long", day: "numeric" }
  );
}

/* ------------------------------------------------------------------ */
/* sendTeamInvite — Pharmacy portal team invitations                   */
/* ------------------------------------------------------------------ */

export const sendTeamInvite = onCall(async (request) => {
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

  const inviteId = `INV-${Date.now().toString(36).toUpperCase()}`;
  const content = teamInviteEmail({
    pharmacyName,
    inviterName,
    inviteeName,
    role,
    storeNames,
    personalMessage,
    inviteId,
    acceptUrl: acceptUrl(inviteId),
    expiresAt: expiryLabel(),
  });

  const messageId = await deliver("sendTeamInvite", [inviteeEmail], content, "Team invitation");
  return { messageId, inviteId };
});

/* ------------------------------------------------------------------ */
/* sendPulseAdminInvite — Pulse console invitations                    */
/* ------------------------------------------------------------------ */

export const sendPulseAdminInvite = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to send console invitations.");
  }

  const inviterName = requireString(request.data?.inviterName, "inviterName");
  const inviteeName = String(request.data?.inviteeName ?? "").trim();
  const inviteeEmail = assertEmail(request.data?.inviteeEmail, "inviteeEmail");
  const role = requireString(request.data?.role, "role");

  const inviteId = `INV-${Date.now().toString(36).toUpperCase()}`;
  const content = pulseAdminInviteEmail({
    inviterName,
    inviteeName,
    inviteeEmail,
    role,
    acceptUrl: acceptUrl(inviteId),
  });

  const messageId = await deliver(
    "sendPulseAdminInvite",
    [inviteeEmail],
    content,
    "Console invitation"
  );
  return { messageId, inviteId };
});

/* ------------------------------------------------------------------ */
/* onPharmacyCreated — called by the registration flow                 */
/*                                                                     */
/* Sends the owner's welcome email plus one branded team invitation    */
/* per address the pharmacy listed at registration (inviteEmails).     */
/* ------------------------------------------------------------------ */

export const onPharmacyCreated = onCall(async (request) => {
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
    const inviteId = `INV-${Date.now().toString(36).toUpperCase()}`;
    const content = teamInviteEmail({
      pharmacyName,
      inviterName: ownerName,
      inviteeName: email.split("@")[0],
      role: "Team member",
      storeNames: ["All stores"],
      personalMessage: `Welcome aboard — your ${pharmacyName} account is live and this is your seat at the counter.`,
      inviteId,
      acceptUrl: acceptUrl(inviteId),
      expiresAt: expiryLabel(),
    });
    sent.push(await deliver("onPharmacyCreated", [email], content, "Registration invite"));
  }

  return { messageIds: sent, invited: sent.length - 1 };
});

/* ------------------------------------------------------------------ */
/* onPharmacyDocCreated — Firestore trigger                            */
/*                                                                     */
/* Creating a Pharmacy/{id} document with an `inviteEmails` array      */
/* fires the same welcome + invitation pipeline without a client call. */
/* ------------------------------------------------------------------ */

export const onPharmacyDocCreated = onDocumentCreated("Pharmacy/{pharmacyId}", async (event) => {
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
    const inviteId = `INV-${Date.now().toString(36).toUpperCase()}`;
    const content = teamInviteEmail({
      pharmacyName,
      inviterName: ownerName,
      inviteeName: email.split("@")[0],
      role: "Team member",
      storeNames: ["All stores"],
      inviteId,
      acceptUrl: acceptUrl(inviteId),
      expiresAt: expiryLabel(),
    });
    await deliver("onPharmacyDocCreated", [email], content, "Registration invite");
  }
});
