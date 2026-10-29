<!-- forge:generated v1 sha256=38b3e19b62f9e32198aa2c4d1924b5665be21513dbf9d42fc5ac020cf300846f -->
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
is read-only. `/factory-update check` reports a newer Forge release;
`update` moves the pin after two confirmations. Roll back with git.
`/factory-permission` lists the commands agents may run and adds, removes or
reviews them; agents ask for a command they need with `request_permission`.
Restart `./run` when the launcher or packages change.

## Policy

### Enforced (cannot be bypassed)

None declared.

### Advisory (guidance — not enforced)

None declared.
