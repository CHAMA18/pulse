#!/usr/bin/env bash
#
# Deploy Pulse Cloud Functions without tripping the Cloud Run CPU quota.
#
# europe-west1 allows 20 vCPU of Cloud Run CPU for this project. Every Pulse
# function is a 1-vCPU gen2 service, so the quota is really "20 instances in
# the region at once". A batch deploy starts a new revision per function while
# the old revisions are still winding down, and once the region hits the
# ceiling Cloud Run refuses the next revision with:
#
#   Quota exceeded for total allowable CPU per project per region
#
# The Firebase CLI then exits 0-ish per function but reports "Deploys failed"
# for the casualty — and that function keeps serving its previous revision.
# This script deploys in small batches, checks the revision Cloud Run is really
# serving after each function, and retries stragglers on their own.
#
# It never changes cpu, maxInstances / maxScale or any other runtime setting.
#
# Usage:
#   ./scripts/deploy-functions.sh --check              # headroom report, no deploy
#   ./scripts/deploy-functions.sh                      # deploy every function
#   ./scripts/deploy-functions.sh onPharmacyCreated ... # deploy named functions
#   ./scripts/deploy-functions.sh --verify-only        # audit what is live
#   ./scripts/deploy-functions.sh --verify-only --since 2026-11-25T05:45:00Z
#   DEPLOY_BATCH_SIZE=2 ./scripts/deploy-functions.sh   # smaller batches
#
# Requires: firebase CLI logged in (npx firebase login), gcloud logged in
# (gcloud auth login — only used for read-only quota/revision lookups), curl.

set -uo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR" || exit 1

REGION="${FUNCTIONS_REGION:-europe-west1}"
BATCH="${DEPLOY_BATCH_SIZE:-0}"
MODE="deploy"
SINCE=""
TARGETS=()

usage() {
  cat <<'USAGE'
Deploy Pulse Cloud Functions without tripping the Cloud Run CPU quota.

  ./scripts/deploy-functions.sh --check                 headroom report, no deploy
  ./scripts/deploy-functions.sh                         deploy every function
  ./scripts/deploy-functions.sh onPharmacyCreated ...    deploy named functions
  ./scripts/deploy-functions.sh --verify-only           audit what is live
  ./scripts/deploy-functions.sh --verify-only --since 2026-11-25T05:45:00Z
                                                        also require an update
                                                        newer than that stamp
  DEPLOY_BATCH_SIZE=2 ./scripts/deploy-functions.sh     smaller batches

A deploy is only reported as done when every targeted function's update time is
newer than the moment its batch started. A function the CLI skipped, or one
whose rollout never took traffic, fails the run.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE="check" ;;
    --verify-only) MODE="verify" ;;
    --batch) BATCH="${2:-}"; shift ;;
    --batch=*) BATCH="${1#*=}" ;;
    --since) SINCE="${2:-}"; shift ;;
    --since=*) SINCE="${1#*=}" ;;
    -h|--help) usage; exit 0 ;;
    -*)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
    *) TARGETS+=("$1") ;;
  esac
  shift
done

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

# ---------------------------------------------------------------- project ----
PROJECT="${FIREBASE_PROJECT:-}"
if [ -z "$PROJECT" ] && [ -f .firebaserc ]; then
  PROJECT=$(python3 -c 'import json; print(json.load(open(".firebaserc"))["projects"]["default"])' 2>/dev/null)
fi
[ -n "$PROJECT" ] || die "Could not determine the Firebase project. Set FIREBASE_PROJECT."

command -v curl >/dev/null || die "curl is required."
command -v python3 >/dev/null || die "python3 is required."

TOKEN=$(gcloud auth print-access-token 2>/dev/null || true)
[ -n "$TOKEN" ] || die "gcloud is not authenticated. Run: gcloud auth login"

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)' 2>/dev/null || true)
[ -n "$PROJECT_NUMBER" ] || die "Could not read the project number for $PROJECT."

