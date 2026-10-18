#!/usr/bin/env python3
"""Per-skill cost breakdown for pi sessions.

Reads pi session JSONL files plus sub-agent artifact metadata and attributes
LLM cost to each user-initiated "phase" (typically a /spec-* skill invocation).

Usage:
  cost.py                     # aggregate every session for the current cwd
  cost.py --latest            # only the most recent session for the cwd
  cost.py --session <file>    # one specific session file
  cost.py --cwd <dir>         # sessions for a different project directory
  cost.py --verbose           # also print one row per invocation
  cost.py --json              # machine-readable output
  cost.py --spec 120          # known local cost for one spec (repeat for epics)
"""

import argparse
import glob
import json
import os
import re
import sys
from collections import defaultdict

sys.dont_write_bytecode = True  # reporting must not create cache files in the skill repo

HOME = os.path.expanduser("~")
SESSION_ROOT = os.path.join(HOME, ".pi", "agent", "sessions")

SKILL_RE = re.compile(r"^/(?:skill:)?([a-z0-9][a-z0-9-]*)")
SKILL_BLOCK_RE = re.compile(r'<skill name="([^"]+)"')


def session_dir_for_cwd(cwd):
    return os.path.join(SESSION_ROOT, "--" + cwd.strip("/").replace("/", "-") + "--")


def list_main_sessions(sdir):
    """Session files directly in the dir (excludes forks/, subagent-artifacts/, run dirs)."""
    if not os.path.isdir(sdir):
        return []
    return sorted(
        glob.glob(os.path.join(sdir, "*.jsonl")),
        key=os.path.getmtime,
    )


def _entry_ts(e):
    """Best-effort millisecond timestamp for an entry."""
    t = e.get("timestamp")
    if isinstance(t, (int, float)):
        return t
    if isinstance(t, str):
        # ISO timestamp -> ms epoch
        try:
            from datetime import datetime, timezone
            dt = datetime.fromisoformat(t.replace("Z", "+00:00"))
            return int(dt.timestamp() * 1000)
        except Exception:
            return 0
    return 0


def active_branch(entries):
    """Return the leaf->root chain of the active branch, reversed to root->leaf."""
    by_id = {}
    children = set()
    for e in entries:
        if e.get("type") == "session":
            continue  # header identity is not a conversation-tree entry
        if "id" in e and e["id"]:
            by_id[e["id"]] = e
        if e.get("parentId"):
            children.add(e["parentId"])

    if not by_id:
        return entries  # linear fallback (v1)

    leaves = [i for i in by_id if i not in children]
    if not leaves:
        leaves = [list(by_id)[-1]] if by_id else []
    leaf = max(leaves, key=lambda i: _entry_ts(by_id[i]))

    chain = []
    seen = set()
    cur = leaf
    while cur and cur in by_id and cur not in seen:
        seen.add(cur)
        chain.append(by_id[cur])
        cur = by_id[cur].get("parentId")
    chain.reverse()
    return chain


def extract_label(text):
    """Human label for a user message: an expanded <skill name=...> block, a leading
    /skill or /spec-* command, else truncated text."""
    if not text:
        return "(empty)"
    flat = " ".join(text.split())
    m = SKILL_BLOCK_RE.search(flat)
    if m:
        return m.group(1)
    m = SKILL_RE.match(flat)
    if m:
        return m.group(1)
    return flat[:48] + ("…" if len(flat) > 48 else "")


def user_text(msg):
    c = msg.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return " ".join(
            b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text"
        )
    return ""


def _add_usage(bucket, usage):
    if not isinstance(usage, dict):
        return
    for k in ("input", "output", "cacheRead", "cacheWrite", "reasoning", "totalTokens"):
        v = usage.get(k)
        if isinstance(v, (int, float)):
            bucket[k] += v
    cost = usage.get("cost")
    if isinstance(cost, dict):
        for k in ("input", "output", "cacheRead", "cacheWrite", "total"):
            v = cost.get(k)
            if isinstance(v, (int, float)):
                bucket["cost_" + k] += v
    elif isinstance(cost, (int, float)):
        bucket["cost_total"] += cost


def new_bucket():
    return defaultdict(float)


