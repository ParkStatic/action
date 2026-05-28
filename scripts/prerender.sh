#!/usr/bin/env bash

source "${ACTION_PATH:?}/scripts/lib.sh"

action_group "Prerender"

if [ "${PRERENDER_ENABLED:-true}" != "true" ]; then
  # Skipping is fine for static builds (they already ship index.html). SSR
  # builds have nothing static to deploy without this step, so refuse.
  if [ "${BUILD_MODE:-static}" = "ssr" ]; then
    action_error "prerender input is set to false, but this is an SSR build — without prerender there is no static HTML to deploy. Re-enable prerender or use a static (non-SSR) build."
    exit 1
  fi
  echo "Prerendering disabled (prerender input set to false); skipping."
  action_endgroup
  exit 0
fi

if [ -z "${OUTPUT_DIR:-}" ]; then
  action_error "OUTPUT_DIR is not set; the build step must run before prerender."
  exit 1
fi

if [ "${BUILD_MODE:-static}" = "ssr" ]; then
  if [ -z "${SSR_ENTRY:-}" ]; then
    action_error "BUILD_MODE=ssr but SSR_ENTRY is empty; the build step must export ssr-entry."
    exit 1
  fi
  echo "Prerendering SSR worker (${SSR_ENTRY}) -> ${OUTPUT_DIR} via Miniflare + headless Chromium."
else
  echo "Prerendering ${OUTPUT_DIR} via headless Chromium."
fi

# Mode-aware default for hydration stripping. SSR builds (TanStack Start
# et al.) reliably crash on re-hydration of prerendered HTML, so we strip
# the framework's module entry by default. Plain Vite SPAs re-hydrate
# cleanly, so we leave them alone. Either default can be overridden via
# the `disable-hydration` input.
if [ -z "${DISABLE_HYDRATION:-}" ]; then
  if [ "${BUILD_MODE:-static}" = "ssr" ]; then
    DISABLE_HYDRATION="true"
  else
    DISABLE_HYDRATION="false"
  fi
fi
export DISABLE_HYDRATION
echo "Hydration scripts in prerendered HTML: $([ "$DISABLE_HYDRATION" = "true" ] && echo "stripped (static-only mode)" || echo "preserved (interactive React kept)")."

node "$ACTION_PATH/scripts/prerender.mjs"

action_endgroup
