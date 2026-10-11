"""Offline tests of the actual repo MockRunner.layout; never calls a device.

Two reduced layouts are real captures from failed run 88. Fault layouts below
are explicit mutations. Delayed recovery and command durations are simulated;
run 94's live recovery is separate evidence. The subprocess guard makes
accidental live calls fail.
"""
import copy
import json
import re
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import phone_mock as mock
import phone_smoke as ui

FIXTURES = Path(__file__).with_name("fixtures")


def fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8-sig"))


def web(tree):
    return ui.unique([n for n in ui.flatten(tree) if n.value.get("type") == "Web"], "fixture Web").value


class EmptyWebLayoutTests(unittest.TestCase):
    def setUp(self):
        self.clock = 0.0
        self.frames = [fixture("mock-empty-web.json"), fixture("mock-restored-web.json")]
        self.calls = []
        self.call_duration = 0.0
        self.call_durations = []
        self.runner = object.__new__(mock.MockRunner)
        self.runner.phase = "catalog"
        self.runner.tree = None
        self.runner.io = object.__new__(mock.MockTransport)
        self.runner.io.end = 120.0
        self.runner.io.args = SimpleNamespace(powershell="FAKE-POWERSHELL", cli="FAKE-CLI", device="127.0.0.1:1")
        self.enterContext(patch.object(mock.time, "monotonic", lambda: self.clock))
        self.enterContext(patch.object(mock.time, "sleep", self.sleep))
        self.enterContext(patch.object(ui.subprocess, "run", side_effect=AssertionError("No live subprocess permitted")))
        case = self
        def command(transport, argv, label, timeout=35):
            if label != "layout" or "layout" not in argv:
                raise AssertionError("No action, HDC, screenshot or other command during layout waiting")
            case.calls.append({"timeout": timeout, "end": transport.end})
            duration = (case.call_durations[min(len(case.calls) - 1, len(case.call_durations) - 1)]
                        if case.call_durations else case.call_duration)
            if duration > timeout:
                case.clock += timeout
                raise ui.Failure("OFFLINE simulated command timeout")
            case.clock += duration
            return json.dumps(case.frames[min(len(case.calls) - 1, len(case.frames) - 1)], ensure_ascii=False)
        self.enterContext(patch.object(ui.Transport, "command", command))

    def sleep(self, seconds):
        self.clock += seconds

    def assert_restored_budget(self, end=120.0):
        self.assertEqual(self.runner.io.end, end)

    def test_real_empty_then_real_restored_layout_returns_only_restored_tree(self):
        tree = self.runner.layout()
        self.assertEqual(tree, self.frames[1])
        self.assertIs(self.runner.tree, tree)
        self.assertEqual(len(self.calls), 2)
        self.assertLessEqual(self.clock, 15)
        self.assertEqual(self.calls[0]["timeout"], 15)
        self.assertTrue(all(0 < row["timeout"] <= 35 for row in self.calls))
        self.assert_restored_budget()

    def test_status_still_requires_real_saved_notice_after_empty_web(self):
        status = ui.unique(ui.find_nodes(self.frames[1], types={"status"}), "captured restored status")
        result = self.runner.status("^" + re.escape(ui.normalize(status.value["text"])) + "$")
        self.assertEqual(result.value["text"], status.value["text"])
        self.assertEqual(len(self.calls), 2)
        self.assert_restored_budget()

    def test_normal_app_layout_is_returned_without_retry(self):
        self.frames = [self.frames[1]]
        self.assertEqual(self.runner.layout(), self.frames[0])
        self.assertEqual(len(self.calls), 1)
        self.assert_restored_budget()

    def test_persistent_empty_web_fails_at_60_seconds_and_restores_budget(self):
        self.frames = [self.frames[0]]
        with self.assertRaises(ui.Failure): self.runner.layout()
        self.assertLessEqual(self.clock, 60)
        self.assertGreaterEqual(self.clock, 59.9)
        self.assertTrue(all(row["end"] <= 60 for row in self.calls))
        self.assert_restored_budget()

    def test_parent_budget_shorter_than_15_is_not_extended(self):
        self.frames = [self.frames[0]]
        self.runner.io.end = 1.0
        with self.assertRaises(ui.Failure): self.runner.layout()
        self.assertLessEqual(self.clock, 1)
        self.assertTrue(all(0 < row["timeout"] <= 1 for row in self.calls))
        self.assert_restored_budget(1.0)

    def test_single_slow_cli_call_is_capped_by_layout_budget(self):
        self.call_duration = 20
        with self.assertRaisesRegex(ui.Failure, "timeout"): self.runner.layout()
        self.assertEqual(len(self.calls), 1)
        self.assertLessEqual(self.clock, 15)
        self.assert_restored_budget()

    def test_trusted_empty_web_recovers_after_more_than_15_seconds(self):
        self.frames = [self.frames[0]] * 10 + [self.frames[1]]
        self.call_duration = 2
        tree = self.runner.layout()
        self.assertEqual(tree, self.frames[-1])
        self.assertGreater(self.clock, 15)
        self.assertLess(self.clock, 60)
        self.assertEqual(len(self.calls), 11)
        self.assertEqual(self.calls[0]["end"], 15)
        self.assertTrue(all(row["end"] == 60 for row in self.calls[1:]))
        self.assert_restored_budget()

    def test_empty_web_in_picker_phase_retains_15_second_cap(self):
        self.runner.phase = "picker"
        self.frames = [self.frames[0]]
        with self.assertRaises(ui.Failure): self.runner.layout()
        self.assertLessEqual(self.clock, 15)
        self.assertGreaterEqual(self.clock, 14.9)
        self.assertTrue(all(row["end"] <= 15 for row in self.calls))
        self.assert_restored_budget()

    def test_extended_empty_web_still_stops_at_a_20_second_parent_budget(self):
        self.frames = [self.frames[0]]
        self.runner.io.end = 20.0
        with self.assertRaises(ui.Failure): self.runner.layout()
        self.assertLessEqual(self.clock, 20)
        self.assertGreaterEqual(self.clock, 19.9)
        self.assertTrue(all(row["end"] <= 20 for row in self.calls))
        self.assert_restored_budget(20.0)

    def test_60_second_deadline_is_from_entry_not_restarted_after_each_empty_frame(self):
        self.frames = [self.frames[0]]
        self.call_duration = 10
        with self.assertRaises(ui.Failure): self.runner.layout()
        self.assertLessEqual(self.clock, 60)
        self.assertGreaterEqual(self.clock, 59.9)
        self.assertEqual(self.calls[0]["end"], 15)
        self.assertTrue(all(row["end"] == 60 for row in self.calls[1:]))
        self.assert_restored_budget()

    def test_command_timeout_after_empty_frame_is_not_retried_or_extended(self):
        self.call_durations = [0, 40]
        with self.assertRaisesRegex(ui.Failure, "timeout"): self.runner.layout()
        self.assertEqual(len(self.calls), 2)
        self.assertEqual([row["timeout"] for row in self.calls], [15, 35])
        self.assertLessEqual(self.clock, 60)
        self.assert_restored_budget()

    def test_last_cli_call_cannot_run_beyond_60_second_deadline(self):
        self.frames = [self.frames[0]]
        self.call_duration = 2
        with self.assertRaisesRegex(ui.Failure, "timeout"): self.runner.layout()
        self.assertLessEqual(self.clock, 60)
        self.assertGreaterEqual(self.clock, 59.9)
        self.assertLess(self.calls[-1]["timeout"], self.call_duration)
        self.assert_restored_budget()

    def test_untrusted_origin_native_overlay_and_dialog_fail_without_retry(self):
        for problem in ("origin", "native", "dialog", "alert"):
            with self.subTest(problem=problem):
                self.calls.clear()
                tree = fixture("mock-empty-web.json")
                if problem == "origin": web(tree)["text"] = "https://untrusted.invalid/"
                else: tree.append({"type": "Text" if problem == "native" else problem,
                                   "text": "UNKNOWN", "bounds": [0, 0, 1000, 100]})
                self.frames = [tree, fixture("mock-restored-web.json")]
                with self.assertRaises(ui.Failure): self.runner.layout()
                self.assertEqual(len(self.calls), 1)
                self.assertEqual(self.clock, 0)
                self.assert_restored_budget()

    def test_overlay_appearing_after_empty_frame_is_not_waited_away(self):
        self.frames[1].append({"type": "Text", "text": "Permission", "bounds": [0, 0, 1000, 100]})
        self.frames.append(fixture("mock-restored-web.json"))
        with self.assertRaises(ui.Failure): self.runner.layout()
        self.assertEqual(len(self.calls), 2)
        self.assert_restored_budget()

    def test_nonempty_web_without_root_missing_children_or_multiple_roots_fail(self):
        for defect in ("nonempty", "missing", "multiple", "invisible"):
            with self.subTest(defect=defect):
                self.calls.clear()
                tree = fixture("mock-empty-web.json")
                node = web(tree)
                if defect == "nonempty": node["children"] = [{"type": "paragraph", "text": "Different shape", "bounds": [0, 200, 1000, 300]}]
                elif defect == "missing": del node["children"]
                else:
                    root = {"type": "rootWebArea", "bounds": [0, 200, 1000, 2000], "children": []}
                    if defect == "invisible": root["visible"] = False
                    node["children"] = [root, copy.deepcopy(root)] if defect == "multiple" else [root]
                self.frames = [tree]
                with self.assertRaises(ui.Failure): self.runner.layout()
                self.assertEqual(len(self.calls), 1)
                self.assert_restored_budget()

    def test_known_picker_returns_only_in_picker_phase(self):
        tree = fixture("mock-picker-api26-files.json")
        self.frames = [tree]
        with self.assertRaises(ui.Failure): self.runner.layout()
        self.assertEqual(len(self.calls), 1)
        self.calls.clear(); self.runner.phase = "picker"
        self.assertEqual(self.runner.layout(), tree)
        self.assertEqual(len(self.calls), 1)
        self.assert_restored_budget()


if __name__ == "__main__":
    unittest.main(verbosity=2)
