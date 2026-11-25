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

# Optional overrides (links default to the deployed custom domain; a stale
# GitHub Pages APP_URL is ignored so email links never leave the domain):
# APP_URL=https://pulse.duniyahealthcare.com/
# EMAIL_FROM="Pulse <noreply@thestackone.com>"
# EMAIL_REPLY_TO=noreply@thestackone.com
```

## Deploy

```bash
./scripts/deploy-functions.sh --check              # quota headroom, no changes
./scripts/deploy-functions.sh                       # deploy everything, batched
./scripts/deploy-functions.sh sendTeamInvite        # deploy named functions
./scripts/deploy-functions.sh --verify-only         # audit what is actually live
```

Use the script rather than a bare `firebase deploy --only functions`. A single
large deploy trips the region's Cloud Run CPU quota, and the failure is quiet:
the CLI reports the batch as failed while the affected function keeps serving
its previous revision. That is how `onPharmacyDocCreated` stayed on an older
build through a nine-function release.

### Why batching is required

`europe-west1` allows **20 vCPU** of Cloud Run CPU per project
(`CpuAllocPerProjectRegion`). Every Pulse function is a 1 vCPU gen2 service
with `maxInstances: 10`, so the real ceiling is **20 concurrent instances** in
the region, not 20 functions. During a rollout each function needs about one
spare instance while the new revision passes its startup probe and the old one
drains, and recently warm instances keep holding CPU for a few minutes.

Measured on 25 Nov 2026 during a nine-function release:

| Point | Instances in use |
| --- | --- |
| Start of the batch | 14 |
| During rollouts | 19 |
| Quota | 20 |
| Settled afterwards | 12 |

The eighth function's revision failed with `Quota exceeded for total allowable
CPU per project per region`, traffic stayed on its old revision, and the deploy
command still exited after updating the other eight. A batch of **4** finishes
with roughly half the quota still free; that is the script's default.

### What the script does

1. Reads the live quota and the region's instance peak, then prints the
   headroom and the batch size it will use.
2. Deploys `--only functions:<names>` in batches of 4, waiting for each batch
   to settle before the next.
3. Checks the function was actually updated: its Cloud Function `updateTime`
   must be newer than the moment the batch started. A function the CLI skipped
   fails here, even though `latestCreated` and `latestReady` still agree.
4. Verifies every function by asking Cloud Run which revision takes 100% of
   traffic. A function whose newest revision is not the ready one is reported
   as stale — the check a bare deploy cannot give you.
5. Retries stale functions individually, 90 seconds apart, so the failed
   revision releases its CPU first.
6. Exits non-zero and names anything that did not roll out.

For a deploy started by hand (`firebase deploy --only functions:...`), audit it
the same way afterwards with the batch's start time:

```bash
./scripts/deploy-functions.sh --verify-only --since 2026-11-25T05:45:00Z
```

The script never changes `cpu`, `maxInstances`/`maxScale`, concurrency or any
other runtime setting. It only builds and deploys source.

### Escalation: raise the quota

Batching is the fix that needs no approval. If releases grow larger, ask for a
Cloud Run CPU quota increase in `europe-west1` — **50 vCPU** covers a full
44-function release with room for rollouts and normal traffic. Request it under
Google Cloud Console → IAM & Admin → Quotas → `Total CPU allocation` (service
`run.googleapis.com`, quota ID `CpuAllocPerProjectRegion`), region
`europe-west1`. The increase is a billing-adjacent change, so it is not applied
by this repository; nothing here requests it automatically.

Lowering `maxInstances` on idle functions during a deploy also frees quota, but
that is a production scaling change: make it deliberately in
`setGlobalOptions` in `functions/src/index.ts` and redeploy, never as a silent
side effect of a release.

Every delivered message is archived to Firestore at `InvitationMail/{id}`
with its function, recipients and provider message id — the audit trail
behind the portals' email logs.
