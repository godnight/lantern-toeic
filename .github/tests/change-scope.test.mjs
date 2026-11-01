import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, unlinkSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync, spawnSync} from 'node:child_process';
import test from 'node:test';
import {classifyChanges, planForEvent, versionOnly} from '../scripts/change-scope.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const change = (path, status = 'M') => ({path, status});
const classify = paths => classifyChanges(paths.map(path => change(path)), () => { throw Error('unexpected metadata read'); });
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'lantern-ci-scope-'));
  t.after(() => rmSync(cwd, {recursive: true, force: true}));
  const git = (...args) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  git('init', '-q'); git('config', 'user.name', 'CI fixture'); git('config', 'user.email', 'ci@example.invalid');
  const write = (path, value) => { mkdirSync(dirname(join(cwd, path)), {recursive: true}); writeFileSync(join(cwd, path), value); };
  const commit = () => { git('add', '-A'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  write('README.md', 'base'); const initial = commit();
  const run = (base, head = git('rev-parse', 'HEAD')) => planForEvent({cwd, eventName: 'pull_request', event: {pull_request: {base: {sha: base}, head: {sha: head}}}});
  return {cwd, git, write, commit, initial, run};
}

test('docs and workflow-only changes skip product checks; mixed UI/tooling keeps both checks', () => {
  assert.equal(classify(['README.md', 'docs/releases/current.md', '.github/pull_request_template.md']).level, 'docs');
  assert.equal(classify(['.github/workflows/core.yml']).level, 'tooling');
  const ui = classify(['app/learn/today-dashboard.tsx', 'app/learn/ui-theme.css', '.github/workflows/core.yml']);
  assert.equal(ui.level, 'ui'); assert.equal(ui.ui, true); assert.equal(ui.tooling, true); assert.equal(ui.harmony, false);
});

test('only the known theme browser test and isolated signing tools select targeted tooling checks', () => {
  const targeted = classify(['tests/browser/theme-browser.cjs', 'tools/harmony-release/verify_request.py']);
  assert.equal(targeted.level, 'tooling'); assert.equal(targeted.theme_web, true); assert.equal(targeted.signing, true); assert.equal(targeted.harmony, false);
  const mixedUi = classify(['tests/browser/theme-browser.cjs', 'tools/harmony-release/test_entrypoint.py', 'app/learn/today-dashboard.tsx']);
  assert.equal(mixedUi.ui, true); assert.equal(mixedUi.theme_web, true); assert.equal(mixedUi.signing, true);
  const mixedRisk = classify(['tests/browser/theme-browser.cjs', 'tools/harmony-release/test_entrypoint.py', 'lib/auth.ts']);
  assert.equal(mixedRisk.full, true); assert.equal(mixedRisk.theme_web, false, 'full already includes Web theme coverage'); assert.equal(mixedRisk.signing, true);
  for (const path of ['tests/browser/unknown.cjs', 'tests/recording-player.test.cjs', 'tools/unknown.py']) assert.equal(classify([path]).full, true, path);
  for (const status of ['D', 'T', 'A']) assert.equal(classifyChanges([change('tests/browser/theme-browser.cjs', status)]).full, true, status);
});

test('unknown, audio/auth/data/dependency paths and runtime deletions require full checks', () => {
  for (const path of ['unknown.txt', 'docs/run.py', '.github/scripts/unknown.py', 'lib/pcm-recorder.ts', 'lib/auth.ts', 'drizzle/0001.sql', 'package-lock.json', 'harmony/entry/src/main/ets/entryability/EntryAbility.ets']) {
    assert.equal(classify([path, 'README.md']).full, true, path);
  }
  assert.equal(classifyChanges([change('app/learn/today-dashboard.tsx', 'D')]).full, true);
  assert.equal(classifyChanges([change('app/globals.css', 'D')]).harmony, true);
  assert.equal(classifyChanges([change('app/globals.css', 'T')]).full, true);
});

test('version-only changes use semantic comparison; AppScope permissions/identity cannot hide behind version bumps', () => {
  const app = {app: {bundleName: 'com.lantern.toeic', versionName: '0.4.5', versionCode: 20059, icon: '$media:app_icon'}};
  const bumped = structuredClone(app); bumped.app.versionCode++;
  const check = next => versionOnly('harmony/AppScope/app.json5', JSON.stringify(app), JSON.stringify(next));
  assert.equal(check(bumped), true);
  for (const mutate of [next => { next.app.bundleName = 'other'; }, next => { next.app.versionName = '0.5.0'; }, next => { next.app.versionCode = 20058; }, next => { next.app.permissions = ['camera']; }, next => { next.extra = true; }]) {
    const next = structuredClone(bumped); mutate(next); assert.equal(check(next), false);
  }
  assert.equal(versionOnly('harmony/AppScope/app.json5', '{broken', JSON.stringify(app)), false);
  const ui = classifyChanges([change('harmony/AppScope/app.json5'), change('app/learn/today-dashboard.tsx')], () => [JSON.stringify(app), JSON.stringify(bumped)]);
  assert.equal(ui.level, 'ui'); assert.equal(ui.harmony, false);
});

test('release and package metadata allow patch-only version changes, never dependency or release behavior changes', () => {
  const manifest = {version: '0.4.5', prerelease: true, notes: 'docs/releases/a.md', qa: 'docs/testing/a.md', nativeHapAvailable: false};
  const check = after => versionOnly('release-manifest.json', JSON.stringify(manifest), JSON.stringify({...manifest, ...after}));
  assert.equal(check({version: '0.4.6', notes: 'docs/releases/b.md'}), true);
  for (const after of [{version: '1.0.0'}, {nativeHapAvailable: true}, {qa: '../secret.md'}, {prerelease: false}]) assert.equal(check(after), false);
  const before = {version: '0.4.5', dependencies: {react: '19'}};
  assert.equal(versionOnly('package.json', JSON.stringify(before), JSON.stringify({...before, version: '0.4.6'})), true);
  assert.equal(versionOnly('package.json', JSON.stringify(before), JSON.stringify({...before, dependencies: {react: '20'}})), false);
});

test('generated build identity metadata must retain its schema and release line', () => {
  const before = {schemaVersion: 1, buildId: 'r12', sourceInputsSha256: 'a'.repeat(64), inputCount: 14, excludedSelf: 'public/build-identity.json', versionName: '0.4.5', versionCode: 20059};
  const check = after => versionOnly('public/build-identity.json', JSON.stringify(before), JSON.stringify({...before, ...after}));
  assert.equal(check({buildId: 'r13', sourceInputsSha256: 'b'.repeat(64), inputCount: 15, versionCode: 20060}), true);
  for (const after of [{schemaVersion: 2}, {sourceInputsSha256: 'not-a-hash'}, {versionName: '1.0.0'}, {extraRuntimeFlag: true}]) assert.equal(check(after), false);
});

test('PR uses cumulative merge-base diff even after a docs-only final commit and advancing base', t => {
  const repo = fixture(t);
  repo.git('checkout', '-qb', 'feature'); repo.write('lib/pcm-recorder.ts', 'changed audio'); repo.commit();
  repo.write('README.md', 'last commit only docs'); const head = repo.commit();
  repo.git('checkout', '--detach', repo.initial); repo.write('docs/base.md', 'base advanced'); const base = repo.commit();
  const result = repo.run(base, head);
  assert.equal(result.mergeBase, repo.initial); assert.equal(result.changedFiles, 2); assert.equal(result.full, true);
});

test('renaming risky code into docs retains the old-path deletion; deleting runtime code is not docs-only', t => {
  const repo = fixture(t); repo.write('lib/auth.ts', 'private source'); const base = repo.commit();
  mkdirSync(join(repo.cwd, 'docs')); renameSync(join(repo.cwd, 'lib/auth.ts'), join(repo.cwd, 'docs/auth.md')); repo.commit();
  assert.equal(repo.run(base).full, true);
  repo.git('reset', '--hard', base); unlinkSync(join(repo.cwd, 'lib/auth.ts')); repo.commit();
  assert.equal(repo.run(base).full, true);
});

test('a real UI plus version-only PR takes the fast path', t => {
  const repo = fixture(t);
  const app = {app: {bundleName: 'com.lantern.toeic', versionName: '0.4.5', versionCode: 20059}};
  repo.write('harmony/AppScope/app.json5', JSON.stringify(app)); repo.write('app/learn/today-dashboard.tsx', 'old button'); const base = repo.commit();
  app.app.versionCode++; repo.write('harmony/AppScope/app.json5', JSON.stringify(app)); repo.write('app/learn/today-dashboard.tsx', 'new button'); repo.commit();
  assert.equal(repo.run(base).level, 'ui');
});

test('missing base, unavailable history, main push and manual runs all choose full checks', t => {
  const repo = fixture(t);
  for (const eventName of ['push', 'workflow_dispatch', 'unknown', 'pull_request']) assert.equal(planForEvent({cwd: repo.cwd, eventName, event: {}}).full, true);
  assert.equal(repo.run('a'.repeat(40)).full, true);
});

test('malformed event/classification failure fails the command without writing successful skip outputs', t => {
  const repo = fixture(t), eventPath = join(repo.cwd, 'event.json'), output = join(repo.cwd, 'output');
  writeFileSync(eventPath, '{broken'); writeFileSync(output, '');
  const result = spawnSync(process.execPath, [join(root, '.github/scripts/change-scope.mjs')], {cwd: repo.cwd, env: {...process.env, GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: output}, encoding: 'utf8'});
  assert.notEqual(result.status, 0); assert.equal(readFileSync(output, 'utf8'), '');
  assert.throws(() => classifyChanges([change('harmony/AppScope/app.json5')], () => { throw Error('git show failed'); }), /git show failed/);
});


test('word-card presentation and its data stay targeted while workflow mutations and deletions remain full', () => {
  const paths = ['app/learn/vocabulary-plan.tsx', 'app/learn/v041-vocabulary.css', 'app/learn/word-card-reference.ts', 'content/word-card-reference.json', 'content/word-card-phonetic-supplement.json', 'scripts/build-word-card-reference.py', 'tests/phase2-vocabulary-ui.test.cjs', 'tests/browser/word-card-layout.cjs', 'tests/browser/word-card-layout.fixture.jsx'];
  for (const status of ['A', 'M']) {
    const result = classifyChanges(paths.map(path => change(path, status)));
    assert.equal(result.level, 'ui'); assert.equal(result.vocabulary_ui, true);
    assert.equal(result.full, false); assert.equal(result.harmony, false); assert.equal(result.ui, false);
  }
  for (const status of ['D', 'T']) assert.equal(classifyChanges([change(paths[0], status)]).full, true);
  for (const risky of ['lib/vocabulary-workflow.ts', 'lib/use-vocabulary-workflow.ts', 'content/word-card-unknown.json']) {
    const result = classify([...paths, risky]); assert.equal(result.full, true); assert.equal(result.vocabulary_ui, false);
  }
  const mixed = classify([paths[0], 'app/learn/today-dashboard.tsx', '.github/workflows/core.yml']);
  assert.equal(mixed.vocabulary_ui, true); assert.equal(mixed.ui, true); assert.equal(mixed.tooling, true);
});
