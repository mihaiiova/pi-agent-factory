#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

pass() { echo "ok - $1"; }
fail() { echo "not ok - $1" >&2; exit 1; }

# ── Pure-module node:test suites ────────────────────────────────
for module in parse validate migrate models-mapping generate workflow-skill multi-agent; do
  if out="$(node --test "$here/$module.test.mjs" 2>&1)"; then
    pass "$module.test.mjs"
  else
    printf '%s\n' "$out" >&2
    fail "$module.test.mjs (run: node --test $here/$module.test.mjs)"
  fi
done

# ── factory validate CLI exit-code harness ──────────────────────
if bash "$here/factory-validate.test.sh"; then
  pass "factory-validate.test.sh"
else
  fail "factory-validate.test.sh"
fi

# ── factory generate CLI harness ────────────────────────────────
if bash "$here/factory-generate.test.sh"; then
  pass "factory-generate.test.sh"
else
  fail "factory-generate.test.sh"
fi

echo
echo "All agent-factory tests passed."
