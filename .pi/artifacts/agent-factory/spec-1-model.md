# Problem Statement

The Agent Factory needs a machine-readable, declarative description of an agent system — orchestrator, agents, skills, workflows, integrations, policies, and model routing — that the generator can materialize into native Pi files and the builder can read and modify. Today pi-config models only model tiers (`.pi/pi-config.json`). No schema, validator, or ownership contract exists for the rest of a system.

# Solution

Introduce `system.yaml` (schema v1) as the factory-owned declarative model, plus a deterministic `factory` CLI (Node ESM under `skills/agent-factory/factory.mjs`) with a `validate` command. The schema covers exactly the MVP primitives defined in `docs/agent-factory.md` §C.5: `orchestrator`, `models`, `agents`, `skills`, `integrations` (mcp + env), `workflows`, and `policies` (enforced + advisory). Define and document the ownership/edit-preservation contract. Ship the schema + ownership contract as `skills/agent-factory/schema.md` and keep `docs/agent-factory.md` current.

# User Stories

- As a factory builder, I can validate a `system.yaml` and receive precise, actionable errors.
- As a maintainer, I can bump the schema version with a forward migration path.
- As a generated-project author, I know which files are safe to edit and which are factory-owned, and what happens on conflict.
- As a maintainer, a `coding-agent` compatibility fixture gates schema changes (see Compatibility).

# Implementation Decisions

- **YAML parser: use the established `yaml` package (v2.8.3)** — not a hand-rolled subset. It is already a dependency of the pinned `pi-subagents` package; pin it explicitly in pi-config's `pi.packages` as `npm:yaml@2.8.3`. `factory.mjs` resolves it from the Pi package install dir via `createRequire` (the same `~/.pi/agent/` convention `extensions/pi-sync/index.ts` already uses for `~/.pi/agent/settings.json`), with a clear error if absent.
- Strict schema validation: reject unknown keys, invalid references (agent/skill/workflow/MCP names), malformed workflows, and incompatible configurations (e.g. a workflow referencing an undeclared agent), each with an actionable message. Parsing and validation are separate pure modules (`parse.mjs`, `validate.mjs`) for testability.
- The **orchestrator is a top-level block**, not an `agents[]` entry: it materializes to `.pi/APPEND_SYSTEM.md` (prompt) + `.pi/settings.json` (model + `defaultTools`). `agents[]` are specialist subagents only.
- Ownership/conflict contract (full text in `docs/agent-factory.md` §C.6): derived files factory-owned/regenerated merge-preserving; authored files user-owned/scaffold-once with content-fingerprint conflict detection; `system.yaml` factory-owned but user-editable; precedence = model authoritative for derived config, authored content authoritative for content; `--dry-run` preview; idempotent pure functions.
- The `models` → `.pi/settings.json` mapping reuses `extensions/pi-config/generate-settings.mjs` (`buildModelSettings`/`generateSettings`); do not fork it.

# Testing Decisions

- Seam: `parseSystem(text) -> doc` in `parse.mjs`, tested with node:test over YAML fixtures (valid, comments, and malformed).
- Seam: `validateSystem(doc) -> {ok, errors[]}` in `validate.mjs`, tested over fixtures: valid + each invalid case (unknown key, bad reference, malformed workflow, incompatible config).
- Seam: `factory validate` CLI exit codes (0 valid / 1 invalid) via a bash harness.
- Seam: `migrate(doc)` schema-version migration tested with a v0→v1 fixture.
- Fixtures live under `skills/agent-factory/test/fixtures/`; tests run via a `skills/agent-factory/test/test.sh` wrapper matching repository convention.

# Compatibility Implications

- Purely additive: no change to existing extensions or skills. Reusing the existing model generator keeps generated `.pi/settings.json` compatible with `pi-config`.
- Introduces the **`coding-agent` compatibility fixture** (a representative `system.yaml` + expected generated tree + capability checklist covering: spec lifecycle workflows, GitHub issue/label integration, existing skills, scout/worker/reviewer subagents, model tiers + routing, verification commands, session/cost accounting, project settings, and extension dependencies). `factory validate` must accept it; later specs progressively assert more of it.
- `yaml@2.8.3` is added to `pi.packages` (pinned, additive).

# Out of Scope

- Generation (`generate`), discovery (`discover`), import, and the conversational builder — covered by later specs.
- Any runtime behavior; this spec is model + validation only.

# Dependencies

None.
