#!/usr/bin/env python3
"""Dedicated synthetic mock-exam UI regression. No install, reset or clock changes."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import time
import uuid
from pathlib import Path
import phone_smoke as ui

REPO = Path(__file__).resolve().parents[3]
ORIGIN = "https://lantern.local/"
MOCK = "完整听读模考"
ENTRY = "完整听读模考 导入个人题包 · 200 题计时 · 成绩与复盘"
ACK = "我已试听，确认声音可听清，且这段音频包含本卷完整听力。"
START = "开始新考试 · 立即计时"
BACKUP = re.compile(r"lantern-exam-backup-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json")


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def installed_version(raw, bundle):
    # bm dump includes zero-valued quick-fix placeholders. Only the bundle,
    # application and installed module versions identify the installed app.
    text = raw.strip()
    if text.startswith(bundle + ":"):
        text = text[len(bundle) + 1:].strip()
    def unique_fields(pairs):
        fields = {}
        for key, value in pairs:
            if key in fields:
                raise ValueError("Duplicate field")
            fields[key] = value
        return fields
    try:
        data = json.loads(text, object_pairs_hook=unique_fields)
        if not isinstance(data, dict) or data.get("name") != bundle:
            raise ValueError("Wrong bundle")
        version = data.get("versionCode")
        app, modules = data.get("applicationInfo"), data.get("hapModuleInfos")
        if type(version) is not int or version <= 0 or not isinstance(modules, list) or not modules:
            raise ValueError("Invalid version or modules")
        for entry in [app, *modules]:
            if (not isinstance(entry, dict) or entry.get("bundleName") != bundle
                    or type(entry.get("versionCode")) is not int or entry["versionCode"] != version):
                raise ValueError("Conflicting installed metadata")
        return version
    except (ValueError, TypeError):
        raise ui.Failure("Installed bundle metadata is malformed or inconsistent") from None


def owned_attempt(before, current, pack, start_window):
    """After both files pass the real model, prove ownership before force-stop."""
    old = {a["id"]: a for a in before["attempts"]}
    rows = {a["id"]: a for a in current["attempts"]}
    if len(rows) != len(old) + 1 or any(rows.get(key) != value for key, value in old.items()):
        raise ui.Failure("Pre-cold export did not preserve the complete historical attempts")
    added = [a for key, a in rows.items() if key not in old]
    if len(added) != 1:
        raise ui.Failure("Cannot identify one new synthetic attempt")
    attempt = added[0]
    ordinal = 1 + sum(a["examId"] == pack["id"] for a in old.values())
    answers = {q: answer["choice"] for q, answer in attempt["answers"].items()}
    if (attempt["examId"] != pack["id"] or attempt["examVersion"] != pack["version"]
            or attempt["ordinal"] != ordinal or attempt["status"] != "listening"
            or any(a["status"] != "submitted" for a in old.values())
            or answers != {"1":0, "2":1} or start_window is None
            or not start_window[0] - 5000 <= attempt["startedAt"] <= start_window[1] + 5000):
        raise ui.Failure("Pre-cold attempt is not the exact synthetic run just started")
    return attempt["id"]


def in_scope(node, role, text):
    return any(p.get("type") == role and ui.normalize(p.get("text")) == text for p in node.parents)


def catalog_button(node, title, version_line):
    """Match the actual flattened accessibility card, never its ordinal/coordinates."""
    if node.value.get("type") != "button" or node.value.get("text") != "音频预检与新考试":
        return False
    for parent in reversed(node.parents):
        if parent.get("type") == "article":
            texts = {(n.value.get("type"), ui.normalize(n.value.get("text"))) for n in ui.flatten(parent)}
            return ("heading", title) in texts and ("paragraph", version_line) in texts
    # API 26 simplified layouts omit unlabeled articles, preserving their siblings.
    siblings = node.parents[-1].get("children", []) if node.parents else []
    position = next((i for i, row in enumerate(siblings) if row is node.value), -1)
    if position < 3:
        return False
    card = siblings[position - 3:position]
    return [(row.get("type"), ui.normalize(row.get("text"))) for row in card] == [
        ("heading", title), ("paragraph", version_line), ("disclosureTriangle", "来源与个人使用声明")]


def surface(tree, allow_picker=False):
    nodes = [n for n in ui.flatten(tree) if n.visible_bounds()]
    sheets = [n for n in nodes if n.value.get("type") == "SheetPage"]
    if sheets:
        if not allow_picker or len(sheets) != 1:
            raise ui.Failure("Unexpected system picker; no UI action is allowed")
        sheet = sheets[0]
        for n in nodes:
            if n.value.get("type") in {"dialog", "alertDialog", "alert"}:
                raise ui.Failure("Dialog or error obscures the file picker")
            belongs = (n.value is sheet.value or any(p is n.value for p in sheet.parents)
                       or any(p is sheet.value for p in n.parents) or ui.app_node(n)
                       or (n.value.get("type") == "Web" and n.value.get("text") == ORIGIN))
            if not belongs and (n.value.get("type") is not None or n.value.get("text") or n.value.get("clickable")):
                raise ui.Failure("Unknown native overlay outside the picker")
        kinds = {n.value.get("type") for n in ui.flatten(sheet.value)}
        labels = {ui.normalize(n.value.get("text")) for n in ui.flatten(sheet.value)}
        if "NavDestination" in kinds and "仅可访问所选文件" in labels:
            return "confirm-picker", sheet
        if {"Grid", "GridItem", "Column"} <= kinds and "我的手机" in labels:
            return "instant-picker", sheet
        raise ui.Failure("Unrecognized native picker structure")
    webs = [n for n in nodes if n.value.get("type") == "Web"]
    if len(webs) != 1 or webs[0].value.get("text") != ORIGIN:
        raise ui.Failure("Expected the packaged app; unlock/permissions are never automated")
    for n in nodes:
        kind = n.value.get("type")
        if kind in {"dialog", "alertDialog", "alert", "SheetWrapper"}:
            raise ui.Failure("Unexpected dialog or application error")
        if not ui.app_node(n) and n is not webs[0] and (kind is not None or n.value.get("text") or n.value.get("clickable")):
            raise ui.Failure("Unknown native overlay")
    return "app", None


class DeviceLock:
    """Exclusive across this runner's processes; external tools need the same reservation."""
    def __init__(self, device):
        self.path = Path(tempfile.gettempdir()) / ("lantern-native-mock-" + hashlib.sha256(device.encode()).hexdigest()[:16] + ".lock")
        self.token = uuid.uuid4().hex

    def __enter__(self):
        with self.path.open("x", encoding="utf-8") as stream:
            json.dump({"pid": os.getpid(), "token": self.token}, stream)
        return self

    def __exit__(self, *_):
        if read_json(self.path).get("token") == self.token:
            self.path.unlink()


