<!-- forge:generated v1 sha256=4a0ac32163ab51e3609200a41866f16cb5ed8ab0df05b2a064374c4f48722487 -->
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

`/forge <request>` proposes a change; when the turn ends, Forge asks you
to discuss, apply or discard it. Replies continue the conversation until
then; `/forge exit` leaves. `/forge review` is read-only.
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
