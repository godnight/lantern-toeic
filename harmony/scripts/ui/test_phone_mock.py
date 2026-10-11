"""Offline behavior regressions for the synthetic mock runner; never uses a device.

Fixtures come from real, sanitized layouts. Layouts inserted by fault tests are
explicit perturbations, not claims of additional device acceptance.
"""
import argparse
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import phone_smoke as ui
import phone_mock as mock

FIXTURES = Path(ui.__file__).parent / "fixtures"
PAGE_TITLE = "PDF page packing QA ONLY - 非真题"
PAGE_SOURCE = "Original synthetic PDF QA fixture"
PAGE_VERSION = "版本 1 · " + PAGE_SOURCE
PAGES = "qa-only-pages.json"
LEGACY_BACKUP = "lantern-vocabulary-records-00000000-0000-4000-8000-000000000001.json"
EXAM_BACKUP = "lantern-exam-backup-00000000-0000-4000-8000-000000000002.json"


def fixture(name):
    return ui.parse_layout((FIXTURES / name).read_text(encoding="utf-8-sig"))


def one(tree, role, text=None):
    return ui.unique(
        [n for n in ui.flatten(tree) if n.value.get("type") == role
         and (text is None or n.value.get("text") == text)], "fixture node")


class FakeClock:
    def __init__(self):
        self.seconds = 0.0

    def monotonic(self):
        return self.seconds

    def sleep(self, seconds):
        self.seconds += seconds

    def time(self):
        return 2_000_000_000 + self.seconds


class OfflineCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        # A mistake in a fake must fail the test before any external command.
        self.process_guard = self.enterContext(
            patch.object(ui.subprocess, "run", side_effect=AssertionError("No subprocess in offline tests")))
        self.clock = FakeClock()
        self.enterContext(patch.object(mock.time, "monotonic", self.clock.monotonic))
        self.enterContext(patch.object(mock.time, "sleep", self.clock.sleep))
        self.enterContext(patch.object(mock.time, "time", self.clock.time))

    def args(self, name="out"):
        return argparse.Namespace(
            device="127.0.0.1:1", cli="FAKE-CLI", hdc="FAKE-HDC", node="FAKE-NODE",
            powershell="FAKE-POWERSHELL", out=str(self.root / name),
            export_dir="/storage/media/100/local/files/Docs/Download/com.lantern.toeic",
            bundle="com.lantern.toeic", ability="EntryAbility", max_seconds=120,
            instance="OFFLINE-FIXTURE-ONLY", expected_version_code=20006,
            dedicated_test_device=True, duplicate_import=False,
            idle_app_confirmed=True, allow_physical_device=False,
            word="reservation", folders=["Download", "LANTERN TOEIC"])

    def make_runner(self):
        # MockRunner only reads source.title here; full package/model validation
        # is covered by the separate real verifier tests, not faked as passing.
        file = self.root / "pack.json"
        file.write_text(json.dumps({"source": {"title": PAGE_SOURCE}}), encoding="utf-8")
        pack = {"id": "page-packer-qa-only", "version": 1, "title": PAGE_TITLE,
                "file": str(file), "deviceFile": PAGES}
        io = Mock()
        io.out = self.root
        io.downloads = {PAGES, LEGACY_BACKUP}
        runner = mock.MockRunner(self.args(), io, {"examId": pack["id"], "packages": [pack]})
        return runner

    def layouts(self, runner, frames):
        frames = list(frames)
        state = {"reads": 0}
        def get():
            index = min(state["reads"], len(frames) - 1)
            runner.tree = frames[index]
            state["reads"] += 1
            return runner.tree
        runner.layout = get
        return state


