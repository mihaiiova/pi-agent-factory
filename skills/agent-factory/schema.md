# `system.yaml` schema (v1) + ownership contract

This is the canonical reference for the Agent Factory's declarative system
model. It is implemented and enforced by `parse.mjs`, `validate.mjs`, and
`migrate.mjs`, surfaced through `factory validate <dir>`. The model lives at
`<dir>/.pi/system.yaml` and is the factory's source of truth for the generated
project.

## 1. Schema v1

Top-level keys (all others rejected):

| Key | Required | Type | Meaning |
|---|---|---|---|
| `schema` | yes | integer `1` | schema version (older versions migrate forward) |
| `name` | yes | kebab-case string | system/project name |
| `description` | no | string | one-line summary |
| `models` | no | object | model tiers + routing (→ `.pi/settings.json`) |
| `orchestrator` | no | object | the primary Pi session (→ `.pi/APPEND_SYSTEM.md` + settings) |
| `agents` | no | array | specialist subagents (→ `.pi/agents/*.md`) |
| `skills` | no | array | skills incl. workflows (→ `.pi/skills/*/SKILL.md`) |
| `integrations` | no | object | MCP servers + env requirements |
| `workflows` | no | array | declared workflow boundaries (metadata only) |
| `policies` | no | object | enforced + advisory policy |
| `packages` | no | array of `npm:`/`git:` specs | additional runtime extension packages (primaries `pi-subagents`/`pi-mcp-adapter` are always included) |

The **orchestrator is a top-level block**, not an `agents[]` entry. Pi has no
"primary agent" file: the primary session is shaped by `.pi/settings.json`
(model + `defaultTools`) and `.pi/APPEND_SYSTEM.md` (instructions). `agents[]`
holds specialist *subagents* only.

### `models`

```yaml
models:
  tiers:                             # map tier-name → { model, thinking? }
    high:   { model: openai-codex/gpt-5.6-terra, thinking: medium }
    medium: { model: deepseek/deepseek-v4-pro, thinking: high }
    small:  { model: deepseek/deepseek-v4-flash, thinking: low }
  parentTier: high                   # a key of tiers
  subagents:                         # subagent-name → tier-name
    worker: medium
    scout: small
    reviewer: small
    oracle: high
```

Allowed keys: `tiers`, `parentTier`, `subagents`. Each tier's allowed keys are
`model` (required non-empty string) and `thinking` (optional string). Tier names
are arbitrary; `high`/`medium`/`small` is the pi-config convention.

The `models` block maps to `extensions/pi-config/generate-settings.mjs`
(`buildModelSettings`) **by a rename adapter, not a fork**. `buildModelSettings`
reads the key `subagentTiers`, while this schema spells it `subagents`; the
adapter is:

```js
buildModelSettings({
  tiers: models.tiers,
  parentTier: models.parentTier,
  subagentTiers: models.subagents,
});
```

`test/models-mapping.test.mjs` proves this mapping (including that a declared
`worker: medium` overrides `buildModelSettings`'s `DEFAULT_SUBAGENT_TIERS`
fallback of `worker: high`). `migrate.mjs` performs the same rename for v0
(`models.subagentTiers` → `models.subagents`).

### `orchestrator`

Allowed keys: `name` (required string), `description`, `prompt`, `model`
(required, a `models.tiers` key), `tools` (array of strings).

### `agents[]`

Allowed keys: `name` (required string), `description`, `tools` (array of
strings), `model` (required, a `models.tiers` key), `prompt`. `tools:` is the
subagent allowlist (an *enforced* policy). Duplicate `name`s are rejected.

### `skills[]`

Allowed keys: `name` (required string), `description`, `body`. A skill
materializes to `.pi/skills/<name>/SKILL.md`. Duplicate `name`s are rejected.

### `integrations`

Allowed keys: `mcp` (array) and `env` (array).

- `mcp[]` entries: `name` (required string) and `config` (required non-empty
  object — `{url: …}` or `{command, args}`; the config shape is opaque and
  passed through to `.pi/mcp.json`). Duplicate `name`s are rejected.
- `env[]` entries: `name` (required string) and `secret` (optional boolean).
  These become `.env.example` entries.

### `workflows[]`

Allowed keys: `name` (required), `description`, `skill`, `trigger`, `entry`,
`agents`, `inputs`, `outputs`, `approval`, `verify`.

- `skill` references a `skills[].name` (the orchestrating SKILL.md).
- `entry` references `orchestrator.name` or an `agents[].name`.
- `agents` is an array of strings, each referencing `orchestrator.name` or an
  `agents[].name` (the specialists available to the workflow).
- `inputs`/`outputs` are arrays of path strings.
- `trigger` is `{ kind: "manual" | "headless" }` (scheduling deferred).
- A workflow must declare at least one of `skill` or `entry`.

