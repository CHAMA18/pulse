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
in `src/lib/cloud/invitations.ts`. That seam invokes these deployed callables
with the Firebase JS SDK (region `europe-west1`), sending the signed-in user's
ID token with every request. The same templates are rendered client-side for
the preview dialog and local outbox, and a callable rejection surfaces as
`CloudFunctionError` with the server's code and message. No component changes.

## Configuration

```bash
cd functions
npm install

# Email delivery goes through Resend, sending from the domain verified in
# the Resend account (thestackone.com). The key lives in Secret Manager —
# no SMTP host or password needed.
firebase functions:secrets:set RESEND_API_KEY

# Optional overrides (the defaults target the GH Pages deployment and the
# verified sender):
# APP_URL=https://chama18.github.io/pulse/
# EMAIL_FROM="Pulse <noreply@thestackone.com>"
# EMAIL_REPLY_TO=noreply@thestackone.com
```

## Deploy

```bash
firebase deploy --only functions
```

Every delivered message is archived to Firestore at `InvitationMail/{id}`
with its function, recipients and provider message id — the audit trail
behind the portals' email logs.
