"""Synthetic files only: never inspect credentials, sign, load SDK, or call devices."""
from pathlib import Path
import hashlib
import importlib.util
import json
import tempfile
import zipfile

HERE = Path(__file__).resolve().parent
WEB_ONLY = ('sw.js', 'manifest.webmanifest', 'offline.html')
OBSERVATIONS = []


def sha(body):
    return hashlib.sha256(body).hexdigest()


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2)+'\n').encode()


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # Any accidental attempt to reach signing or private material fails this suite.
    def forbidden(*args, **kwargs):
        raise AssertionError('PRIVATE_OR_SIGNING_FUNCTION_CALLED')
    module.inspect = forbidden
    module.current_material = forbidden
    module.sign = forbidden
    return module


NEW = load(HERE/'sign_final_phone.py', 'new_signer')


def fixture(base, shared_change=None, public_change=None, payload_change=None, rows_change=None,
            version_name='0.4.5', version_code=20059, app_change=None):
    source = base/'source'
    shared = source/'mobile/dist'
    public = source/'public'
    shared.mkdir(parents=True)
    public.mkdir()
    identity = {'versionName': version_name, 'versionCode': version_code, 'inputCount': 4,
                'sourceSha256': 'a'*64, 'buildId': 'synthetic-final-no-product-inputs'}
    bodies = {'index.html': b'<html><div id="root"></div></html>\n',
              'build-identity.json': encoded(identity), 'assets/main.js': b'console.log("test");\n',
              # A nested same-named file must remain part of exact native payload.
              'nested/sw.js': b'nested retained service-worker-named data\n'}
    omitted = {'sw.js': b'public sw\n', 'manifest.webmanifest': b'{"name":"synthetic"}\n',
               'offline.html': b'<html>synthetic offline</html>\n'}
    public_bodies = {'build-identity.json': encoded(identity), **omitted}
    shared_bodies = {**bodies, **omitted}
    if shared_change:
        shared_change(shared_bodies)
    if public_change:
        public_change(public_bodies)
    for name, body in shared_bodies.items():
        target = shared/name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
    for name, body in public_bodies.items():
        (public/name).write_bytes(body)
    frozen_rows = [{'path': 'public/'+name, 'bytes': len(body), 'sha256': sha(body)}
                   for name, body in public_bodies.items()]
    identity['inputCount'] = len(frozen_rows)
    # Preserve identity consistency in all fixture layers if a public file was removed.
    public_bodies['build-identity.json'] = encoded(identity)
    (public/'build-identity.json').write_bytes(encoded(identity))
    (shared/'build-identity.json').write_bytes(encoded(identity))
    bodies['build-identity.json'] = encoded(identity)
    frozen_rows = [{'path': 'public/'+name, 'bytes': len(body), 'sha256': sha(body)}
                   for name, body in public_bodies.items()]
    freeze_path = base/'freeze.json'
    freeze_path.write_bytes(encoded({'identity': identity, 'files': frozen_rows}))
    payload = dict(bodies)
    if payload_change:
        payload_change(payload)
    rows = [{'path': name, 'bytes': len(body), 'sha256': sha(body)} for name, body in payload.items()]
    if rows_change:
        rows_change(rows)
    manifest_body = encoded({'schemaVersion': 1, 'platform': 'HarmonyOS', 'files': rows})
    hap = base/'synthetic.hap'
    app = {'bundleName': 'com.lantern.toeic', 'versionName': version_name,
           'versionCode': version_code, 'minAPIVersion': 50000012, 'targetAPIVersion': 50000012}
    if app_change:
        app_change(app)
    with zipfile.ZipFile(hap, 'w') as archive:
        archive.writestr('module.json', encoded({'app': app}))
        for name, body in payload.items():
            archive.writestr('resources/rawfile/web/'+name, body)
        archive.writestr('resources/rawfile/web/bundle-manifest.json', manifest_body)
    hap_sha = sha(hap.read_bytes())
    native_path = base/'native.json'
    native_path.write_bytes(encoded({'status': 'UNSIGNED_PACKAGE_VERIFIED', 'identity': identity,
        'bundleName': 'com.lantern.toeic', 'artifact': {'path': str(hap), 'sha256': hap_sha}}))
    inputs_path = base/'inputs.json'
    inputs_path.write_bytes(encoded({'identity': identity,
        'inputs': {'freeze': {'sha256': sha(freeze_path.read_bytes())}}}))
    package_path = base/'package.json'
    package_path.write_bytes(encoded({'status': 'PASS', 'identity': identity,
        'bundleName': 'com.lantern.toeic', 'allSharedBytesExact': True,
        'sha256': hap_sha, 'webManifestSha256': sha(manifest_body)}))
    return {'status': 'ROOT_FINAL_FROZEN_PHONE_SIGNING', 'identity': identity,
        'sourceRoot': str(source), 'freezeManifest': str(freeze_path),
        'nativeArtifactReceipt': str(native_path), 'nativeInputReceipt': str(inputs_path),
        'nativePackageReceipt': str(package_path), 'unsignedSha256': hap_sha}


def check(name, expected=None, module=NEW, request_change=None, **kwargs):
    with tempfile.TemporaryDirectory(prefix='signer-r3-synthetic-') as directory:
        request = fixture(Path(directory), **kwargs)
        if request_change:
            request_change(request)
        try:
            result = module.verify_request(request)
            actual = 'ACCEPT'
            assert result == (Path(directory)/'synthetic.hap', request['identity'])
        except module.GateError as error:
            actual = str(error)
        assert actual == (expected or 'ACCEPT'), (name, expected, actual)
        OBSERVATIONS.append({'case': name, 'result': 'PASS', 'observed': actual})


