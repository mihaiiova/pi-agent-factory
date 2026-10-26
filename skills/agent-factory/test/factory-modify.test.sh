#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
factory="$root/skills/agent-factory/factory.mjs"
fixtures="$root/skills/agent-factory/test/fixtures"

pass() { echo "ok - $1"; }
fail() { echo "not ok - $1" >&2; exit 1; }

edit_yaml() {
  # edit_yaml <file> <js-expression> — load YAML, mutate `doc`, write back.
  local file="$1" expr="$2"
  node --input-type=module -e "
    import { loadYaml } from '$root/skills/agent-factory/yaml-loader.mjs';
    import { readFileSync, writeFileSync } from 'node:fs';
    const YAML = loadYaml();
    const [file, expr] = process.argv.slice(1);
    const doc = YAML.parse(readFileSync(file, 'utf-8'));
    eval(expr);
    writeFileSync(file, YAML.stringify(doc));
  " "$file" "$expr"
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# ── modify --dry-run exits 0 and writes nothing ──────────────────
mkdir -p "$work/.pi"
cp "$fixtures/generate/multi-agent/.pi/system.yaml" "$work/.pi/system.yaml"
node "$factory" generate "$work" >/dev/null
edit_yaml "$work/.pi/system.yaml" 'doc.agents.push({ name: "editor", tools: ["write"], model: "provider-a/model-medium", prompt: "Draft.\n" })'

if ! node "$factory" modify "$work" --dry-run >/dev/null 2>&1; then
  fail "modify --dry-run should exit 0"
fi
[[ ! -f "$work/.pi/agents/editor.md" ]] || fail "modify --dry-run wrote a file"
pass "factory modify --dry-run exits 0 and writes nothing"

# ── modify --yes applies non-conflict changes ────────────────────
node "$factory" modify "$work" --yes >/dev/null
[[ -f "$work/.pi/agents/editor.md" ]] || fail "modify --yes did not create the new agent"
pass "factory modify --yes applies non-conflict changes"

# ── modify --yes reports conflicts and never overwrites ─────────
printf '\n(hand-edited orchestrator note)\n' >> "$work/.pi/APPEND_SYSTEM.md"
edit_yaml "$work/.pi/system.yaml" 'doc.orchestrator.prompt = "A brand new orchestrator prompt.\n"'
out="$(node "$factory" modify "$work" --yes 2>&1)"
grep -q "conflict" <<<"$out" || fail "modify --yes did not report the conflict"
grep -q "hand-edited orchestrator note" "$work/.pi/APPEND_SYSTEM.md" || fail "modify overwrote a hand-edited authored file"
pass "factory modify --yes reports conflicts without overwriting"

# ── invalid model exits 1 ────────────────────────────────────────
bad="$(mktemp -d)"
cp -r "$fixtures/invalid-unknown-key/.pi" "$bad/"
if node "$factory" modify "$bad" --yes >/dev/null 2>&1; then
  rm -rf "$bad"
  fail "modify should reject an invalid system.yaml"
fi
rm -rf "$bad"
pass "factory modify rejects an invalid model"

echo
echo "All factory-modify tests passed."
