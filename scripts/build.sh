#!/usr/bin/env bash

source "${ACTION_PATH:?}/scripts/lib.sh"

action_group "Build"

# Trust the user's own build. We don't overlay a vite config or pin a config
# path — every Lovable variant (vite SPA, TanStack Start, anything in
# between) defines its own `build` script and we just run it. The downstream
# prerender step renders the resulting SPA in a real browser, which is the
# only universally reliable way to get static HTML for arbitrary routing.
if [ -n "${BUILD_COMMAND:-}" ]; then
  echo "Running custom build command: $BUILD_COMMAND"
  eval "$BUILD_COMMAND"
elif has_build_script; then
  echo "Running '$PACKAGE_MANAGER run build'."
  run_pm run build
else
  echo "No 'build' script in package.json; falling back to 'vite build'."
  run_pm exec vite build
fi

action_endgroup

action_group "Locate output"

if ! OUTPUT_DIR=$(find_output_dir "${OUTPUT_DIR_OVERRIDE:-}"); then
  action_error "Could not find static output (expected index.html in dist/client, dist, or build)."
  exit 1
fi

if [ ! -f "$OUTPUT_DIR/index.html" ]; then
  action_error "Could not find index.html in $OUTPUT_DIR."
  exit 1
fi

echo "Build output: $OUTPUT_DIR"
write_output "output-dir" "$OUTPUT_DIR"
action_endgroup
