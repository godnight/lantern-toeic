import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const script = fileURLToPath(new URL('../scripts/check-toolchain.mjs', import.meta.url));
function check(path, sdk) {
  const result = spawnSync(process.execPath, [script, `--sdk=${sdk}`], {
    env: {...process.env, PATH:path, LANTERN_HARMONY_SDK:''}, encoding:'utf8',
  });
  assert.equal(result.signal, null);
  return {status:result.status, report:JSON.parse(result.stdout)};
}

test('tool directories and a regular SDK file cannot pass readiness', t => {
  const dir = mkdtempSync(join(tmpdir(), 'lantern-tools-'));
  t.after(() => rmSync(dir, {recursive:true, force:true}));
  for (const name of ['hvigorw', 'ohpm', 'hdc']) mkdirSync(join(dir, name));
  const sdk = join(dir, 'not-a-sdk');
  writeFileSync(sdk, 'not a directory');
  const {status, report} = check(dir, sdk);
  assert.equal(status, 2);
  assert.deepEqual(report.tools, {hvigor:false, ohpm:false, hdc:false});
  assert.equal(report.sdkDirectoryExists, false);
});

test('executable presence passes readiness without claiming compilation or signing', t => {
  const dir = mkdtempSync(join(tmpdir(), 'lantern-tools-'));
  t.after(() => rmSync(dir, {recursive:true, force:true}));
  for (const name of ['hvigorw.cmd', 'ohpm.cmd', 'hdc']) writeFileSync(join(dir, name), '', {mode:0o755});
  const sdk = join(dir, 'sdk');
  mkdirSync(sdk);
  const {status, report} = check(dir, sdk);
  assert.equal(status, 0);
  assert.deepEqual(report.missing, []);
  assert.equal(report.compiled, false);
  assert.equal(report.signed, false);
  assert.equal(report.deviceTested, false);
});
