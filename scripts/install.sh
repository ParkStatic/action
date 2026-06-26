#!/usr/bin/env bash

source "${ACTION_PATH:?}/scripts/lib.sh"

action_group "Install project dependencies"

# Native packages pnpm@10 must be allowed to run their install scripts for.
# The allowlist comes from the plan step (BUILT_DEPS, space-separated); it falls
# back to the long-standing defaults if the plan step was skipped.
if [ "$PACKAGE_MANAGER" = "pnpm" ]; then
  for dep in ${BUILT_DEPS:-esbuild @swc/core}; do
    echo "onlyBuiltDependencies[]=$dep" >> .npmrc
  done
fi

install_deps "$PACKAGE_MANAGER" "$LOCKFILE"

action_endgroup

# Install the action's own tooling (Playwright + Chromium) into ACTION_PATH so
# it lives independently of the user's project, lockfile, and package manager.
# Skipped entirely when prerendering is disabled.
if [ "${PRERENDER_ENABLED:-true}" = "true" ]; then
  action_group "Install prerender tooling"
  (cd "$ACTION_PATH" && npm ci --no-audit --no-fund --loglevel=error)
  "$ACTION_PATH/node_modules/.bin/playwright" install --with-deps chromium
  action_endgroup
fi