def parse_session(path):
    """Return (phases, uncategorized_subagent_runs). phases = list of dicts."""
    entries = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except Exception:
                continue

    phases = []
    current = None
    last_user_ts = 0

    for e in active_branch(entries):
        etype = e.get("type")
        if etype != "message":
            # compaction / branch_summary carry LLM usage too
            if etype in ("compaction", "branch_summary") and e.get("usage") and current is not None:
                _add_usage(current["main"], e.get("usage"))
            continue

        msg = e.get("message", {})
        role = msg.get("role")
        ts = msg.get("timestamp") or _entry_ts(e)

        if role == "user":
            current = {
                "label": extract_label(user_text(msg)),
                "start_ms": ts,
                "session": os.path.basename(path),
                "main": new_bucket(),
            }
            phases.append(current)
            last_user_ts = ts
        elif role == "assistant":
            if current is None:
                current = {
                    "label": "(assistant-before-user)",
                    "start_ms": ts,
                    "session": os.path.basename(path),
                    "main": new_bucket(),
                }
                phases.append(current)
            _add_usage(current["main"], msg.get("usage"))
        # toolResult: sub-agent cost lives in subagent-artifacts meta.json, not here.

    return phases


def load_subagent_metas(sdir):
    metas = []
    art = os.path.join(sdir, "subagent-artifacts", "*_meta.json")
    for m in glob.glob(art):
        try:
            with open(m, encoding="utf-8") as f:
                metas.append(json.load(f))
        except Exception:
            continue
    return metas


def attribute_subagents(phases, metas):
    """Assign each sub-agent meta.json to the phase whose time window contains it."""
    starts = [p["start_ms"] for p in phases]
    for meta in metas:
        ts = meta.get("timestamp")
        cost = (meta.get("usage") or {}).get("cost", 0.0)
        agent = meta.get("agent", "subagent")
        if ts is None:
            continue
        idx = None
        for i, s in enumerate(starts):
            if ts >= s:
                idx = i
            else:
                break
        target = phases[idx] if idx is not None else None
        if target is None:
            # before any user message: attach to first phase
            target = phases[0] if phases else None
        if target is None:
            continue
        target.setdefault("subagents", defaultdict(lambda: [0, 0.0]))
        runs, total = target["subagents"][agent]
        target["subagents"][agent] = [runs + 1, total + cost]


def fmt_cost(v):
    return "${:,.4f}".format(v)


def human(n):
    n = int(n)
    if n >= 1_000_000:
        return "{:.1f}M".format(n / 1_000_000)
    if n >= 1_000:
        return "{:.0f}k".format(n / 1_000)
    return str(n)


def fmt_tokens(b):
    return "{} in / {} out / {} cache".format(
        human(b["input"]), human(b["output"]), human(b["cacheRead"])
    )


def render_summary(phases):
    """Group phases by skill label into a per-skill summary table."""
    grouped = defaultdict(lambda: {"n": 0, "main": new_bucket(), "sub": new_bucket(),
                                   "subruns": 0, "subagents": defaultdict(int)})
    order = []
    for p in phases:
        label = p["label"]
        if label not in grouped:
            order.append(label)
        g = grouped[label]
        g["n"] += 1
        for k, v in p["main"].items():
            g["main"][k] += v
        sub_cost = 0.0
        for agent, (runs, cost) in (p.get("subagents") or {}).items():
            sub_cost += cost
            g["subruns"] += runs
            g["subagents"][agent] += runs
        g["sub"]["cost_total"] += sub_cost

    lines = []
    lines.append("SKILL            RUNS   MAIN COST   SUB-AGENTS                  TOTAL COST   TOKENS (in/out/cache)")
    lines.append("-" * 104)
    grand_main = 0.0
    grand_sub = 0.0
    for label in order:
        g = grouped[label]
        main_cost = g["main"]["cost_total"]
        sub_cost = g["sub"]["cost_total"]
        grand_main += main_cost
        grand_sub += sub_cost
        if g["subruns"]:
            sub_desc = "{} runs {}".format(g["subruns"], fmt_cost(sub_cost))
            sub_agents = " + ".join("{}×{}".format(a, r) for a, r in sorted(g["subagents"].items()))
            if sub_agents:
                sub_desc += " ({})".format(sub_agents)
        else:
            sub_desc = "—"
        lines.append(
            "{:<16} {:>4}   {:>9}   {:<30} {:>10}   {}".format(
                label[:16],
                g["n"],
                fmt_cost(main_cost),
                sub_desc[:30],
                fmt_cost(main_cost + sub_cost),
                fmt_tokens(g["main"]),
            )
        )
    lines.append("-" * 104)
    lines.append(
        "{:<16} {:>4}   {:>9}   {:<30} {:>10}".format(
            "TOTAL", "", fmt_cost(grand_main),
            fmt_cost(grand_sub), fmt_cost(grand_main + grand_sub),
        )
    )
    return "\n".join(lines), grouped, order, grand_main, grand_sub


