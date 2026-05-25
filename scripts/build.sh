#!/usr/bin/env bash

source "${ACTION_PATH:?}/scripts/lib.sh"

action_group "Build"

if [ -n "${BUILD_COMMAND:-}" ]; then
  echo "Running custom build command."
  eval "$BUILD_COMMAND"
else
  case "$PROJECT_TYPE" in
    tanstack-start)
      cp "${ACTION_PATH}/vite.config.ci.ts" ./vite.config.ci.ts
      echo "Building TanStack Start with prerender config."
      run_pm exec vite build --config vite.config.ci.ts
      ;;
    vite-spa)
      echo "Building Vite SPA with project build script."
      run_pm run build
      ;;
    *)
      action_error "Unsupported project type: $PROJECT_TYPE"
      exit 1
      ;;
  esac
fi

action_endgroup

action_group "Package static site"

rm -f dist.zip

if ! OUTPUT_DIR=$(find_output_dir "${OUTPUT_DIR_OVERRIDE:-}"); then
  action_error "Could not find static output (expected index.html in dist/client, dist, or build)."
  exit 1
fi

if [ ! -f "$OUTPUT_DIR/index.html" ]; then
  action_error "Could not find index.html in $OUTPUT_DIR."
  exit 1
fi

echo "Packaging static site from $OUTPUT_DIR."
(cd "$OUTPUT_DIR" && zip -qr ../dist.zip .)

write_output "output-dir" "$OUTPUT_DIR"
action_endgroup
