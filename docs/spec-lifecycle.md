# Spec lifecycle

The workflow separates cheap capture/discovery from definition and implementation.

```text
/spec-init     → one-time setup: generate .pi/settings.json
/spec-draft    → remember a shallow thought for later
/spec-backlog  → prioritize the full known work queue
/spec-audit    → discover technical problems not yet represented
        │
        ▼
/spec-new      → define one spec or an epic of specs
/spec-start    → implement one spec (TDD)
/spec-review   → verify one implementation
/spec-close    → merge/close one spec, or close a completed epic
/spec-release  → merge development → production and cut a tagged release
/spec-status   → read-only dashboard (branches, states, releasable)
/spec-cost     → report per-skill cost (main agent + sub-agents)
```

Lower-level skills remain available as primitives: `grill-me`/`grilling`, `to-spec`, `tdd`, `code-review`, `codebase-design`, `domain-modeling`, `improve-codebase-architecture`, `review-session`.

## Core concepts

There are only two planning artifacts:

- **Spec** — the atomic implementation unit. `/spec-start`, `/spec-review`, and implementation-mode `/spec-close` operate on a spec.
- **Epic** — a planning container for two or more independently implementable specs. An epic has no implementation branch and cannot be started directly.

There is no ticket layer beneath a spec. If work cannot reasonably be implemented/reviewed as one cohesive spec, split it into an epic of specs.

## Runtime state is not a planning artifact

The `project-state` extension (`/session-status`, `/session-history`,
`/session-cost`) writes local **runtime observability/resume data** — a mutable
`.pi/state.json` projection and write-once `.pi/sessions/*.json` records. These
are not a third planning artifact and never hold lifecycle authority:

- GitHub issue lifecycle labels remain the authoritative spec state.
- Git branch state remains authoritative for branch/merge state.
- `.pi/state.json` is a non-authoritative projection that is re-derived from
  git and GitHub labels at session boundaries and **loses on divergence**.

Both runtime paths are gitignored by default; see
`extensions/project-state/README.md` for the persisted-vs-unpersisted layout,
schema/version semantics, immutable resume revisions, and the shared observation ledger
used by session costs, `/spec-cost`, and `/spec-close`. Legacy aggregate fields
without raw evidence are retained but cannot establish verified costs.

## Idea capture

`/spec-draft` creates one shallow GitHub issue with the `idea` label. It is intentionally underdefined. `/spec-backlog` may later recommend `/spec-new #<issue>` when the idea remains valuable.

## Spec vs epic

Prefer a normal spec even when the work spans frontend/backend/database or multiple modules, as long as it is one cohesive outcome. Prefer an epic only when children are independently meaningful implementation/review units. Technical prerequisites alone do not justify child specs unless they have independent product or architectural value.

## Plan identity and convergence

`/spec-new` writes a plan with:

- an opaque collision-resistant `plan_id`, generated once per definition and reused when that same definition is resumed;
- readable kebab-case artifact ids scoped to the plan.

The applier stores a hidden marker containing repository + plan id + artifact kind + artifact id. Re-running the same plan is **idempotent and convergent**: existing GitHub issues are reused and their title/body are updated to the latest plan instead of duplicated. A different planning effort must get a new `plan_id`, even if it happens to use the same title/slug as an old effort.

## Lifecycle state

For non-epic specs, these labels are mutually exclusive lifecycle states:

| State | Label | Set by |
|---|---|---|
| ready | `spec:ready` | `/spec-new`, or `/spec-close` when blockers clear |
| in progress | `spec:in-progress` | `/spec-start` |
| reviewed | `spec:reviewed` | `/spec-review` |
| done | `spec:done` | `/spec-close` |

`spec:epic` is a **type marker**, not a lifecycle state. A completed epic may carry both `spec:epic` and `spec:done`.

State transitions should remove other non-epic lifecycle-state labels before applying the target state. Re-running `/spec-new` must not move a spec backwards from `in-progress`, `reviewed`, or `done` to `ready`.

## Parent/child and blockers

Relationships are stored as markdown links because native sub-issues are not relied on:

