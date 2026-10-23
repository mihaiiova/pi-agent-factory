# Problem Statement

The factory must discover and configure external capabilities (MCP servers, CLIs, integration skills) and express coarse policy (tool allowlists, approval boundaries). Example: OpenSEO is already running on localhost:3002 and exposes an MCP server that the SEO analyst must use.

# Solution

Implement `factory discover` — a deterministic, read-only inventory of installed skills, configured MCP servers (parsed from `mcp.json` files, optionally `pi mcp list` for live status), available subagents, curated CLIs on PATH, and known pi-config integration skills. Extend the generator to write `.pi/mcp.json` from `integrations.mcp[]` and `.env.example` from `integrations.env[]`. Materialize policy: agent `tools:` allowlists (spec 3) plus `policies.approvals` surfaced as README/workflow instructions.

# User Stories

- `factory discover` reports OpenSEO (an MCP server at localhost:3002) and other capabilities.
- A generated project with `integrations.mcp: [openseo]` produces a working `.pi/mcp.json`; `pi mcp list` shows it connected.
- The analyst agent's allowlist exposes the OpenSEO MCP namespace; publishing still requires human approval (declared).

# Implementation Decisions

- `discover` is pure/read-only: parse MCP files (stdio `command`/`args`/`env`/`cwd` and HTTP `url`/`headers`/`oauth`), probe curated CLIs via `command -v`, scan skill directories for `SKILL.md` (name + description), and list subagents via `subagent({action:"list"})`.
- MCP config is written as standard `mcpServers` entries; secrets use `${ENV}` references, never literal values.
- Approval policy stays declarative (README + workflow instructions) in the MVP; a `tool_call`-guard extension is documented as the deferred mechanism (Decision 3 in the architecture doc).
- Reuse `pi-mcp-adapter` semantics: `.pi/mcp.json` is the canonical project file; discovery is lazy.

# Testing Decisions

- Seam: `discover.mjs` parsers (MCP-file parsing, CLI probe, skill scan) unit-tested against fixtures.
- Seam: `mcpGen.mjs` (integrations → `mcp.json`) unit-tested, including `${ENV}` secret handling (never inlines a secret).
- Integration (gated): generate a project pointing at a local stub MCP server and assert `pi mcp list` reports it; when no live server is available, assert the generated file is valid JSON and skip the live check.
- Policy materialization test: a `policies.approvals` entry produces the expected README/workflow text.

# Compatibility Implications

- No change to `pi-mcp-adapter` or global MCP config; generated projects are self-contained.
- Discovery never mutates anything.

# Out of Scope

- Generating MCP server implementations; fine-grained runtime approval extensions; scheduled triggers.

# Dependencies

- `agent-factory-scaffold`.