class SurfaceTests(OfflineCase):
    def test_real_api26_grid_and_legacy_list_have_different_completion_modes(self):
        for name in ("download", "files"):
            with self.subTest(api26=name):
                self.assertEqual(mock.surface(fixture("mock-picker-api26-" + name + ".json"), True)[0],
                                 "instant-picker")
        for name in ("download", "file", "selected"):
            with self.subTest(legacy=name):
                self.assertEqual(mock.surface(fixture("mock-picker-legacy-" + name + ".json"), True)[0],
                                 "confirm-picker")
        self.assertEqual(mock.surface(fixture("mock-picker-api26-imported.json"))[0], "app")

    def test_picker_is_rejected_outside_picker_stage(self):
        with self.assertRaises(ui.Failure):
            mock.surface(fixture("mock-picker-api26-files.json"))

    def test_unknown_external_overlay_and_wrong_web_origin_are_rejected(self):
        for role in ("Text", "Column", "dialog", "alertDialog", "alert"):
            for picker in (False, True):
                with self.subTest(role=role, picker=picker):
                    tree = fixture("mock-picker-api26-files.json" if picker else "mock-catalog-two-packs.json")
                    tree.append({"type": role, "text": "UNKNOWN OVERLAY",
                                 "bounds": [0, 200, 1000, 1000], "clickable": True})
                    with self.assertRaises(ui.Failure):
                        mock.surface(tree, picker)
        tree = fixture("mock-catalog-two-packs.json")
        one(tree, "Web").value["text"] = "https://untrusted.invalid/"
        with self.assertRaises(ui.Failure):
            mock.surface(tree)

    def test_two_sheets_or_dialog_inside_sheet_are_rejected(self):
        tree = fixture("mock-picker-api26-files.json")
        tree.append(copy.deepcopy(one(tree, "SheetPage").value))
        with self.assertRaises(ui.Failure):
            mock.surface(tree, True)
        tree = fixture("mock-picker-api26-files.json")
        one(tree, "SheetPage").value.setdefault("children", []).append(
            {"type": "dialog", "text": "Confirm unknown action", "bounds": [200, 400, 800, 800]})
        with self.assertRaises(ui.Failure):
            mock.surface(tree, True)

    def test_unrecognized_picker_structure_never_degrades_to_app(self):
        tree = fixture("mock-picker-api26-files.json")
        for node in ui.flatten(tree):
            if node.value.get("type") == "Grid":
                node.value["type"] = "UnknownFileLayout"
        with self.assertRaises(ui.Failure):
            mock.surface(tree, True)


class ScopedSelectorTests(OfflineCase):
    def test_exact_second_card_matches_without_picking_first_identical_button(self):
        runner = self.make_runner()
        tree = fixture("mock-catalog-two-packs.json")
        buttons = ui.find_nodes(tree, text="音频预检与新考试", types={"button"}, clickable=True)
        self.assertEqual(len(buttons), 2)
        chosen = runner.filtered(tree, text="音频预检与新考试", types={"button"}, scope="catalog-card")
        self.assertEqual(len(chosen), 1)
        self.assertIs(chosen[0].value, buttons[1].value)
        self.assertFalse(mock.catalog_button(buttons[0], PAGE_TITLE, PAGE_VERSION))

    def test_card_rejects_wrong_version_missing_disclosure_and_unfamiliar_insertion(self):
        for defect in ("version", "missing", "inserted"):
            with self.subTest(defect=defect):
                tree = fixture("mock-catalog-two-packs.json")
                siblings = one(tree, "region", mock.MOCK).value["children"]
                if defect == "version":
                    siblings[5]["text"] = "版本 2 · " + PAGE_SOURCE
                elif defect == "missing":
                    del siblings[6]
                else:
                    siblings.insert(7, {"type": "paragraph", "text": "unexpected content",
                                        "bounds": [102, 2000, 1155, 2100]})
                self.assertEqual(self.make_runner().filtered(
                    tree, text="音频预检与新考试", types={"button"}, scope="catalog-card"), [])

    def test_duplicate_exact_cards_fail_without_click_or_scroll(self):
        runner = self.make_runner()
        tree = fixture("mock-catalog-two-packs.json")
        rows = one(tree, "region", mock.MOCK).value["children"]
        rows.extend(copy.deepcopy(rows[4:8]))
        self.layouts(runner, [tree])
        with self.assertRaises(ui.Failure):
            runner.locate(text="音频预检与新考试", types={"button"}, scope="catalog-card", scrolls=0)
        runner.io.cli.assert_not_called()

    def test_question_group_selects_radio_not_same_text_or_other_question(self):
        runner = self.make_runner()
        for number in (1, 2):
            tree = fixture("mock-answer-" + str(number) + ".json")
            scope = ("group", "第 " + str(number) + " 题选项")
            found = runner.filtered(tree, text="A", types={"radioButton"}, scope=scope)
            self.assertEqual(len(found), 1)
            self.assertEqual(found[0].value["type"], "radioButton")
            self.assertEqual(runner.filtered(tree, text="A", types={"radioButton"},
                                            scope=("group", "第 99 题选项")), [])
            self.assertTrue(mock.in_scope(found[0], "article", "第 " + str(number) + " 题"))

    def test_action_requires_question_group_and_media_region(self):
        runner = self.make_runner()
        runner.phase = "attempt"
        for kwargs in ({}, {"role": "staticText", "scope": ("group", "第 1 题选项")},
                       {"role": "radioButton", "scope": ("group", "第 3 题选项")}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ui.Failure):
                runner.click("A", **kwargs)
        runner.phase = "preflight"
        with self.assertRaises(ui.Failure):
            runner.click("播放")
        runner.io.cli.assert_not_called()

    def test_discarded_layout_target_rejected_even_with_same_text_and_coordinates(self):
        runner = self.make_runner()
        old = fixture("mock-answer-1.json")
        node = one(old, "radioButton", "A")
        runner.tree = copy.deepcopy(old)
        with self.assertRaises(ui.Failure):
            runner.tap_node(node)
        runner.io.cli.assert_not_called()

    def test_real_preflight_start_requires_ack_even_when_audio_is_playing(self):
        runner = self.make_runner()
        for name in ("ready", "playing"):
            self.assertEqual(runner.filtered(fixture("mock-preflight-" + name + ".json"),
                                            text=mock.START, types={"button"}), [])
        acknowledged = fixture("mock-preflight-ack.json")
        self.assertEqual(len(runner.filtered(acknowledged, text=mock.START, types={"button"})), 1)
        self.assertEqual(len(runner.filtered(acknowledged, text=mock.ACK, types={"checkBox"})), 1)


