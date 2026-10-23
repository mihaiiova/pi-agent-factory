#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

pass() { echo "ok - $1"; }
fail() { echo "not ok - $1" >&2; exit 1; }

# ── Pure-module node:test suites ────────────────────────────────
for module in parse validate migrate models-mapping generate workflow-skill multi-agent discover mcp-gen policy modify skill-contract deps import; do
  if out="$(node --test "$here/$module.test.mjs" 2>&1)"; then
    pass "$module.test.mjs"
  else
    printf '%s\n' "$out" >&2
    fail "$module.test.mjs (run: node --test $here/$module.test.mjs)"
  fi
done

# ── round-trip + clean-env node:test suite ───────────────────────
if out="$(node --test "$here/roundtrip.mjs" 2>&1)"; then
  pass "roundtrip.mjs"
else
  printf '%s\n' "$out" >&2
  fail "roundtrip.mjs (run: node --test $here/roundtrip.mjs)"
fi

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

# ── factory discover CLI harness ────────────────────────────────
if bash "$here/factory-discover.test.sh"; then
  pass "factory-discover.test.sh"
else
  fail "factory-discover.test.sh"
fi

# ── factory modify CLI harness ──────────────────────────────────
if bash "$here/factory-modify.test.sh"; then
  pass "factory-modify.test.sh"
else
  fail "factory-modify.test.sh"
fi

# ── builder flow behavioral harness ────────────────────────────
if bash "$here/factory-behavior.test.sh"; then
  pass "factory-behavior.test.sh"
else
  fail "factory-behavior.test.sh"
fi

# ── factory import CLI + clean-env harness ─────────────────────
if bash "$here/factory-import.test.sh"; then
  pass "factory-import.test.sh"
else
  fail "factory-import.test.sh"
fi

echo
echo "All agent-factory tests passed."