class MockTransport(ui.Transport):
    def __init__(self, args, manifest):
        self.end = time.monotonic() + args.max_seconds
        self.downloads = {p["deviceFile"] for p in manifest["packages"]}
        super().__init__(args)

    def command(self, argv, label, timeout=35):
        remaining = self.end - time.monotonic()
        if remaining <= 0:
            raise ui.Failure("Mock smoke exceeded its total time limit")
        return super().command(argv, label, min(timeout, remaining))

    def hdc(self, *args, label="hdc"):
        allowed = args in (("shell", "bm", "dump", "-n", self.args.bundle),
                          ("shell", "ls", "-1", self.args.export_dir))
        if len(args) == 4 and args[:2] == ("file", "recv"):
            filename = args[2].removeprefix(self.args.export_dir + "/")
            allowed = (filename in self.downloads and args[2] == self.args.export_dir + "/" + filename
                       and Path(args[3]).resolve().parent == self.out.resolve() and not Path(args[3]).exists())
        if allowed:
            return self.command([self.args.hdc, "-t", self.args.device, *args], label)
        return super().hdc(*args, label=label)


class MockRunner(ui.Runner):
    def __init__(self, args, transport, manifest):
        super().__init__(args, transport)
        self.manifest = manifest
        self.pack = next(p for p in manifest["packages"] if p["id"] == manifest["examId"])
        self.exam = read_json(self.pack["file"])
        self.version_line = f"版本 {self.pack['version']} · {self.exam['source']['title']}"
        self.attempt_id = None
        self.start_window = None
        self.phase = "main"
        self.picker_filename = None

    def layout(self):
        parent_end = self.io.end
        deadline = min(parent_end, time.monotonic() + 15)
        self.io.end = deadline
        try:
            while True:
                tree = super().layout()
                mode, _ = surface(tree, self.phase == "picker")
                if mode != "app":
                    return tree
                roots = [n for n in ui.flatten(tree)
                         if n.value.get("type") == "rootWebArea" and n.visible_bounds()]
                if len(roots) == 1:
                    return tree
                webs = [n for n in ui.flatten(tree) if n.value.get("type") == "Web" and n.visible_bounds()]
                # API 26 briefly exposes only the known Web shell after its picker
                # closes. Retry this exact empty shape without any UI interaction.
                if roots or len(webs) != 1 or webs[0].value.get("children") != []:
                    raise ui.Failure("Unexpected application accessibility structure")
                if time.monotonic() >= deadline:
                    raise ui.Failure("Application accessibility content stayed empty")
                time.sleep(min(.3, max(0, deadline - time.monotonic())))
        finally:
            self.io.end = parent_end

    def preflight_target(self):
        rows = self.io.emulator_inventory()
        selected = [row for row in rows if row.get("name") == self.args.instance]
        if len(selected) != 1 or selected[0].get("serial") != self.args.device or selected[0].get("status") != "running":
            raise ui.Failure("Explicit device must identify the dedicated running instance")
        raw = self.io.hdc("shell", "bm", "dump", "-n", self.args.bundle, label="installed-version")
        if installed_version(raw, self.args.bundle) != self.args.expected_version_code:
            raise ui.Failure("Installed versionCode differs from the prepared test version")
        self.target_verified = True
        self.checks.append("dedicated-instance-and-installed-version")

    def filtered(self, tree, *, text=None, regex=None, types=None, clickable=True, scope=None, visible=True):
        nodes = ui.find_nodes(tree, text=text, regex=regex, types=types, clickable=clickable, visible=visible)
        if scope == "catalog-card":
            return [n for n in nodes if catalog_button(n, self.pack["title"], self.version_line)]
        if scope:
            return [n for n in nodes if in_scope(n, *scope)]
        return nodes

    def scroll(self, direction):
        tree = self.layout()
        surface(tree)
        scroller = ui.unique([n for n in ui.flatten(tree)
                              if n.value.get("type") == "rootWebArea" and n.visible_bounds()], "main web scroller")
        super().scroll(direction, scroller)

    def locate(self, *, text=None, regex=None, types=None, clickable=True, scrolls=8, direction="down", scope=None):
        for index in range(scrolls + 1):
            tree = self.layout()
            surface(tree, self.phase == "picker")
            nodes = self.filtered(tree, text=text, regex=regex, types=types, clickable=clickable, scope=scope)
            if len(nodes) > 1:
                raise ui.Failure("Ambiguous selector within its required scope")
            if nodes:
                return nodes[0]
            if index == scrolls or self.phase == "picker":
                break
            self.scroll(direction)
        raise ui.Failure("Required scoped selector not found after bounded scrolling")

    def wait_for(self, predicate, timeout=15):
        deadline = time.monotonic() + timeout
        while True:
            tree = self.layout()
            mode, sheet = surface(tree, self.phase == "picker")
            result = predicate(tree, mode, sheet)
            if result:
                return result
            if time.monotonic() >= deadline:
                raise ui.Failure("Expected postcondition did not become true")
            time.sleep(.3)

    def click(self, text, role="button", scope=None, direction="down", scrolls=8):
        allowed = {
            "main": {"训练之境", ENTRY},
            "catalog": {"导出完整备份", "导入题包 JSON", "恢复本机备份", "音频预检与新考试", "继续考试", "退出模考"},
            "preflight": {"播放", ACK, START},
            "attempt": {"A", "B", "下一题", "退出模考"},
        }
        if text not in allowed.get(self.phase, set()):
            raise ui.Failure("Action is not allowed in the current mock stage")
        if text in {"A", "B"} and (role != "radioButton" or scope not in {("group", "第 1 题选项"), ("group", "第 2 题选项")}):
            raise ui.Failure("Answer must target the known synthetic question group")
        if text == "播放" and scope != ("region", "听力音频预检"):
            raise ui.Failure("Playback must target preflight audio")
        if text == "音频预检与新考试" and scope != "catalog-card":
            raise ui.Failure("Preflight must select the exact synthetic package card")
        node = self.locate(text=text, types={role}, scope=scope, direction=direction, scrolls=scrolls)
        mode, _ = surface(self.tree)
        if mode != "app" or not ui.app_node(node):
            raise ui.Failure("Refusing an action outside the packaged app")
        if self.phase != "main" and not in_scope(node, "region", MOCK):
            raise ui.Failure("Mock action is outside the mock-exam region")
        if text == START:
            before_click = round(time.time() * 1000)
            self.tap_node(node)
            self.start_window = (before_click, round(time.time() * 1000))
        else:
            self.tap_node(node)

    def tap_node(self, node):
        if not any(n.value is node.value for n in ui.flatten(self.tree)):
            raise ui.Failure("Click target belongs to a discarded layout")
        b = ui.click_bounds(node, self.tree)
        if not b:
            raise ui.Failure("Click target is obscured")
        self.io.cli("ui", "click", str(round((b[0]+b[2])/2)), str(round((b[1]+b[3])/2)), label="mock-click")
        time.sleep(.25)

    def picker(self, filename):
        if filename not in self.io.downloads:
            raise ui.Failure("Picker file is not one of this run's verified files")
        self.phase, self.picker_filename = "picker", filename
        self.wait_for(lambda tree, mode, sheet: sheet)
        # Only move along this pre-verified public folder route; no blind Back.
        for label in [*self.args.folders, filename]:
            tree = self.layout()
            _, sheet = surface(tree, True)
            if sheet is None:
                raise ui.Failure("Picker closed before selecting the intended file")
            all_nodes = list(ui.flatten(tree))
            def choices(text):
                return [n for n in all_nodes if any(p is sheet.value for p in n.parents)
                        and n.value.get("type") == "Text" and ui.normalize(n.value.get("text")) == text
                        and n.visible_bounds()]
            # Reopened pickers may already be in the configured application folder.
            if label != filename and choices(filename):
                continue
            if label != filename and not choices(label):
                continue
            self.tap_node(ui.unique(choices(label), "allowlisted picker label"))
        confirmation_sent = False
        def finish(tree, mode, sheet):
            nonlocal confirmation_sent
            if mode == "app":
                return True
            labels = {ui.normalize(n.value.get("text")) for n in ui.flatten(sheet.value)}
            if mode == "confirm-picker" and "已选 1/1" in labels and not confirmation_sent:
                nodes = [n for n in ui.flatten(tree) if any(p is sheet.value for p in n.parents)
                         and n.value.get("type") == "Text" and n.value.get("text") == "完成" and n.visible_bounds()]
                self.tap_node(ui.unique(nodes, "selected single-file confirmation"))
                confirmation_sent = True
            return False
        self.wait_for(finish)
        self.phase, self.picker_filename = "catalog", None

    def verify(self, label, *arguments):
        out = self.io.out / (label + "-proof.json")
        self.io.command([self.args.node, str(REPO / "scripts" / "verify-native-mock.cjs"),
                         "--manifest", str(self.args.manifest), *map(str, arguments), "--out", str(out)], "model-verification")
        proof = read_json(out)
        if proof.get("status") != "passed":
            raise ui.Failure("Model verifier did not confirm the exported state")
        return proof

    def list_exports(self):
        raw = self.io.hdc("shell", "ls", "-1", self.args.export_dir, label="export-inventory")
        return {line.strip() for line in raw.splitlines() if BACKUP.fullmatch(line.strip())}

    def export(self, label):
        before = self.list_exports()
        self.click("导出完整备份", scope=("region", MOCK), direction="up")
        deadline = time.monotonic() + 20
        while True:
            added = self.list_exports() - before
            if len(added) > 1:
                raise ui.Failure("Concurrent downloads prevent attributing the backup")
            if added:
                filename = added.pop()
                self.io.downloads.add(filename)
                # Two independent receives must be byte-identical and model-valid.
                first, second = self.io.out / (label + ".json"), self.io.out / (label + "-stable.json")
                self.io.hdc("file", "recv", self.args.export_dir + "/" + filename, str(first), label="backup-receive")
                time.sleep(.5)
                self.io.hdc("file", "recv", self.args.export_dir + "/" + filename, str(second), label="backup-stability")
                if first.read_bytes() != second.read_bytes():
                    raise ui.Failure("Backup file was still changing during download")
                self.verify(label, "--inspect", first)
                return first, filename
            if time.monotonic() >= deadline:
                raise ui.Failure("Native backup download did not produce one complete file")
            time.sleep(.5)

    def catalog(self):
        tree = self.layout()
        surface(tree)
        if ui.find_nodes(tree, text="导入题包 JSON", types={"button"}, visible=False):
            self.phase = "catalog"
            return
        if any(n.visible_bounds() and re.search(r"正在录音|结束录音|等待麦克风|准备时间", str(n.value.get("text", ""))) for n in ui.flatten(tree)):
            raise ui.Failure("App is busy with an existing recording")
        if ui.find_nodes(tree, text=MOCK, types={"region"}, visible=False):
            raise ui.Failure("Leave the existing exam through the app before starting a new independent QA run")
        self.phase = "main"
        self.click("训练之境", scope=("navigation", "主导航"))
        self.click(ENTRY)
        self.phase = "catalog"
        self.wait_for(lambda t, *_: ui.find_nodes(t, text="导入题包 JSON", types={"button"}, clickable=True))

    def exit_to_main(self):
        self.click("退出模考", scope=("region", MOCK), direction="up")
        self.wait_for(lambda tree, *_: not ui.find_nodes(tree, text=MOCK, types={"region"}, visible=False)
                      and ui.find_nodes(tree, text="主导航", types={"navigation"}, visible=False))
        self.phase = "main"

    def exit_to_catalog(self):
        self.exit_to_main()
        self.catalog()

    def status(self, regex):
        # ArkWeb omits offscreen notices from the simplified tree entirely.
        # Reveal the header/status area before waiting for asynchronous saves.
        def saved(tree, *_):
            nodes = self.filtered(tree, regex=regex, types={"status"}, clickable=False,
                                  scope=("region", MOCK))
            if len(nodes) > 1:
                raise ui.Failure("Ambiguous saved status in the mock-exam region")
            return nodes[0] if nodes else None
        tree = self.layout()
        surface(tree)
        ready = saved(tree)
        if ready:
            return ready
        # This is a read-only landmark: busy saves legitimately disable Exit.
        # Actual click() still excludes disabled nodes through ui.find_nodes.
        for index in range(9):
            tree = self.layout()
            surface(tree)
            anchors = [n for n in ui.flatten(tree) if n.value.get("type") == "button"
                       and ui.normalize(n.value.get("text")) == "退出模考" and ui.app_node(n)
                       and in_scope(n, "region", MOCK) and n.visible_bounds()]
            if len(anchors) > 1:
                raise ui.Failure("Ambiguous mock status-area landmark")
            if anchors:
                break
            if index == 8:
                raise ui.Failure("Mock status area could not be revealed")
            self.scroll("up")
        self.scroll("up")
        return self.wait_for(saved)

    def run(self):
        self.preflight_target()
        # Confirm the device's public input bytes before any synthetic import.
        for index, pack in enumerate(self.manifest["packages"]):
            path = self.io.out / f"input-{index}.json"
            self.io.hdc("file", "recv", self.args.export_dir + "/" + pack["deviceFile"], str(path), label="verify-staged-input")
            if hashlib.sha256(path.read_bytes()).hexdigest() != pack["sha256"].lower():
                raise ui.Failure("Public staged input differs from its local QA manifest")
        self.catalog()
        self.capture("initial-catalog")
        tree = self.layout()
        if ui.find_nodes(tree, text="还没有可用的完整题包", types={"heading"}, visible=False):
            before = self.io.out / "expected-empty-catalog.json"
            before.write_text(json.dumps({"kind":"lantern-exam-backup", "schemaVersion":1,
                "ownerId":"harmony-local-device", "packages":[], "attempts":[]}), encoding="utf-8")
            self.checks.append("empty-catalog-ui-observation-not-device-export")
        else:
            before, _ = self.export("before-import")
        if any(a.get("status") != "submitted" for a in read_json(before)["attempts"]):
            raise ui.Failure("An existing active exam must finish; this run will not replace it")
        for index, pack in enumerate(self.manifest["packages"]):
            self.click("导入题包 JSON", scope=("region", MOCK), direction="up")
            self.picker(pack["deviceFile"])
            self.status("^" + re.escape(pack["deviceFile"]) + r"：(已导入|内容相同，未重复导入)$")
            self.capture(f"imported-{index}")
        baseline, _ = self.export("before-start")
        self.verify("imports-preserve-history", "--inspect", baseline, "--before-import", before)
        self.click("音频预检与新考试", scope="catalog-card")
        self.phase = "preflight"
        self.locate(text="题包图片已通过本机解码预检。", types={"status"}, clickable=False, direction="up")
        self.locate(regex=r"^先点击播放器试听。音频时长与 45 分钟明显不同", types={"paragraph"}, clickable=False)
        self.click("播放", scope=("region", "听力音频预检"), direction="up")
        self.wait_for(lambda tree, *_: self.filtered(tree, text="暂停", types={"button"}, scope=("region", "听力音频预检")))
        self.locate(text=START, types={"button"}, clickable=False)
        if self.filtered(self.tree, text=START, types={"button"}, clickable=True):
            raise ui.Failure("Start became actionable before the synthetic QA acknowledgment")
        self.click(ACK, role="checkBox")
        self.click(START)
        self.phase = "attempt"
        self.checks.append("synthetic-only-media-state-ack-not-human-listening")
        for number, choice in ((1, "A"), (2, "B")):
            self.click(choice, role="radioButton", scope=("group", f"第 {number} 题选项"))
            self.status(rf"^第 {number} 题已保存在本机。$")
            if number == 1:
                self.click("下一题", scope=("article", "第 1 题"))
        self.capture("two-saved-answers")
        self.exit_to_catalog()
        b0, _ = self.export("B0-before-cold")
        self.attempt_id = owned_attempt(read_json(baseline), read_json(b0), self.pack, self.start_window)
        # Stop only after export proves which new attempt this run created.
        self.exit_to_main()
        super().cold_start()
        self.catalog()
        self.click("继续考试", scope=("region", MOCK))
        self.phase = "attempt"
        self.locate(text="已保存 2/200 题 · 离开仍继续计时", types={"paragraph"}, clickable=False)
        self.capture("cold-resume")
        self.exit_to_catalog()
        b1, restore_filename = self.export("B1-after-cold")
        paths = [b0, b1]
        # Cold resume can append real background/audio interruption evidence.
        # Replay the latest snapshot; restoring B0 would correctly conflict.
        for index in (1, 2):
            self.click("恢复本机备份", scope=("region", MOCK), direction="up")
            self.picker(restore_filename)
            self.status(r"^备份已合并：新增 0 套题包、0 次记录；原记录保留。$")
            current, _ = self.export(f"B{index + 1}-after-restore")
            paths.append(current)
        self.verify("final-backup-comparison", "--baseline", baseline, "--before-import", before, "--files", *paths)
        self.checks.extend(["native-two-package-import", "two-answers-cold-resume", "four-real-backups-and-idempotent-restore"])
        self.capture("final-catalog")
        if getattr(self.args, "observe_deadlines", False):
            self.observe_then_export(paths[-1])

    def observe_then_export(self, baseline_path):
        import mock_deadlines
        # run() has just model-verified B0-B3, including the exact active ID.
        data = read_json(baseline_path)
        active = [a for a in data["attempts"] if a["status"] != "submitted"]
        if len(active) != 1 or active[0]["id"] != self.attempt_id:
            raise ui.Failure("Deadline observation lost the just-verified active attempt")
        attempt = active[0]
        answers = attempt["answers"]
        baseline = {key: attempt[key] for key in ("startedAt", "listeningDeadline", "readingDeadline")}
        baseline.update(title=self.pack["title"],
                        attemptIdSha256=hashlib.sha256(self.attempt_id.encode()).hexdigest(),
                        expectedCorrect=sum(answers.get(str(q["number"]), {}).get("choice") == q["answer"]
                                            for q in self.exam["questions"] if str(q["number"]) in answers),
                        expectedUnanswered=200 - len(answers))
        self.click("继续考试", scope=("region", MOCK), direction="up")
        self.phase = "attempt"
        self.locate(text=self.pack["title"], types={"heading"}, clickable=False,
                    scope=("region", MOCK), direction="up")
        self.scroll("up")
        mock_deadlines.observe(self.io, self.args, baseline)
        self.checks.append("real-time-listening-reading-timeout-ui")
        self.exit_to_catalog()
        final, _ = self.export("final-timeout")
        self.verify("final-timeout-comparison", "--timeout-baseline", baseline_path, "--final-backup", final)
        self.checks.append("original-deadline-timeout-durable-backup")
        self.capture("final-timeout-catalog")


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("run", choices=["run"])
    for option in ("device", "cli", "hdc", "node", "out", "manifest", "export-dir", "expected-version-code"):
        p.add_argument("--" + option, required=True)
    p.add_argument("--instance", default="LanternOffline7")
    p.add_argument("--dedicated-synthetic-qa", action="store_true", required=True)
    p.add_argument("--folders", nargs="+", default=["Download", "LANTERN TOEIC"])
    p.add_argument("--powershell", default="powershell.exe")
    p.add_argument("--observe-deadlines", action="store_true", help="Also wait for real 45/120-minute deadlines and verify a final native backup")
    p.add_argument("--max-seconds", type=int, help="Total wall-time budget: default 1200/max 1800, or default/max 8400 with --observe-deadlines")
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    args.max_seconds = args.max_seconds if args.max_seconds is not None else (8400 if args.observe_deadlines else 1200)
    if not 60 <= args.max_seconds <= (8400 if args.observe_deadlines else 1800):
        raise ui.Failure("Total wall-time budget exceeds the selected short/real-deadline mode")
    args.bundle, args.ability = "com.lantern.toeic", "EntryAbility"
    args.allow_physical_device = False
    args.dedicated_test_device, args.duplicate_import, args.idle_app_confirmed = True, False, True
    args.word = "reservation"
    args.expected_version_code = int(args.expected_version_code)
    args.manifest = Path(args.manifest).resolve()
    ui.validate(args)
    manifest = read_json(args.manifest)
    if manifest.get("kind") != "lantern-native-mock-qa" or manifest.get("schemaVersion") != 1:
        raise ui.Failure("Expected an explicit synthetic QA manifest")
    if manifest.get("examId") != "page-packer-qa-only" or manifest.get("answers") != {"1":0, "2":1}:
        raise ui.Failure("Only the known synthetic two-answer scenario is supported")
    packs = manifest.get("packages", [])
    if len(packs) != 2 or {p.get("id") for p in packs} != {"page-packer-qa-only", "browser-qa-alpha"}:
        raise ui.Failure("Expected exactly the two original QA package identities")
    for p in packs:
        if (not Path(p["file"]).is_absolute() or not re.fullmatch(r"qa-only-[a-z0-9-]+\.json", p["deviceFile"])
                or not re.fullmatch(r"[a-fA-F0-9]{64}", p["sha256"])
                or hashlib.sha256(Path(p["file"]).read_bytes()).hexdigest() != p["sha256"].lower()):
            raise ui.Failure("QA manifest path, filename or hash is invalid")
    with DeviceLock(args.device):
        io = MockTransport(args, manifest)
        runner = MockRunner(args, io, manifest)
        result = {"schemaVersion":1, "mode":"dedicated-synthetic-native-mock", "status":"running", "liveDeviceRun":True,
                  "observeDeadlinesRequested":args.observe_deadlines,
                  "checks":runner.checks, "limitations":["Synthetic fixtures, not genuine TOEIC papers", "No real audio/hardware or uninterrupted two-hour foreground claim", "Requires an independent exclusive device reservation", "Preserves all QA attempts and prior history"]}
        (io.out / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        try:
            # Model validation is local and precedes the first device command.
            empty = io.out / "local-validation-only.json"
            empty.write_text(json.dumps({"kind":"lantern-exam-backup","schemaVersion":1,"ownerId":"harmony-local-device","packages":[],"attempts":[]}), encoding="utf-8")
            runner.verify("input-validation", "--inspect", empty)
            runner.run()
            result["status"] = "passed"
        except Exception as error:
            result["status"], result["error"] = "failed", str(error)
            if runner.target_verified:
                try:
                    runner.capture("failure")
                except Exception as capture_error:
                    result["captureError"] = str(capture_error)
        finally:
            result["attemptId"] = runner.attempt_id
            (io.out / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"status":result["status"], "checks":result["checks"]}, ensure_ascii=False))
        return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ui.Failure, OSError, ValueError, KeyError) as error:
        print("Mock runner refused to start: " + str(error), file=sys.stderr)
        sys.exit(2)