api() {
  curl -sS -H "Authorization: Bearer $TOKEN" "$1"
}

SERVICES_FILE=$(mktemp -t pulse-services)
trap 'rm -f "$SERVICES_FILE"' EXIT

load_services() {
  api "https://${REGION}-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/${PROJECT}/services?limit=200" \
    | python3 -c '
import json, sys

for svc in json.load(sys.stdin).get("items", []):
    ann = svc.get("metadata", {}).get("annotations", {}) or {}
    spec = svc.get("spec", {}).get("template", {}).get("spec", {})
    containers = spec.get("containers") or [{}]
    cpu = containers[0].get("resources", {}).get("limits", {}).get("cpu", "1")
    print("\t".join([
        svc["metadata"]["name"],
        ann.get("cloudfunctions.googleapis.com/function-id", ""),
        str(cpu),
        ann.get("run.googleapis.com/maxScale", ""),
    ]))
' > "$SERVICES_FILE"
}

service_for() {
  awk -F '\t' -v fn="$1" '$2 == fn { print $1; exit }' "$SERVICES_FILE"
}

# ------------------------------------------------------------ quota + load ---
quota_vcpu() {
  api "https://cloudquotas.googleapis.com/v1/projects/${PROJECT_NUMBER}/locations/global/services/run.googleapis.com/quotaInfos?pageSize=100" \
    | python3 -c '
import json, sys

region = sys.argv[1]
for info in json.load(sys.stdin).get("quotaInfos", []):
    if info.get("quotaId") != "CpuAllocPerProjectRegion":
        continue
    for dim in info.get("dimensionsInfos", []):
        if (dim.get("dimensions") or {}).get("region") == region:
            print(int(dim.get("details", {}).get("value", 0)) // 1000)
' "$REGION"
}

peak_instances() {
  local now start
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  start=$(date -u -v-30M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%SZ)
  curl -sS -G -H "Authorization: Bearer $TOKEN" \
    "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries" \
    --data-urlencode "filter=metric.type=\"run.googleapis.com/container/instance_count\" AND resource.type=\"cloud_run_revision\"" \
    --data-urlencode "interval.startTime=$start" \
    --data-urlencode "interval.endTime=$now" \
    --data-urlencode "aggregation.alignmentPeriod=60s" \
    --data-urlencode "aggregation.perSeriesAligner=ALIGN_MAX" \
    --data-urlencode "aggregation.crossSeriesReducer=REDUCE_SUM" \
    | python3 -c '
import json, sys

try:
    series = json.load(sys.stdin).get("timeSeries", [])
except ValueError:
    print(0)
    raise SystemExit
# Peak of the per-minute sums across revisions. The quota is enforced against
# live instances, and this peak is what a rollout has to fit under.
peak = 0.0
for entry in series:
    for point in entry.get("points", []):
        value = point.get("value", {})
        raw = value.get("int64Value", value.get("doubleValue", 0))
        peak = max(peak, float(raw or 0))
print(int(peak))
'
}

# ------------------------------------------------------------- revisions ----
# Prints "ok <revision>" when the newest created revision is the one serving.
# Prints "stale <ready> <created>" when a rollout never became ready, which is
# what a quota failure looks like: old revision still takes 100% of traffic.
revision_state() {
  local service="$1"
  api "https://${REGION}-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/${PROJECT}/services/${service}" \
    | python3 -c '
import json, sys

try:
    svc = json.load(sys.stdin)
except ValueError:
    print("missing")
    raise SystemExit
if "status" not in svc:
    print("missing")
    raise SystemExit
status = svc["status"]
ready = status.get("latestReadyRevisionName", "")
created = status.get("latestCreatedRevisionName", "")
traffic = status.get("traffic") or []
serving = 100 if any(
    t.get("revisionName") == created and int(t.get("percent", 0)) == 100 for t in traffic
) else 0
if ready and ready == created and serving:
    print("ok", created)
else:
    print("stale", ready or "-", created or "-")
'
}

function_update_time() {
  api "https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/functions/$1" \
    | python3 -c '
import json, sys

try:
    print(json.load(sys.stdin).get("updateTime", ""))
except ValueError:
    print("")
'
}

# Prints yes/no/unknown: is the first ISO stamp strictly newer than the second?
iso_newer() {
  python3 -c '
import re, sys
from datetime import datetime, timezone

def parse(value):
    match = re.match(
        r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$",
        value or "",
    )
    if not match:
        return None
    base = datetime.strptime(match.group(1), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    return base.timestamp() + float("0." + (match.group(2) or "0"))

left = parse(sys.argv[1])
right = parse(sys.argv[2])
if left is None or right is None:
    print("unknown")
else:
    print("yes" if left > right else "no")
' "$1" "$2"
}

# A rollout is only proven twice over: the function must have been updated after
# the deploy started, and Cloud Run must be serving its newest revision. The
# update-time check catches a function the CLI silently skipped; the revision
# check catches one whose new revision never became ready.
verify_function() {
  local fn="$1" since="${2:-}" service state updated verdict
  if [ -n "$since" ]; then
    updated=$(function_update_time "$fn")
    verdict=$(iso_newer "$updated" "$since")
    if [ "$verdict" != "yes" ]; then
      if [ "$verdict" = "unknown" ]; then
        printf '  !! %-33s rollout unproven: update time unreadable\n' "$fn"
      else
        printf '  !! %-33s did not roll out: updated %s, deploy started %s\n' \
          "$fn" "${updated:-unknown}" "$since"
      fi
      return 1
    fi
  fi
  service=$(service_for "$fn")
  if [ -z "$service" ]; then
    printf '  ? %-34s no Cloud Run service (v1 function or not deployed)\n' "$fn"
    return 0
  fi
  state=$(revision_state "$service")
  case "$state" in
    ok\ *) printf '  ok %-33s %s\n' "$fn" "${state#ok }"; return 0 ;;
    stale\ *)
      printf '  !! %-33s serving %s, newest %s\n' "$fn" \
        "$(echo "$state" | awk '{print $2}')" "$(echo "$state" | awk '{print $3}')"
      return 1
      ;;
    *)
      printf '  !! %-33s Cloud Run service could not be read\n' "$fn"
      return 1
      ;;
  esac
}

