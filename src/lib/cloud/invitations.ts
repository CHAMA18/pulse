"use client";

import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "@/lib/firebase";
import {
  PULSE_FROM,
  PULSE_REPLY_TO,
  renderPharmacyWelcomeEmail,
  renderPulseAdminInviteEmail,
  renderTeamInviteEmail,
  type EmailContent,
} from "@/lib/cloud/emails";

/* ------------------------------------------------------------------ */
/* Pulse Cloud — callable invitation functions                         */
/* ------------------------------------------------------------------ */
/* The deployable implementations live in /functions (Firebase Cloud   */
/* Functions + Nodemailer). The browser talks to them through this     */
/* module's callable surface — `callCloudFunction(name, payload)` —    */
/* which invokes the deployed callable in europe-west1, then renders   */
/* the identical templates locally for the preview and delivery outbox. */

export type CloudFnName = "sendTeamInvite" | "sendPulseAdminInvite" | "onPharmacyCreated";

export type InvitationMessage = {
  id: string;
  /** Which cloud function produced the message. */
  fn: CloudFnName;
  to: string[];
  from: string;
  replyTo: string;
  subject: string;
  preheader: string;
  html: string;
  text: string;
  status: "sent";
  createdAt: number;
  /** e.g. "onPharmacyCreated → 3 × sendTeamInvite" */
  detail?: string;
};

export type CloudFunctionResult = {
  messageId: string;
  /** Every message the function produced (welcome + N invites). */
  messages: InvitationMessage[];
};

export class CloudFunctionError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const OUTBOX_KEY = "pulse.cloud-outbox.v1";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Payloads                                                            */
/* ------------------------------------------------------------------ */

export type TeamInvitePayload = {
  pharmacyName: string;
  inviterName: string;
  inviteeName: string;
  inviteeEmail: string;
  role: string;
  storeNames: string[];
  personalMessage?: string;
};

export type PulseAdminInvitePayload = {
  inviterName: string;
  inviteeName: string;
  inviteeEmail: string;
  role: string;
};

export type PharmacyCreatedPayload = {
  pharmacyName: string;
  ownerName: string;
  ownerEmail: string;
  /** Emails the pharmacy listed for team invitations at registration. */
  teamEmails: string[];
};

/** The invitation record the server stores when a message is sent. */
export type InvitationRecord = {
  id: string;
  kind: "team" | "console";
  portal: "pharmacy" | "pulse";
  email: string;
  name: string;
  role: string;
  pharmacyName: string | null;
  pharmacyId?: string | null;
  storeNames: string[];
  inviterName: string;
  expiresAt: string;
};

/* ------------------------------------------------------------------ */
/* Outbox                                                              */
/* ------------------------------------------------------------------ */

export function loadOutbox(): InvitationMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as InvitationMessage[]) : [];
  } catch {
    return [];
  }
}

function fileMessages(messages: InvitationMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    const next = [...messages, ...loadOutbox()].slice(0, 120);
    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(next));
  } catch {
    /* best-effort — the caller still gets its result */
  }
}

function messageId(): string {
  return `MSG-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;
}

function assertEmail(value: string, field: string): string {
  const email = value.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new CloudFunctionError("invalid-argument", `${field} isn't a valid email address.`);
  }
  return email;
}

/** The origin of deep links (works on GH Pages and localhost alike). */
function appOrigin(): string {
  if (typeof window === "undefined") return "https://pulse.network";
  // Static export lives under /pulse; local dev is served from the root.
  const base = window.location.pathname.startsWith("/pulse") ? "/pulse" : "";
  return `${window.location.origin}${base}`;
}

function acceptLink(hash: string): string {
  return `${appOrigin()}/login/?invite=${hash}`;
}

/* ------------------------------------------------------------------ */
/* The callable                                                        */
/* ------------------------------------------------------------------ */

/** Response shape of the deployed callables (functions/src/index.ts). */
type CallableResponse = {
  messageId?: string;
  inviteId?: string;
  messageIds?: string[];
  invited?: number;
};

/**
 * Invokes a deployed Pulse Cloud Function in `europe-west1`.
 *
 * The payload is validated locally first, so bad input fails instantly with
 * the same copy an `HttpsError` would produce. On success the server's
 * message ids are attached to previews rendered here from the identical
 * templates — the server sends the mail, the client renders the preview
 * dialog and files the delivery into the local outbox. A callable rejection
 * is rethrown as [CloudFunctionError] with the server's code and message.
 */
