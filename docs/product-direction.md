# Pi Forge — product direction

> This is the authoritative statement of what Pi Forge is and how to judge
> changes to it. Where an older document disagrees with it, this one wins.
> Pi Forge was formerly called **Pi Agent Factory** (`pi-agent-factory`,
> `/agent-factory`, `/factory-update`). The code still uses those names until the
> rename lands; see [the roadmap](roadmap.md).

## 1. Product definition

Pi Forge is a conversational development tool for designing, assembling,
checking and evolving **specialized Pi agents**. You describe the outcome you
want; Forge recommends the simplest agent that achieves it, generates it as an
ordinary Pi project, verifies that it works, and changes it safely as needs
change.

**Motto:** *Design, generate, check, and revise specialized Pi agents.*

## 2. Core principle

> **The specialized agent is the product. Pi is its runtime.**

Forge composes Pi's own resources: settings, agent files, skills, packages,
extensions, MCP servers, sessions. It does not add another agent runtime,
workflow engine, scheduler, plugin system or memory store. A generated agent
runs with Pi alone: it never needs Forge running, and keeps working if Forge is
uninstalled.

## 3. Target users and reference use cases

The user is a developer who wants an agent for a specific job and wants to own
it: plain files they can read, diff, commit and edit.

Three reference systems test architectural decisions. They are not separate
products:

- **A. Owlie marketing agent.** Automates marketing for owlie.io step by step,
  from analysis to drafts, approved publishing and eventually bounded
  autonomous runs. It uses OpenSEO, PostHog, Search Console and social
  publishing. It already exists, built with the current Forge. Use it to find
  gaps; don't rebuild it to prove generation works.
- **B. Investing research agent.** Takes in processed information from Owlie,
  reads market and company data, keeps hypotheses, and proposes actions.
  Research access and trading authority are separate capabilities. Trade
  execution needs explicit authorization and enforced limits, and is out of
  scope for the current roadmap.
- **C. Project-specific coding harness.** A coding agent built inside an
  existing repository. It understands the stack and conventions, and adds
  reviewer, tester or planner specialists only where they help.

## 4. The specialized-agent model

A specialized agent is:

