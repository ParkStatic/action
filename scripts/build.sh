#!/usr/bin/env bash

source "${ACTION_PATH:?}/scripts/lib.sh"

action_group "Build"

# Trust the user's own build. We don't overlay a vite config or pin a config
# path — every Lovable variant (vite SPA, TanStack Start, anything in
# between) defines its own `build` script and we just run it. The downstream
# prerender step renders the resulting output in a real browser, which is the
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

# Two clearly separated build shapes, decided here once and propagated as the
# `mode` output to every downstream step:
#
#   static — classic Vite SPA. dist/client (or dist, build) already contains
#            index.html plus its assets. The prerender step serves that
#            directory and crawls it.
#
#   ssr    — TanStack Start with the Cloudflare Workers preset. dist/server
#            holds a worker bundle, dist/client holds the static assets; no
#            index.html exists yet. The prerender step boots the worker via
#            Miniflare and crawls it to materialize HTML into dist/client.
if OUTPUT_DIR=$(find_output_dir "${OUTPUT_DIR_OVERRIDE:-}"); then
  if [ ! -f "$OUTPUT_DIR/index.html" ]; then
    action_error "Could not find index.html in $OUTPUT_DIR."
    exit 1
  fi
  MODE="static"
  echo "Detected static SPA build."
  echo "Output: $OUTPUT_DIR"
elif SSR_ENTRY=$(find_ssr_bundle); then
  MODE="ssr"
  OUTPUT_DIR=$(find_ssr_assets_dir)
  if [ ! -d "$OUTPUT_DIR" ]; then
    action_error "SSR build detected but assets directory '$OUTPUT_DIR' does not exist."
    exit 1
  fi
  echo "Detected SSR build (TanStack Start / Cloudflare Workers)."
  echo "Worker entry:  $SSR_ENTRY"
  echo "Static assets: $OUTPUT_DIR"
  write_output "ssr-entry" "$SSR_ENTRY"
else
  action_error "Could not find a deployable build. Expected either an index.html in dist/client, dist, or build (static SPA) or a dist/server/index.js (SSR build)."
  exit 1
fi

write_output "mode" "$MODE"
write_output "output-dir" "$OUTPUT_DIR"
action_endgroup
