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
  const errors = [], exports = {}, themeEvents = [], storageEvents = [], mainWindow = {};
  const themeWindow = {
    clearWindow: () => themeEvents.push(['clearWindow']),
    setForeground: value => themeEvents.push(['setForeground', value]),
    setReadyWindow: value => themeEvents.push(['setReadyWindow', value]),
  };
  const imports = {'@kit.AbilityKit':{UIAbility:class {}}, '@kit.ArkUI':{}, '@kit.BasicServicesKit':{}, '../theme/ThemeWindow':{themeWindow}};
  vm.runInNewContext(code, {exports,require:name=>imports[name],AppStorage:{setOrCreate:(...args)=>storageEvents.push(args)},console:{error:message=>errors.push(message),warn:message=>errors.push(message)},setTimeout,clearTimeout});
  return {ability:new exports.default(),stage:{loadContent,getMainWindowSync:()=>mainWindow},errors,themeEvents,storageEvents,mainWindow};
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
test('theme window binds only after loading and follows ability lifecycle', async () => {
  let finishLoad;
  const pending = new Promise(resolve => { finishLoad = resolve; });
  const h = fixture(() => pending);
  h.ability.onCreate();
  h.ability.onWindowStageCreate(h.stage);
  h.ability.onForeground();
  assert.deepEqual(h.themeEvents, [['setForeground', false], ['clearWindow'], ['setForeground', true]]);
  finishLoad(); await tick();
  assert.deepEqual(h.themeEvents.at(-1), ['setReadyWindow', h.mainWindow]);
  h.ability.onBackground();
  h.ability.onWindowStageDestroy();
  h.ability.onDestroy();
  assert.deepEqual(h.themeEvents.slice(-4), [['setForeground', false], ['clearWindow'], ['setForeground', false], ['clearWindow']]);
  assert.deepEqual(h.storageEvents, [['lanternForeground', false], ['lanternForeground', true], ['lanternForeground', false], ['lanternForeground', false]]);
  assert.deepEqual(h.errors, []);
});
