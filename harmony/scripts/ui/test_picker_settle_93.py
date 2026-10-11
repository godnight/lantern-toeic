"""Read-only replay of run 93's real composite-to-ready picker transition.

Fixtures are sanitized real layouts; injected faults do not claim device QA.
All external commands are prohibited during these offline tests.
"""
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


class PickerSettleTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(ui.subprocess, "run", side_effect=AssertionError("No subprocess")))
        self.seconds = 0.0
        self.enterContext(patch.object(mock.time, "monotonic", lambda: self.seconds))
        self.enterContext(patch.object(mock.time, "sleep", self.sleep))
        self.composite = fixture("mock-picker-api26-composite-93.json")
        self.ready = fixture("mock-picker-api26-ready-93.json")
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

    def no_actions(self):
        self.assertEqual(self.runner.io.mock_calls, [])

    def one(self, tree, role):
        return ui.unique([n for n in ui.flatten(tree) if n.value.get("type") == role], "fixture role")

    def test_real_composite_frame_waits_then_returns_only_recognized_ready_frame(self):
        state = self.frames([self.composite, self.ready])
        self.assertIs(self.runner.layout(), self.ready)
        self.assertEqual(state["reads"], 2)
        self.assertGreater(self.seconds, 0)
        self.assertEqual(mock.surface(self.runner.tree, True)[0], "instant-picker")
        self.assertEqual(self.runner.io.end, 120.0)
        self.no_actions()

    def test_surface_rejects_unready_frame_instead_of_granting_action_mode(self):
        with self.assertRaises(ui.Failure) as caught:
            mock.surface(self.composite, True)
        self.assertIs(type(caught.exception), mock.PickerNotReady)
        self.no_actions()

    def test_persistent_unready_frame_expires_within_existing_15_second_cap(self):
        state = self.frames([self.composite])
        with self.assertRaisesRegex(ui.Failure, "did not reach a recognized ready structure"):
            self.runner.layout()
        self.assertGreater(state["reads"], 1)
        self.assertGreater(self.seconds, 14)
        self.assertLessEqual(self.seconds, 15)
        self.assertEqual(self.runner.io.end, 120.0)
        self.no_actions()

    def test_unready_settle_respects_smaller_parent_budget(self):
        self.runner.io.end = .45
        self.frames([self.composite])
        with self.assertRaisesRegex(ui.Failure, "did not reach a recognized ready structure"):
            self.runner.layout()
        self.assertGreater(self.seconds, 0)
        self.assertLessEqual(self.seconds, .45)
        self.assertEqual(self.runner.io.end, .45)
        self.no_actions()

    def test_overlay_dialog_wrong_origin_and_two_sheets_fail_on_first_read(self):
        for defect in ("overlay", "dialog", "wrong-origin", "two-sheets"):
            with self.subTest(defect=defect):
                tree = copy.deepcopy(self.composite)
                if defect == "overlay":
                    tree.append({"type": "Text", "text": "UNKNOWN OVERLAY", "bounds": [0, 200, 900, 1000]})
                elif defect == "dialog":
                    self.one(tree, "SheetPage").value["children"].append(
                        {"type": "dialog", "text": "unknown", "bounds": [0, 200, 900, 1000]})
                elif defect == "wrong-origin":
                    self.one(tree, "Web").value["text"] = "https://untrusted.invalid/"
                else:
                    tree.append(copy.deepcopy(self.one(tree, "SheetPage").value))
                state = self.frames([tree, self.ready])
                with self.assertRaises(ui.Failure):
                    self.runner.layout()
                self.assertEqual(state["reads"], 1)
                self.assertEqual(self.seconds, 0)
                self.assertEqual(self.runner.io.end, 120.0)
                self.no_actions()

    def test_new_external_overlay_during_settle_is_not_hidden_by_retry(self):
        obstructed = copy.deepcopy(self.ready)
        obstructed.append({"type": "Text", "text": "UNKNOWN OVERLAY", "bounds": [0, 200, 900, 1000]})
        state = self.frames([self.composite, obstructed, self.ready])
        with self.assertRaisesRegex(ui.Failure, "Unknown native overlay"):
            self.runner.layout()
        self.assertEqual(state["reads"], 2)
        self.assertEqual(self.runner.io.end, 120.0)
        self.no_actions()

    def test_unready_picker_outside_picker_phase_fails_without_waiting(self):
        self.runner.phase = "catalog"
        state = self.frames([self.composite, self.ready])
        with self.assertRaisesRegex(ui.Failure, "Unexpected system picker"):
            self.runner.layout()
        self.assertEqual(state["reads"], 1)
        self.assertEqual(self.seconds, 0)
        self.no_actions()

    def test_transport_failure_is_not_retried_as_a_settling_picker(self):
        with patch.object(ui.Runner, "layout", side_effect=ui.Failure("transport budget expired")) as fetch:
            with self.assertRaisesRegex(ui.Failure, "transport budget expired"):
                self.runner.layout()
        fetch.assert_called_once()
        self.assertEqual(self.seconds, 0)
        self.assertEqual(self.runner.io.end, 120.0)
        self.no_actions()


if __name__ == "__main__":
    unittest.main()