class DelayedTransitionTests(OfflineCase):
    def test_legacy_complete_is_tapped_once_while_selected_sheet_lingers(self):
        runner = self.make_runner()
        unselected = fixture("mock-picker-legacy-file.json")
        selected = fixture("mock-picker-legacy-selected.json")
        app = fixture("mock-picker-api26-imported.json")
        self.layouts(runner, [unselected] * 4 + [selected] * 8 + [app])
        runner.picker(LEGACY_BACKUP)
        self.assertEqual(runner.phase, "catalog")
        calls = runner.io.cli.call_args_list
        # One file tap and one confirmation, no repeated "完成" or blind Back.
        self.assertEqual(len(calls), 2)
        self.assertTrue(all(c.args[:2] == ("ui", "click") for c in calls))
        self.assertNotEqual(calls[0].args[2:4], calls[1].args[2:4])

    def test_api26_file_selection_waits_for_app_without_sending_confirmation(self):
        runner = self.make_runner()
        files = fixture("mock-picker-api26-files.json")
        app = fixture("mock-picker-api26-imported.json")
        self.layouts(runner, [files] * 9 + [app])
        runner.picker(PAGES)
        self.assertEqual(runner.phase, "catalog")
        runner.io.cli.assert_called_once()
        self.assertEqual(runner.io.cli.call_args.args[:2], ("ui", "click"))

    def test_unknown_or_ambiguous_picker_file_cannot_be_clicked(self):
        runner = self.make_runner()
        with self.assertRaises(ui.Failure):
            runner.picker("arbitrary-private.json")
        runner.io.cli.assert_not_called()
        tree = fixture("mock-picker-api26-files.json")
        chosen = one(tree, "Text", PAGES)
        chosen.parents[-1]["children"].append(copy.deepcopy(chosen.value))
        self.layouts(runner, [tree])
        with self.assertRaises(ui.Failure):
            runner.picker(PAGES)
        runner.io.cli.assert_not_called()

    def test_save_confirmation_reveals_top_then_waits_without_more_scroll_or_answers(self):
        self.check_save_confirmation(exit_disabled=False)

    def test_disabled_exit_can_anchor_read_only_save_wait_without_being_clicked(self):
        self.check_save_confirmation(exit_disabled=True)

    def check_save_confirmation(self, *, exit_disabled):
        runner = self.make_runner()
        pending = fixture("mock-answer-1.json")
        # The real answer fixture is viewport-truncated: it has neither status
        # nor the top exit button. These added frames model bounded navigation
        # back to the top, then an asynchronous persistence acknowledgement.
        anchor = copy.deepcopy(pending)
        one(anchor, "region", mock.MOCK).value["children"] = [
            {"type": "button", "text": "退出模考", "clickable": False,
             "bounds": [100, 150, 1100, 240]}]
        if exit_disabled:
            one(anchor, "button", "退出模考").value["enabled"] = False
        busy = copy.deepcopy(anchor)
        one(busy, "region", mock.MOCK).value["children"].append(
            {"type": "status", "text": "正在保存，请稍候。", "bounds": [100, 300, 1100, 390]})
        saved = copy.deepcopy(busy)
        one(saved, "status").value["text"] = "第 1 题已保存在本机。"
        state = {"scrolls": 0, "busy_reads": 0}
        def layout():
            if state["scrolls"] == 0:
                tree = pending
            elif state["scrolls"] == 1:
                tree = anchor
            else:
                state["busy_reads"] += 1
                tree = busy if state["busy_reads"] <= 12 else saved
            runner.tree = tree
            return tree
        runner.layout = layout
        def scroll(direction, scroller=None):
            self.assertEqual(direction, "up")
            state["scrolls"] += 1
            self.assertLessEqual(state["scrolls"], 2, "Do not scroll while waiting for persistence")
        with patch.object(runner, "scroll", side_effect=scroll):
            result = runner.status(r"^第 1 题已保存在本机。$")
        self.assertEqual(result.value["text"], "第 1 题已保存在本机。")
        self.assertEqual(state["scrolls"], 2)
        self.assertGreaterEqual(state["busy_reads"], 13)
        runner.io.cli.assert_not_called()
        runner.io.hdc.assert_not_called()

    def test_disabled_exit_still_cannot_be_clicked(self):
        runner = self.make_runner()
        runner.phase = "attempt"
        tree = fixture("mock-answer-1.json")
        one(tree, "region", mock.MOCK).value["children"].append(
            {"type": "button", "text": "退出模考", "clickable": True,
             "enabled": False, "bounds": [100, 150, 1100, 240]})
        self.layouts(runner, [tree])
        with self.assertRaises(ui.Failure):
            runner.click("退出模考", scope=("region", mock.MOCK), scrolls=0)
        runner.io.cli.assert_not_called()

    def test_already_visible_exact_saved_status_needs_no_scroll(self):
        runner = self.make_runner()
        tree = fixture("mock-answer-1.json")
        one(tree, "region", mock.MOCK).value["children"].append(
            {"type": "status", "text": "第 1 题已保存在本机。", "bounds": [100, 150, 1100, 240]})
        self.layouts(runner, [tree])
        with patch.object(runner, "scroll", side_effect=AssertionError("Already visible")):
            result = runner.status(r"^第 1 题已保存在本机。$")
        self.assertEqual(result.value["text"], "第 1 题已保存在本机。")
        runner.io.cli.assert_not_called()

    def test_scroll_rechecks_fresh_surface_before_sending_swipe(self):
        runner = self.make_runner()
        old = fixture("mock-answer-1.json")
        overlay = copy.deepcopy(old)
        overlay.append({"type": "dialog", "text": "UNKNOWN OVERLAY", "bounds": [0, 200, 1000, 1000]})
        runner.tree = old
        self.layouts(runner, [overlay])
        with self.assertRaises(ui.Failure):
            runner.scroll("up")
        runner.io.cli.assert_not_called()

    def test_duplicate_save_status_is_not_treated_as_confirmation(self):
        runner = self.make_runner()
        tree = fixture("mock-answer-1.json")
        rows = one(tree, "region", mock.MOCK).value["children"]
        for y in (150, 300):
            rows.append({"type": "status", "text": "第 1 题已保存在本机。",
                         "bounds": [100, y, 1100, y + 90]})
        self.layouts(runner, [tree])
        with self.assertRaises(ui.Failure):
            runner.status(r"^第 1 题已保存在本机。$")
        runner.io.cli.assert_not_called()

    def test_exit_waits_for_main_surface_before_reentering_catalog(self):
        runner = self.make_runner()
        runner.phase = "attempt"
        exiting = fixture("mock-answer-2.json")
        main = fixture("folded-home.json")
        self.layouts(runner, [exiting] * 12 + [main])
        runner.click = Mock()  # The tap boundary; simulate the UI's asynchronous response.
        catalog_entries = []
        def enter_catalog():
            self.assertFalse(ui.find_nodes(runner.tree, text=mock.MOCK, types={"region"}, visible=False))
            self.assertTrue(ui.find_nodes(runner.tree, text="主导航", types={"navigation"}, visible=False))
            catalog_entries.append(True)
        runner.catalog = enter_catalog
        runner.exit_to_catalog()
        runner.click.assert_called_once_with("退出模考", scope=("region", mock.MOCK), direction="up")
        self.assertEqual(catalog_entries, [True])
        runner.io.hdc.assert_not_called()

    def test_wait_deadline_refuses_stuck_surface_without_extra_clicks(self):
        runner = self.make_runner()
        self.layouts(runner, [fixture("mock-answer-2.json")])
        with self.assertRaises(ui.Failure):
            runner.wait_for(lambda *_: False, timeout=1)
        self.assertGreaterEqual(self.clock.seconds, 1)
        runner.io.cli.assert_not_called()
        runner.io.hdc.assert_not_called()

    def test_run_cold_start_follows_confirmed_exit_and_owned_backup(self):
        self.check_cold_start_boundary(exit_settles=True)

    def test_run_never_cold_starts_when_post_backup_exit_stays_pending(self):
        self.check_cold_start_boundary(exit_settles=False)

    def check_cold_start_boundary(self, *, exit_settles):
        """Exercise real run sequencing; fake earlier import/media/export I/O only."""
        runner = self.make_runner()
        # This test isolates run's B0 -> exit -> cold-start boundary. Package
        # byte transport, picking and saved status have separate regressions.
        runner.manifest["packages"] = []
        runner.preflight_target = Mock()
        runner.capture = Mock()
        runner.verify = Mock()
        runner.status = Mock()
        runner.locate = Mock()
        catalog = fixture("mock-catalog-two-packs.json")
        playing = fixture("mock-preflight-playing.json")
        answer = fixture("mock-answer-2.json")
        home = fixture("folded-home.json")
        boundary = {"exported": False, "exit_at": None, "exit_clicks": 0}
        baseline = self.root / "before-start.json"
        baseline.write_text(json.dumps({"attempts": []}), encoding="utf-8")

        def enter_catalog():
            runner.phase = "catalog"
            self.layouts(runner, [catalog])
            runner.layout()
        runner.catalog = enter_catalog

        def tap(text, **kwargs):
            if text == "播放":
                self.layouts(runner, [playing])
            elif text == mock.START:
                now = round(self.clock.time() * 1000)
                runner.start_window = (now, now)
            elif text == "退出模考":
                boundary["exit_clicks"] += 1
                pending = catalog if boundary["exported"] else answer
                if boundary["exported"]:
                    boundary["exit_at"] = self.clock.seconds
                frames = [pending] * 12
                if exit_settles or not boundary["exported"]:
                    frames += [home]
                self.layouts(runner, frames)
        runner.click = Mock(side_effect=tap)

        def export(label):
            if label != "B0-before-cold":
                return baseline, EXAM_BACKUP
            b0 = self.root / "B0.json"
            b0.write_text(json.dumps({"attempts": [{
                "id": "owned-by-this-test", "examId": runner.pack["id"],
                "examVersion": 1, "ordinal": 1, "status": "listening",
                "answers": {"1": {"choice": 0}, "2": {"choice": 1}},
                "startedAt": runner.start_window[0]}]}), encoding="utf-8")
            boundary["exported"] = True
            return b0, EXAM_BACKUP
        runner.export = Mock(side_effect=export)

        class ReachedColdStart(Exception):
            pass
        def cold_start():
            self.assertTrue(boundary["exported"])
            self.assertEqual(runner.attempt_id, "owned-by-this-test")
            self.assertEqual(runner.phase, "main")
            self.assertFalse(ui.find_nodes(runner.tree, text=mock.MOCK, types={"region"}, visible=False))
            self.assertTrue(ui.find_nodes(runner.tree, text="主导航", types={"navigation"}, visible=False))
            self.assertIsNotNone(boundary["exit_at"])
            self.assertGreaterEqual(self.clock.seconds - boundary["exit_at"], 3)
            raise ReachedColdStart()

        with patch.object(ui.Runner, "cold_start", side_effect=cold_start) as cold:
            with self.assertRaises(ReachedColdStart if exit_settles else ui.Failure):
                runner.run()
            self.assertEqual(cold.call_count, 1 if exit_settles else 0)
        self.assertEqual(boundary["exit_clicks"], 2)
        runner.io.cli.assert_not_called()
        runner.io.hdc.assert_not_called()


