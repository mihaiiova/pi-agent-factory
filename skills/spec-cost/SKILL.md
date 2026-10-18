---
name: spec-cost
description: Report how much each spec workflow skill cost (spec-init, spec-new, spec-start, spec-review, spec-close, spec-release, spec-status, and their sub-agents) by parsing pi session files and sub-agent artifacts. Use when the user wants to see the LLM cost of a skill, compare skill costs, or audit what the spec lifecycle is spending.
---

# Spec cost

Compute a per-skill cost breakdown from the current project's pi session data.

## Process

1. Run the helper script that sits in the same directory as this SKILL.md (this skill's base directory):

   ```bash
   python3 <skill-dir>/cost.py             # every session for this project
   python3 <skill-dir>/cost.py --latest    # only the most recent session
   python3 <skill-dir>/cost.py --verbose   # also one row per invocation
   python3 <skill-dir>/cost.py --spec 120  # one spec: implementation + lifecycle costs
   python3 <skill-dir>/cost.py --spec 201 --spec 202  # child specs of an epic
   ```

   For a different project, pass `--cwd <path>`. If the script can't find sessions, run `pwd` and confirm the cwd maps to a directory under `~/.pi/agent/sessions/`.

2. Present the table to the user as-is. Then name the most expensive skill and explain where its cost came from — the MAIN COST column is the main agent's own turns; the SUB-AGENTS column is work farmed out to sub-agents (code-review's `reviewer` runs, etc.). Sub-agent cost is usually the driver for `/spec-review`.

3. If the user wants to reduce cost, point at the biggest line item and suggest: fewer/smaller sub-agent reviews, a cheaper model for review, or narrower file scoping.

## How the numbers work

- Each assistant turn records `usage.cost` in the session JSONL (`~/.pi/agent/sessions/--<cwd>--/*.jsonl`). Cost is attributed to the most recent user command — a `/spec-*` or `/skill:*` invocation, or free text.
- Sub-agent cost is stored separately in `<cwd-session-dir>/subagent-artifacts/*_meta.json` and attributed to the skill whose time window contains the launch timestamp.
- Only the active branch of each session is counted, so abandoned `/tree` branches are not double-counted.
- Token/cost numbers only exist when the provider reports usage; some models omit it.

## Limits

- `--spec` scopes work by explicit lifecycle-command arguments and linked `.pi/sessions/*.json` records. Free-text follow-ups retain their preceding lifecycle phase. Mixed-spec sessions are split by explicit commands; ambiguous/unlinked work is omitted. Subagent metadata is counted once and attributed only to a unique matching session time window (or explicit parent-session identity). Reported gaps and scope notes must remain visible. This read-only mode succeeds with an unavailable report when there is no data, so `/spec-close` never depends on telemetry being present.

- Attribution is by turn window: cost is charged to the command that kicked off the work, not to skills the model loads autonomously via `read` without a user command.
- Sub-agent attribution uses launch time, so an async sub-agent that outlives its window may be charged to the wrong skill in rare queued workflows.

