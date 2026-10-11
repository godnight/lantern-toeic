#!/usr/bin/env python3
"""Build a compact Chinese Wiktionary lookup dictionary.

Input JSONL files are fetched separately. This builder never fetches remote content.
Example: python build-wiktionary-dictionary.py --input-dir .. --output-dir .
Build dependency: opencc-python-reimplemented==0.1.7 (t2s conversion only).
Definitions remain CC BY-SA 4.0. No audio, cited examples, or source markup is copied.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

SOURCE = "zh-wiktionary-kaikki-20261002"
SOURCE_URL = "https://zh.wiktionary.org/"
LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/"
INPUTS = [
    ("kaikki-en-traditional.jsonl", "https://kaikki.org/zhwiktionary/%E8%8B%B1%E8%AA%9E/kaikki.org-dictionary-%E8%8B%B1%E8%AA%9E.jsonl"),
    ("kaikki-en-simplified.jsonl", "https://kaikki.org/zhwiktionary/%E8%8B%B1%E8%AF%AD/kaikki.org-dictionary-%E8%8B%B1%E8%AF%AD.jsonl"),
]
SAMPLES = "apply fee revenue vacancy employer appointment policy eligible reimburse reservation itinerary recruit refund warranty schedule invoice receipt contract product".split()


def clean(value: object) -> str:
    if not isinstance(value, str):
        return ""
    # Compatibility normalization would flatten IPA modifiers (e.g. ʰ) and
    # etymological subscripts. Apply NFKC only to lookup headwords below.
    value = unicodedata.normalize("NFC", value)
    value = "".join(c for c in value if unicodedata.category(c) not in {"Cf", "Cs"})
    value = "".join(c if not unicodedata.category(c).startswith("C") else " " for c in value)
    return re.sub(r"\s+", " ", value).strip()


def word_text(value: object) -> str:
    text = unicodedata.normalize("NFKC", clean(value)).replace("’", "'").replace("‘", "'")
    return text.replace("‐", "-").replace("‑", "-")


def is_latin_letter(c: str) -> bool:
    return c.isalpha() and "LATIN" in unicodedata.name(c, "")


def usable_word(word: str) -> bool:
    if not word or len(word) > 96 or len(word.split()) > 8:
        return False
    if not is_latin_letter(word[0]) or not is_latin_letter(word[-1]):
        return False
    if any(not (is_latin_letter(c) or c in " '-") for c in word):
        return False
    # Apostrophes/hyphens are allowed inside words, not doubled or surrounding spaces.
    if re.search(r"[-'][ '-]|[ '-][-']", word):
        return False
    return True


def has_chinese(text: str) -> bool:
    return any("\u3400" <= c <= "\u9fff" or "\U00020000" <= c <= "\U0002fa1f" for c in text)


def unique_append(target: list, value: object) -> None:
    if value and value not in target:
        target.append(value)


def stable_id(key: str) -> str:
    return "dict-" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:20]


def prioritized_values(candidates: list) -> list:
    """Choose provenance-aware order before deduplicating and applying UI limits."""
    result = []
    for priority, value in sorted(candidates, key=lambda candidate: candidate[0]):
        unique_append(result, value)
    return result


def write_json(path: Path, obj: object, pretty: bool = True) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2 if pretty else None,
                               separators=None if pretty else (",", ":")) + "\n", encoding="utf-8")


def build(input_dir: Path, output_dir: Path, core_path: Path | None = None, opencc_deps: Path | None = None) -> dict:
    if opencc_deps:
        sys.path.insert(0, str(opencc_deps))
    from opencc import OpenCC
    converter = OpenCC("t2s")
    counters: Counter = Counter()
    records: dict[str, dict] = {}
    input_info = []
    rejected_examples: dict[str, list] = {}
    case_collisions: dict[str, list[str]] = {}

    def reject(reason: str, example: str) -> None:
        counters[reason] += 1
        bucket = rejected_examples.setdefault(reason, [])
        if len(bucket) < 30:
            bucket.append(example)

    for name, url in INPUTS:
        path = input_dir / name
        raw = path.read_bytes()
        input_info.append({"file": name, "url": url, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
        for lineno, line in enumerate(raw.decode("utf-8-sig").splitlines(), 1):
            if not line.strip():
                continue
            counters["inputRecords"] += 1
            try:
                item = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{name}:{lineno}: invalid JSON") from exc
            if item.get("lang_code") != "en":
                reject("nonEnglish", clean(item.get("word")))
                continue
            word = word_text(item.get("word"))
            if not usable_word(word):
                reject("invalidHeadword", word)
                continue
            key = word.casefold()
            senses = []
            for sense in item.get("senses", []):
                glosses = [clean(g) for g in sense.get("glosses", [])]
                glosses = list(dict.fromkeys(g for g in glosses if g))
                meaning = converter.convert("；".join(glosses))
                if not meaning or not has_chinese(meaning):
                    reject("emptyOrNonChineseSense", word)
                    continue
                if len(meaning) > 800:
                    reject("overlongSense", word)
                    continue
                # Pos stays attached to the original Chinese sense. No cross-entry pairing.
                unique_append(senses, {"pos": clean(item.get("pos")) or "unknown", "meaning": meaning})
            if not senses:
                reject("noUsableSenses", word)
                continue
            record = records.setdefault(key, {"id": stable_id(key), "word": word,
                "phonetics": [], "senses": [], "_senseCandidates": [],
                "_phoneticCandidates": [], "_etymologies": [], "_forms": []})
            if record["word"] != word:
                variants = case_collisions.setdefault(key, [record["word"]])
                unique_append(variants, word)
                if word == key:
                    record["word"] = word
            case_priority = 0 if word == key else 1
            pos = clean(item.get("pos")) or "unknown"
            pos_priority = 2 if pos in {"name", "proper-name", "proper_noun"} else 1 if pos == "unknown" else 0
            # Ordinary senses must not be crowded out by a capitalized proper name.
            sense_priority = (pos_priority, case_priority, counters["inputRecords"])
            # Pronunciation/etymology should first describe the displayed lowercase word.
            detail_priority = (case_priority, pos_priority, counters["inputRecords"])
            for sense in senses:
                record["_senseCandidates"].append((sense_priority, sense))
            for sound in item.get("sounds", []):
                ipa = clean(sound.get("ipa"))
                if ipa and len(ipa) <= 160 and "<" not in ipa and ">" not in ipa:
                    record["_phoneticCandidates"].append((detail_priority, ipa))
            for etymology in item.get("etymology_texts", []):
                value = converter.convert(clean(etymology))
                if value:
                    record["_etymologies"].append((detail_priority, value))
            for form in item.get("forms", []):
                value = word_text(form.get("form"))
                if usable_word(value) and value.casefold() != key:
                    record["_forms"].append((detail_priority, value))
            counters["acceptedInputRecords"] += 1

    output = []
    for key, record in sorted(records.items()):
        record["senses"] = prioritized_values(record.pop("_senseCandidates"))
        record["phonetics"] = prioritized_values(record.pop("_phoneticCandidates"))
        if len(record["senses"]) > 8:
            counters["entriesWithOmittedSenses"] += 1
        record["senses"] = record["senses"][:8]
        record["phonetics"] = record["phonetics"][:4]
        etymology = "；".join(prioritized_values(record.pop("_etymologies")))
        if etymology:
            if len(etymology) > 1500:
                suffix = "……（词源内容节选）"
                etymology = etymology[:1500 - len(suffix)] + suffix
                counters["entriesWithExcerptedEtymology"] += 1
            record["etymology"] = etymology
        forms = prioritized_values(record.pop("_forms"))[:12]
        if forms:
            record["forms"] = forms
        output.append(record)

    dictionary = {"schemaVersion": 1, "source": SOURCE, "sourceUrl": SOURCE_URL,
                  "licenseUrl": LICENSE_URL, "entries": output}
    output_dir.mkdir(parents=True, exist_ok=True)
    artifact = output_dir / "dictionary.json"
    write_json(artifact, dictionary, pretty=False)
    metadata = {
        "schemaVersion": 1, "source": SOURCE, "title": "中文维基词典英语查词数据（微光托业整理版）",
        "sourceName": "中文维基词典 · Kaikki / Wiktextract",
        "sourceUrl": SOURCE_URL, "license": "CC-BY-SA-4.0", "licenseUrl": LICENSE_URL,
        "attribution": "中文维基词典贡献者（原始内容）；Tatu Ylönen、Wiktextract / Kaikki.org（结构化提取）；微光托业（筛选与格式整理）。",
        "dumpDate": "2026-10-01", "extractionDate": "2026-10-02", "checkedDate": "2026-10-11",
        "perEntrySourcePattern": "https://zh.wiktionary.org/wiki/{URL-encoded word}#英語",
        "perEntryHistoryPattern": "https://zh.wiktionary.org/w/index.php?title={URL-encoded word}&action=history",
        "headwordCaseVariants": dict(sorted(case_collisions.items())),
        "inputs": input_info, "sourceUrls": [item[1] for item in INPUTS],
        "entryCount": len(output), "count": len(output), "file": "dictionary.json",
        "buildDependency": {"name": "opencc-python-reimplemented", "version": "0.1.7", "config": "t2s"},
        "processing": [
            "合并中文维基词典的英語/英语两份导出，只保留 lang_code=en。",
            "词头使用NFKC与casefold归并；其他文字仅NFC，保留IPA上标/词源下标；去格式控制字符、折叠空白；展示优先保留小写原形。",
            "允许拉丁字母（含带重音字母）、词间空格、内部撇号与连字符；词头最长96字符、8个空格分词。",
            "保留有中文且长度不超过800字的释义；词性与原义项绑定，精确去重后最多8项。",
            "8义截取之前，普通词性优先于未知词性和专名；同类词性中原始小写词头优先，原始sense顺序不变。",
            "IPA、词源、词形优先取原始小写词头；其他大小写变体信息随后补充；大小写来源保留在headwordCaseVariants。",
            "最多4个原始IPA，最多12个词形；词形不是词根词缀。",
            "词源最多1500字符，截断明确标注节选；不推断或自动生成词源。",
            "中文释义和词源通过 OpenCC t2s 转简体；不自动翻译或生成中文释义。",
            "不复制音频URL、例句、引文、分类或其他追踪字段。",
            "本衍生数据遵循 CC BY-SA 4.0；使用时保留来源、作者、许可链接与加工说明。"
        ],
        "limitations": [
            "通用查词资料，未经全库人工审校，不是官方托业词表，也不表示覆盖全部常见商务词。",
            "部分常用词在上游提取结果中缺失，已审校的托业核心词条应优先保留。",
            "上游含旧义、专业义及词形释义；繁简转换并非语义校对；归并大小写可能合并不同大小写的含义。",
            "上游 postprocessed JSONL 下载已被维护者标记 deprecated，未来再生成需迁移到原始 JSONL 提取。"
        ],
        "dictionaryBytes": artifact.stat().st_size,
        "dictionarySha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
        "sha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
    }
    write_json(output_dir / "dictionary-metadata.json", metadata)
    byword = {record["word"].casefold(): record for record in output}
    sample_audit = {word: byword.get(word) for word in SAMPLES}
    core_words = []
    if core_path:
        core_words = [word_text(item["word"]).casefold() for item in json.loads(core_path.read_text(encoding="utf-8-sig"))]
    audit = {
        "source": SOURCE,
        "counts": dict(sorted(counters.items())), "outputEntries": len(output),
        "rejectedExamples": rejected_examples,
        "caseCollisionCount": len(case_collisions), "caseCollisionExamples": dict(list(sorted(case_collisions.items()))[:50]),
        "casePrioritySamples": {word: byword.get(word) for word in ["apple", "orange", "may", "march", "bill", "china", "us"]},
        "businessSamples": sample_audit,
        "sampleConclusion": "fee、vacancy、invoice、product 的原始中文含义与商务常用义基本相符；其他 null 项是上游缺失，不能视为已修复或已覆盖。没有全库语义审校。",
        "existingCoreCoverage": {"total": len(core_words), "found": sum(w in byword for w in core_words),
                                 "missing": [w for w in core_words if w not in byword]},
    }
    write_json(output_dir / "dictionary-audit.json", audit)
    return metadata


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--core-vocabulary", type=Path)
    parser.add_argument("--opencc-deps", type=Path, default=Path(__file__).resolve().parent / ".build-deps")
    args = parser.parse_args()
    result = build(args.input_dir, args.output_dir, args.core_vocabulary, args.opencc_deps)
    print(json.dumps({k: result[k] for k in ("entryCount", "dictionaryBytes", "dictionarySha256")}, ensure_ascii=False))
