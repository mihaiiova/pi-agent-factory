# Problem Statement

A validated model is not yet a runnable project. The factory must turn a minimal `system.yaml` (a single orchestrator agent + model routing) into a directory that actually launches under Pi and resolves the orchestrator as its primary agent.

# Solution

Implement `factory generate <dir>` for the single-agent case: scaffold `.pi/settings.json` (model fragment), `.pi/agents/<orchestrator>.md`, `.pi/APPEND_SYSTEM.md`, `.pi/mcp.json` (empty), `README.md`, `.gitignore`, `.env.example`, and `data/knowledge/.gitkeep`. Generation is idempotent and convergent: authored files are scaffolded only when absent; factory-owned files are regenerated while preserving unrelated keys (reusing the `generate-settings.mjs` merge).

# User Stories

- I can generate a project from a minimal `system.yaml`, and `cd <dir> && pi -p "describe yourself"` reports the orchestrator as the primary agent.
- Re-running `generate` is a no-op; my edits to authored files survive.
- Unrelated keys I added to `.pi/settings.json` survive regeneration.

# Implementation Decisions

- The generator is a pure function of `(system.yaml, existing files on disk)` with a deterministic file-write step; `--dry-run` prints the planned diff without writing.
- Ownership enforcement per `docs/agent-factory.md` §C.6: derived files regenerate merge-preserving; authored files create-if-absent only.
- The `orchestrator` agent is materialized as `.pi/agents/<name>.md` (frontmatter `name`, `description`, `tools`, `model` tier, `thinking`, `systemPrompt` = body). Its primary-role status is expressed through `.pi/APPEND_SYSTEM.md` (instructing the interactive session to operate as the orchestrator) — not through a new Pi setting.
- The model fragment generation calls the existing `buildModelSettings`/`generateSettings` from `extensions/pi-config/generate-settings.mjs`.

# Testing Decisions

- Seam: `generateProject(model, existingFiles) -> {files: [{path, content, action}]}` in `generate.mjs`, unit-tested for fresh, idempotent, preserve-edit, and merge-preserving cases.
- Seam: golden-file test — a fixed `system.yaml` produces a fixed project tree.
- Seam: `factory generate --dry-run` exits 0 and writes nothing.
- End-to-end smoke (network-gated): generate into a temp dir, run `pi -p "..."`, and assert the orchestrator identity appears in output.

# Compatibility Implications

- The generated `.pi/settings.json` fragment stays compatible with pi-config's model generator (same keys), so a generated project can later be imported back (spec 6).
- No change to pi-config's own runtime behavior.

# Out of Scope

- Multiple agents, workflows, MCP servers, policy materialization, discovery, and the conversational builder.

# Dependencies

- `agent-factory-model` (schema + validator).
