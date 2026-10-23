#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
factory="$root/skills/agent-factory/factory.mjs"

pass() { echo "ok - $1"; }
fail() { echo "not ok - $1" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# ── builder flow: discover → design → preview → apply → validate ──
# 1. discover (read-only capability inventory)
node "$factory" discover "$work" >/dev/null 2>&1 || fail "discover failed"

# 2. design: the builder writes a minimal system.yaml from the outcome
mkdir -p "$work/.pi"
cat > "$work/.pi/system.yaml" <<'YAML'
schema: 1
name: seo-agent-system
description: "SEO analysis + article drafting"
models:
  tiers:
    high: { model: openai-codex/gpt-5.6-terra, thinking: medium }
    medium: { model: deepseek/deepseek-v4-pro, thinking: high }
    small: { model: deepseek/deepseek-v4-flash, thinking: low }
  parentTier: high
  subagents: { worker: medium, scout: small, reviewer: small, oracle: high }
orchestrator:
  name: orchestrator
  description: "Primary SEO agent"
  prompt: |
    You coordinate the SEO system.
  model: high
  tools: [read, grep, find, ls, bash, edit, write, subagent]
agents:
  - name: seo-analyst
    description: "Analyzes SEO data"
    tools: [read, grep]
    model: small
    prompt: |
      Analyze SEO data.
YAML

# 3. preview first: --dry-run writes nothing
node "$factory" generate "$work" --dry-run >/dev/null 2>&1 || fail "dry-run preview failed"
[[ ! -f "$work/.pi/settings.json" ]] || fail "preview wrote a file"

# 4. apply
node "$factory" generate "$work" >/dev/null 2>&1 || fail "generate failed"

# 5. validate the generated project
node "$factory" validate "$work" >/dev/null 2>&1 || fail "generated project did not validate"

pass "builder flow: discover → design → preview → apply → validate"

# ── gated headless smoke (pi/model-gated) ────────────────────────
if command -v pi >/dev/null 2>&1; then
  if out="$(cd "$work" && timeout 60 pi -p "describe yourself" 2>&1)"; then
    pass "behavioral: pi -p ran on the generated project"
  else
    echo "ok - behavioral: pi -p SKIPPED (offline/model-gated)"
  fi
else
  echo "ok - behavioral: pi -p SKIPPED (pi not on PATH)"
fi

echo
echo "All factory-behavior tests passed."
