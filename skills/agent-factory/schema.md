# `system.yaml` schema (v1) + ownership contract

This is the canonical reference for the Agent Factory's declarative system
model. It is implemented and enforced by `parse.mjs` and `validate.mjs`, surfaced
through `factory validate <dir>`. The model lives at
`<dir>/.pi/system.yaml` and is the factory's source of truth for the generated
project.

## 1. Schema v1

Top-level keys (all others rejected):

| Key | Required | Type | Meaning |
|---|---|---|---|
| `schema` | yes | integer `1` | schema version |
| `name` | yes | kebab-case string | system/project name |
| `description` | no | string | one-line summary |
| `orchestrator` | no | object | the primary Pi session (→ `.pi/APPEND_SYSTEM.md` + settings) |
| `agents` | no | array | specialist subagents (→ `.pi/agents/*.md`) |
| `skills` | no | array | authored, packaged or vendored skills (→ `.pi/skills/*/`) |
| `integrations` | no | object | MCP servers + env requirements |
| `workflows` | no | array | declared workflow boundaries (metadata only) |
| `documents` | no | array | agreed formats for documents agents write or return |
| `policies` | no | object | enforced + advisory policy |
| `packages` | no | array of `npm:`/`git:` specs | additional runtime extension packages (primaries `pi-subagents`/`pi-mcp-adapter` are always included; packaged skill sources are added automatically) |

The **orchestrator is a top-level block**, not an `agents[]` entry. Pi has no
"primary agent" file: the primary session is shaped by `.pi/settings.json`
(model + `defaultTools`) and `.pi/APPEND_SYSTEM.md` (instructions). `agents[]`
holds specialist *subagents* only.

### Models

There are no model tiers and no default models. Every agent — the orchestrator
and each subagent — names its own model, chosen from the machine's Pi line-up
(`pi --list-models`, also reported by `factory discover` as `models`):

```yaml
orchestrator:
  name: lead
  model: provider/model-id      # required: "provider/id"
  thinking: medium              # optional: off|minimal|low|medium|high|xhigh|max
agents:
  - name: researcher
    model: other-provider/model-id
```

Validation checks the `provider/id` shape and the thinking level, not
availability: the catalog is machine-specific. `factory validate`, `generate`
and `modify` warn about a model missing from the local line-up, without
failing. The orchestrator's model becomes `defaultProvider`/`defaultModel`/
`defaultThinkingLevel` in `.pi/settings.json`; a subagent's model and thinking
level go into its own `.pi/agents/<name>.md` frontmatter. No routing overrides
(`subagents.agentOverrides`) are emitted, and stale ones are removed.

### `orchestrator`

Allowed keys: `name` (required string), `description`, `prompt`, `model`
(required `provider/id`), `thinking`, `tools` (array of strings).

The orchestrator always has memory: notes it keeps across sessions in
`.pi/MEMORY.md`, one `- ` entry per line, up to 4000 characters. They load
into its prompt at session start. It writes them freely with the `memory` tool
(add, replace, remove), and is told to record lessons before finishing a task,
and after a task with failed tool calls. Subagents neither see nor write them.
`/factory-update review` reads the notes; making a lesson permanent (a prompt,
skill or tool change) is a normal previewed change. The file is the user's to
edit, and no generated file depends on it.

### Prompts and the generated "What you can use" section

`prompt` (orchestrator and agents) describes the role, goals, judgement, rules
and boundaries. It should not list tools, MCP servers, commands or skills: the
Factory renders a "What you can use" section from the declarations — built-in
tools, MCP servers (with `config.description` and which tools ask first),
commands, other tools, skills, and for the orchestrator its specialists. A
subagent's section is written into its agent file after its prompt; the
orchestrator's is added to its system prompt at session start by the Factory
extension, so `.pi/APPEND_SYSTEM.md` stays exactly the authored prompt. A change
that removes an MCP server, command or skill reports `staleMentions`: the
prompts, workflows, documents and advisory policies that still name it.

### `agents[]`

Allowed keys: `name` (required string), `description`, `tools` (array of
strings), `model` (required `provider/id`), `thinking`, `skills` (array of
declared `skills[].name`), `prompt`, `inheritProjectContext`, `inheritSkills`.
`tools:` is the subagent allowlist (an *enforced* policy). A subagent whose
tools include anything beyond Pi's builtins (`read`, `bash`, `edit`, `write`,
`grep`, `find`, `ls`) — `mcp:` selections or extension tools such as
`web_search` — or that omits `tools`, gets `async: true`: foreground children
never load extensions, so those tools would be missing. Such systems also get
`.factory/pi-home/extensions/subagent/config.json` with
`forceTopLevelAsync: true` so a caller cannot launch them in the foreground. `skills:` selects the
skills the subagent receives. Duplicate `name`s are rejected.

