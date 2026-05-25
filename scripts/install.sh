#!/usr/bin/env bash

source "${ACTION_PATH:?}/scripts/lib.sh"

action_group "Install dependencies"

if [ "$PACKAGE_MANAGER" = "pnpm" ]; then
  {
    echo 'onlyBuiltDependencies[]=esbuild'
    echo 'onlyBuiltDependencies[]=@swc/core'
  } >> .npmrc
  if [ "$PROJECT_TYPE" = "tanstack-start" ]; then
    echo 'public-hoist-pattern[]=@tanstack/query-core' >> .npmrc
  fi
fi

install_deps "$PACKAGE_MANAGER" "$LOCKFILE"

action_endgroup
