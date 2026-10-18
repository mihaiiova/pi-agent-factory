#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
validate="$root/scripts/spec/validate-plan.sh"
apply="$root/scripts/spec/apply-plan.sh"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/bin"
ln -s "$root/tests/spec/fake-gh" "$work/bin/gh"
export PATH="$work/bin:$PATH"

pass() { echo "ok - $1"; }
fail() { echo "not ok - $1" >&2; exit 1; }
assert_contains() { grep -qF -- "$2" "$1" || fail "assert_contains '$1' missing '$2'"; }
assert_not_contains() { ! grep -qF -- "$2" "$1" || fail "assert_not_contains '$1' found '$2'"; }

# ── Fixtures ────────────────────────────────────────────────────

cat > "$work/spec-plan.json" <<'JSON'
{
  "plan_id": "plan-spec-add-csv-export",
  "kind": "spec",
  "spec": {
    "id": "add-csv-export",
    "title": "Spec: Add CSV export",
    "body": "## Problem Statement\n\nUsers cannot export reports.\n\n## Solution\n\nAdd a CSV export button.\n\n## Testing Decisions\n\nTest at the export service seam.",
    "labels": []
  }
}
JSON

cat > "$work/epic-plan.json" <<'JSON'
{
  "plan_id": "plan-epic-content-ingestion",
  "kind": "epic",
  "epic": {
    "id": "content-ingestion",
    "title": "Epic: Rework content ingestion",
    "body": "# Summary\n\nRework ingestion.\n\n# Child specs\n\n- foundation\n- youtube\n- podcast\n- ui-migration",
    "labels": []
  },
  "specs": [
    { "id": "content-source-foundation", "title": "Introduce normalized content source model", "body": "Normalize all content behind one ContentSource interface.", "labels": [], "blocked_by": [] },
    { "id": "youtube-ingestion", "title": "Implement YouTube ingestion", "body": "Support YouTube via normalized ingestion.", "labels": [], "blocked_by": ["content-source-foundation"] },
    { "id": "podcast-ingestion", "title": "Implement podcast ingestion", "body": "Support podcasts via normalized ingestion.", "labels": [], "blocked_by": ["content-source-foundation"] },
    { "id": "ui-migration", "title": "Move existing UI onto normalized ingestion", "body": "Migrate UI.", "labels": [], "blocked_by": ["youtube-ingestion", "podcast-ingestion"] }
  ]
}
JSON

run_validate_fail() {
  local plan="$1" pattern="$2"
  if "$validate" "$plan" >/dev/null 2>"$work/err"; then
    fail "validate unexpectedly passed: $(basename "$plan")"
  fi
  assert_contains "$work/err" "$pattern"
  pass "validate rejects: $pattern"
}

# ── 1. Validation: cohesive request → normal spec (valid) ────────
"$validate" "$work/spec-plan.json" >/dev/null && pass "cohesive request validates as normal spec" || fail "spec plan should validate"

# ── 2. Validation: large decomposable request → epic (valid) ─────
"$validate" "$work/epic-plan.json" >/dev/null && pass "decomposable request validates as epic" || fail "epic plan should validate"

# ── 3. Validation: unknown dependency fails ──────────────────────
cat > "$work/unknown-dep.json" <<'JSON'
{ "plan_id": "plan-unknown-dependency", "kind": "epic", "epic": { "id": "e", "title": "E", "body": "b", "labels": [] },
  "specs": [
    { "id": "a", "title": "A", "body": "b", "labels": [], "blocked_by": ["nope"] },
    { "id": "b", "title": "B", "body": "b", "labels": [], "blocked_by": [] }
  ] }
JSON
run_validate_fail "$work/unknown-dep.json" "unknown dependency"

# ── 4. Validation: dependency cycle fails ────────────────────────
cat > "$work/cycle.json" <<'JSON'
{ "plan_id": "plan-dependency-cycle", "kind": "epic", "epic": { "id": "e", "title": "E", "body": "b", "labels": [] },
  "specs": [
    { "id": "a", "title": "A", "body": "b", "labels": [], "blocked_by": ["b"] },
    { "id": "b", "title": "B", "body": "b", "labels": [], "blocked_by": ["a"] }
  ] }
