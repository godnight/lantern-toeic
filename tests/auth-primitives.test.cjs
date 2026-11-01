const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { promisify } = require('node:util');
const { scrypt } = require('node:crypto');
const root = process.env.LANTERN_REVIEW_ROOT || path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));

// Execute the actual TypeScript against real Node crypto, never a fake verifier.
function load(file) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require }, { filename: file });
  return exports;
}

const credential = load('lib/password-credential.ts');
const phone = load('lib/phone-number.ts');
const syntheticPassword = 'Synthetic learner phrase 2026!';

test('usernames share one ASCII lowercase key and reject confusables/hidden characters', () => {
  for (const value of ['Learner_One', ' learner_one ', '\tLEARNER_ONE\n']) {
    const result = credential.normalizeUsername(value);
    assert.equal(result.ok, true);
    assert.equal(result.username, 'learner_one');
  }
  assert.equal(credential.normalizeUsername('a'.repeat(32)).ok, true);
  for (const value of [undefined, null, 123, {}, '', 'ab', 'a'.repeat(33), 'learner-one',
    'learner one', 'learner\0one', 'Ａlice', 'Аlice', '\u200bAlice', 'Alice\ufeff', '\u00a0Alice']) {
    const result = credential.normalizeUsername(value);
    assert.equal(result.ok, false, String(value));
    assert.equal(result.error, 'invalid-username');
  }
});

test('password policy measures Unicode code points and preserves whitespace', () => {
  for (const value of ['a'.repeat(8), 'a'.repeat(15), 'a'.repeat(128), '😀'.repeat(8), '😀'.repeat(15), '😀'.repeat(128),
    ' '.repeat(8), '  Synthetic spaces  ', '合成学习口令没有真实凭证仅用于测试']) {
    assert.equal(credential.validatePassword(value).ok, true, value.length);
  }
  for (const value of [undefined, null, {}, 15, '', 'a'.repeat(7), 'a'.repeat(129),
    '😀'.repeat(7), '😀'.repeat(129), 'a'.repeat(14) + '\0', 'a'.repeat(15) + '\ud800',
    'a'.repeat(15) + '\udfff']) {
    const result = credential.validatePassword(value);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'invalid-password');
  }
});

