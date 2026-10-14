"""Fingerprint actual Web/Harmony inputs, including untracked inputs, without self-reference."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re

ROOT = Path(__file__).resolve().parent.parent
DIRS = ('.openai', 'app', 'art', 'build', 'components', 'content', 'db', 'drizzle', 'harmony', 'hooks', 'lib', 'mobile', 'public', 'scripts', 'types', 'vendor', 'worker')
FILES = ('package.json', 'package-lock.json', 'tsconfig.json', 'postcss.config.mjs', 'vite.config.ts', 'next.config.ts', 'drizzle.config.ts', 'release-manifest.json')
SKIP = {'.git', 'node_modules', 'dist', '.hvigor', 'oh_modules', '.ohpm', '.wrangler', '__pycache__', '.preview', '.idea'}
IDENTITY = 'public/build-identity.json'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def inputs():
    paths = []
    for folder in DIRS:
        base = ROOT / folder
        if not base.is_dir() or base.is_symlink():
            raise ValueError('Missing or linked input directory: ' + folder)
        for directory, dirs, files in os.walk(base, followlinks=False):
            rel = Path(directory).relative_to(ROOT)
            dirs[:] = [name for name in dirs if name not in SKIP and not (rel.parts[0] == 'harmony' and name in {'build', 'rawfile'})]
            for name in dirs:
                if (Path(directory) / name).is_symlink():
                    raise ValueError('Linked build input directory refused')
            for name in files:
                path = Path(directory) / name
                relative = path.relative_to(ROOT).as_posix()
                if relative == IDENTITY or name.endswith('.tsbuildinfo'):
                    continue
                if path.is_symlink() or name.startswith('.env') or path.suffix.lower() in {'.p12', '.p7b', '.pem', '.jks', '.keystore', '.pfx'} or name == 'agconnect-services.json':
                    raise ValueError('Private or linked build input refused: ' + relative)
                paths.append(path)
    paths.extend(ROOT / name for name in FILES)
    result = []
    for path in sorted(set(paths), key=lambda item: item.relative_to(ROOT).as_posix()):
        raw = path.read_bytes()
        result.append({'path': path.relative_to(ROOT).as_posix(), 'bytes': len(raw), 'sha256': digest(raw)})
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--freeze-id', required=True)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{1,80}', args.freeze_id):
        raise ValueError('Invalid freeze ID')
    entries = inputs()
    tree = digest(json.dumps(entries, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
    app = json.loads((ROOT / 'harmony/AppScope/app.json5').read_text(encoding='utf-8'))['app']
    identity = {'schemaVersion': 1, 'buildId': args.freeze_id + '-' + tree[:12], 'sourceInputsSha256': tree, 'inputCount': len(entries), 'excludedSelf': IDENTITY, 'versionName': app['versionName'], 'versionCode': app['versionCode']}
    destination = ROOT.parent / 'source-freezes' / args.freeze_id
    manifest = {'schemaVersion': 1, 'scope': 'actual Web and Harmony source/build inputs; dependencies pinned separately by lockfile; generated outputs excluded', 'identity': identity, 'files': entries}
    if args.check:
        recorded = json.loads((destination / 'runtime-inputs.json').read_text(encoding='utf-8'))
        if recorded != manifest or json.loads((ROOT / IDENTITY).read_text(encoding='utf-8')) != identity:
            raise ValueError('Frozen source input set or bytes changed')
    else:
        destination.mkdir(parents=True, exist_ok=False)
        (ROOT / IDENTITY).write_text(json.dumps(identity, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        (destination / 'runtime-inputs.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': 'checked' if args.check else 'frozen', 'manifest': str(destination / 'runtime-inputs.json'), **identity}, ensure_ascii=False))

if __name__ == '__main__':
    main()