Workflows are **declared boundaries, not a graph of internal steps**: execution
authority stays with the named skill's own procedure. Duplicate `name`s are
rejected.

### `policies`

Allowed keys: `enforced` (array) and `advisory` (array of strings).

- `enforced[]` entries carry exactly one discriminator:
  - `{ agent: <agents[].name>, tools: [string, …] }` → subagent tool allowlist.
  - `{ mcp: <integrations.mcp[].name>, hide: [string, …] }` → MCP
    `excludeTools` (the pi-mcp-adapter mechanism for making tools unreachable).
- `advisory[]` are behavioral guidance strings (README + skill text).

## 2. Validation rules

`validateSystem(doc)` returns `{ ok, errors[] }`. Errors name the offending
path/key and the expected value. Rejected conditions:

- non-object document;
- `schema` missing or not `1` (older versions must be migrated first; newer or
  unknown versions are rejected);
- `name` missing, empty, or not kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`);
- unknown keys at any level (top level and every nested object, except the
  opaque MCP `config` object);
- wrong types / missing required fields within each block;
- unresolved references (tier, agent, skill, workflow, MCP names);
- malformed workflows (missing required fields, `agents`/`inputs`/`outputs` not
  string arrays, missing `skill` and `entry`);
- incompatible configurations (a workflow or policy referencing an undeclared
  agent/skill/MCP);
- duplicate `name` within `agents[]`, `skills[]`, `integrations.mcp[]`, or
  `workflows[]`.

The skill name `factory-update` is reserved for bundled maintenance infrastructure
and cannot be declared in `skills[]`. Operational model edits use the structured
operations in [Factory maintenance](../../docs/factory-update.md); that layer
reuses this validator and rejects dangling references. Maintenance installation
identity, versions and update sources belong in `.factory/installation.json`,
never in this operational model. An explicit empty orchestrator `tools: []`
remains an empty allowlist; omitted tools use Pi defaults.

## 3. Migration path

`migrate(doc)` returns a new document (never mutating the input) at the current
schema. Supported migrations:

- **v0 → v1** — v0 documents omitted `schema` and used
  `models.subagentTiers` (the `generate-settings.mjs` spelling). Migration sets
  `schema: 1` and renames `models.subagentTiers` → `models.subagents`.

`factory validate` applies `migrate` when `schema` is missing or `0`, then
validates. A future schema bump adds a further migration here while keeping
older versions valid.

## 4. Ownership / edit-preservation contract

Full text of `docs/agent-factory.md` §C.6 (generalizing
`extensions/pi-config/generate-settings.mjs`):

1. **Derived files** (`settings.json` model fragment + `packages` + `defaultTools`,
   `mcp.json`, and the `run` launcher) are factory-owned and regenerated on
   every `generate`; **unknown keys the factory does not own are preserved**
   (the same merge the model generator already performs). The `packages` list is
   a factory-owned derived key computed from the Pi runtime primitives
   (`pi-subagents`, `pi-mcp-adapter`) plus any `system.yaml` `packages` the
   model declares (`deps.mjs` `runtimePackages`). Hand-editing a derived file is
   unsupported — change the model instead.
2. **Authored files** (agents, skills, prompts, `APPEND_SYSTEM.md`, README,
   `.gitignore`, `.env.example`) are user-owned. The factory scaffolds them
   when absent. On modification it records a content fingerprint of what it
   last wrote; if a file differs from that fingerprint *and* the model wants to
   change it, the factory treats it as a **conflict** and proposes a diff,
   surfacing it for the user to resolve; it never silently overwrites (and, in
   this MVP, never auto-applies a conflict — the user resolves it by editing the
   file or re-running after a deliberate edit).
3. **`system.yaml`** is factory-owned but user-editable; `modify` updates only
   the keys it is changing and preserves unknown keys (best-effort on
   comments).
4. **Precedence:** the declarative model is authoritative for *derived*
   config; authored content is authoritative for *content*. On conflict the
   authored file wins until the user confirms a merge.
5. **Preview:** `generate --dry-run` and `modify --dry-run` print the full
   planned diff and write nothing; the builder always previews before applying.
6. **Idempotence:** `generate`/`modify` are pure functions of (model, disk) —
   same inputs produce the same result and never duplicate content.

Maintenance front doors (`.pi/extensions/factory-update/index.ts` and
`.pi/skills/factory-update/SKILL.md`) are reserved infrastructure outside authored
operational skill ownership. Versioned engines and exact YAML dependency pins are
bundled beneath `.factory/runtime/`; they do not import global pi-config. Upgrades
switch installation metadata, not operational declarations/content. Maintenance
change proposals delete removed agent/skill scaffolds only when intact, reject
authored conflicts, and require separately confirmed drift reconciliation.

`system.yaml` is parsed with the **`yaml`** package (v2.8.3), pinned in
`pi.packages` and resolved from the Pi package install dir by
`yaml-loader.mjs` — never a hand-rolled YAML subset.
