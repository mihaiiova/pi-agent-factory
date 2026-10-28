# Pi Forge — roadmap

Based on an audit of the repository at v0.18.0 (`217fc0b`, 2026-10-28), measured
against [the product direction](product-direction.md). Issues live in
GitHub under epic [#24](https://github.com/mihaiiova/pi-agent-factory/issues/24), indexed
listed at the end. Each one is scoped for a single implementation session.

## 1. Audit: what exists today

Facts below come from the source and from running the tests. Where something
is inferred instead, it is marked as an assumption.

- **Tests:** `bash skills/agent-factory/test/test.sh` passes: 25 node suites
  (≈215 tests) and 8 shell suites. Live inference and clean-environment network
  tests are opt-in and were skipped.
- **Size:** ≈5,900 lines of `.mjs`, of which ≈1,600 are maintenance
  (`maintenance*.mjs`).

| Capability | Status | Evidence |
|---|---|---|
| Conversational design (explore → synthesize → build) | Implemented, satisfactory | `SKILL.md`; scenarios in `docs/agent-factory-conversation.md`; skill-contract test |
| Declarative model and validator (`system.yaml` schema 1) | Implemented, satisfactory | `validate.mjs`, `schema.md`; strict unknown-key and reference checks |
| Deterministic generation, ownership, dry-run, idempotence | Implemented, satisfactory | `generate.mjs`; golden fixtures; fingerprint conflicts |
| Isolated launcher (`./run`) | Implemented, satisfactory | `runtime.mjs`; launcher and isolation suites |
| Per-agent models and thinking | Implemented, satisfactory | `models.mjs` |
| Skills from skills.sh (search, preview, pin, project-local install) | Implemented, satisfactory | `registry-skills.mjs`, `skill-sources.mjs` |
| Specialists, enforced tool allowlists, background launch for extension/MCP tools | Implemented, satisfactory | `policy.mjs`, `generate.mjs` (`needsBackground`), `asking.mjs` |
| Calls that ask the user, kept with the orchestrator | Implemented, satisfactory | `asking.mjs`; generated "What you can use" sections |
| Declared CLI commands with per-run approval, `request_permission` | Implemented, satisfactory | `cli-tools.mjs`, `permissions-extension.mjs` |
| MCP configuration, env-var credentials, hidden tools, `approveTools` | Implemented; may need improvement | `mcp-gen.mjs`. Depends on `pi-mcp-adapter` and disables Pi 1.4's built-in MCP (`-builtin:mcp` in `generate.mjs`) |
| Documents (agreed formats, MCP delivery) | Implemented, satisfactory | `documents.mjs` |
| Memory (`.pi/MEMORY.md`) | Implemented, satisfactory | `memory.mjs`, `agent-extension.mjs` |
| Revision via `/factory-update <request>` → preview → `apply` | Implemented, satisfactory | `maintenance-extension.mjs` (`factory_plan`), `maintenance.mjs` (`planChange`) |
| Builder-time discovery (`factory discover`) | **Partial** | Covers models, the user's skills, MCP config files, project agents and named CLIs. Pi packages and extensions are not covered (`factory.mjs` `runDiscover`) |
| Revision-time discovery (`factory_plan discover`) | **Partial** | skills.sh, npm free-text search (not filtered to `keywords:pi-package`), MCP registry, docs fetch |
| Package inspection before proposal | **Missing** | `packages[]` is only checked for a pinned spec (`deps.mjs`). Nothing reports what a package loads or registers, its install scripts, or its license |
| Selecting a subset of a package's resources | **Missing** | Pi supports `{source, extensions, skills, prompts}` filters (Pi `docs/packages.md`). `packages[]` accepts strings only |
| Effective-capability verification | **Partial** | `capabilities.json` is derived from declarations only. `launchCheck` checks subagent tools at session start against cached MCP lists and live registrations. It checks only the orchestrator's CLI commands, and there is no explicit command to run it |
| Workflows | **Partial** | Declared boundaries plus a generated orchestrating skill (`workflow-skill.mjs`). `trigger.kind` is `manual` or `headless`. There is no defined way to invoke one headlessly, and no exit-status or output contract |
| Scheduling and event triggers | **Missing** | Deferred by design in the MVP (`docs/agent-factory.md` decision 2) |
| Execution history | **Partial** | Pi sessions in `.factory/pi-home/sessions`. `subagentRuns` summarizes `pi-subagents` launches. Top-level headless runs are not recorded |
| Functional verification | **Missing** | `workflows[].verify` is free text. Live tests are opt-in and generic, not agent-specific |
| Maintenance: versioned bundles, integrity, update checks, rebuild, rollback, recovery | Implemented; **potentially overengineered** | ≈1,600 lines plus a 478-line doc. Gives offline rollback and independence from a global install. See the investigation in Milestone 5 |
| Import of non-Forge Pi projects | Implemented, satisfactory | `import.mjs` |
| Generating into an existing repository (use case C) | **Defect** | An existing `.gitignore` is kept unchanged, so `.factory/` (including `pi-home/auth.json`) and `.env` are not ignored. Reproduced with `factory generate` on a repository that has its own `.gitignore` |
| A coding harness reading its repository's own `AGENTS.md` | **Missing** | The launcher always passes `--no-context-files`, which also drops the project's own file |

**Owlie marketing agent** (`~/projects/owlie/marketing`, read only). It is on
0.18.0 and built with 0.18.0. It has OpenSEO and PostHog MCP, six declared
`gh` commands, `pi-web-access` (added by hand as a package, with nothing
attributing `web_search` to it), one declared workflow (`baseline`) and no
schedule. Its `run-history.jsonl` holds three failed specialist launches and no
record of the top-level runs. Search Console is reached only through OpenSEO's
`get_search_console_performance`. These observations shaped Milestones 1, 2
and 4.

## 2. Most significant gaps

1. **Packages and extensions are opaque.** Forge can pin a package but cannot
   say what it will load, register or execute, or whether a needed tool
   actually comes from it.
2. **No unattended execution.** There is no workflow invocation contract, no
   run record and no scheduling.
3. **Configured is not shown to work.** Checks stop at structure and
   availability. Agent-specific behavior is never exercised.
4. **Revision has little evidence.** It has only specialist-launch summaries
   and tool-failure flags from the current conversation.
5. **Credential exposure when generating into an existing repository**
   (defect).
6. **Naming and commands.** Old names, plus `/factory-update update`,
   `/factory-update check` (which checks for tooling updates, not the agent),
   and `apply` as a separate command.

## 3. Considered and rejected

| Proposal | Why rejected |
|---|---|
| A separate "conversational modification" feature | `/factory-update <request>` already inspects, proposes a small change, previews it and applies on approval. The real gaps are evidence (M4), schedules (M2) and the command surface (M0) |
| Execution evidence exposed as its own feature | Folded into M4: it needs the run index (M2) first |
| A plugin API or capability marketplace | Composition uses Pi packages, npm, the MCP registry and skills.sh as they are (non-goal) |
| A Forge scheduler or daemon | M2 configures an existing provider |
| A memory database or vector store | `.pi/MEMORY.md`, project files and Pi sessions cover the reference cases |
| A general evaluation framework or LLM grading | M3 checks observable behavior only |
| Implementing several schedule backends | One provider first, chosen by investigation |
| Per-build package pins (an idea in earlier notes) | No reference use case needs it yet |
| An investigation into naming | The name is decided: Pi Forge, `/forge` |
| Trading execution for use case B | Out of scope until enforceable risk and permission boundaries exist |

## 4. Milestones

Milestones may overlap. A hard dependency is a GitHub "Blocked by" link; a
soft one is noted as *after*.

### Milestone 0: Pi Forge rename, command surface, and a security fix

Goes first because everything later is written against the new names. Nothing
else is hard-blocked by the rename.

- [#25](https://github.com/mihaiiova/pi-agent-factory/issues/25) `fix-existing-repo-gitignore`: protect `.factory/` and `.env` when generating
  into an existing repository. No dependencies; small.
- [#26](https://github.com/mihaiiova/pi-agent-factory/issues/26) `forge-bridge`: the last `pi-agent-factory` release before the rename. Adds
  a protocol-2 front door, trusts both repository names, and migrates
  `.factory/` to `.forge/`.
- [#27](https://github.com/mihaiiova/pi-agent-factory/issues/27) `forge-rename`: **Rename pi-agent-factory to pi-forge and consolidate
  commands under /forge.** Blocked by `forge-bridge`.

**Migration sequence.** The order matters because the frozen protocol-1
front door accepts only `source: mihaiiova/pi-agent-factory` under
`.factory/runtime/`, and update checks use `redirect: 'error'`.

1. Release the bridge (v0.19.0) from `pi-agent-factory`. Projects update to it
   with `/factory-update update` and run the previewed migration to `.forge/`.
2. Rename the GitHub repository to `mihaiiova/pi-forge`. GitHub redirects the
   old URLs. Bridge-or-later projects accept exactly that one rename redirect.
3. Release `pi-forge` 1.0.0 with the `/forge` command surface. Bridge projects
   reach it with `/factory-update update` (still an alias) or `/forge sync`.
4. Projects older than the bridge that did not update before step 2 cannot
   follow the redirect. Recover them by running the deterministic
   `bootstrap-update` command from a pi-forge checkout. Nothing is recreated.
5. Old names (`/factory-update`, `/factory-permission`, `/agent-factory`, the
   protocol-1 front door) remain as aliases through 1.x and are removed in
   2.0.

### Milestone 1: Capability composition

- [#28](https://github.com/mihaiiova/pi-agent-factory/issues/28) `mcp-native-decision` *(investigation)*: Pi's built-in MCP vs
  `pi-mcp-adapter`.
- [#29](https://github.com/mihaiiova/pi-agent-factory/issues/29) `package-discovery`: find candidate Pi packages for a requested capability.
- [#30](https://github.com/mihaiiova/pi-agent-factory/issues/30) `package-inspection`: inspect an exact package version before proposing it.
- [#31](https://github.com/mihaiiova/pi-agent-factory/issues/31) `package-resource-selection`: load only the package resources an agent
  needs. Blocked by `package-inspection`.
- [#32](https://github.com/mihaiiova/pi-agent-factory/issues/32) `capability-check`: verify effective runtime capabilities (`/forge check`).
  *After* `mcp-native-decision` if that switches MCP implementations.
- [#33](https://github.com/mihaiiova/pi-agent-factory/issues/33) `coding-harness-context`: opt in to the repository's own `AGENTS.md` (use
  case C).

### Milestone 2: Execution and triggers

- [#34](https://github.com/mihaiiova/pi-agent-factory/issues/34) `workflow-invocation`: a headless workflow invocation contract.
- [#35](https://github.com/mihaiiova/pi-agent-factory/issues/35) `run-index`: record each headless run. Blocked by `workflow-invocation`.
- [#36](https://github.com/mihaiiova/pi-agent-factory/issues/36) `scheduler-decision` *(investigation)*: choose the provider. Pi scheduler
  packages are preferred, with systemd user timers as the fallback.
- [#37](https://github.com/mihaiiova/pi-agent-factory/issues/37) `workflow-schedule`: declare and install a schedule. Blocked by
  `workflow-invocation`, `run-index` and `scheduler-decision`. *After*
  `package-resource-selection` if the chosen provider is a package.

### Milestone 3: Functional verification

- [#38](https://github.com/mihaiiova/pi-agent-factory/issues/38) `acceptance-scenarios`: declare scenarios and evaluate a run against them.
  Blocked by `run-index`.
- [#39](https://github.com/mihaiiova/pi-agent-factory/issues/39) `scenario-runner`: run scenarios safely and report diagnostics. Blocked by
  `workflow-invocation` and `acceptance-scenarios`. *After*
  `capability-check`.

### Milestone 4: Operational evolution

- [#40](https://github.com/mihaiiova/pi-agent-factory/issues/40) `run-evidence-revision`: revisions and `/forge status` use run evidence.
  Blocked by `run-index`. *After* `scenario-runner`.

### Milestone 5: Simplification

- [#41](https://github.com/mihaiiova/pi-agent-factory/issues/41) `maintenance-simplification-decision` *(investigation)*: which maintenance
  machinery to keep, simplify or drop. *After* `forge-rename`, since both touch
  the same code.

## 5. Dependency order

```text
fix-existing-repo-gitignore
forge-bridge ─▶ forge-rename ··▶ maintenance-simplification-decision
mcp-native-decision ··▶ capability-check ··▶ scenario-runner
package-discovery
package-inspection ─▶ package-resource-selection ··▶ workflow-schedule
coding-harness-context
workflow-invocation ─▶ run-index ─▶ acceptance-scenarios ─▶ scenario-runner
                         │  └────▶ run-evidence-revision
scheduler-decision ──────┴──────▶ workflow-schedule
```

`─▶` blocks; `··▶` should come after.

## 6. Open decisions (each has an investigation issue)

- **MCP implementation:** Pi's built-in MCP (exposure modes, `pi mcp list`,
  OAuth) or `pi-mcp-adapter`, which current projects depend on for
  `excludeTools`, the tool cache used by launch checks, and subagent MCP
  selection.
- **Scheduling provider:** candidates that run with Pi closed are `pi-tick`
  (MIT, cron or launchd, run records), `agents-cron` (AGPL-3.0, project-local
  store, `run-due` from cron) and systemd user timers. Schedulers that run
  inside a session (`@e9n/pi-cron`, `@henryqw/pi-cron`, `pi-schedule-prompt`)
  need Pi open, so they don't fit unattended runs.
- **Maintenance architecture:** keep self-contained versioned bundles, or
  install Forge as a pinned Pi package inside each project and rely on git for
  history.

## 7. Issue index

| Issue | Milestone | Title |
|---|---|---|
| [#24](https://github.com/mihaiiova/pi-agent-factory/issues/24) | — | Epic: Pi Forge roadmap — design, generate, check, and revise specialized Pi agents |
| [#25](https://github.com/mihaiiova/pi-agent-factory/issues/25) | M0 | Protect .factory/ and .env when generating into an existing repository |
| [#26](https://github.com/mihaiiova/pi-agent-factory/issues/26) | M0 | Pi Forge migration bridge — front-door protocol 2, both repository names, .factory/ → .forge/ |
| [#27](https://github.com/mihaiiova/pi-agent-factory/issues/27) | M0 | Rename pi-agent-factory to pi-forge and consolidate commands under /forge |
| [#28](https://github.com/mihaiiova/pi-agent-factory/issues/28) | M1 | Decide between Pi's built-in MCP and pi-mcp-adapter |
| [#29](https://github.com/mihaiiova/pi-agent-factory/issues/29) | M1 | Discover Pi packages for a requested capability |
| [#30](https://github.com/mihaiiova/pi-agent-factory/issues/30) | M1 | Inspect an exact Pi package version before proposing it |
| [#31](https://github.com/mihaiiova/pi-agent-factory/issues/31) | M1 | Load only the package resources an agent needs |
| [#32](https://github.com/mihaiiova/pi-agent-factory/issues/32) | M1 | /forge check verifies an agent's effective capabilities |
| [#33](https://github.com/mihaiiova/pi-agent-factory/issues/33) | M1 | Let a coding harness load its repository's own AGENTS.md |
| [#34](https://github.com/mihaiiova/pi-agent-factory/issues/34) | M2 | A headless invocation contract for declared workflows |
| [#35](https://github.com/mihaiiova/pi-agent-factory/issues/35) | M2 | Record each headless run in a run index |
| [#36](https://github.com/mihaiiova/pi-agent-factory/issues/36) | M2 | Choose the scheduling provider for unattended workflow runs |
| [#37](https://github.com/mihaiiova/pi-agent-factory/issues/37) | M2 | Declare and install a schedule for a workflow |
| [#38](https://github.com/mihaiiova/pi-agent-factory/issues/38) | M3 | Declare acceptance scenarios and evaluate a run against them |
| [#39](https://github.com/mihaiiova/pi-agent-factory/issues/39) | M3 | Run acceptance scenarios safely and report diagnostics |
| [#40](https://github.com/mihaiiova/pi-agent-factory/issues/40) | M4 | Use run evidence in /forge status and in revisions |
| [#41](https://github.com/mihaiiova/pi-agent-factory/issues/41) | M5 | Decide which maintenance machinery Pi Forge keeps |

**Execute first:** [#25](https://github.com/mihaiiova/pi-agent-factory/issues/25) (security fix, small, unblocked), then [#26](https://github.com/mihaiiova/pi-agent-factory/issues/26) (the bridge must ship before the repository rename), then [#27](https://github.com/mihaiiova/pi-agent-factory/issues/27) (so later work lands under the final names). [#30](https://github.com/mihaiiova/pi-agent-factory/issues/30) and [#34](https://github.com/mihaiiova/pi-agent-factory/issues/34) are unblocked and can run in parallel.

