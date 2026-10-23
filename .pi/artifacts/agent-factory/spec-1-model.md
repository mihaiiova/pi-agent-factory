# Problem Statement

The Agent Factory needs a machine-readable, declarative description of an agent system — agents, skills, workflows, integrations, policies, and model routing — that the generator can materialize into native Pi files and the builder can read and modify. Today pi-config models only model tiers (`.pi/pi-config.json`). No schema, validator, or ownership contract exists for the rest of a system.

# Solution

Introduce `system.yaml` (schema v1) as the factory-owned declarative model, plus a deterministic `factory` CLI (Node ESM under `skills/agent-factory/factory.mjs`) with a `validate` command. The schema covers exactly the MVP primitives defined in `docs/agent-factory.md` §C.5: `models`, `agents`, `skills`, `integrations` (mcp + env), `workflows`, and `policies`. Define and document the ownership/edit-preservation contract (factory-owned vs derived vs authored vs mutable). Ship the schema + ownership contract as `skills/agent-factory/schema.md` and keep `docs/agent-factory.md` current.

# User Stories

- As a factory builder, I can validate a `system.yaml` and receive precise, actionable errors.
- As a maintainer, I can bump the schema version with a forward migration path.
- As a generated-project author, I know which files are safe to edit and which are factory-owned.

# Implementation Decisions

- YAML, with `schema: 1` at the top. Parsing uses a minimal, dependency-free subset consistent with pi-config's style (no heavyweight YAML library); reject unknown keys and malformed documents.
- The `factory` CLI is a Node ESM script invoked as `node <pi-config>/skills/agent-factory/factory.mjs <command>`; pure functions (`validate.mjs`, `migrate.mjs`) are separate modules for `node:test` coverage, mirroring `extensions/pi-config/generate-settings.mjs`.
- Ownership contract (documented in `schema.md`): `system.yaml` is factory-owned (user-editable, reconciled); derived files (`settings.json` model fragment, `mcp.json`) are factory-owned and regenerated merge-preserving; authored files (agents/skills/prompts/`APPEND_SYSTEM.md`/`README.md`/`.gitignore`/`.env.example`) are user-owned and scaffolded only when absent; mutable data (`data/`, `.env`, `.pi/state.json`, `.pi/sessions/`) is gitignored.
- The `models` → `.pi/settings.json` mapping reuses `extensions/pi-config/generate-settings.mjs` (`buildModelSettings`/`generateSettings`); do not fork it.

# Testing Decisions

- Seam: `validateSystem(doc) -> {ok, errors[]}` in `validate.mjs`, exercised with `node:test` over fixture files (valid + each invalid case).
- Seam: `factory validate` CLI exit codes (0 valid / 1 invalid) via a bash harness.
- Seam: `migrate(doc)` schema-version migration tested with a v0→v1 fixture.
- Fixtures live under `skills/agent-factory/test/fixtures/`; tests run via a `skills/agent-factory/test/test.sh` wrapper matching repository convention.

# Compatibility Implications

- Purely additive: no change to existing extensions or skills. Reusing the existing model generator keeps generated `.pi/settings.json` compatible with `pi-config`.
- `system.yaml` is committed only inside generated projects; pi-config itself gains the `factory` CLI + skill (new, additive).

# Out of Scope

- Generation (`generate`), discovery (`discover`), import, and the conversational builder — covered by later specs.
- Any runtime behavior; this spec is model + validation only.

# Dependencies

None.
