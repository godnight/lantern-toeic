"""Offline classifications and virtual-clock flows; never invokes a device CLI."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import mock_deadlines as obs

FIXTURES = Path(__file__).with_name("fixtures")
TITLE = "PDF page packing QA ONLY - 非真题"


def fixture(name="listening"):
    return json.loads((FIXTURES / f"mock-deadline-{name}.json").read_text(encoding="utf-8"))


def baseline():
    start = 2_000_000_000_000
    return {"title": TITLE, "startedAt": start, "listeningDeadline": start + 2_700_000,
            "readingDeadline": start + 7_200_000, "attemptIdSha256": "a" * 64,
            "expectedCorrect": 2, "expectedUnanswered": 198}


def region(tree):
    return next(n.value for n in obs.ui.flatten(tree) if n.value.get("type") == "region"
                and n.value.get("text") == obs.REGION)


def phase_tree(phase, remaining=0, correct=2):
    tree = fixture()
    part = region(tree)
    nodes = list(obs.ui.flatten(tree))
    for node in nodes:
        if node.value.get("text") == "听力 LC":
            node.value["text"] = {"listening": "听力 LC", "reading": "阅读 RC",
                                  "saving": "时间已到", "submitted": "时间已到"}[phase]
        if node.value.get("type") == "strong":
            node.value["text"] = f"{remaining // 60:02}:{remaining % 60:02}"
    if phase == "saving":
        part["children"].append({"type": "alert", "text": obs.PENDING_SUBMISSION,
                                  "bounds": [50, 1000, 1100, 1150]})
    if phase == "submitted":
        # Synthetic result mutation; no live-result fixture is fabricated.
        part["children"] = [
            {"type": "heading", "text": TITLE, "bounds": [50, 250, 1150, 400]},
            {"type": "heading", "text": f"正确 {correct}/200 · 漏答 198", "bounds": [50, 700, 1000, 760]},
            {"type": "paragraph", "text": "首次完整模考 · 到时自动交卷", "bounds": [50, 770, 1000, 820]}]
    return tree


class Clock:
    def __init__(self, base):
        self.mono = 1000.0
        self.wall = base["listeningDeadline"] / 1000 - 15

    def sleep(self, seconds):
        self.mono += seconds
        self.wall += seconds


class ReadOnlyFake:
    """Only exposes the three observer operations; no command/HDC/action API."""
    def __init__(self, out, clock, base):
        self.out, self.clock, self.base = Path(out), clock, base
        self.end = clock.mono + 10_000
        self.events = []
        self.layout_count = 0
        self.mutate = None
        self.stopped = False
        self.omit_screenshot = False
        self.fail_layout = False
        self.inventory_jump = False
        self.gap_after_screenshot = False

    def emulator_inventory(self):
        self.events.append(("inventory",))
        if self.inventory_jump:
            self.clock.wall += 30
        return [{"name": "LanternOffline7", "serial": "127.0.0.1:5555",
                 "status": "stopped" if self.stopped else "running"}]

    def cli(self, *args, label):
        self.events.append(args[:2])
        if args[:2] == ("ui", "screenshot"):
            if not self.omit_screenshot:
                Path(args[3]).write_bytes(b"OFFLINE TEST PLACEHOLDER, NOT DEVICE PIXELS")
            if self.gap_after_screenshot:
                self.clock.sleep(130)
            return ""
        if args != ("ui", "layout", "--format", "json", "--mode", "simplified"):
            raise AssertionError("Not a permitted read-only call")
        if self.fail_layout:
            raise obs.ui.Failure("private-device-id and private-file-path must not escape")
        self.layout_count += 1
        now = round(self.clock.wall * 1000)
        if now < self.base["listeningDeadline"]:
            phase, deadline = "listening", self.base["listeningDeadline"]
        elif now < self.base["readingDeadline"]:
            phase, deadline = "reading", self.base["readingDeadline"]
        else:
            phase, deadline = "submitted", now
        tree = phase_tree(phase, max(0, (deadline - now + 999) // 1000))
        if self.mutate:
            tree = self.mutate(tree, self)
        return json.dumps(tree, ensure_ascii=False)


class ClassificationTests(unittest.TestCase):
    def test_actual_sanitized_listening_and_reading_layouts(self):
        self.assertEqual(obs.analyze_layout(fixture(), baseline()), {"phase": "listening", "remainingSeconds": 2151})
        self.assertEqual(obs.analyze_layout(fixture("reading"), baseline())["phase"], "reading")

    def test_native_overlay_sheet_dialog_and_foreign_origin_are_rejected(self):
        for role in ("Text", "SheetPage", "dialog", "alertDialog"):
            with self.subTest(role=role):
                tree = fixture()
                tree.append({"type": role, "text": "Unknown", "bounds": [0, 0, 1100, 100]})
                with self.assertRaises(obs.ui.Failure): obs.analyze_layout(tree, baseline())
        tree = fixture()
        next(n.value for n in obs.ui.flatten(tree) if n.value.get("type") == "Web")["text"] = "https://example.invalid/"
        with self.assertRaises(obs.ui.Failure): obs.analyze_layout(tree, baseline())

    def test_exact_pending_alert_only_and_never_retry_or_child_error(self):
        self.assertEqual(obs.analyze_layout(phase_tree("saving"), baseline()), {"phase": "saving"})
        for child in (False, True):
            tree = phase_tree("saving")
            alert = region(tree)["children"][-1]
            if child:
                alert["children"] = [{"type": "button", "text": "重新读取记录", "clickable": True,
                                      "bounds": [50, 1000, 1000, 1100]}]
            else:
                alert["text"] += "请点击“重新读取记录”重试。"
            with self.assertRaises(obs.ui.Failure): obs.analyze_layout(tree, baseline())

    def test_pending_words_outside_scoped_exam_do_not_bypass_overlay(self):
        tree = fixture()
        tree.append({"type": "alert", "text": obs.PENDING_SUBMISSION, "bounds": [0, 0, 1100, 100]})
        with self.assertRaises(obs.ui.Failure): obs.analyze_layout(tree, baseline())

    def test_result_needs_exact_counts_timeout_marker_and_no_active_clock(self):
        self.assertEqual(obs.analyze_layout(phase_tree("submitted"), baseline())["phase"], "submitted")
        for kind in ("wrong-count", "manual", "active-clock"):
            tree = phase_tree("submitted", correct=1 if kind == "wrong-count" else 2)
            if kind == "manual": region(tree)["children"][-1]["text"] = "首次完整模考 · 主动交卷"
            if kind == "active-clock":
                region(tree)["children"].append({"type": "timer", "text": "当前阶段剩余时间", "bounds": [50, 1100, 1100, 1200]})
            with self.subTest(kind=kind), self.assertRaises(obs.ui.Failure): obs.analyze_layout(tree, baseline())

    def test_title_answer_count_or_offscreen_timer_cannot_be_inferred(self):
        for kind in ("title", "answers", "timer"):
            tree = fixture()
            for node in obs.ui.flatten(tree):
                if kind == "title" and node.value.get("text") == TITLE: node.value["text"] = "Other exam"
                if kind == "answers" and node.value.get("text", "").startswith("已保存 2/200"): node.value["text"] = "已保存 1/200 题"
                if kind == "timer" and node.value.get("type") == "timer": node.value["visible"] = False
            with self.subTest(kind=kind), self.assertRaises(obs.ui.Failure): obs.analyze_layout(tree, baseline())

    def test_deadline_checks_reject_early_late_and_reset_countdowns(self):
        b = baseline()
        cases = [({"phase": "reading", "remainingSeconds": 4500}, b["listeningDeadline"] - 6000),
                 ({"phase": "submitted"}, b["readingDeadline"] - 6000),
                 ({"phase": "listening", "remainingSeconds": 0}, b["listeningDeadline"] + 61000),
                 ({"phase": "reading", "remainingSeconds": 4000}, b["listeningDeadline"])]
        for sample, now in cases:
            with self.subTest(sample=sample), self.assertRaises(obs.ui.Failure): obs.check_deadline(sample, b, now, now)

    def test_baseline_rejects_shifted_deadlines_foreign_fields_and_non_synthetic_counts(self):
        for field, value in (("listeningDeadline", 1), ("expectedUnanswered", 197), ("expectedCorrect", True),
                             ("attemptIdSha256", "raw-attempt-id"), ("secret", "must not be emitted")):
            b = baseline(); b[field] = value
            with self.subTest(field=field), self.assertRaises(obs.ui.Failure): obs.validate_baseline(b)


class FlowTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="lantern-offline-observer-test-")
        self.addCleanup(self.directory.cleanup)
        self.base = baseline()
        self.clock = Clock(self.base)
        self.io = ReadOnlyFake(self.directory.name, self.clock, self.base)
        self.args = SimpleNamespace(device="127.0.0.1:5555", instance="LanternOffline7")
        for name, method in (("time", lambda: self.clock.wall), ("monotonic", lambda: self.clock.mono), ("sleep", self.clock.sleep)):
            patcher = patch.object(obs.time, name, method)
            patcher.start(); self.addCleanup(patcher.stop)

    def report(self):
        return json.loads((self.io.out / "deadline-observer.json").read_text(encoding="utf8"))

    def fails(self, expected):
        with self.assertRaisesRegex(obs.ui.Failure, expected): obs.observe(self.io, self.args, self.base)
        report = self.report()
        self.assertEqual(report["status"], "failed")
        self.assertFalse(report["durableSubmissionVerified"])
        return report

    def test_full_virtual_clock_flow_requires_lc_rc_timeout_and_restores_shared_budget(self):
        end = self.io.end
        result = obs.observe(self.io, self.args, self.base)
        self.assertEqual(result["status"], "passed")
        self.assertTrue(result["observedListeningToReading"])
        self.assertTrue(result["sawTimeoutResult"])
        self.assertFalse(result["durableSubmissionVerified"])
        self.assertEqual(self.io.end, end)
        self.assertEqual(result["limits"]["maxSeconds"], 4575)
        self.assertTrue(all(call in (("inventory",), ("ui", "layout"), ("ui", "screenshot")) for call in self.io.events))
        self.assertNotIn(self.args.device, json.dumps(result))
        self.assertGreater(len(result["samples"]), 100)

    def test_first_reading_sample_is_rejected_even_near_boundary(self):
        self.clock.wall = self.base["listeningDeadline"] / 1000 - 1
        self.io.mutate = lambda tree, io: phase_tree("reading", 4500)
        self.fails("First observed phase")

    def test_missing_rc_observation_cannot_pass_on_timeout_ui(self):
        def skip_reading(tree, io):
            now = round(io.clock.wall * 1000)
            if now >= self.base["listeningDeadline"] and now < self.base["readingDeadline"]:
                # A bogus submitted UI is rejected early, not accepted as proof.
                return phase_tree("submitted")
            return tree
        self.io.mutate = skip_reading
        self.fails("before the original deadline")

    def test_phase_regression_is_rejected(self):
        self.io.mutate = lambda tree, io: phase_tree("listening", 0) if io.layout_count == 3 else tree
        self.fails("phase regressed")

    def test_inventory_exit_and_clock_change_stop_before_next_layout(self):
        self.io.stopped = True
        self.fails("dedicated running emulator")
        self.assertNotIn(("ui", "layout"), self.io.events)

    def test_clock_jump_during_inventory_is_rejected(self):
        self.io.inventory_jump = True
        self.fails("Host clock changed")
        self.assertNotIn(("ui", "layout"), self.io.events)

    def test_unknown_overlay_after_first_sample_stops_and_keeps_prior_evidence(self):
        def overlay(tree, io):
            if io.layout_count == 2:
                tree.append({"type": "Text", "text": "Permission", "bounds": [0, 0, 1000, 100]})
            return tree
        self.io.mutate = overlay
        report = self.fails("Unknown native overlay")
        self.assertEqual(len(report["samples"]), 1)
        self.assertTrue((self.io.out / report["samples"][0]["screenshot"]).exists())

    def test_transport_failure_is_redacted_and_no_followup_command_is_sent(self):
        self.io.fail_layout = True
        report = self.fails("Read-only transport")
        self.assertNotIn("private-device", json.dumps(report))
        self.assertEqual(self.io.events, [("inventory",), ("ui", "layout")])

    def test_missing_screenshot_retains_classification_but_fails(self):
        self.io.omit_screenshot = True
        report = self.fails("nonempty output")
        self.assertEqual(len(report["samples"]), 1)

    def test_observation_gap_rejected_without_continuity_claim(self):
        self.io.gap_after_screenshot = True
        self.fails("gap exceeded")

    def test_short_shared_budget_is_not_extended(self):
        self.io.end = self.clock.mono + 10
        end = self.io.end
        self.fails("shared run budget")
        self.assertEqual(self.io.end, end)
        self.assertEqual(self.clock.mono, end)

    def test_stalled_reading_cannot_outlive_total_deadline_grace(self):
        self.io.mutate = lambda tree, io: phase_tree("reading", 0) if io.clock.wall * 1000 >= self.base["readingDeadline"] else tree
        report = self.fails("deadline grace")
        self.assertFalse(report["sawTimeoutResult"])
        self.assertLessEqual(report["finishedUtcMs"], self.base["readingDeadline"] + 60_000)

    def test_pending_submission_can_transition_to_timeout_but_retry_fails(self):
        def pending(tree, io):
            if self.base["readingDeadline"] <= io.clock.wall * 1000 < self.base["readingDeadline"] + 30_000:
                return phase_tree("saving")
            return tree
        self.io.mutate = pending
        result = obs.observe(self.io, self.args, self.base)
        self.assertIn("saving", [row["phase"] for row in result["samples"]])
        self.assertEqual(result["status"], "passed")

    def test_no_existing_report_overwrite_or_new_output_directory(self):
        report = self.io.out / "deadline-observer.json"
        report.write_text("existing evidence", encoding="utf8")
        with self.assertRaises(obs.ui.Failure): obs.observe(self.io, self.args, self.base)
        self.assertEqual(report.read_text(), "existing evidence")
        self.assertEqual(self.io.events, [])

    def test_invalid_private_baseline_is_not_copied_into_failure_report(self):
        self.base["privateMaterial"] = "must not leak"
        report = self.fails("exact model-verified")
        self.assertNotIn("must not leak", json.dumps(report))
        self.assertEqual(self.io.events, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
