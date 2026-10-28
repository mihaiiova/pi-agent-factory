# Generated-system maintenance: `/factory-update`

Agent Factory remains the development-environment builder. `/agent-factory` is
its convenience alias. Generated systems do **not** install the global Agent Factory.
They contain a minimal, versioned Factory maintenance engine and expose a
separate `/factory-update` command.

## Try it

From an Agent Factory checkout with its pinned packages installed:

```sh
mkdir -p /tmp/my-agent/.pi
cp skills/agent-factory/test/fixtures/generate/minimal/.pi/system.yaml /tmp/my-agent/.pi/system.yaml
node skills/agent-factory/factory.mjs generate /tmp/my-agent --dry-run
node skills/agent-factory/factory.mjs generate /tmp/my-agent
cd /tmp/my-agent
./run
```

Accept Pi's project-trust prompt only after reviewing the generated project.
Authenticate with `/login` inside this isolated runtime, or supply a provider key in
the environment. Credentials are never copied from the development environment.
Conversational requests require a configured model; verification tests do not.

```text
/factory-update review
/factory-update how can we improve this agent?
/factory-update add a reviewer agent
/factory-update use a cheaper model for research
/factory-update add a Google Search Console MCP
/factory-update remove the Cloudflare integration
/factory-update add a skill for keyword research
/factory-update change the orchestrator instructions
/factory-update apply
/factory-update check
/factory-update update
/factory-update rollback
/factory-update done
```

Requests inspect the model and relevant generated resources, then propose the
smallest structured change. Public npm/MCP-registry discovery asks permission
before sending search terms; available model IDs/cost metadata come from the
isolated session's model registry. Discovered content is untrusted, and neither
an MCP response nor model text authorizes installation. Unverifiable integration
facts must be flagged, not invented.

`apply` shows the exact pending model/file/capability diff and asks for a local
UI confirmation. Model-facing previews use redacted structural model/JSON diffs;
the local human confirmation retains the exact formatting diff. It labels new packages, changed MCP configuration, and changed
tools/policies: packages and stdio MCP servers execute code at the next launch.
Declining, missing UI, validation failure, authored-file conflicts, and edits
made since the preview prevent application. `done` discards the pending proposal.
Pending proposals are session-local and never survive a restart. Use the slash
command again for follow-up maintenance turns. After applying, Pi reloads by
itself; a restart of `./run` is asked for only when the launcher or the package
list changes (for example a newly declared environment variable).

Review is read-only: its only active tool is the maintenance inspector/planner,
which rejects proposals in review mode. Recommendations distinguish execution-
supported observations, configuration inconsistencies, architectural
opportunities, and speculative optimizations. Execution evidence is currently a
summary of tool names/failure flags from the current conversation; it is not a
benchmark, full cost profiler, or proof of root cause. Recommendations never apply
automatically.

## Bootstrap an older Factory project

No recreation or import is needed if `.pi/system.yaml` already exists:

```sh
node /path/to/pi-agent-factory/skills/agent-factory/factory.mjs bootstrap-update /path/to/agent --dry-run
node /path/to/pi-agent-factory/skills/agent-factory/factory.mjs bootstrap-update /path/to/agent --yes
cd /path/to/agent
./run
```

Bootstrap validates the raw model, inspects existing settings/MCP configuration,
reports consistency issues, installs maintenance entrypoints/bundle/metadata,
and creates the derived capability manifest. It leaves authored instructions,
agent/skill content, operational settings, MCP declarations and secrets alone.
Only a missing or recognized Factory launcher is installed/upgraded; a custom
launcher or colliding maintenance entrypoint is a conflict, never overwritten.
The recognized old launcher gains `--no-context-files` to suppress ancestor
instructions. The preview lists all infrastructure changes.

