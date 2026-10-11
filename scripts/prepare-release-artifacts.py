#!/usr/bin/env python3
"""Package only built Web files, an unsigned HAP, tracked source and public QA."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import zipfile


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def plain_unsigned_zip(path):
    """Pinned packager emits contiguous ZIP records. Reject any external signing block."""
    raw = path.read_bytes()
    if len(raw) < 22 or raw[-22:-18] != b'PK\x05\x06':
        raise ValueError('HAP must have an uncommented ZIP end record and no trailing bytes')
    end = struct.unpack('<4s4H2IH', raw[-22:])
    if end[1] or end[2] or end[3] != end[4] or end[-1] or end[5] + end[6] != len(raw) - 22:
        raise ValueError('Unsupported HAP ZIP structure')
    with zipfile.ZipFile(path) as archive:
        entries = sorted(archive.infolist(), key=lambda item: item.header_offset)
        if len(entries) != end[4] or len({x.filename for x in entries}) != len(entries):
            raise ValueError('Duplicate or inconsistent HAP entries')
        offset = 0
        for item in entries:
            if item.header_offset != offset:
                raise ValueError('Unexpected bytes/signing block between HAP ZIP records')
            header = struct.unpack('<4s5H3I2H', raw[offset:offset + 30])
            if header[0] != b'PK\x03\x04' or header[2] & 9 or header[8] != item.file_size or header[7] != item.compress_size:
                raise ValueError('Unsupported or inconsistent HAP local file record')
            offset += 30 + header[-2] + header[-1] + item.compress_size
            if (item.filename.startswith('/') or '..' in Path(item.filename).parts or '\\' in item.filename
                    or Path(item.filename).suffix.lower() in {'.p12', '.p7b', '.jks', '.keystore', '.pem', '.cer', '.csr'}
                    or Path(item.filename).name == 'agconnect-services.json'):
                raise ValueError('Signing/account material or unsafe path in public HAP')
        if offset != archive.start_dir or offset != end[6]:
            raise ValueError('HAP has a ZIP-external signing block; never publish a device-authorized package')
        if archive.testzip() is not None:
            raise ValueError('HAP ZIP integrity failure')
        return json.loads(archive.read('module.json'))['app']


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args]).decode('utf-8').strip()


def file_info(path):
    return {'name': path.name, 'bytes': path.stat().st_size, 'sha256': sha256(path)}


def toolchain_info(clt, report):
    """Describe tools actually used; archive provenance exists only after verified extraction."""
    if not clt:
        raise ValueError('LANTERN_HARMONY_CLT is required for actual toolchain evidence')
    directory = Path(clt)
    text = (directory / 'version.txt').read_text('utf-8')
    version = re.search(r'^# Version:\s*(\S+)', text, re.MULTILINE)
    sdk = re.search(r'^HarmonyOS SDK:\s*(.+)', text, re.MULTILINE)
    if not version or not sdk:
        raise ValueError('Unrecognized CLT version metadata')
    receipt_path = directory / '.lantern-verified-install.json'
    receipt = json.loads(receipt_path.read_text('utf-8')) if receipt_path.exists() else None
    if receipt and receipt.get('cltVersion') != version[1]:
        raise ValueError('CLT extraction receipt/version mismatch')
    return {
        'cltVersion': version[1], 'cltSdkDescription': sdk[1],
        'sdkVersion': report['compileSdkVersion'],
        'cltNodeVersion': subprocess.check_output([str(directory / 'tool/node/bin/node'), '--version']).decode().strip(),
        'cltArchiveSha256': receipt['archiveSha256'] if receipt else None,
    }


def check_previous_version(configured, source, previous=None, expected_sha256=None):
    """An explicitly pinned local baseline is a precheck, never proof of current GitHub history."""
    code = configured['versionCode']
    if type(code) is not int or code < 20005:
        raise ValueError('App build number must be an integer >= 20005')
    if previous is None and expected_sha256 is None:
        return
    if previous is None or not re.fullmatch(r'[a-f0-9]{64}', expected_sha256 or ''):
        raise ValueError('Previous build-info file and verified SHA256 must be supplied together')
    raw = Path(previous).read_bytes()
    if len(raw) > 262144 or hashlib.sha256(raw).hexdigest() != expected_sha256:
        raise ValueError('Previous build-info SHA256 mismatch or excessive size')
    info = json.loads(raw)
    if (info.get('schemaVersion') != 1 or type(info.get('versionCode')) is not int
            or info['versionCode'] < 1 or not re.fullmatch(r'\d+\.\d+\.\d+', info.get('version', ''))
            or not re.fullmatch(r'[a-f0-9]{40}', info.get('sourceCommit', ''))):
        raise ValueError('Invalid previous build-info identity')
    if info['version'] == configured['versionName']:
        if info['sourceCommit'] != source or info['versionCode'] != code:
            raise ValueError('Same-version retry must keep source and versionCode unchanged')
    elif code <= info['versionCode']:
        raise ValueError('New versionCode must be greater than the supplied previous release')


def prepare(root, hap, verification, output, previous=None, previous_sha256=None):
    root, output = root.resolve(), output.resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError('Artifact output must be an empty directory')
    manifest = json.loads((root / 'release-manifest.json').read_text('utf-8'))
    version = manifest['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+', version) or manifest.get('prerelease') is not True or manifest.get('nativeHapAvailable') is not True:
        raise ValueError('Manifest must describe an offline prerelease with a real HAP')
    for package in ['package.json', 'mobile/package.json', 'harmony/package.json']:
        if json.loads((root / package).read_text('utf-8'))['version'] != version:
            raise ValueError('Package version mismatch: ' + package)
    configured = json.loads((root / 'harmony/AppScope/app.json5').read_text('utf-8'))['app']
    if configured['versionName'] != version:
        raise ValueError('App version mismatch')
    profile = json.loads((root / 'harmony/build-profile.json5').read_text('utf-8'))
    if profile['app'].get('signingConfigs'):
        raise ValueError('Public build source must not contain signing configuration')
    source = git(root, 'rev-parse', 'HEAD')
    tree = git(root, 'rev-parse', 'HEAD^{tree}')
    if os.environ.get('GITHUB_SHA', source) != source or git(root, 'status', '--porcelain', '--untracked-files=no'):
        raise ValueError('Build source is not the clean workflow commit')
    check_previous_version(configured, source, previous, previous_sha256)
    app = plain_unsigned_zip(hap)
    if app['versionName'] != version or app['versionCode'] != configured['versionCode']:
        raise ValueError('HAP does not match configured app version')
    report = json.loads(verification.read_text('utf-8'))
    if report['sha256'] != sha256(hap) or report['bytes'] != hap.stat().st_size or report['versionName'] != version:
        raise ValueError('HAP report does not match artifact bytes')
    for key in ['bundleName', 'buildMode', 'compileSdkType', 'compileSdkVersion', 'minAPIVersion', 'targetAPIVersion']:
        if report[key] != app[key]:
            raise ValueError('HAP report metadata mismatch: ' + key)
    if report['verifiedWebAssets'] < 1 or report['nativeBytecodePresent'] is not True:
        raise ValueError('HAP verification evidence is incomplete')
    qa_relative = manifest.get('qa', '')
    if not qa_relative.startswith('docs/testing/') or not qa_relative.endswith('.md'):
        raise ValueError('Manifest must point to a public QA Markdown file')
    qa = root / qa_relative
    if qa.is_symlink() or not qa.resolve().is_relative_to(root / 'docs/testing') or not qa.is_file():
        raise ValueError('Unsafe or missing QA document')
    dist = root / 'dist'
    if not (dist / 'server/index.js').is_file() or not (dist / 'client').is_dir():
        raise ValueError('Web production build is missing')
    output.mkdir(parents=True, exist_ok=True)
    prefix = 'lantern-v' + version
    web_zip = output / (prefix + '-web-build.zip')
    with zipfile.ZipFile(web_zip, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(dist.rglob('*')):
            if path.is_symlink():
                raise ValueError('Web build must not contain symlinks')
            if not path.is_file():
                continue
            if path.name.startswith('.env') or path.suffix.lower() in {'.p12', '.p7b', '.pem', '.key', '.keystore'}:
                raise ValueError('Private configuration in Web build')
            entry = zipfile.ZipInfo('dist/' + path.relative_to(dist).as_posix(), (2020, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, path.read_bytes())
    shutil.copyfile(hap, output / (prefix + '-harmony-unsigned.hap'))
    subprocess.run(['git', '-C', str(root), 'archive', '--format=zip', '--prefix=' + prefix + '/', '--output=' + str(output / (prefix + '-source.zip')), source], check=True)
    shutil.copyfile(qa, output / 'QA.md')
    # Allowlist public package-verification fields; never copy arbitrary diagnostic paths.
    public_report = {key: report[key] for key in ['schemaVersion', 'bytes', 'sha256', 'bundleName', 'versionName', 'buildMode', 'compileSdkType', 'compileSdkVersion', 'minAPIVersion', 'targetAPIVersion', 'nativeBytecodePresent', 'verifiedWebAssets', 'webManifestSha256']}
    public_report.update(hap=prefix + '-harmony-unsigned.hap', signatureBlockAbsent=True, signatureVerified=False, deviceTested=False)
    write_json(output / 'package-verification.json', public_report)
    info = {
        'schemaVersion': 1, 'version': version, 'sourceCommit': source, 'sourceTree': tree,
        'versionCode': app['versionCode'], 'hapSigning': 'unsigned', 'signatureBlockAbsent': True,
        **toolchain_info(os.environ.get('LANTERN_HARMONY_CLT'), report),
        'webNodeVersion': subprocess.check_output(['node', '--version']).decode().strip(),
        'javaVersion': subprocess.run(['java', '-version'], capture_output=True, text=True, check=True).stderr.strip(),
        'ciRunUrl': ('https://github.com/godnight/lantern-toeic/actions/runs/' + os.environ['GITHUB_RUN_ID']) if os.environ.get('GITHUB_RUN_ID') else None,
        'qaSource': qa_relative, 'artifacts': [file_info(path) for path in sorted(output.iterdir())],
        'limitations': ['Unsigned HAP requires local developer signing; device-authorized profiles are not published.',
                       'Web build requires the existing Sites runtime/bindings; creating this Release does not deploy the Site.',
                       'CI package checks do not replace device acceptance; consult QA.md for the tested device/build.']
    }
    write_json(output / 'build-info.json', info)
    assets = [file_info(path) for path in sorted(output.iterdir())]
    (output / 'SHA256SUMS.txt').write_text(''.join(item['sha256'] + '  ' + item['name'] + '\n' for item in assets), encoding='ascii')
    assets.append(file_info(output / 'SHA256SUMS.txt'))
    plan = {'schemaVersion': 1, 'version': version, 'sourceCommit': source, 'sourceTree': tree, 'assets': assets}
    write_json(output / 'release-assets.json', plan)
    return plan


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('.'))
    parser.add_argument('--hap', type=Path, required=True)
    parser.add_argument('--verification', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('release-assets'))
    parser.add_argument('--previous-build-info', type=Path, help='Previously verified release build-info; offline precheck only')
    parser.add_argument('--previous-build-info-sha256', help='SHA256 independently verified against the published attachment')
    args = parser.parse_args()
    result = prepare(args.root, args.hap, args.verification, args.output, args.previous_build_info, args.previous_build_info_sha256)
    print(json.dumps({'artifacts': len(result['assets']), 'sourceCommit': result['sourceCommit']}))