class DeadlineHandoffTests(OfflineCase):
    def prepare(self):
        runner = self.make_runner()
        runner.attempt_id = "owned-attempt"
        runner.exam["questions"] = [{"number": 1, "answer": 1}, {"number": 2, "answer": 2}]
        baseline = self.root / "B3.json"
        baseline.write_text(json.dumps({"attempts": [{
            "id": runner.attempt_id, "status": "listening", "startedAt": 1000,
            "listeningDeadline": 2_701_000, "readingDeadline": 7_201_000,
            "answers": {"1": {"choice": 0}, "2": {"choice": 1}}}]}), encoding="utf-8")
        order = []
        runner.click = Mock(side_effect=lambda *a, **k: order.append("resume"))
        runner.locate = Mock()
        runner.scroll = Mock()
        runner.exit_to_catalog = Mock(side_effect=lambda: order.append("exit-after-result"))
        final = self.root / "final-timeout.json"
        runner.export = Mock(side_effect=lambda label: (order.append("actual-export") or (final, EXAM_BACKUP)))
        runner.verify = Mock(side_effect=lambda *a: order.append("model-final-verification"))
        runner.capture = Mock(side_effect=lambda *a: order.append("final-capture"))
        return runner, baseline, final, order

    def test_timeout_ui_is_followed_by_real_export_boundary_and_model_comparison(self):
        runner, baseline, final, order = self.prepare()
        def observe(io, args, proof):
            order.append("read-only-observation")
            self.assertEqual(proof["expectedCorrect"], 0)
            self.assertEqual(proof["expectedUnanswered"], 198)
            self.assertEqual(proof["readingDeadline"], 7_201_000)
            self.assertEqual(len(proof["attemptIdSha256"]), 64)
        with patch("mock_deadlines.observe", side_effect=observe):
            runner.observe_then_export(baseline)
        self.assertEqual(order, ["resume", "read-only-observation", "exit-after-result",
                                 "actual-export", "model-final-verification", "final-capture"])
        runner.verify.assert_called_once_with("final-timeout-comparison", "--timeout-baseline", baseline, "--final-backup", final)
        self.assertIn("original-deadline-timeout-durable-backup", runner.checks)
        runner.io.hdc.assert_not_called()

    def test_observation_failure_cannot_export_or_claim_timeout_saved(self):
        runner, baseline, _, _ = self.prepare()
        with patch("mock_deadlines.observe", side_effect=ui.Failure("wrong visible phase")):
            with self.assertRaises(ui.Failure):
                runner.observe_then_export(baseline)
        runner.exit_to_catalog.assert_not_called()
        runner.export.assert_not_called()
        self.assertEqual(runner.checks, [])

    def test_final_export_and_timeout_comparison_use_distinct_new_report_paths(self):
        runner, baseline, final, _ = self.prepare()
        reports = set()
        def verify(label, *arguments):
            # The real verifier atomically creates each output exactly once.
            report = label + "-proof.json"
            if report in reports:
                raise ui.Failure("OUTPUT_EXISTS")
            reports.add(report)
        runner.verify.side_effect = verify
        def export(label):
            runner.verify(label, "--inspect", final)
            return final, EXAM_BACKUP
        runner.export.side_effect = export
        with patch("mock_deadlines.observe", return_value={"status": "passed"}):
            runner.observe_then_export(baseline)
        self.assertEqual(len(reports), 2)
        self.assertIn("original-deadline-timeout-durable-backup", runner.checks)

    def test_timeout_ui_without_verified_final_data_is_not_durable_success(self):
        runner, baseline, _, _ = self.prepare()
        runner.verify.side_effect = ui.Failure("Final backup changed an original answer")
        with patch("mock_deadlines.observe", return_value={"status": "passed"}):
            with self.assertRaises(ui.Failure):
                runner.observe_then_export(baseline)
        self.assertIn("real-time-listening-reading-timeout-ui", runner.checks)
        self.assertNotIn("original-deadline-timeout-durable-backup", runner.checks)
        runner.capture.assert_not_called()

    def test_another_active_attempt_is_rejected_before_resuming(self):
        runner, baseline, _, _ = self.prepare()
        runner.attempt_id = "unexpected-attempt"
        with self.assertRaises(ui.Failure):
            runner.observe_then_export(baseline)
        runner.click.assert_not_called()


