#!/usr/bin/env bash

source "${ACTION_PATH:?}/scripts/lib.sh"

action_group "Deploy to Parkstatic"

if [ -z "${PARKSTATIC_SECRET:-}" ]; then
  action_error "parkstatic-secret is empty. Add PARKSTATIC_SECRET to your repository secrets and pass it to the action."
  exit 1
fi

http_post "$RESOLVE_URL" -H "Authorization: Bearer $PARKSTATIC_SECRET"

if [ "$HTTP_STATUS" != "200" ]; then
  action_error "Failed to resolve Parkstatic deploy URL (HTTP $HTTP_STATUS): $HTTP_BODY"
  if echo "$HTTP_BODY" | grep -q 'Missing/invalid uuid'; then
    action_error "The get-instance-url Supabase function may not be deployed. Run: supabase functions deploy get-instance-url"
  elif [ "$HTTP_STATUS" = "401" ]; then
    action_error "Check that parkstatic-secret matches the token shown in your Parkstatic WordPress admin."
  elif [ "$HTTP_STATUS" = "404" ]; then
    action_error "No Parkstatic instance found for this token. Register the WordPress site first."
  fi
  exit 1
fi

WEBHOOK_URL=$(echo "$HTTP_BODY" | jq -er '.url')
write_output "url" "$WEBHOOK_URL"
echo "Resolved deploy URL."
echo "WEBHOOK_URL: $WEBHOOK_URL"

http_post "$WEBHOOK_URL" \
  -F "file=@dist.zip;type=application/zip" \
  -F "sha=${GH_SHA}" \
  -F "ref=${GH_REF}" \
  -F "repository=${GH_REPO}"

if [ "$HTTP_STATUS" != "200" ]; then
  action_error "Failed to upload dist.zip to Parkstatic (HTTP $HTTP_STATUS): $HTTP_BODY"
  exit 1
fi

echo "Posted dist.zip to deploy webhook."
write_output "deployed" "true"

action_endgroup
