#!/usr/bin/env python3
"""Check compiled HAP structure and compare every bundled asset to the source."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import zipfile


def verify(hap, web):
    manifest_bytes = (web / 'bundle-manifest.json').read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest.get('platform') != 'HarmonyOS' or manifest.get('schemaVersion') != 1:
        raise ValueError('Unsupported asset manifest')
    paths = [entry['path'] for entry in manifest['files']]
    if len(paths) != len(set(paths)) or 'index.html' not in paths:
        raise ValueError('Duplicate assets or missing entrypoint')
    for name in paths:
        path = PurePosixPath(name)
        if path.is_absolute() or '..' in path.parts or '\\' in name:
            raise ValueError('Unsafe asset path')
    forbidden = {'sw.js', 'manifest.webmanifest', 'offline.html'}
    if forbidden.intersection(paths):
        raise ValueError('Web service worker files must not ship in the native app')
    with zipfile.ZipFile(hap) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError('Duplicate HAP entries')
        for required in ['module.json', 'pack.info', 'resources.index', 'ets/modules.abc']:
            if not archive.read(required):
                raise ValueError(f'Empty native artifact: {required}')
        prefix = 'resources/rawfile/web/'
        actual = {name[len(prefix):] for name in names if name.startswith(prefix) and not name.endswith('/')}
        if actual != set(paths) | {'bundle-manifest.json'}:
            raise ValueError('Unexpected or missing HAP web assets')
        if archive.read(prefix + 'bundle-manifest.json') != manifest_bytes:
            raise ValueError('HAP manifest differs from current source bundle')
        for entry in manifest['files']:
            source = (web / entry['path']).read_bytes()
            bundled = archive.read(prefix + entry['path'])
            if (bundled != source or len(bundled) != entry['bytes']
                    or hashlib.sha256(bundled).hexdigest() != entry['sha256']):
                raise ValueError(f'Stale or corrupt asset: {entry["path"]}')
        if any(PurePosixPath(name).suffix.lower() in {'.p12', '.p7b', '.jks', '.keystore', '.pem'}
               or PurePosixPath(name).name == 'agconnect-services.json' for name in names):
            raise ValueError('Unexpected signing or account configuration in offline HAP')
        module = json.loads(archive.read('module.json'))
        app = module['app']
        if app['bundleName'] != 'com.lantern.toeic' or app['compileSdkType'] != 'HarmonyOS':
            raise ValueError('Unexpected application or compiler platform')
        if app['minAPIVersion'] != 50000012 or app['targetAPIVersion'] != 50000012:
            raise ValueError('Unexpected change to API 12 compatibility')
    return {
        'schemaVersion': 1,
        'hap': hap.name,
        'bytes': hap.stat().st_size,
        'sha256': hashlib.sha256(hap.read_bytes()).hexdigest(),
        'bundleName': app['bundleName'],
        'versionName': app['versionName'],
        'buildMode': app['buildMode'],
        'compileSdkType': app['compileSdkType'],
        'compileSdkVersion': app['compileSdkVersion'],
        'minAPIVersion': app['minAPIVersion'],
        'targetAPIVersion': app['targetAPIVersion'],
        'nativeBytecodePresent': True,
        'verifiedWebAssets': len(paths),
        'webManifestSha256': hashlib.sha256(manifest_bytes).hexdigest(),
        'signatureVerified': False,
        'deviceTested': False,
        'note': 'Package integrity only; signing, installation and offline device behavior require separate verification.',
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('hap', type=Path)
    parser.add_argument('--web', type=Path, required=True)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    report = json.dumps(verify(args.hap, args.web), ensure_ascii=False, indent=2) + '\n'
    if args.report:
        args.report.write_text(report, encoding='utf-8')
    print(report, end='')
