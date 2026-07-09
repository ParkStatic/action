#!/usr/bin/env bash

source "${ACTION_PATH:?}/scripts/lib.sh"

action_group "Package static site"

if [ -z "${OUTPUT_DIR:-}" ]; then
  action_error "OUTPUT_DIR is not set; the build step must run before package."
  exit 1
fi

# Pin the zip to the workspace root via an absolute path. Using `../dist.zip`
# from inside $OUTPUT_DIR only lands at the workspace root when OUTPUT_DIR is
# exactly one level deep (e.g. `dist`); for `dist/client` it would land in
# `dist/dist.zip` and the deploy step's `--data-binary "@dist.zip"` would fail
# with curl exit 26 (cannot read local file).
ZIP_PATH="$(pwd)/dist.zip"
rm -f "$ZIP_PATH"

# Heads-up only — the Parkstatic WP plugin rewrites `/assets/` references at
# serve time, so this is informational, not a hard failure.
if grep -qE '(href|src)="/assets/' "$OUTPUT_DIR/index.html" 2>/dev/null; then
  action_notice "index.html references absolute /assets/ paths. The Parkstatic WP plugin will rewrite them at serve time; non-WP hosts may need a vite base of './'."
fi

echo "Zipping $OUTPUT_DIR -> $ZIP_PATH"
(cd "$OUTPUT_DIR" && zip -qr "$ZIP_PATH" .)

# Surface the resulting size — useful when triaging deploys and a cheap
# sanity check that the zip step actually produced output before the deploy
# step tries to upload it.
ZIP_BYTES=$(wc -c < "$ZIP_PATH" | tr -d ' ')
ZIP_HUMAN=$(awk -v b="$ZIP_BYTES" 'BEGIN { split("B KB MB GB", u); s=1; while (b>=1024 && s<4) { b/=1024; s++ } printf "%.2f %s", b, u[s] }')
echo "Archive size: $ZIP_HUMAN ($ZIP_BYTES bytes)"
write_output "archive-bytes" "$ZIP_BYTES"

action_endgroup
