---
name: spec-new
description: Understand and define a piece of work end-to-end. Inspect the repository, interview for decisions with grill-me, decide between a single cohesive spec and an epic of child specs, and publish the resulting plan to GitHub via the trusted plan applier.
---

# New spec

Turn a feature request or idea into published, decision-complete implementation work. `/spec-new` owns **definition and planning only**. The atomic implementation unit is always a **spec**. An **epic** is only a planning container for multiple independently implementable specs.

## Boundaries

`/spec-new` must not:
- edit product code
- create an implementation branch (branching belongs to `/spec-start`)
- run `/tdd`, merge anything, or close implementation specs
- create implementation tickets beneath a spec

It may inspect the codebase as deeply as needed to resolve design facts — via the read-only `scout` subagent, whose handoff the parent consumes (see *Scout inspection and handoff*).

## Process

1. **Delegate repository inspection to the `scout` subagent.** Launch one read-only `scout` subagent to explore the repository and write a context handoff file at `.pi/artifacts/spec-new/scout-handoff.md`. The parent consumes that handoff for the interview and synthesis instead of re-reading the repository itself. The scout resolves facts by exploring the codebase; never ask the user for a discoverable fact.

2. **Decide: spec or epic.** Recommend the structure as part of the interview; do not ask "should this be an epic?" merely because the request is large.

   Prefer an **epic** when the work contains multiple outcomes that can each be implemented, validated, reviewed, and meaningfully completed independently; when one outcome is a reusable foundation for later outcomes; when there are real delivery dependencies; or when incremental delivery materially lowers risk/context size.

   Prefer a **normal spec** when the work is one cohesive outcome, even if it touches several technical layers or modules. Crossing frontend/backend/database boundaries alone is not a reason for an epic. Do not create a child spec solely because a technical prerequisite exists; keep prerequisites inside the parent spec unless they have independent architectural or product value. Prefer vertical/tracer-bullet children over layer-based decomposition.

3. **Interview for decisions with a graded interview.** Grade every candidate decision on how much it needs the user's input, then ask only what is genuinely theirs. Never ask for a discoverable fact — resolve those via the scout first.

   **Grading rubric.** Each candidate decision gets an `ask_grade` in `[0,1]`:
   - `0` when the answer is discoverable (a scout can resolve a fact or convention from code/docs/ADRs);
   - otherwise `max(irreversibility, ambiguity, preference, blast_radius)`, each dimension anchored `0–1`:
     - *irreversibility* — `0` trivial rename … `1` public API/schema/migration/versioning;
     - *ambiguity* — `0` a repo convention or ADR decides … `1` several defensible answers, no precedent;
     - *preference* — `0` pure technical fact … `1` product/taste/business tradeoff only the user holds;
     - *blast radius* — `0` one file/spec … `1` shared contract other skills/people rely on.
   Max (not average): one decisive factor triggers the ask. Record the grade and a one-line reason for every candidate decision.

   **Threshold.** `spec.decisionThreshold` in `.pi/settings.json` (default `0.6`, configurable per project via `/pi-config`). Lower = more questions / more agency; higher = fewer.

   **Asking.** Every decision with `ask_grade >= decisionThreshold` is surfaced as a question, sorted by grade (descending), until the queue is empty — no cap on the number asked. The question tool's per-call limit is a transport detail, not a cap. Each surfaced question carries, alongside the question text and options: the grade, the reason for that grade, and a recommendation. Ask via `/grill-me` (`grilling`) one at a time; the general one-at-a-time primitive is unchanged, and remains the escape hatch for deciding incrementally.

   **Auto-decided.** Everything below the threshold is decided from repo conventions/defaults and recorded in the spec body under an `Auto-decided` section (decision + convention/default used + grade); the user may veto any of them.

   Use `/domain-modeling` where terminology or ADRs genuinely need updating. Do not publish until shared understanding is reached.

4. **Capture decisions as they settle.** They become Implementation Decisions and Testing Decisions.

   When a spec replaces an existing transport, flow, or surface, enumerate the user-visible affordances that path carries today — composer controls, pickers, links, side effects — and state each one's fate: preserved, replaced, or dropped. A dropped affordance the UI still renders is a decision to record in the spec, not an implementation detail to discover during review.

