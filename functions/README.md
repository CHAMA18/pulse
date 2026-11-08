# Pulse Cloud Functions

The invitation engine for both Pulse portals. Three callable functions and one
Firestore trigger deliver the branded invitation emails (see
`src/lib/cloud/emails.ts` in the web app for the identical client-side
render used in previews).

| Function | Triggered by | Sends |
| --- | --- | --- |
| `sendTeamInvite` | Pharmacy portal → User Management → Invite user | One team invitation |
| `sendPulseAdminInvite` | Pulse console → User Management → Add user | One console invitation |
| `onPharmacyCreated` | Registration dialog ("Invite your team") | Owner welcome + N team invitations |
| `onPharmacyDocCreated` | Firestore `Pharmacy/{id}` create with `inviteEmails` array | Owner welcome + N team invitations |

## How the portals reach these

The web app calls invitations through one seam — `callCloudFunction(name, payload)`
in `src/lib/cloud/invitations.ts`. Today that seam executes the same email
builders locally (so the static site demos full delivery with previews and an
outbox). To move to live delivery, deploy this directory and point
`callCloudFunction` at `httpsCallable(functions, name)` — no component changes.

## Configuration

```bash
cd functions
npm install

# SMTP for delivery (any provider — Mailgun, SES, Postmark, Gmail relay…)
export SMTP_HOST=smtp.mailgun.org
export SMTP_PORT=587
export SMTP_USER=postmaster@pulse.network
export SMTP_PASS=••••••••
export SMTP_SECURE=false

# Where invite links point (defaults to the GH Pages deployment)
export APP_URL=https://chama18.github.io/pulse/
export EMAIL_FROM="Pulse <invitations@pulse.network>"
```

## Deploy

```bash
firebase deploy --only functions
```

Every delivered message is archived to Firestore at `InvitationMail/{id}`
with its function, recipients and provider message id — the audit trail
behind the portals' email logs.
