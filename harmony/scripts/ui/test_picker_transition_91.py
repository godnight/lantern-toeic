"""Offline replay of run 91; real retry logic with transports disabled."""
import copy
import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

import phone_smoke as ui
import phone_mock as mock

HERE = Path(__file__).resolve().parent

def fixture(name):
    return json.loads((HERE / "fixtures" / name).read_text(encoding="utf-8"))


class OpeningShellTests(unittest.TestCase):
    def setUp(self):
        self.seconds = 0.0
        self.enterContext(patch.object(ui.subprocess, "run", side_effect=AssertionError("No subprocess")))
        self.enterContext(patch.object(mock.time, "monotonic", lambda: self.seconds))
        self.enterContext(patch.object(mock.time, "sleep", self.sleep))
        self.opening = fixture("mock-picker-api26-opening.json")
        self.mature = fixture("mock-picker-api26-download-91.json")
        self.runner = mock.MockRunner.__new__(mock.MockRunner)
        self.runner.phase = "picker"
        self.runner.io = Mock()
        self.runner.io.end = 120.0
        self.runner.tree = None

    def sleep(self, seconds):
        self.seconds += seconds

    def frames(self, frames):
        state = {"reads": 0}
        def layout(runner):
            runner.tree = frames[min(state["reads"], len(frames) - 1)]
            state["reads"] += 1
            return runner.tree
        self.enterContext(patch.object(ui.Runner, "layout", layout))
        return state

    def sheet(self, tree):
        return next(n.value for n in ui.flatten(tree) if n.value.get("type") == "SheetPage")

    def no_actions(self):
        self.assertEqual(self.runner.io.mock_calls, [])

    def test_real_opening_frame_waits_for_mature_picker_without_actions(self):
        state = self.frames([self.opening, self.mature])
        self.assertIs(self.runner.layout(), self.mature)
        self.assertEqual(state["reads"], 2)
        self.assertEqual(mock.surface(self.runner.tree, True)[0], "instant-picker")
        self.assertEqual(self.runner.io.end, 120.0)
        self.no_actions()

    def test_stuck_known_shell_fails_within_15_seconds_and_restores_budget(self):
        state = self.frames([self.opening])
        with self.assertRaisesRegex(ui.Failure, "stayed in its initial loading shell"):
            self.runner.layout()
        self.assertGreater(state["reads"], 1)
        self.assertLessEqual(self.seconds, 15.0)
        self.assertEqual(self.runner.io.end, 120.0)
        self.no_actions()

    def test_opening_wait_respects_smaller_parent_budget(self):
        self.runner.io.end = .45
        self.frames([self.opening])
        with self.assertRaisesRegex(ui.Failure, "stayed in its initial loading shell"):
            self.runner.layout()
        self.assertLessEqual(self.seconds, .45)
        self.assertEqual(self.runner.io.end, .45)
        self.no_actions()

    def test_unknown_or_selected_shell_is_rejected_without_retry_or_action(self):
        for change in ("selected", "unknown-text", "extra-child", "missing-child"):
            with self.subTest(change=change):
                tree = copy.deepcopy(self.opening)
                children = self.sheet(tree)["children"]
                if change == "selected":
                    children[1]["text"] = "已选 (1)"
                elif change == "unknown-text":
                    children[3]["text"] = "授权所有文件"
                elif change == "extra-child":
                    children.append({"type": "Text", "text": "unexpected", "bounds": [0, 200, 100, 400], "children": []})
                else:
                    children.pop()
                with self.assertRaisesRegex(ui.Failure, "Unrecognized native picker structure"):
                    mock.surface(tree, True)
        self.no_actions()

    def test_known_shell_still_rejects_dialog_external_overlay_and_wrong_phase(self):
        for change in ("dialog", "overlay", "phase"):
            with self.subTest(change=change):
                tree = copy.deepcopy(self.opening)
                if change == "dialog":
                    self.sheet(tree)["children"].append({"type": "dialog", "text": "unknown", "bounds": [0, 200, 800, 1200], "children": []})
                elif change == "overlay":
                    tree.append({"type": "Text", "text": "unknown", "bounds": [0, 200, 800, 1200], "children": []})
                with self.assertRaises(ui.Failure):
                    mock.surface(tree, change != "phase")
        self.no_actions()


if __name__ == "__main__":
    unittest.main()
