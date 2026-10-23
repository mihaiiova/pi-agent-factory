#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
factory="$here/../factory.mjs"

pass() { echo "ok - $1"; }
fail() { echo "not ok - $1" >&2; exit 1; }

# ── factory discover: valid JSON, capabilities, read-only ───────
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/.pi/skills/demo" "$work/.pi/agents"

cat > "$work/.pi/mcp.json" <<'JSON'
{ "mcpServers": { "openseo": { "url": "http://localhost:3002/mcp" } } }
JSON
cat > "$work/.pi/skills/demo/SKILL.md" <<'MD'
---
name: demo
description: A demo skill
---
# demo
MD
printf '# analyst\n' > "$work/.pi/agents/analyst.md"

before="$(cd "$work" && find . -type f | sort)"
out="$(node "$factory" discover "$work" 2>&1)" || fail "factory discover exited non-zero"
printf '%s\n' "$out" | node -e 'JSON.parse(require("fs").readFileSync(0, "utf-8"))' \
  >/dev/null || fail "factory discover output is not valid JSON"
after="$(cd "$work" && find . -type f | sort)"
[[ "$before" == "$after" ]] || fail "factory discover wrote files (not read-only)"

grep -q '"openseo"' <<<"$out" || fail "discover did not report the openseo MCP server"
grep -q '"demo"' <<<"$out" || fail "discover did not report the demo skill"
grep -q '"analyst"' <<<"$out" || fail "discover did not report the analyst subagent"
pass "factory discover emits valid JSON, reports capabilities, and writes nothing"

echo
echo "All factory-discover tests passed."
