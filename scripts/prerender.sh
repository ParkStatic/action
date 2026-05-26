#!/usr/bin/env bash

source "${ACTION_PATH:?}/scripts/lib.sh"

action_group "Prerender"

if [ "${PRERENDER_ENABLED:-true}" != "true" ]; then
  echo "Prerendering disabled (prerender input set to false); skipping."
  action_endgroup
  exit 0
fi

if [ -z "${OUTPUT_DIR:-}" ]; then
  action_error "OUTPUT_DIR is not set; the build step must run before prerender."
  exit 1
fi

echo "Prerendering ${OUTPUT_DIR} via headless Chromium."
node "$ACTION_PATH/scripts/prerender.mjs"

action_endgroup
