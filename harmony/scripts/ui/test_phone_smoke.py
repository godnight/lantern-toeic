import argparse
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock
import phone_smoke as ui

HERE = Path(__file__).parent


def fixture(name):
    return ui.parse_layout((HERE / "fixtures" / name).read_text(encoding="utf-8-sig"))


class LayoutTests(unittest.TestCase):
    def test_desktop_library_hidden_behind_footer_is_not_clickable(self):
        tree = fixture("desktop-vocabulary.json")
        self.assertEqual(len(ui.find_nodes(tree, regex=r"^学习书库", types={"button"}, visible=False)), 1)
        self.assertEqual(ui.find_nodes(tree, regex=r"^学习书库", types={"button"}), [])

    def test_desktop_growth_uses_only_visible_piece_above_footer(self):
        node = ui.unique(ui.find_nodes(fixture("desktop-vocabulary.json"), regex=r"^成长足迹", types={"button"}), "growth")
        self.assertEqual(node.visible_bounds()[3], 1288)
        self.assertLess((node.visible_bounds()[1] + node.visible_bounds()[3]) / 2, 1288)

    def test_folded_navigation_locates_by_text_without_desktop_suffix(self):
        node = ui.unique(ui.find_nodes(fixture("folded-home.json"), regex=r"^训练之境(?:\s|$)", types={"button"}), "training")
        self.assertTrue(node.visible_bounds())

    def test_word_selector_excludes_advance_reservation(self):
        tree = fixture("starred-query.json")
        found = ui.find_nodes(tree, regex=r"^\S+\s+reservation\s", types={"button"})
        self.assertEqual(len(found), 1)
        self.assertTrue(found[0].value["text"].startswith("酒店与餐饮 reservation"))

    def test_toggle_label_can_observe_state_without_writing(self):
        tree = fixture("starred-query.json")
        found = ui.find_nodes(tree, text="移出生词本：reservation", types={"toggleButton"})
        self.assertEqual(len(found), 1)

    def test_zero_bounds_and_disabled_nodes_are_rejected(self):
        tree = [{"text": "a", "bounds": [0, 0, 0, 0]}, {"text": "a", "bounds": [0, 0, 100, 100], "enabled": False}]
        self.assertEqual(ui.find_nodes(tree, text="a"), [])

    def test_ambiguous_targets_fail_instead_of_first_match(self):
        tree = [{"text": "完成", "bounds": [0, 0, 100, 100]}] * 2
        with self.assertRaises(ui.Failure):
            ui.unique(ui.find_nodes(tree, text="完成"), "complete")

    def test_cli_non_json_diagnostic_is_not_treated_as_layout(self):
        with self.assertRaises(ValueError):
            ui.parse_layout("warning: device unavailable\n[]")


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.event = {"id": "fixture-event", "wordId": "reservation", "type": "review", "grade": "remembered", "createdAt": "2026-10-10T16:00:00.000Z"}

    def save(self, name, events):
        p = self.root / name
        p.write_text(json.dumps({"kind": "lantern-vocabulary", "schemaVersion": 1, "events": events}), encoding="utf-8")
        return p

    def test_unchanged_events_pass_even_if_property_order_changes(self):
        a = self.save("a.json", [self.event])
        b = self.save("b.json", [dict(reversed(list(self.event.items())))])
        self.assertEqual(ui.compare_backups([a, b])["eventCount"], 1)

    def test_same_count_with_changed_content_fails(self):
        a = self.save("a.json", [self.event])
        b = self.save("b.json", [{**self.event, "grade": "again"}])
        with self.assertRaises(ui.Failure):
            ui.compare_backups([a, b])

    def test_duplicated_event_fails_even_with_identical_content(self):
        p = self.save("a.json", [self.event, self.event])
        with self.assertRaises(ui.Failure):
            ui.canonical_backup(p)

    def test_changed_id_fails(self):
        a = self.save("a.json", [self.event])
        b = self.save("b.json", [{**self.event, "id": "different"}])
        with self.assertRaises(ui.Failure):
            ui.compare_backups([a, b])


