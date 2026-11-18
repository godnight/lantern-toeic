// Read-only fault probe for the real exported putAudio implementation.
// Exit 0 means this abort-only fault was reproduced, not that saving succeeded.
// The IndexedDB/Blob inputs are synthetic; no device or user database is opened.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', '..', '..'));
const ts = require(path.join(root, 'node_modules', 'typescript'));
const source = fs.readFileSync(path.join(root, 'lib', 'use-study.ts'), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

let transaction;
let closed = 0;
let injected = false;
const database = {
  transaction() {
    transaction = {
      objectStore() {
        return {
          put() {
            setImmediate(() => {
              injected = true;
              transaction.onabort?.({ target: transaction });
            });
          },
        };
      },
    };
    return transaction;
  },
  close() { closed++; },
};
const indexedDB = {
  open() {
    const request = { result: database };
    setImmediate(() => request.onsuccess?.());
    return request;
  },
};
const taskExports = {};
vm.runInNewContext(code, { exports: taskExports, require() { return {}; }, indexedDB, Blob });

let state = 'pending';
taskExports.putAudio('synthetic-only', new Blob(['synthetic'])).then(
  () => { state = 'resolved'; },
  () => { state = 'rejected'; },
);
setImmediate(() => setImmediate(() => setImmediate(() => {
  assert.equal(injected, true, 'The abort-only synthetic event must be delivered');
  assert.equal(typeof transaction.onabort, 'undefined');
  assert.equal(state, 'pending');
  assert.equal(closed, 0);
  console.log(JSON.stringify({
    probe: 'abort-only synthetic transaction',
    source: 'lib/use-study.ts',
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    onabortHandler: typeof transaction.onabort,
    promiseState: state,
    dbCloseCalls: closed,
    expectedFaultReproduced: true,
    limitation: 'Synthetic event model; not a real IndexedDB or ArkWeb device reproduction',
  }, null, 2));
})));
