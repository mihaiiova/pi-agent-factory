---
name: explore
description: Quickly build and iterate on a new project or uncertain feature through conversation. Use when the user invokes /explore, asks for exploratory prototyping, or wants to try ideas without the formal spec workflow.
---

# Explore

Enable exploration with `explore_mode` (`action: "on"`, with the user's objective) unless already active. `/explore <idea>` enables it directly. Keep it active across turns until the user explicitly leaves or requests formal delivery. Use `explore_mode` with `action: "off"` to leave; `/explore off` also works. If the extension is unavailable, follow this skill for the conversation and explain that persistence is unavailable; do not make installing it a prerequisite.

Optimize for the fastest useful version the user can try. Start in an empty directory. Ask only what materially changes the next experiment; otherwise make a reversible assumption, mention consequential choices briefly, and build the smallest runnable version.

Override formal process requirements from pi-config and other loaded development skills: no required Git/GitHub setup, issue, spec, ADR, configuration, testing seam, interview, TDD, documentation, delegation, branch setup, or checkpoint ritual. Missing process artifacts are never blockers. Create only the setup needed to run the experiment.

Iterate through normal conversation: try, inspect, adjust. Change architecture and interfaces freely; use mock data and temporary shortcuts when useful. Run checks that help establish behavior, investigate relevant failures, and report unrelated ones without getting stuck. Never disguise failures or claim unperformed verification.

Protect existing work and respect permissions, secrets, and read-only agent roles. Merging, deployment, destructive actions, and external publication still require the relevant user authorization.

Keep bookkeeping unobtrusive. Save a short continuation note only when useful at a stopping point or before losing context. When delegating, pass the full exploration contract in the task, including to fresh-context and scripted children. Do not impose spec/TDD gates on them.

Allow the user to discard, continue, or keep a sufficient prototype. When asked to formalize or prepare for shipping, leave exploration first, inspect the actual prototype, and define remaining work. Preserve useful code; assume neither a rewrite nor production readiness.
