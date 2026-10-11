#!/usr/bin/env python3
"""Bounded HarmonyOS UI smoke. No install, reset, network or permission changes.

This runner controls an already installed app only with the explicit `run`
subcommand. `test_phone_smoke.py` exercises saved layouts without a device.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


class Failure(RuntimeError):
    pass


def normalize(value):
    return " ".join(str(value or "").split())


def parse_layout(text):
    """Reject banners, truncation and malformed output rather than guessing."""
    value = json.loads(text.lstrip("\ufeff").strip())
    if not isinstance(value, (list, dict)):
        raise Failure("Layout is not an object or array")
    return value


def intersect(a, b):
    return (max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3]))


def bounds(node):
    b = node.get("bounds")
    if not isinstance(b, list) or len(b) != 4 or not all(isinstance(x, (int, float)) for x in b):
        return None
    return tuple(b)


@dataclass
class Node:
    value: dict
    parents: tuple

    def visible_bounds(self):
        b = bounds(self.value)
        if b is None or self.value.get("visible") is False:
            return None
        for parent in self.parents:
            if parent.get("visible") is False:
                return None
            # In particular, clip sidebar descendants at their independent scroller.
            if parent.get("scrollable") or parent.get("type") in ("Web", "rootWebArea", "dialog"):
                pb = bounds(parent)
                if pb:
                    b = intersect(b, pb)
        return b if b[2] - b[0] >= 24 and b[3] - b[1] >= 28 else None


def flatten(tree, parents=()):
    if isinstance(tree, list):
        for child in tree:
            yield from flatten(child, parents)
    elif isinstance(tree, dict):
        yield Node(tree, parents)
        yield from flatten(tree.get("children", []), parents + (tree,))


def click_bounds(node, tree):
    """Visible clickable fragment after known fixed app chrome is subtracted.

    Accessibility bounds clip ancestors, but do not describe fixed siblings.
    Only the packaged app's named navigation/status chrome is inferred here;
    unknown dialogs and permission prompts remain blocked by safe_click.
    """
    area = node.visible_bounds()
    if not area:
        return None
    surface = next((p for p in reversed(node.parents)
                    if p.get("type") == "Web" and p.get("text") == "https://lantern.local/"), None)
    if surface is None:
        return area
    fragments = [area]
    for cover in flatten(tree):
        value = cover.value
        known = ((value.get("type") == "navigation" and normalize(value.get("text")) == "主导航")
                 or (value.get("type") == "sectionHeader" and normalize(value.get("text")) == "学习状态"))
        if not known or not any(p is surface for p in cover.parents):
            continue
        # The chrome's own buttons are actionable; its content siblings are not.
        if value is node.value or any(p is value for p in node.parents):
            continue
        overlay = cover.visible_bounds()
        if not overlay:
            continue
        remaining = []
        for fragment in fragments:
            overlap = intersect(fragment, overlay)
            if overlap[2] <= overlap[0] or overlap[3] <= overlap[1]:
                remaining.append(fragment)
                continue
            left, top, right, bottom = fragment
            x1, y1, x2, y2 = overlap
            remaining.extend((candidate for candidate in
                              [(left, top, right, y1), (left, y2, right, bottom),
                               (left, y1, x1, y2), (x2, y1, right, y2)]
                              if candidate[2] - candidate[0] >= 24 and candidate[3] - candidate[1] >= 28))
        fragments = remaining
        if not fragments:
            return None
    return max(fragments, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))


def find_nodes(tree, text=None, regex=None, types=None, clickable=False, visible=True):
    result = []
    for node in flatten(tree):
        value = node.value
        if text is not None and normalize(value.get("text")) != normalize(text):
            continue
        if regex is not None and not re.search(regex, normalize(value.get("text"))):
            continue
        if types and value.get("type") not in types:
            continue
        if clickable and not value.get("clickable"):
            continue
        if value.get("enabled") is False:
            continue
        if visible and not (click_bounds(node, tree) if clickable else node.visible_bounds()):
            continue
        result.append(node)
    return result


def unique(nodes, description):
    if len(nodes) != 1:
        raise Failure(f"Expected one {description}; got {len(nodes)}")
    return nodes[0]


def app_node(node):
    return any(parent.get("type") == "Web" and parent.get("text") == "https://lantern.local/"
               for parent in node.parents)


def safe_click(node, args, tree, picker_labels=()):
    """Default click allowlist is a second gate, independent of workflow branches."""
    text = normalize(node.value.get("text"))
    web = app_node(node)
    if click_bounds(node, tree) is None:
        raise Failure("Target is covered by fixed app chrome; scroll before clicking")
    if picker_labels:
        if not args.dedicated_test_device or not args.duplicate_import:
            raise Failure("Native picker clicks require dedicated duplicate-import mode")
        if web or node.value.get("type") != "Text" or text not in picker_labels:
            raise Failure("Native picker target is outside the active exact-label allowlist")
        if not find_nodes(tree, text="仅可访问所选文件", types={"Text"}):
            raise Failure("Known file picker is not visible")
        return
    if not web:
        raise Failure("Refusing a click outside the packaged application Web surface")
    if any(n.value.get("type") in {"dialog", "alertDialog"} and n.visible_bounds() for n in flatten(tree)):
        raise Failure("Unexpected modal dialog; no automatic dismissal or permission grant")
    if find_nodes(tree, text="仅可访问所选文件", types={"Text"}):
        raise Failure("File picker covers the application")
    if any(n.value.get("type") == "Text" and not app_node(n) and n.visible_bounds()
           and normalize(n.value.get("text")) in {"允许", "拒绝", "不允许", "仅在使用时允许", "始终允许"}
           for n in flatten(tree)):
        raise Failure("Permission prompt covers the application")
    safe = text in {"查看释义与例句", "返回词库", "回到词库"} or bool(re.search(
        r"^(?:训练之境(?:\s|$)|托业场景词库|词卡自测 · \d+ 词$)", text))
    if args.dedicated_test_device:
        safe = safe or text in {"记住了", "加入生词本：" + args.word}
        if args.duplicate_import:
            safe = safe or text in {"词库来源与记录备份", "导出词库记录", "导入词库记录"}
    if not safe:
        raise Failure(f"Action is not allowed in this mode: {text}")


def canonical_backup(path):
    data = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    if data.get("kind") != "lantern-vocabulary" or data.get("schemaVersion") != 1 or not isinstance(data.get("events"), list):
        raise Failure("Not a vocabulary schemaVersion 1 backup")
    rows = {}
    for event in data["events"]:
        if not isinstance(event, dict) or not isinstance(event.get("id"), str) or event["id"] in rows:
            raise Failure("Invalid or duplicate event ID in exported backup")
        rows[event["id"]] = event
    return rows


def compare_backups(paths):
    states = [canonical_backup(p) for p in paths]
    if len(states) < 2 or any(state != states[0] for state in states[1:]):
        raise Failure("Vocabulary event content or IDs changed across duplicate imports")
    return {"sameEvents": True, "eventCount": len(states[0]), "filesCompared": len(paths),
            "sha256": [hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in paths]}


class Transport:
    def __init__(self, args):
        self.args = args
        self.out = Path(args.out)
        self.out.mkdir(parents=True, exist_ok=False)
        self.sequence = 0
        self.poisoned = False

    def command(self, argv, label, timeout=35):
        if self.poisoned:
            raise Failure("A command timed out; no further commands will be sent in this run")
        self.sequence += 1
        prefix = self.out / f"{self.sequence:04d}-{label}"
        started = time.monotonic()
        redacted = ["<device>" if arg == self.args.device else arg for arg in argv]
        record = {"argv": redacted, "startedUtc": datetime.now(timezone.utc).isoformat()}
        try:
            result = subprocess.run(argv, capture_output=True, text=True, encoding="utf-8", errors="replace",
                                    timeout=timeout, shell=False)
            record.update(returncode=result.returncode, durationSeconds=round(time.monotonic() - started, 3))
            # Layouts and screenshots can contain private user text; keep outputs local.
            prefix.with_suffix(".stdout.log").write_text(result.stdout, encoding="utf-8")
            prefix.with_suffix(".stderr.log").write_text(result.stderr, encoding="utf-8")
            if result.returncode:
                raise Failure(f"{label} exited {result.returncode}; see {prefix.name} logs")
            return result.stdout
        except subprocess.TimeoutExpired:
            record["timeout"] = True
            self.poisoned = True
            raise Failure(f"{label} exceeded {timeout}s")
        finally:
            prefix.with_suffix(".command.json").write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")

    def cli(self, *args, label="cli"):
        if not args or (args[0] != "log" and args[:2] not in (("ui", "layout"), ("ui", "screenshot"),
                ("ui", "click"), ("ui", "swipe"), ("ui", "text"))) or "--device" in args:
            raise Failure("CLI command outside runner allowlist")
        bridge = str(Path(__file__).with_name("invoke-cli.ps1"))
        return self.command([self.args.powershell, "-NoLogo", "-NoProfile", "-NonInteractive",
                             "-ExecutionPolicy", "Bypass", "-File", bridge, "-Tool", self.args.cli,
                             *args, "--device", self.args.device], label)

    def emulator_inventory(self):
        bridge = str(Path(__file__).with_name("invoke-cli.ps1"))
        return parse_layout(self.command([self.args.powershell, "-NoLogo", "-NoProfile", "-NonInteractive",
            "-ExecutionPolicy", "Bypass", "-File", bridge, "-Tool", self.args.cli,
            "emulator", "list", "--format", "json"], "emulator-inventory"))

    def hdc(self, *args, label="hdc"):
        # Only methods below construct HDC commands; no arbitrary recipe commands.
        allowed = args in (("shell", "aa", "force-stop", self.args.bundle),
            ("shell", "aa", "start", "-a", self.args.ability, "-b", self.args.bundle),
            ("shell", "uitest", "uiInput", "keyEvent", "Back"), ("shell", "pidof", self.args.bundle))
        directory = (self.args.export_dir or "").rstrip("/")
        if self.args.dedicated_test_device and self.args.duplicate_import and directory:
            allowed = allowed or args == ("shell", "ls", "-1", directory)
            if len(args) == 4 and args[:2] == ("file", "recv"):
                filename = args[2].removeprefix(directory + "/")
                allowed = allowed or (args[2].startswith(directory + "/") and bool(re.fullmatch(
                    r"lantern-vocabulary-records-[A-Za-z0-9-]+\.json", filename))
                    and Path(args[3]).resolve().parent == self.out.resolve())
        if not allowed:
            raise Failure("HDC command outside runner allowlist")
        return self.command([self.args.hdc, "-t", self.args.device, *args], label)


class Runner:
    def __init__(self, args, transport):
        self.args, self.io = args, transport
        self.tree = []
        self.checks = []
        self.capture_index = 0
        self.picker_labels = ()
        self.target_verified = False

    def preflight_target(self):
        if not self.args.allow_physical_device:
            inventory = self.io.emulator_inventory()
            if not isinstance(inventory, list) or not any(
                row.get("serial") == self.args.device and row.get("status") == "running"
                for row in inventory if isinstance(row, dict)
            ):
                raise Failure("Target is not a running emulator in the official inventory")
        self.checks.append("explicit-target-gate-passed")
        self.target_verified = True

    def layout(self):
        self.tree = parse_layout(self.io.cli("ui", "layout", "--format", "json", "--mode", "simplified", label="layout"))
        return self.tree

    def capture(self, label):
        self.capture_index += 1
        self.layout()
        filename = self.io.out / f"screen-{self.capture_index:03d}-{label}.png"
        self.io.cli("ui", "screenshot", "--path", str(filename), label="screenshot")
        if not filename.is_file():
            raise Failure("Screenshot command returned without an output file")

    def expect(self, *, text=None, regex=None, types=None, clickable=False, timeout=12):
        until = time.monotonic() + timeout
        while True:
            nodes = find_nodes(self.layout(), text, regex, types, clickable)
            if len(nodes) > 1:
                raise Failure(f"Ambiguous visible selector: {text or regex or types}")
            if nodes:
                return nodes[0]
            if time.monotonic() >= until:
                raise Failure(f"Visible selector not found: {text or regex or types}")
            time.sleep(0.3)

    def scroll(self, direction, scroller=None):
        # locate() passes a node from its immediately preceding layout. Keep that
        # pair together: refreshing only the tree loses the node's parent identity.
        tree = self.layout() if scroller is None else self.tree
        if scroller is None:
            candidates = [n for n in flatten(tree) if n.value.get("type") == "rootWebArea" and n.visible_bounds()]
            scroller = unique(candidates, "main web scroller")
        elif not any(n.value is scroller.value for n in flatten(tree)):
            raise Failure("Scroller is from a discarded layout; locate it again")
        b = click_bounds(scroller, tree)
        if not b:
            raise Failure("Scroller is not visible")
        # Avoid a desktop sidebar and a folded phone's bottom navigation.
        x = round(b[0] + (b[2] - b[0]) * 0.75)
        low, high = round(b[1] + (b[3] - b[1]) * 0.76), round(b[1] + (b[3] - b[1]) * 0.30)
        y1, y2 = (low, high) if direction == "down" else (high, low)
        self.io.cli("ui", "swipe", str(x), str(y1), str(x), str(y2), "--speed", "800", label="scroll")
        time.sleep(0.25)

    def locate(self, *, text=None, regex=None, types=None, clickable=True, scrolls=6, direction="down"):
        for attempt in range(scrolls + 1):
            tree = self.layout()
            nodes = find_nodes(tree, text, regex, types, clickable)
            if len(nodes) > 1:
                raise Failure(f"Ambiguous selector: {text or regex or types}")
            if nodes:
                return nodes[0]
            if attempt == scrolls:
                break
            # If a match exists behind an independent scroller, scroll that exact ancestor.
            hidden = find_nodes(tree, text, regex, types, clickable, visible=False)
            scroller = None
            if len(hidden) == 1:
                target = hidden[0]
                for index in range(len(target.parents) - 1, -1, -1):
                    parent = target.parents[index]
                    if parent.get("scrollable"):
                        scroller = Node(parent, target.parents[:index])
                        break
            self.scroll(direction, scroller)
        raise Failure(f"Selector absent after bounded scrolling: {text or regex or types}")

    def tap(self, **selector):
        node = self.locate(**selector)
        safe_click(node, self.args, self.tree, self.picker_labels)
        b = click_bounds(node, self.tree)
        if not b:
            raise Failure("Target became covered before click")
        # Fresh current bounds, never captured coordinates or personal node identifiers.
        self.io.cli("ui", "click", str(round((b[0] + b[2]) / 2)), str(round((b[1] + b[3]) / 2)), label="click")
        time.sleep(0.25)

    def cold_start(self):
        # Even a provided idle confirmation does not override visible unsaved work.
        if any(n.visible_bounds() and re.search(r"正在录音|结束录音|正在保存录音|录音暂未保存|等待麦克风|准备时间",
                                               normalize(n.value.get("text"))) for n in flatten(self.layout())):
            raise Failure("Active recording/preparation/save detected; refusing force-stop")
        output = self.io.hdc("shell", "aa", "force-stop", self.args.bundle, label="force-stop")
        if re.search(r"(?i)(error:|failed)", output):
            raise Failure("Ability force-stop reported an error")
        pids = self.io.hdc("shell", "pidof", self.args.bundle, label="verify-stopped")
        if pids.strip():
            raise Failure("Cannot confirm that the app process stopped")
        output = self.io.hdc("shell", "aa", "start", "-a", self.args.ability, "-b", self.args.bundle, label="launch")
        if re.search(r"(?i)(error:|failed|not found)", output):
            raise Failure("Ability launch reported an error")
        self.expect(regex=r"^训练之境(?:\s|$)", types={"button"}, clickable=True)
        self.checks.append("cold-launch")

    def vocabulary(self):
        self.tap(regex=r"^训练之境(?:\s|$)", types={"button"})
        self.tap(regex=r"^托业场景词库", types={"button"})
        self.expect(text="本机保存", types={"status"})
        field = self.locate(types={"textField"})
        # Each fresh vocabulary mount has an empty query; do not append to unknown text.
        if normalize(field.value.get("text")):
            raise Failure("Search field is not empty after fresh navigation")
        b = click_bounds(field, self.tree)
        if not b:
            raise Failure("Search field is covered by fixed app chrome")
        self.io.cli("ui", "text", self.args.word, str(round((b[0]+b[2])/2)), str(round((b[1]+b[3])/2)), label="search")
        self.expect(text=self.args.word, types={"textField"})
        self.io.hdc("shell", "uitest", "uiInput", "keyEvent", "Back", label="dismiss-keyboard")
        self.locate(regex=r"^\S+\s+" + re.escape(self.args.word) + r"\s", types={"button"})
        self.capture("vocabulary-query")

    def star_state(self):
        node = self.locate(regex=r"^(?:加入|移出)生词本：" + re.escape(self.args.word) + "$", types={"toggleButton"})
        return normalize(node.value.get("text")).startswith("移出")

    def flashcard(self, grade=False):
        self.tap(regex=r"^词卡自测", types={"button"}, direction="up")
        self.tap(text="查看释义与例句", types={"button"})
        self.locate(text="记住了", types={"button"})
        self.capture("flashcard-revealed")
        if grade:
            self.tap(text="记住了", types={"button"})
            self.capture("flashcard-graded")
            self.checks.append("one-review-written-on-dedicated-device")
        # Return is above the revealed card; bounded upward scrolling, then exact text.
        for _ in range(6):
            if find_nodes(self.layout(), text="返回词库", types={"button"}, clickable=True):
                break
            self.scroll("up")
        self.tap(text="返回词库", types={"button"}, scrolls=0)

    def open_backup(self):
        if not find_nodes(self.layout(), text="导出词库记录", types={"button"}, clickable=True):
            self.tap(text="词库来源与记录备份", types={"disclosureTriangle"})
        self.locate(text="导出词库记录", types={"button"})

    def export_backup(self, label):
        directory = self.args.export_dir.rstrip("/")
        def files():
            output = self.io.hdc("shell", "ls", "-1", directory, label="list-export-directory")
            return {s.strip() for s in output.splitlines() if re.fullmatch(r"lantern-vocabulary-records-[A-Za-z0-9-]+\.json", s.strip())}
        before = files()
        self.open_backup()
        self.tap(text="导出词库记录", types={"button"})
        deadline = time.monotonic() + 15
        while True:
            added = files() - before
            if len(added) > 1:
                raise Failure("More than one export appeared; cannot attribute output")
            if len(added) == 1:
                filename = added.pop()
                local = self.io.out / (label + ".json")
                self.io.hdc("file", "recv", directory + "/" + filename, str(local), label="receive-export")
                canonical_backup(local)
                return local, filename
            if time.monotonic() >= deadline:
                raise Failure("No new vocabulary backup in the configured public export directory")
            time.sleep(0.5)

    def duplicate_import(self):
        baseline, filename = self.export_backup("before-import")
        recipe = json.loads(Path(self.args.picker_recipe).read_text(encoding="utf-8-sig"))
        if not isinstance(recipe, list) or not all(isinstance(s, str) and s for s in recipe):
            raise Failure("Picker recipe must be a list of exact visible folder labels")
        snapshots = [baseline]
        for index in (1, 2):
            # An earlier toast must not acknowledge a later import.
            deadline = time.monotonic() + 10
            while find_nodes(self.layout(), text="词库记录已合并，原记录已保留。", types={"listItem"}):
                if time.monotonic() > deadline:
                    raise Failure("Previous import notification did not clear")
                time.sleep(0.3)
            self.tap(text="导入词库记录", types={"button"})
            self.expect(text="仅可访问所选文件", types={"Text"})
            self.picker_labels = tuple(recipe) + (filename, "完成")
            for folder in recipe:
                if find_nodes(self.layout(), text=filename, types={"Text"}):
                    break
                self.tap(text=folder, types={"Text"}, clickable=False, scrolls=0)
            self.tap(text=filename, types={"Text"}, clickable=False, scrolls=0)
            self.expect(regex=r"^已选 1/1$", types={"Text"})
            self.tap(text="完成", types={"Text"}, clickable=False, scrolls=0)
            self.picker_labels = ()
            # Ensure the native picker actually closed; do not infer success from a stale app tree.
            deadline = time.monotonic() + 12
            while find_nodes(self.layout(), text="仅可访问所选文件", types={"Text"}):
                if time.monotonic() > deadline:
                    raise Failure("Picker did not close")
                time.sleep(0.3)
            self.expect(text="词库记录已合并，原记录已保留。", types={"listItem"})
            path, _ = self.export_backup(f"after-import-{index}")
            snapshots.append(path)
        result = compare_backups(snapshots)
        (self.io.out / "duplicate-import-proof.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
        self.checks.append("duplicate-import-event-identity-verified-by-three-exports")

    def run(self):
        self.preflight_target()
        self.cold_start()
        self.capture("home")
        self.vocabulary()
        initial_star = self.star_state()
        if self.args.dedicated_test_device and not initial_star:
            self.tap(text="加入生词本：" + self.args.word, types={"toggleButton"})
            if not self.star_state():
                raise Failure("Star action did not update accessible label")
        self.flashcard(grade=self.args.dedicated_test_device)
        if self.args.duplicate_import:
            self.duplicate_import()
        expected_star = initial_star or self.args.dedicated_test_device
        self.cold_start()
        self.vocabulary()
        if self.star_state() != expected_star:
            raise Failure("Favorite state changed across cold launch")
        self.checks.append("favorite-state-preserved-across-cold-launch")
        self.capture("persistent-state")
        if self.args.dedicated_test_device:
            # Exact matching of the original core term prevents matching an overlapping phrase.
            node = self.locate(regex=r"^\S+\s+" + re.escape(self.args.word) + r"\s", types={"button"})
            if not any(s in node.value.get("text", "") for s in ("已安排复习", "待复习")):
                raise Failure("Graded word lost its review marker after restart")
            self.checks.append("review-marker-persisted")

    def logs(self):
        self.io.cli("log", "--bundle-name", self.args.bundle, "--level", "E", "--tail", "200", label="app-errors")
        self.io.cli("log", "--bundle-name", self.args.bundle, "--crash", "--tail", "30", label="app-crashes")


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    commands = p.add_subparsers(dest="action", required=True)
    compare = commands.add_parser("compare-backups", help="Offline event identity check; never connects to a device")
    compare.add_argument("files", nargs="+", type=Path)
    run = commands.add_parser("run", help="Operate the explicitly selected device")
    run.add_argument("--device", required=True, help="Exact HDC target/serial, no auto selection")
    run.add_argument("--cli", required=True, help="Path to deveco.ps1")
    run.add_argument("--hdc", required=True, help="Path to the same Studio SDK's hdc.exe")
    run.add_argument("--out", required=True, help="New local evidence directory; refuses overwrite")
    run.add_argument("--powershell", default="powershell.exe")
    run.add_argument("--bundle", default="com.lantern.toeic")
    run.add_argument("--ability", default="EntryAbility")
    run.add_argument("--word", default="reservation")
    run.add_argument("--idle-app-confirmed", action="store_true", help="Confirm app has no recording/unsaved work before force-stop")
    run.add_argument("--allow-physical-device", action="store_true", help="Explicit opt-in for a physical phone; default requires an inventoried running emulator")
    run.add_argument("--dedicated-test-device", action="store_true", help="Permit adding a favorite and one review; leaves test records")
    run.add_argument("--duplicate-import", action="store_true", help="Also export/import twice, only on dedicated device")
    run.add_argument("--export-dir", help="HDC-readable public app download directory, no spaces/metacharacters")
    run.add_argument("--picker-recipe", help="JSON list of exact folder labels for this OS picker")
    return p


def validate(args):
    if not args.idle_app_confirmed:
        raise Failure("--idle-app-confirmed is required: cold launch force-stops the app")
    if not re.fullmatch(r"[A-Za-z0-9_.:-]+", args.device):
        raise Failure("Use an exact HDC target, not a friendly name or shell text")
    if not args.allow_physical_device:
        match = re.fullmatch(r"127\.0\.0\.1:(\d{1,5})", args.device)
        if not match or not 1 <= int(match[1]) <= 65535:
            raise Failure("Default mode accepts only a local emulator; physical devices require --allow-physical-device")
    if not all(re.fullmatch(r"[A-Za-z][A-Za-z0-9_.]*", value) for value in (args.bundle, args.ability)):
        raise Failure("Invalid bundle or ability")
    if not re.fullmatch(r"[A-Za-z][A-Za-z -]{0,60}", args.word):
        raise Failure("Search word must be plain English")
    if args.duplicate_import and not (args.dedicated_test_device and args.export_dir and args.picker_recipe):
        raise Failure("Duplicate import requires dedicated device, export directory and picker recipe")
    if args.export_dir and (not re.fullmatch(r"/[A-Za-z0-9_./-]+", args.export_dir) or ".." in args.export_dir.split("/")
                            or "/Download/" not in args.export_dir):
        raise Failure("Export directory must be an explicit public Download subdirectory")


def main(argv=None):
    args = parser().parse_args(argv)
    if args.action == "compare-backups":
        print(json.dumps(compare_backups(args.files), indent=2))
        return 0
    validate(args)
    io = Transport(args)
    runner = Runner(args, io)
    result = {"schemaVersion": 1, "mode": "dedicated" if args.dedicated_test_device else "non-mutating-smoke",
              "liveDeviceRun": True, "status": "running", "checks": runner.checks,
              "networkState": "unchanged and not independently verified", "microphonePermission": "untouched",
              "audioHardwareQuality": "not tested", "duplicateImport": "requested" if args.duplicate_import else "not tested"}
    try:
        runner.run()
        result["status"] = "passed"
    except Exception as error:
        result["status"], result["error"] = "failed", str(error)
        if runner.target_verified:
            try:
                runner.capture("failure")
            except Exception as evidence_error:
                result["captureError"] = str(evidence_error)
    finally:
        if runner.target_verified:
            try:
                runner.logs()
            except Exception as log_error:
                result["logCollectionError"] = str(log_error)
        result["note"] = "E-level framework messages are retained as evidence, not automatically classified as app crashes."
        (io.out / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (Failure, OSError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(2)