export async function callCloudFunction(
  name: CloudFnName,
  payload: TeamInvitePayload | PulseAdminInvitePayload | PharmacyCreatedPayload
): Promise<CloudFunctionResult> {
  // Validate and build the previews first — throw before calling out.
  let messages: InvitationMessage[] = [];

  if (name === "sendTeamInvite") {
    const p = payload as TeamInvitePayload;
    const email = assertEmail(p.inviteeEmail, "inviteeEmail");
    if (!p.pharmacyName?.trim()) throw new CloudFunctionError("invalid-argument", "pharmacyName is required.");
    const inviteId = `INV-${Date.now().toString(36).toUpperCase()}`;
    const expiresAt = new Date(Date.now() + 7 * DAY).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    const content = renderTeamInviteEmail({
      pharmacyName: p.pharmacyName.trim(),
      inviterName: p.inviterName?.trim() || "The team",
      inviteeName: p.inviteeName?.trim() ?? "",
      role: p.role,
      storeNames: p.storeNames.length ? p.storeNames : ["All stores"],
      personalMessage: p.personalMessage?.trim(),
      inviteId,
      acceptUrl: acceptLink(inviteId),
      expiresAt,
    });
    messages = [message("sendTeamInvite", [email], content, "Team invitation")];
  } else if (name === "sendPulseAdminInvite") {
    const p = payload as PulseAdminInvitePayload;
    const email = assertEmail(p.inviteeEmail, "inviteeEmail");
    const inviteId = `INV-${Date.now().toString(36).toUpperCase()}`;
    const expiresAt = new Date(Date.now() + 7 * DAY).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    const content = renderPulseAdminInviteEmail({
      inviterName: p.inviterName?.trim() || "Pulse",
      inviteeName: p.inviteeName?.trim() ?? "",
      inviteeEmail: email,
      role: p.role,
      inviteId,
      acceptUrl: acceptLink(inviteId),
      expiresAt,
    });
    messages = [message("sendPulseAdminInvite", [email], content, "Console invitation")];
  } else {
    // onPharmacyCreated — welcome the owner, then invite every listed
    // teammate through the same pipeline a manual invite would use.
    const p = payload as PharmacyCreatedPayload;
    const ownerEmail = assertEmail(p.ownerEmail, "ownerEmail");
    const welcome = renderPharmacyWelcomeEmail({
      pharmacyName: p.pharmacyName.trim(),
      ownerName: p.ownerName.trim(),
      ownerEmail,
      teamEmails: [],
      consoleUrl: `${appOrigin()}/pharmacy/`,
    });
    messages = [
      message("onPharmacyCreated", [ownerEmail], welcome, "Pharmacy welcome"),
    ];
    const invites: InvitationMessage[] = [];
    const seen = new Set([ownerEmail]);
    for (const raw of p.teamEmails ?? []) {
      const email = assertEmail(raw, "teamEmails");
      if (seen.has(email)) continue; // skip duplicates & the owner
      seen.add(email);
      const inviteId = `INV-${Date.now().toString(36).toUpperCase()}`;
      const expiresAt = new Date(Date.now() + 7 * DAY).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
      const content = renderTeamInviteEmail({
        pharmacyName: p.pharmacyName.trim(),
        inviterName: p.ownerName.trim() || "The owner",
        inviteeName: email.split("@")[0],
        role: "Team member",
        storeNames: ["All stores"],
        personalMessage: `Welcome aboard — your ${p.pharmacyName.trim()} account is live and this is your seat at the counter.`,
        inviteId,
        acceptUrl: acceptLink(inviteId),
        expiresAt,
      });
      invites.push(message("onPharmacyCreated", [email], content, "Registration invite"));
    }
    messages = [...messages, ...invites];
  }

  const response = await invokeCallable(name, payload);

  // Prefer the ids the deployed function assigned so the preview, the
  // Firestore archive (InvitationMail/{id}) and the outbox all agree.
  if (name === "onPharmacyCreated") {
    const ids = response.messageIds ?? [];
    messages = messages.map((msg, index) => {
      const id = ids[index];
      return id ? { ...msg, id } : msg;
    });
  } else {
    const id = response.messageId;
    if (id) messages = messages.map((msg) => ({ ...msg, id }));
  }

  fileMessages(messages);
  return { messageId: messages[0]?.id ?? messageId(), messages };
}

