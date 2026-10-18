"""Spec-scoped, read-only cost reporting using the existing session parser.

Identity comes from explicit lifecycle command arguments or linked finalized
session records. Never use the current branch or project-wide totals as a proxy.
"""

import glob
import json
import math
import os
import re
from collections import defaultdict

import cost


def amount(value):
    return value if type(value) in (int, float) and math.isfinite(value) and value >= 0 else None


def reported_cost(usage):
    value = usage.get("cost") if isinstance(usage, dict) else None
    return amount(value.get("total") if isinstance(value, dict) else value)


def command(text):
    """Ignore skill documentation/examples and inspect only invocation arguments."""
    expanded = cost.SKILL_BLOCK_RE.search(text)
    if expanded:
        return expanded.group(1), text.rsplit("</skill>", 1)[-1].strip() if "</skill>" in text else ""
    match = cost.SKILL_RE.match(text.strip())
    return (match.group(1), text.strip()[match.end():].strip()) if match else (None, "")


def target(args):
    match = re.match(r"(?:#?(\d+)(?=\s|$)|https://github\.com/[^/\s]+/[^/\s]+/issues/(\d+)(?=[\s/?#]|$))", args)
    return int(next(v for v in match.groups() if v is not None)) if match else None


def read_entries(path):
    entries = []
    try:
        with open(path, encoding="utf8", errors="replace") as handle:
            for line in handle:
                try:
                    value = json.loads(line)
                    if isinstance(value, dict):
                        entries.append(value)
                except ValueError:
                    continue
    except OSError:
        return None
    return entries


def phases_for(path, entries, hint=None, seen_usage=None):
    seen_usage = set() if seen_usage is None else seen_usage
    branch = cost.active_branch(entries)
    ids = set()
    for entry in branch:
        msg = entry.get("message", {})
        if msg.get("role") == "user":
            name, args = command(cost.user_text(msg))
            number = target(args) if name and name.startswith("spec-") else None
            if number:
                ids.add(number)
    # A shutdown record is session-wide; do not apply it to mixed-spec history.
    hint = hint if not ids or ids == {hint} else None
    spec, workflow, current = hint, "unclassified", None
    phases = []
    session_id = next((e.get("id") for e in entries if e.get("type") == "session"), None)
    last_time = max((cost._entry_ts(e) for e in branch), default=0)
    for entry in branch:
        msg = entry.get("message", {})
        if entry.get("type") == "message" and msg.get("role") == "user":
            name, args = command(cost.user_text(msg))
            if name and name.startswith("spec-"):
                workflow = name
                spec = target(args) or (hint if name == "spec-new" else spec)
            elif name:
                spec, workflow = None, "unclassified"
            start = cost._entry_ts(entry)
            if current:
                current["end"] = start
            current = {"spec": spec, "workflow": workflow, "start": start,
                       "end": last_time + 1, "session": os.path.realpath(path),
                       "session_id": session_id, "main": [], "sub": [], "missing": 0}
            phases.append(current)
        elif current and ((entry.get("type") == "message" and msg.get("role") == "assistant")
                          or entry.get("type") in ("compaction", "branch_summary")):
            # Forked session files may contain the same inherited transcript.
            # Count an identical usage-bearing entry once across source files.
            usage = msg.get("usage") if entry.get("type") == "message" else entry.get("usage")
            if entry.get("id"):
                key = (entry["id"], cost._entry_ts(entry), json.dumps(usage, sort_keys=True))
                if key in seen_usage:
                    continue
                seen_usage.add(key)
            value = reported_cost(usage)
            if value is None:
                current["missing"] += 1
            else:
                current["main"].append(value)
    return phases


