#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
factory="$root/skills/agent-factory/factory.mjs"
fixtures="$root/skills/agent-factory/test/fixtures"

pass() { echo "ok - $1"; }
fail() { echo "not ok - $1" >&2; exit 1; }

run_validate() {
  node "$factory" validate "$1" >/dev/null 2>&1
}

# ── Valid fixtures exit 0 ────────────────────────────────────────
for name in valid-seo coding-agent v0-legacy; do
  if run_validate "$fixtures/$name"; then
    pass "factory validate accepts $name (exit 0)"
  else
    fail "factory validate should accept $name but exited non-zero"
  fi
done

# ── Invalid fixtures exit 1 ──────────────────────────────────────
for name in invalid-unknown-key invalid-bad-reference invalid-malformed-workflow \
            invalid-incompatible invalid-malformed-yaml invalid-duplicate; do
  if run_validate "$fixtures/$name"; then
    fail "factory validate should reject $name but exited 0"
  else
    pass "factory validate rejects $name (exit 1)"
  fi
done

# ── Missing directory exits 1 ────────────────────────────────────
if run_validate "$fixtures/does-not-exist"; then
  fail "factory validate should reject a missing directory but exited 0"
else
  pass "factory validate rejects a missing directory (exit 1)"
fi

echo
echo "All factory-validate tests passed."
