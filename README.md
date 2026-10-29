# Pi Forge

**Design, generate, check, and revise specialized Pi agents.**

Pi Forge (formerly **Pi Agent Factory**) is a conversational development tool
for specialized agents. You describe the outcome you want. Forge recommends the
simplest agent that achieves it and generates it as an ordinary, project-local
Pi project: an orchestrator, optional specialists, skills, packages, MCP
integrations, commands, workflows and permissions. It then keeps that agent
working as your needs change.

**The specialized agent is the product. Pi is its runtime.** Forge composes
Pi's own resources and adds no runtime, workflow engine or scheduler of its
own. A generated agent runs with Pi alone and does not need Forge running.

- [Product direction](docs/product-direction.md): what Forge is, how to judge
  changes, and its non-goals. This is the authoritative document.
- [Roadmap](docs/roadmap.md): the current audit, gaps, milestones and issues.

> **Naming.** The rename is planned but not done yet. This repository, the
> package (`pi-agent-factory`) and the commands (`/agent-factory`,
> `/factory-update`, `/factory-permission`) still use the old names. They will
> become `mihaiiova/pi-forge`, `pi-forge` and a single `/forge` command. There
> is no migration: projects built with the old names are regenerated. See
> [Milestone 0](docs/roadmap.md#milestone-0-packaging-rename-command-surface-and-a-security-fix).

### Architecture in brief

```text
you ──▶ /agent-factory (builder, conversational)
          │  factory CLI: discover · validate · generate --dry-run · generate
          ▼
   <project>/.pi/system.yaml   compact desired state (schema 1)
   <project>/.pi/…             native Pi files: settings, agents, skills, mcp.json, prompts
   <project>/run               isolated launcher (own Pi home and credentials)
   <project>/.factory/         build record, pinned agent runtime, Forge tooling bundle
          │
          ▼
   ./run, ./run -p "…"   Pi runs the agent; /factory-update revises it in place
```

- **Design and generate:** `/agent-factory` holds a design conversation, writes
  `system.yaml`, previews the generated files and writes them only after you
  confirm. Generation is deterministic and idempotent, and never silently
  overwrites your edits.
- **Check:** `factory validate`, a capability manifest
  (`.factory/capabilities.json`) and a launch check on every start that each
  agent will get its declared tools, MCP tools and skills. Checking actual
  behavior is on the [roadmap](docs/roadmap.md).
- **Revise:** inside a project, `/factory-update <request>` proposes a small
  structured change, shows the diff, and applies it after your approval.

The former personal Pi setup (spec lifecycle, domain skills, sync/state
extensions) now lives in the private
[`pi-personal`](https://github.com/mihaiiova/pi-personal) repository; see
[Personal Pi setup](#personal-pi-setup).

## Using Forge today

Start it from any Pi session with `/agent-factory <outcome>` (or
`/skill:agent-factory`). The builder works as a design conversation, not an
interview: it uses what you've already said, recommends the simplest system
that fits, and asks only questions that change the design. When you say
"build it", it runs `factory discover`, writes a `.pi/system.yaml`, previews
the generated files and applies them only after you confirm. See the
[conversational acceptance scenarios](docs/agent-factory-conversation.md). The deterministic CLI behind it:

```sh
node skills/agent-factory/factory.mjs discover [dir]          # models, your skills, MCP, CLIs
node skills/agent-factory/factory.mjs validate <dir>
node skills/agent-factory/factory.mjs generate <dir> --dry-run  # then without --dry-run
node skills/agent-factory/factory.mjs modify <dir> --dry-run
```

### Models: chosen per agent

Nothing is hardcoded. Every agent — the orchestrator and each subagent — names
its own model from the machine's Pi line-up (`pi --list-models`, also reported by
`factory discover`), with an optional thinking level. Agents may share a model or
each use a different one, and any model can be changed later.

### Skills: chosen per agent, suggested from skills.sh

The factory ships no skills of its own. When you set up a system, or add or
change an agent, it searches the open skills registry ([skills.sh](https://skills.sh))
for that agent's role and suggests a few candidates, with source, install count
and page. It shows each skill's actual `SKILL.md` and files before you decide.
Your picks are pinned to a commit and installed with the open `skills` CLI into
the project's own `.agents/skills/` (never globally), recorded in
`skills-lock.json`:

```sh
node skills/agent-factory/factory.mjs search-skills seo audit
node skills/agent-factory/factory.mjs preview-skill coreyhaines31/marketingskills@seo-audit
```

A skill can also be authored inline, come from a pinned package, or be vendored
from a directory you point at. Each agent lists the skills it receives:

```yaml
schema: 1
name: research-desk
orchestrator:
  name: lead
  model: openai-codex/gpt-6-sol
  thinking: medium
  tools: [read, grep, subagent]
agents:
  - name: researcher
    model: deepseek/deepseek-flash
    thinking: high
    tools: [read, grep]
    skills: [notes, house-style]
skills:
  - name: notes
    source: ../my-skills/notes            # vendored into .pi/skills/notes/ once
  - name: house-style
    source: npm:@acme/house-style@1.2.0   # pinned package, added to runtime packages
  - name: seo-audit                       # from skills.sh, pinned to a commit
    source: skills:coreyhaines31/marketingskills/skills/seo-audit@17772c7a80b7b8c7a47af30f648374cd8bd8adc5
```

Skills in the shared Agent Skills folder `~/.agents/skills/` also load for the
orchestrator; subagents get only the skills listed for them.

### Documents: formats you agree on

For each document an agent writes (or a report a subagent returns), the
factory proposes a structure — purpose, sections in order, a word limit and a
few rules — and you add, remove or change sections before it is recorded in
`documents[]`. The agreed format goes into that agent's instructions, so each
run produces the same shape. Any agent can have any number of documents, and a
document can be delivered anywhere an MCP tool reaches — Google Drive, Notion,
Slack — with `deliver: [{ mcp, tool, with }]`. Change formats later with
`/factory-update`.

Subagents that use MCP or extension tools (web search, for example) always
run in the background, where those tools load; the factory sets this up. On
every start, `./run` checks that each agent will get the tools, MCP tools and
skills it is declared to have, and names any that are missing.

See [`schema.md`](skills/agent-factory/schema.md) for every field, validation
rule and the file-ownership contract, and [docs/agent-factory.md](docs/agent-factory.md)
for the architecture.

### Memory: the orchestrator learns across sessions

Always on. The orchestrator keeps short notes (up to 4000 characters) in
`.pi/MEMORY.md`:
corrections, preferences, and tools or specialists that failed and what worked
instead. It writes them itself with a `memory` tool, is reminded to after a task
with failed tool calls, and loads them at the start of each session. Subagents
don't see them. The file is plain Markdown you can edit. `/factory-update review`
reads it, so a lesson that should always hold can become a previewed change to a
prompt, skill or tool.

### Prompts: roles, not tool manuals

Each agent's prompt describes its role, goals and rules. What it can use —
tools, MCP servers, commands, skills, and for the orchestrator its specialists —
is generated from `system.yaml` into a "What you can use" section, so removing
an integration also removes it from what agents are told. The section is part of
the generated project (each agent file, and `.pi/CAPABILITIES.md` for the
orchestrator), so it changes when the system is regenerated, never because the
Factory tooling was updated. The same holds for the runtime agents use (memory,
command tools, `request_permission`): it comes from the Factory version that
last built the project, recorded in `.factory/build.json`. A change that removes
a capability lists any prompt, workflow or policy that still mentions it, and
`/factory-update review` flags prompts that describe specific tools.

### Commands: CLI permissions per agent

Agents can run command-line tools you already use (`gh`, `wrangler`, your own
scripts) through declared commands instead of a full shell. Each is a fixed
shape in `system.yaml` where the agent fills in only the `{placeholders}`:

```yaml
integrations:
  cli:
    - name: create-issue
      command: gh
      args: [issue, create, --repo, mihaiiova/owlie-app, --title, "{title}", --body-file, "{body:file}"]
      approve: true   # the default: you approve each run
```

Give it to an agent with `cli:create-issue` in its `tools`. Commands run
without a shell, with your own CLI logins. In a running system:

- `/factory-permission` lists commands and who may run them; `add`, `remove
  <name>` and `review` change them through a preview you confirm.
- When the orchestrator needs a command it has no tool for, it asks with
  `request_permission`: allow once, always (saved to `system.yaml`), or deny.
  In a headless run the request waits for `/factory-permission review`.

### Running and maintaining a generated system

**Upgrading a project generated before v0.11:** older generators wrote agent
`tools`/`skills` lists as `[a, b]`, which pi-subagents reads as the names `[a`
and `b]`, so specialists started without those tools or skills. Agents without
a `description` were skipped entirely. Run `/factory-update update` (from a
version before 0.18, restart and then run `/factory-update rebuild`); the startup check
lists every affected agent until then.

A generated project starts with `./run`, which isolates it from your global Pi
configuration (own config dir, own credentials: `/login` once per project).
Inside it, `/factory-update <request>` previews declarative changes —
including switching an agent's model — and `/factory-update apply` confirms
them.
While preparing a change, the maintainer can read public documentation (for
example an MCP server's README and releases) to verify versions, tools and
auth, and can declare the environment variables an integration needs. You set
their values with `/factory-update env set NAME`; `./run` loads them from the
project's gitignored `.env`. Generation and change previews also add missing
secret and state paths to an existing `.gitignore` without rewriting your rules.
Ignoring files does not remove credentials already committed to git: rotate any
credentials that were committed, including those in `.env` or `.factory/`.

On every start, `./run` checks in the background whether a newer Factory
release exists, by comparing the git commit the project was generated from
with the newest `vX.Y.Z` release tag on GitHub. A notice appears only when an update
is available, or — at most once a day — when the check keeps failing for a
reason other than being offline (for example, the project was generated from a
commit that was never pushed). Updates install only via `/factory-update update`.

Generate real systems from a pushed commit (ideally a release checkout); a
project stamped with an unpushed commit cannot be compared. A project generated
from a commit newer than the latest release reports up to date until a release
that contains it is tagged. Bootstrap older
generated systems without recreating them:

```sh
node skills/agent-factory/factory.mjs bootstrap-update /path/to/agent --dry-run
node skills/agent-factory/factory.mjs bootstrap-update /path/to/agent --yes
```

See [Factory maintenance](docs/factory-update.md) for update checks, security
boundaries, installation metadata, recovery and rollback.

### Tests

```sh
bash skills/agent-factory/test/test.sh
```

### Releasing

Generated projects update from release tags. To publish one, merge
`development` into `master`, set `package.json` `version` to `X.Y.Z`, tag the
commit `vX.Y.Z` and push the tag.

## Install

```sh
git clone https://github.com/mihaiiova/pi-agent-factory.git /path/to/pi-agent-factory
pi install /path/to/pi-agent-factory
```

`/agent-factory` is then available in any Pi session. The factory pins only what
generated systems need (`pi-subagents`, `pi-mcp-adapter`, and `yaml` for its own
parser) in `package.json` under `pi.packages`.

## Personal Pi setup

The spec lifecycle, domain skills and the `explore`, `pi-config`, `pi-sync`,
`project-state`, `save-md`, `skills-select` and `startup-check` extensions moved,
with their history, to [`mihaiiova/pi-personal`](https://github.com/mihaiiova/pi-personal).
It is the reference for a new development-workflow integration that will be
built from scratch with the Agent Factory.

To move a machine over, install it next to this repository, then pull this one:

```sh
git clone https://github.com/mihaiiova/pi-personal.git /path/to/pi-personal
pi install /path/to/pi-personal
ln -sfn /path/to/pi-personal/AGENTS.md ~/.pi/agent/AGENTS.md   # global instructions moved too
cd /path/to/pi-agent-factory && git remote set-url origin https://github.com/mihaiiova/pi-agent-factory.git && git pull
```

Then `/reload`. `/pi-sync` now syncs `pi-personal`; update this repository with
`git pull`.