def main():
    check('exact_shared_minus_three_plus_generated_manifest_including_nested_sw_allowed')
    check('next_buildcode_without_tool_copy', version_code=20060)
    check('next_version_name_without_tool_copy', version_name='0.4.6', version_code=20061)
    check('missing_final_marker_rejected', 'FINAL_ROOT_REQUEST_REQUIRED',
          request_change=lambda request: request.update(status='PENDING_FINAL_IDENTITY_DO_NOT_SIGN'))
    check('wrong_bundle_rejected', 'DIAGNOSTIC_ALIAS_OR_WRONG_BUNDLE_REJECTED',
          app_change=lambda app: app.update(bundleName='com.lantern.diagnostic'))
    check('wrong_hap_version_rejected', 'REQUESTED_HAP_VERSION_MISMATCH',
          app_change=lambda app: app.update(versionCode=20060))
    check('wrong_api_baseline_rejected', 'API_BASELINE_CHANGED',
          app_change=lambda app: app.update(targetAPIVersion=50000013))
    check('request_identity_drift_rejected', 'CURRENT_SOURCE_IDENTITY_MISMATCH',
          request_change=lambda request: request['identity'].update(versionCode=20060))
    check('boolean_buildcode_rejected', 'INVALID_RELEASE_VERSION', version_code=True)
    check('unsafe_filename_version_rejected', 'INVALID_RELEASE_VERSION', version_name='../0.4.5')
    check('arbitrary_payload_missing_rejected', 'HAP_SHARED_MEMBER_SET_MISMATCH',
          payload_change=lambda files: files.pop('assets/main.js'))
    check('arbitrary_payload_extra_rejected', 'HAP_SHARED_MEMBER_SET_MISMATCH',
          payload_change=lambda files: files.update({'extra.js': b'extra'}))
    check('arbitrary_payload_changed_even_self_consistent_manifest_rejected', 'HAP_SHARED_BYTES_MISMATCH',
          payload_change=lambda files: files.update({'assets/main.js': b'changed'}))
    check('nested_same_named_file_missing_rejected', 'HAP_SHARED_MEMBER_SET_MISMATCH',
          payload_change=lambda files: files.pop('nested/sw.js'))
    for name in WEB_ONLY:
        check('web_only_'+name+'_in_hap_rejected', 'WEB_ONLY_HAP_MEMBER_FORBIDDEN',
              payload_change=lambda files, n=name: files.update({n: b'web-only-file'}))
        check('web_only_'+name+'_missing_shared_rejected', 'WEB_ONLY_SHARED_PUBLIC_FILE_REQUIRED',
              shared_change=lambda files, n=name: files.pop(n))
        check('web_only_'+name+'_missing_public_rejected', 'WEB_ONLY_SHARED_PUBLIC_FILE_REQUIRED',
              public_change=lambda files, n=name: files.pop(n))
        check('web_only_'+name+'_different_shared_public_rejected', 'WEB_ONLY_SHARED_PUBLIC_BYTES_MISMATCH',
              shared_change=lambda files, n=name: files.update({n: b'changed-shared-web-only'}))
        check('web_only_'+name+'_manifest_row_rejected', 'HAP_BUNDLE_MANIFEST_MEMBER_SET_MISMATCH',
              rows_change=lambda rows, n=name: rows.append({'path': n, 'bytes': 0, 'sha256': sha(b'')}))
    check('missing_manifest_row_rejected', 'HAP_BUNDLE_MANIFEST_MEMBER_SET_MISMATCH',
          rows_change=lambda rows: rows.pop())
    check('extra_manifest_row_rejected', 'HAP_BUNDLE_MANIFEST_MEMBER_SET_MISMATCH',
          rows_change=lambda rows: rows.append({'path': 'extra.js', 'bytes': 0, 'sha256': sha(b'')}))
    check('duplicate_manifest_row_rejected', 'HAP_BUNDLE_MANIFEST_ROW_INVALID',
          rows_change=lambda rows: rows.append(dict(rows[0])))
    check('changed_manifest_hash_rejected', 'HAP_BUNDLE_MANIFEST_BYTES_MISMATCH',
          rows_change=lambda rows: rows[0].update({'sha256': '0'*64}))
    check('changed_manifest_length_rejected', 'HAP_BUNDLE_MANIFEST_BYTES_MISMATCH',
          rows_change=lambda rows: rows[0].update({'bytes': rows[0]['bytes']+1}))
    check('unsafe_manifest_path_rejected', 'HAP_BUNDLE_MANIFEST_PATH_INVALID',
          rows_change=lambda rows: rows[0].update({'path': '../index.html'}))
    result = {'status': 'PASS_SYNTHETIC_VERIFY_REQUEST_ONLY', 'pass': len(OBSERVATIONS), 'fail': 0,
              'cases': OBSERVATIONS, 'signingInvoked': False, 'credentialInspection': False,
              'sdkInvoked': False, 'deviceCalls': 0, 'actualFinalHapChecked': False}
    print(json.dumps({'status': result['status'], 'pass': result['pass'], 'fail': 0}))


if __name__ == '__main__':
    main()
