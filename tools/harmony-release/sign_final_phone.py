"""Sign one explicitly requested frozen HAP. No build, device, or credential copies."""
from pathlib import Path, PurePosixPath
from contextlib import ExitStack
import argparse
import base64
import datetime as dt
import hashlib
import json
import os
import re
import ssl
import struct
import subprocess
import sys
import tempfile
import zipfile

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
SUPPORT = HERE / 'support'
STUDIO = ORIGINAL = PRIVATE_ROOT = None
BUNDLE = 'com.lantern.toeic'
FINGERPRINT = PUBLIC_CERT_SHA = PUBLIC_PROFILE_SHA = None
ENVIRONMENT = None
OFFICIAL_ENTRYPOINTS = (
    'tools/node/node.exe', 'jbr/bin/java.exe',
    'sdk/default/openharmony/toolchains/lib/hap-sign-tool.jar',
    'tools/hvigor/hvigor-ohos-plugin/src/utils/decipher-util.js',
    'tools/hvigor/hvigor/index.js',
)
ACTIVE_STAGE = None
RESULT_PATH = None

class GateError(Exception):
    pass

def require(value, code):
    if not value:
        raise GateError(code)

def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))

def digest(data):
    return hashlib.sha256(data).hexdigest()

def file_sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def pin(path):
    p = Path(path)
    return {'path': str(p), 'bytes': p.stat().st_size, 'sha256': file_sha(p)}

def write_new(path, value):
    with Path(path).open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')

def configure_environment(path):
    """Load public machine bindings; never accept credentials or per-release tool paths."""
    global ENVIRONMENT, STUDIO, ORIGINAL, PRIVATE_ROOT, FINGERPRINT, PUBLIC_CERT_SHA, PUBLIC_PROFILE_SHA
    ENVIRONMENT = None
    config = read(path)
    path_fields = ('studioRoot', 'encryptedBuildProfile', 'privateOutputRoot', 'knownGoodReceipt')
    hash_fields = ('knownGoodReceiptSha256', 'signerDerSha256', 'certificateSha256', 'profileSha256')
    require(isinstance(config, dict) and config.get('schemaVersion') == 1 and
        set(config) == {'schemaVersion', 'toolEntrypoints', *path_fields, *hash_fields}, 'INVALID_ENVIRONMENT_CONFIG')
    for key in path_fields:
        require(isinstance(config[key], str) and Path(config[key]).is_absolute(), 'ABSOLUTE_ENVIRONMENT_PATH_REQUIRED')
    for key in hash_fields:
        require(isinstance(config[key], str) and re.fullmatch(r'[a-f0-9]{64}', config[key]) and
            config[key] != '0'*64, 'PINNED_ENVIRONMENT_HASH_REQUIRED')
    entries = config['toolEntrypoints']
    require(isinstance(entries, list) and len(entries) == len(OFFICIAL_ENTRYPOINTS), 'OFFICIAL_ENTRYPOINTS_REQUIRED')
    for row, name in zip(entries, OFFICIAL_ENTRYPOINTS):
        require(isinstance(row, dict) and set(row) == {'name', 'bytes', 'sha256'} and row['name'] == 'studio/' + name and
            type(row['bytes']) is int and row['bytes'] > 0 and isinstance(row['sha256'], str) and
            re.fullmatch(r'[a-f0-9]{64}', row['sha256']) and row['sha256'] != '0'*64, 'INVALID_OFFICIAL_ENTRYPOINT_PIN')
    # Assign only after the complete configuration is valid.
    STUDIO = Path(config['studioRoot']); ORIGINAL = Path(config['encryptedBuildProfile'])
    PRIVATE_ROOT = Path(config['privateOutputRoot'])
    FINGERPRINT = config['signerDerSha256']; PUBLIC_CERT_SHA = config['certificateSha256']
    PUBLIC_PROFILE_SHA = config['profileSha256']; ENVIRONMENT = config

