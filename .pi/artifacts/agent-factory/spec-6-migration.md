# Problem Statement

Existing pi-config consumers must continue to work, and the current coding-agent setup must be expressible with the new approach — without hand-recreating project config and without maintaining two implementations indefinitely. This is the hard acceptance requirement.

# Solution

Implement `factory import <dir>`: read `.pi/settings.json` + `.pi/pi-config.json` (plus detected skills/agents/MCP), emit `system.yaml`, and scaffold native files — preserving everything that exists and flagging unsupported settings. Represent the coding-agent setup as a checked-in reference template (agents worker/scout/reviewer/oracle + orchestrator, model tiers, spec-lifecycle workflows, GitHub ops, checks, cost accounting via referenced pi-config skills). Implement the round-trip test as the principal acceptance test.

# User Stories

- An existing pi-config project imports without breaking; its spec lifecycle and subagent routing keep working.
- The coding-agent setup is recreatable from the factory (functionally equivalent, not necessarily structurally identical).
- Unsupported settings are flagged, never silently dropped.

# Implementation Decisions

- `import` is conservative: every existing file is preserved; only additive scaffolding plus a generated `system.yaml` are written; a report lists what was imported vs flagged.
- The coding-agent template is a checked-in fixture under `skills/agent-factory/templates/coding-agent/` (a `system.yaml` + authored files), reused by the round-trip test and by import.
- Spec-lifecycle skills are referenced (not copied) by generated projects; GitHub ops, checks, and cost accounting remain pi-config skills/scripts.
- The round-trip test is scripted (`skills/agent-factory/test/roundtrip.mjs` + `test.sh`): inventory → import → generate → verify (capabilities) → modify (builder) → verify preservation.

# Testing Decisions

- Seam: `import.mjs` (`settings.json` + `pi-config.json` → `system.yaml`) unit-tested, including unsupported-key flagging.
- Seam: template validity — `factory validate` passes on the coding-agent template; `factory generate` produces the expected native files.
- Round-trip e2e (the principal test): asserts essential capabilities (subagent routing resolution, spec skills present, checks runnable) survive import + regenerate + modify.

# Compatibility Implications

- No breaking changes; import is additive. Functional equivalence is the bar; internal structure may differ. Deferred items (fine-grained approval extensions, scheduled triggers) are recorded as deferred blockers, not silently dropped.

# Out of Scope

- Automated in-place rewrite of existing projects; migrating projects off pi-config entirely.

# Dependencies

- `agent-factory-builder`.
