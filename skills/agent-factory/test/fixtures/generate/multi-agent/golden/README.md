<!-- agent-factory:generated v1 sha256=0aa635a03eb0fd855d54dbf4f27ac650dec434cb0fd3a2b4902a74bdddd54e31 -->
# seo-agent-system

SEO analysis + article drafting with specialist subagents

## Run

The generated `./run` launcher is the entry point. It starts Pi with the
project's own isolated config directory so your global Pi settings, MCP
servers, extensions and credentials are not inherited. Skills in the shared
Agent Skills folder (`~/.agents/skills/`) do load, for the orchestrator.

```sh
./run             # interactive
./run -p "..."   # headless one-shot
```

Authenticate inside `./run` with `/login`, or export
`PI_API_KEY` / a provider key. See the policy section below for which
capabilities are enforced vs advisory.

## Maintain

Use `/factory-update <request>` to propose a declarative change, then
`/factory-update apply` to preview and approve it. `/factory-update review`
is read-only. Tooling lifecycle: `/factory-update check`, `update`, `rollback`.
Startup checks never install updates. Restart `./run` after applying changes.

## Policy

### Enforced (cannot be bypassed)

None declared.

### Advisory (guidance — not enforced)

None declared.
