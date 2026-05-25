#!/usr/bin/env bash

source "${ACTION_PATH:?}/scripts/lib.sh"

action_group "Detect project"

PM_FIELD=""
if grep -q '"packageManager"' package.json; then
  PM_FIELD=$(sed -n 's/.*"packageManager"[[:space:]]*:[[:space:]]*"\([^@"]*\).*/\1/p' package.json | head -1)
fi

MANAGER=""
LOCKFILE="false"
CACHE=""

if [ -n "$PM_FIELD" ]; then
  MANAGER="$PM_FIELD"
  if [ -f pnpm-lock.yaml ] || [ -f package-lock.json ] || [ -f yarn.lock ]; then
    LOCKFILE="true"
    CACHE="$MANAGER"
  fi
elif [ -f pnpm-lock.yaml ]; then
  MANAGER="pnpm"
  LOCKFILE="true"
  CACHE="pnpm"
elif [ -f yarn.lock ]; then
  MANAGER="yarn"
  LOCKFILE="true"
  CACHE="yarn"
elif [ -f package-lock.json ]; then
  MANAGER="pnpm"
  action_notice "Ignoring stale package-lock.json; using pnpm (Lovable default)."
elif [ -f package.json ]; then
  MANAGER="pnpm"
  action_notice "No lockfile found; using pnpm without frozen lockfile."
else
  action_error "package.json not found."
  exit 1
fi

if grep -Eq '"@lovable\.dev/vite-tanstack-config"' package.json; then
  PROJECT_TYPE="tanstack-start"
  echo "Detected TanStack Start project."
elif grep -Eq '"vite"' package.json; then
  PROJECT_TYPE="vite-spa"
  echo "Detected Vite SPA project."
else
  action_error "Unsupported project: expected @lovable.dev/vite-tanstack-config or vite in package.json."
  exit 1
fi

write_output "manager" "$MANAGER"
write_output "lockfile" "$LOCKFILE"
write_output "cache" "$CACHE"
write_output "project-type" "$PROJECT_TYPE"

echo "Package manager: $MANAGER (lockfile=$LOCKFILE)"
action_endgroup