def public_chain(data):
    return [digest(ssl.PEM_cert_to_DER_cert(block.decode('ascii')))
            for block in re.findall(b'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----', data, re.S)]

def profile_payload(data):
    if data.startswith(b'-----'):
        data = base64.b64decode(b''.join(line for line in data.splitlines() if not line.startswith(b'-----')))
    found = []
    def walk(start, end):
        while start < end:
            tag = data[start]; start += 1
            length = data[start]; start += 1
            if length & 128:
                count = length & 127
                require(0 < count <= 8, 'PUBLIC_PROFILE_DER_LENGTH')
                length = int.from_bytes(data[start:start+count], 'big'); start += count
            stop = start + length
            require(stop <= end, 'PUBLIC_PROFILE_DER_BOUNDS')
            if tag == 4 and data[start:stop].lstrip().startswith(b'{'):
                found.append(json.loads(data[start:stop]))
            if tag & 32:
                walk(start, stop)
            start = stop
    walk(0, len(data))
    require(len(found) == 1, 'PUBLIC_PROFILE_JSON_NOT_UNIQUE')
    return found[0]

def current_material():
    require(ENVIRONMENT is not None, 'LOCAL_SIGNING_ENVIRONMENT_REQUIRED')
    # Existing encrypted configuration stays in memory. Never serialize it.
    config = read(ORIGINAL)
    names = [p.get('signingConfig') for p in config['app']['products'] if p.get('name') == 'default']
    require(len(names) == 1 and names[0], 'SIGNER_PRODUCT_NOT_UNIQUE')
    selected = [c['material'] for c in config['app']['signingConfigs'] if c.get('name') == names[0]]
    require(len(selected) == 1, 'SIGNER_CONFIG_NOT_UNIQUE')
    material = selected[0]
    require(bool(material.get('storePassword')) and bool(material.get('keyPassword')), 'EXISTING_ENCRYPTED_FIELDS_MISSING')
    cert = Path(material['certpath']); profile = Path(material['profile'])
    require(file_sha(cert) == PUBLIC_CERT_SHA and file_sha(profile) == PUBLIC_PROFILE_SHA, 'PUBLIC_SIGNER_CHANGED')
    require(FINGERPRINT in public_chain(cert.read_bytes()), 'PUBLIC_SIGNER_FINGERPRINT_MISMATCH')
    public = profile_payload(profile.read_bytes())
    require(public['bundle-info']['bundle-name'] == BUNDLE, 'PUBLIC_PROFILE_BUNDLE_MISMATCH')
    now = dt.datetime.now(dt.timezone.utc).timestamp()
    require(public['validity']['not-before'] <= now < public['validity']['not-after'], 'PUBLIC_PROFILE_EXPIRED_OR_NOT_YET_VALID')
    require(Path(material['storeFile']).is_file(), 'EXISTING_KEYSTORE_MISSING')
    return material, public

