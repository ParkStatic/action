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
  if echo "$HTTP_BODY" | grep -q 'Missing/invalid authorization'; then
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
  -H "Authorization: Bearer $PARKSTATIC_SECRET" \
  -F "file=@dist.zip;type=application/zip" \
  -F "sha=${GH_SHA}" \
  -F "ref=${GH_REF}" \
  -F "repository=${GH_REPO}"

if [ "$HTTP_STATUS" != "200" ]; then
  action_error "Failed to upload dist.zip to Parkstatic (HTTP $HTTP_STATUS): $HTTP_BODY"
  # `parkstatic_missing_file` from a successfully-routed request almost always
  # means PHP silently dropped the upload because it exceeded server limits.
  # In that case $_FILES is empty and the plugin reports "missing file" even
  # though curl posted it. Point the user at the right knobs.
  if [ "$HTTP_STATUS" = "400" ] && echo "$HTTP_BODY" | grep -q 'parkstatic_missing_file'; then
    ZIP_BYTES=$(wc -c < dist.zip 2>/dev/null | tr -d ' ' || true)
    action_error "The Parkstatic server received the request but PHP found no uploaded file."
    action_error "This almost always means the archive exceeded the host's PHP upload limits."
    if [ -n "$ZIP_BYTES" ] && [ "$ZIP_BYTES" -gt 0 ]; then
      action_error "Archive size: $ZIP_BYTES bytes ($(awk -v b="$ZIP_BYTES" 'BEGIN { split("B KB MB GB", u); s=1; while (b>=1024 && s<4) { b/=1024; s++ } printf "%.2f %s", b, u[s] }'))."
    fi
    action_error "Raise upload_max_filesize and post_max_size in php.ini (and client_max_body_size on nginx) on the WordPress host running parkstatic.site so they comfortably exceed the archive size, then re-run."
  fi
  exit 1
fi

echo "Posted dist.zip to deploy webhook."
write_output "deployed" "true"

action_endgroup
