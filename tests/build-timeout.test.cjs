// Pure VM tests: never spawn a real build, taskkill, shell, or device command.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const {fileURLToPath, pathToFileURL} = require('node:url');
const {test} = require('node:test');

const target = path.resolve(process.argv[2] || path.join(__dirname, '../scripts/build-verified.mjs'));
const source = fs.readFileSync(target, 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(target).href));

function harness(options = {}) {
  let now = 0, sequence = 0;
  const pending = new Map();
  const messages = [], calls = [], exits = [];
  const child = new EventEmitter();
  child.pid = 12345;
  child.kills = [];
  child.unref = () => { child.unreferenced = true; };
  child.kill = signal => {
    child.kills.push(signal);
    if (options.killThrows) throw new Error('simulated kill failure');
    if (options.killExits) child.emit('exit', null, signal);
    return !options.killReturnsFalse;
  };
  const killer = new EventEmitter();
  killer.unref = () => { killer.unreferenced = true; };
  const process = {platform: options.platform || 'win32', execPath: 'node.exe', env: {},
    exitCode: undefined, exit: code => exits.push(code)};
  const setTimeout = (callback, duration) => {
    const id = ++sequence;
    pending.set(id, {callback, due: now + duration});
    return id;
  };
  const advance = duration => {
    const end = now + duration;
    for (;;) {
      const next = [...pending].sort((a, b) => a[1].due - b[1].due)[0];
      if (!next || next[1].due > end) break;
      pending.delete(next[0]);
      now = next[1].due;
      next[1].callback();
    }
    now = end;
  };
  vm.runInNewContext(source, {path, fileURLToPath, existsSync: () => true, process,
    console: {error: message => messages.push(message)}, setTimeout,
    clearTimeout: id => pending.delete(id),
    spawn: (command, args, spawnOptions) => {
      calls.push({command, args, options: spawnOptions});
      if (calls.length === 1) return child;
      if (options.spawnThrows) throw new Error('simulated taskkill spawn failure');
      return killer;
    }}, {filename: target});
  return {child, killer, process, advance, calls, messages, pending, exits};
}

function assertBoundedFailure(h) {
  h.advance(10_000);
  assert.deepEqual(h.exits, [124], 'watchdog must force exit 124 when build never exits');
  assert.equal(h.process.exitCode, 124);
  assert.ok(h.messages.some(message => message.includes('NOT CONFIRMED')));
}

test('Linux retains the existing Bash build wrapper and no new timer', () => {
  const h = harness({platform: 'linux'});
  assert.equal(h.calls[0].command, 'bash');
  assert.equal(h.calls[0].args[0], 'scripts/build-verified.sh');
  assert.equal(h.pending.size, 0);
});
test('Windows uses Node and the 180 second deadline', () => {
  const h = harness();
  assert.equal(h.calls[0].command, 'node.exe');
  assert.match(h.calls[0].args[0], /node_modules[\\/]vinext[\\/]dist[\\/]cli\.js$/);
  assert.equal(h.calls[0].args[1], 'build');
  h.advance(179_999);
  assert.equal(h.calls.length, 1);
  h.advance(1);
  assert.equal(h.calls[1].command, 'taskkill.exe');
  assert.equal(h.calls[1].args.join(' '), '/PID 12345 /T /F');
});
test('successful build clears all timers and preserves exit zero', () => {
  const h = harness(); h.child.emit('exit', 0, null); h.advance(200_000);
  assert.equal(h.process.exitCode, 0); assert.equal(h.calls.length, 1);
  assert.equal(h.pending.size, 0);
});
test('build failure preserves its nonzero exit code', () => {
  const h = harness(); h.child.emit('exit', 7, null);
  assert.equal(h.process.exitCode, 7); assert.equal(h.pending.size, 0);
});
test('build spawn error exits one without a timeout', () => {
  const h = harness(); h.child.emit('error', new Error('build spawn failed'));
  assert.equal(h.process.exitCode, 1); assert.equal(h.pending.size, 0);
});
test('taskkill error falls back to SIGKILL and remains bounded', () => {
  const h = harness(); h.advance(180_000);
  h.killer.emit('error', new Error('taskkill unavailable'));
  assert.deepEqual(h.child.kills, ['SIGKILL']); assertBoundedFailure(h);
});
test('taskkill nonzero exit falls back; confirmed child exit clears watchdog', () => {
  const h = harness({killExits: true}); h.advance(180_000); h.killer.emit('exit', 1, null);
  assert.deepEqual(h.child.kills, ['SIGKILL']); assert.equal(h.process.exitCode, 124);
  assert.equal(h.pending.size, 0); h.advance(10_000); assert.deepEqual(h.exits, []);
});
test('hung taskkill falls back after five seconds then force exits', () => {
  const h = harness(); h.advance(180_000); h.advance(4_999);
  assert.deepEqual(h.child.kills, []); h.advance(1);
  assert.deepEqual(h.child.kills, ['SIGKILL']); assertBoundedFailure(h);
});
test('taskkill success without build exit does not disable the watchdog', () => {
  const h = harness(); h.advance(180_000); h.killer.emit('exit', 0, null);
  assertBoundedFailure(h); assert.deepEqual(h.child.kills, ['SIGKILL']);
});
test('SIGKILL throw is reported and final exit still occurs', () => {
  const h = harness({killThrows: true}); h.advance(180_000); h.killer.emit('exit', 1, null);
  assertBoundedFailure(h); assert.ok(h.messages.some(message => message.includes('SIGKILL failed')));
});
test('SIGKILL false is reported and final exit still occurs', () => {
  const h = harness({killReturnsFalse: true}); h.advance(180_000); h.killer.emit('exit', 1, null);
  assertBoundedFailure(h); assert.ok(h.messages.some(message => message.includes('did not confirm delivery')));
});
test('synchronous taskkill spawn failure cannot bypass the watchdog', () => {
  const h = harness({spawnThrows: true}); h.advance(180_000);
  assert.deepEqual(h.child.kills, ['SIGKILL']); assertBoundedFailure(h);
});
test('cleanup helper cannot keep wrapper alive after timed-out build exits', () => {
  const h = harness(); h.advance(180_000); h.child.emit('exit', 0, null);
  assert.equal(h.killer.unreferenced, true); assert.equal(h.process.exitCode, 124);
  assert.equal(h.pending.size, 0);
});
test('duplicate taskkill failure events trigger only one fallback', () => {
  const h = harness(); h.advance(180_000);
  h.killer.emit('error', new Error('failed')); h.killer.emit('exit', 1, null);
  assert.deepEqual(h.child.kills, ['SIGKILL']); assertBoundedFailure(h);
});
test('child error during cleanup is not mistaken for a confirmed exit', () => {
  const h = harness(); h.advance(180_000); h.child.emit('error', new Error('cleanup error'));
  assertBoundedFailure(h);
});