JSON
run_validate_fail "$work/cycle.json" "cycle or unsorted"

# ── 5. Validation: duplicate ids fail ────────────────────────────
cat > "$work/dup.json" <<'JSON'
{ "plan_id": "plan-duplicate-ids", "kind": "epic", "epic": { "id": "e", "title": "E", "body": "b", "labels": [] },
  "specs": [
    { "id": "a", "title": "A", "body": "b", "labels": [], "blocked_by": [] },
    { "id": "a", "title": "A2", "body": "b", "labels": [], "blocked_by": [] }
  ] }
JSON
run_validate_fail "$work/dup.json" "duplicate id"

# ── 6. Validation: one-ticket wrapper fails ──────────────────────
cat > "$work/one-ticket.json" <<'JSON'
{ "plan_id": "plan-one-ticket", "kind": "spec", "spec": { "id": "s", "title": "S", "body": "b", "labels": [] },
  "tickets": [ { "id": "t", "title": "T", "body": "b", "labels": [], "blocked_by": [] } ] }
JSON
if "$validate" "$work/one-ticket.json" >/dev/null 2>&1; then
  fail "one-ticket wrapper should be rejected"
fi
pass "one-ticket wrapper rejected"

# ── 7. Validation: epic requires multiple children ───────────────
cat > "$work/one-child.json" <<'JSON'
{ "plan_id": "plan-one-child", "kind": "epic", "epic": { "id": "e", "title": "E", "body": "b", "labels": [] },
  "specs": [ { "id": "a", "title": "A", "body": "b", "labels": [], "blocked_by": [] } ] }
JSON
if "$validate" "$work/one-child.json" >/dev/null 2>&1; then
  fail "single-child epic should be rejected"
fi
pass "single-child epic rejected"

# ── 8. Apply: normal spec → one issue, spec:ready ────────────────
state="$work/state-spec"; mkdir -p "$state"
export FAKE_GH_STATE_DIR="$state" FAKE_GH_LOG="$state/calls.log" GH_TOKEN=test PI_REPOSITORY=owner/repo
"$apply" "$work/spec-plan.json" > "$work/spec.out" || fail "apply spec should succeed"
assert_contains "$work/spec.out" "plan applied: plan_id=plan-spec-add-csv-export kind=spec"
[[ "$(grep -c -- 'issue create' "$state/calls.log")" == "1" ]] || fail "spec should create exactly one issue"
assert_contains "$state/calls.log" "--add-label spec:ready"
assert_not_contains "$state/calls.log" "spec:epic"
pass "normal spec applies to one ready issue"

# ── 9. Apply: epic → safe order, labels, blocker links ───────────
state="$work/state-epic"; mkdir -p "$state"
export FAKE_GH_STATE_DIR="$state" FAKE_GH_LOG="$state/calls.log"
unset FAKE_GH_FAIL_ON_CREATE
"$apply" "$work/epic-plan.json" > "$work/epic.out" || fail "apply epic should succeed"
assert_contains "$work/epic.out" "plan applied: plan_id=plan-epic-content-ingestion kind=epic"

order_ok() { # first before second in calls.log
  local a="$1" b="$2" la lb
  la="$(grep -nF -- "$a" "$state/calls.log" | head -1 | cut -d: -f1)"
  lb="$(grep -nF -- "$b" "$state/calls.log" | head -1 | cut -d: -f1)"
  [[ -n "$la" && -n "$lb" ]] || fail "order: missing '$a' or '$b'"
  [[ "$la" -lt "$lb" ]] || fail "order: '$a' must precede '$b'"
}
order_ok "Epic: Rework content ingestion" "Introduce normalized content source model"
order_ok "Introduce normalized content source model" "Implement YouTube ingestion"
order_ok "Introduce normalized content source model" "Implement podcast ingestion"
order_ok "Implement YouTube ingestion" "Move existing UI onto normalized ingestion"
order_ok "Implement podcast ingestion" "Move existing UI onto normalized ingestion"
pass "epic children created in dependency-safe order"

