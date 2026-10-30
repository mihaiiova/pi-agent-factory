<!-- forge:generated v1 sha256=740261f15a5da87e56f6f7893139be04e596ccac09efd0963ee4f66bd38cd9cf -->
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

On the first interactive run, Pi may start npm package installation processes
that continue briefly after Pi exits and may keep output pipes open. Callers
should allow extra time before assuming the output stream has closed.

Authenticate inside `./run` with `/login`, or export
the provider-specific key (for example `DEEPSEEK_API_KEY`). See the policy
section below for which
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