def inspect():
    require(ENVIRONMENT is not None, 'LOCAL_SIGNING_ENVIRONMENT_REQUIRED')
    material, public = current_material()
    receipt = Path(ENVIRONMENT['knownGoodReceipt'])
    require(file_sha(receipt) == ENVIRONMENT['knownGoodReceiptSha256'], 'OLD_SUCCESS_RECEIPT_CHANGED')
    old = read(receipt)
    require(old['officialVerifyPassed'] and old['codeSignVerifyPassed'] and old['deviceSignerMatches'], 'OLD_SUCCESS_PROOF_MISSING')
    require(old['deviceCertificateFingerprint'].lower() == FINGERPRINT, 'OLD_PHONE_SIGNER_MISMATCH')
    tools = [SUPPORT/'direct-sign.cjs', SUPPORT/'CredentialPipe.java', SUPPORT/'secure_files.py', SUPPORT/'public_core.py',
        *(STUDIO/name for name in OFFICIAL_ENTRYPOINTS)]
    return {'schemaVersion': 1, 'status': 'PUBLIC_CONTEXT_READY_NO_SIGNING', 'bundleName': BUNDLE,
        'versionSource': 'explicit request.identity', 'certificateFile': pin(material['certpath']), 'profileFile': pin(material['profile']),
        'phoneMatchingSignerDerSha256': FINGERPRINT,
        'publicProfile': {'type': public.get('type'), 'bundleName': BUNDLE, 'validity': public['validity'],
            'authorizedDeviceCount': len(public.get('debug-info',{}).get('device-ids',[]))},
        'oldSuccessReceipt': pin(receipt), 'oldSignedSha256': old['signedSha256'],
        'oldOriginalPayloadEntriesUnchanged': old['allOriginalPayloadEntriesUnchanged'],
        'toolEntrypointsOnly': [pin(p) for p in tools], 'signingInvoked': False, 'deviceCalls': 0,
        'privateKeyReadOrCopied': False, 'passwordsPrinted': False, 'wholeSdkScan': False}

def validate_identity(identity):
    require(isinstance(identity, dict), 'EXPLICIT_RELEASE_IDENTITY_REQUIRED')
    name = identity.get('versionName'); code = identity.get('versionCode')
    require(isinstance(name, str) and len(name) <= 32 and
        re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', name) and
        type(code) is int and 1 <= code <= 2147483647, 'INVALID_RELEASE_VERSION')
    return identity

def signed_filename(identity):
    validate_identity(identity)
    return f"lantern-{identity['versionName']}-{identity['versionCode']}-signed.hap"

def verify_entrypoints(context):
    require(ENVIRONMENT is not None, 'LOCAL_SIGNING_ENVIRONMENT_REQUIRED')
    # Compare logical names and hashes so relocating this tool never requires repinning.
    actual = []
    for row in context['toolEntrypointsOnly']:
        path = Path(row['path'])
        base, prefix = (SUPPORT, 'support/') if path.parent == SUPPORT else (STUDIO, 'studio/')
        actual.append({'name': prefix + path.relative_to(base).as_posix(),
            'bytes': row['bytes'], 'sha256': row['sha256']})
    expected = read(HERE/'SUPPORT-PINS.json')['entries'] + ENVIRONMENT['toolEntrypoints']
    require(actual == expected, 'SIGNING_TOOL_ENTRYPOINT_CHANGED')

def check_app(app, identity):
    validate_identity(identity)
    require(app.get('bundleName') == BUNDLE, 'DIAGNOSTIC_ALIAS_OR_WRONG_BUNDLE_REJECTED')
    require(app.get('versionName') == identity['versionName'] and
        type(app.get('versionCode')) is int and app['versionCode'] == identity['versionCode'], 'REQUESTED_HAP_VERSION_MISMATCH')
    require(app.get('minAPIVersion') == 50000012 and app.get('targetAPIVersion') == 50000012, 'API_BASELINE_CHANGED')

