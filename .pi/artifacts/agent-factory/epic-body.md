# Summary

Evolve `pi-config` into an **Agent Factory** — a conversational builder that turns a plain-language outcome into a standalone, project-local Pi agent system, and can later modify that system conversationally. This epic delivers the smallest MVP that (a) generates a useful independent agent system from a description and (b) demonstrates that today's pi-config coding-agent setup can be represented using the new approach.

The factory is an *additive* layer in pi-config: a deterministic `factory` CLI, a declarative `system.yaml` model, and an `agent-factory` skill. Generated projects are ordinary Pi projects — no factory runtime, no new orchestration engine.

# Goals

- A declarative system model (`system.yaml`) and validator (standard YAML parser, strict schema) for agent systems.
- A deterministic generator that materializes the model into native Pi files (`.pi/agents`, `.pi/skills`, `.pi/mcp.json`, `.pi/settings.json`, `APPEND_SYSTEM.md`) without overwriting user edits, with `--dry-run` preview and explicit conflict handling.
- Multi-agent systems with skill-based workflows — **declarative boundaries, dynamic delegation** — manual + headless (`pi -p`) execution.
- MCP/tool capability discovery and configuration, with policy split into **enforced** (least-privilege allowlists + hidden MCP tools) and **advisory** guidance.
- A conversational builder (interview → discover → recommend → generate → validate → modify).
- **Portable, self-contained-by-declaration** generated projects (pinned dependencies, no ambient global config, no vendoring).
- Import/recreate of the existing pi-config coding-agent setup, with a round-trip test and a clean-environment test.
- Both example systems (SEO, coding agent) expressible through general-purpose primitives.

# Non-goals

- No visual workflow editor, hosted management platform, general-purpose distributed scheduler, or autonomous self-improvement.
- No always-on runtime/daemon; no scheduled/webhook triggers in the MVP.
- No generated TypeScript extension code (declarative + skills only); no runtime permission engine.
- No new workflow engine — Pi's skill + pi-subagents orchestration is reused.

# Architecture / implementation direction

The durable analysis is `docs/agent-factory.md` (read it in a fresh session before starting any child). Confirmed decisions:

1. **Native `.pi/` is the single source of truth** — no `.pi-config/` directory; `system.yaml` lives inside `.pi/`.
2. **Manual + headless execution only** — scheduling is a declared extension point, deferred.
3. **Declarative + skills only** — the factory never generates TypeScript extension code in the MVP.

Verified mechanisms the design relies on:

- **The orchestrator is the primary Pi session**, shaped by `.pi/settings.json` (startup model + `defaultTools`) and `.pi/APPEND_SYSTEM.md` (instructions). `.pi/agents/*.md` are specialist *subagents*. Pi has no primary-agent file.
- **Enforced policy = least privilege, not a guard:** subagent `tools:` allowlists and MCP `toolExposure: hidden`; advisory policy = README/skill text. A runtime `tool_call`-guard extension is the deferred mechanism.
- **Portability = declared + pinned dependencies** (`git:...pi-config@<sha>` + npm packages + MCP servers in `.pi/settings.json` `packages`), not vendoring.
- `system.yaml` uses the established `yaml` package (v2.8.3), pinned in `pi.packages`.

Seven primitives map onto existing Pi mechanisms: Agent → `.pi/agents/*.md`; Skill → `SKILL.md`; Tool/MCP → `.pi/mcp.json` + `pi-mcp-adapter`; Workflow → a skill orchestrating subagents; Trigger → `trigger: {kind: manual}` + `pi -p`; State/Knowledge → `data/` + `.pi/state.json`; Policy → enforced allowlists/hidden tools + advisory guidance.

# Child specs

Ordered by dependency; each is independently deliverable and `/spec-start`-ready. **Compatibility is continuous:** spec 1 introduces the `coding-agent` compatibility fixture; each later spec extends what it reproduces; spec 6 runs the full round-trip + clean-environment tests.

1. `agent-factory-model` — schema + validator (standard YAML) + ownership/conflict contract + compatibility fixture.
2. `agent-factory-scaffold` — generate a runnable single-orchestrator project (primary session, not an agent file).
3. `agent-factory-multi-agent` — multi-agent systems + skill-based workflows (declared boundaries, dynamic delegation).
4. `agent-factory-integrations` — MCP/tool discovery, configuration, and enforced-vs-advisory policy.
5. `agent-factory-builder` — conversational build + modify (preview before apply).
6. `agent-factory-migration` — import/recreate pi-config + round-trip + clean-environment portability test.

The SEO example is the acceptance scenario for specs 3 + 4; the coding-agent example, round-trip, and clean-environment tests are the acceptance for spec 6.

# Completion criteria

- All six child specs merged to `development` with `spec:done`.
- `factory validate | generate | discover | import | modify` work and are unit-tested.
- The round-trip test passes (inventory → import → regenerate → verify → modify → verify).
- The clean-environment test passes (generate → isolate → install declared deps → run → verify orchestrator/agents/skills/workflows/integrations → run a workflow).
- The SEO and coding examples are representable and runnable from their own folders.
- `docs/agent-factory.md` remains the current architecture reference.
