# Problem Statement

A validated model is not yet a runnable project. The factory must turn a minimal `system.yaml` (an orchestrator + model routing) into a directory that actually launches under Pi and resolves the orchestrator as its primary interactive agent.

# Solution

Implement `factory generate <dir>` for the single-agent case: scaffold `.pi/settings.json` (model fragment + `defaultTools`), `.pi/APPEND_SYSTEM.md` (orchestrator instructions), `.pi/agents/` (empty), `.pi/mcp.json` (empty), `README.md`, `.gitignore`, `.env.example`, and `data/knowledge/.gitkeep`. Generation is idempotent and convergent; authored files are scaffolded only when absent; factory-owned files are regenerated while preserving unrelated keys (reusing the `generate-settings.mjs` merge). `--dry-run` prints the planned diff and writes nothing.

# User Stories

- I can generate a project from a minimal `system.yaml`, and `cd <dir> && pi -p "describe yourself"` reports the orchestrator as the primary agent.
- Re-running `generate` is a no-op; my edits to authored files survive.
- Unrelated keys I added to `.pi/settings.json` survive regeneration.
- `--dry-run` shows me exactly what would change before anything is written.

# Implementation Decisions

- **The orchestrator is the primary Pi session, not a `.pi/agents/` file.** Verified: Pi has no "primary agent" file or swap mechanism; `.pi/agents/*.md` define subagents only (pi-subagents `docs/agents.md`; `configuration.md`). The orchestrator is materialized as:
  - `.pi/APPEND_SYSTEM.md` ← `orchestrator.prompt` (its instructions). (`SYSTEM.md` would replace the whole system prompt, so `APPEND_SYSTEM.md` is the correct surface.)
  - `.pi/settings.json` ← `orchestrator.model` tier → `defaultProvider`/`defaultModel`/`defaultThinkingLevel`; `orchestrator.tools` → `defaultTools`.
- The generator is a pure function of `(system.yaml, existing files on disk)` with a deterministic file-write step; `--dry-run` prints the planned diff without writing.
- Ownership/enforcement per `docs/agent-factory.md` §C.6: derived files regenerate merge-preserving; authored files create-if-absent only, with content-fingerprint conflict detection (a file that differs from what the factory last wrote is never silently overwritten).
- The model fragment generation calls the existing `buildModelSettings`/`generateSettings` from `extensions/pi-config/generate-settings.mjs`.

# Testing Decisions

- Seam: `generateProject(model, existingFiles) -> {files: [{path, content, action}]}` in `generate.mjs`, unit-tested for fresh, idempotent, preserve-edit, merge-preserving, and conflict cases.
- Seam: golden-file test — a fixed `system.yaml` produces a fixed project tree.
- Seam: `factory generate --dry-run` exits 0 and writes nothing.
- End-to-end smoke (network-gated): generate into a temp dir, run `pi -p "..."`, and assert the orchestrator identity appears in output — in both interactive (`pi`) and headless (`pi -p`) configurations.
- Compatibility fixture smoke: `factory generate` on the `coding-agent` fixture produces the expected orchestrator surface (settings + `APPEND_SYSTEM.md`).

# Compatibility Implications

- The generated `.pi/settings.json` fragment stays compatible with pi-config's model generator (same keys), so a generated project can later be imported back (spec 6).
- No change to pi-config's own runtime behavior.

# Out of Scope

- Multiple agents, workflows, MCP servers, policy materialization, discovery, and the conversational builder.

# Dependencies

- `agent-factory-model` (schema + validator + compatibility fixture).
