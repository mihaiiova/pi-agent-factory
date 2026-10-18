# project-state

Project-local resume context and append-only session history for pi-config.

- **Commands:** `/session-status`, `/session-history`, `/session-cost`
- **State file:** `.pi/state.json` (mutable resume projection)
- **Session records:** `.pi/sessions/<filesystem-safe-session-id>.json` (immutable)

This extension records **runtime observability/resume data**, not planning
artifacts. GitHub issue lifecycle labels and git branch state remain the
authoritative workflow model; local state is a non-authoritative projection
that is re-derived from those sources at session boundaries and loses on
divergence.

## File layout

| Path | Kind | Persisted? | Notes |
|------|------|------------|-------|
| `.pi/settings.json` | configuration | yes (committed) | authoritative project config |
| `.pi/pi-config.json` | configuration | yes (committed) | model-tier source of truth |
| `.pi/state.json` | runtime projection | no (gitignored) | current spec/phase/branch/last session |
| `.pi/sessions/*.json` | runtime records | no (gitignored) | immutable snapshots grouped by native session |

Both runtime paths are covered by targeted `.gitignore` rules (`.pi/state.json`
and `.pi/sessions/`); the committed `.pi` configuration files are deliberately
not ignored. Projects configured with pi-config should add the same two rules
to their own `.gitignore`.

## Schema and versioning

Every document begins with `schemaVersion: 1`. Loaders dispatch through an
explicit migration dispatcher (`schema.mjs`) that:

- migrates older documents forward through registered migrations;
- rejects documents newer than the current schema;
- rejects malformed documents (non-objects, missing/invalid `schemaVersion`).

Malformed state files are treated as missing on session start, so a broken
`state.json` is replaced by a fresh projection rather than crashing the
session. Session listing skips malformed records without failing.

## What is recorded

Only facts the runtime reliably exposes; unavailable facts are `null`, never
inferred or fabricated.

- **State projection:** current active spec (derived from a
  `spec/<number>-<slug>` branch), lifecycle phase (from GitHub labels, when
  reachable), branch (from git), last finalized session id, known checks, and
  an update timestamp.
- **Session record:** schema version, timestamps, resolved project context
  (spec/phase/branch), the lifecycle `workflow` that drove the session (from
  the session's own `/spec-*` command, `null` when none), concise
  summary/outcome (only when available — these stay `null` until a summary
  source exists), changed files (git status snapshot), check results (from
  `run-checks.sh`'s `results.json`, `null` when none ran), aggregated
  main-agent usage, active parent model + thinking level, per-agent subagent
  usage (role, `status` from `exitCode`, actual `model`, and cost), subagent
  routing from `settings.json` `subagents.agentOverrides`, and a provenance
  block.
- **Provenance:** pi-config commit SHA, installed Pi package version, Pi
  session-format version, product version (project `versionFile`), and a
  SHA-256 hash of the active `pi-config.json` + `settings.json` configuration
  (a reference, never a copy of the configuration).

Nested tool/sub-agent model usage is intentionally excluded from the
main-agent usage aggregate to avoid mis-attribution. No pricing is computed.

## Version semantics

Four distinct version facts are represented separately:

1. **Product version** — the project's `package.json` (or configured
   `spec.versionFile`) version, corresponding to release tags.
2. **pi-config commit** — the pi-config repository HEAD SHA.
3. **Installed Pi version** — the running Pi package version.
4. **Pi session-format version** — Pi's session JSONL format version.

## Commands

- `/session-status` — current projection: branch, spec, phase, pending work,
  last session, and current-session cost when known.
- `/session-history` — recent finalized records: date, spec, workflow,
  outcome, delegation roles, known cost, and a summary when present.
- `/session-cost` — current session, recent sessions, and project-aggregate
  known cost. Sessions without reported cost are counted as gaps.

All three are read-only; none writes state, and none replaces `/spec-cost` or
any existing spec-lifecycle skill.

## Tests

```bash
tests/project-state/test.sh
```

The persistence seam (`loadState`, `writeStateAtomic`, `createSession`,
`finalizeSession`) and the schema/migration dispatcher are exercised with
`node:assert/strict` in isolated temporary directories; command/lifecycle
registration is asserted against the extension source, matching the repository
convention for Pi-coupled surfaces.


## Accounting and resumed sessions

All cost surfaces share `accounting.mjs` and `accounting-project.mjs`: `/session-status`, `/session-history`, `/session-cost`, `/spec-cost`, and the cost summary in `/spec-close`. There is no separate Python price/attribution implementation. The compatibility `cost.py` entry point delegates to the Node CLI.

The ledger uses the native active branch (`getBranch()` while Pi runs; the last appended tree entry when reopening a transcript), including compaction, branch-summary, and native `usage` entries. Nested tool-result usage is not main-agent usage. Fork lineage namespaces observation IDs; shared inherited observations are counted once in project and spec aggregates. Individual conversation totals include their active ancestry, so manually adding session rows is not the same as the deduplicated project total.

Subagent metadata belongs to a session only through explicit run IDs, artifact links, or an explicit parent-session ID. Costs belong to the launching tool call's phase, even when completion occurs later. The metadata timestamp is completion time and is never used to guess ownership. Ambiguous/unlinked metadata is omitted with coverage warnings. Known explicit zero is preserved; absent, invalid, negative, or non-finite prices remain unknown. No token prices are calculated. Totals with unpriced observations are known subtotals, not invoices.

The first snapshot keeps its original filename. A resumed session that changes observations appends an immutable `<session-id>--<fingerprint>.json` revision. Identical retries create no revision; earlier files are never overwritten. `listSessions()` returns the latest snapshot per native session, sorted by finalization time; `allSnapshots: true` exposes the immutable history. Revisions never add cumulative snapshots together.

`schemaVersion: 1` remains readable. New snapshots add `accounting.version: 1`, stable observation keys, nullable reported costs, `snapshotRevision`, and `snapshotFingerprint`. Old records are retained. Reports recalculate them from available raw transcripts; legacy aggregate fields alone cannot prove branch selection or subagent ownership and are omitted if raw evidence is missing. New accounting snapshots can supply verifiable observations when raw transcripts disappear. Reporting reads raw transcripts on demand, including resumed work that has not finalized yet. All data is local; unsaved later turns and other machines remain outside the report.

Examples:

```text
/session-cost
/spec-cost
/spec-close #42
```

For a scriptable report:

```bash
node <pi-config>/skills/spec-cost/cost.mjs --cwd /path/to/product --spec 42 --json
```

Behavior checks, including the actual extension's callback wiring, run with `bash tests/project-state/test.sh` on the Node runtime used by Pi (Node 24 for native TypeScript test loading).
