#!/usr/bin/env bash

source "${ACTION_PATH:?}/scripts/lib.sh"

action_group "Resolve build plan"

# Fetches the declarative build plan from the ParkStatic plan endpoint and
# writes the resolved recipe to GITHUB_OUTPUT. plan.mjs handles its own errors
# and always falls back to a conservative local plan, so this step never blocks
# a build on a plan outage. The bearer token is read from the environment by
# Node and never echoed; suspend xtrace around the call for defense in depth.
plan_xtrace=0
case $- in *x*) plan_xtrace=1 ;; esac
set +x
node "$ACTION_PATH/scripts/plan.mjs"
[ "$plan_xtrace" -eq 1 ] && set -x

action_endgroup
