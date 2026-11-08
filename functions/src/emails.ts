/* ------------------------------------------------------------------ */
/* Pulse invitation emails — server-rendered HTML                      */
/* ------------------------------------------------------------------ */
/* The same brand system the web app renders for previews: purple      */
/* gradient masthead, heartbeat mark, bulletproof CTA. Kept dependency */
/* -free so the functions bundle stays small.                          */

const BRAND_PURPLE = "#7c3aed";
const BRAND_FUCHSIA = "#c026d3";
const INK = "#1e1b2e";
const MUTED = "#6b6480";

function esc(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function heartbeatMark(width = 44): string {
  return `<svg width="${width}" height="${Math.round(width * 0.72)}" viewBox="0 0 44 32" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;"><path d="M4 16 L12 16 L15 8 L20 25 L24 12 L27 16 L40 16" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function cta(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px auto;"><tr><td bgcolor="${BRAND_PURPLE}" style="border-radius:10px;background:linear-gradient(135deg,${BRAND_PURPLE} 0%,${BRAND_FUCHSIA} 100%);"><a href="${href}" target="_blank" style="display:inline-block;padding:14px 34px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${esc(label)}</a></td></tr></table>`;
}

function detailsCard(rows: { label: string; value: string }[]): string {
  const cells = rows
    .map(
      (row) =>
        `<tr><td style="padding:9px 18px;font-size:12.5px;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;color:#8d85a3;white-space:nowrap;">${esc(row.label)}</td><td style="padding:9px 18px;font-size:14.5px;font-weight:600;color:${INK};text-align:right;">${esc(row.value)}</td></tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;background-color:#faf8fe;border:1px solid #ece7f8;border-radius:14px;">${cells}</table>`;
}

function layout(options: {
  preheader: string;
  eyebrow: string;
  heading: string;
  intro: string;
  bodyHtml: string;
  ctaHtml: string;
  ctaNote: string;
  footerNote: string;
}): string {
  const { preheader, eyebrow, heading, intro, bodyHtml, ctaHtml, ctaNote, footerNote } = options;
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="color-scheme" content="light" /><title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background-color:#f3effc;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3effc">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px;max-width:100%;background-color:#ffffff;border-radius:20px;overflow:hidden;">
<tr><td style="background:linear-gradient(135deg,${BRAND_PURPLE} 0%,${BRAND_FUCHSIA} 100%);background-color:${BRAND_PURPLE};padding:26px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-right:10px;">${heartbeatMark()}</td><td style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:24px;font-weight:700;letter-spacing:-0.5px;color:#ffffff;">Pulse</td></tr></table></td>
<td align="right" style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:2.2px;text-transform:uppercase;color:rgba(255,255,255,0.85);">Pharmacy, in rhythm</td>
</tr></table>
</td></tr>
<tr><td style="padding:36px 40px 8px 40px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};">
<p style="margin:0 0 10px 0;font-size:11px;font-weight:700;letter-spacing:2.2px;text-transform:uppercase;color:${BRAND_PURPLE};">${esc(eyebrow)}</p>
<h1 style="margin:0 0 14px 0;font-size:26px;line-height:1.25;font-weight:700;letter-spacing:-0.4px;color:${INK};">${esc(heading)}</h1>
<p style="margin:0 0 22px 0;font-size:15px;line-height:1.65;color:${MUTED};">${intro}</p>
${bodyHtml}
</td></tr>
<tr><td align="center" style="padding:10px 40px 6px 40px;">${ctaHtml}
<p style="margin:10px 0 0 0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#9a93ad;">${ctaNote}</p>
</td></tr>
<tr><td style="padding:26px 40px 0 40px;"><div style="height:1px;background-color:#ece7f8;font-size:0;line-height:0;">&nbsp;</div></td></tr>
<tr><td style="padding:20px 40px 32px 40px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="font-size:13px;color:${MUTED};line-height:1.7;">${footerNote}</td>
<td align="right" style="font-size:12px;color:#b6aec9;white-space:nowrap;">Pulse &middot; Lusaka, Zambia</td>
</tr></table>
<p style="margin:14px 0 0 0;font-size:11px;line-height:1.6;color:#b6aec9;">You are receiving this email because someone invited you to Pulse. If you were not expecting it, you can safely ignore this message.</p>
</td></tr>
</table>
<p style="margin:18px auto 0 auto;max-width:520px;text-align:center;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;color:#a49bba;">Sent by Pulse Cloud Functions &middot; invitations@pulse.network</p>
</td></tr></table>
</body></html>`;
}

export type EmailContent = { subject: string; html: string; text: string };

export function teamInviteEmail(params: {
  pharmacyName: string;
  inviterName: string;
  inviteeName: string;
  role: string;
  storeNames: string[];
  personalMessage?: string;
  inviteId: string;
  acceptUrl: string;
  expiresAt: string;
}): EmailContent {
  const messageBlock = params.personalMessage
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;border-left:3px solid ${BRAND_FUCHSIA};background-color:#fdf7ff;"><tr><td style="padding:14px 18px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.65;color:#4c4368;font-style:italic;">&ldquo;${esc(params.personalMessage)}&rdquo;<span style="display:block;margin-top:6px;font-style:normal;font-weight:700;color:${INK};">&mdash; ${esc(params.inviterName)}</span></td></tr></table>`
    : "";
  return {
    subject: `${params.inviterName} invited you to ${params.pharmacyName} on Pulse`,
    html: layout({
      preheader: `${params.inviterName} invited you to join ${params.pharmacyName} on Pulse as ${params.role}.`,
      eyebrow: "Team invitation",
      heading: `Join ${params.pharmacyName} on Pulse`,
      intro: `Hi <strong style="color:${INK};">${esc(params.inviteeName || "there")}</strong> — ${esc(params.inviterName)} has invited you to the <strong style="color:${INK};">${esc(params.pharmacyName)}</strong> team.`,
      bodyHtml: `${messageBlock}${detailsCard([
        { label: "Organisation", value: params.pharmacyName },
        { label: "Your role", value: params.role },
        { label: "Store access", value: params.storeNames.join(" · ") },
        { label: "Invited by", value: params.inviterName },
        { label: "Invitation ref", value: params.inviteId },
      ])}`,
      ctaHtml: cta(params.acceptUrl, "Accept invitation"),
      ctaNote: `This invitation is open until <strong>${esc(params.expiresAt)}</strong>.`,
      footerNote: `Once you accept, you'll set a password and land straight in the <strong style="color:${INK};">${esc(params.pharmacyName)}</strong> console with your role already applied.`,
    }),
    text: `${params.inviterName} invited you to join ${params.pharmacyName} on Pulse as ${params.role}.\nAccept: ${params.acceptUrl}\nOpen until ${params.expiresAt}. Ref ${params.inviteId}.`,
  };
}

export function pharmacyWelcomeEmail(params: {
  pharmacyName: string;
  ownerName: string;
  ownerEmail: string;
  teamEmails: string[];
  consoleUrl: string;
}): EmailContent {
  return {
    subject: `Welcome to Pulse, ${params.pharmacyName} — your console is ready`,
    html: layout({
      preheader: `${params.pharmacyName} is live on Pulse — here's your first week, mapped.`,
      eyebrow: "Welcome to Pulse",
      heading: `${params.pharmacyName} is on the network`,
      intro: `Congratulations, <strong style="color:${INK};">${esc(params.ownerName)}</strong> — <strong style="color:${INK};">${esc(params.pharmacyName)}</strong> now has a Pulse account. Your console is ready: shelves, counter and team in one place.`,
      bodyHtml: detailsCard([
        { label: "Pharmacy", value: params.pharmacyName },
        { label: "Owner", value: `${params.ownerName} · ${params.ownerEmail}` },
        {
          label: "Team invitations",
          value: params.teamEmails.length ? `${params.teamEmails.length} sent` : "None yet",
        },
      ]),
      ctaHtml: cta(params.consoleUrl, "Open your console"),
      ctaNote: "New here? The <strong>Walkthrough</strong> in the sidebar gives you a guided lap of the whole console.",
      footerNote: `Your account is pending a quick network review — every tool is already unlocked on your side. We're glad you're here.`,
    }),
    text: `Congratulations, ${params.ownerName} — ${params.pharmacyName} now has a Pulse account.\nOpen your console: ${params.consoleUrl}`,
  };
}

export function pulseAdminInviteEmail(params: {
  inviterName: string;
  inviteeName: string;
  inviteeEmail: string;
  role: string;
  acceptUrl: string;
}): EmailContent {
  return {
    subject: `${params.inviterName} invited you to the Pulse console`,
    html: layout({
      preheader: `${params.inviterName} invited you to the ${params.role} team on Pulse.`,
      eyebrow: "Pulse console invitation",
      heading: `You're on the ${params.role} team`,
      intro: `Hi <strong style="color:${INK};">${esc(params.inviteeName || params.inviteeEmail.split("@")[0])}</strong> — ${esc(params.inviterName)} has added you to the Pulse console as <strong style="color:${INK};">${esc(params.role)}</strong>.`,
      bodyHtml: detailsCard([
        { label: "Platform", value: "Pulse console" },
        { label: "Your role", value: params.role },
        { label: "Invited by", value: params.inviterName },
        { label: "Your email", value: params.inviteeEmail },
      ]),
      ctaHtml: cta(params.acceptUrl, "Accept invitation"),
      ctaNote: "Not expected? You can safely ignore this email — the invitation simply expires.",
      footerNote: `The Pulse console is the network side of Pulse: pharmacies, stock visibility, suppliers and the audit trail.`,
    }),
    text: `${params.inviterName} added you to the Pulse console as ${params.role}.\nAccept: ${params.acceptUrl}`,
  };
}
