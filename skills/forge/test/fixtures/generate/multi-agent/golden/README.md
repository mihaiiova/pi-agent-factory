<!-- forge:generated v1 sha256=7183f206b7ace8dea68f0d6dd64e2c49acd52d9340ec6bb6e87f210cec183560 -->
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

`/forge <request>` proposes a change; when the turn ends, Forge shows the
preview for you to approve or decline. `/forge review` is read-only.
`/forge check` verifies the agent, `/forge status` summarizes it, and
`/forge sync` moves to the newest Forge release after two confirmations.
Roll back with git. `/forge permissions` lists the commands agents may run
and adds, removes or reviews them; agents ask for a command they need with
`request_permission`. Restart `./run` when the launcher or packages change.

## Policy

### Enforced (cannot be bypassed)

None declared.

### Advisory (guidance — not enforced)

None declared.
