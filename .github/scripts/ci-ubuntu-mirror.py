#!/usr/bin/env python3
"""Use the official Ubuntu archive for this GitHub runner's Ubuntu sources.

Only named Ubuntu source files are inspected. Suite, component and signature
fields, official security URLs, third-party URLs and comments remain unchanged.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re

URLS = {
    b'http://azure.archive.ubuntu.com/ubuntu': b'http://archive.ubuntu.com/ubuntu',
    b'http://azure.archive.ubuntu.com/ubuntu/': b'http://archive.ubuntu.com/ubuntu/',
    b'https://azure.archive.ubuntu.com/ubuntu': b'https://archive.ubuntu.com/ubuntu',
    b'https://azure.archive.ubuntu.com/ubuntu/': b'https://archive.ubuntu.com/ubuntu/',
}
FILES = ('apt/apt-mirrors.txt', 'apt/sources.list', 'apt/sources.list.d/ubuntu.sources')
NETWORK = (b'Acquire::Retries "2";\n'
           b'Acquire::http::Timeout "30";\n'
           b'Acquire::https::Timeout "30";\n')


def rewrite(data, kind):
    result = []
    uri_field = False
    replacements = 0
    for line in data.splitlines(keepends=True):
        comment_at = re.search(rb'(?<!\S)#', line)
        active, marker, comment = (line[:comment_at.start()], b'#', line[comment_at.start()+1:]) if comment_at else (line, b'', b'')
        stripped = active.strip()
        if kind == 'mirror':
            selected = bool(stripped)
        elif kind == 'legacy':
            selected = stripped.startswith((b'deb ', b'deb\t', b'deb-src ', b'deb-src\t'))
        else:
            if not stripped:
                if not marker:
                    uri_field = False
            elif not active[:1].isspace():
                uri_field = active.partition(b':')[0].lower() == b'uris'
            selected = uri_field
        if selected:
            tokens = re.split(rb'(\s+)', active)
            replacements += sum(token in URLS for token in tokens)
            active = b''.join(URLS.get(token, token) for token in tokens)
        result.append(active + marker + comment)
    return b''.join(result), replacements


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--expected-codename', required=True)
    args = parser.parse_args()
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise SystemExit('This helper only changes an isolated GitHub Actions runner.')
    release = dict(line.split('=', 1) for line in Path('/etc/os-release').read_text().splitlines() if '=' in line)
    distro = release.get('ID', '').strip('"')
    codename = release.get('VERSION_CODENAME', '').strip('"')
    if distro != 'ubuntu' or codename != args.expected_codename:
        raise SystemExit(f'Unexpected runner OS {distro}/{codename}; review Ubuntu sources before changing them.')
    edits = []
    inspected = 0
    for relative, kind in zip(FILES, ('mirror', 'legacy', 'deb822')):
        file = Path('/etc') / relative
        if not file.is_file():
            continue
        inspected += 1
        before = file.read_bytes()
        after, count = rewrite(before, kind)
        if count:
            edits.append((file, before, after, count))
    if not inspected:
        raise SystemExit('No recognized Ubuntu source file; nothing changed.')
    config = Path('/etc/apt/apt.conf.d/80lantern-ci-network')
    if config.exists() and config.read_bytes() != NETWORK:
        raise SystemExit('Existing Lantern CI network settings differ; nothing changed.')
    for file, before, after, count in edits:
        if file.read_bytes() != before:
            raise SystemExit('Ubuntu source changed concurrently; stop before editing it.')
        file.write_bytes(after)
    config.write_bytes(NETWORK)
    print(json.dumps({'ubuntuCodename': codename, 'inspectedNamedFiles': inspected,
        'changed': [{'path': str(file), 'urls': count,
                     'beforeSha256': hashlib.sha256(before).hexdigest(),
                     'afterSha256': hashlib.sha256(after).hexdigest()}
                    for file, before, after, count in edits],
        'network': {'retries': 2, 'httpTimeoutSeconds': 30, 'httpsTimeoutSeconds': 30}}))


if __name__ == '__main__':
    main()
