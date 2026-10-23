# Summary

Evolve `pi-config` into an **Agent Factory** — a conversational builder that turns a plain-language outcome into a standalone, project-local Pi agent system, and can later modify that system conversationally. This epic delivers the smallest MVP that (a) generates a useful independent agent system from a description and (b) demonstrates that today's pi-config coding-agent setup can be represented using the new approach.

The factory is an *additive* layer in pi-config: a deterministic `factory` CLI, a declarative `system.yaml` model, and an `agent-factory` skill. Generated projects are ordinary Pi projects — no factory runtime, no new orchestration engine.

# Goals

- A declarative system model (`system.yaml`) and validator for agent systems.
- A deterministic generator that materializes the model into native Pi files (`.pi/agents`, `.pi/skills`, `.pi/mcp.json`, `.pi/settings.json`, `APPEND_SYSTEM.md`) without overwriting user edits.
- Multi-agent systems with skill-based workflows, manual + headless (`pi -p`) execution.
- MCP/tool capability discovery and configuration, with coarse policy (tool allowlists + approval boundaries).
- A conversational builder (interview → discover → recommend → generate → validate → modify).
- Import/recreate of the existing pi-config coding-agent setup, with a round-trip acceptance test.
- Both example systems (SEO, coding agent) expressible through general-purpose primitives.

# Non-goals

- No visual workflow editor, hosted management platform, general-purpose distributed scheduler, or autonomous self-improvement.
- No always-on runtime/daemon; no scheduled/webhook triggers in the MVP.
- No generated TypeScript extension code (declarative + skills only).
- No new workflow engine — Pi's skill + pi-subagents orchestration is reused.

# Architecture / implementation direction

The durable analysis is `docs/agent-factory.md` (read it in a fresh session before starting any child). Confirmed decisions:

1. **Native `.pi/` is the single source of truth** — no `.pi-config/` directory; `system.yaml` lives inside `.pi/`.
2. **Manual + headless execution only** — scheduling is a declared extension point, deferred.
3. **Declarative + skills only** — the factory never generates TypeScript extension code in the MVP.

Seven primitives map onto existing Pi mechanisms: Agent → `.pi/agents/*.md`; Skill → `SKILL.md`; Tool/MCP → `.pi/mcp.json` + `pi-mcp-adapter`; Workflow → a skill orchestrating subagents; Trigger → `trigger: {kind: manual}` + `pi -p`; State/Knowledge → `data/` + `.pi/state.json`; Policy → subagent `tools:` allowlists + tool annotations + acceptance gates.

# Child specs

Ordered by dependency; each is independently deliverable and `/spec-start`-ready:

1. `agent-factory-model` — schema + validator + ownership contract.
2. `agent-factory-scaffold` — generate a runnable single-agent project.
3. `agent-factory-multi-agent` — multi-agent systems + skill-based workflows.
4. `agent-factory-integrations` — MCP/tool discovery, configuration, policy.
5. `agent-factory-builder` — conversational build + modify.
6. `agent-factory-migration` — import/recreate pi-config + round-trip test.

The SEO example is the acceptance scenario for specs 3 + 4; the coding-agent example and round-trip are the acceptance for spec 6.

# Completion criteria

- All six child specs merged to `development` with `spec:done`.
- `factory validate | generate | discover | import | modify` work and are unit-tested.
- The round-trip test passes (inventory → import → regenerate → verify → modify → verify).
- The SEO and coding examples are representable and runnable from their own folders.
- `docs/agent-factory.md` remains the current architecture reference.
