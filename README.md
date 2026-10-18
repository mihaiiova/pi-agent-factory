# pi-config

Shared pi configuration — extensions, skills, prompts, and themes synced across machines via git. Package dependencies are tracked as a list and installed globally via `pi install`.

## Structure

```
pi-config/
├── extensions/       # Custom TypeScript extensions
│   ├── pi-sync/      #   /pi-sync — git push/pull + reconcile packages
│   ├── pi-config/    #   /pi-config — model tiers, subagent routing, spec setup
│   ├── project-state/#   /session-status, /session-history, /session-cost — local resume context + session history
│   └── skills-select/ #  /skills-select — per-project skill allowlist
├── skills/           # Agent skills (SKILL.md directories)
├── prompts/          # Prompt templates (.md)
├── themes/           # Theme files (.json)
└── package.json      # Pi manifest + package list (pi.packages)
```

## Spec lifecycle

For a new project or uncertain feature, start with `/explore <idea>` and iterate through normal conversation. No GitHub repository, issue, spec, project setup, or TDD is required. The agent makes reversible assumptions and builds the smallest useful version you can try. `/explore` (or `/explore on`) enables the mode without starting work; `/explore status` inspects it; `/explore off` leaves it. Ask naturally to leave exploration or formalize the prototype; the agent can use `explore_mode` to switch.

Exploration overrides formal workflow prerequisites, including for delegated work, while preserving existing-work protection, read-only roles, and permission boundaries. Direct and scripted `pi-subagents` launches receive the exploration contract; inferred acceptance gates are disabled, while explicitly supplied verification gates remain intact. State is stored in `.pi/explore.json` in the working directory, independent of Git and project configuration, and applies to subsequent sessions in that directory until disabled. Reload/resume and compaction retain the mode. Other directories are unaffected. If the directory cannot be written, the mode remains available in the current session and its persisted session entries, with a warning that directory-wide persistence failed.

When adopting Git, ignore `.pi/explore.json` as local runtime data. No exploration note, branch, issue, or project scaffolding is created just to enter the mode. A useful prototype may be kept, discarded, or formalized into the remaining delivery work.

Then use the formal lifecycle when the direction is ready:

One-time setup and a live dashboard frame the lifecycle, with spec work landing on a **development** branch and a dedicated release step promoting it to **production**:

- `/spec-init` — generate or reconcile and commit `.pi/settings.json` (branch model, checks, versioning) for a repository.
- `/spec-draft` — capture a shallow idea as one lightweight `idea` issue, without defining it.
- `/spec-backlog` — review open issues against the code and recommend what product/project work to do next.
- `/spec-audit` — read-only technical-health audit that consolidates findings into prioritized technical initiatives.
- `/spec-new` — define a **normal spec** or an **epic** of child specs; publishes via the trusted plan applier.
- `/spec-start` — implement one spec with TDD (refuses epic containers).
- `/spec-review` — verify one implementation.
- `/spec-close` — merge, close, clean up; updates parent-epic progress.
- `/spec-release` — merge the development branch into production and cut a tagged product release.
- `/spec-status` — read-only dashboard: branches, lifecycle states, blockers, releasable work.
- `/spec-cost` — report how much each spec skill cost (main agent + sub-agents).
- `/session-status` — current local resume projection (branch/spec/phase) and session cost.
- `/session-history` — recent finalized session records (date, spec, workflow, delegation roles, cost).
- `/session-cost` — current, recent, and project-aggregate known session cost.

Example (normal):

```text
/spec-new "Add CSV export"      → Spec #120
/spec-start #120
/spec-review
/spec-close

# when enough work is on development to ship:
/spec-release
```

Example (epic):

```text
/spec-new "Rework content ingestion"
→ Epic #200
   → Spec #201
   → Spec #202 (blocked by #201)
   → Spec #203 (blocked by #201)

/spec-start #201   … /spec-close
/spec-start #202   …
```

`/spec-start` cannot start an epic directly. Spec branches are based on and merged into the **development** branch (`spec.baseBranch`, default `development`); `/spec-release` merges development into the **production** branch (`spec.releaseBranch`, default `main`) and cuts the release. `/spec-init` generates the `.pi/settings.json` holding these (plus `checks`, versioning, and release preferences). See [docs/spec-lifecycle.md](docs/spec-lifecycle.md) for status labels, parent/child and blocker relationships, branch naming, and the full configuration schema.

## How packages work

Packages are tracked as exact `npm:<name>@<version>` specs in `package.json` under `pi.packages` and installed globally on each machine via `pi install`. They live in `~/.pi/agent/npm/`, **not** in pi-config's `node_modules/`. This avoids duplicate-loading conflicts and makes a pi-config commit reproduce the same package versions on every machine. Package upgrades are deliberate edits to the pinned versions.

`/pi-sync` reconciles the list against what's installed:
- Packages in `pi.packages` but not installed → auto-installs
- Packages installed but not in `pi.packages` → asks which to keep/remove
- Then runs `pi update --extensions`

## Setup on a new machine

```bash
git clone <remote-url> /path/to/pi-config
pi install /path/to/pi-config
```

Then run `/pi-sync` to install all listed packages. Then `/reload`.

## Day-to-day: syncing

Run **`/pi-sync`** from any pi session. It handles:

1. Syncs a clean repository with `git fetch` + `git pull --rebase` + `git push`
2. Installs any new packages added to `pi.packages`
3. Asks about packages installed locally but not in the list
4. `pi update --extensions`

When local changes exist, the TUI lists every dirty entry and asks whether to **commit all listed changes and sync**. Cancelling leaves the working tree untouched. The non-interactive `pi_sync` tool never commits local changes: it refuses to sync and reports the dirty entries so they can be reviewed first.

If merge conflicts: resolve manually in your pi-config repo, then re-run `/pi-sync`.

After syncing, `/reload` to pick up new or changed extensions.

## Adding a new npm package

```bash
pi install npm:<package-name>@<version>
```

Then add that exact version to `pi.packages` in `package.json`:

```json
"pi": {
  "packages": [
    "npm:pi-mcp-adapter@2.32.1",
    "npm:<new-package>@<version>"
  ]
}
```

Commit, push. On the other machine, `/pi-sync` will pick it up.

## Adding a new custom extension or skill

Place it in the appropriate directory:

- `extensions/<name>/index.ts` for extensions
- `skills/<name>/SKILL.md` for skills

Commit, push, `/pi-sync` on the other machine, `/reload`.