Only `schema: 1` with per-agent models is supported; there is no migration from
the earlier tier-based layout. Such projects are redefined, not converted.
Unsupported schemas fail closed. `factory import` remains the
separate entry point for non-Factory Pi projects; its conservative import scaffolding does not leave a
maintenance loader without an installation. Follow import with a previewed
`generate` or `bootstrap-update` to install maintenance.

## Deterministic changes

`changes.mjs` edits YAML document nodes where possible and validates the final
batch with the existing schema validator. Unchanged nodes retain comments and
formatting. Full-model replacement can reformat YAML.

```json
[
  {"op":"add","target":"agent","name":"reviewer","value":{"model":"provider/exact-model-id","tools":["read"],"prompt":"Review the findings."}},
  {"op":"assign","name":"researcher","model":"provider/other-model-id","thinking":"low"}
]
```

- `add/update/remove`: `mcp`, `env`, `agent`, `skill`, `workflow`. An `env`
  entry declares a variable name (and `secret`); values are never part of a
  proposal.
- `assign`: orchestrator or specialist name → its own `provider/id` model, with
  an optional `thinking` level (`null` removes it). Pick from the Pi line-up the
  inspection reports.
- `set`: replace `orchestrator`, `integrations`, `policies`, `packages`.
- `replace`: a complete validated `model` for uncommon changes.

A vendored skill (`source` path) must already be copied into
`.pi/skills/<name>/` before its declaration is accepted, and its directory must
be deleted explicitly before the declaration is removed.

Repair dependent workflow/policy/skill references in the same batch; dangling
references fail validation. Removed agent/skill files are deleted only when they
exactly match intact generated scaffolds. Edited/unmarked authored files cause a
conflict instead. Changed unmarked instructions cannot silently shadow a new
model declaration. Literal credentials in newly changed secret-shaped fields
are rejected; use `${ENV}` references. Removing a packaged skill declaration
removes its package unless `packages` or another skill still declares it;
consider that package's other capabilities before removing it.

CLI equivalents (noninteractive application requires explicit `--yes`):

```sh
node /path/to/pi-agent-factory/skills/agent-factory/factory.mjs change /path/to/agent --operations changes.json --dry-run
node /path/to/pi-agent-factory/skills/agent-factory/factory.mjs change /path/to/agent --operations changes.json --yes
```

### Rebuild

`/factory-update rebuild` regenerates the project from `system.yaml` with the
installed Factory version and pins its agent runtime (`reconcile` is the same
command). When only text agents read changes — prompts, capability sections,
skill text, README — it applies without asking. When it would change what
agents can run or reach — the launcher, settings, MCP configuration, an agent's
tools, model or launch settings, `capabilities.json`, or skill installs — it
shows the preview and asks first. It says so when the project is already built
with this version.

A proposed change also rebuilds whatever this version generates differently
(a newer Factory, or a hand edit to a generated file, which is lost); the
preview lists those files under `reconciliation`. Direct hand-edits to generated capability
configuration are not the primary maintenance mechanism; `system.yaml` remains
authoritative. The older `factory modify` reconciliation command is preserved.

## Layout and ownership

```text
.pi/system.yaml                          declarative operational model
.pi/extensions/factory-update/index.ts    stable protocol-1 loader, infrastructure
.pi/skills/factory-update/SKILL.md         stable maintenance front door, infrastructure
.factory/installation.json               active bundle identity/pointer
.factory/previous-installation.json      previous working identity/pointer
.factory/build.json                      bundle that last built the project (agent runtime pin)
.factory/capabilities.json               derived operational + maintenance surface
.factory/runtime/<revision>-<digest>/    minimal engine,
                                         workflow/schema docs, pinned yaml + license
.factory/pi-home/                        isolated Pi config/auth/package installation
.factory/update-cache.json               successful discovery cache (~24h)
.factory/update-failure.json             persistent check failure (cleared on success)
.factory/transaction.json                recoverable pre-transaction journal
```

### Tooling and agents

