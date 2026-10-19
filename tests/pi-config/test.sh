#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source_file="$root/extensions/pi-config/index.ts"
validator="$root/scripts/spec/validate-settings.sh"

pass() { echo "ok - $1"; }
fail() { echo "not ok - $1" >&2; exit 1; }

# ── Source layout / safety assertions ────────────────────────────

# Repo root must be derived from the extension's own location, never a
# hardcoded path — pi-config is cloned to different locations per machine.
grep -Fq 'fileURLToPath(import.meta.url)' "$source_file"

# Writes only project-local files, never the global settings file.
grep -Fq 'join(cwd, ".pi", "pi-config.json")' "$source_file"
grep -Fq 'join(cwd, ".pi", "settings.json")' "$source_file"
if grep -Fq '.pi/agent/settings.json' "$source_file"; then
  fail "pi-config must not reference the global settings file"
fi
pass "writes only project-local config files, never global settings"

# Model options must use the complete authenticated catalog, not this session's
# enabledModels scope, so /pi-config can select newly available models.
grep -Fq 'ctx.modelRegistry.getAvailable()' "$source_file"
if grep -Fq 'ctx.scopedModels' "$source_file"; then
  fail "pi-config must not constrain model options to scopedModels"
fi
pass "model options use the complete authenticated model catalog"

# Interactive flow uses the required primitives.
grep -Fq 'ctx.ui.select(' "$source_file"
grep -Fq 'ctx.ui.confirm(' "$source_file"
grep -Fq 'ctx.ui.input(' "$source_file"
grep -Fq 'ctx.ui.editor(' "$source_file"
pass "interactive flow uses select/confirm/input/editor"

# ── Unit tests: generation, idempotency, defaults ────────────────
node "$root/tests/pi-config/generate-settings.test.mjs"

# ── Generated settings pass the shared validator ─────────────────
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cat > "$work/gen.mjs" <<'NODE'
import { writeFileSync } from "node:fs";
const { generateSettings } = await import(
  process.env.ROOT + "/extensions/pi-config/generate-settings.mjs"
);

const config = {
  tiers: {
    high: { model: "anthropic/claude-sonnet-4-5", thinking: "high" },
    medium: { model: "openai/gpt-5", thinking: "medium" },
    small: { model: "openai/gpt-5-mini", thinking: "low" },
  },
  parentTier: "high",
  subagentTiers: { worker: "high", scout: "small", reviewer: "small", oracle: "high" },
};
const inferred = {
  baseBranch: "development",
  releaseBranch: "main",
  tagPrefix: "v",
  versionFile: "package.json",
  checks: { test: "npm test" },
  release: { viaPullRequest: false, draft: false, bumpDevAfterRelease: true },
};
const settings = generateSettings(config, { theme: "dark" }, inferred);
writeFileSync(process.argv[2], JSON.stringify(settings, null, 2));
NODE

ROOT="$root" node "$work/gen.mjs" "$work/settings.json"
"$validator" "$work/settings.json" >/dev/null || fail "generated settings failed validation"
pass "generated .pi/settings.json validates"

# ── validate-settings.sh decisionThreshold edge cases ───────────
"$root/tests/pi-config/validate-settings.test.sh"

echo
echo "All pi-config tests passed."
