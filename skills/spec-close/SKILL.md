---
name: spec-close
description: Finish accepted work and report its known implementation and lifecycle costs. Merge and close an implementation spec, or explicitly close a completed epic once every child spec is done.
---

# Close spec

Finish one lifecycle artifact. For an implementation spec this means merge, close, and clean up. For an epic this means verify every child is complete and then explicitly close the container.

## Epic case

If the target carries `spec:epic`:

1. Read all child spec links from the epic.
2. Verify every child issue is closed and/or carries `spec:done`.
3. If any child is incomplete, refuse and list the remaining children.
4. If all are complete, close the epic issue, remove any non-applicable lifecycle-state labels, keep `spec:epic` as the type marker, and apply `spec:done`.
5. Report completion and run the cost report below with every child spec number, once each. Show the per-child/workflow breakdown and combined known subtotal; this covers child delivery work, not the epic container's own planning cost. There is no branch merge or deletion for an epic.

Stop after the epic case.

## Implementation spec case

1. **Require a successful review.** The spec must carry `spec:reviewed` (or an unambiguous current review report with no blockers). Refuse otherwise.

2. **Merge into the development branch.** Resolve `spec.baseBranch` from `.pi/settings.json`; otherwise use `development` if it exists, else the repository default. Check it exists; never create a missing base branch implicitly. Check out and fast-forward it, then merge the canonical `spec/<id>-<slug>` branch with a merge commit and push the base branch. Do not merge development into production here — that is a release action for `/spec-release`.

3. **Close the issue.** Close the spec issue with a comment referencing the merge commit.

4. **Delete the branch only after merge and push succeed.** Delete the local branch, then the remote branch if present.

5. **Transition to done.** A non-epic spec carries exactly one lifecycle-state label. Remove `spec:ready`, `spec:in-progress`, and `spec:reviewed`; apply `spec:done`.

6. **Update the parent epic, if any.** If the spec has a `## Parent` link:
   - inspect sibling child specs;
   - for each sibling blocked by the newly closed spec, check whether all `## Blocked by` issues are now closed; when they are, transition that sibling to `spec:ready`;
   - if every child is now complete, report: `Epic #<n> now has all child specs complete. Run /spec-close #<n> to close the epic.`

7. **Report.** Include merge commit, pushed base branch, closed issue, branch cleanup, siblings made ready, and any epic-complete status. Run the cost report below for the resolved spec number and include the implementation cost and known lifecycle breakdown in this final response.

## Cost report

After successful close, run the existing spec-cost helper from the product's root directory. Resolve its path relative to this skill (`../spec-cost/cost.py`), not the product's own `skills/` directory:

```bash
node <spec-cost-skill-dir>/cost.mjs --cwd <product-root> --spec <issue-number>
# Epic: repeat --spec for each child, without duplicate numbers.
node <spec-cost-skill-dir>/cost.mjs --cwd <product-root> --spec 201 --spec 202
```

Present the report's implementation (`spec-start`) cost separately from the known lifecycle subtotal. Preserve its main-agent/subagent breakdown and coverage notes. Costs are provider-reported local observations, not an invoice or estimate: unavailable data is not zero. The snapshot excludes later turns, including this final response; unlinked/current sessions and other machines may be absent. Never substitute project-wide totals or invent attribution for missing phases.

Reporting is best-effort and read-only. Missing runtime, sessions, usage, or a reporting error must not block or reverse a successful close. If unavailable, say `Cost unavailable` with the concrete reason and finish the normal completion report. Do not create cost comments or edit the issue merely to persist this summary.