class SafetyTests(unittest.TestCase):
    def args(self, *extra):
        return ui.parser().parse_args(["run", "--device", "127.0.0.1:55555", "--cli", "deveco.ps1", "--hdc", "hdc.exe", "--out", "unused", *extra])

    def test_device_is_mandatory(self):
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            ui.parser().parse_args(["run", "--cli", "x", "--hdc", "x", "--out", "x"])

    def test_cold_launch_requires_idle_confirmation(self):
        with self.assertRaises(ui.Failure):
            ui.validate(self.args())

    def test_duplicate_import_cannot_run_on_personal_smoke_mode(self):
        with self.assertRaises(ui.Failure):
            ui.validate(self.args("--idle-app-confirmed", "--duplicate-import"))

    def test_defaults_do_not_enable_data_mutations(self):
        args = self.args("--idle-app-confirmed")
        ui.validate(args)
        self.assertFalse(args.dedicated_test_device)
        self.assertFalse(args.duplicate_import)

    def test_invalid_target_rejected_before_subprocess(self):
        args = self.args("--idle-app-confirmed")
        args.device = "x; dangerous"
        with self.assertRaises(ui.Failure):
            ui.validate(args)

    def test_transport_always_binds_device_and_never_uses_shell(self):
        with tempfile.TemporaryDirectory() as tmp:
            args = self.args("--idle-app-confirmed")
            args.out = str(Path(tmp) / "new")
            io = ui.Transport(args)
            completed = argparse.Namespace(stdout="[]", stderr="", returncode=0)
            with patch.object(ui.subprocess, "run", return_value=completed) as run:
                io.cli("ui", "layout", "--format", "json")
                argv = run.call_args.args[0]
                self.assertEqual(argv[-2:], ["--device", args.device])
                self.assertIs(run.call_args.kwargs["shell"], False)
                io.hdc("shell", "aa", "start", "-a", "EntryAbility", "-b", "com.lantern.toeic")
                self.assertEqual(run.call_args.args[0][1:3], ["-t", args.device])
            command = json.loads(next(Path(args.out).glob("*.command.json")).read_text())
            self.assertNotIn(args.device, command["argv"])

    def test_output_directory_never_overwrites_previous_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            args = self.args("--idle-app-confirmed")
            args.out = tmp
            with self.assertRaises(FileExistsError):
                ui.Transport(args)

    def test_physical_target_fails_without_extra_opt_in(self):
        args = self.args("--idle-app-confirmed")
        args.device = "SYNTHETIC-PHYSICAL-TARGET"
        with self.assertRaises(ui.Failure):
            ui.validate(args)
        args.allow_physical_device = True
        ui.validate(args)

    def test_localhost_target_still_requires_running_emulator_inventory(self):
        args = self.args("--idle-app-confirmed")
        transport = Mock()
        transport.emulator_inventory.return_value = [{"serial": args.device, "status": "stopped"}]
        with self.assertRaises(ui.Failure):
            ui.Runner(args, transport).preflight_target()
        transport.hdc.assert_not_called()

    def test_smoke_cannot_click_favorite_even_if_workflow_requests_it(self):
        args = self.args("--idle-app-confirmed")
        tree = fixture("starred-query.json")
        node = ui.unique(ui.find_nodes(tree, text="移出生词本：reservation"), "favorite")
        with self.assertRaises(ui.Failure):
            ui.safe_click(node, args, tree)

    def test_smoke_cannot_grade_even_if_workflow_requests_it(self):
        args = self.args("--idle-app-confirmed")
        parent = {"type": "Web", "text": "https://lantern.local/", "bounds": [0, 0, 1000, 1000]}
        node = ui.Node({"type": "button", "text": "记住了", "bounds": [0, 0, 100, 100]}, (parent,))
        with self.assertRaises(ui.Failure):
            ui.safe_click(node, args, [parent])
        args.dedicated_test_device = True
        ui.safe_click(node, args, [parent])

    def test_default_cannot_click_system_picker_text(self):
        args = self.args("--idle-app-confirmed")
        node = ui.Node({"type": "Text", "text": "完成", "bounds": [0, 0, 100, 100]}, ())
        with self.assertRaises(ui.Failure):
            ui.safe_click(node, args, [node.value], ("完成",))

    def test_unexpected_modal_blocks_underlying_app_click(self):
        args = self.args("--idle-app-confirmed")
        tree = fixture("folded-home.json")
        node = ui.unique(ui.find_nodes(tree, regex=r"^训练之境", types={"button"}), "training")
        tree.append({"type": "dialog", "text": "Unknown popup", "bounds": [0, 0, 100, 100]})
        with self.assertRaises(ui.Failure):
            ui.safe_click(node, args, tree)

    def test_visible_recording_blocks_force_stop_despite_idle_flag(self):
        args = self.args("--idle-app-confirmed")
        transport = Mock()
        transport.cli.return_value = json.dumps([{"text": "正在录音", "bounds": [0, 0, 100, 100]}])
        with self.assertRaises(ui.Failure):
            ui.Runner(args, transport).cold_start()
        transport.hdc.assert_not_called()

    def test_transport_cannot_uninstall_reset_or_send_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            args = self.args("--idle-app-confirmed")
            args.out = str(Path(tmp) / "new")
            transport = ui.Transport(args)
            with patch.object(ui.subprocess, "run") as run:
                for command in [("uninstall", args.bundle), ("shell", "bm", "clean", "-n", args.bundle),
                                ("file", "send", "x", "/data/x")]:
                    with self.assertRaises(ui.Failure):
                        transport.hdc(*command)
                with self.assertRaises(ui.Failure):
                    transport.cli("run", "--uninstall")
                run.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
