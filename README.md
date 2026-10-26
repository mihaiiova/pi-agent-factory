# pi-config — Agent Factory

This repository is becoming the **Agent Factory**: a conversational builder that
defines a standalone, project-local Pi agent system from zero — its orchestrator,
specialist subagents, skills, MCP integrations, workflows and policies — and
maintains it afterwards. The personal Pi setup that still lives here (spec
lifecycle, domain skills, sync/state extensions) is moving to a separate
repository; see [Personal Pi setup](#personal-pi-setup-moving-out).

## Agent Factory

Start it from any Pi session with `/agent-factory <outcome>` (or
`/skill:agent-factory`). The builder interviews you, runs `factory discover`,
designs a `.pi/system.yaml`, previews the generated files and applies them only
after you confirm. The deterministic CLI behind it:

```sh
node skills/agent-factory/factory.mjs discover [dir]          # models, your skills, MCP, CLIs
node skills/agent-factory/factory.mjs validate <dir>
node skills/agent-factory/factory.mjs generate <dir> --dry-run  # then without --dry-run
node skills/agent-factory/factory.mjs modify <dir> --dry-run
```

### Models: chosen per agent

Nothing is hardcoded. Every agent — the orchestrator and each subagent — names
its own model from the machine's Pi line-up (`pi --list-models`, also reported by
`factory discover`), with an optional thinking level. Agents may share a model or
each use a different one, and any model can be changed later.

### Skills: only the ones you ask for or provide

The factory ships no skills and recommends none unprompted. A skill is authored
inline, comes from a pinned package, or is vendored from a directory you point
at, and each agent lists the skills it receives:

```yaml
schema: 1
name: research-desk
orchestrator:
  name: lead
  model: openai-codex/gpt-6-sol
  thinking: medium
  tools: [read, grep, subagent]
agents:
  - name: researcher
    model: deepseek/deepseek-flash
    thinking: high
    tools: [read, grep]
    skills: [notes, house-style]
skills:
  - name: notes
    source: ../my-skills/notes            # vendored into .pi/skills/notes/ once
  - name: house-style
    source: npm:@acme/house-style@1.2.0   # pinned package, added to runtime packages
```

See [`schema.md`](skills/agent-factory/schema.md) for every field, validation
rule and the file-ownership contract, and [docs/agent-factory.md](docs/agent-factory.md)
for the architecture.

### Running and maintaining a generated system

A generated project starts with `./run`, which isolates it from your global Pi
configuration (own config dir, own credentials: `/login` once per project).
Inside it, `/factory-update <request>` previews declarative changes —
including switching an agent's model — and `/factory-update apply` confirms
them.

On every start, `./run` checks in the background whether a newer Factory
revision exists, by comparing the git commit the project was generated from
with the `development` branch on GitHub. A notice appears only when an update
is available, or — at most once a day — when the check keeps failing for a
reason other than being offline (for example, the project was generated from a
commit that was never pushed). Updates install only via `/factory-update update`.

Generate real systems from pushed commits on `development`; a project stamped
with an unpushed or unmerged commit cannot be compared. Bootstrap older
generated systems without recreating them:

```sh
node skills/agent-factory/factory.mjs bootstrap-update /path/to/agent --dry-run
node skills/agent-factory/factory.mjs bootstrap-update /path/to/agent --yes
```

See [Factory maintenance](docs/factory-update.md) for update checks, security
boundaries, installation metadata, recovery and rollback.

### Tests

```sh
bash skills/agent-factory/test/test.sh
```

## Personal Pi setup (moving out)

The rest of this repository is the author's personal Pi setup. It will move to
its own repository; a new development-workflow integration will then be built
from scratch with the Agent Factory rather than converted. Until then it keeps
working as before.