class AttemptOwnershipTests(OfflineCase):
    def history(self):
        pack = {"id": "page-packer-qa-only", "version": 1}
        old = {"id": "older-attempt", "examId": pack["id"], "examVersion": 1,
               "ordinal": 1, "status": "submitted", "answers": {}, "startedAt": 1000}
        new = {"id": "current-attempt", "examId": pack["id"], "examVersion": 1,
               "ordinal": 2, "status": "listening", "answers": {"1": {"choice": 0}, "2": {"choice": 1}},
               "startedAt": 100_000}
        return {"attempts": [old]}, {"attempts": [copy.deepcopy(old), new]}, pack, (99_000, 101_000)

    def test_exact_new_attempt_is_attributed_while_prior_history_is_preserved(self):
        self.assertEqual(mock.owned_attempt(*self.history()), "current-attempt")

    def test_lost_or_modified_history_is_rejected_even_when_new_answers_look_right(self):
        for defect in ("missing", "changed", "replaced-id", "extra"):
            before, current, pack, window = self.history()
            if defect == "missing":
                current["attempts"].pop(0)
            elif defect == "changed":
                current["attempts"][0]["answers"] = {"1": {"choice": 2}}
            elif defect == "replaced-id":
                current["attempts"][0]["id"] = "impostor-history"
            else:
                current["attempts"].append({**current["attempts"][1], "id": "unattributed-extra"})
            with self.subTest(defect=defect), self.assertRaises(ui.Failure):
                mock.owned_attempt(before, current, pack, window)

    def test_wrong_package_version_ordinal_time_status_or_answers_rejected(self):
        for field, value in [
            ("examId", "different-pack"), ("examVersion", 2), ("ordinal", 1),
            ("startedAt", 90_000), ("startedAt", 110_000), ("status", "submitted"),
            ("answers", {"1": {"choice": 0}}),
            ("answers", {"1": {"choice": 1}, "2": {"choice": 0}})]:
            before, current, pack, window = self.history()
            current["attempts"][1][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ui.Failure):
                mock.owned_attempt(before, current, pack, window)

    def test_existing_active_attempt_or_missing_start_evidence_blocks_attribution(self):
        before, current, pack, window = self.history()
        with self.assertRaises(ui.Failure):
            mock.owned_attempt(before, current, pack, None)
        before["attempts"][0]["status"] = current["attempts"][0]["status"] = "reading"
        with self.assertRaises(ui.Failure):
            mock.owned_attempt(before, current, pack, window)


