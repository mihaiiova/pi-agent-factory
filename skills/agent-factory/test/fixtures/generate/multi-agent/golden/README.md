<!-- agent-factory:generated v1 sha256=b15f41986fd56449f7b514eb4c747b8eb4b67529301ad702c5b9edfe1e88e2d8 -->
# seo-agent-system

SEO analysis + article drafting with specialist subagents

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