| Element | Where it lives (Pi-native) |
|---|---|
| Objective, responsibilities, rules | orchestrator prompt (`.pi/APPEND_SYSTEM.md`) |
| Specialists (optional) | `.pi/agents/*.md`, run by `pi-subagents` |
| Tools and integrations | built-in tools, Pi packages and extensions, MCP servers (`.pi/mcp.json`), declared CLI commands |
| Permissions | enforced tool allowlists, hidden MCP tools, per-call approval |
| Domain knowledge | ordinary project files (`data/`, `reports/`, documents agents write) and skills |
| Learned lessons | `.pi/MEMORY.md` (the orchestrator's own notes) |
| Triggers | manual (`./run`), headless (`./run -p`), scheduled (planned) |
| Execution history | Pi session files, plus a small run index (planned) |

`.pi/system.yaml` is the compact **desired state** for all of this. It is
deliberately smaller than Pi's full configuration surface. Forge derives the
native files from it, and the user edits the authored ones directly.

## 5. What Forge does

- **Design.** Learn the intended outcome in conversation, use what is already
  known, recommend an architecture, and avoid complexity that the outcome
  doesn't need.
- **Generate.** Build the agent from native Pi resources and existing
  capabilities. Write custom components only when nothing existing fits.
  Generation is deterministic and idempotent, previews diffs before writing,
  preserves user edits, and pins dependencies.
- **Check.** Verify configuration, capabilities, permissions and actual
  behavior, and say which of these were demonstrated and which were only
  configured.
- **Revise.** Make small, previewed, approved changes to an existing agent,
  based on requests, diagnostics, run history and changing needs.

## 6. What Pi does

Pi runs the agent: the model loop, tools, extensions, skills, MCP, sessions and
transcripts, subagents (through `pi-subagents`), and headless execution. Forge
uses those mechanisms instead of duplicating them, and follows Pi when Pi gains
a native mechanism Forge currently gets from a package. For example, Pi 1.4 has
built-in MCP support.

## 7. Architecture boundaries

- **Generated agent and Forge are separate.** A project carries its own build
  (generated files plus the agent runtime pinned in its build record) and its
  own copy of the Forge tooling. Updating the tooling never changes what agents
  see until the project is rebuilt.
- **Desired state vs native files.** `system.yaml` declares, and Forge derives
  `settings.json`, `mcp.json`, agent frontmatter and the launcher. Prompts,
  skills and README are the user's; Forge creates them once and never silently
  overwrites them.
- **Hybrid orchestration.** Declare responsibilities, capabilities, policies
  and workflow boundaries. Leave delegation, sequencing and tool choice to the
  agents at run time. No graph workflow engine.
- **Enforced vs advisory.** Tool allowlists, hidden MCP tools and per-call
  approval are enforced. Prose rules are guidance, and are never presented as
  enforcement.
- **Isolation.** `./run` gives the project its own Pi home and credentials and
  loads no global configuration. This is not an OS sandbox, and the
  documentation says so.

## 8. Design principles

Conversational (discussion before configuration) · developer-first
(inspectable, file-based, version-controlled) · Pi-native · composable (reuse
before building) · incremental (revise, never recreate) · minimal (no
abstraction without a demonstrated need) · verifiable (configured ≠ working) ·
safe (explicit permissions and approvals) · independent (agents run without
Forge).

Before adding anything, ask:

1. Does it make specialized agents easier to create, operate, verify or evolve?
2. Does Pi or an existing package already do it?
3. Can configuration do it instead of new code?
4. Does the generated agent stay independent?
5. Does it add an abstraction we could avoid?
6. Can it be built and tested on its own?
7. Does a real use case need it?

## 9. Non-goals

- An agent runtime, workflow or graph engine, scheduler, plugin API,
  marketplace or memory database of our own.
- A hosted management platform, visual editor or always-on daemon.
- Generated TypeScript extension code, unless no existing capability fits and
  the user agrees.
- Judging output quality automatically. Checks verify behavior, not quality.
- Autonomous consequential actions (publishing, payments, trades,
  destructive operations) without explicit, enforced authorization.
- Real external writes in automated tests.

## 10. Evolution strategy

Forge already works, and the Owlie marketing agent was built and maintained
with it. Change is incremental:

- Keep `system.yaml` schema 1 and extend it only additively, adding a field
  only when a reference use case needs it.
- Existing generated projects keep running and stay maintainable through every
  change, including the rename. A migration is previewed, approved and
  reversible, and compatibility aliases have a stated end.
- Prefer improving the discovery procedure and checks over adding schema
  types.
- When Pi gains a native mechanism for something Forge does, plan the move to
  it.
- Simplify the maintenance machinery only where the guarantees it provides are
  kept or explicitly given up.

## 11. Definition of success

- A developer gets a working specialized agent from a conversation, and can
  read and commit every file it consists of.
- Adding a capability ("connect Search Console", "publish approved posts")
  finds and inspects existing options, proposes a minimal change, and then shows
  the capability works rather than only that it is configured.
- A workflow runs unattended on a schedule, and its results and failures can
  be inspected afterwards.
- A revision uses evidence from real runs, and the user can see why it is
  proposed.
- Updating Forge never breaks or silently changes an existing agent.

## 12. Current priorities

In order (details and issues in [the roadmap](roadmap.md)):

0. **Pi Forge rename and command surface:** one `/forge` command, with old
   projects migrated rather than recreated.
1. **Capability composition:** discover, inspect, select and verify existing
   Pi packages, extensions and MCP servers.
2. **Execution and triggers:** a headless workflow contract, a run index, and
   scheduling through an existing provider.
3. **Functional verification:** agent-specific acceptance scenarios with
   diagnostic evidence.
4. **Operational evolution:** revisions informed by run evidence.
5. **Simplification:** reduce maintenance machinery where justified.
