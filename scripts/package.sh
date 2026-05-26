#!/usr/bin/env bash

source "${ACTION_PATH:?}/scripts/lib.sh"

action_group "Package static site"

if [ -z "${OUTPUT_DIR:-}" ]; then
  action_error "OUTPUT_DIR is not set; the build step must run before package."
  exit 1
fi

rm -f dist.zip

# Heads-up only — the Parkstatic WP plugin rewrites `/assets/` references at
# serve time, so this is informational, not a hard failure.
if grep -qE '(href|src)="/assets/' "$OUTPUT_DIR/index.html" 2>/dev/null; then
  action_notice "index.html references absolute /assets/ paths. The Parkstatic WP plugin will rewrite them at serve time; non-WP hosts may need a vite base of './'."
fi

echo "Zipping $OUTPUT_DIR -> dist.zip"
(cd "$OUTPUT_DIR" && zip -qr ../dist.zip .)

action_endgroup
