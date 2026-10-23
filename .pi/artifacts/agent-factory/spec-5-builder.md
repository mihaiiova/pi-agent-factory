# Problem Statement

A CLI is not a product. The factory must be usable conversationally: understand a plain-language outcome, ask only genuinely-required questions, discover capabilities, recommend an architecture, generate, configure safely, validate, and later modify the system without clobbering user edits.

# Solution

Implement the `agent-factory` skill (in pi-config) that drives the lifecycle end to end, reusing the `spec-new` graded-interview convention (`spec.decisionThreshold` + `grill-me`), `factory discover`, and the generator. Add `factory modify <dir>`: diff the current project against the model, apply only confirmed changes, and preserve unrelated user edits. Provide safe credential setup guidance (env vars, `gh auth`, MCP env vars) that never writes secrets into committed files.

# User Stories

- "I want an SEO system; OpenSEO is on localhost:3002 …" → the builder produces the multi-agent + MCP project (specs 3 + 4) without me hand-writing config.
- A later session reopens the project, adds an agent, and an unrelated hand edit survives.
- The builder recommends at least one not-installed skill/MCP server when relevant, and configures credentials without committing secrets.

# Implementation Decisions

- The builder is a skill plus the existing CLI — no new extension required. `/skill:agent-factory` forces it; its description also routes factory/agent-system intents.
- The interview reuses the graded rubric and threshold already specified by `spec-new`; discoverable facts (from `factory discover`) are never asked.
- `factory modify` applies the ownership contract: derived files are regenerated merge-preserving; authored files receive proposed surgical diffs applied only after confirmation.
- The recommendation catalog is pi-config's own skills + integration skills + discovered MCP/CLIs; recommendations may name not-installed items with install instructions.

# Testing Decisions

- Seam: `modify.mjs` diff/apply logic unit-tested (add-agent, change-tier, preserve-unrelated-edit).
- Behavioral test (model-gated): a scripted prompt through the builder in a temp dir produces a project that passes `factory validate`.
- Skill contract asserted against source (existing pi-config convention): `SKILL.md` references `factory discover`/`generate`/`modify` and the interview threshold.

# Compatibility Implications

- Additive skill; no changes to existing lifecycle skills. As a pi-config skill, the builder distributes through the existing package/sync path.

# Out of Scope

- Import/recreate of existing projects (spec 6); scheduling; extension-code generation.

# Dependencies

- `agent-factory-multi-agent`, `agent-factory-integrations`.
