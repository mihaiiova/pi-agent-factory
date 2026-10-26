---
name: factory-update
description: Maintain this generated system through validated declarative changes. Explicit invocation only.
disable-model-invocation: true
---

# Factory maintenance

Invoke /factory-update <request> to enter maintenance. Use factory_plan to inspect
and propose changes; never edit generated settings, MCP configuration or runtime
files directly. system.yaml is authoritative. /factory-update apply previews and
asks the human to approve a pending proposal. /factory-update done exits.

Use /factory-update review for read-only recommendations. For tooling use
/factory-update check, update, or rollback. No startup installation. recover repairs
interrupted transactions; reconcile separately previews existing generated drift.
PI_NO_UPDATE_CHECK=1 disables automatic discovery without disabling maintenance.
