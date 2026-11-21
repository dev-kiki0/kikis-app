#!/usr/bin/env bash
#
# Local mirror of CI. Run before pushing:
#
#   pnpm verify          full run (build + typecheck + tests)
#   pnpm verify --fast   skip tests, keep build + typecheck
#
# The build steps are not optional. Several packages import
# @kikis-app/kikis-app/schema, which resolves to the SDK's built dist/ rather
# than its source, so typechecking against a stale or missing dist/ produces
# failures that do not exist and hides ones that do.
set -euo pipefail

FAST=0
[[ "${1:-}" == "--fast" ]] && FAST=1

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

fail() { printf '\n\033[31m✘ %s\033[0m\n' "$1" >&2; exit 1; }
step() { printf '\n\033[36m▸ %s\033[0m\n' "$1"; }

step "node version"
node_major="$(node -p 'process.versions.node.split(".")[0]')"
if (( node_major < 22 )); then
  fail "Node $(node --version) is too old. wrangler 4 requires >= 22, and both providers build through it."
fi
echo "  $(node --version)"

step "lockfile is in sync"
# CI installs with --frozen-lockfile. A package.json edited without rerunning
# pnpm install fails there before a single test runs. Capture the install
# output so a failure shows the package manager's own diagnostic instead of
# being masked by a generic lockfile message.
install_log="$(mktemp)"
trap 'rm -f "$install_log"' EXIT
if ! pnpm install --frozen-lockfile --prefer-offline >"$install_log" 2>&1; then
  cat "$install_log" >&2
  if grep -qiE 'frozen-lockfile|lockfile.*(out of date|not up to date|mismatch)|ERR_PNPM_OUTDATED_LOCKFILE' "$install_log"; then
    fail "pnpm-lock.yaml is out of date with a package.json. Run 'pnpm install' at the root and commit the lockfile."
  fi
  fail "pnpm install failed. See the package manager output above for the cause."
fi
echo "  ok"

step "build sdk packages"
pnpm --filter @kikis-app/nulth-sdk build >/dev/null || fail "@kikis-app/nulth-sdk failed to build"
pnpm --filter @kikis-app/kikis-app build >/dev/null || fail "@kikis-app/kikis-app failed to build"
echo "  ok"

step "typecheck all packages"
pnpm -r typecheck || fail "typecheck failed"

if (( FAST )); then
  printf '\n\033[32m✔ verify --fast passed\033[0m (tests skipped)\n'
  exit 0
fi

step "tests"
pnpm --filter @kikis-app/kikis-app test
pnpm --filter @kikis-app/mcp-server test
pnpm --filter provider-a test
pnpm --filter provider-b test

step "provider bundles"
# Catches a dependency that cannot run on Workers — the runtime rejects eval
# and new Function, which is why ajv validates manifests in a test, not at
# startup. Needs no Cloudflare credentials.
pnpm --filter provider-a build >/dev/null || fail "provider-a does not bundle for Workers"
pnpm --filter provider-b build >/dev/null || fail "provider-b does not bundle for Workers"
echo "  ok"

step "package pack hygiene"
pnpm --filter @kikis-app/mcp-server build >/dev/null || fail "@kikis-app/mcp-server failed to build"
bash "$root/scripts/check-pack.sh" || fail "package pack check failed"

printf '\n\033[32m✔ verify passed\033[0m\n'