test('real asynchronous scrypt uses random salts and the documented fixed cost', async () => {
  const first = await credential.hashPassword(syntheticPassword);
  const second = await credential.hashPassword(syntheticPassword);
  assert.match(first, /^\$lantern\$scrypt\$v=1\$n=16384,r=8,p=5,k=64\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.notEqual(first, second, 'identical passwords receive independent random salts');
  const parts = first.split('$');
  assert.notEqual(parts[5], second.split('$')[5]);
  assert.equal(first.includes(syntheticPassword), false);
  const expected = await promisify(scrypt)(syntheticPassword, Buffer.from(parts[5], 'hex'), 64,
    { N: 16384, r: 8, p: 5, maxmem: 64 * 1024 * 1024 });
  assert.equal(expected.toString('hex'), parts[6]);
  assert.equal(await credential.verifyPassword(syntheticPassword, first), true);
  assert.equal(await credential.verifyPassword(syntheticPassword + 'x', first), false);
  assert.equal(await credential.verifyPassword(syntheticPassword, second), true);
});

test('password hashing and verification never trim, normalize or truncate the password', async () => {
  const exact = '  Synthetic spaces and accents é  ';
  const encoded = await credential.hashPassword(exact);
  assert.equal(await credential.verifyPassword(exact, encoded), true);
  assert.equal(await credential.verifyPassword(exact.trim(), encoded), false);
  assert.equal(await credential.verifyPassword(exact.normalize('NFD'), encoded), false);
  assert.equal(await credential.verifyPassword(exact + 'extra', encoded), false);
  const emoji = '😀'.repeat(128);
  const emojiHash = await credential.hashPassword(emoji);
  assert.equal(await credential.verifyPassword(emoji, emojiHash), true);
  assert.equal(await credential.verifyPassword(emoji + 'a', emojiHash), false);
});

test('malformed, weakened, excessive-cost and future hash formats fail closed', async () => {
  const valid = await credential.hashPassword(syntheticPassword);
  for (const value of [undefined, null, {}, '', valid + 'x', valid + '\n', valid.slice(0, -1),
    valid.replace('v=1', 'v=2'), valid.replace('n=16384', 'n=16383'),
    valid.replace('n=16384', 'n=1073741824'), valid.replace('r=8', 'r=1'),
    valid.replace('p=5', 'p=1'), valid.replace('k=64', 'k=32'),
    valid.replace('$scrypt$', '$bcrypt$'), valid.replace(/.$/, 'g'),
    valid.replace(/\$([0-9a-f]{32})\$/, (_, salt) => '$A' + salt.slice(1) + '$'),
    valid.replace('n=16384,r=8', 'r=8,n=16384'), 'x'.repeat(100_000)]) {
    assert.equal(await credential.verifyPassword(syntheticPassword, value), false);
  }
  assert.equal(await credential.verifyPassword('short', valid), false);
  assert.equal(await credential.verifyPassword({}, valid), false);
  await assert.rejects(credential.hashPassword('short'), /Invalid password/);
});

test('a changed stored key is rejected by real verification', async () => {
  const encoded = await credential.hashPassword(syntheticPassword);
  const replacement = encoded.endsWith('0') ? '1' : '0';
  assert.equal(await credential.verifyPassword(syntheticPassword, encoded.slice(0, -1) + replacement), false);
});

test('three simultaneous real hash requests admit one derivation and reject two without a queue', async () => {
  assert.equal(credential.PASSWORD_HASH_CONCURRENCY, 1);
  const results = await Promise.allSettled([
    credential.hashPassword(syntheticPassword),
    credential.hashPassword(syntheticPassword),
    credential.hashPassword(syntheticPassword),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(rejected.length, 2);
  for (const { reason } of rejected) {
    assert.equal(reason instanceof credential.PasswordHashBusyError, true);
    assert.equal(reason.name, 'PasswordHashBusyError');
    assert.equal(reason.message, 'Password hashing temporarily unavailable');
    assert.equal(reason.message.includes(syntheticPassword), false);
  }
  const encoded = await credential.hashPassword(syntheticPassword);
  assert.equal(await credential.verifyPassword(syntheticPassword, encoded), true);
  assert.equal(await credential.verifyPassword(syntheticPassword + 'wrong', encoded), false);
  assert.equal(await credential.verifyPassword(syntheticPassword, await credential.hashPassword(syntheticPassword)), true);
});

test('verification and hashing share the same slot and rejection leaves it reusable', async () => {
  const encoded = await credential.hashPassword(syntheticPassword);
  const verification = credential.verifyPassword(syntheticPassword, encoded);
  await assert.rejects(credential.hashPassword(syntheticPassword), error =>
    error instanceof credential.PasswordHashBusyError);
  await assert.rejects(credential.verifyPassword(syntheticPassword, encoded), error =>
    error instanceof credential.PasswordHashBusyError);
  assert.equal(await verification, true);
  await assert.rejects(credential.hashPassword('short'), /Invalid password/);
  assert.equal(await credential.verifyPassword(syntheticPassword, await credential.hashPassword(syntheticPassword)), true);
});

test('+86 phone v1 canonicalizes only the supported ASCII formats', () => {
  const canonical = '+8610000000000'; // Synthetic format fixture, never sent to a provider.
  for (const value of ['10000000000', '100 0000 0000', '100-0000-0000', '+8610000000000',
    '+86 100 0000 0000', '+86-100-0000-0000', '  +86 100 0000 0000  ']) {
    const result = phone.parseMainlandPhone(value);
    assert.equal(result.ok, true, value);
    assert.equal(result.phone, canonical);
    assert.equal(result.version, 1);
  }
  assert.equal(phone.parseMainlandPhone('19999999999').ok, true, 'format does not assert current carrier assignment');
});

test('phone format rejection does not truncate or swallow country codes', () => {
  for (const value of ['+1 0000000000', '+44 10000000000', '+88610000000000', '+8 6 10000000000']) {
    const result = phone.parseMainlandPhone(value);
    assert.equal(result.ok, false, value);
    assert.equal(result.error, 'unsupported-country');
  }
  for (const value of [undefined, null, {}, 10000000000, '', '008610000000000', '8610000000000',
    '1000000000', '100000000000', '+86100000000000', '+86', '+86+10000000000',
    '20000000000', '+86 01000000000', '10000000000-', '-10000000000',
    '１００００００００００', '+86\u00a010000000000', '100\t0000 0000',
    '10000000000\n', '10000000000ext1', '10000000000\0']) {
    const result = phone.parseMainlandPhone(value);
    assert.equal(result.ok, false, String(value));
    assert.equal(result.error, 'invalid-phone');
  }
});
