# pi-agent-factory

This repository is becoming the **Agent Factory**: a conversational builder that
defines a standalone, project-local Pi agent system from zero — its orchestrator,
specialist subagents, skills, MCP integrations, workflows and policies — and
maintains it afterwards. The former personal Pi setup (spec lifecycle, domain
skills, sync/state extensions) now lives in the private
[`pi-personal`](https://github.com/mihaiiova/pi-personal) repository; see
[Personal Pi setup](#personal-pi-setup).

## Agent Factory

Start it from any Pi session with `/agent-factory <outcome>` (or
`/skill:agent-factory`). The builder interviews you, runs `factory discover`,
designs a `.pi/system.yaml`, previews the generated files and applies them only
after you confirm. The deterministic CLI behind it:

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

### Running and maintaining a generated system

A generated project starts with `./run`, which isolates it from your global Pi
configuration (own config dir, own credentials: `/login` once per project).
Inside it, `/factory-update <request>` previews declarative changes —
including switching an agent's model — and `/factory-update apply` confirms
them.
While preparing a change, the maintainer can read public documentation (for
example an MCP server's README and releases) to verify versions, tools and
auth, and can declare the environment variables an integration needs. You set
their values with `/factory-update env set NAME`; `./run` loads them from the
project's gitignored `.env`.

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