deploy_names() {
  local only="" name
  for name in "$@"; do only="${only:+$only,}functions:${name}"; done
  npx firebase deploy --only "$only" --project "$PROJECT" --non-interactive
}

# --------------------------------------------------------------- planning ---
QUOTA=$(quota_vcpu)
[ -n "$QUOTA" ] && [ "$QUOTA" -gt 0 ] || die "Could not read the Cloud Run CPU quota for $REGION."
PEAK=$(peak_instances)
HEADROOM=$(( QUOTA - PEAK ))
[ "$HEADROOM" -lt 0 ] && HEADROOM=0
if [ -z "$BATCH" ] || [ "$BATCH" -lt 1 ] 2>/dev/null; then BATCH=4; fi

printf 'Project      %s (%s)\n' "$PROJECT" "$PROJECT_NUMBER"
printf 'Region       %s\n' "$REGION"
printf 'CPU quota    %s vCPU  (= %s concurrent 1-vCPU instances)\n' "$QUOTA" "$QUOTA"
printf 'Peak now     ~%s instances (30 min)\n' "$PEAK"
printf 'Headroom     ~%s vCPU\n' "$HEADROOM"
printf 'Batch size   %s function(s) per deploy\n\n' "$BATCH"

# Four is what a measured nine-function batch shows is safe: it reached 19 of
# 20 instances and the eighth function failed its health check. Each function
# in flight needs about one spare instance while its old revision drains.
if [ "$HEADROOM" -lt 2 ]; then
  printf 'The region is near its CPU ceiling right now. Wait for warm instances to\n'
  printf 'expire, or deploy one at a time (DEPLOY_BATCH_SIZE=1).\n\n'
