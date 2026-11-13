/* ------------------------------------------------------------------ */
/* Pulse Cloud — invitation email templates                            */
/* ------------------------------------------------------------------ */
/* The browser renders these identical templates for the inbox-style   */
/* preview and the .eml download. They mirror functions/src/emails.ts  */
/* exactly: hosted Pulse mark, deep purple masthead, editorial body,   */
/* bulletproof CTA and a quiet, honest footer.                          */

export type EmailContent = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
};

export const PULSE_FROM = "Pulse <noreply@thestackone.com>";
export const PULSE_REPLY_TO = "noreply@thestackone.com";

const BRAND_DEEP = "#2e1065";
const BRAND_PURPLE = "#6d28d9";
const BRAND_FUCHSIA = "#c026d3";
const INK = "#171321";
const MUTED = "#5f5872";
const FAINT = "#9890ab";
const BORDER = "#e8e4ef";
const SURFACE = "#fafaf8";
const CANVAS = "#f3f1ee";

/** Hosted 4× mark (public/brand/pulse-mark.png) — never a data URI. */
const LOGO_URL = "https://chama18.github.io/pulse/brand/pulse-mark.png";
const FONT =
  "'Satoshi',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function esc(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function masthead(): string {
  return `<tr><td class="pad" style="padding:28px 40px 24px;background-color:#ffffff;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td width="48" valign="middle" style="width:48px;">
      <img src="${LOGO_URL}" width="48" height="48" alt="Pulse" style="display:block;width:48px;height:48px;border:0;border-radius:12px;" />
    </td>
    <td valign="middle" style="padding-left:13px;">
      <div style="font-family:${FONT};font-size:21px;font-weight:800;line-height:1.05;letter-spacing:-0.5px;color:${INK};">Pulse</div>
      <div style="padding-top:4px;font-family:${FONT};font-size:8px;font-weight:700;letter-spacing:2.2px;text-transform:uppercase;color:${FAINT};">By Duniya Healthcare</div>
    </td>
    <td align="right" valign="middle" class="hide" style="font-family:${FONT};font-size:8.5px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${FAINT};white-space:nowrap;">Pharmacy, in rhythm</td>
  </tr></table>
</td></tr>
<tr><td style="height:3px;font-size:0;line-height:0;background-color:${BRAND_PURPLE};background-image:linear-gradient(90deg,${BRAND_DEEP} 0%,${BRAND_PURPLE} 45%,${BRAND_FUCHSIA} 100%);">&nbsp;</td></tr>`;
}

/** Bulletproof CTA — VML for Outlook, gradient table for everyone else. */
function cta(href: string, label: string): string {
  const safeHref = esc(href);
  return `<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeHref}" style="height:54px;v-text-anchor:middle;width:250px;" arcsize="23%" strokecolor="${BRAND_PURPLE}" fillcolor="${BRAND_PURPLE}">
  <w:anchorlock/>
  <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${esc(label)}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;"><tr>
  <td align="center" bgcolor="${BRAND_PURPLE}" style="border-radius:12px;background-color:${BRAND_PURPLE};box-shadow:0 10px 24px -12px rgba(109,40,217,0.55);">
    <a href="${safeHref}" target="_blank" style="display:inline-block;padding:16px 44px;font-family:${FONT};font-size:15px;font-weight:700;line-height:1.1;letter-spacing:0.1px;color:#ffffff;text-decoration:none;border-radius:12px;">${esc(label)} &nbsp;&rarr;</a>
  </td>
</tr></table>
<!--<![endif]-->`;
}

type DetailRow = {
  label: string;
  value: string;
  accent?: boolean;
  mono?: boolean;
};

