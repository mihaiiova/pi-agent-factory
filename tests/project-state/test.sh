#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source_file="$root/extensions/project-state/index.ts"

pass() { echo "ok - $1"; }
fail() { echo "not ok - $1" >&2; exit 1; }

# ── Source layout / safety assertions ────────────────────────────

# Repo root must be derived from the extension's own location, never a
# hardcoded path — pi-config is cloned to different locations per machine.
grep -Fq 'fileURLToPath(import.meta.url)' "$source_file"

# Writes only project-local runtime files under the project config directory;
# never the global settings file or another repository.
grep -Fq 'join(ctx.cwd, CONFIG_DIR_NAME)' "$source_file"
grep -Fq 'CONFIG_DIR_NAME' "$source_file"
if grep -Fq '.pi/agent/settings.json' "$source_file"; then
  fail "project-state must not reference the global settings file"
fi
pass "project-state uses the project config directory, never the global settings"

# Lifecycle hooks: session_start, session_shutdown, and the exposed compaction
# boundary. Handlers must be non-blocking (no prompts).
grep -Fq 'pi.on("session_start"' "$source_file"
grep -Fq 'pi.on("session_shutdown"' "$source_file"
grep -Fq 'pi.on("session_before_compact"' "$source_file"
if grep -Fq 'ctx.ui.confirm' "$source_file"; then
  fail "project-state lifecycle must not call ctx.ui.confirm"
fi
if grep -Fq 'ctx.ui.select' "$source_file"; then
  fail "project-state lifecycle must not call ctx.ui.select"
fi
pass "project-state hooks session lifecycle and never prompts"

# The three read-only commands are registered.
grep -Fq 'registerCommand("session-status"' "$source_file"
grep -Fq 'registerCommand("session-history"' "$source_file"
grep -Fq 'registerCommand("session-cost"' "$source_file"
pass "registers /session-status, /session-history, and /session-cost"

# The persistence/metadata/presentation/reconcile seams are wired, not reimplemented.
grep -Fq './state.mjs' "$source_file"
grep -Fq './schema.mjs' "$source_file"
grep -Fq './metadata.mjs' "$source_file"
grep -Fq './presentation.mjs' "$source_file"
grep -Fq './reconcile.mjs' "$source_file"
pass "wires the pure state/schema/metadata/presentation/reconcile modules"

# Lifecycle boundaries re-derive branch/spec/phase from authoritative sources
# (git + GitHub labels) rather than replaying the session-start snapshot, and
# finalization records reliably reported per-agent subagent usage.
grep -Fq 'reconcileContext(' "$source_file"
grep -Fq 'persistProjection(' "$source_file"
grep -Fq 'agentSummary(' "$source_file"
grep -Fq 'subagentUsage' "$source_file"
pass "reconciles context at lifecycle boundaries and records subagent usage"

# Finalization enriches the record with workflow identity and check results,
# and session start uses the native header timestamp for accurate startedAt.
grep -Fq './workflow.mjs' "$source_file"
grep -Fq 'detectWorkflow(' "$source_file"
grep -Fq 'readCheckResults(' "$source_file"
grep -Fq 'getHeader()' "$source_file"
grep -Fq 'workflow' "$source_file"
grep -Fq 'checkResults' "$source_file"
pass "enriches records with workflow identity, check results, and header startedAt"

# Session identity and provenance come from the native read-only session API.
grep -Fq 'ctx.sessionManager.getSessionId()' "$source_file"
grep -Fq 'ctx.sessionManager.getSessionFile()' "$source_file"
grep -Fq 'VERSION' "$source_file"
grep -Fq 'CURRENT_SESSION_VERSION' "$source_file"
pass "collects session identity and Pi version provenance from native APIs"

# /spec-cost and the existing lifecycle skills are not replaced or rewritten.
if grep -Fq 'spec-cost' "$source_file"; then
  fail "project-state must not touch /spec-cost"
fi
pass "project-state does not replace /spec-cost or existing lifecycle skills"

# ── Unit tests ───────────────────────────────────────────────────
node "$root/tests/project-state/schema.test.mjs"
node "$root/tests/project-state/state.test.mjs"
node "$root/tests/project-state/metadata.test.mjs"
node "$root/tests/project-state/presentation.test.mjs"
node "$root/tests/project-state/reconcile.test.mjs"
node "$root/tests/project-state/workflow.test.mjs"
node --test "$root/tests/project-state/accounting.test.mjs" "$root/tests/project-state/lifecycle.test.mjs"

echo
echo "All project-state tests passed."

