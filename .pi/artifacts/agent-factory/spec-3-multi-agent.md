# Problem Statement

Real systems (e.g. the SEO example) need several cooperating agents and named workflows, not a single orchestrator. The factory must express and generate multi-agent systems with skill-based workflows, while preserving the architectural goal: **declarative workflow boundaries with dynamic agent decisions and delegation** — not a rigid DAG.

# Solution

Extend `system.yaml` (already carries `orchestrator`, `agents[]`, `skills[]`, `workflows[]`) and the generator to emit `.pi/agents/*.md` (specialist subagents with `tools:` allowlists), `.pi/skills/*/SKILL.md`, and workflow skills that orchestrate subagents via pi-subagents. A workflow **declares** purpose, inputs, entry agent, available specialists, output paths, approval boundary, and a completion/verification check; it does **not** prescribe every internal step. `trigger: {kind: manual}` maps to interactive `pi` and headless `pi -p`.

# User Stories

- I can define an orchestrator plus analyst/writer/researcher specialist agents and generate them.
- A workflow skill runs headlessly and writes its outputs under `data/`.
- The orchestrator delegates to specialist subagents with restricted tool allowlists.
- **SEO scenario:** the writer can request additional research when needed; the researcher maintains shared product knowledge independently; the analyst can identify opportunities without automatically triggering publication; the orchestrator can invoke workflows independently or combine them based on user intent.

# Implementation Decisions

- Agents materialize 1:1 to `.pi/agents/<name>.md` (frontmatter: `name`, `description`, `tools`, `model` tier, `thinking`, `inheritProjectContext`/`inheritSkills` as declared, `systemPrompt` = body). The orchestrator is the primary session (spec 2), not an agent file.
- A workflow is a skill (`skills/<workflow>/SKILL.md`) whose body is generated from the declared workflow plus authoring instructions to orchestrate via `subagent` (direct or `workflowScript`) **within** the declared boundaries. `agents[]` is the set of *available* specialists, not a fixed call sequence; the skill (and the agents it runs) decide internal steps. A simple fixed sequence is expressible as one workflow whose skill text says so, but DAG orchestration is not the default and no engine is built.
- Subagent model routing uses `models.subagents` → `subagents.agentOverrides` (existing generator).
- State/outputs: workflow skills write to declared `outputs` paths under `data/`; shared knowledge under `data/knowledge/` (the researcher owns it independently).
- Policy (coarse): agent `tools:` allowlists are the enforced boundary; approval requirements are declared and surfaced (spec 4 makes the enforced/advisory split explicit).

# Testing Decisions

- Seam: `generate.mjs` multi-agent case (N agents → N files, correct frontmatter) unit-tested.
- Seam: `workflowSkill.mjs` (declared workflow → SKILL.md body) unit-tested for deterministic output and for the presence of boundary fields (entry/inputs/outputs/approval/verify) without a hardcoded step graph.
- Headless smoke (network-gated): a 3-agent fixture system runs `pi -p "run <workflow>"` and produces an expected file under `data/`.
- SEO delegation test (model-gated, or asserted structurally where a model is unavailable): the generated workflow skill and agent prompts permit writer-initiated research, independent researcher knowledge updates, and analyst-without-publication; publication is gated behind the declared approval boundary.
- Round-trip-lite: modify one agent's prompt in the authored file, re-run `generate`, and assert the edit is preserved.

# Compatibility Implications

- Reuses pi-subagents (pinned) and the existing model-routing generator; no new runtime.
- Workflows are skills, so existing skill discovery (`enableSkillCommands`) surfaces them automatically.
- The `coding-agent` compatibility fixture's workflows (`spec-new`, `spec-start`, `spec-review`) are expressible with this boundary-only schema.

# Out of Scope

- MCP server discovery/configuration (spec 4); conversational builder (spec 5); import (spec 6); scheduled triggers; a workflow engine or DAG executor.

# Dependencies

- `agent-factory-scaffold`.
