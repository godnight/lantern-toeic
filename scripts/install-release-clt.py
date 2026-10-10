#!/usr/bin/env python3
"""Install the pinned public Linux CLT; no account, device or signing material."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import urllib.request
import zipfile

URL = 'https://repo.huaweicloud.com/harmonyos/ohpm/5.1.0/commandline-tools-linux-x64-5.1.0.840.zip'
SHA256 = '1dcefa4741dc289277560b2802040e0c45b433898d8db453d711d5376e0478f1'
BYTES = 2153496473
EXPANDED_BYTES = 6606754531
MARGIN = 3 * 1024 ** 3


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def space(path, required):
    free = shutil.disk_usage(path).free
    print(f'Available bytes: {free}; required bytes: {required}', flush=True)
    if free < required:
        raise RuntimeError('Insufficient runner disk space for the pinned HarmonyOS SDK; no release will be published')


def validate(archive):
    if archive.stat().st_size != BYTES or digest(archive) != SHA256:
        raise RuntimeError('Pinned CLT archive size/SHA256 mismatch')


def download(archive):
    archive.parent.mkdir(parents=True, exist_ok=True)
    if archive.exists():
        validate(archive)
        print('Cached archive matches the pinned official SHA256', flush=True)
        return
    space(archive.parent, BYTES + EXPANDED_BYTES + MARGIN)
    partial = archive.with_suffix(archive.suffix + '.part')
    with urllib.request.urlopen(URL, timeout=60) as response, partial.open('wb') as output:
        shutil.copyfileobj(response, output, 1024 * 1024)
    validate(partial)
    partial.replace(archive)
    print('Downloaded and verified the pinned CLT', flush=True)


def extract(archive, destination):
    validate(archive)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and any(destination.iterdir()):
        raise RuntimeError('CLT destination must be empty; use a fresh runner directory')
    space(destination.parent, EXPANDED_BYTES + MARGIN)
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    with zipfile.ZipFile(archive) as source:
        entries = source.infolist()
        if sum(x.file_size for x in entries) != EXPANDED_BYTES:
            raise RuntimeError('Unexpected CLT archive structure')
        for entry in entries:
            name = PurePosixPath(entry.filename)
            if name.is_absolute() or '..' in name.parts or '\\' in entry.filename or name.parts[0] != 'command-line-tools':
                raise RuntimeError('Unsafe CLT archive path')
            target = destination / entry.filename
            if not target.resolve().is_relative_to(root):
                raise RuntimeError('Archive path escapes installation directory')
            mode = entry.external_attr >> 16
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            if stat.S_ISLNK(mode):
                link = source.read(entry).decode('utf-8')
                if not (target.parent / link).resolve().is_relative_to(root):
                    raise RuntimeError('Unsafe CLT symlink')
                target.symlink_to(link)
            else:
                with source.open(entry) as inp, target.open('wb') as out:
                    shutil.copyfileobj(inp, out, 1024 * 1024)
                if mode & 0o777:
                    target.chmod(mode & 0o777)
    tools = destination / 'command-line-tools'
    for relative in ['bin/hvigorw', 'bin/ohpm', 'tool/node/bin/node']:
        if not os.access(tools / relative, os.X_OK):
            raise RuntimeError('CLT executable missing after extraction: ' + relative)
    if not (tools / 'sdk/default').is_dir():
        raise RuntimeError('Bundled SDK missing')
    (tools / '.lantern-verified-install.json').write_text(json.dumps({
        'cltVersion': '5.1.0.840', 'archiveSha256': SHA256, 'archiveBytes': BYTES,
        'source': URL,
    }) + '\n', encoding='utf-8')
    print(f'CLT ready: {tools}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['download', 'extract'])
    parser.add_argument('archive', type=Path)
    parser.add_argument('destination', type=Path, nargs='?')
    args = parser.parse_args()
    if args.operation == 'download':
        download(args.archive)
    else:
        if args.destination is None:
            parser.error('extract requires a destination')
        extract(args.archive, args.destination)
