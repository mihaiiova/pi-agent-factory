import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SKILL = Path(__file__).resolve().parents[2] / "skills" / "spec-cost"
sys.path.insert(0, str(SKILL))
import cost
import spec_report


def user(text, stamp):
    return {"type": "message", "timestamp": stamp, "message": {"role": "user", "content": text}}


def assistant(value, stamp):
    usage = {} if value is None else {"cost": {"total": value}}
    return {"type": "message", "timestamp": stamp, "message": {"role": "assistant", "usage": usage}}


class SpecCostTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.cwd = self.root / "product"
        self.cwd.mkdir()
        self.old_root = cost.SESSION_ROOT
        cost.SESSION_ROOT = str(self.root / "home" / ".pi" / "agent" / "sessions")
        self.sessions = Path(cost.session_dir_for_cwd(str(self.cwd)))
        self.sessions.mkdir(parents=True)

    def tearDown(self):
        cost.SESSION_ROOT = self.old_root
        self.temp.cleanup()

    def session(self, name, entries, spec=None):
        path = self.sessions / f"{name}.jsonl"
        records = [{"type": "session", "id": name, "timestamp": 1}, *entries]
        path.write_text("\n".join(json.dumps(e) for e in records))
        if spec:
            directory = self.cwd / ".pi" / "sessions"
            directory.mkdir(parents=True, exist_ok=True)
            (directory / f"{name}.json").write_text(json.dumps({"schemaVersion": 1, "piSessionFile": str(path), "activeSpec": {"number": spec}}))
        return path

    def meta(self, name, stamp, value, parent=None):
        directory = self.sessions / "subagent-artifacts"
        directory.mkdir(exist_ok=True)
        data = {"timestamp": stamp, "agent": "worker", "usage": {"cost": value}}
        if parent:
            data["parentSessionId"] = parent
        (directory / f"{name}_meta.json").write_text(json.dumps(data))

    def report(self, *specs):
        return spec_report.collect(str(self.cwd), specs or [42])

    def test_implementation_followups_review_and_planning_are_scoped_to_exact_spec(self):
        self.session("planning", [user('/spec-new "Try playback"', 10), assistant(0.2, 20)], 42)
        self.session("build", [user("/spec-start #42", 100), assistant(1.0, 200), user("Simpler", 300), assistant(0.5, 400), user("/spec-start #420", 500), assistant(90, 600)])
        self.session("review", [user("/skill:spec-review 42", 700), assistant(0.3, 800)])
        self.meta("worker", 150, 2.0)
        self.meta("other", 550, 70.0)
        report = self.report()
        self.assertAlmostEqual(report["implementation_cost"], 3.5)
        self.assertAlmostEqual(report["known_cost"], 4.0)
        self.assertEqual({r["workflow"] for r in report["rows"]}, {"spec-new", "spec-start", "spec-review"})
        self.assertEqual(report["missing_cost_records"], 0)

    def test_expanded_skill_examples_are_not_spec_identity(self):
        expanded = '<skill name="spec-start">Example /spec-start #999</skill>\n#42'
        self.session("expanded", [user(expanded, 10), assistant(0.4, 20)])
        self.assertAlmostEqual(self.report()["implementation_cost"], 0.4)

    def test_mixed_spec_sessions_do_not_apply_shutdown_identity_to_unlinked_planning(self):
        self.session("mixed", [user('/spec-new "Something"', 10), assistant(50, 20), user("/spec-start #41", 30), assistant(80, 40), user("/spec-start #42", 50), assistant(0.5, 60)], 42)
        self.assertEqual(self.report()["known_cost"], 0.5)
        self.assertTrue(any("Unlinked" in warning for warning in self.report()["warnings"]))

    def test_missing_usage_is_partial_and_zero_is_known(self):
        self.session("partial", [user("/spec-start #42", 10), assistant(0, 20), assistant(None, 30), assistant(0.7, 40)])
        self.meta("unknown", 25, None)
        report = self.report()
        self.assertEqual(report["known_cost"], 0.7)
        self.assertEqual(report["missing_cost_records"], 2)
        self.assertIn("subtotal is partial", spec_report.render(report))
        self.assertIsNone(spec_report.reported_cost({"cost": True}))
        self.assertIsNone(spec_report.reported_cost({"cost": float("nan")}))
        self.assertIsNone(spec_report.reported_cost({"cost": -1}))

    def test_no_data_is_unavailable_not_zero_and_current_state_is_not_identity(self):
        (self.cwd / ".pi").mkdir()
        (self.cwd / ".pi" / "state.json").write_text('{"activeSpec":{"number":42}}')
        self.session("unlinked", [user("Hello", 10), assistant(20, 20)])
        report = self.report()
        self.assertIsNone(report["known_cost"])
        self.assertIsNone(report["implementation_cost"])
        self.assertIn("unavailable", spec_report.render(report))

    def test_overlapping_session_windows_omit_ambiguous_subagents(self):
        self.session("a", [user("/spec-start #42", 10), assistant(1, 100)])
        self.session("b", [user("/spec-start #43", 20), assistant(100, 110)])
        self.meta("ambiguous", 50, 99)
        self.meta("identified", 60, 0.5, "a")
        report = self.report()
        self.assertEqual(report["known_cost"], 1.5)
        self.assertTrue(any("could not be attributed" in w for w in report["warnings"]))

    def test_epic_child_ids_are_deduplicated_and_metadata_counted_once(self):
        self.session("one", [user("/spec-start #42", 10), assistant(1, 100)], 42)
        self.session("two", [user("/spec-start #43", 200), assistant(2, 300)], 43)
        self.meta("worker", 50, 0.5)
        report = self.report(42, 42, 43)
        self.assertEqual(report["specs"], [42, 43])
        self.assertEqual(report["known_cost"], 3.5)

    def test_missing_linked_files_and_malformed_lines_do_not_block(self):
        path = self.session("gone", [user("/spec-start #42", 10), assistant(10, 20)], 42)
        path.unlink()
        valid = self.session("valid", [user("/spec-start #42", 30), assistant(1, 40)])
        with valid.open("a") as handle:
            handle.write("\nbad json\n[]\n")
        report = self.report()
        self.assertEqual(report["known_cost"], 1)
        self.assertTrue(any("unavailable" in w for w in report["warnings"]))

    def test_active_branch_omits_abandoned_assistant_cost(self):
        self.session("tree", [
            {**user("/spec-start #42", 10), "id": "u", "parentId": None},
            {**assistant(100, 20), "id": "abandoned", "parentId": "u"},
            {**assistant(0.5, 30), "id": "active", "parentId": "u"},
        ])
        self.assertEqual(self.report()["known_cost"], 0.5)

    def test_shared_fork_ancestry_is_not_counted_twice(self):
        ancestry = [
            {**user("/spec-start #42", 10), "id": "u", "parentId": None},
            {**assistant(1.0, 20), "id": "shared", "parentId": "u"},
        ]
        self.session("original", ancestry)
        self.session("fork", [*ancestry,
            {**user("Another approach", 30), "id": "followup", "parentId": "shared"},
            {**assistant(0.5, 40), "id": "extra", "parentId": "followup"},
        ])
        self.assertEqual(self.report()["known_cost"], 1.5)

    def test_cli_spec_json_and_existing_project_mode_both_work(self):
        self.session("cli", [user("/spec-start #42", 10), assistant(1, 20)])
        env = {**os.environ, "HOME": str(self.root / "home")}
        base = [sys.executable, str(SKILL / "cost.py"), "--cwd", str(self.cwd), "--json"]
        report = subprocess.run([*base, "--spec", "42"], env=env, text=True, capture_output=True, check=True)
        self.assertEqual(json.loads(report.stdout)["known_cost"], 1)
        legacy = subprocess.run(base, env=env, text=True, capture_output=True, check=True)
        self.assertEqual(json.loads(legacy.stdout)[0]["skill"], "spec-start")
        invalid = subprocess.run([*base, "--spec", "0"], env=env, text=True, capture_output=True)
        self.assertEqual(invalid.returncode, 2)


if __name__ == "__main__":
    unittest.main()
