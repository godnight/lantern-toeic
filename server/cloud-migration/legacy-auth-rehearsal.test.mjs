import test from 'node:test';
import assert from 'node:assert/strict';
import { rehearseLegacyAuthMigration } from './legacy-auth-rehearsal.mjs';

test('synthetic legacy ledger maps only the in-memory copy while accounts and sessions remain valid', { timeout: 30000 }, async () => {
  assert.deepEqual(await rehearseLegacyAuthMigration(), {
    ok: true, scenario: 'success', sourcePreserved: true, accounts: 2, sessionIsolation: true, huaweiBindingPreserved: true,
  });
});

for (const [scenario, expected] of [
  ['bad-ledger', /ledger mismatch/],
  ['unknown-ledger', /ledger mismatch/],
  ['unknown-schema', /schema mismatch/],
  ['bad-foreign-key', /integrity failure/],
  ['source-changed', /source changed during copy/],
  ['copy-failure', /synthetic mapping failure/],
]) {
  test(`synthetic migration rejects ${scenario}`, { timeout: 30000 }, async () => {
    await assert.rejects(rehearseLegacyAuthMigration(scenario), expected);
  });
}

test('synthetic rehearsal rejects arbitrary scenarios and cannot accept database paths', async () => {
  await assert.rejects(rehearseLegacyAuthMigration('/path/to/real.sqlite'), /unsupported synthetic scenario/);
});
