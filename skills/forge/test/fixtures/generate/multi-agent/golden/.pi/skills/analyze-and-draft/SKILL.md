---
name: analyze-and-draft
description: "Analyze SEO data, pick opportunities, draft articles"
---

# analyze-and-draft

Analyze SEO data, pick opportunities, draft articles

## Boundary

Entry: orchestrator

Available agents: seo-analyst, article-writer, researcher
Coordinate the available agents as the task requires; this is a declared
set of available specialists, not a fixed call sequence.

Inputs: data/opportunities/*.md

Outputs: data/analyses/, data/articles/

Approval boundary: publish

Verify: a draft exists under data/articles/

## Orchestration

Orchestrate the available agents with the `subagent` tool (direct calls or
a `workflowScript`). Decide the steps at runtime from the task and the
boundaries above; this skill does not prescribe a fixed sequence of agent
calls.

## Trigger

Manual trigger (`trigger: { kind: manual }`): run interactively with `pi`, or headless with `pi -p "<prompt>"`.

## Outputs

Write all produced artifacts under the declared outputs paths above.

<!-- forge:generated v1 sha256=e119180681109ddbfb7439a4ace06e1645bd1c28028bcfe50fdf301b3435bdd0 -->