[[ "$(grep -c -- '--add-label spec:epic' "$state/calls.log")" == "1" ]] || fail "epic should be labeled spec:epic exactly once"
[[ "$(grep -c -- '--add-label spec:ready' "$state/calls.log")" == "1" ]] || fail "only the unblocked child should be spec:ready"
pass "epic container labeled; only unblocked child is ready"

find_issue() { # state_dir, title -> file path
  local f
  for f in "$1"/issue-*.json; do
    [[ -e "$f" ]] || continue
    [[ "$(jq -r '.title' "$f")" == "$2" ]] && { echo "$f"; return; }
  done
  echo ""
}

# dependency links resolved to real URLs
youtube_file="$(find_issue "$state" "Implement YouTube ingestion")"
assert_contains "$youtube_file" "[Introduce normalized content source model](https://github.com/owner/repo/issues/2)"
pass "child 'Blocked by' links resolve to the blocker issue"

# epic body links back to children
epic_file="$(find_issue "$state" "Epic: Rework content ingestion")"
assert_contains "$epic_file" "## Child spec issues"
assert_contains "$epic_file" "[Move existing UI onto normalized ingestion](https://github.com/owner/repo/issues/5)"
pass "epic links back to every child"

# ── 10. Idempotency: rerun creates nothing new ───────────────────
before="$(cat "$state/.create_count")"
"$apply" "$work/epic-plan.json" >/dev/null || fail "rerun apply should succeed"
after="$(cat "$state/.create_count")"
[[ "$before" == "$after" ]] || fail "rerun should reuse markers, not create duplicates"
pass "rerun is idempotent via markers"

# ── 11. Partial failure does not mark complete ───────────────────
state="$work/state-partial"; mkdir -p "$state"
export FAKE_GH_STATE_DIR="$state" FAKE_GH_LOG="$state/calls.log"
export FAKE_GH_FAIL_ON_CREATE=2
if "$apply" "$work/epic-plan.json" > "$work/partial.out" 2>"$work/partial.err"; then
  fail "partial apply should fail"
fi
assert_not_contains "$work/partial.out" "plan applied"
[[ "$(find "$state" -name 'issue-*.json' | wc -l)" == "1" ]] || fail "partial run should stop after the failing create"
pass "partial failure aborts without a complete signal"

# ── 12. Skills declare required behaviors ────────────────────────
start="$root/skills/spec-start/SKILL.md"
assert_contains "$start" "epic"
assert_contains "$start" "refuse"
pass "spec-start refuses an epic container"

assert_contains "$start" "Blocked by"
assert_contains "$start" "spec:ready"
pass "spec-start allows ready children and refuses blocked ones"

close="$root/skills/spec-close/SKILL.md"
assert_contains "$close" "all child specs complete"
assert_contains "$close" "Blocked by"
pass "spec-close surfaces epic-complete state and clears blockers"

audit="$root/skills/spec-audit/SKILL.md"
assert_contains "$audit" "read-only"
assert_contains "$audit" "do not modify"
assert_contains "$audit" "consolidate"
pass "spec-audit is read-only and consolidates"

backlog="$root/skills/spec-backlog/SKILL.md"
assert_contains "$backlog" "Do not mutate"
assert_contains "$backlog" "approval"
pass "spec-backlog does not mutate without approval"

# ── 13. Subagent delegation: scout (inspection) and worker (TDD) ─
new="$root/skills/spec-new/SKILL.md"
assert_contains "$new" "scout"
assert_contains "$new" "handoff"
assert_contains "$new" "read-only"
assert_contains "$new" ".pi/artifacts/spec-new"
assert_not_contains "$new" "agentOverrides"
pass "spec-new delegates inspection to a read-only scout with a handoff file"

assert_contains "$start" "worker"
assert_contains "$start" "tdd"
assert_contains "$start" "trivial"
assert_contains "$start" "turn budget"
assert_contains "$start" "single writer"
assert_contains "$start" "checkpoint"
assert_not_contains "$start" "agentOverrides"
pass "spec-start delegates the TDD loop to a worker via a trivial-spec heuristic"

"$root/tests/spec/run-checks-test.sh"
"$root/tests/spec/trivial-spec-test.sh"
bash "$root/tests/spec-cost/test.sh"

echo
echo "All spec-orchestration tests passed."

