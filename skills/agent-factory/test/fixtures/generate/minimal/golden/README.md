<!-- agent-factory:generated v1 sha256=bf7844e78e5b42ba7893f4ad6d45ebc57ba74a0b8cfc28e9731adf70c025782b -->
# seo-agent-system

SEO analysis + article drafting

## Run

The generated `./run` launcher is the entry point. It starts Pi with the
project's own isolated config directory so your global skills, MCP servers,
extensions, and credentials are not inherited.

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
