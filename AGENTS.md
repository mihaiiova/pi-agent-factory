# Pi Configuration

Shared pi configuration lives in the `pi-config` repo — a git-backed pi package synced across machines. The repo has no fixed path; each machine clones it where convenient. This file is symlinked from `~/.pi/agent/AGENTS.md`.

See [README.md](README.md) for the full structure and setup guide.

## Spec lifecycle

Use the formal spec lifecycle when explicitly requested. It is not a prerequisite for every coding task.

## Exploration

`/explore [idea]` enables rapid conversational building, including in an empty directory. `/explore status` inspects it; `/explore off` leaves it. The `explore_mode` tool also supports natural-language entry/exit. Mode state is local to the working directory and survives new sessions, reloads, resume, and compaction.

While exploration is active (or a delegated task explicitly carries `[pi-config exploration mode]`), its workflow contract takes precedence over formal development-process requirements in this guidance and other loaded skills. Missing Git/GitHub setup, issues, specs, ADRs, project configuration, testing seams, interviews, TDD, documentation, delegation, or branch setup must never block exploration. Make reasonable reversible assumptions and build the smallest useful runnable version. Test when useful; report unrelated check failures without blocking iteration. Protect existing work and preserve secrets, permission boundaries, and read-only roles; do not bypass security controls or assume authorization to merge, deploy, publish, or destroy data.

Carry the exploration contract into every delegated task, including fresh-context children. Existing role/access limits still apply. Keep process lightweight; no mandatory notes or checkpoint ritual. When the user explicitly requests formal delivery, turn exploration off before entering that workflow and assess the prototype for remaining work rather than assuming a rewrite.

## Formal delivery

Take work from idea to merged branch. Discover with `/spec-backlog` (product work) and `/spec-audit` (technical work), then define with `/spec-new` (normal spec or epic), implement with `/spec-start`, verify with `/spec-review`, and integrate with `/spec-close`. Status persists as a GitHub label (`spec:epic`, `spec:ready`, `spec:in-progress`, `spec:reviewed`, `spec:done`). See [docs/spec-lifecycle.md](docs/spec-lifecycle.md) for the full vocabulary, epic structure, and branch/base-branch conventions.

## Creating new extensions or skills

Place new extensions in `<pi-config>/extensions/<name>/` and new skills in `<pi-config>/skills/<name>/`. Pi auto-discovers both. Run `/reload` to pick up new additions.

## Keeping in sync

Run `/pi-sync` from any pi session. On a clean repository it handles git push/pull, installs pinned packages from `pi.packages`, and asks about extras. If the repository is dirty, the TUI lists the changes and requires confirmation before committing and syncing. The non-interactive `pi_sync` tool refuses dirty repositories and reports the files; it never commits them. Then `/reload`.

Or manually:

```bash
cd <pi-config> && git status --short
git add <reviewed-files> && git commit -m "..." && git push
# On the other machine: /pi-sync
```

Keep every npm entry in `package.json` under `pi.packages` pinned as `npm:<name>@<version>`; do not add floating package specs.

