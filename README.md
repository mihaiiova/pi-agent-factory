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

### Skills: only the ones you ask for or provide

The factory ships no skills and recommends none unprompted. A skill is authored
inline, comes from a pinned package, or is vendored from a directory you point
at, and each agent lists the skills it receives:

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
```

See [`schema.md`](skills/agent-factory/schema.md) for every field, validation
rule and the file-ownership contract, and [docs/agent-factory.md](docs/agent-factory.md)
for the architecture.

### Running and maintaining a generated system

A generated project starts with `./run`, which isolates it from your global Pi
configuration (own config dir, own credentials: `/login` once per project).
Inside it, `/factory-update <request>` previews declarative changes —
including switching an agent's model — and `/factory-update apply` confirms
them.

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
