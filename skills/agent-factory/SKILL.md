---
name: agent-factory
description: Build or modify a Pi agent system from a plain-language outcome. Use when the user wants to create an agent system, describes a multi-agent workflow, or asks to configure/discover MCP servers, skills, or subagents for a generated project.
---

# Agent Factory

The Agent Factory turns a plain-language outcome into a standalone, project-local Pi
agent system, and later modifies that system conversationally. It is a
**conversational builder over the deterministic `factory` CLI** — the CLI is the
single source of truth for generation; this skill drives it.

Invoke with `/agent-factory` (convenience alias), `/skill:agent-factory`, or describe an agent-system outcome ("I want an
SEO system", "set up a coding agent with a reviewer", …) and this skill routes here.

## Lifecycle

1. **Understand** — a graded interview (`spec.decisionThreshold` + `grill-me` /
   `grill-with-docs`). Ask only genuinely-required questions; never re-ask a fact
   the next step already answers. **Done when** the unresolved decisions fall below
   the threshold and the outcome is unambiguous enough to design against.
2. **Discover** — run `factory discover`. Resolve discoverable facts (installed
   skills, MCP servers, subagents, CLIs) rather than asking.
3. **Design** — propose a system using the seven primitives (`orchestrator`,
   `models`, `agents`, `skills`, `integrations`, `workflows`, `policies`). Recommend
   at least one skill/MCP server — installed or not-installed — with install
   instructions when it is not already present. The not-installed candidates come
   from `factory discover`'s `knownIntegrations` list minus what discovery already
   found installed.
4. **Generate** — write `system.yaml`, then **preview first**: run
   `factory generate <dir> --dry-run` and show the planned diff. Only apply after
   the user confirms. Generation also writes `.factory/capabilities.json` — the
   deterministic effective-capability manifest (orchestrator/subagent tools,
   skills, MCP servers + exclusions, packages) derived from `system.yaml`, used
   to inspect and cross-check the generated capability surface.
5. **Configure** — help with credentials: env vars, `gh auth`, and MCP env vars.
   **Never write a secret into a committed file** — only `${ENV}` references and
   `.env.example` templates. **Done when** every required credential is declared as
   a `${ENV}`/`.env.example` entry and no secret is committed.
6. **Validate** — `factory validate <dir>`, then a headless smoke run through
   the generated launcher (`./run -p "<workflow input>"`). The launcher is the
   canonical entry point and runs the system under its own isolated Pi config
   directory (`PI_CODING_AGENT_DIR=.factory/pi-home`), so the host's global
   skills/MCP/extensions/credentials are not inherited.
7. **Maintain** — every generated system bundles `/factory-update`, its thin
   skill/command and minimal standalone deterministic engine. Within `./run`, use
   `/factory-update <request>` to inspect/discover/preview a structured model
   change, `/factory-update apply` to confirm it, or `/factory-update review` for
   read-only recommendations. The operational loadout is not broadened. Changes
   go through `system.yaml`, never direct settings/MCP edits. CLI equivalents:
   `factory change <dir> --operations <json-file> --dry-run`, then `--yes` after
   approval. Existing `factory modify <dir> --dry-run` reconciliation is preserved.
8. **Upgrade tooling** — `/factory-update check|update|rollback` use pinned trusted
   Factory metadata, cached nonblocking startup discovery, staged exact revisions,
   explicit confirmation and retained offline rollback. No automatic activation,
   functional model change or global pi-config dependency. Restart after applying.
   Bootstrap older projects with `factory bootstrap-update <dir> --dry-run`, then
   `--yes`; conflicts/migrations must be resolved explicitly. See
   `../../docs/factory-update.md` for architecture, recovery and limitations.

## Policy and ownership contract

- **Enforced (cannot be bypassed):** agent `tools:` allowlists and MCP
  `excludeTools` — a child agent literally lacks unlisted tools, and a hidden MCP
  tool is registered but unreachable.
- **Advisory (guidance only):** README and workflow/skill prose stating approval
  requirements (e.g. "publishing requires human confirmation"). Prose is never
  mistaken for enforcement.
- **Ownership:** derived files (`.pi/settings.json`, `.pi/mcp.json`) regenerate
  merge-preserving; authored files (agents, skills, `APPEND_SYSTEM.md`, README,
  `.gitignore`, `.env.example`) are scaffold-once and fingerprint-protected. A user
  edit is **never silently overwritten** — the factory reports a conflict and
  proposes a diff.

## Out of scope

Recreating existing projects, scheduled triggers, and arbitrary generated
extension code. The small bundled maintenance loader is infrastructure, not an
operational extension-generation framework. `factory import` is preserved for
non-Factory projects; existing Factory projects use `bootstrap-update`.
