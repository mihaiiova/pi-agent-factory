#!/usr/bin/env bash
# Launcher integration tests — verify the generated `run` script with a MOCKED
# `pi` executable (no model, no credentials, no network). Proves: correct
# working directory, isolated env, argument forwarding, exit-code passthrough,
# and explicit failure when the project model is missing.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
factory="$here/../factory.mjs"
fixtures="$here/fixtures/generate/minimal"

pass() { echo "ok - $1"; }
fail() { echo "not ok - $1" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# ── Fake pi executable that records its invocation ──────────────
bin="$work/bin"
mkdir -p "$bin"
cat > "$bin/pi" <<'EOF'
#!/usr/bin/env bash
printf 'cwd=%s\n' "$PWD" >> "$LAUNCHER_LOG"
printf 'agent_dir=%s\n' "${PI_CODING_AGENT_DIR:-}" >> "$LAUNCHER_LOG"
printf 'args=%s\n' "$*" >> "$LAUNCHER_LOG"
exit "${FAKE_PI_EXIT:-0}"
EOF
chmod +x "$bin/pi"

# ── Generate a real project so we exercise the emitted `run` ────
proj="$work/project"
mkdir -p "$proj/.pi"
cp "$fixtures/.pi/system.yaml" "$proj/.pi/system.yaml"
node "$factory" generate "$proj" >/dev/null 2>&1
[[ -x "$proj/run" ]] || fail "generate did not emit an executable run launcher"

# ── Run from a DIFFERENT directory, with the fake pi on PATH ────
export LAUNCHER_LOG="$work/log"
: > "$LAUNCHER_LOG"
export PATH="$bin:$PATH"

(cd "$work" && "$proj/run" alpha "two words")
grep -Fq "cwd=$proj" "$LAUNCHER_LOG" || fail "launcher did not cd into the project root"
grep -Fq "agent_dir=$proj/.factory/pi-home" "$LAUNCHER_LOG" || fail "launcher did not set the isolated agent dir"
grep -Fq 'args=--no-context-files alpha two words' "$LAUNCHER_LOG" || fail "launcher did not isolate context and forward arguments"
pass "launcher: cwd/env/args correct from an arbitrary working directory"

# ── Exit code passthrough ───────────────────────────────────────
set +e
(export FAKE_PI_EXIT=7; cd "$work" && "$proj/run") 2>/dev/null
code=$?
set -e
[[ $code -eq 7 ]] || fail "launcher did not preserve the fake pi exit code (got $code)"
pass "launcher: preserves pi exit code"

# ── Explicit failure when the project model is missing ──────────
rm "$proj/.pi/system.yaml"
: > "$LAUNCHER_LOG"
if (cd "$work" && "$proj/run" anything) 2>/dev/null; then
  fail "launcher must fail when .pi/system.yaml is missing"
fi
if grep -q 'cwd=' "$LAUNCHER_LOG"; then
  fail "launcher must not invoke pi when the project model is missing"
fi
pass "launcher: fails before invoking pi when .pi/system.yaml is missing"

echo
echo "All launcher tests passed."
