"""Offline replay of run 92's crowded picker; no external commands or devices.

The initial viewport is sanitized from the failed run. The revealed-file frame
is an older real fixture; transitions and injected faults are simulated only.
"""
import argparse
import copy
import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

import phone_smoke as ui
import phone_mock as mock

HERE = Path(__file__).resolve().parent
FILENAME = "qa-only-pages.json"


def fixture(name):
    return json.loads((HERE / "fixtures" / name).read_text(encoding="utf-8"))


def one(tree, role):
    return ui.unique([n for n in ui.flatten(tree) if n.value.get("type") == role], "fixture role")


class NativeGridScrollTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(ui.subprocess, "run", side_effect=AssertionError("No subprocess")))
        self.seconds = 0.0
        self.enterContext(patch.object(mock.time, "monotonic", lambda: self.seconds))
        self.enterContext(patch.object(mock.time, "sleep", self.sleep))
        self.runner = mock.MockRunner.__new__(mock.MockRunner)
        self.runner.args = argparse.Namespace(folders=[])
        self.runner.phase = "catalog"
        self.runner.tree = None
        self.runner.io = Mock()
        self.runner.io.end = 120.0
        self.runner.io.downloads = {FILENAME}
        self.top = fixture("mock-picker-api26-crowded-92.json")
        self.revealed = fixture("mock-picker-api26-files.json")
        self.imported = fixture("mock-picker-api26-imported.json")
        self.current = self.top
        self.filename = FILENAME
        self.scroll_frames = {"up": [], "down": [self.revealed]}
        self.keep_changing = False
        self.scrolls = []
        self.clicks = []
        self.reads = 0
        self.runner.io.cli.side_effect = self.command
        self.enterContext(patch.object(ui.Runner, "layout", self.layout))

    def sleep(self, seconds):
        self.seconds += seconds

    def layout(self, *args):
        self.reads += 1
        self.runner.tree = copy.deepcopy(self.current)
        return self.runner.tree

    def command(self, *args, **kwargs):
        # Inspect the actual fresh snapshot used by the production action.
        self.assertEqual(args[0], "ui")
        mode, sheet = mock.surface(self.runner.tree, True)
        self.assertEqual(mode, "instant-picker")
        if args[1] == "swipe":
            grids = [n for n in ui.flatten(self.runner.tree)
                     if n.value.get("type") == "Grid" and n.visible_bounds()
                     and any(p is sheet.value for p in n.parents)]
            grid = ui.unique(grids, "test native grid")
            bounds = grid.visible_bounds()
            x1, y1, x2, y2 = map(int, args[2:6])
            self.assertEqual(x1, x2)
            self.assertNotEqual(y1, y2)
            direction = "down" if y1 > y2 else "up"
            for x, y in ((x1, y1), (x2, y2)):
                self.assertTrue(bounds[0] < x < bounds[2] and bounds[1] < y < bounds[3])
            self.scrolls.append(direction)
            if self.scroll_frames[direction]:
                self.current = self.scroll_frames[direction].pop(0)
            elif self.keep_changing:
                self.current = copy.deepcopy(self.current)
                # Synthetic changing list prevents an unchanged-viewport exit.
                for node in ui.flatten(self.current):
                    if node.value.get("text", "").startswith("lantern-exam-backup-"):
                        node.value["text"] = "lantern-exam-backup-synthetic-row-" + str(len(self.scrolls)) + ".json"
                        break
        elif args[1] == "click":
            targets = [n for n in ui.flatten(self.runner.tree)
                       if n.value.get("type") == "Text" and n.value.get("text") == self.filename
                       and any(p is sheet.value for p in n.parents) and n.visible_bounds()]
            target = ui.unique(targets, "test exact file")
            bounds = target.visible_bounds()
            self.assertEqual(tuple(map(int, args[2:4])),
                             (round((bounds[0] + bounds[2]) / 2), round((bounds[1] + bounds[3]) / 2)))
            self.clicks.append(args)
            self.current = self.imported
        else:
            self.fail("Unexpected command: " + repr(args))

    def test_crowded_real_viewport_scrolls_native_grid_and_selects_only_exact_file(self):
        labels = [n.value.get("text") for n in ui.flatten(self.top)]
        self.assertIn("24 项", labels)
        self.assertNotIn(FILENAME, labels)
        # A matching app label behind the picker must not satisfy file lookup.
        one(self.top, "rootWebArea").value.setdefault("children", []).append(
            {"type": "Text", "text": FILENAME, "bounds": [100, 1000, 700, 1100]})
        self.runner.picker(FILENAME)
        self.assertEqual(self.scrolls, ["up", "down"])
        self.assertEqual(len(self.clicks), 1)
        self.assertEqual(self.runner.phase, "catalog")
        self.assertIsNone(self.runner.picker_filename)

    def test_two_viewports_are_read_before_file_is_clicked_once(self):
        intermediate = copy.deepcopy(self.top)
        for node in ui.flatten(intermediate):
            if node.value.get("text", "").startswith("lantern-exam-backup-"):
                node.value["text"] = "lantern-exam-backup-synthetic-intermediate.json"
                break
        self.scroll_frames["down"] = [intermediate, self.revealed]
        self.runner.picker(FILENAME)
        self.assertEqual(self.scrolls, ["up", "down", "down"])
        self.assertEqual(len(self.clicks), 1)

    def test_currently_visible_target_is_selected_without_any_scroll(self):
        self.current = self.revealed
        self.runner.picker(FILENAME)
        self.assertEqual(self.scrolls, [])
        self.assertEqual(len(self.clicks), 1)

    def test_reopened_lower_position_finds_allowlisted_latest_backup_above(self):
        self.filename = "lantern-exam-backup-00000000-0000-4000-8000-000000000099.json"
        self.runner.io.downloads.add(self.filename)
        for node in ui.flatten(self.revealed):
            if node.value.get("text") == FILENAME:
                node.value["text"] = self.filename
        self.scroll_frames["up"] = [self.revealed]
        self.runner.picker(self.filename)
        self.assertEqual(self.scrolls, ["up"])
        self.assertEqual(len(self.clicks), 1)

    def test_middle_start_reaches_top_then_finds_file_below_initial_viewport(self):
        middle = copy.deepcopy(self.top)
        for node in ui.flatten(middle):
            if node.value.get("text", "").startswith("lantern-exam-backup-"):
                node.value["text"] = "lantern-exam-backup-synthetic-middle.json"
                break
        self.current = middle
        self.scroll_frames = {"up": [self.top], "down": [middle, self.revealed]}
        self.runner.picker(FILENAME)
        self.assertEqual(self.scrolls, ["up", "up", "down", "down"])
        self.assertEqual(len(self.clicks), 1)

    def test_missing_file_fails_after_bounded_scrolls_without_click(self):
        self.scroll_frames = {"up": [], "down": []}
        with self.assertRaisesRegex(ui.Failure, "bounded native grid search"):
            self.runner.picker(FILENAME)
        self.assertEqual(self.scrolls, ["up", "down"])
        self.assertEqual(self.clicks, [])
        self.assertEqual(self.runner.phase, "picker")

    def test_continuously_changing_missing_file_still_has_finite_action_budget(self):
        self.scroll_frames = {"up": [], "down": []}
        self.keep_changing = True
        with self.assertRaisesRegex(ui.Failure, "bounded native grid search"):
            self.runner.picker(FILENAME)
        self.assertEqual(self.scrolls, ["up"] * 12 + ["down"] * 12)
        self.assertEqual(self.clicks, [])

    def test_new_unknown_overlay_after_scroll_stops_before_another_action(self):
        obstructed = copy.deepcopy(self.revealed)
        obstructed.append({"type": "Text", "text": "UNKNOWN OVERLAY", "bounds": [0, 300, 1000, 1800]})
        self.scroll_frames["down"] = [obstructed]
        with self.assertRaises(ui.Failure):
            self.runner.picker(FILENAME)
        self.assertEqual(self.scrolls, ["up", "down"])
        self.assertEqual(self.clicks, [])

    def test_ambiguous_native_grids_fail_without_swipe_or_click(self):
        one(self.top, "SheetPage").value["children"].append(copy.deepcopy(one(self.top, "Grid").value))
        with self.assertRaises(ui.Failure):
            self.runner.picker(FILENAME)
        self.runner.io.cli.assert_not_called()

    def test_duplicate_exact_file_after_scroll_fails_without_click(self):
        targets = [n for n in ui.flatten(self.revealed) if n.value.get("text") == FILENAME]
        self.assertEqual(len(targets), 1)
        one(self.revealed, "Grid").value["children"].append(copy.deepcopy(targets[0].value))
        with self.assertRaises(ui.Failure):
            self.runner.picker(FILENAME)
        self.assertEqual(self.scrolls, ["up", "down"])
        self.assertEqual(self.clicks, [])

    def test_legacy_missing_file_does_not_gain_unverified_grid_navigation(self):
        self.current = fixture("mock-picker-legacy-file.json")
        for node in ui.flatten(self.current):
            if node.value.get("text") == FILENAME:
                node.value["text"] = "different-file.json"
        with self.assertRaises(ui.Failure):
            self.runner.picker(FILENAME)
        self.runner.io.cli.assert_not_called()

    def test_unverified_filename_is_rejected_before_any_layout_or_action(self):
        with self.assertRaisesRegex(ui.Failure, "not one of this run's verified files"):
            self.runner.picker("unverified.json")
        self.assertEqual(self.reads, 0)
        self.runner.io.cli.assert_not_called()


if __name__ == "__main__":
    unittest.main()