def collect(cwd, specs):
    specs = sorted(set(specs))
    sdir = cost.session_dir_for_cwd(os.path.abspath(cwd))
    files = set(cost.list_main_sessions(sdir))
    hints, warnings = {}, []
    for path in glob.glob(os.path.join(cwd, ".pi", "sessions", "*.json")):
        try:
            with open(path, encoding="utf8") as handle:
                record = json.load(handle)
            if not isinstance(record, dict) or record.get("schemaVersion") != 1:
                continue
            linked = record.get("piSessionFile")
            number = (record.get("activeSpec") or {}).get("number")
            if isinstance(linked, str) and type(number) is int:
                linked = os.path.realpath(linked)
                hints[linked] = number
                files.add(linked)
        except (OSError, ValueError, TypeError, AttributeError):
            continue
    phases, seen_usage = [], set()
    for path in sorted(files):
        entries = read_entries(path)
        if entries is None:
            if hints.get(os.path.realpath(path)) in specs:
                warnings.append("A linked session file is unavailable; its cost is omitted.")
            continue
        phases.extend(phases_for(path, entries, hints.get(os.path.realpath(path)), seen_usage))

    unattributed = 0
    # Metadata directories are shared by many sessions: scan each only once.
    for directory in sorted({os.path.dirname(path) for path in files}):
        for path in glob.glob(os.path.join(directory, "subagent-artifacts", "*_meta.json")):
            try:
                with open(path, encoding="utf8") as handle:
                    meta = json.load(handle)
                if not isinstance(meta, dict):
                    raise ValueError("invalid metadata")
                stamp = cost._entry_ts(meta)
                candidates = [p for p in phases if os.path.dirname(p["session"]) == os.path.realpath(directory)
                              and stamp > 0 and p["start"] <= stamp < p["end"]]
                parent = meta.get("parentSessionId")
                if parent:
                    candidates = [p for p in candidates if p["session_id"] == parent]
                if len(candidates) != 1:
                    unattributed += 1
                    continue
                phase = candidates[0]
                value = reported_cost(meta.get("usage"))
                if value is None:
                    phase["missing"] += 1
                else:
                    phase["sub"].append(value)
            except (OSError, ValueError, TypeError, AttributeError):
                unattributed += 1

    selected = [p for p in phases if p["spec"] in specs]
    rows = defaultdict(lambda: {"main": [], "sub": [], "missing": 0})
    for phase in selected:
        row = rows[(phase["spec"], phase["workflow"])]
        row["main"].extend(phase["main"])
        row["sub"].extend(phase["sub"])
        row["missing"] += phase["missing"]
    result = []
    for (spec, workflow), row in sorted(rows.items()):
        result.append({"spec": spec, "workflow": workflow,
                       "main_cost": sum(row["main"]) if row["main"] else None,
                       "subagent_cost": sum(row["sub"]) if row["sub"] else None,
                       "known_cost": sum(row["main"] + row["sub"]) if row["main"] or row["sub"] else None,
                       "missing_cost_records": row["missing"]})
    if unattributed:
        warnings.append(f"{unattributed} project subagent metadata records could not be attributed unambiguously; omitted.")
    if any(p["spec"] is None for p in phases):
        warnings.append("Unlinked session phases exist; they are omitted rather than guessed.")
    absent = [number for number in specs if not any(p["spec"] == number for p in selected)]
    if absent:
        warnings.append("No linked local sessions for " + ", ".join(f"#{n}" for n in absent) + ".")
    values = [r["known_cost"] for r in result if r["known_cost"] is not None]
    implementations = [r["known_cost"] for r in result if r["workflow"] == "spec-start" and r["known_cost"] is not None]
    return {"specs": specs, "rows": result,
            "implementation_cost": sum(implementations) if implementations else None,
            "known_cost": sum(values) if values else None,
            "missing_cost_records": sum(r["missing_cost_records"] for r in result),
            "warnings": sorted(set(warnings)),
            "scope": "Known local reported cost at this snapshot; excludes unlinked work, unavailable usage, other machines, and turns after this report (including the final closing response)."}


def render(report):
    money = lambda value: cost.fmt_cost(value) if value is not None else "unavailable"
    lines = ["Known local cost — " + ", ".join(f"spec #{n}" for n in report["specs"]),
             f"Implementation (/spec-start): {money(report['implementation_cost'])}", "",
             "| Spec | Workflow | Main agent | Subagents | Known subtotal |",
             "| --- | --- | ---: | ---: | ---: |"]
    for row in report["rows"]:
        lines.append(f"| #{row['spec']} | {row['workflow']} | {money(row['main_cost'])} | {money(row['subagent_cost'])} | {money(row['known_cost'])} |")
    lines.extend(["", f"Known lifecycle subtotal: {money(report['known_cost'])}", report["scope"]])
    if report["missing_cost_records"]:
        lines.append(f"Missing cost in {report['missing_cost_records']} linked usage records; subtotal is partial.")
    lines.extend(report["warnings"])
    return "\n".join(lines)