fi

if [ "$MODE" = "check" ]; then
  exit 0
fi

# ---------------------------------------------------------------- targets ---
load_services

if [ ${#TARGETS[@]} -eq 0 ]; then
  while IFS=$'\t' read -r _service fn _cpu _max; do
    [ -n "$fn" ] && TARGETS+=("$fn")
  done < "$SERVICES_FILE"
fi

if [ ${#TARGETS[@]} -eq 0 ]; then
  die "No functions found to deploy."
fi

if [ "$MODE" = "verify" ]; then
  if [ -n "$SINCE" ]; then
    printf 'Verifying %s function(s) updated after %s\n' "${#TARGETS[@]}" "$SINCE"
  else
    printf 'Verifying %s function(s)\n' "${#TARGETS[@]}"
    printf 'Pass --since <ISO stamp> to also require an update newer than a deploy\n\n'
  fi
  failures=0
  for fn in "${TARGETS[@]}"; do
    verify_function "$fn" "$SINCE" || failures=$((failures + 1))
  done
  printf '\n%s function(s) did not roll out.\n' "$failures"
  [ "$failures" -eq 0 ] || exit 1
  exit 0
fi

# ----------------------------------------------------------------- deploy ---
printf 'Deploying %s function(s) in batches of %s\n\n' "${#TARGETS[@]}" "$BATCH"

STALE=()
index=0
while [ "$index" -lt "${#TARGETS[@]}" ]; do
  batch=()
  while [ "$index" -lt "${#TARGETS[@]}" ] && [ "${#batch[@]}" -lt "$BATCH" ]; do
    batch+=("${TARGETS[$index]}")
    index=$((index + 1))
  done

  batch_start=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf 'Batch: %s (started %s)\n' "${batch[*]}" "$batch_start"
  if ! deploy_names "${batch[@]}"; then
    printf 'Deploy command exited non-zero for this batch.\n'
  fi

  # Cloud Run needs a moment to settle traffic before the revision is readable.
  sleep 20
  load_services
  for fn in "${batch[@]}"; do
    verify_function "$fn" "$batch_start" || STALE+=("$fn")
  done
  printf '\n'
done

# A quota failure leaves the previous revision serving. Retry each casualty on
# its own, letting the failed revision's CPU go back to the quota first.
for attempt in 1 2; do
  [ ${#STALE[@]} -eq 0 ] && break
  printf 'Retry %s: %s function(s) still on an older revision (%s)\n' \
    "$attempt" "${#STALE[@]}" "${STALE[*]}"
  printf 'Waiting 90s for the failed revisions to release their CPU...\n'
  sleep 90
  retry=("${STALE[@]}")
  STALE=()
  for fn in "${retry[@]}"; do
    retry_start=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    printf 'Deploying %s (started %s)\n' "$fn" "$retry_start"
    deploy_names "$fn" >/dev/null 2>&1 || true
    sleep 15
    load_services
    verify_function "$fn" "$retry_start" || STALE+=("$fn")
  done
  printf '\n'
done

if [ ${#STALE[@]} -eq 0 ]; then
  printf 'All %s function(s) were updated by this deploy and are serving their\n' "${#TARGETS[@]}"
  printf 'newest revision.\n'
  exit 0
fi

printf 'Did not roll out: %s\n' "${STALE[*]}" >&2
printf 'Re-run with a smaller batch (DEPLOY_BATCH_SIZE=1 %s ...) or raise the\n' \
  "${BASH_SOURCE[0]}" >&2
printf 'Cloud Run CPU quota for %s (see functions/README.md).\n' "$REGION" >&2
exit 1
