#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
forge="$here/../forge.mjs"

pass() { echo "ok - $1"; }
fail() { echo "not ok - $1" >&2; exit 1; }

# ── forge discover: valid JSON, capabilities, read-only ───────
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

mkdir -p "$work/bin"
cat > "$work/bin/pi" <<'SH'
#!/bin/sh
[ "$1" = "--list-models" ] || exit 1
printf 'provider    model        context\nprovider-a  model-large  1M\nprovider-b  model-small  128K\n'
SH
chmod +x "$work/bin/pi"

before="$(cd "$work" && find . -type f | sort)"
out="$(PATH="$work/bin:$PATH" node "$forge" discover "$work" 2>&1)" || fail "forge discover exited non-zero"
printf '%s\n' "$out" | node -e 'JSON.parse(require("fs").readFileSync(0, "utf-8"))' \
  >/dev/null || fail "forge discover output is not valid JSON"
after="$(cd "$work" && find . -type f | sort)"
[[ "$before" == "$after" ]] || fail "forge discover wrote files (not read-only)"

grep -q '"openseo"' <<<"$out" || fail "discover did not report the openseo MCP server"
grep -q '"demo"' <<<"$out" || fail "discover did not report the demo skill"
grep -q '"analyst"' <<<"$out" || fail "discover did not report the analyst subagent"
pass "forge discover emits valid JSON, reports capabilities, and writes nothing"

printf '%s\n' "$out" | node -e '
const inv = JSON.parse(require("fs").readFileSync(0, "utf-8"));
if (JSON.stringify(inv.models) !== JSON.stringify(["provider-a/model-large", "provider-b/model-small"])) process.exit(1);
' || fail "discover does not report the full Pi model line-up"
pass "forge discover reports the full Pi model line-up"

printf '%s\n' "$out" | node -e '
const inv = JSON.parse(require("fs").readFileSync(0, "utf-8"));
if (JSON.stringify(inv.clis) !== "{}") process.exit(1);
' || fail "discover probes CLIs nobody named"
named="$(PATH="$work/bin:$PATH" node "$forge" discover "$work" --cli sh --cli no-such-cli-xyz --cli sh 2>&1)" || fail "discover --cli exited non-zero"
printf '%s\n' "$named" | node -e '
const inv = JSON.parse(require("fs").readFileSync(0, "utf-8"));
if (JSON.stringify(inv.clis) !== JSON.stringify({ sh: true, "no-such-cli-xyz": false })) process.exit(1);
' || fail "discover --cli does not probe exactly the named CLIs"
if node "$forge" discover "$work" --cli '-x' >/dev/null 2>&1; then fail "discover accepted an invalid --cli name"; fi
pass "forge discover probes only the CLIs the user names"

forge_root="$(cd "$here/../../.." && pwd)"
printf '%s\n' "$out" | node -e '
const inv = JSON.parse(require("fs").readFileSync(0, "utf-8"));
if ("knownIntegrations" in inv) process.exit(1);
if (inv.skills.some((s) => s.dir.startsWith(process.argv[1] + "/"))) process.exit(1);
' "$forge_root" || fail "discover recommends or lists skills bundled with the forge"
pass "forge discover lists only the user's own skills, never forge-bundled ones"

echo
echo "All forge-discover tests passed."
