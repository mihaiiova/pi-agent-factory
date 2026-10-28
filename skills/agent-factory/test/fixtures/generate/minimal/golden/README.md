<!-- agent-factory:generated v1 sha256=c63aea4d2ff2b1255453ab2ebf32c17912807ed236ea53c101ef7f2cd0adba3a -->
# seo-agent-system

SEO analysis + article drafting

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
`/factory-permission` lists the commands agents may run and adds, removes or
reviews them; agents ask for a command they need with `request_permission`.
Startup checks never install updates. Restart `./run` after applying changes.

## Policy

### Enforced (cannot be bypassed)

None declared.

### Advisory (guidance — not enforced)

None declared.
