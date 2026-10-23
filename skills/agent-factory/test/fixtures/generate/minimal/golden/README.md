<!-- agent-factory:generated v1 sha256=2ae950fabe2129dac7ca87ae75a8eb2a979bb134eed3aa265f3c764ce76ab3c6 -->
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

Authenticate once in the isolated context (`./run --login`), or export
`PI_API_KEY` / a provider key. See the policy section below for which
capabilities are enforced vs advisory.

## Policy

### Enforced (cannot be bypassed)

None declared.

### Advisory (guidance — not enforced)

None declared.
