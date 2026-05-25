#!/usr/bin/env bash

source "${ACTION_PATH:?}/scripts/lib.sh"

action_group "Build"

# Relative base so assets resolve under subdirectory WordPress installs (not only Vite preview).
PARKSTATIC_VITE_BASE="${PARKSTATIC_VITE_BASE:-./}"

if [ -n "${BUILD_COMMAND:-}" ]; then
  echo "Running custom build command."
  action_notice "Custom builds should pass --base ./ to Vite (or set base: './') so assets work outside preview."
  eval "$BUILD_COMMAND"
else
  case "$PROJECT_TYPE" in
    tanstack-start)
      cp "${ACTION_PATH}/vite.config.ci.ts" ./vite.config.ci.ts
      echo "Building TanStack Start with prerender config (base=$PARKSTATIC_VITE_BASE)."
      run_pm exec vite build --config vite.config.ci.ts --base "$PARKSTATIC_VITE_BASE"
      ;;
    vite-spa)
      echo "Building Vite SPA (base=$PARKSTATIC_VITE_BASE)."
      run_pm exec vite build --base "$PARKSTATIC_VITE_BASE"
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
if grep -qE '(href|src)="/assets/' "$OUTPUT_DIR/index.html" 2>/dev/null; then
  action_notice "index.html still references absolute /assets/ paths; subdirectory installs may fail. Rebuild with --base ./"
fi

(cd "$OUTPUT_DIR" && zip -qr ../dist.zip .)

write_output "output-dir" "$OUTPUT_DIR"
action_endgroup
