const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../entry/src/main/ets/entryability/EntryAbility.ets'), 'utf8');
const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(loadContent) {
  const errors = [], exports = {};
  const imports = {'@kit.AbilityKit':{UIAbility:class {}}, '@kit.ArkUI':{}, '@kit.BasicServicesKit':{}};
  vm.runInNewContext(code, {exports,require:name=>imports[name],AppStorage:{setOrCreate(){}},console:{error:message=>errors.push(message)}});
  return {ability:new exports.default(),stage:{loadContent},errors};
}
test('page loading succeeds without an error report', async () => {
  const paths = [], h = fixture(value=>{paths.push(value);return Promise.resolve();});
  h.ability.onWindowStageCreate(h.stage); await tick();
  assert.deepEqual(paths, ['pages/Index']); assert.deepEqual(h.errors, []);
});
test('synchronous page loading failure is contained and reported once', () => {
  const h = fixture(()=>{throw Object.assign(Error('window unavailable'), {code:1300002});});
  assert.doesNotThrow(()=>h.ability.onWindowStageCreate(h.stage));
  assert.deepEqual(h.errors, ['LANTERN page load failed: 1300002']);
});
test('asynchronous page rejection is handled and reported once', async () => {
  let rejectLoad;
  const pending = new Promise((_,reject)=>{rejectLoad=reject;}), h = fixture(()=>pending);
  h.ability.onWindowStageCreate(h.stage);
  assert.deepEqual(h.errors, []);
  rejectLoad(Object.assign(Error('invalid page'), {code:401})); await tick();
  assert.deepEqual(h.errors, ['LANTERN page load failed: 401']);
});