```
pi-config/
├── extensions/        # Custom TypeScript extensions
│   ├── agent-factory/ #   /agent-factory — convenience alias for the builder skill
│   ├── explore/       #   /explore — persistent exploration mode
│   ├── pi-config/     #   /pi-config — model tiers for this personal setup
│   ├── pi-sync/       #   /pi-sync — git push/pull + reconcile packages
│   ├── project-state/ #   /session-status, /session-history, /session-cost
│   ├── save-md/       #   /save-md — save the last response as markdown
│   ├── skills-select/ #   /skills-select — per-project skill allowlist
│   └── startup-check/ #   pi-config drift detection at session start
├── scripts/spec/      # Deterministic helpers shared by the spec-* skills
├── skills/            # Agent skills (SKILL.md directories), incl. agent-factory
├── tests/             # Tests for the extensions and spec scripts
└── package.json       # Pi manifest + pinned package list (pi.packages)
```

The `spec-*` skills call shared helpers in `scripts/spec/` (GitHub plan
application, check runner, settings validation, trivial-spec routing). Because
they live at this repository's root, those skills cannot be vendored into a
generated system on their own; that coupling is one reason the setup moves out.

### Spec lifecycle

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
- `/session-cost` — current, recent, and project-aggregate known main-agent + subagent cost, with coverage gaps.

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

### How packages work

Packages are tracked as exact `npm:<name>@<version>` specs in `package.json` under `pi.packages` and installed globally on each machine via `pi install`. They live in `~/.pi/agent/npm/`, **not** in pi-config's `node_modules/`. This avoids duplicate-loading conflicts and makes a pi-config commit reproduce the same package versions on every machine. Package upgrades are deliberate edits to the pinned versions.

`/pi-sync` reconciles the list against what's installed:
- Packages in `pi.packages` but not installed → auto-installs
- Packages installed but not in `pi.packages` → asks which to keep/remove
- Then runs `pi update --extensions`

### Setup on a new machine

```bash
git clone <remote-url> /path/to/pi-config
pi install /path/to/pi-config
```

Then run `/pi-sync` to install all listed packages. Then `/reload`.

### Day-to-day: syncing

Run **`/pi-sync`** from any pi session. It handles:

1. Syncs a clean repository with `git fetch` + `git pull --rebase` + `git push`
2. Installs any new packages added to `pi.packages`
3. Asks about packages installed locally but not in the list
4. `pi update --extensions`

When local changes exist, the TUI lists every dirty entry and asks whether to **commit all listed changes and sync**. Cancelling leaves the working tree untouched. The non-interactive `pi_sync` tool never commits local changes: it refuses to sync and reports the dirty entries so they can be reviewed first.

If merge conflicts: resolve manually in your pi-config repo, then re-run `/pi-sync`.

After syncing, `/reload` to pick up new or changed extensions.

### Adding a new npm package

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

### Adding a new custom extension or skill

Place it in the appropriate directory:

- `extensions/<name>/index.ts` for extensions
- `skills/<name>/SKILL.md` for skills

Commit, push, `/pi-sync` on the other machine, `/reload`.


### Cost accounting

`/session-cost`, `/spec-cost`, and `/spec-close` use one shared observation ledger. Reports count the active conversation branch, deduplicate fork ancestry, and assign subagent costs through explicit ownership links. Unavailable prices remain unknown; partial coverage is shown with the known subtotal. Resuming a native session appends an immutable snapshot revision rather than freezing its first recorded cost or adding cumulative snapshots together.

```text
/session-cost
/spec-cost
/spec-close #42
```

For one spec or an epic's children, the same engine is available directly:

```bash
node <pi-config>/skills/spec-cost/cost.mjs --cwd /path/to/product --spec 42
node <pi-config>/skills/spec-cost/cost.mjs --cwd /path/to/product --spec 201 --spec 202 --json
```

The previous `python3 <pi-config>/skills/spec-cost/cost.py ...` invocation forwards the same flags to Node. Historical records are retained, but ambiguous legacy aggregates are not presented as verified spending when their raw evidence is unavailable. See [project-state accounting](extensions/project-state/README.md#accounting-and-resumed-sessions) for coverage and snapshot semantics.

