# Problem Statement

The factory must discover and configure external capabilities (MCP servers, CLIs, integration skills) and express policy with an honest split between what is **enforced** (a capability boundary an agent cannot bypass) and what is **advisory** (behavioral guidance). Example: OpenSEO runs on localhost:3002 and exposes an MCP server; the analyst may read it, but publishing an article must not happen automatically.

# Solution

Implement `factory discover` — a deterministic, read-only inventory of installed skills, configured MCP servers (parsed from `mcp.json` files, optionally `pi mcp list`), available subagents, curated CLIs on PATH, and known pi-config integration skills. Extend the generator to write `.pi/mcp.json` from `integrations.mcp[]` and `.env.example` from `integrations.env[]`. Materialize policy as two categories:

- **Enforced (least-privilege, no runtime guard needed):** agent `tools:` allowlists (pi-subagents — a child literally lacks unlisted tools) and MCP `toolExposure: hidden` for destructive tools (e.g. `publish_*`, `delete_*`), so they are registered but unreachable.
- **Advisory:** README + workflow/skill text stating approval requirements (e.g. "publishing requires human confirmation; the workflow drafts to `data/articles/` and the user publishes").

# User Stories

- `factory discover` reports OpenSEO (an MCP server at localhost:3002) and other capabilities.
- A generated project with `integrations.mcp: [openseo]` produces a working `.pi/mcp.json`; `pi mcp list` shows it connected.
- The analyst agent's allowlist exposes the OpenSEO read tools; `publish_*`/`delete_*` tools are hidden and unreachable; publishing is a human step.
- The README clearly marks which restrictions are enforced and which rely on instructions.

# Implementation Decisions

- `discover` is pure/read-only: parse MCP files (stdio `command`/`args`/`env`/`cwd` and HTTP `url`/`headers`/`oauth`), probe curated CLIs via `command -v`, scan skill directories for `SKILL.md` (name + description), and list subagents via `subagent({action:"list"})`.
- MCP config is written as standard `mcpServers` entries; secrets use `${ENV}` references, never literal values. `toolExposure` hides destructive tools (verified MCP feature: per-tool exposure overrides, `hidden` = registered but unreachable).
- **Default to non-destructive:** the factory never grants a privileged tool (publish/deploy/delete) to any agent; when enforcement is required but the capability must not exist for an agent, the tool is simply not granted or is hidden.
- No runtime `tool_call`-guard extension is built in the MVP (Decision 3). It is documented as the deferred mechanism for the residual case — enforcing use of a tool that *must* remain present. This is called out explicitly so skill prose is never mistaken for enforcement.
- Reuse `pi-mcp-adapter` semantics: `.pi/mcp.json` is the canonical project file; discovery is lazy.

# Testing Decisions

- Seam: `discover.mjs` parsers (MCP-file parsing, CLI probe, skill scan) unit-tested against fixtures.
- Seam: `mcpGen.mjs` (integrations → `mcp.json`) unit-tested, including `${ENV}` secret handling and `toolExposure: hidden` materialization.
- Seam: `policy.mjs` (policies → allowlists + advisory text) unit-tested: an enforced allowlist restricts an agent's `tools:`; a hidden MCP tool is unreachable; advisory text lands in README/workflow output with an enforced-vs-advisory marker.
- Integration (gated): generate a project pointing at a local stub MCP server and assert `pi mcp list` reports it (or, when no live server is available, assert the generated file is valid JSON and skip the live check).

# Compatibility Implications

- No change to `pi-mcp-adapter` or global MCP config; generated projects are self-contained.
- Discovery never mutates anything. The enforced/advisory split reuses existing seams (subagent `tools:`, MCP `toolExposure`) — no new permissions framework.

# Out of Scope

- Generating MCP server implementations; a runtime permission engine; fine-grained runtime `tool_call`-guard extensions; scheduled triggers.

# Dependencies

- `agent-factory-scaffold`.
