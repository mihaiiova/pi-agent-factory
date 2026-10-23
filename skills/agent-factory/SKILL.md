---
name: agent-factory
description: Build or modify a Pi agent system from a plain-language outcome. Use when the user wants to create an agent system, describes a multi-agent workflow, or asks to configure/discover MCP servers, skills, or subagents for a generated project.
---

# Agent Factory

The Agent Factory turns a plain-language outcome into a standalone, project-local Pi
agent system, and later modifies that system conversationally. It is a
**conversational builder over the deterministic `factory` CLI** — the CLI is the
single source of truth for generation; this skill drives it.

Invoke with `/skill:agent-factory`, or describe an agent-system outcome ("I want an
SEO system", "set up a coding agent with a reviewer", …) and this skill routes here.

## Lifecycle

1. **Understand** — a graded interview (`spec.decisionThreshold` + `grill-me` /
   `grill-with-docs`). Ask only genuinely-required questions; never re-ask a fact
   the next step already answers.
2. **Discover** — run `factory discover`. Resolve discoverable facts (installed
   skills, MCP servers, subagents, CLIs) rather than asking.
3. **Design** — propose a system using the seven primitives (`orchestrator`,
   `models`, `agents`, `skills`, `integrations`, `workflows`, `policies`). Recommend
   at least one skill/MCP server — installed or not-installed — with install
   instructions when it is not already present.
4. **Generate** — write `system.yaml`, then **preview first**: run
   `factory generate <dir> --dry-run` and show the planned diff. Only apply after
   the user confirms.
5. **Configure** — help with credentials: env vars, `gh auth`, and MCP env vars.
   **Never write a secret into a committed file** — only `${ENV}` references and
   `.env.example` templates.
6. **Validate** — `factory validate <dir>`, then a headless smoke run
   (`pi -p "<workflow input>"`).
7. **Modify** — later sessions reopen the project, read `system.yaml`, preview with
   `factory modify <dir> --dry-run`, and apply only confirmed changes.

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
  proposes a diff. Preview every change before applying.

## Out of scope

Import/recreate of existing projects, scheduled triggers, and generated extension
code.