def verify_request(request):
    require(request.get('status') == 'ROOT_FINAL_FROZEN_PHONE_SIGNING', 'FINAL_ROOT_REQUEST_REQUIRED')
    identity = validate_identity(request['identity']); source = Path(request['sourceRoot'])
    require(read(source/'public/build-identity.json') == identity, 'CURRENT_SOURCE_IDENTITY_MISMATCH')
    freeze = read(request['freezeManifest'])
    require(freeze['identity'] == identity and len(freeze['files']) == identity['inputCount'], 'FREEZE_IDENTITY_MISMATCH')
    # Runtime source check only; no SDK/helper/dependency tree traversal.
    for row in freeze['files']:
        relative = PurePosixPath(row['path'])
        require(not relative.is_absolute() and '..' not in relative.parts, 'UNSAFE_FROZEN_PATH')
        file = source.joinpath(*relative.parts)
        require(file.stat().st_size == row['bytes'] and file_sha(file) == row['sha256'], 'FROZEN_RUNTIME_CHANGED')
    native = read(request['nativeArtifactReceipt']); inputs = read(request['nativeInputReceipt'])
    package = read(request['nativePackageReceipt'])
    require(native['status'] == 'UNSIGNED_PACKAGE_VERIFIED' and package['status'] == 'PASS', 'NATIVE_VERIFICATION_REQUIRED')
    require(native['identity'] == inputs['identity'] == package['identity'] == identity, 'NATIVE_IDENTITY_MISMATCH')
    require(native['bundleName'] == package['bundleName'] == BUNDLE and package['allSharedBytesExact'], 'FORMAL_NATIVE_SHARED_PROOF_REQUIRED')
    require(inputs['inputs']['freeze']['sha256'] == file_sha(request['freezeManifest']), 'NATIVE_FREEZE_INPUT_MISMATCH')
    unsigned = Path(native['artifact']['path'])
    require(file_sha(unsigned) == native['artifact']['sha256'] == package['sha256'] == request['unsignedSha256'], 'UNSIGNED_HAP_CHANGED')
    with zipfile.ZipFile(unsigned) as archive:
        require(len(archive.namelist()) == len(set(archive.namelist())), 'DUPLICATE_HAP_MEMBERS')
        check_app(json.loads(archive.read('module.json'))['app'], identity)
        require(json.loads(archive.read('resources/rawfile/web/build-identity.json')) == identity, 'HAP_SHARED_IDENTITY_MISMATCH')
        shared = source/'mobile/dist'
        files = {p.relative_to(shared).as_posix(): p for p in shared.rglob('*') if p.is_file()}
        actual = {n[len('resources/rawfile/web/'):] for n in archive.namelist() if n.startswith('resources/rawfile/web/') and not n.endswith('/')}
        # Native sync excludes only these exact root paths from the complete Shared build.
        web_only = ('sw.js', 'manifest.webmanifest', 'offline.html')
        for name in web_only:
            public_file = source/'public'/name
            require(name in files and public_file.is_file(), 'WEB_ONLY_SHARED_PUBLIC_FILE_REQUIRED')
            require(files[name].read_bytes() == public_file.read_bytes(), 'WEB_ONLY_SHARED_PUBLIC_BYTES_MISMATCH')
            require(name not in actual, 'WEB_ONLY_HAP_MEMBER_FORBIDDEN')
        files = {name: path for name, path in files.items() if name not in web_only}
        # sync-web adds exactly one generated manifest beside the remaining Shared inputs.
        manifest_name = 'bundle-manifest.json'
        require(manifest_name not in files and actual == set(files) | {manifest_name}, 'HAP_SHARED_MEMBER_SET_MISMATCH')
        manifest_bytes = archive.read('resources/rawfile/web/'+manifest_name)
        manifest = json.loads(manifest_bytes)
        require(manifest.get('schemaVersion') == 1 and manifest.get('platform') == 'HarmonyOS', 'HAP_BUNDLE_MANIFEST_SCHEMA_MISMATCH')
        require(digest(manifest_bytes) == package.get('webManifestSha256'), 'HAP_BUNDLE_MANIFEST_RECEIPT_MISMATCH')
        rows = manifest.get('files')
        require(isinstance(rows, list), 'HAP_BUNDLE_MANIFEST_FILES_REQUIRED')
        indexed = {}
        for row in rows:
            require(isinstance(row, dict) and isinstance(row.get('path'), str), 'HAP_BUNDLE_MANIFEST_ROW_INVALID')
            name = row['path']; relative = PurePosixPath(name)
            require(bool(name) and not relative.is_absolute() and '..' not in relative.parts and '\\' not in name and ':' not in name and name == relative.as_posix(), 'HAP_BUNDLE_MANIFEST_PATH_INVALID')
            require(name not in indexed and type(row.get('bytes')) is int and row['bytes'] >= 0 and re.fullmatch(r'[a-f0-9]{64}', row.get('sha256', '')), 'HAP_BUNDLE_MANIFEST_ROW_INVALID')
            indexed[name] = row
        require(set(indexed) == set(files), 'HAP_BUNDLE_MANIFEST_MEMBER_SET_MISMATCH')
        for name, path in files.items():
            body = archive.read('resources/rawfile/web/'+name)
            require(digest(body) == file_sha(path), 'HAP_SHARED_BYTES_MISMATCH')
            require(len(body) == indexed[name]['bytes'] and digest(body) == indexed[name]['sha256'], 'HAP_BUNDLE_MANIFEST_BYTES_MISMATCH')
    return unsigned, identity

