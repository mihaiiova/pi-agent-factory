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

1. **Understand** — interview for the outcome: what the system must achieve, which
   distinct roles it needs, and what each role may touch. Ask only genuinely-required
   questions, one decision at a time; never re-ask a fact the next step already
   answers. **Done when** the outcome is unambiguous enough to design against.
2. **Discover** — run `factory discover`. It reports the machine's full Pi model
   line-up (`models`, from `pi --list-models`), the user's own installed skills,
   MCP servers and subagents. It knows no CLIs of its own: when the user names
   command-line tools the system will use, add `--cli <name>` for each to check
   they are installed. Resolve discoverable facts rather than asking.
3. **Design** — define the system from zero using the seven primitives
   (`orchestrator`, `agents`, `skills`, `integrations`, `workflows`, `policies`,
   `packages`).
   - **Models:** the factory ships no default models. For the orchestrator and
     for each subagent, ask which model to use, offering the entire discovered
     line-up, and record it as `model: provider/id` (plus an optional
     `thinking:` level) on that agent. Agents may share a model or each use a
     different one. Any model can be changed later (step 7).
   - **Skills:** the factory ships no skills and never recommends one unprompted.
     Use only skills the user asks for or provides: an inline `body` they
     describe, a pinned package (`source: npm:<name>@<version>` or
     `git:<repo>@<ref>`), or a directory they point at (`source: ./path`,
     `../path`, `/abs/path` or `~/path`), which is vendored into
     `.pi/skills/<name>/`. Attach skills to the agents that need them with
     `agents[].skills`.
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
   read-only recommendations. Switch any agent's model with an `assign`
   operation (`{"op":"assign","name":"<agent>","model":"provider/id"}`). The
   operational loadout is not broadened. Changes
   go through `system.yaml`, never direct settings/MCP edits. CLI equivalents:
   `factory change <dir> --operations <json-file> --dry-run`, then `--yes` after
   approval. Existing `factory modify <dir> --dry-run` reconciliation is preserved.
8. **Upgrade tooling** — `/factory-update check|update|rollback` use pinned trusted
   Factory metadata, cached nonblocking startup discovery, staged exact revisions,
   explicit confirmation and retained offline rollback. No automatic activation,
   functional model change or dependency on the global Agent Factory install. Restart after applying.
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