def render_verbose(phases):
    lines = []
    lines.append("INVOCATION  TIME                 MAIN        SUB-AGENTS   TOTAL")
    lines.append("-" * 78)
    for p in phases:
        from datetime import datetime, timezone
        t = datetime.fromtimestamp(p["start_ms"] / 1000, tz=timezone.utc).strftime("%m-%d %H:%M")
        main_cost = p["main"]["cost_total"]
        sub_cost = sum(c for _, c in (p.get("subagents") or {}).values())
        sub_desc = "; ".join(
            "{}×{}".format(a, r) for a, (r, c) in sorted((p.get("subagents") or {}).items())
        ) or "—"
        lines.append(
            "{:<12} {:<9}  {:>8}   {:<11} {:>8}   {}".format(
                p["label"][:12], t, fmt_cost(main_cost), sub_desc[:11],
                fmt_cost(main_cost + sub_cost), os.path.basename(p["session"]),
            )
        )
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description="Per-skill pi session cost breakdown")
    ap.add_argument("--cwd", default=os.getcwd())
    ap.add_argument("--session", help="one specific session file")
    ap.add_argument("--all", action="store_true", help="aggregate every session (default)")
    ap.add_argument("--latest", action="store_true", help="only the most recent session")
    ap.add_argument("--verbose", action="store_true", help="one row per invocation")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--spec", type=int, action="append", help="report one spec's known local cost; repeat for child specs")
    args = ap.parse_args()

    if args.spec:
        if any(number <= 0 for number in args.spec):
            ap.error("--spec must be a positive issue number")
        if args.latest or args.session:
            ap.error("--spec cannot be combined with --latest or --session")
        from spec_report import collect, render
        report = collect(args.cwd, args.spec)
        print(json.dumps(report, indent=2) if args.json else render(report))
        return

    if args.session:
        files = [args.session]
        sdir = os.path.dirname(args.session)
    else:
        sdir = session_dir_for_cwd(args.cwd)
        files = list_main_sessions(sdir)
        if args.latest and files:
            files = files[-1:]

    if not files:
        print("No session files found for cwd {} under {}".format(args.cwd, sdir))
        sys.exit(1)

    all_phases = []
    for f in files:
        all_phases.extend(parse_session(f))
    all_phases.sort(key=lambda p: p["start_ms"])

    metas = load_subagent_metas(sdir)
    attribute_subagents(all_phases, metas)

    if args.json:
        out = []
        for p in all_phases:
            out.append({
                "skill": p["label"],
                "start_ms": p["start_ms"],
                "session": p["session"],
                "main_cost": p["main"]["cost_total"],
                "main_tokens": dict(p["main"]),
                "subagents": {a: {"runs": r, "cost": c} for a, (r, c) in (p.get("subagents") or {}).items()},
            })
        print(json.dumps(out, indent=2))
        return

    summary, grouped, order, grand_main, grand_sub = render_summary(all_phases)
    print(summary)
    print()
    print("Sessions scanned: {}".format(len(files)))
    if grouped:
        # most expensive skill line
        top = max(order, key=lambda l: grouped[l]["main"]["cost_total"] + grouped[l]["sub"]["cost_total"])
        g = grouped[top]
        print("Most expensive: {} — ${:.4f} (${:.4f} main agent + ${:.4f} sub-agents, {} sub-agent runs)".format(
            top, g["main"]["cost_total"] + g["sub"]["cost_total"],
            g["main"]["cost_total"], g["sub"]["cost_total"], g["subruns"],
        ))
    if args.verbose and all_phases:
        print()
        print(render_verbose(all_phases))


if __name__ == "__main__":
    main()

