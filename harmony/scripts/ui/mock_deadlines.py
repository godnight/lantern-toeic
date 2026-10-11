"""Read-only, periodic native mock-exam deadline observations.

The caller supplies a model-verified B3 baseline, an already-created private
output directory and the shared, bounded MockTransport. This module never
resumes an exam, operates UI, exports data or proves durable submission.
"""
from __future__ import annotations
import json
import math
import re
import time
from pathlib import Path
import phone_smoke as ui

ORIGIN = "https://lantern.local/"
REGION = "完整听读模考"
PENDING_SUBMISSION = "时间已到，正在保存交卷。保存成功后才显示成绩与答案。"
POLL_SECONDS = 30
GRACE_SECONDS = 60
BASELINE_FIELDS = {"title", "startedAt", "listeningDeadline", "readingDeadline",
                   "attemptIdSha256", "expectedCorrect", "expectedUnanswered"}


class ObservationFailure(ui.Failure):
    """Only fixed, non-private diagnostics are put into the public-shaped report."""


def require(value, message):
    if not value:
        raise ObservationFailure(message)


def validate_baseline(baseline):
    require(isinstance(baseline, dict) and set(baseline) == BASELINE_FIELDS,
            "Expected the exact model-verified B3 baseline fields")
    require(isinstance(baseline["title"], str) and 0 < len(baseline["title"]) <= 200
            and not any(ord(c) < 32 for c in baseline["title"]), "Invalid synthetic title")
    require(isinstance(baseline["attemptIdSha256"], str)
            and re.fullmatch(r"[a-f0-9]{64}", baseline["attemptIdSha256"]), "Invalid hashed attempt identity")
    require(all(type(baseline[f]) is int and baseline[f] > 0
                for f in ("startedAt", "listeningDeadline", "readingDeadline")), "Invalid baseline timestamps")
    require(baseline["listeningDeadline"] - baseline["startedAt"] == 2_700_000
            and baseline["readingDeadline"] - baseline["startedAt"] == 7_200_000,
            "Baseline must retain the original 45/120 minute deadlines")
    require(type(baseline["expectedCorrect"]) is int and 0 <= baseline["expectedCorrect"] <= 2
            and type(baseline["expectedUnanswered"]) is int and baseline["expectedUnanswered"] == 198,
            "Baseline must describe the known two-answer synthetic run")
    return dict(baseline)


def analyze_layout(tree, baseline):
    """Classify only the visible, scoped exam; no scrolling or interaction."""
    visible = [n for n in ui.flatten(tree) if n.visible_bounds()]
    webs = [n for n in visible if n.value.get("type") == "Web"]
    require(len(webs) == 1 and webs[0].value.get("text") == ORIGIN,
            "Expected the packaged application Web surface")
    regions = [n for n in visible if ui.app_node(n) and n.value.get("type") == "region"
               and ui.normalize(n.value.get("text")) == REGION]
    require(len(regions) == 1, "Known mock-exam region must remain visible")
    region = regions[0]

    def scoped(node):
        return node.value is region.value or any(p is region.value for p in node.parents)

    for node in visible:
        kind = node.value.get("type")
        pending = (kind == "alert" and scoped(node)
                   and ui.normalize(node.value.get("text")) == PENDING_SUBMISSION
                   and not any(n.value.get("clickable") or n.value.get("type") == "button"
                               or (ui.normalize(n.value.get("text")) not in ("", PENDING_SUBMISSION))
                               for n in ui.flatten(node.value) if n.value is not node.value))
        require(kind not in {"SheetPage", "SheetWrapper", "dialog", "alertDialog", "alert"} or pending,
                "System sheet, dialog or error is visible; observation stopped")
        if not ui.app_node(node) and node is not webs[0]:
            require(kind is None and not node.value.get("text") and not node.value.get("clickable"),
                    "Unknown native overlay or foreground surface")
    app = [n for n in visible if ui.app_node(n) and scoped(n)]

    def exact(kind, text):
        return [n for n in app if n.value.get("type") == kind and ui.normalize(n.value.get("text")) == text]

    require(len(exact("heading", baseline["title"])) == 1,
            "Known synthetic exam title must remain visible")
    texts = {ui.normalize(n.value.get("text")) for n in app}
    phases = [phase for phase, label in (("listening", "听力 LC"), ("reading", "阅读 RC")) if label in texts]
    timers = exact("timer", "当前阶段剩余时间")
    result_heading = f"正确 {baseline['expectedCorrect']}/200 · 漏答 {baseline['expectedUnanswered']}"
    if exact("heading", result_heading):
        require(len(exact("heading", result_heading)) == 1 and not phases and not timers
                and PENDING_SUBMISSION not in texts, "Conflicting active and submitted UI states")
        require(any(re.fullmatch(r"(?:首次完整模考|复测第 \d+ 次) · 到时自动交卷", t) for t in texts),
                "Results are not marked as an automatic timeout submission")
        return {"phase": "submitted", "expectedResultVisible": True}
    require(not any("正确 " in t and "/200" in t for t in texts),
            "Results differ from the known synthetic baseline")
    require("已保存 2/200 题 · 离开仍继续计时" in texts, "Expected saved-answer count is not visible")
    if PENDING_SUBMISSION in texts:
        require(not phases and len(exact("alert", PENDING_SUBMISSION)) == 1,
                "Conflicting pending submission UI state")
        return {"phase": "saving"}
    require(len(phases) == 1, "Expected exactly one visible examination phase")
    require(len(timers) == 1, "Timer must be visible; observer never scrolls")
    values = [ui.normalize(n.value.get("text")) for n in ui.flatten(timers[0].value)
              if n.value.get("type") == "strong" and n.visible_bounds()]
    require(len(values) == 1 and re.fullmatch(r"\d{1,3}:\d{2}", values[0]), "Unrecognized countdown value")
    minutes, seconds = map(int, values[0].split(":"))
    require(seconds < 60, "Invalid countdown seconds")
    return {"phase": phases[0], "remainingSeconds": minutes * 60 + seconds}


