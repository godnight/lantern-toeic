"""Offline sequencing of actual MockRunner.run; no device subprocess is possible.

Import/media/transport/model calls are controlled boundaries here. Real storage
conflict and latest-snapshot idempotence are covered separately with actual TS.
"""
import json
from unittest.mock import Mock, patch
import phone_mock as mock
import phone_smoke as ui
from test_phone_mock import OfflineCase, fixture


class RestoreSnapshotSequenceTests(OfflineCase):
    def scenario(self):
        runner = self.make_runner()
        runner.args.observe_deadlines = False
        # Retain runner.pack but omit this test's unrelated package-I/O loop.
        runner.manifest["packages"] = []
        runner.preflight_target = Mock()
        runner.capture = Mock()
        runner.verify = Mock()
        runner.status = Mock()
        runner.locate = Mock()
        runner.filtered = Mock(return_value=[])
        runner.wait_for = Mock(return_value=True)
        runner.exit_to_catalog = Mock()
        runner.exit_to_main = Mock()
        runner.catalog = Mock()
        self.layouts(runner, [fixture("mock-catalog-two-packs.json")])
        baseline = self.root / "before-start.json"
        baseline.write_text(json.dumps({"attempts": []}), encoding="utf8")
        files = {label: self.root / (label + ".json") for label in
                 ("B0-before-cold", "B1-after-cold", "B2-after-restore", "B3-after-restore")}
        names = {label: f"lantern-exam-backup-00000000-0000-4000-8000-{i:012d}.json"
                 for i, label in enumerate(files, 1)}
        def click(text, **kwargs):
            if text == mock.START:
                now = round(self.clock.time() * 1000)
                runner.start_window = (now, now)
        runner.click = Mock(side_effect=click)
        def export(label):
            if label in ("before-import", "before-start"):
                return baseline, "lantern-exam-backup-00000000-0000-4000-8000-000000000000.json"
            attempt = {"id": "owned-sequence-only", "examId": runner.pack["id"], "examVersion": 1,
                       "ordinal": 1, "status": "listening", "startedAt": runner.start_window[0],
                       "answers": {"1": {"choice": 0}, "2": {"choice": 1}}}
            files[label].write_text(json.dumps({"attempts": [attempt]}), encoding="utf8")
            return files[label], names[label]
        runner.export = Mock(side_effect=export)
        runner.picker = Mock()
        runner.observe_then_export = Mock()
        return runner, baseline, files, names

    def execute(self, runner):
        with patch.object(ui.Runner, "cold_start") as cold:
            runner.run()
            cold.assert_called_once_with()
        runner.io.cli.assert_not_called()
        runner.io.hdc.assert_not_called()

    def test_both_duplicate_restores_select_latest_post_cold_b1_filename(self):
        runner, _, _, names = self.scenario()
        self.execute(runner)
        self.assertEqual([call.args[0] for call in runner.picker.call_args_list],
                         [names["B1-after-cold"], names["B1-after-cold"]])
        self.assertNotIn(names["B0-before-cold"], [call.args[0] for call in runner.picker.call_args_list])

    def test_b0_remains_in_final_four_snapshot_comparison_and_b3_is_long_baseline(self):
        runner, baseline, files, _ = self.scenario()
        runner.args.observe_deadlines = True
        self.execute(runner)
        compared = [call for call in runner.verify.call_args_list if call.args[0] == "final-backup-comparison"]
        self.assertEqual(len(compared), 1)
        self.assertEqual(compared[0].args, ("final-backup-comparison", "--baseline", baseline,
                         "--before-import", baseline, "--files", files["B0-before-cold"],
                         files["B1-after-cold"], files["B2-after-restore"], files["B3-after-restore"]))
        runner.observe_then_export.assert_called_once_with(files["B3-after-restore"])

    def test_missing_post_cold_export_does_not_fall_back_to_older_snapshot(self):
        runner, _, _, _ = self.scenario()
        export = runner.export.side_effect
        def fail_b1(label):
            if label == "B1-after-cold": raise ui.Failure("Post-cold export failed")
            return export(label)
        runner.export.side_effect = fail_b1
        with patch.object(ui.Runner, "cold_start"), self.assertRaisesRegex(ui.Failure, "Post-cold"):
            runner.run()
        runner.picker.assert_not_called()
        runner.observe_then_export.assert_not_called()
        self.assertNotIn("final-backup-comparison", [call.args[0] for call in runner.verify.call_args_list])


if __name__ == "__main__":
    import unittest
    unittest.main(verbosity=2)
