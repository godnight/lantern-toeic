import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { validateRunnerConfig, readRunnerConfig } from './runner-config.candidate.mjs';
import { manageRunner } from './runner-lifecycle.candidate.mjs';
import { acquireD1Lock, openLockedD1 } from './d1-lock.candidate.mjs';
import { buildAccountWorker } from './build-inputs.mjs';

const config = () => ({ enabled: true, origin: 'https://account.synthetic.test', bindAddress: '10.3.4.5',
  lockDir: path.resolve('synthetic-private-d1'), certRoot: path.resolve('synthetic-certificates'), slot: 'active' });
test('runner is closed by default and accepts only exact protected configuration', async () => {
  assert.deepEqual(validateRunnerConfig(config()), config());
  for (const change of [{ enabled: false }, { origin: 'http://account.synthetic.test' }, { bindAddress: '0.0.0.0' }, { slot: '../other' }, { lockDir: 'relative' }, { syncEnabled: true }, { phoneEnabled: true }]) assert.throws(() => validateRunnerConfig({ ...config(), ...change }));
  await assert.rejects(readRunnerConfig({ file: path.resolve('nonexistent-config') }), /disabled/);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./run-controlled.candidate.mjs', import.meta.url))], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /explicit enable/);
});
test('stop during startup waits for real synthetic D1 then disposes and releases lock once', { timeout: 60000 }, async () => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'lantern-runner-test-'))), events = new EventEmitter();
  let allow, entered, closed = 0; const gate = new Promise(resolve => { allow = resolve; }), started = new Promise(resolve => { entered = resolve; });
  try {
    const worker = await buildAccountWorker();
    const runner = manageRunner({ enabled: true, events, onError: error => { throw error; }, start: async () => {
      const locked = await openLockedD1({ lockDir: dir, openRuntime: async () => {
        const mf = new Miniflare({ modules: true, script: worker.bytes.toString(), compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
          cf: false, host: '127.0.0.1', port: 0, d1Databases: ['DB'], d1Persist: path.join(dir, 'd1'),
          bindings: { LANTERN_AUTH_ENABLED: 'true', LANTERN_AUTH_ORIGIN: 'https://account.synthetic.test' }, outboundService: () => new Response(null, { status: 403 }), log: new Log(LogLevel.ERROR) });
        const db = await mf.getD1Database('DB'); await db.prepare('CREATE TABLE synthetic_marker(id INTEGER PRIMARY KEY)').run(); return mf;
      }, prepareService: async () => ({ async close() { closed++; } }) });
      entered(); await gate; return locked;
    } });
    await started; await assert.rejects(acquireD1Lock(dir));
    events.emit('SIGUSR2'); events.emit('SIGUSR2'); assert.equal(runner.requested, true);
    const stop = runner.stop(); await new Promise(resolve => setImmediate(resolve)); assert.equal(closed, 0);
    allow(); await runner.started; await stop; assert.equal(closed, 1); assert.equal(events.listenerCount('SIGUSR2'), 0);
    const release = await acquireD1Lock(dir); await release();
  } finally {
    allow(); const absolute = await realpath(dir), tmp = await realpath(os.tmpdir());
    if (path.dirname(absolute) !== tmp || !path.basename(absolute).startsWith('lantern-runner-test-')) throw Error('unsafe test directory');
    await rm(absolute, { recursive: true, force: true });
  }
});
test('startup and shutdown errors are reported without repeatedly closing', async () => {
  const events = new EventEmitter(), errors = [];
  const runner = manageRunner({ enabled: true, events, onError: error => errors.push(error), start: async () => ({ async close() { throw Error('dispose failed'); } }) });
  await runner.started; events.emit('SIGUSR2'); await assert.rejects(runner.stop(), /dispose failed/);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(errors.length, 1); assert.equal(events.listenerCount('SIGUSR2'), 0);
  const failedEvents = new EventEmitter(), failed = manageRunner({ enabled: true, events: failedEvents, onError() {}, start: async () => { throw Error('start failed'); } });
  await assert.rejects(failed.started, /start failed/); assert.equal(failedEvents.listenerCount('SIGUSR2'), 0);
});
