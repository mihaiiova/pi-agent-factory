---
name: agent-factory
description: Build or modify a Pi agent system from a plain-language outcome. Use when the user wants to create an agent system, describes a multi-agent workflow, or asks to configure/discover MCP servers, skills, or subagents for a generated project.
---

# Agent Factory

The Agent Factory turns a plain-language outcome into a standalone, project-local Pi
agent system, and later modifies that system conversationally. It is a
**conversational builder over the deterministic `factory` CLI** — the CLI is the
single source of truth for generation; this skill drives it.

Invoke with `/agent-factory` (convenience alias), `/skill:agent-factory`, or describe an agent-system outcome ("I want an
SEO system", "set up a coding agent with a reviewer", …) and this skill routes here.

## How to work: a design conversation, not a questionnaire

Act as an experienced technical collaborator helping the developer shape an
idea into a working system. The specification emerges from the conversation;
it is not collected up front.

- **The conversation is the requirement source.** Before replying, reread this
  session — including everything said before the Factory was invoked — and
  never ask again for something already established (purpose, outputs,
  integrations they said they have, things they ruled out). Invoked with no
  request, continue from the conversation; ask what they want to achieve only
  when there is nothing to go on.
- **Recommend, don't survey.** State an explicit recommendation with its
  reason and let the user redirect it, rather than asking them to choose among
  technical options. "I'd start with one orchestrator and a researcher; a
  separate writer isn't needed until drafting gets complex", not "What agents
  do you want?".
- **One question at a time, only when the answer changes the design.** Infer
  safe defaults for everything else and say what you assumed.
- **Simplest viable system first.** Challenge subagents the orchestrator could
  handle itself, and integrations or workflows the outcome doesn't need.
  Recommending an existing tool or a single agent is a valid answer.
- **Follow changes of direction.** When the user changes the architecture,
  update your understanding; don't defend or repeat the earlier proposal.
- **Progressive disclosure.** Talk outcomes and architecture first; bring in
  tools, models and skills when a design takes shape; exact models,
  permissions, skill sources, files and credentials when building. Give any
  detail the user asks for at any time. Don't re-present the whole design after
  every small clarification — say what changed.
- **Ground every claim in discovery.** Models, installed tools, MCP servers and
  skills come from `factory discover`, `factory search-skills` and
  `factory preview-skill` — never from memory or invention.

The three phases below describe how the conversation tends to move, not a
checklist or a state machine. Stay in exploration as long as the user wants;
skip ahead when the user is already specific; go back when something changes.

### Explore

Understand the outcome behind the requested implementation: who it is for,
what "done" looks like, what must not happen. Sketch one or two possible
architectures with their trade-offs, lead with the simplest, and recommend
one. Don't ask for models, agents, skills, document structures, permissions or
integrations here, and don't search for skills yet — that comes when the
design needs it or when preparing to build.

### Synthesize

When the direction is clear, summarize the emerging design in a few short,
plain-language paragraphs or bullets — not YAML:

- what the system accomplishes, and what it explicitly won't do;
- the orchestrator's job and each specialist's (only where a specialist earns
  its place);
- the tools, MCP integrations and skills it needs, and suggested models where
  useful;
- inputs and outputs (documents and where they go), and important operational
  constraints.

Mark each point **Confirmed** (the user said or agreed to it), **Proposed**
(your recommendation, not yet agreed) or **Unresolved** (blocks
implementation). Don't ask for approval of each point; the user corrects what
they disagree with. In a long conversation this summary is the compact record
to build from — don't persist any separate state.

### Build

"Build it", "let's create it", "that works", "proceed", "generate the agent"
mean the user agrees to implement the design. Don't restart discovery or
interview again; reuse the design and the conversation, then:

1. **Discover** what is still unknown: `factory discover` (add `--cli <name>`
   for each command-line tool the system will use), skills per agent, and
   whether the integrations the user mentioned are actually present.
2. **Fill the gaps with recommendations** (see *Technical decisions*) and state
   the assumptions. Ask only about decisions that cannot safely be inferred or
   that materially change functionality, cost, external permissions or
   security — and ask those before writing `system.yaml`.
3. **Construct** `.pi/system.yaml` from the seven primitives (`orchestrator`,
   `agents`, `skills`, `integrations`, `workflows`, `policies`, `packages`).
4. **Validate** with `factory validate <dir>`.
5. **Preview** with `factory generate <dir> --dry-run`, and summarize what will
   be created — agents with their exact models and tools, skills with their
   sources, MCP servers and their scope, documents and deliveries, required
   credentials — and anything still unresolved.
6. **Get explicit confirmation of that preview** before writing any file, then
   run `factory generate <dir>`. "Build it" agrees to the design; it is not
   approval to write files unseen.

## Technical decisions

Settled while building, or earlier whenever they become useful. Recommend
first; the user decides.

- **Models:** the factory ships no default models. Recommend a model for the
  orchestrator and for each subagent from the discovered line-up (`models`,
  from `pi --list-models`), with the reason — e.g. "X for planning, the cheaper
  Y for research; either can change later". Ask explicitly when the choice has
  a consequential cost or capability trade-off, and show the full line-up on
  request. Record each as `model: provider/id` (plus an optional `thinking:`
  level) on that agent. Agents may share a model or each use a different one.
  Any model can be changed later (see *Maintain*).
- **Skills:** the factory ships no skills of its own; each agent gets the
  skills the user chooses for it. When the design needs skills, or when
  preparing to build, search skills.sh for each agent's role
  (`factory search-skills <terms>`: name, source repo, installs, page) and
  present the few relevant candidates — what each adds, and which you'd pick
  and why. Install counts are information, not a filter. Before any
  third-party skill is chosen, run `factory preview-skill <owner/repo>@<name>`:
  it pins the skill to the repository's current commit and prints its
  `SKILL.md` and files, which you summarize (what it instructs, any scripts) so
  the user decides on what will actually be installed. Record the user's picks
  with the printed `source: skills:<owner>/<repo>/<dir>@<commit>`;
  `factory generate` installs them into the project's `.agents/skills/<name>/`
  with the `skills` CLI (project-local, never global) and `skills-lock.json`
  records the commit. Skills can also be an inline `body`, a pinned package
  (`source: npm:<name>@<version>` or `git:<repo>@<ref>`), or a directory the
  user points at (`source: ./path`, `../path`, `/abs/path` or `~/path`),
  vendored into `.pi/skills/<name>/`. Attach skills per agent with
  `agents[].skills`. An agent that should find and install skills itself can
  be given the `vercel-labs/skills@find-skills` skill plus `bash`; tell it, as
  a document rule or in its prompt, to install project-locally (`--agent pi`,
  no `-g`).
- **Prompts:** write each agent's prompt about its role — goals, judgement,
  rules, boundaries — and keep it short. Never list its tools, MCP servers,
  commands or skills, or explain how to call them: the Factory renders a
  "What you can use" section from the declarations, so prompts stay right
  when capabilities change. Keep a rule about an action as an outcome ("never
  modify an existing issue"); approval belongs in `approve`/`approveTools`.
  Give MCP servers a `config.description` and agents a `description`; those
  appear in the section.
- **Documents:** any agent may write or return any number of documents. For
  each one, propose a structure — purpose, sections in order with a one-line
  guide each, optionally a word limit and rules — e.g. "a short report with
  findings, prioritized opportunities and recommended actions". The user
  adjusts it in conversation or in the build summary; propose, never decide the
  format alone. Record it in `documents[]` with its `writer`. A document can
  also be delivered anywhere an MCP tool reaches (Google Drive, Notion, Slack,
  …): `deliver: [{ mcp, tool, with?, note? }]`, any number per document; the
  writer needs that tool. The agreed format and deliveries are rendered into
  the writer's instructions.
- **Command-line tools:** when an agent needs a CLI the user already has
  (`gh`, `wrangler`, `stripe`, a project script), prefer a declared command
  in `integrations.cli` over `bash`: a fixed shape such as
  `gh issue create --repo <owner/repo> --title {title} --body-file {body:file}`,
  given to that agent as `cli:<name>`. The agent fills in only the
  placeholders, nothing runs through a shell, and by default the user
  approves each run. Check the CLI is
  installed with `factory discover --cli <name>`. After generation,
  `/factory-permission` manages these, and the orchestrator can ask for a
  missing one with `request_permission`.
- **Capabilities and permissions:** what each agent may touch is the user's
  call; the factory adds no restrictions of its own. When an agent would
  publish, send, delete or otherwise change something outside the project (a
  site, a repository, a CMS, someone's inbox), settle the permission and
  approval boundary before enabling it — which tool or MCP scope, and whether a
  human confirms each action. Don't infer this or bury it in a default. Explain
  what each credential and tool can reach (an MCP server with a scoped token,
  or `bash` with the user's own CLI logins) and let the user choose per agent.
- **Calls that ask the user** (MCP tools in `approveTools`, commands without
  `approve: false`) only work for the orchestrator: specialists run in the
  background, where nobody can answer. When a specialist's work needs such a
  call, propose the split in the design: the specialist gets the tools that
  don't ask (`mcp:<server>/<tool>`) and asks for the call; the orchestrator
  gets approval, makes it and passes the result on. The generated "What you
  can use" sections tell both sides, so prompts don't need to. Validation
  rejects a subagent that can reach a call that asks; in an existing project
  the change preview lists each one with a ready fix.
- **Memory** is built in, not a decision: every orchestrator keeps short
  notes across sessions in `.pi/MEMORY.md` (corrections, preferences, tools
  or specialists that failed and what worked), writes them itself, and loads
  them at session start. Mention it when it matters, e.g. a read-only system
  still writes this one file. `/factory-update review` turns lasting lessons
  into proposed changes.
- **Generated files:** generation also writes `.factory/capabilities.json` —
  the deterministic effective-capability manifest (orchestrator/subagent tools,
  skills, MCP servers + exclusions, packages) derived from `system.yaml`, used
  to inspect and cross-check the generated capability surface.

## After generation

- **Configure** — declare each credential in `integrations.env` and reference
  it as `${NAME}` in MCP config. `./run` loads declared names from the
  gitignored `.env`; the user fills it in (or later uses
  `/factory-update env set NAME`). **Never write a secret into a committed
  file** — only `${ENV}` references and `.env.example` templates. **Done when**
  every required credential is declared as a `${ENV}`/`.env.example` entry and
  no secret is committed.
- **Validate** — `factory validate <dir>`, then a headless smoke run through
  the generated launcher (`./run -p "<workflow input>"`). The launcher is the
  canonical entry point and runs the system under its own isolated Pi config
  directory (`PI_CODING_AGENT_DIR=.factory/pi-home`), so the host's global
  Pi settings/MCP/extensions/credentials are not inherited. Skills in the
  shared Agent Skills folder `~/.agents/skills/` (and `.agents/skills/` in the
  project and its parents) do load for the orchestrator, by design;
  subagents get only the skills listed for them.
- **Maintain** — every generated system bundles `/factory-update`, its thin
  skill/command and minimal standalone deterministic engine. Within `./run`, use
  `/factory-update <request>` to inspect/discover/preview a structured model
  change, `/factory-update apply` to confirm it, or `/factory-update review` for
  read-only recommendations. Switch any agent's model with an `assign`
  operation (`{"op":"assign","name":"<agent>","model":"provider/id"}`). The
  operational loadout is not broadened. Changes
  go through `system.yaml`, never direct settings/MCP edits. CLI equivalents:
  `factory change <dir> --operations <json-file> --dry-run`, then `--yes` after
  approval. Existing `factory modify <dir> --dry-run` reconciliation is preserved.
- **Upgrade tooling** — `/factory-update check|update|rollback` use pinned trusted
  Factory metadata, cached nonblocking startup discovery, staged exact revisions,
  explicit confirmation and retained offline rollback. No automatic activation,
  functional model change or dependency on the global Agent Factory install. Restart after applying.
  Bootstrap older projects with `factory bootstrap-update <dir> --dry-run`, then
  `--yes`; conflicts/migrations must be resolved explicitly. See
  `../../docs/factory-update.md` for architecture, recovery and limitations.

Acceptance scenarios for this conversational behavior:
`../../docs/agent-factory-conversation.md`.

## Policy and ownership contract

- **Enforced (cannot be bypassed):** agent `tools:` allowlists and MCP
  `excludeTools` — a child agent literally lacks unlisted tools, and a hidden MCP
  tool is registered but unreachable.
- **Advisory (guidance only):** README and workflow/skill prose stating approval
  requirements (e.g. "publishing requires human confirmation"). Prose is never
  mistaken for enforcement.
- **Ownership:** derived files (`.pi/settings.json`, `.pi/mcp.json`) regenerate
  merge-preserving; authored files (agents, skills, `APPEND_SYSTEM.md`, README,
  `.gitignore`, `.env.example`) are scaffold-once and fingerprint-protected. A user
  edit is **never silently overwritten** — the factory reports a conflict and
  proposes a diff.

## Out of scope

Recreating existing projects, scheduled triggers, and arbitrary generated
extension code. The small bundled maintenance loader is infrastructure, not an
operational extension-generation framework. `factory import` is preserved for
non-Factory projects; existing Factory projects use `bootstrap-update`.
