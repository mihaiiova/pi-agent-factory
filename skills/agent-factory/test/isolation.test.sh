#!/usr/bin/env bash
# Hermetic runtime isolation harness (Tests A–G).
#
# Deterministic file-level checks always run (they need no model or network).
# Live `pi mcp list` checks are pi-gated: they SKIP only when `pi` is absent;
# otherwise a failed assertion FAILS loudly (never silently skipped).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
factory="$here/../factory.mjs"

pass() { echo "ok - $1"; }
fail() { echo "not ok - $1" >&2; exit 1; }
skip() { echo "ok - $1 SKIPPED ($2)"; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/.pi"
cat > "$work/.pi/system.yaml" <<'YAML'
schema: 1
name: iso-seo-demo
description: "Isolation test system"
models:
  tiers:
    high: { model: deepseek/deepseek-v4-pro, thinking: high }
    small: { model: deepseek/deepseek-flash, thinking: high }
  parentTier: high
  subagents: { worker: high, scout: small, reviewer: small, oracle: high }
orchestrator:
  name: orchestrator
  description: "Primary SEO coordinator"
  prompt: "Coordinate the SEO system. Delegate analysis to the analyst.\n"
  model: high
  tools: [read, grep, find, ls, bash, edit, write, subagent]
agents:
  - name: analyst
    description: "Read-only analyst"
    tools: [read, grep, find, ls]
    model: small
    prompt: "Analyze and report. You are read-only.\n"
skills:
  - name: draft
    description: "Draft an article"
    body: |
      # Draft
      Draft an article.
integrations:
  mcp:
    - name: openseo
      config: { url: "http://localhost:3002/mcp" }
YAML

node "$factory" generate "$work" >/dev/null

# ── Test A — undeclared host capabilities are omitted from generated config ──
node -e 'const s=require(process.argv[1]); if((s.packages||[]).some(p=>/pi-config|pi-web-access|yaml/.test(p))) process.exit(1)' "$work/.pi/settings.json" \
  || fail "A: runtime packages still carry pi-config/pi-web-access/yaml"
grep -q 'owlie\|cloudflare' "$work/.pi/mcp.json" && fail "A: global MCP servers leaked into .pi/mcp.json"
pass "A: polluted-host skills/MCP/web are absent from generated config"

# ── Test B — declared capabilities remain available ──────────────
grep -q 'openseo' "$work/.pi/mcp.json" || fail "B: declared MCP server missing"
grep -q 'name: analyst' "$work/.pi/agents/analyst.md" || fail "B: declared agent missing"
[[ -f "$work/.pi/skills/draft/SKILL.md" ]] || fail "B: declared skill missing"
node -e 'const s=require(process.argv[1]); const e=["npm:pi-subagents@0.65.0","npm:pi-mcp-adapter@2.32.1"]; if(JSON.stringify(s.packages)!==JSON.stringify(e)) process.exit(1)' "$work/.pi/settings.json" \
  || fail "B: runtime primitives missing"
pass "B: declared agents/skills/MCP/packages remain available"

# ── Test C — primary orchestrator is isolated, not just subagents ──
grep -q 'defaultTools' "$work/.pi/settings.json" || fail "C: orchestrator defaultTools missing"
node -e 'const s=require(process.argv[1]); if((s.defaultTools||[]).includes("web_search")||(s.defaultTools||[]).includes("fetch_content")) process.exit(1)' "$work/.pi/settings.json" \
  || fail "C: orchestrator defaultTools leaks web tools"
grep -q 'Coordinate the SEO system' "$work/.pi/APPEND_SYSTEM.md" || fail "C: orchestrator persona missing"
pass "C: primary orchestrator surface is bounded to declared tools"

# ── Test D — subagent allowlists still enforce declared boundaries ──
grep -q 'tools: \[read, grep, find, ls\]' "$work/.pi/agents/analyst.md" || fail "D: analyst allowlist wrong"
if grep -q 'tools: .*write' "$work/.pi/agents/analyst.md"; then
  fail "D: analyst allowlist grants write"
fi
pass "D: subagent allowlists enforce declared tool boundaries"

# ── Test E — clean environment (fresh isolated agent dir) ─────────
[[ -f "$work/run" ]] || fail "E: run launcher missing"
grep -q 'PI_CODING_AGENT_DIR' "$work/run" || fail "E: launcher missing isolated agent dir"
grep -q '\.factory/pi-home' "$work/run" || fail "E: launcher missing project pi-home"
pass "E: generated runtime uses a clean project-local agent dir"

# ── Test F — restart/resume does not reintroduce global config ───
first="$(node -e 'const s=require(process.argv[1]); process.stdout.write(JSON.stringify(s.packages))' "$work/.pi/settings.json")"
node "$factory" generate "$work" >/dev/null  # re-run (restart/resume)
second="$(node -e 'const s=require(process.argv[1]); process.stdout.write(JSON.stringify(s.packages))' "$work/.pi/settings.json")"
[[ "$first" == "$second" ]] || fail "F: re-generate changed the packages list"
pass "F: restart/re-generate keeps the isolated packages stable"

# ── Test G — undeclared extension tools/MCP are omitted, not merely hidden ──
if grep -q 'pi-web-access' "$work/.pi/settings.json"; then fail "G: web-access still present"; fi
node -e 'const m=require(process.argv[1]); const names=Object.keys(m.mcpServers||{}); if(names.some(n=>n==="owlie"||n==="cloudflare")) process.exit(1)' "$work/.pi/mcp.json" \
  || fail "G: global MCP servers present in generated config"
pass "G: undeclared MCP/extension tools are omitted from the runtime"

# ── Live effective-surface check (pi-gated) ───────────────────────
if command -v pi >/dev/null 2>&1; then
  if out="$(cd "$work" && PI_CODING_AGENT_DIR="$work/.factory/pi-home" timeout 60 pi mcp list 2>&1)"; then
    if grep -qi 'owlie\|cloudflare' <<<"$out"; then
      fail "live: isolated pi mcp list still reports host MCP servers"
    fi
    pass "live: isolated pi mcp list omits host MCP servers"
  else
    fail "live: pi mcp list failed under isolation ($out)"
  fi
else
  skip "live: isolated pi mcp list" "pi not on PATH"
fi

echo
echo "All isolation tests passed."
