# Problem Statement

Existing pi-config consumers must continue to work, the current coding-agent setup must be expressible with the new approach, and generated projects must be genuinely portable to another machine — not only work because a development machine happens to have globally installed skills, scripts, MCP servers, or configuration. This is the hard acceptance requirement.

# Solution

Implement `factory import <dir>`: read `.pi/settings.json` + `.pi/pi-config.json` (plus detected skills/agents/MCP), emit `system.yaml`, and scaffold native files — preserving everything that exists and flagging unsupported settings. Make generated projects **self-contained by declaration**: all project-specific content in `.pi/`, and every external dependency declared and pinned in `.pi/settings.json` `packages` — `git:github.com/mihaiiova/pi-config@<commit-sha>` (providing the shared spec-lifecycle skills, scripts, and extensions) plus the npm packages the project uses and its MCP servers. Implement the round-trip test and the clean-environment test.

# User Stories

- An existing pi-config project imports without breaking; its spec lifecycle and subagent routing keep working.
- The coding-agent setup is recreatable from the factory (functionally equivalent, not necessarily structurally identical), with no copying of pi-config internals into the project.
- Unsupported settings are flagged, never silently dropped.
- A generated project runs on a clean machine after installing its declared dependencies — no reliance on ambient global config.

# Implementation Decisions

- `import` is conservative: every existing file is preserved; only additive scaffolding plus a generated `system.yaml` are written; a report lists what was imported vs flagged.
- **Portability by declaration (not vendoring):** the factory pins `git:github.com/mihaiiova/pi-config@<sha>` (from `git rev-parse HEAD`) and the npm packages from pi-config's own `pi.packages` into the generated project's `packages`. Nothing is copied out of pi-config (avoids a second, independently maintained implementation); nothing depends on ambient global config.
- The coding-agent template is a checked-in fixture under `skills/agent-factory/templates/coding-agent/` (a `system.yaml` + authored files), reused by the round-trip, clean-environment, and import tests.
- Spec-lifecycle skills, GitHub ops, checks, and cost accounting are provided by the pinned pi-config package dependency (preserved, not duplicated) and declared as `workflows[]`.
- The round-trip test is scripted (`skills/agent-factory/test/roundtrip.mjs` + `test.sh`): inventory → import → generate → verify → modify → verify preservation.

# Testing Decisions

- Seam: `import.mjs` (`settings.json` + `pi-config.json` → `system.yaml`) unit-tested, including unsupported-key flagging.
- Seam: `deps.mjs` (project → pinned `packages` declaration) unit-tested: emits `git:...@<sha>` + npm pins; never emits a local-path dependency or a literal secret.
- Template validity: `factory validate` passes on the coding-agent template; `factory generate` produces the expected native files.
- **Clean-environment acceptance test:** generate a representative coding-agent system → copy it into an isolated environment with no undeclared global config → install its declared dependencies → `cd <dir> && pi` → verify the orchestrator, agents, skills, workflows, and integrations resolve → run a representative workflow and verify behavior.
- Round-trip e2e (principal test): asserts essential capabilities (subagent routing resolution, spec skills present, checks runnable) survive import + regenerate + modify.

# Compatibility Implications

- No breaking changes; import is additive. Functional equivalence is the bar; internal structure may differ. Deferred items (runtime approval extensions, scheduled triggers) are recorded as deferred blockers, not silently dropped. Any capability that cannot be made portable in MVP is an explicit recorded gap with adjusted acceptance criteria — never a silently weakened promise.

# Out of Scope

- Automated in-place rewrite of existing projects; migrating projects off pi-config entirely; vendoring third-party packages into generated projects.

# Dependencies

- `agent-factory-builder`.
