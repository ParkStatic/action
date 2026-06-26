#!/usr/bin/env bash

source "${ACTION_PATH:?}/scripts/lib.sh"

action_group "Inject build dependencies"

# INJECT_DEPS is a space-separated list resolved by the plan step. Each entry is
# installed only if missing (see inject_dependency), so this is a no-op when the
# project already declares them. Runs after install so resolution checks see the
# project's real node_modules.
if [ -z "${INJECT_DEPS:-}" ]; then
  echo "No build dependencies to inject."
  action_endgroup
  exit 0
fi

for dep in $INJECT_DEPS; do
  inject_dependency "$dep"
done

action_endgroup