### `skills[]`

The factory ships no skills of its own; each agent gets the skills the user
chooses for it, including ones the factory suggests from skills.sh.
Allowed keys: `name` (required string), `description`, and at most one of:

- `body` — authored inline; materializes to `.pi/skills/<name>/SKILL.md`. A
  skill with neither `body` nor `source` that a workflow names gets a generated
  orchestration body.
- `source: npm:<name>@<version>` or `git:<repo>@<ref>` — provided by a pinned
  package, which joins the runtime `packages`. No local file is generated.
- `source: ./path`, `../path`, `/abs/path` or `~/path` — a directory containing
  `SKILL.md` whose frontmatter `name` matches. `factory generate`/`modify`
  vendor it into `.pi/skills/<name>/` once (binary-safe, symlinks refused); an
  existing project copy is never overwritten. Relative paths resolve from the
  project directory.
- `source: skills:<owner>/<repo>/<skill-dir>@<commit>` — one skill directory
  from the open Agent Skills ecosystem (skills.sh), pinned to a full 40-character
  commit. `factory generate`/`modify` and `/factory-update apply` install it
  with the `skills` CLI (`npx skills@1.7.4 add <github tree URL> --agent pi
  --copy -y`) into the project's `.agents/skills/<name>/` — never globally —
  and `skills-lock.json` records the commit. The installed `SKILL.md` must
  declare `name` and, in maintenance, match the previewed content. Removing
  the declaration removes the installed copy. `factory search-skills` and
  `factory preview-skill <owner/repo>@<name>` find and pin skills.

Duplicate `name`s are rejected.

### `integrations`

Allowed keys: `mcp` (array), `env` (array) and `cli` (array).

- `mcp[]` entries: `name` (required string) and `config` (required non-empty
  object — `{url: …}` or `{command, args}`; the config shape is opaque and
  passed through to `.pi/mcp.json`). Duplicate `name`s are rejected.