def check_deadline(sample, baseline, before_ms, after_ms):
    phase, lc, total = sample["phase"], baseline["listeningDeadline"], baseline["readingDeadline"]
    require(before_ms <= after_ms and after_ms >= baseline["startedAt"] - 5000,
            "Sample precedes the original attempt or its clock moved backward")
    if phase == "listening":
        require(before_ms <= lc + GRACE_SECONDS * 1000, "Listening did not transition within deadline grace")
        deadline = lc
    elif phase == "reading":
        require(after_ms >= lc - 5000 and before_ms <= total + GRACE_SECONDS * 1000,
                "Reading phase disagrees with the original deadlines")
        deadline = total
    else:
        require(phase in {"saving", "submitted"} and after_ms >= total - 5000,
                "Submission occurred before the original deadline")
        return
    low, high = max(0, (deadline - after_ms) / 1000) - 5, max(0, (deadline - before_ms) / 1000) + 5
    require(low <= sample["remainingSeconds"] <= high, "Visible countdown disagrees with the fixed deadline")


def verify_inventory(io, args):
    rows = io.emulator_inventory()
    require(isinstance(rows, list), "Invalid emulator inventory")
    selected = [r for r in rows if isinstance(r, dict) and r.get("name") == args.instance]
    require(len(selected) == 1 and selected[0].get("serial") == args.device
            and selected[0].get("status") == "running", "Explicit target is not the dedicated running emulator")