def zip_data_offset(archive, info):
    with Path(archive.filename).open('rb') as stream:
        stream.seek(info.header_offset)
        header = stream.read(30)
    require(len(header) == 30 and header[:4] == b'PK\x03\x04', 'SIGNED_LOCAL_HEADER_INVALID')
    name_bytes, extra_bytes = struct.unpack_from('<HH', header, 26)
    return info.header_offset + 30 + name_bytes + extra_bytes


def verify_pages_info(archive):
    # Official PageInfoGenerator marks ABC pages with nibble type2.
    # This successor accepts only the proven single leading ABC layout.
    ordered = sorted(archive.infolist(), key=lambda row: row.header_offset)
    require(len(ordered) >= 2 and ordered[0].filename == 'ets/modules.abc' and
            ordered[1].filename == '.pages.info', 'PAGES_INFO_SINGLE_LEADING_ABC_REQUIRED')
    require(ordered[0].compress_type == ordered[1].compress_type == zipfile.ZIP_STORED,
            'PAGES_INFO_ABC_AND_METADATA_MUST_BE_STORED')
    runnable = [row.filename for row in ordered if row.filename.endswith(('.abc', '.so'))]
    require(runnable == ['ets/modules.abc'], 'PAGES_INFO_OTHER_RUNNABLE_FILE_FORBIDDEN')
    start = zip_data_offset(archive, ordered[0])
    end = start + ordered[0].file_size
    maximum = zip_data_offset(archive, ordered[1])
    require(start == 4096 and start < end <= maximum and maximum % 4096 == 0,
            'PAGES_INFO_PAGE_BOUNDARY_INVALID')
    capacity_bits = ((maximum // 4096 * 4 + 63) // 64) * 64
    expected = bytearray(capacity_bits // 8)
    for page in range(start // 4096, (end + 4095) // 4096):
        bit = page * 4 + 1
        expected[bit // 8] |= 1 << (bit % 8)
    actual = archive.read('.pages.info')
    require(actual == bytes(expected), 'PAGES_INFO_BITMAP_MISMATCH')
    return {'bytes': len(actual), 'sha256': digest(actual), 'abcDataOffset': start,
            'abcBytes': ordered[0].file_size, 'abcEndExclusive': end,
            'firstNonRunnableDataOffset': maximum, 'bitsPerPage': 4,
            'abcPageType': 2, 'capacityBits': capacity_bits,
            'exactDynamicBitmapVerified': True}


def verify_signed_payload(unsigned, signed):
    with zipfile.ZipFile(unsigned) as before, zipfile.ZipFile(signed) as after:
        old_names, new_names = before.namelist(), after.namelist()
        require(len(old_names) == len(set(old_names)) == len({n.casefold() for n in old_names}) and
                len(new_names) == len(set(new_names)) == len({n.casefold() for n in new_names}),
                'DUPLICATE_SIGNED_HAP_MEMBERS')
        prior = {n for n in old_names if not n.endswith('/')}
        current = {n for n in new_names if not n.endswith('/')}
        added = current - prior
        require(prior <= current and added <= {'META-INF/code_sign', '.pages.info'},
                'UNEXPECTED_SIGNED_MEMBER_CHANGES')
        page_info = verify_pages_info(after) if '.pages.info' in added else None
        rows = []
        for name in sorted(prior):
            total = 0
            check = hashlib.sha256()
            with before.open(name) as original, after.open(name) as output:
                while True:
                    a, b = original.read(1024 * 1024), output.read(1024 * 1024)
                    require(a == b, 'ORIGINAL_HAP_PAYLOAD_CHANGED')
                    if not a:
                        break
                    total += len(a)
                    check.update(a)
            rows.append({'path': name, 'bytes': total, 'sha256': check.hexdigest()})
        return {'originalPayloadEntriesUnchanged': len(prior),
                'originalPayloadBytes': sum(row['bytes'] for row in rows),
                'payloadRowsCanonicalSha256': digest(json.dumps(rows, separators=(',', ':'), ensure_ascii=False).encode()),
                'signatureMetadataAdded': sorted(added), 'pagesInfo': page_info}


def sign(request):
    global ACTIVE_STAGE
    require(ENVIRONMENT is not None, 'LOCAL_SIGNING_ENVIRONMENT_REQUIRED')
    unsigned, identity = verify_request(request)
    context = inspect()
    verify_entrypoints(context)
    sys.path.insert(0, str(SUPPORT))
    from secure_files import WindowsSecurity
    security = WindowsSecurity()
    with ExitStack() as stack:
        root = stack.enter_context(security.path(PRIVATE_ROOT, directory=True))
        security.prove_private(root, protected=True)
        stage = Path(tempfile.mkdtemp(prefix=f"phone-{identity['versionCode']}-", dir=PRIVATE_ROOT))
        ACTIVE_STAGE = str(stage)
        security.prove_private(stack.enter_context(security.path(stage, directory=True)))
        write_new(stage/'STARTED.json', {'identity':identity,'unsignedSha256':request['unsignedSha256'],
            'startedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'deviceCalls':0,'attemptCount':1})
        # Hold the unsigned input and existing private material paths read-only.
        held = stack.enter_context(security.path(unsigned))
        require(digest(held.read()) == request['unsignedSha256'], 'HELD_UNSIGNED_CHANGED')
        stack.enter_context(security.path(ORIGINAL))
        material, _ = current_material()
        for name in ['certpath', 'profile', 'storeFile']:
            stack.enter_context(security.path(Path(material[name])))
        signed = stage/signed_filename(identity); temp = stage/'tmp'; temp.mkdir()
        env = {'SystemRoot': os.environ['SystemRoot'], 'WINDIR': os.environ['SystemRoot'],
            'TEMP': str(temp), 'TMP': str(temp), 'JAVA_HOME': str(STUDIO/'jbr'),
            'PATH': os.pathsep.join([str(STUDIO/'tools/node'),str(STUDIO/'jbr/bin'),str(Path(os.environ['SystemRoot'])/'System32')])}
        options = {'originalProfile': str(ORIGINAL), 'decipher': str(STUDIO/'tools/hvigor/hvigor-ohos-plugin/src/utils/decipher-util.js'),
            'java': str(STUDIO/'jbr/bin/java.exe'), 'jar': str(STUDIO/'sdk/default/openharmony/toolchains/lib/hap-sign-tool.jar'),
            'bridge': str(SUPPORT/'CredentialPipe.java'), 'unsigned': str(unsigned), 'signed': str(signed),
            'hvigorIndex': str(STUDIO/'tools/hvigor/hvigor/index.js'), 'hvigorModules': str(STUDIO/'tools/hvigor/hvigor/node_modules'),
            'env': env, 'log': str(stage/'sign-redacted.private.log')}
        write_new(stage/'options.json', options)
        executed = subprocess.run([str(STUDIO/'tools/node/node.exe'),str(SUPPORT/'direct-sign.cjs'),str(stage/'options.json')],
            cwd=stage,env=env,capture_output=True,timeout=180,creationflags=subprocess.CREATE_NO_WINDOW)
        require(executed.returncode == 0 and signed.is_file(), 'OFFICIAL_SIGN_FAILED_NO_AUTOMATIC_RETRY')
        verified = subprocess.run([options['java'],'-jar',options['jar'],'verify-app','-inFile',str(signed),
            '-outCertChain',str(stage/'verified-chain.cer'),'-outProfile',str(stage/'verified-profile.p7b')],
            cwd=stage,env=env,capture_output=True,timeout=90,creationflags=subprocess.CREATE_NO_WINDOW)
        log = verified.stdout+verified.stderr
        (stage/'verify.private.log').write_bytes(log)
        require(verified.returncode == 0 and b'verify-app success' in log and b'verify codesign success' in log and b'ERROR' not in log.upper(), 'OFFICIAL_VERIFY_FAILED')
        require(FINGERPRINT in public_chain((stage/'verified-chain.cer').read_bytes()), 'VERIFIED_PHONE_SIGNER_MISMATCH')
        payload = verify_signed_payload(unsigned, signed)
        require(digest(held.read()) == request['unsignedSha256'], 'UNSIGNED_CHANGED_DURING_SIGNING')
        return {'status': 'SIGNED_AND_OFFICIALLY_VERIFIED_NO_INSTALL', 'identity': identity,
            'unsigned': pin(unsigned), 'signed': pin(signed), 'phoneMatchingSignerDerSha256': FINGERPRINT,
            'officialVerifyPassed': True, 'codeSignVerifyPassed': True,
            'originalPayloadEntriesUnchanged': payload['originalPayloadEntriesUnchanged'],
            'signatureMetadataAdded': payload['signatureMetadataAdded'], 'signedPayloadCheck': payload,
            'passwordArgv': False, 'deviceCalls': 0, 'installed': False,
            'signingAttemptCount': 1, 'preflightPasses': 1, 'signerTool': pin(Path(__file__))}

def main():
    global RESULT_PATH
    parser = argparse.ArgumentParser(description='Sign once with an internal preflight and official verification; check is an optional dry-run.')
    parser.add_argument('mode', choices=['inspect','check','sign'])
    parser.add_argument('--request')
    parser.add_argument('--config', help='Public machine configuration outside the repository; required for sign/inspect, not check.')
    parser.add_argument('--result', required=True)
    args = parser.parse_args()
    require(not Path(args.result).exists(), 'RESULT_ALREADY_EXISTS_CHOOSE_NEW_LABEL')
    RESULT_PATH = args.result
    if args.mode in ('inspect', 'sign'):
        require(bool(args.config), 'LOCAL_SIGNING_ENVIRONMENT_REQUIRED')
        configure_environment(args.config)
    if args.mode == 'inspect':
        result = inspect()
    else:
        require(bool(args.request), 'FINAL_REQUEST_REQUIRED')
        request = read(args.request)
        if args.mode == 'check':
            unsigned, identity = verify_request(request)
            result = {'status':'FINAL_UNSIGNED_READY_NO_SIGNING','identity':identity,'unsigned':pin(unsigned),'deviceCalls':0,'signingInvoked':False}
        else:
            result = sign(request)
    write_new(args.result, result)
    print(json.dumps({'status':result['status'],'result':args.result,'deviceCalls':0}))

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Never print exception strings from profile/credential/native helpers.
        failure = {'status':'BLOCKED_NO_AUTOMATIC_RETRY','code':str(error) if isinstance(error,GateError) else type(error).__name__,'deviceCalls':0}
        if ACTIVE_STAGE:
            failure['privateStage'] = ACTIVE_STAGE
        if RESULT_PATH and not Path(RESULT_PATH).exists():
            write_new(RESULT_PATH, failure)
        print(json.dumps(failure))
        raise SystemExit(1)