A generated system has two parts that update separately. The **build** is what
agents use: the generated files (prompts with their "What you can use"
sections, settings, MCP configuration, launcher) and the agent runtime — the
orchestrator's memory, declared command tools, `request_permission` and
`/factory-permission`. The **tooling** is `/factory-update` itself.

`.factory/installation.json` points at the tooling. `.factory/build.json` records
the bundle that last built the project, and the tooling loads the agent runtime
from that bundle (after verifying its integrity). Updating the tooling
therefore changes nothing agents see; the build moves to the new version only
when the project is regenerated by a change or a rebuild. Until then, session
start says which version the project was built with. A pinned
bundle that fails verification is reported at session start and the tooling's
own agent runtime is used until the next build. Projects built before
`build.json` existed use the tooling's agent runtime until their first build.

Maintenance entrypoints are reserved infrastructure, not `system.yaml.skills`.
They cannot accidentally disappear when an operational skill is removed.
Protocol-1 front doors remain stable across upgrades; the real command handler
and workflow instructions are loaded from the active versioned bundle. Later
upstream scaffold-copy changes neither overwrite the front doors nor block
operational maintenance. A required loader-protocol change is incompatible and
requires a separately reviewed newer bootstrap implementation.

The bundle copies **only** its manifest-listed engine files, the existing pure
model-settings adapter, YAML's runtime/metadata/license, and small reference
files. It does not copy global instructions, integrations, auth, skills or
extensions. `yaml` is vendored at the exact version in that Factory revision's
`pi.packages`; normal operational dependency pins remain separate and unchanged
by a Factory upgrade.

Installation records the trusted repository (`mihaiiova/pi-agent-factory`), update
channel (`releases`), actual git revision, actual repository version, bundle
integrity, schema/protocol support, dependency pins, and entrypoint fingerprints.
Uncommitted Factory builds are explicitly marked `developmentSnapshot`; the
content digest identifies the actual installed bytes rather than claiming they
were contained in HEAD. Use a committed checkout for remotely reproducible
installations. The `releases` channel follows the highest
`vX.Y.Z` tag of the trusted repository (pre-release and other tags are ignored).
Older installations on the `development` channel keep following that branch
head, and pinned `tags/vX.Y.Z` identities are accepted. Arbitrary repositories and
URLs are not accepted from requests or model content.

`.factory/` remains gitignored by the existing Factory contract. A generated
working directory is standalone; copying only its tracked files is **not** a
backup of the maintenance installation. Copy `.factory/installation.json`,
`.factory/build.json`, the runtime directories they and the previous metadata
name, and that metadata for offline transfer;
do not copy `.factory/pi-home/auth.json` or other credentials. A fresh clone can
use the deterministic bootstrap procedure.

## Update checks and installation

Every ordinary `./run` session starts a fire-and-forget check in Pi's
`session_start` handler. Valid successful cache entries avoid networking for
24 hours. Requests have a four-second startup deadline, and shutdown aborts
in-flight work. Network failures, timeouts, rate limits and 5xx responses are
silent and not recorded. A persistent failure — the source answers but the check
cannot use the answer (for example HTTP 404 because the project was generated
from an unpushed Factory commit) — is recorded in `.factory/update-failure.json`
and announced at most once a day:

```text
Factory update check is failing: <error>
Run /factory-update check for details.
```

`/factory-update check` then reports the error, when it started failing and, for
a 404, the unpushed-commit hint. The next successful check clears the record.
Current installations are silent. A newer compatible release produces only
a terminal UI notice:

```text
Factory update available: <actual-version> (<revision-prefix>)
Run /factory-update update to upgrade.
```

