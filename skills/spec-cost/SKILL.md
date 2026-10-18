---
name: spec-cost
description: Report known local LLM costs by workflow or spec, including main-agent and subagent spending. Use when the user asks about skill, session, implementation, or lifecycle costs. Shares the project-state accounting engine.
---

# Spec cost

Run the helper relative to this skill's directory, from the product root:

```bash
node <skill-dir>/cost.mjs                         # project, grouped by workflow
node <skill-dir>/cost.mjs --latest                # most recent native session
node <skill-dir>/cost.mjs --session <file>        # one native JSONL file
node <skill-dir>/cost.mjs --verbose               # also per-session/phase rows
node <skill-dir>/cost.mjs --spec 42               # implementation + lifecycle breakdown
node <skill-dir>/cost.mjs --spec 201 --spec 202   # epic children, deduplicated
node <skill-dir>/cost.mjs --spec 42 --json        # machine-readable spec report
```

Pass `--cwd <product-root>` for a different directory. The previous Python `cost.py` command forwards the same flags to this Node engine. Do not combine `--spec` with `--latest` or `--session`; those would silently narrow the requested lifecycle coverage.

Present the table and its coverage notes. For a spec, distinguish `/spec-start` implementation cost from the known lifecycle subtotal. When comparing workflows, name the largest **known** cost and preserve any gaps that make a complete comparison unavailable. Suggest cost reductions only when asked.

## Accounting contract

- Use only provider-reported prices. Explicit zero is known; missing or invalid prices are unavailable, not free.
- Read the active native conversation branch, including compaction, branch-summary, and native usage entries. Exclude nested tool-result usage from main-agent cost.
- Count stable observations once across resumed snapshots and shared fork ancestry. Reports read current raw transcripts when available, including unfinalized resumed work.
- Link subagent artifacts through run IDs, artifact paths, or explicit parent-session identity. Attribute them to the launching call's workflow, never the metadata completion timestamp. Omit ambiguous ownership and disclose the gap.
- Scope a spec through explicit lifecycle command arguments, recorded runtime context, or unambiguous finalized-session links. Preserve free-text follow-up context; do not use project-wide spending or the current branch as a proxy.
- Retain legacy records, but do not trust their unverified aggregate cost fields if the raw evidence is gone. New observation snapshots can be used as a fallback.
- State that reports cover known local active-branch spending at the time read. Later turns, unlinked work, unavailable usage, and other machines can be absent. Individual session rows include their conversation ancestry; use the deduplicated aggregate rather than manually adding those rows.

Reporting is read-only. Missing data produces an unavailable report, not a requirement to initialize/configure the project. Never let unavailable accounting block successful `/spec-close` work.
