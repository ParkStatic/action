#!/usr/bin/env bash

source "${ACTION_PATH:?}/scripts/lib.sh"

action_group "Prerender"

# Already-prerendered builds (e.g. TanStack Start's Vite `prerender`) ship the
# framework's own server-rendered HTML plus an inline hydration bootstrap that
# self-destructs after hydration. Re-crawling them would capture the post-
# hydration DOM, strip that bootstrap (e.g. TanStack Start's $_TSR), and blank
# the page for real visitors with "Invariant failed". Deploy them verbatim and
# skip the crawl regardless of the prerender input.
if [ "${BUILD_MODE:-static}" = "prerendered" ]; then
  echo "Build is already prerendered by the framework; skipping the headless crawl and deploying its HTML verbatim."
  echo "Re-crawling would capture the post-hydration DOM and strip the framework's hydration bootstrap (e.g. TanStack Start's \$_TSR), which blanks the page for real visitors."
  action_endgroup
  exit 0
fi

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

# Hydration is kept by default for every build shape. SSR builds capture the
# raw server response (see prerender.mjs), which carries the framework's
# serialized hydration state, so a real browser can hydrate it cleanly and
# the app boots into a fully interactive SPA. Plain Vite SPAs re-mount via
# createRoot() over the captured DOM. Set `disable-hydration: true` to fall
# back to a static-only snapshot if a specific build still crashes on
# hydration (the framework's module entry is then stripped).
if [ -z "${DISABLE_HYDRATION:-}" ]; then
  DISABLE_HYDRATION="false"
fi
export DISABLE_HYDRATION
echo "Hydration scripts in prerendered HTML: $([ "$DISABLE_HYDRATION" = "true" ] && echo "stripped (static-only mode)" || echo "preserved (interactive React kept)")."

node "$ACTION_PATH/scripts/prerender.mjs"

action_endgroup
