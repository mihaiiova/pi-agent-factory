#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
factory="$root/skills/agent-factory/factory.mjs"
templates="$root/skills/agent-factory/templates"

pass() { echo "ok - $1"; }
fail() { echo "not ok - $1" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# ── factory import reconstructs system.yaml and preserves files ─
mkdir -p "$work/.pi"
cat > "$work/.pi/settings.json" <<'JSON'
{
  "defaultProvider": "openai-codex",
  "defaultModel": "gpt-5.6-terra",
  "defaultThinkingLevel": "medium",
  "defaultTools": ["read", "grep", "find", "ls", "bash", "edit", "write", "subagent"],
  "subagents": {
    "agentOverrides": {
      "oracle": { "model": "openai-codex/gpt-5.6-terra" },
      "reviewer": { "model": "deepseek/deepseek-v4-flash" },
      "scout": { "model": "deepseek/deepseek-v4-flash" },
      "worker": { "model": "deepseek/deepseek-v4-pro" }
    }
  },
  "spec": { "baseBranch": "development" }
}
JSON
cat > "$work/.pi/pi-config.json" <<'JSON'
{
  "tiers": {
    "high": { "model": "openai-codex/gpt-5.6-terra", "thinking": "medium" },
    "medium": { "model": "deepseek/deepseek-v4-pro", "thinking": "high" },
    "small": { "model": "deepseek/deepseek-v4-flash", "thinking": "high" }
  },
  "parentTier": "high",
  "subagentTiers": { "worker": "medium", "scout": "small", "reviewer": "small", "oracle": "high" }
}
JSON
touch "$work/.pi/settings.json" # ensure mtime exists; content written above

node "$factory" import "$work" >"$work/import.log" 2>"$work/import.err" || fail "import should exit 0"
[[ -f "$work/.pi/system.yaml" ]] || fail "import did not write .pi/system.yaml"
grep -q "spec" "$work/import.err" || fail "import report did not flag the spec block"
node "$factory" validate "$work" >/dev/null || fail "imported system.yaml does not validate"
pass "factory import reconstructs a valid system.yaml and reports flags"

# ── import never overwrites an existing system.yaml ────────────
if node "$factory" import "$work" >/dev/null 2>&1; then
  fail "second import should refuse (system.yaml already exists)"
fi
pass "factory import refuses to overwrite an existing system.yaml"

# ── clean-environment (deterministic): pinned packages ─────────
gen="$(mktemp -d)"
cp -r "$templates/coding-agent/.pi" "$gen/.pi"
node "$factory" generate "$gen" >/dev/null
node -e '
const s = require(process.argv[1]);
const expect = ["npm:pi-subagents@0.65.0", "npm:pi-mcp-adapter@2.32.1"];
if (JSON.stringify(s.packages) !== JSON.stringify(expect)) {
  console.error("packages = " + JSON.stringify(s.packages));
  process.exit(1);
}
' "$gen/.pi/settings.json" || fail "generated settings.json missing minimal runtime packages"
rm -rf "$gen"
pass "clean-env: generated settings.json declares only the runtime primitives"

# ── clean-environment (gated): isolated install + run ──────────
# The full isolation test (copy to a clean env → install declared deps → `pi`
# resolves orchestrator/agents/skills/workflows) requires a clean `pi` install
# and network; skip when unavailable, without weakening the deterministic
# packages assertion above.
if command -v pi >/dev/null 2>&1 && [[ -n "${RUN_CLEAN_ENV_TEST:-}" ]]; then
  iso="$(mktemp -d)"
  cp -r "$templates/coding-agent/.pi" "$iso/.pi"
  node "$factory" generate "$iso" >/dev/null
  if out="$(cd "$iso" && timeout 90 pi -p "describe yourself" 2>&1)"; then
    pass "clean-env: generated coding-agent runs headlessly in an isolated dir"
  else
    fail "clean-env: pi -p failed on the generated project (RUN_CLEAN_ENV_TEST=1)"
  fi
  rm -rf "$iso"
else
  echo "ok - clean-env isolated run SKIPPED (set RUN_CLEAN_ENV_TEST=1 and ensure 'pi' + network)"
fi

echo
echo "All factory-import tests passed."
