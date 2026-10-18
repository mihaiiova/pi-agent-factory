---
name: workflow
description: Quick recap of the main pi-config skills — the spec lifecycle (/spec-new, /spec-start, /spec-review, /spec-close, /spec-release), the setup/dashboard skills (/spec-init, /spec-status), and the capture/discovery skills (/spec-draft, /spec-backlog, /spec-audit).
---

# Workflow

## Exploration

- `/explore [idea]` — start building and iterating freely, even in an empty directory. No required specs, GitHub setup, testing seams, TDD, or documentation. Mode persists per working directory until `/explore off`; `/explore status` inspects it.
- Follow the active exploration contract over formal process requirements. Leave it with `explore_mode` before entering formal delivery at the user's request.

## Capture & discovery

- `/spec-draft` — capture a shallow idea as one lightweight `idea` issue (no definition).
- `/spec-backlog` — review open issues against the code; recommend what product/project work to do next.
- `/spec-audit` — read-only technical-health audit; consolidates findings into prioritized technical initiatives.

## Spec lifecycle

- `/spec-init` — one-time setup: generate and commit `.pi/settings.json` (branch model, checks, versioning).
- `/spec-new` — define a normal spec or an epic of child specs; publish via the trusted plan applier.
- `/spec-start` — implement one spec with TDD (refuses epic containers).
- `/spec-review` — verify one implementation (tests, code-review, acceptance criteria).
- `/spec-close` — merge, close, clean up; updates parent-epic progress.
- `/spec-release` — merge the development branch into production and cut a tagged product release (`--dry-run` previews).
- `/spec-status` — read-only dashboard: branches, lifecycle states, blockers, releasable work.
- `/spec-cost` — report how much each spec skill cost (main agent + sub-agents).

See `docs/spec-lifecycle.md` for status labels, parent/child + blocker relationships, branch naming, the `.pi/settings.json` schema, and the two-branch (development → production) release model.

