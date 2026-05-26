#!/usr/bin/env bash

set -euo pipefail

if [ "${DEBUG:-false}" = "true" ]; then
  set -x
fi

action_notice() { echo "::notice::$*"; }
action_error()  { echo "::error::$*"; }

action_group() { echo "::group::$*"; }
action_endgroup() { echo "::endgroup::"; }

write_output() {
  echo "$1=$2" >> "${GITHUB_OUTPUT:?GITHUB_OUTPUT is not set}"
}

run_pm() {
  case "${PACKAGE_MANAGER:?PACKAGE_MANAGER is not set}" in
    pnpm) pnpm "$@" ;;
    npm)  npm "$@" ;;
    yarn) yarn "$@" ;;
    *)
      action_error "Unsupported package manager: $PACKAGE_MANAGER"
      exit 1
      ;;
  esac
}

install_deps() {
  local manager="$1"
  local lockfile="$2"

  case "$manager" in
    pnpm)
      if [ "$lockfile" = "true" ]; then
        pnpm install --frozen-lockfile || {
          action_notice "pnpm lockfile out of sync; falling back to pnpm install."
          pnpm install
        }
      else
        pnpm install
      fi
      ;;
    npm)
      if [ "$lockfile" = "true" ]; then
        npm ci || {
          action_notice "package-lock.json out of sync; falling back to npm install."
          npm install
        }
      else
        npm install
      fi
      ;;
    yarn)
      if [ "$lockfile" = "true" ]; then
        yarn install --frozen-lockfile || {
          action_notice "yarn lockfile out of sync; falling back to yarn install."
          yarn install
        }
      else
        yarn install
      fi
      ;;
    *)
      action_error "Unsupported package manager: $manager"
      exit 1
      ;;
  esac
}

# Sets HTTP_BODY and HTTP_STATUS. Remaining args are passed to curl before the URL.
http_post() {
  local url="$1"
  shift
  local response

  response=$(curl -sS -w "\n__HTTP_STATUS__:%{http_code}" -X POST "$@" "$url")

  HTTP_STATUS="${response##*__HTTP_STATUS__:}"
  HTTP_BODY="${response%$'\n'__HTTP_STATUS__:*}"
}

find_output_dir() {
  local override="${1:-}"

  if [ -n "$override" ]; then
    echo "$override"
    return 0
  fi

  local candidate
  for candidate in dist/client dist build; do
    if [ -f "$candidate/index.html" ]; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

# True when package.json declares a "build" script. Uses Node so we don't
# have to grep for a key that could appear inside any other string.
has_build_script() {
  node -e '
    const pkg = JSON.parse(require("node:fs").readFileSync("package.json", "utf8"));
    process.exit(pkg.scripts && pkg.scripts.build ? 0 : 1);
  ' 2>/dev/null
}