function detailsCard(
  title: string,
  rows: DetailRow[],
  status = "Awaiting response"
): string {
  const cells = rows
    .map((row, index) => {
      const last = index === rows.length - 1;
      const border = last ? "none" : `1px solid ${BORDER}`;
      const valueColor = row.accent ? BRAND_PURPLE : row.mono ? FAINT : INK;
      const valueStyle = [
        "padding:13px 0",
        `border-bottom:${border}`,
        `font-family:${row.mono ? "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" : FONT}`,
        `font-size:${row.mono ? "11.5px" : "14px"}`,
        `font-weight:${row.mono ? "600" : "700"}`,
        `letter-spacing:${row.mono ? "0.03em" : "0"}`,
        `color:${valueColor}`,
        "text-align:right",
        "word-break:break-word",
      ].join(";");
      return `<tr>
  <td style="padding:13px 0;border-bottom:${border};font-family:${FONT};font-size:11.5px;font-weight:700;letter-spacing:0.9px;text-transform:uppercase;color:#8f86a4;white-space:nowrap;">${esc(row.label)}</td>
  <td style="${valueStyle}">${esc(row.value)}</td>
</tr>`;
    })
    .join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;background-color:#ffffff;border:1px solid ${BORDER};border-radius:16px;">
  <tr><td class="card-pad" style="padding:18px 20px 4px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-family:${FONT};font-size:9.5px;font-weight:800;letter-spacing:1.7px;text-transform:uppercase;color:#9a92ad;">${esc(title)}</td>
      <td align="right" class="hide"><span style="display:inline-block;border:1px solid #fde68a;border-radius:999px;background-color:#fffbeb;padding:4px 9px;font-family:${FONT};font-size:8.5px;font-weight:800;letter-spacing:0.8px;text-transform:uppercase;color:#92400e;white-space:nowrap;">${esc(status)}</span></td>
    </tr></table>
  </td></tr>
  <tr><td class="card-pad" style="padding:0 20px 6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${cells}</table>
  </td></tr>
</table>`;
}

function quoteBlock(message: string, inviterName: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0;background-color:${SURFACE};border:1px solid ${BORDER};border-radius:12px;">
  <tr><td style="padding:16px 18px;font-family:${FONT};font-size:14px;line-height:1.65;color:#4b4263;font-style:italic;">
    &ldquo;${esc(message)}&rdquo;
    <span style="display:block;margin-top:7px;font-size:12px;font-style:normal;font-weight:700;letter-spacing:0.2px;color:${INK};">&mdash; ${esc(inviterName)}</span>
  </td></tr>
</table>`;
}

function stepsBlock(steps: { title: string; body: string }[]): string {
  const cells = steps
    .map(
      (step, index) => `<td class="stack" width="33.33%" valign="top" style="padding:0 ${index === steps.length - 1 ? "0" : "14px"} 0 0;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td width="26" height="26" align="center" bgcolor="#f3e8ff" style="width:26px;height:26px;border-radius:999px;font-family:${FONT};font-size:12px;font-weight:800;line-height:26px;color:${BRAND_PURPLE};">${index + 1}</td>
  </tr></table>
  <div style="padding-top:9px;font-family:${FONT};font-size:13px;font-weight:700;line-height:1.35;color:${INK};">${esc(step.title)}</div>
  <div style="padding-top:3px;font-family:${FONT};font-size:12px;line-height:1.55;color:${MUTED};">${esc(step.body)}</div>
</td>`
    )
    .join("");

  return `<p style="margin:0 0 14px;font-family:${FONT};font-size:9.5px;font-weight:800;letter-spacing:1.7px;text-transform:uppercase;color:#9a92ad;">What happens next</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`;
}