No update is installed, no model message is sent, and no system prompt is
modified. `PI_OFFLINE=1`, `./run --offline`, or `PI_NO_UPDATE_CHECK=1` suppress
automatic checks. An explicit `check` bypasses the cache and reports installed
identity, source/channel, latest revision, compatibility/migration information,
and `checked` versus `unavailable` (not a false "up to date"). Explicit checks
and updates search up to 20 older releases (or, on the `development` channel,
development-history commits) when the newest one is incompatible, selecting the newest compatible candidate and reporting both
head and target. Automatic startup checks inspect only the head (or a candidate
already cached by an explicit check), keeping routine discovery lightweight. Revision ordering is verified against the trusted repository's GitHub comparison
API: an older channel head is not an upgrade, and diverged/unknown history is
not installed. An unpublished local revision may therefore report that ordering
could not be established until it is published. No GitHub token is required. In print mode there is no terminal UI notice; use explicit checks.

`update` resolves the trusted channel, stages its **exact commit** using git
objects from the fixed HTTPS repository, verifies the fetched SHA and allowed
source paths, and builds a content-addressed bundle. Git hooks/config rewrites
are disabled and credentials are not passed to git. A changed YAML dependency
is installed in a temporary directory using exact pins, npm integrity checking,
no lifecycle scripts, isolated npm configuration/cache, and no transitive graph.
Downloaded Factory code is not executed before source verification and approval.

The confirmation includes versions/revisions, changed maintenance files,
bounded tooling diffs, dependency changes and staged full-source location.
After approval, syntax and credential-free consistency checks run against the
current model using a scrubbed environment and temporary HOME/Pi home.
Activation changes only installation metadata/pointers. A failed stage/check
leaves the active pointer untouched.

