"""Path and digest primitives used by secure_files; no release-specific defaults."""
from pathlib import Path
import hashlib
import json
import os
import stat


class GateError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def require(condition, code):
    if not condition:
        raise GateError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    try:
        return Path(path).read_bytes()
    except Exception:
        raise GateError('INPUT_UNREADABLE') from None


def plain_path(path):
    path = Path(path).absolute()
    for item in (path, *path.parents):
        try:
            metadata = item.lstat()
        except OSError:
            raise GateError('MISSING_CONTROLLED_PATH') from None
        require(not stat.S_ISLNK(metadata.st_mode) and not (getattr(metadata, 'st_file_attributes', 0) & 0x400), 'REPARSE_OR_LINKED_PATH_FORBIDDEN')
    return path


def tree_sha(directory, reader=read):
    root = plain_path(directory); require(root.is_dir(), 'EXISTING_TOOL_CACHE_REQUIRED')
    rows = []
    for current, directories, files in os.walk(root, followlinks=False):
        for name in sorted(directories + files):
            item = plain_path(Path(current) / name)
            if item.is_file():
                content = reader(item)
                rows.append(dict(path=item.relative_to(root).as_posix(), bytes=len(content), sha256=digest(content)))
    require(bool(rows), 'EMPTY_TOOL_CACHE_FORBIDDEN')
    return digest(json.dumps(sorted(rows, key=lambda row: row['path']), sort_keys=True, separators=(',', ':')).encode())