/**
 * Resolves an invitation before the recipient has an account.
 * Returns null when the id is unknown, expired or already used.
 */
export async function lookupInvitation(inviteId: string): Promise<InvitationRecord | null> {
  const functions = getFirebaseFunctions();
  if (!functions) return null;
  try {
    const callable = httpsCallable<{ inviteId: string }, { invitation: InvitationRecord | null }>(
      functions,
      "getInvitation"
    );
    const result = await callable({ inviteId });
    return result.data?.invitation ?? null;
  } catch (err) {
    const raw = err as { message?: unknown } | null;
    throw new CloudFunctionError(
      "unavailable",
      typeof raw?.message === "string" && raw.message
        ? raw.message
        : "We couldn't load this invitation. Please try again."
    );
  }
}

/** Marks an invitation accepted for the signed-in recipient. */
export async function acceptInvitation(inviteId: string): Promise<void> {
  const functions = getFirebaseFunctions();
  if (!functions) {
    throw new CloudFunctionError("unavailable", "The invitation service isn't available right now.");
  }
  try {
    const callable = httpsCallable<{ inviteId: string }, { ok?: boolean }>(
      functions,
      "acceptInvitation"
    );
    await callable({ inviteId });
  } catch (err) {
    const raw = err as { message?: unknown } | null;
    throw new CloudFunctionError(
      "failed-precondition",
      typeof raw?.message === "string" && raw.message
        ? raw.message
        : "We couldn't confirm this invitation. Please try again."
    );
  }
}

/** Calls the deployable by name, normalizing failures to CloudFunctionError. */
async function invokeCallable(
  name: CloudFnName,
  payload: TeamInvitePayload | PulseAdminInvitePayload | PharmacyCreatedPayload
): Promise<CallableResponse> {
  const functions = getFirebaseFunctions();
  if (!functions) {
    throw new CloudFunctionError(
      "unavailable",
      "The invitation service isn't available right now."
    );
  }

  try {
    const callable = httpsCallable<typeof payload, CallableResponse>(functions, name);
    const result = await callable(payload);
    return result.data ?? {};
  } catch (err) {
    if (err instanceof CloudFunctionError) throw err;
    const raw = err as { code?: unknown; message?: unknown } | null;
    const code =
      typeof raw?.code === "string"
        ? raw.code.replace(/^functions\//, "")
        : "unavailable";
    const message =
      typeof raw?.message === "string" && raw.message
        ? raw.message
        : "We couldn't reach the invitation service. Please try again.";
    throw new CloudFunctionError(code, message);
  }
}

function message(
  fn: CloudFnName,
  to: string[],
  content: EmailContent,
  detail: string
): InvitationMessage {
  return {
    id: messageId(),
    fn,
    to,
    from: PULSE_FROM,
    replyTo: PULSE_REPLY_TO,
    subject: content.subject,
    preheader: content.preheader,
    html: content.html,
    text: content.text,
    status: "sent",
    createdAt: Date.now(),
    detail,
  };
}

/* ------------------------------------------------------------------ */
/* .eml export — lets anyone open the real email in a mail client       */
/* ------------------------------------------------------------------ */

export function invitationEml(msg: InvitationMessage): string {
  const boundary = `pulse-${msg.id.toLowerCase()}`;
  const headers = [
    `From: ${msg.from}`,
    `To: ${msg.to.join(", ")}`,
    `Subject: ${msg.subject}`,
    `Reply-To: ${msg.replyTo}`,
    `Date: ${new Date(msg.createdAt).toUTCString()}`,
    "MIME-Version: 1.0",
    `Message-ID: <${msg.id.toLowerCase()}@pulse.network>`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].join("\r\n");

  return [
    headers,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    msg.text,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    msg.html,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** Triggers a browser download of the message as a real .eml file. */
export function downloadEml(msg: InvitationMessage): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([invitationEml(msg)], { type: "message/rfc822" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${msg.subject.replace(/[^a-z0-9]+/gi, "-").slice(0, 60) || "pulse-invitation"}.eml`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