def observe(io, args, baseline):
    """Return a passed UI report or write failure evidence and raise ui.Failure.

    Requires io.out, io.end (absolute monotonic total deadline), cli() and
    emulator_inventory(); io must preserve its 35-second command timeout.
    The parent owns device reservation and a separate post-result export.
    """
    path = Path(io.out) / "deadline-observer.json"
    require(path.parent.is_dir() and not path.exists(), "Observer needs an existing output directory and a new report path")
    start_wall, start_mono = time.time(), time.monotonic()
    report = {"schemaVersion": 1, "mode": "periodic-read-only-deadline-ui", "status": "running",
              "startedUtcMs": round(start_wall * 1000), "samples": [], "sawListening": False,
              "sawReading": False, "observedListeningToReading": False, "sawTimeoutResult": False,
              "durableSubmissionVerified": False,
              "limits": {"pollSeconds": POLL_SECONDS, "perCommandSeconds": 35, "deadlineGraceSeconds": GRACE_SECONDS},
              "limitations": ["Periodic UI observations only; not uninterrupted two-hour foreground proof",
                              "No audio hardware, official-material or comprehension verification",
                              "Final durable submission requires a separate real backup and model verification",
                              "Title/timer correlate to the baseline; the UI does not expose the attempt UUID"]}
    previous_end, changed_end = None, False
    last_phase, last_sample_mono = None, start_mono
    failure = None

    def save():
        path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    try:
        baseline = validate_baseline(baseline)
        report["baseline"] = baseline
        require(isinstance(args.device, str) and re.fullmatch(r"127\.0\.0\.1:[1-9]\d{0,4}", args.device)
                and int(args.device.rsplit(":", 1)[1]) <= 65535 and args.instance == "LanternOffline7",
                "Observer only accepts the dedicated loopback simulator")
        previous_end = io.end
        require(isinstance(previous_end, (int, float)) and not isinstance(previous_end, bool)
                and math.isfinite(previous_end), "Shared transport needs a finite monotonic deadline")
        remaining = baseline["readingDeadline"] / 1000 + GRACE_SECONDS - start_wall
        require(remaining > 0 and start_wall * 1000 < baseline["listeningDeadline"],
                "Observation must begin during the original listening stage")
        io.end = min(previous_end, start_mono + remaining)
        changed_end = True
        report["limits"]["maxSeconds"] = max(0, round(io.end - start_mono, 3))

        def check_clock():
            mono, wall = time.monotonic(), time.time()
            require(mono < io.end, "Original deadline grace or shared run budget elapsed without result")
            require(abs((wall - start_wall) - (mono - start_mono)) <= 5,
                    "Host clock changed; natural-time evidence is invalid")
            return mono, wall

        save()
        while True:
            mono, _ = check_clock()
            require(mono - last_sample_mono <= 120, "Observation gap exceeded 120 seconds")
            verify_inventory(io, args)
            check_clock()
            before_ms = round(time.time() * 1000)
            tree = ui.parse_layout(io.cli("ui", "layout", "--format", "json", "--mode", "simplified", label="deadline-layout"))
            sample_mono, wall = check_clock()
            after_ms = round(wall * 1000)
            sample = analyze_layout(tree, baseline)
            check_deadline(sample, baseline, before_ms, after_ms)
            phase = sample["phase"]
            require(last_phase is not None or phase == "listening", "First observed phase must be listening")
            rank = {"listening": 0, "reading": 1, "saving": 2, "submitted": 3}
            require(last_phase is None or rank[phase] >= rank[last_phase], "Examination phase regressed")
            report["observedListeningToReading"] |= last_phase == "listening" and phase == "reading"
            report["sawListening"] |= phase == "listening"
            report["sawReading"] |= phase == "reading"
            report["sawTimeoutResult"] |= phase == "submitted"
            sample.update(observationStartedUtcMs=before_ms, observationFinishedUtcMs=after_ms)
            report["samples"].append(sample)
            save()  # Preserve the layout classification even if screenshot capture fails.
            screenshot = Path(io.out) / f"deadline-{len(report['samples']):04d}-{phase}.png"
            require(not screenshot.exists(), "Observer screenshot output already exists")
            io.cli("ui", "screenshot", "--path", str(screenshot), label="deadline-screenshot")
            check_clock()
            require(screenshot.is_file() and screenshot.stat().st_size > 0, "Screenshot did not produce a nonempty output")
            sample["screenshot"] = screenshot.name
            last_phase, last_sample_mono = phase, sample_mono
            if phase == "submitted":
                require(report["observedListeningToReading"] and report["sawReading"],
                        "Timeout UI alone cannot prove an observed listening-to-reading transition")
                report["status"] = "passed"
                break
            save()
            time.sleep(min(POLL_SECONDS, max(0, io.end - time.monotonic())))
    except Exception as error:
        message = str(error) if isinstance(error, ObservationFailure) else "Read-only transport or output failed; inspect private command logs"
        failure = ObservationFailure(message)
        report["status"], report["error"] = "failed", message
    finally:
        if changed_end:
            io.end = previous_end
        report["finishedUtcMs"] = round(time.time() * 1000)
        report["actualObservedSeconds"] = round(time.monotonic() - start_mono, 3)
        try:
            save()
        except OSError:
            failure = ObservationFailure("Could not preserve the observer report")
    if failure:
        raise failure
    return report