function securityBlock(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${SURFACE};border:1px solid ${BORDER};border-radius:12px;">
  <tr><td style="padding:14px 16px;font-family:${FONT};font-size:12px;line-height:1.65;color:#6f6785;">
    <strong style="color:${INK};">Keep this link to yourself.</strong> Pulse will never ask for your password by email. This invitation is unique to you, so please don&rsquo;t forward it.
  </td></tr>
</table>`;
}

function layout(options: {
  preheader: string;
  eyebrow: string;
  heading: string;
  intro: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaHref: string;
  ctaNote: string;
  steps?: { title: string; body: string }[];
  security?: boolean;
  footerNote: string;
  reason: string;
}): string {
  const {
    preheader,
    eyebrow,
    heading,
    intro,
    bodyHtml,
    ctaLabel,
    ctaHref,
    ctaNote,
    steps,
    security,
    footerNote,
    reason,
  } = options;
  const stepsHtml =
    steps && steps.length
      ? `<tr><td class="pad" style="padding:30px 40px 0;">${stepsBlock(steps)}</td></tr>`
      : "";
  const securityHtml = security
    ? `<tr><td class="pad" style="padding:26px 40px 0;">${securityBlock()}</td></tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<title>${esc(heading)}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
<style>
  #outlook a { padding:0; }
  body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table, td { mso-table-lspace:0pt !important; mso-table-rspace:0pt !important; border-collapse:collapse !important; }
  img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; }
  a { color:${BRAND_PURPLE}; }
  @media only screen and (max-width:620px) {
    .wrap { width:100% !important; max-width:100% !important; }
    .pad { padding-left:24px !important; padding-right:24px !important; }
    .card-pad { padding-left:18px !important; padding-right:18px !important; }
    .h1 { font-size:27px !important; line-height:1.2 !important; letter-spacing:-0.6px !important; }
    .stack { display:block !important; width:100% !important; max-width:100% !important; padding:0 0 16px 0 !important; }
    .hide { display:none !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${CANVAS};-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(preheader)}&#8203;&zwnj;&nbsp;&#8203;&zwnj;&nbsp;&#8203;&zwnj;&nbsp;&#8203;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CANVAS}" style="background-color:${CANVAS};">
<tr><td align="center" style="padding:36px 12px;">
  <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" class="wrap" style="width:640px;max-width:100%;background-color:#ffffff;border:1px solid ${BORDER};border-radius:20px;overflow:hidden;box-shadow:0 20px 44px -24px rgba(23,19,33,0.25);">
    ${masthead()}

    <tr><td class="pad" style="padding:36px 40px 0;font-family:${FONT};color:${INK};">
      <p style="margin:0;font-family:${FONT};font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:${BRAND_PURPLE};">${esc(eyebrow)}</p>
      <h1 class="h1" style="margin:14px 0 0;font-family:${FONT};font-size:31px;line-height:1.18;font-weight:800;letter-spacing:-0.8px;color:${INK};">${esc(heading)}</h1>
      <p style="margin:15px 0 0;font-family:${FONT};font-size:15.5px;line-height:1.7;color:${MUTED};">${intro}</p>
      ${bodyHtml}
    </td></tr>

    <tr><td class="pad" align="center" style="padding:30px 40px 0;">
      ${cta(ctaHref, ctaLabel)}
      <p style="margin:14px 0 0;font-family:${FONT};font-size:12.5px;line-height:1.65;color:${MUTED};">${ctaNote}</p>
      <p style="margin:8px 0 0;font-family:${FONT};font-size:11px;line-height:1.6;color:${FAINT};">
        Button not working? <a href="${esc(ctaHref)}" target="_blank" style="color:${BRAND_PURPLE};font-weight:600;text-decoration:underline;">Open your invitation in a browser</a>.
      </p>
    </td></tr>

    ${stepsHtml}
    ${securityHtml}

    <tr><td class="pad" style="padding:28px 40px 0;"><div style="height:1px;background-color:${BORDER};font-size:0;line-height:0;">&nbsp;</div></td></tr>

    <tr><td class="pad" style="padding:20px 40px 30px;font-family:${FONT};">
      <p style="margin:0;font-size:12.5px;line-height:1.7;color:${MUTED};">${footerNote}</p>
      <p style="margin:16px 0 0;font-size:9px;font-weight:800;letter-spacing:1.7px;text-transform:uppercase;color:#a39cb0;">Pulse &middot; Pharmacy intelligence, delivered</p>
      <p style="margin:6px 0 0;font-size:10.5px;line-height:1.7;color:#a39cb0;">
        Pulse by Duniya Healthcare &middot; Lusaka, Zambia<br />
        You received this because ${esc(reason)} If it wasn&rsquo;t meant for you, you can safely ignore it.
      </p>
    </td></tr>
  </table>

  <p style="margin:18px auto 0;max-width:520px;text-align:center;font-family:${FONT};font-size:10px;line-height:1.6;color:#a39cb0;">
    Sent securely by Pulse &middot; noreply@thestackone.com<br />
    This is a one-time transactional message about your Pulse account.
  </p>
</td></tr>
</table>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/* Team invitation — Pharmacy portal                                   */
/* ------------------------------------------------------------------ */

export type TeamInviteEmailParams = {
  pharmacyName: string;
  inviterName: string;
  inviteeName: string;
  role: string;
  storeNames: string[];
  personalMessage?: string;
  inviteId: string;
  acceptUrl: string;
  /** Human-readable date the invitation expires. */
  expiresAt: string;
};

export function renderTeamInviteEmail(params: TeamInviteEmailParams): EmailContent {
  const name = params.inviteeName.trim() || "there";
  const preheader = `${params.inviterName} invited you to join ${params.pharmacyName} on Pulse. Accept by ${params.expiresAt}.`;
  const messageBlock = params.personalMessage
    ? quoteBlock(params.personalMessage, params.inviterName)
    : "";

  const html = layout({
    preheader,
    eyebrow: "Team invitation",
    heading: `Your seat at ${params.pharmacyName} is ready`,
    intro: `Hi <strong style="color:${INK};">${esc(name)}</strong> &mdash; ${esc(params.inviterName)} has invited you to join the <strong style="color:${INK};">${esc(params.pharmacyName)}</strong> team as <strong style="color:${INK};">${esc(params.role)}</strong>. Everything you need for your first shift will be waiting inside.`,
    bodyHtml: `${messageBlock}${detailsCard("Invitation details", [
      { label: "Organisation", value: params.pharmacyName },
      { label: "Your role", value: params.role, accent: true },
      { label: "Store access", value: params.storeNames.join(" · ") },
      { label: "Invited by", value: params.inviterName },
      { label: "Expires", value: params.expiresAt, accent: true },
      { label: "Reference", value: params.inviteId, mono: true },
    ])}`,
    ctaLabel: "Accept invitation",
    ctaHref: params.acceptUrl,
    ctaNote: `It takes about a minute. You&rsquo;ll set a password, then land in the <strong style="color:${INK};">${esc(params.pharmacyName)}</strong> console with your role and store access already applied.`,
    steps: [
      { title: "Accept", body: "Confirm your seat with one click." },
      { title: "Set your password", body: "Choose a secure password for your account." },
      { title: "Start your shift", body: "Your counter, shelves and tools are ready." },
    ],
    security: true,
    footerNote: `Questions? Reach out to <strong style="color:${INK};">${esc(params.inviterName)}</strong> &mdash; they&rsquo;ll be expecting you.`,
    reason: `${params.inviterName} invited you to join ${params.pharmacyName} on Pulse.`,
  });

  const text = [
    `Hi ${name},`,
    "",
    `${params.inviterName} invited you to join ${params.pharmacyName} on Pulse as ${params.role}.`,
    "",
    "INVITATION DETAILS",
    `Organisation: ${params.pharmacyName}`,
    `Your role: ${params.role}`,
    `Store access: ${params.storeNames.join(", ")}`,
    `Invited by: ${params.inviterName}`,
    `Expires: ${params.expiresAt}`,
    `Reference: ${params.inviteId}`,
    params.personalMessage ? `\nA note from ${params.inviterName}: "${params.personalMessage}"` : "",
    "",
    "Accept your invitation:",
    params.acceptUrl,
    "",
    "What happens next:",
    "1. Accept — confirm your seat with one click.",
    "2. Set your password — choose a secure password.",
    "3. Start your shift — your counter, shelves and tools are ready.",
    "",
    "Pulse will never ask for your password by email. This invitation is unique to you.",
    "",
    "— Pulse · Pharmacy intelligence, delivered",
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  return {
    subject: `${params.inviterName} invited you to ${params.pharmacyName} on Pulse`,
    preheader,
    html,
    text,
  };
}

/* ------------------------------------------------------------------ */
/* Pharmacy welcome — fired when a pharmacy is created                 */
/* ------------------------------------------------------------------ */

export type PharmacyWelcomeEmailParams = {
  pharmacyName: string;
  ownerName: string;
  ownerEmail: string;
  /** Team emails that were invited at registration. */
  teamEmails: string[];
  consoleUrl: string;
};

export function renderPharmacyWelcomeEmail(params: PharmacyWelcomeEmailParams): EmailContent {
  const preheader = `${params.pharmacyName} is live on Pulse — here's your first week, mapped.`;
  const html = layout({
    preheader,
    eyebrow: "Welcome to Pulse",
    heading: `${params.pharmacyName} is on the network`,
    intro: `Congratulations, <strong style="color:${INK};">${esc(params.ownerName)}</strong> &mdash; <strong style="color:${INK};">${esc(params.pharmacyName)}</strong> now has a Pulse account. Your console is ready: shelves, counter and team in one place.`,
    bodyHtml: `${detailsCard(
      "Account details",
      [
        { label: "Pharmacy", value: params.pharmacyName },
        { label: "Owner", value: `${params.ownerName} · ${params.ownerEmail}` },
        { label: "Main store", value: "Declared in Stores — the account's home" },
        {
          label: "Team invitations",
          value: params.teamEmails.length ? `${params.teamEmails.length} sent` : "None yet",
        },
      ],
      "Live"
    )}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;">
        <tr><td style="font-family:${FONT};">
          <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:${INK};">Your first week, mapped</p>
          <p style="margin:0 0 7px;font-size:13.5px;line-height:1.65;color:${MUTED};"><strong style="color:${INK};">1.</strong> Declare your main store under <strong style="color:${INK};">Stores</strong> — it becomes the application's home.</p>
          <p style="margin:0 0 7px;font-size:13.5px;line-height:1.65;color:${MUTED};"><strong style="color:${INK};">2.</strong> Load your shelves under <strong style="color:${INK};">Product Catalogue</strong>, then watch <strong style="color:${INK};">Stock Balance</strong> come alive.</p>
          <p style="margin:0 0 7px;font-size:13.5px;line-height:1.65;color:${MUTED};"><strong style="color:${INK};">3.</strong> Invite your team under <strong style="color:${INK};">User Management</strong> — every invitation is a branded email.</p>
          <p style="margin:0;font-size:13.5px;line-height:1.65;color:${MUTED};"><strong style="color:${INK};">4.</strong> Make your first sale at the <strong style="color:${INK};">Point of Sale</strong> — the whole checkout takes under two minutes.</p>
        </td></tr>
      </table>`,
    ctaLabel: "Open your console",
    ctaHref: params.consoleUrl,
    ctaNote: `New here? The <strong style="color:${INK};">Walkthrough</strong> in the sidebar gives you a guided lap of the whole console in about three minutes.`,
    footerNote: `Your account is pending a quick network review &mdash; every tool is already unlocked on your side. We&rsquo;re glad you&rsquo;re here.`,
    reason: `you registered ${params.pharmacyName} on Pulse.`,
  });

  const text = [
    `Congratulations, ${params.ownerName} — ${params.pharmacyName} now has a Pulse account.`,
    "",
    "ACCOUNT DETAILS",
    `Pharmacy: ${params.pharmacyName}`,
    `Owner: ${params.ownerName} · ${params.ownerEmail}`,
    `Team invitations: ${params.teamEmails.length ? `${params.teamEmails.length} sent` : "None yet"}`,
    "",
    "Your first week, mapped:",
    "1. Declare your main store under Stores.",
    "2. Load your shelves under Product Catalogue; watch Stock Balance.",
    "3. Invite your team under User Management.",
    "4. Make your first sale at the Point of Sale.",
    "",
    `Open your console: ${params.consoleUrl}`,
    params.teamEmails.length ? `\nTeam invitations sent to: ${params.teamEmails.join(", ")}` : "",
    "",
    "— Pulse · Pharmacy intelligence, delivered",
  ].join("\n");

  return { subject: `Welcome to Pulse, ${params.pharmacyName} — your console is ready`, preheader, html, text };
}

/* ------------------------------------------------------------------ */
/* Pulse console admin/staff invitation                                */
/* ------------------------------------------------------------------ */

export type PulseAdminInviteEmailParams = {
  inviterName: string;
  inviteeName: string;
  inviteeEmail: string;
  role: string;
  inviteId: string;
  acceptUrl: string;
  expiresAt: string;
};

export function renderPulseAdminInviteEmail(params: PulseAdminInviteEmailParams): EmailContent {
  const name = params.inviteeName.trim() || params.inviteeEmail.split("@")[0];
  const preheader = `${params.inviterName} invited you to the ${params.role} team on Pulse. Accept by ${params.expiresAt}.`;

  const html = layout({
    preheader,
    eyebrow: "Pulse console invitation",
    heading: `You're on the ${params.role} team`,
    intro: `Hi <strong style="color:${INK};">${esc(name)}</strong> &mdash; ${esc(params.inviterName)} has added you to the Pulse console as <strong style="color:${INK};">${esc(params.role)}</strong>. Accept below to set your password and step into the network.`,
    bodyHtml: detailsCard("Access details", [
      { label: "Platform", value: "Pulse console" },
      { label: "Your role", value: params.role, accent: true },
      { label: "Invited by", value: params.inviterName },
      { label: "Your email", value: params.inviteeEmail },
      { label: "Expires", value: params.expiresAt, accent: true },
      { label: "Reference", value: params.inviteId, mono: true },
    ]),
    ctaLabel: "Accept invitation",
    ctaHref: params.acceptUrl,
    ctaNote:
      "It takes about a minute. You&rsquo;ll set a password, then land in the Pulse console with your access already in place.",
    steps: [
      { title: "Accept", body: "Confirm your seat with one click." },
      { title: "Set your password", body: "Choose a secure password for your account." },
      { title: "Enter the console", body: "Your network view is ready when you are." },
    ],
    security: true,
    footerNote: `The Pulse console is the network side of Pulse &mdash; pharmacies, stock visibility, suppliers and the audit trail, in one live view.`,
    reason: `${params.inviterName} invited you to the Pulse console.`,
  });

  const text = [
    `Hi ${name},`,
    "",
    `${params.inviterName} added you to the Pulse console as ${params.role}.`,
    "",
    "ACCESS DETAILS",
    "Platform: Pulse console",
    `Your role: ${params.role}`,
    `Invited by: ${params.inviterName}`,
    `Your email: ${params.inviteeEmail}`,
    `Expires: ${params.expiresAt}`,
    `Reference: ${params.inviteId}`,
    "",
    "Accept your invitation:",
    params.acceptUrl,
    "",
    "What happens next:",
    "1. Accept — confirm your seat with one click.",
    "2. Set your password — choose a secure password.",
    "3. Enter the console — your network view is ready.",
    "",
    "Pulse will never ask for your password by email. This invitation is unique to you.",
    "",
    "— Pulse · Pharmacy intelligence, delivered",
  ].join("\n");

  return { subject: `${params.inviterName} invited you to the Pulse console`, preheader, html, text };
}
