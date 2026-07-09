#!/usr/bin/env bash

source "${ACTION_PATH:?}/scripts/lib.sh"

action_group "Deploy to Parkstatic"

# Dry-run escape hatch. When skip-deploy is set, the whole build/prerender/
# package pipeline has already run for real; we just verify there is an
# artifact to upload and stop short of any network call or secret. This is what
# the framework-compatibility test suite (and offline dry runs) use to exercise
# every framework without a paid license or a live deploy endpoint.
if [ "${SKIP_DEPLOY:-}" = "true" ]; then
  if [ ! -f dist.zip ]; then
    action_error "skip-deploy is set but dist.zip not found. The Package step must run before Deploy."
    exit 1
  fi
  echo "skip-deploy is set: dist.zip is present; skipping upload to Parkstatic."
  write_output "deployed" "false"
  action_endgroup
  exit 0
fi

if [ -z "${PARKSTATIC_SECRET:-}" ]; then
  action_error "parkstatic-secret is empty. Add PARKSTATIC_SECRET to your repository secrets and pass it to the action."
  exit 1
fi

if [ -z "${DEPLOY_URL:-}" ]; then
  action_error "deploy-url is empty."
  exit 1
fi

if [ ! -f dist.zip ]; then
  action_error "dist.zip not found at the workspace root. The Package step must run before Deploy."
  exit 1
fi

ZIP_BYTES=$(wc -c < dist.zip | tr -d ' ')
echo "Uploading dist.zip ($ZIP_BYTES bytes) to Parkstatic."
echo "DEPLOY_URL: $DEPLOY_URL"

# The deploy function does the work in two phases:
#
#   1. Foreground (what we wait for): authenticate, upload to private
#      storage, sign a 3-day download URL.
#   2. WordPress hand-off: call the site's WP receiver with the signed URL
#      so it can pull and extract the build. We send `X-Parkstatic-Wait` so
#      the function waits for this phase instead of deferring it — that way
#      a WP-side failure (e.g. Cloudflare 522 origin down, receiver 5xx,
#      install error) surfaces here and fails the run, instead of the action
#      going green while the site never updates. The wait is bounded by the
#      receiver's own 120s timeout, so a fast 522 returns in seconds.
#
# Non-2xx means phase 1 failed (auth, storage, config) or — for 502 — phase
# 2 failed on the WordPress side; the message body carries the details.
#
# GitHub already masks registered secrets in logs, but `set -x` (debug mode)
# would otherwise echo the expanded Authorization header. Suspend xtrace for
# just this call and restore it afterwards so the token never reaches stdout.
parkstatic_xtrace=0
case $- in *x*) parkstatic_xtrace=1 ;; esac
set +x
http_post "$DEPLOY_URL" \
  -H "Authorization: Bearer $PARKSTATIC_SECRET" \
  -H "Content-Type: application/zip" \
  -H "X-Parkstatic-Sha: ${GH_SHA}" \
  -H "X-Parkstatic-Ref: ${GH_REF}" \
  -H "X-Parkstatic-Repository: ${GH_REPO}" \
  -H "X-Parkstatic-Wait: true" \
  --data-binary "@dist.zip"
[ "$parkstatic_xtrace" -eq 1 ] && set -x

# The function returns 200 when WP confirmed the install (foreground wait),
# 502 when WordPress rejected/failed the deploy, and other non-2xx for
# phase-1 failures (auth, storage, config).
if [ "$HTTP_STATUS" -lt 200 ] || [ "$HTTP_STATUS" -ge 300 ]; then
  action_error "Deploy failed (HTTP $HTTP_STATUS): $HTTP_BODY"

  if [ "$HTTP_STATUS" = "401" ]; then
    action_error "parkstatic-secret did not match any registered Parkstatic instance. Copy the deploy secret from WordPress admin (Parkstatic → General → Deploy secret) and update the PARKSTATIC_SECRET repo secret. If you moved your license to this site, the secret changed."
  elif [ "$HTTP_STATUS" = "404" ]; then
    action_error "No Parkstatic instance is registered for this secret. Open Parkstatic in your WordPress admin and complete setup first."
  elif [ "$HTTP_STATUS" = "403" ]; then
    action_error "This Parkstatic site does not have an active paid license. Activate or renew your license in WordPress admin (Parkstatic → Account) and try again."
  elif [ "$HTTP_STATUS" = "400" ]; then
    action_error "Parkstatic rejected the upload as malformed. This usually means the action was modified or hit a Supabase outage. Re-run the workflow; if it persists, open an issue with the response body above."
  elif [ "$HTTP_STATUS" = "502" ]; then
    # WordPress side rejected the deploy. Pull the WP status code out of the
    # JSON body (if present) and append a known-issue hint for the common
    # Cloudflare origin/timeout codes; for anything else, the raw receiver
    # error in the body is the best pointer we have.
    WP_STATUS=$(echo "$HTTP_BODY" | jq -r '.wp_status // empty' 2>/dev/null \
      || echo "$HTTP_BODY" | sed -n 's/.*"wp_status":\([0-9]*\).*/\1/p')
    action_error "WordPress rejected the deploy${WP_STATUS:+ (WP HTTP $WP_STATUS)}. See the response body above for the receiver's error."
    case "$WP_STATUS" in
      522|523|524)
        action_error "Known issue: WP HTTP $WP_STATUS is a Cloudflare origin error (522 connection timed out, 523 origin unreachable, 524 timeout). The WordPress server is not completing requests — check that PHP/WP-FPM is up and not resource-starved, then re-run the workflow."
        ;;
      0)
        action_error "Known issue: WP status 0 means the receiver did not respond within the 120s timeout. Check that WordPress is reachable and not down/sleeping, then re-run the workflow."
        ;;
      *)
        action_error "This is not a common Parkstatic deploy error. If it persists, open an issue with the response body above."
        ;;
    esac
  elif [ "$HTTP_STATUS" -ge 500 ]; then
    action_error "Parkstatic's storage or signing layer returned an error. This is almost always transient — re-run the workflow."
  fi

  exit 1
fi

# Pull deploy_id out of the JSON body if jq is available; falls back to a
# best-effort sed so we still surface something useful on minimal runners.
DEPLOY_ID=$(echo "$HTTP_BODY" | jq -r '.deploy_id // empty' 2>/dev/null \
  || echo "$HTTP_BODY" | sed -n 's/.*"deploy_id":"\([^"]*\)".*/\1/p')

echo "Artifact uploaded to Parkstatic."
if [ -n "$DEPLOY_ID" ]; then
  echo "Deploy ID: $DEPLOY_ID"
fi
echo "WordPress confirmed the deploy: the new build has been pulled and installed."

write_output "deployed" "true"
if [ -n "$DEPLOY_ID" ]; then
  write_output "deploy-id" "$DEPLOY_ID"
fi

action_endgroup