- `env[]` entries: `name` (required shell variable name) and `secret`
  (optional boolean). These become `.env.example` entries, and `./run` loads
  exactly these names from the gitignored `.env` (parsed, never sourced; the
  caller's environment wins). Names that change how the shell, Node, Pi or the
  network stack run (`PATH`, `NODE_OPTIONS`, `LD_*`, `DYLD_*`, proxy variables,
  `PI_CODING_AGENT_DIR`, `FACTORY_*`, …) are rejected.
- `cli[]` entries declare command-line tools: `name` (required kebab-case),
  `description`, `command` (required: one program name or path, no spaces),
  `args` (array of strings) and `approve` (boolean, default `true`). An
  argument that is exactly `{name}` is a value the agent supplies for each
  call (it may not start with `-`); `{name:file}` writes the agent's text to
  a temporary file and passes its path. Every other argument is fixed. The
  command runs directly, without a shell, from the project directory, with
  the user's own CLI logins and the `.env` variables `./run` loaded.
  `approve: true` asks the user before each run (Allow once / Allow for this
  session / Deny); without a UI (a headless run, or a background subagent)
  such a call fails instead of running. Duplicate `name`s are rejected.

  An agent gets a command by listing `cli:<name>` in its `tools` (or an
  enforced policy rule's `tools`); every `cli:` reference must name a declared
  entry. In Pi the tool is `cli_<name>` (hyphens become underscores). The
  orchestrator gets the commands its `tools` list, or all of them when its
  `tools` is omitted; a subagent gets exactly the ones in its allowlist, and
  runs in the background. `/factory-permission` (list, add, remove, review)
  edits these declarations through the normal preview. The orchestrator can
  also ask for a command it has no tool for with `request_permission`: the
  user allows it once, saves it here, or denies it; in a headless run the
  request waits in `.factory/permission-requests.json` for
  `/factory-permission review`.

  ```yaml
  integrations:
    cli:
      - name: create-issue
        description: Open an issue in owlie-app
        command: gh
        args: [issue, create, --repo, mihaiiova/owlie-app, --title, "{title}", --body-file, "{body:file}"]
  agents:
    - name: marketing-lead
      tools: [read, write, "cli:create-issue"]
  ```

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

### `documents[]`

How one agent writes one document, agreed with the user. Allowed keys: `name`
(required kebab-case), `writer` (required: `orchestrator.name` or an
`agents[].name`), `path` (optional project-relative file outside `.pi/` and
`.factory/`; omit it for a report a subagent returns), `purpose`, `maxWords`
(positive integer), `sections` (required non-empty array of `{ heading,
guide? }`, in order), `rules` (array of strings) and `deliver` (array of
`{ mcp, tool, with?, note? }`: send the document with that MCP tool, e.g. to
Google Drive; `mcp` must be a declared server and the writer must have
`mcp:<server>/<tool>` or `mcp:<server>`, or `mcp` for the orchestrator). A writer with a `path`
must have `write` or `edit` when its tools are listed. The format is appended
to the writer's instructions (`APPEND_SYSTEM.md` or its agent file) under
"Document formats". Duplicate `name`s are rejected.

```yaml
documents:
  - name: decisions
    path: strategy/decisions.md
    writer: lead
    purpose: One page the owner can act on.
    maxWords: 600
    sections:
      - { heading: Decide now, guide: "Yes/no questions for the owner, at most 3" }
      - { heading: Actions, guide: "Table: action | owner | due | done when" }
      - { heading: Open questions, guide: "At most 5" }
      - { heading: Evidence and limits, guide: "At most 5 bullets linking to reports/" }
    rules: [ "Caveats only in Evidence and limits", "No run IDs or tool arguments" ]
```

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
- `schema` missing or not `1`;
- `name` missing, empty, or not kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`);
- unknown keys at any level (top level and every nested object, except the
  opaque MCP `config` object);
- wrong types / missing required fields within each block;
- a missing or non-`provider/id` model, or an unknown thinking level;
- unresolved references (agent, skill, workflow, MCP names, including
  `agents[].skills`);
- a skill declaring both `body` and `source`, or an unrecognized `source`;
- malformed workflows (missing required fields, `agents`/`inputs`/`outputs` not
  string arrays, missing `skill` and `entry`);
- incompatible configurations (a workflow or policy referencing an undeclared
  agent/skill/MCP);
- duplicate `name` within `agents[]`, `skills[]`, `integrations.mcp[]`, `documents[]`, or
  `workflows[]`.

The skill name `factory-update` is reserved for bundled maintenance infrastructure
and cannot be declared in `skills[]`. Operational model edits use the structured
operations in [Factory maintenance](../../docs/factory-update.md); that layer
reuses this validator and rejects dangling references. Maintenance installation
identity, versions and update sources belong in `.factory/installation.json`,
never in this operational model. An explicit empty orchestrator `tools: []`
remains an empty allowlist; omitted tools use Pi defaults.

## 3. Schema versions

Only `schema: 1` is accepted. There is no migration: documents written for the
earlier tier-based layout (`models.tiers`, tier names as agent models) are
rejected and must be redefined with per-agent models.

## 4. Ownership / edit-preservation contract

Full text of `docs/agent-factory.md` §C.6:

1. **Derived files** (`settings.json` model fragment + `packages` + `defaultTools`,
   `mcp.json`, and the `run` launcher) are factory-owned and regenerated on
   every `generate`; **unknown keys the factory does not own are preserved**
   The `packages` list is a factory-owned derived key computed from the Pi
   runtime primitives (`pi-subagents`, `pi-mcp-adapter`) plus any `system.yaml`
   `packages` and packaged skill sources the model declares (`deps.mjs`
   `runtimePackages`). Hand-editing a derived file is
   unsupported — change the model instead.
2. **Authored files** (agents, skills, prompts, `APPEND_SYSTEM.md`, README,
   `.gitignore`, `.env.example`) are user-owned. The factory scaffolds them
   when absent. On modification it records a content fingerprint of what it
   last wrote; if a file differs from that fingerprint *and* the model wants to
   change it, the factory treats it as a **conflict** and proposes a diff,
   surfacing it for the user to resolve; it never silently overwrites (and, in
   this MVP, never auto-applies a conflict — the user resolves it by editing the
   file or re-running after a deliberate edit).
   **Vendored skill directories** (`skills[].source` paths) are user-owned
   copies: created once from the source, never overwritten or deleted by the
   factory. Delete a copy explicitly to refresh it from its source.
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
bundled beneath `.factory/runtime/`; they do not import the global Agent Factory install. Upgrades
switch installation metadata, not operational declarations/content. Maintenance
change proposals delete removed agent/skill scaffolds only when intact, reject
authored conflicts, and require separately confirmed drift reconciliation.

`system.yaml` is parsed with the **`yaml`** package (v2.8.3), pinned in
`pi.packages` and resolved from the Pi package install dir by
`yaml-loader.mjs` — never a hand-rolled YAML subset.
