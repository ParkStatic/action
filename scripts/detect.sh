#!/usr/bin/env bash

source "${ACTION_PATH:?}/scripts/lib.sh"

action_group "Detect project"

if [ ! -f package.json ]; then
  action_error "package.json not found."
  exit 1
fi

# Detect the package manager. We honor an explicit "packageManager" field when
# a matching lockfile is present, then fall back to lockfile-based detection,
# then to pnpm (Lovable's default for new projects).
PM_FIELD=""
if grep -q '"packageManager"' package.json; then
  PM_FIELD=$(sed -n 's/.*"packageManager"[[:space:]]*:[[:space:]]*"\([^@"]*\).*/\1/p' package.json | head -1)
fi

MANAGER=""
LOCKFILE="false"
CACHE=""

if [ -n "$PM_FIELD" ] && { [ -f pnpm-lock.yaml ] || [ -f package-lock.json ] || [ -f yarn.lock ]; }; then
  MANAGER="$PM_FIELD"
  LOCKFILE="true"
  CACHE="$MANAGER"
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
else
  MANAGER="pnpm"
  action_notice "No lockfile found; using pnpm without a frozen lockfile."
fi

# Sanity-check the project shape. We require Vite somewhere in package.json
# (deps, devDeps, or a Lovable wrapper). Anything beyond that is treated as a
# black-box build — the universal serve+crawl prerender step handles it.
if ! grep -Eq '"(vite|@lovable\.dev/[^"]+)"' package.json; then
  action_error "Unsupported project: expected vite (or a Lovable wrapper) in package.json."
  exit 1
fi

write_output "manager" "$MANAGER"
write_output "lockfile" "$LOCKFILE"
write_output "cache" "$CACHE"

echo "Package manager: $MANAGER (lockfile=$LOCKFILE)"
action_endgroup