class TransportAndLockTests(OfflineCase):
    def transport(self):
        transport = mock.MockTransport(self.args(), {"packages": [{"deviceFile": PAGES}]})
        transport.command = Mock(return_value="")
        return transport

    def test_allowed_download_and_inspection_bind_exact_target(self):
        transport = self.transport()
        ui.validate(transport.args)
        target = str(transport.out / "received.json")
        for args in [("shell", "bm", "dump", "-n", transport.args.bundle),
                     ("shell", "ls", "-1", transport.args.export_dir),
                     ("file", "recv", transport.args.export_dir + "/" + PAGES, target)]:
            transport.hdc(*args)
            self.assertEqual(transport.command.call_args.args[0],
                             [transport.args.hdc, "-t", transport.args.device, *args])
        self.process_guard.assert_not_called()

    def test_unknown_file_escape_existing_destination_and_mutations_are_rejected(self):
        transport = self.transport()
        out = transport.out
        existing = out / "exists.json"
        existing.write_text("keep-me", encoding="utf-8")
        source = transport.args.export_dir + "/" + PAGES
        forbidden = [
            ("file", "recv", transport.args.export_dir + "/private.json", str(out / "a.json")),
            ("file", "recv", transport.args.export_dir + "/../" + PAGES, str(out / "b.json")),
            ("file", "recv", source, str(out.parent / "outside.json")),
            ("file", "recv", source, str(existing)),
            ("file", "send", str(existing), source),
            ("shell", "rm", "-rf", "/data"),
            ("shell", "bm", "clean", "-n", transport.args.bundle),
            ("shell", "aa", "force-stop", "other.app"),
            ("uninstall", transport.args.bundle),
            ("-t", "other-target", "shell", "ls", "-1", transport.args.export_dir)]
        for args in forbidden:
            with self.subTest(args=args), self.assertRaises(ui.Failure):
                transport.hdc(*args)
        transport.command.assert_not_called()
        self.assertEqual(existing.read_text(encoding="utf-8"), "keep-me")

    def test_verified_backup_becomes_downloadable_only_after_explicit_registration(self):
        transport = self.transport()
        command = ("file", "recv", transport.args.export_dir + "/" + EXAM_BACKUP,
                   str(transport.out / "backup.json"))
        with self.assertRaises(ui.Failure):
            transport.hdc(*command)
        transport.downloads.add(EXAM_BACKUP)
        transport.hdc(*command)
        transport.command.assert_called_once()

    def test_target_inventory_and_version_are_gates_before_ui_actions(self):
        runner = self.make_runner()
        valid = {"name": runner.args.instance, "serial": runner.args.device, "status": "running"}
        for inventory in ([], [{**valid, "serial": "127.0.0.1:2"}], [{**valid, "status": "stopped"}],
                          [valid, copy.deepcopy(valid)]):
            runner.io.emulator_inventory.return_value = inventory
            with self.subTest(inventory=inventory), self.assertRaises(ui.Failure):
                runner.preflight_target()
        runner.io.hdc.assert_not_called()
        runner.io.emulator_inventory.return_value = [valid]
        runner.io.hdc.return_value = '{"versionCode": 20005}'
        with self.assertRaises(ui.Failure):
            runner.preflight_target()
        runner.io.cli.assert_not_called()
        runner.io.hdc.return_value = '{"versionCode": 20006}'
        runner.preflight_target()
        self.assertTrue(runner.target_verified)

    def test_command_timeout_is_capped_to_remaining_budget_and_expiry_sends_nothing(self):
        transport = mock.MockTransport(self.args(), {"packages": []})
        self.clock.seconds = 118
        with patch.object(ui.Transport, "command", return_value="ok") as base:
            self.assertEqual(transport.command(["FAKE"], "probe", 35), "ok")
            self.assertEqual(base.call_args.args[-1], 2)
            self.clock.seconds = 121
            with self.assertRaises(ui.Failure):
                transport.command(["FAKE"], "probe")
            self.assertEqual(base.call_count, 1)
        self.process_guard.assert_not_called()

    def test_lock_is_exclusive_and_released_after_failure(self):
        # Never use or delete the real observer's reservation file.
        with patch.object(mock.tempfile, "gettempdir", return_value=str(self.root)):
            first = mock.DeviceLock("SYNTHETIC-TARGET")
            with self.assertRaisesRegex(RuntimeError, "test body"):
                with first:
                    self.assertTrue(first.path.exists())
                    with self.assertRaises(FileExistsError):
                        with mock.DeviceLock("SYNTHETIC-TARGET"):
                            self.fail("Second owner acquired the same lock")
                    raise RuntimeError("test body")
            self.assertFalse(first.path.exists())

    def test_lock_release_does_not_remove_another_owners_token(self):
        with patch.object(mock.tempfile, "gettempdir", return_value=str(self.root)):
            lock = mock.DeviceLock("SYNTHETIC-TARGET")
            with lock:
                lock.path.write_text(json.dumps({"pid": 0, "token": "replacement-owner"}), encoding="utf-8")
            self.assertTrue(lock.path.exists())
            self.assertEqual(json.loads(lock.path.read_text())["token"], "replacement-owner")


if __name__ == "__main__":
    unittest.main(verbosity=2)