- child spec → `## Parent` link to epic;
- epic → `## Child spec issues` links to all children;
- child spec → `## Blocked by` links to sibling specs that must close first.

Parent/child structure and dependency/blocker structure are separate concepts.

## Branching and resume

Two branches drive the workflow:

- **Development branch** — `spec.baseBranch` in `.pi/settings.json`, defaulting to `development` (then the repository default). Spec branches are created from it and merged back into it by `/spec-close`.
- **Production branch** — `spec.releaseBranch` in `.pi/settings.json`, defaulting to `main` (then the repository default). Only `/spec-release` moves code here.

```text
development  ← spec/<issue-number>-<slug> branches (created by /spec-start,
               merged back by /spec-close)
      │
      ▼
main         ← /spec-release merges development → main, tags, releases
```

Implementation branch: `spec/<issue-number>-<slug>`, based on the development branch.

`/spec-start` is resumable:

- no branch → create from synced base;
- existing branch that clearly belongs to the spec → resume it;
- ambiguous same-named branch → refuse rather than overwrite/reset.

A missing configured base branch is an error; lifecycle commands never silently create it.

## Configuration

The lifecycle reads optional settings from `.pi/settings.json` in the target repository. Every key has a documented default, so a repository without the file still works. `/spec-init` generates and commits it; `scripts/spec/validate-settings.sh` validates it.

```json
{
  "spec": {
    "baseBranch": "development",
    "releaseBranch": "main",
    "tagPrefix": "v",
    "versionFile": "package.json",
    "changelogFile": "CHANGELOG.md",
    "decisionThreshold": 0.6,
    "checks": {
      "test": "npm test",
      "typecheck": "tsc --noEmit",
      "lint": "eslint .",
      "build": "npm run build"
    },
    "release": {
      "viaPullRequest": false,
      "draft": false,
      "bumpDevAfterRelease": true
    }
  }
}
```

| Key | Default | Used by |
|---|---|---|
| `baseBranch` | `development` (else repo default) | `/spec-start`, `/spec-close`, `/spec-review`, `/spec-release`, `/spec-status` |
| `releaseBranch` | `main` (else repo default) | `/spec-release`, `/spec-status` |
| `tagPrefix` | `v` | `/spec-release` |
| `versionFile` | none (auto-detect) | `/spec-release` |
| `changelogFile` | none (GitHub notes only) | `/spec-release` |
| `decisionThreshold` | `0.6` | `/spec-new` (graded interview: how much to ask) |
| `checks` | none (discover per run) | `/spec-review` |
| `release.viaPullRequest` | `false` | `/spec-release` (protected production branch) |
| `release.draft` | `false` | `/spec-release` |
| `release.bumpDevAfterRelease` | `true` | `/spec-release` |

## Releasing

`/spec-release` merges the development branch into the production branch and cuts a product release:

1. Resolves `spec.baseBranch` and `spec.releaseBranch`, syncing both.
2. Refuses when there is nothing to ship.
3. Proposes a semver bump (major/minor/patch) from the pending spec work and confirms it with the user.
4. Drafts release notes from the shipped `spec:done` issues since the last tag.
5. Merges development → production — directly, or via a pull request when `release.viaPullRequest` — tags `<tagPrefix><version>`, and creates the GitHub Release.

`/spec-release --dry-run` previews the whole plan without mutating anything. `/spec-close` only integrates into development; releasing is a separate, explicit step.

## Epic completion

Closing the last child does not silently close its epic. It reports that the epic is complete. Then:

```text
/spec-close #<epic>
```

verifies all children are done and closes the container explicitly, without any branch operations.

## Examples

Normal spec:

```text
/spec-new "Add CSV export"
→ Spec #120 (spec:ready)
/spec-start #120
/spec-review
/spec-close

# when enough work is on development to ship:
/spec-release
```

Epic:

```text
/spec-new "Rework content ingestion"
→ Epic #200
   → Spec #201 foundation
   → Spec #202 YouTube ingestion  blocked by #201
   → Spec #203 podcast ingestion  blocked by #201

/spec-start #201
/spec-review
/spec-close

/spec-start #202
...

# after all children are done
/spec-close #200
```

