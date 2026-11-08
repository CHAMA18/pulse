"use client";

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
/* which today executes the same email builders locally and files the  */
/* messages into a delivery outbox. Swapping in the deployed backend    */
/* is a one-line change inside this file, nothing else moves.          */

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
  return `${window.location.origin}${window.location.pathname.replace(/\/[^/]*\.html?$/, "").replace(/\/$/, "")}`;
}

function acceptLink(hash: string): string {
  return `${appOrigin()}/login/?invite=${hash}`;
}

/* ------------------------------------------------------------------ */
/* The callable                                                        */
/* ------------------------------------------------------------------ */

/**
 * Invokes a Pulse Cloud Function. Validation errors throw
 * [CloudFunctionError] exactly like an `HttpsError` would; success
 * resolves with the delivered messages after a realistic transport
 * latency.
 */
export async function callCloudFunction(
  name: CloudFnName,
  payload: TeamInvitePayload | PulseAdminInvitePayload | PharmacyCreatedPayload
): Promise<CloudFunctionResult> {
  // Validate first — throw before anything is filed.
  let messages: InvitationMessage[] = [];
  let detail = "";

  if (name === "sendTeamInvite") {
    const p = payload as TeamInvitePayload;
    const email = assertEmail(p.inviteeEmail, "inviteeEmail");
    if (!p.pharmacyName?.trim()) throw new CloudFunctionError("invalid-argument", "pharmacyName is required.");
    const content = renderTeamInviteEmail({
      pharmacyName: p.pharmacyName.trim(),
      inviterName: p.inviterName?.trim() || "The team",
      inviteeName: p.inviteeName?.trim() ?? "",
      role: p.role,
      storeNames: p.storeNames.length ? p.storeNames : ["All stores"],
      personalMessage: p.personalMessage?.trim(),
      inviteId: `INV-${Date.now().toString(36).toUpperCase()}`,
      acceptUrl: acceptLink(email.split("@")[0].replace(/[^a-z0-9]/gi, "")),
      expiresAt: new Date(Date.now() + 7 * DAY).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    });
    messages = [message("sendTeamInvite", [email], content, "Team invitation")];
    detail = "sendTeamInvite";
  } else if (name === "sendPulseAdminInvite") {
    const p = payload as PulseAdminInvitePayload;
    const email = assertEmail(p.inviteeEmail, "inviteeEmail");
    const content = renderPulseAdminInviteEmail({
      inviterName: p.inviterName?.trim() || "Pulse",
      inviteeName: p.inviteeName?.trim() ?? "",
      inviteeEmail: email,
      role: p.role,
      acceptUrl: acceptLink(email.split("@")[0].replace(/[^a-z0-9]/gi, "")),
    });
    messages = [message("sendPulseAdminInvite", [email], content, "Console invitation")];
    detail = "sendPulseAdminInvite";
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
      const content = renderTeamInviteEmail({
        pharmacyName: p.pharmacyName.trim(),
        inviterName: p.ownerName.trim() || "The owner",
        inviteeName: email.split("@")[0],
        role: "Team member",
        storeNames: ["All stores"],
        personalMessage: `Welcome aboard — your ${p.pharmacyName.trim()} account is live and this is your seat at the counter.`,
        inviteId: `INV-${Date.now().toString(36).toUpperCase()}`,
        acceptUrl: acceptLink(email.split("@")[0].replace(/[^a-z0-9]/gi, "")),
        expiresAt: new Date(Date.now() + 7 * DAY).toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
        }),
      });
      invites.push(message("onPharmacyCreated", [email], content, "Registration invite"));
    }
    messages = [...messages, ...invites];
    detail = `onPharmacyCreated → 1 welcome + ${invites.length} team invite${invites.length === 1 ? "" : "s"}`;
  }

  // Realistic transport latency for the callable.
  await new Promise((resolve) => setTimeout(resolve, 620 + Math.random() * 480));

  fileMessages(messages);
  return { messageId: messages[0]?.id ?? messageId(), messages };
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
