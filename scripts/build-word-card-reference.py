"""Build a small, display-only word reference table from pinned dictionary inputs.

No network, audio generation, word admission, or learning-state changes occur here.
"""
from pathlib import Path
import argparse
import csv
import hashlib
import json
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
ECDICT_COMMIT = 'ab22ad36302cafc6349a050e2b60894855208055'
ECDICT_SHA256 = 'd1ecbdf9ee2b920afb6f430ca6b6bb9f559588cf0dff86e04bd255f9390843cc'


def key(value):
    # Matches vocabulary-model.ts searchText: retain accents and word boundaries.
    return ' '.join(unicodedata.normalize('NFKC', value).lower().split())


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def build(ecdict_csv, ecdict_license):
    if sha256(ecdict_csv) != ECDICT_SHA256:
        raise ValueError('ECDICT CSV differs from the pinned source; review a source update explicitly.')
    license_text = ecdict_license.read_text(encoding='utf-8').replace('\r\n', '\n').strip()
    if not license_text.startswith('MIT License\n\nCopyright (c) 2025 Linwei\n'):
        raise ValueError('Expected pinned ECDICT MIT copyright notice.')
    metadata = read_json(ROOT / 'content/dictionary-metadata.json')
    dictionary_file = ROOT / 'public/dictionaries' / metadata['file']
    if sha256(dictionary_file) != metadata['sha256']:
        raise ValueError('Shipped Wiktionary file does not match its existing metadata.')
    dictionary = {key(row['word']): row for row in read_json(dictionary_file)['entries']}
    current = read_json(ROOT / 'content/vocabulary-full4109-private.json')
    current_keys = {key(row['word']['word']) for row in current['acceptedTeachingEntries']}
    scene = read_json(ROOT / 'content/vocabulary.json') + read_json(ROOT / 'content/vocabulary-expansion.json')
    scene_keys = {key(row['word']) for row in scene}
    target_keys = current_keys | scene_keys
    ecdict = {}
    with ecdict_csv.open(encoding='utf-8-sig', newline='') as stream:
        for row in csv.DictReader(stream):
            normalized = key(row['word'])
            phonetic = row['phonetic'].strip()
            if normalized in target_keys and phonetic:
                if normalized in ecdict and ecdict[normalized] != phonetic:
                    raise ValueError('Conflicting normalized ECDICT headword: ' + normalized)
                ecdict[normalized] = phonetic
    supplement_file = ROOT / 'content/word-card-phonetic-supplement.json'
    supplements = read_json(supplement_file)['entries'] if supplement_file.exists() else {}
    entries = {}
    for word in sorted(target_keys):
        existing = dictionary.get(word, {})
        phonetics = list(dict.fromkeys(value.strip() for value in existing.get('phonetics', []) if value.strip()))
        entry = {'phonetics': phonetics}
        if phonetics:
            entry['phoneticSource'] = 'wiktionary'
        elif word in ecdict:
            # Preserve the source's notation; do not synthesize or relabel a dialect.
            entry['phonetics'] = [ecdict[word]]
            entry['phoneticSource'] = 'ecdict'
        elif word in supplements and supplements[word].get('phonetics'):
            extra = supplements[word]
            if not isinstance(extra.get('revision'), int) or not extra['sourceUrl'].startswith('https://en.wiktionary.org/w/index.php?'):
                raise ValueError('Supplement must point to a fixed English Wiktionary revision: ' + word)
            entry['phonetics'] = list(dict.fromkeys(extra['phonetics']))
            entry['phoneticSource'] = 'en-wiktionary'
            entry['phoneticSourceUrl'] = extra['sourceUrl']
        if existing.get('etymology', '').strip():
            entry['etymology'] = existing['etymology'].strip()
            entry['etymologySource'] = 'wiktionary'
        if word == 'resume':
            # This project teaches the CV noun. The shipped general dictionary
            # supplies only verb IPA and merges noun/verb etymologies for this key.
            # Do not hand those values to the explicitly known CV card.
            extra = supplements.get(word, {})
            entry = {'phonetics': list(extra.get('phonetics', [])),
                     'partOfSpeech': 'noun', 'overrideWordIds': ['v-resume']}
            if entry['phonetics']:
                if extra.get('partOfSpeech') != 'noun' or '#Etymology_2' not in extra.get('sourceUrl', ''):
                    raise ValueError('resume requires the separately checked English CV-noun section.')
                entry['phoneticSource'] = 'en-wiktionary'
                entry['phoneticSourceUrl'] = extra['sourceUrl']
            noun_etymologies = [part.strip() for part in existing.get('etymology', '').split('；')
                                if part.strip().startswith('借自法语 résumé')]
            if len(noun_etymologies) == 1:
                entry['etymology'] = noun_etymologies[0]
                entry['etymologySource'] = 'wiktionary'
        if any(not isinstance(value, str) or not value.strip() or len(value) > 200 for value in entry['phonetics']):
            raise ValueError('Invalid phonetic value for ' + word)
        entries[word] = entry

    def coverage(keys):
        return {'words': len(keys), 'withPhonetics': sum(bool(entries[word]['phonetics']) for word in keys),
                'withEtymology': sum(bool(entries[word].get('etymology')) for word in keys),
                'missingPhonetics': sorted(word for word in keys if not entries[word]['phonetics'])}

    sources = {
        'wiktionary': {
            'label': '中文维基词典 / Kaikki', 'url': metadata['sourceUrl'],
            'license': metadata['license'], 'licenseUrl': metadata['licenseUrl'],
            'attribution': metadata['attribution'], 'wordUrlPattern': 'https://zh.wiktionary.org/wiki/{word}#英語',
            'sourceVersion': metadata['source'], 'sourceSha256': metadata['sha256'],
            'processing': '从随包词典精确词头选取原音标与词源；保留原文、原节选标记和许可。'
        },
        'ecdict': {
            'label': 'ECDICT', 'url': 'https://github.com/skywind3000/ECDICT/tree/' + ECDICT_COMMIT,
            'license': 'MIT', 'licenseUrl': 'https://github.com/skywind3000/ECDICT/blob/' + ECDICT_COMMIT + '/LICENSE',
            'attribution': 'Copyright (c) 2025 Linwei; skywind3000/ECDICT contributors.',
            'licenseText': license_text, 'sourceVersion': ECDICT_COMMIT, 'sourceSha256': ECDICT_SHA256,
            'processing': '仅在既有音标缺失时精确匹配词头并保留phonetic字段；不转换音标、不拼接词缀、不去重音符号。',
            'note': '上游说明以英音为主；并非每词都同时包含英美音，未对照本应用语音逐词标定。'
        },
        'en-wiktionary': {
            'label': '英文维基词典', 'url': 'https://en.wiktionary.org/',
            'license': 'CC-BY-SA-4.0', 'licenseUrl': 'https://creativecommons.org/licenses/by-sa/4.0/',
            'attribution': 'English Wiktionary contributors; 微光托业（选取 English Pronunciation 中已有 IPA）。',
            'wordUrlPattern': 'https://en.wiktionary.org/wiki/{word}#English',
            'processing': '仅补本次27个缺失教学词；从固定词条版本的English Pronunciation读取已有IPA，不读取其他语言或生成读法。'
        }
    }
    return {'schemaVersion': 1, 'checkedDate': '2026-10-24',
            'scope': 'Current teaching headwords plus existing core/expansion scene headwords; display references only.',
            'sources': sources, 'coverage': {'current': coverage(current_keys), 'scene': coverage(scene_keys), 'combined': coverage(target_keys)},
            'entries': entries}


def encode(data):
    # One entry per line keeps lexical additions reviewable without a huge JSON diff.
    header = json.dumps({name: value for name, value in data.items() if name != 'entries'}, ensure_ascii=False, indent=2)
    rows = ',\n'.join('    ' + json.dumps(word, ensure_ascii=False) + ': ' + json.dumps(entry, ensure_ascii=False, separators=(',', ':'))
                     for word, entry in data['entries'].items())
    return (header[:-2] + ',\n  "entries": {\n' + rows + '\n  }\n}\n').encode('utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ecdict-csv', required=True, type=Path)
    parser.add_argument('--ecdict-license', required=True, type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'content/word-card-reference.json')
    parser.add_argument('--check', action='store_true', help='Compare the existing output; do not rewrite it.')
    args = parser.parse_args()
    data = build(args.ecdict_csv, args.ecdict_license)
    result = encode(data)
    if args.check:
        if args.output.read_bytes() != result:
            raise ValueError('Generated reference differs from the checked-in output.')
    else:
        args.output.write_bytes(result)
    print(json.dumps({'bytes': len(result), 'sha256': hashlib.sha256(result).hexdigest(), 'coverage': data['coverage']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