Right after activation, the new version rebuilds the project in the same
scrubbed environment (see [Rebuild](#rebuild)), so one command updates both the
tooling and the build. When only text agents read changes, nothing more is
asked. When the rebuild would change what agents can run or reach, its preview
is shown for a second confirmation; declining keeps the previous build (agents
keep its runtime) until `/factory-update rebuild`. Pi then reloads, or asks for
a restart when the launcher or package list changed. User content and secret
values are never touched. Updates started from Factory versions before 0.18
activate only the tooling: restart, then run `/factory-update rebuild`. Installation writes use atomic rename plus a
recoverable transaction journal. Versioned directories are retained (including
at least the previous working version); no automatic deletion of old versions
or operational data is performed.

Schema changes are never implicit. Incompatible protocol/schema candidates are
reported, not installed. Current migrations use a separately previewed/approved
model proposal. Future schemas requiring newer migration code must be handled
with a compatible main Factory revision; do not replace declarations with guessed
fields.

`rollback` verifies the previous local bundle, validates the **current** model
with the previous engine, previews and confirms, then restores the previous
metadata/pointer and that version's pinned dependency tree. It never accesses
GitHub, and never blindly reverses subsequent model edits. A schema incompatible
with the old engine blocks rollback until explicitly reconciled.

## Crash recovery and offline escape hatch

`/factory-update recover` previews interrupted transaction paths and a stale
lock, asks for approval, and restores before-state only if disk still matches
journal before/after values. Later user edits produce a recovery conflict,
leaving evidence intact. A live PID lock cannot be recovered. From the main
installation: `factory.mjs recover <dir> --dry-run`, then repeat with `--yes`.

If Pi itself cannot load an entrypoint, no global installation or GitHub is
needed. Find the installed/previous runtime path in the local JSON metadata and
run that retained bundle's offline CLI, for example:

```sh
node .factory/runtime/<revision>-<digest>/skills/agent-factory/maintenance-cli.mjs recover . --dry-run
node .factory/runtime/<revision>-<digest>/skills/agent-factory/maintenance-cli.mjs recover . --yes
node .factory/runtime/<previous-revision>-<digest>/skills/agent-factory/maintenance-cli.mjs rollback . --yes
```

Review recovery conflicts manually rather than deleting journals/locks blindly.
PID reuse can conservatively prevent stale-lock recovery; confirm no maintenance
process is live before repairing an ambiguous lock.

## Documentation retrieval

During a `/factory-update` request, `factory_plan` can read public
documentation so the maintainer can verify an integration before proposing it:

```json
{"action":"fetch","url":"https://github.com/github/github-mcp-server"}
{"action":"fetch","url":"https://github.com/github/github-mcp-server/releases/latest"}
{"action":"fetch","url":"https://github.com/github/github-mcp-server","offset":40000}
```

- Any public `https://` URL on the default port. `github.com` repository,
  `blob` and `releases` pages are read in raw form (README text, file content,
  release JSON). HTML is reduced to readable text; text, JSON, XML and YAML are
  accepted, anything else is refused.
- Results carry the requested and final URL, redirects, retrieval time, status,
  content type, total length and a 40,000-character slice; `nextOffset`
  continues a longer document without fetching it again.
- The user approves each new host once per maintenance request; the approval
  and fetched documents are discarded when the turn ends.
- SSRF protection: every hop (up to 5 redirects) is validated before
  connecting. Hosts must resolve only to globally routable addresses — private,
  loopback, link-local, CGNAT, metadata, multicast, reserved, NAT64/6to4 and
  IPv4-mapped forms are refused — and the connection is pinned to the checked
  address, so a second DNS answer (rebinding) is never used. TLS is verified.
  One 15-second deadline covers DNS, redirects and the body; bodies are capped
  at 2 MB.
- No cookies, credentials, proxies or local files are used. URLs with
  embedded credentials or credential-like query parameters (`token`, `key`,
  `signature`, …) are refused rather than sent.
- Retrieved content is labeled untrusted data. It cannot apply, install or
  approve anything; a failed fetch is reported as unverified.

`action=discover` also accepts `clis` (e.g. `"docker gh"`) to report which
commands exist on this machine's PATH, without running them.

## Document formats

`documents[]` records how one agent writes one document. Ask for a change in
plain words (`/factory-update make the strategy doc a one-page decision doc`);
the maintainer first proposes the structure in text, you adjust it, and only
then does it preview a `document` operation for `/factory-update apply`. The
format is rendered into the writer's instructions under "Document formats".
`/factory-update review` also flags documents with no agreed format.

## Skills from skills.sh

`factory_plan discover` with a query searches skills.sh alongside npm and the
MCP registry; with `skill: "owner/repo@name"` it pins that skill to the
repository's current commit and returns its `SKILL.md` and file list. A
proposal declares `source: skills:<owner>/<repo>/<dir>@<commit>` and lists the
skill on the agents that should have it. The preview includes the skill's
contents. On `/factory-update apply`, `npx skills@1.7.4 add <tree URL> --agent
pi --copy -y` installs it into `.agents/skills/<name>/` in the project (never
globally) and `skills-lock.json` records the commit; an installed `SKILL.md`
that differs from the preview, or a lock without the pinned commit, is removed
and nothing is applied. Removing the declaration removes the copy. The CLI
honors `DISABLE_TELEMETRY=1`/`DO_NOT_TRACK=1` from your environment.

## Specialist launches

Foreground subagents never load extensions, so a specialist with MCP or
extension tools would start without them. The factory marks such agents
`async: true` and writes `forceTopLevelAsync: true` to
`.factory/pi-home/extensions/subagent/config.json`. `factory_plan inspect`
reports `subagentRuns` — per agent, recent launches, failures and the first line
of the latest failure diagnostic — so review can point at a broken specialist.
A model-free launch check runs at every session start and in `inspect`: for each
agent it confirms MCP servers have connected and expose the selected tools
(after `includeTools`/`excludeTools`), extension tools are registered, declared
skills are installed and background launch is configured, and it names any gap.
Projects generated before 0.7.0 get the change through `/factory-update update`
followed by `/factory-update rebuild` (or any applied change).

## Integration credentials

Declare each variable an integration needs in `integrations.env` and reference
it as `${NAME}` in MCP configuration. `./run` loads exactly the declared names
from the project's gitignored `.env`: lines are parsed, never sourced, so a
value cannot run commands, and a variable already set in the shell wins.
Names that change how the shell, Node, Pi or the network stack behave
(`PATH`, `NODE_OPTIONS`, `LD_*`, proxies, `PI_CODING_AGENT_DIR`, …) cannot be
declared.

The maintainer declares variables in a proposal; the human sets values:

```text
/factory-update env                 # which declared variables are set (never values)
/factory-update env set GITHUB_PAT  # prompt for the value and save it to .env
```

The value is typed into a local prompt and written straight to `.env` (mode
600). It never passes through the model or the session. Pi's prompt is not
masked, so the value is visible while typing. Restart `./run` to load it.

## Security boundaries and limitations

- Only the direct user command arms `factory_plan`; it is hidden/unreachable in
  ordinary workflows and model-only while armed (not callable through codemode).
  During a maintenance turn it is the only active tool. The operational loadout
  is restored afterwards. The planner has **no** apply/install/Bash/write action.
- Apply/update/rollback/recover require a separate direct command and an
  interactive UI confirmation. A headless model cannot approve itself. CLI
  `--yes` is an explicit human/automation authority, not a model permission.
- The launcher uses an isolated `PI_CODING_AGENT_DIR` and
  `--no-context-files`, including for ancestor instructions. Project instructions
  belong in `system.yaml`/`APPEND_SYSTEM.md`. Specialist project-context
  inheritance is an explicit opt-in and should be reviewed before enabling.
- Pi extensions run with the OS user's permissions. This is **not an OS
  sandbox**. Already-authorized Bash/write tools or malicious trusted extensions
  could bypass file-management conventions, read local auth, or write outside
  the project. Maintenance adds none of those operational privileges, but cannot
  revoke pre-existing OS authority. Deactivating tools is not a sandbox against
  malicious extension code. Likewise `PI_OFFLINE` is a no-network intent, not
  a network namespace.
- Trusted-repository HTTPS + exact git-object identity and per-file hashes verify
  provenance/integrity, not a maintainer signature or proof that upstream code is
  safe. Inspect the update diff. Approval authorizes execution of that trusted
  revision. Scrubbed check environments avoid passing credentials, but a trusted
  program running as the user still has filesystem access.
- Inspection and model-facing diffs redact recognized secret fields and known
  token formats; safe environment references remain visible. No auth file or
  environment secret is read by inspection. Redaction is best-effort, not DLP:
  credentials embedded in arbitrary prose/commands cannot be reliably identified.
  Keep secrets out of declarative/authored content and use environment references.
- Public discovery is npm/MCP-registry lookup, the isolated model registry and
  read-only documentation retrieval. Retrieved pages are evidence, not proof of
  integration quality; their content can attempt prompt injection, which the
  maintainer must ignore and which cannot reach the apply path.
  Only current-session tool-result summaries are automatic execution evidence.
- Configuration/metadata transactions are recoverable, not filesystem-wide
  ACID against unrelated editors or power loss. Cooperating maintenance writers
  use a lock; concurrent external edits are unsupported and fingerprint/recovery
  conflicts fail conservatively.

## Automated verification

```sh
bash skills/agent-factory/test/test.sh
node --test skills/agent-factory/test/maintenance.test.mjs
```

Network/update fixtures are local/mocked. Tests cover generation, bootstrap,
structured operations/references, authored conflicts, approval/drift, comment
preservation, migration separation, isolation/minimal bundling, cache/offline/
no-update/notification behavior, trusted identity/revision-order validation, staged failures,
maintenance-only activation/rollback, credential boundaries, crash recovery and
real Pi SDK extension loading/command dispatch without inference. The SDK test
explicitly skips if Pi is unavailable. Real GitHub installs, provider inference,
and live third-party integrations are intentionally not required by the suite.
Legacy live inference/MCP smoke tests now require `RUN_FACTORY_LIVE_TESTS=1`
(and may incur provider costs); the clean-environment network test remains
opt-in with `RUN_CLEAN_ENV_TEST=1`. Both print explicit skip reasons by default.
