# Problem Statement

Real systems (e.g. the SEO example) need several cooperating agents and named workflows, not a single orchestrator. The factory must express and generate multi-agent systems with skill-based workflows and manual/headless execution.

# Solution

Extend `system.yaml` (already carries `agents[]`, `skills[]`, `workflows[]`) and the generator to emit `.pi/agents/*.md` (subagent roles with `tools:` allowlists), `.pi/skills/*/SKILL.md`, and workflow skills that orchestrate subagents via pi-subagents. Workflows are *declared* (inputs, trigger kind, participating agents, output paths) but *executed* as ordinary skills that call `subagent`. `trigger: {kind: manual}` maps to interactive `pi` and headless `pi -p`.

# User Stories

- I can define orchestrator + analyst + writer + researcher agents and generate them.
- A workflow skill runs headlessly and writes its outputs under `data/`.
- The orchestrator delegates to specialist subagents with restricted tool allowlists.

# Implementation Decisions

- Agents materialize 1:1 to `.pi/agents/<name>.md` (frontmatter: `name`, `description`, `tools`, `model` tier, `thinking`, `inheritProjectContext`/`inheritSkills` as declared, `systemPrompt` = body).
- A workflow is a skill (`skills/<workflow>/SKILL.md`) whose body is generated from the declared workflow plus authoring instructions to orchestrate via `subagent` (direct or `workflowScript`). It is authored content: the factory scaffolds it, and the user can edit it thereafter.
- Subagent model routing uses `models.subagents` → `subagents.agentOverrides` (existing generator).
- State/outputs: workflow skills write to declared `outputs` paths under `data/`; shared knowledge lives under `data/knowledge/`.
- Policy (coarse): agent `tools:` allowlists are the MVP boundary — an analyst gets read-only tools plus its MCP namespace; a publish-capable path is gated by `policies.approvals` surfaced in README and workflow instructions.

# Testing Decisions

- Seam: `generate.mjs` multi-agent case (N agents → N files, correct frontmatter) unit-tested.
- Seam: `workflowSkill.mjs` (declared workflow → SKILL.md body) unit-tested for deterministic output.
- Headless smoke (network-gated): a 3-agent fixture system runs `pi -p "run <workflow>"` and produces an expected file under `data/`.
- Round-trip-lite: modify one agent's prompt in the authored file, re-run `generate`, and assert the edit is preserved.

# Compatibility Implications

- Reuses pi-subagents (pinned) and the existing model-routing generator; no new runtime.
- Workflows are skills, so existing skill discovery (`enableSkillCommands`) surfaces them automatically.

# Out of Scope

- MCP server discovery/configuration (spec 4); conversational builder (spec 5); import (spec 6); scheduled triggers.

# Dependencies

- `agent-factory-scaffold`.