5. **Synthesize specs.** Use `/to-spec`'s structure (Problem Statement, Solution, User Stories, Implementation Decisions, Testing Decisions, Out of Scope, Further Notes), skipping its publishing step. Testing Decisions must name the public seams `/tdd` will exercise. For an epic, every child is a complete spec suitable for `/spec-start` without another broad requirements interview.

   **Test-seam check.** Before publishing, verify Testing Decisions names at least one concrete public seam (module/function), resolved by the scout. If no concrete seam is named, stop with the gap explained — do not mark the spec ready.

   **Consistency check.** Before publishing, run a cross-cutting consistency pass: flag decisions that conflict with documented repo behavior (release/versioning flow, branch model, existing skill contracts). Surface conflicts as high-grade questions or record them as decisions.

6. **Generate a plan identity.** Every plan has an opaque `plan_id` generated once (UUID or similarly collision-resistant identifier). Reuse the same `plan_id` when resuming/re-running the same definition. Do not derive identity from a title or slug. Artifact `id` fields remain readable stable kebab-case identifiers within that plan.

7. **Build plan JSON** in a temp file.

   Normal spec:
   ```json
   {
     "plan_id": "<opaque-id>",
     "kind": "spec",
     "spec": {
       "id": "add-csv-export",
       "title": "Spec: Add CSV export",
       "body": "<to-spec markdown>",
       "labels": []
     }
   }
   ```

   Epic:
   ```json
   {
     "plan_id": "<opaque-id>",
     "kind": "epic",
     "epic": {
       "id": "content-ingestion",
       "title": "Epic: Rework content ingestion",
       "body": "<epic markdown>",
       "labels": []
     },
     "specs": [
       {
         "id": "content-source-foundation",
         "title": "Introduce normalized content source model",
         "body": "<to-spec markdown>",
         "labels": [],
         "blocked_by": []
       },
       {
         "id": "youtube-ingestion",
         "title": "Implement YouTube ingestion",
         "body": "<to-spec markdown>",
         "labels": [],
         "blocked_by": ["content-source-foundation"]
       }
     ]
   }
   ```

   `blocked_by` is only for sibling implementation specs and is distinct from parent/child structure. List blockers before dependants.

   Epic body sections: `# Summary`, `# Goals`, `# Non-goals`, `# Architecture / implementation direction`, `# Child specs`, `# Completion criteria`.

8. **Apply the plan.** Run `scripts/spec/apply-plan.sh <plan.json>`. The trusted applier uses the authenticated GitHub CLI token when `GH_TOKEN` is unset (or accepts an explicit `GH_TOKEN` for automation); if neither is available, run `gh auth login`. It validates the plan, creates artifacts in dependency-safe order, links parent/child and blockers, manages lifecycle labels, and is **idempotent and convergent**: a rerun with the same `plan_id` and artifact id reuses the same GitHub issue and updates it to the latest title/body rather than leaving stale content. Do not create issues by hand.

9. **Report.** Summarize the created spec or epic, dependency graph, agreed testing seams, and readiness. A normal spec becomes `spec:ready`. An epic is a `spec:epic` container; unblocked children become `spec:ready` and blocked children become ready when their blockers close.

## Scout inspection and handoff

`scout` is a **read-only** subagent: it inspects and reports, never edits. Launch it with a compact brief:

- **Objective.** Produce the repository-context handoff the parent consumes mechanically.
- **Scope.** Read every applicable `AGENTS.md`, `CONTEXT.md` (if present), ADRs, the domain glossary, and the area the change touches; resolve design facts by exploring the codebase. Also resolve the concrete public testing seam and the cross-cutting consistency pass (conflicts with documented repo behavior).
- **Authority.** Read-only — do not modify files, create branches, or edit issues.
- **Output.** Write `.pi/artifacts/spec-new/scout-handoff.md` in the stable format below.
- **Done when.** The handoff answers the design facts the interview and synthesis need — including the testing seam and cross-cutting consistency — so the parent never re-reads the repository.

Stable handoff format (the parent parses it):

```markdown
## Repository
<repo name, root, base/release branch facts if discoverable>

## Context
<applicable AGENTS.md, CONTEXT.md, ADRs, domain glossary — paths and gist>

## Area touched
<modules/files the change touches, and each design fact resolved>

## Cross-cutting consistency
<conflicts between proposed decisions and documented repo behavior — release/versioning flow, branch model, existing skill contracts>

## Open questions
<facts the scout could not resolve — the only things the parent may ask the user>
```

`spec-new` names the `scout` agent only; it never names model ids or tiers — the concrete model comes from the project's agent configuration.

See `docs/spec-lifecycle.md` for lifecycle states, branch rules, epic completion, and resume semantics.
