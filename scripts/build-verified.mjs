import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Keep the established Linux CI environment and its process-group timeout.
const windows = process.platform === 'win32';
const cli = path.join(root, 'node_modules/vinext/dist/cli.js');
if (windows && !existsSync(cli)) throw new Error('Install the locked root dependencies before building.');
const child = spawn(windows ? process.execPath : 'bash', windows ? [cli, 'build'] : ['scripts/build-verified.sh'], {
  cwd: root, stdio: 'inherit', windowsHide: true,
  env: {...process.env, WRANGLER_LOG_PATH: path.join(root, '.wrangler/wrangler.log')},
});
let timedOut = false;
let childExited = false;
let fallbackStarted = false;
let fallbackTimer;
let watchdog;

function stopChild(reason) {
  if (childExited || fallbackStarted) return;
  fallbackStarted = true;
  clearTimeout(fallbackTimer);
  console.error(`${reason}; falling back to SIGKILL for the build process. Descendant termination is not confirmed.`);
  try {
    if (!child.kill('SIGKILL')) console.error('SIGKILL did not confirm delivery; waiting for the exit watchdog.');
  } catch (error) {
    console.error(`SIGKILL failed: ${error.message}`);
  }
}

const timer = windows ? setTimeout(() => {
  timedOut = true;
  process.exitCode = 124;
  console.error('Web build exceeded 180 seconds; stopping its process tree.');
  // A failed or stalled taskkill must not leave the build wrapper running forever.
  watchdog = setTimeout(() => {
    console.error('Build process tree termination is NOT CONFIRMED. Exiting 124 after the cleanup deadline; manual process cleanup may be required.');
    child.unref();
    process.exit(124);
  }, 10_000);
  fallbackTimer = setTimeout(() => stopChild('No build exit received within 5 seconds of taskkill'), 5_000);
  try {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {stdio: 'ignore', windowsHide: true});
    killer.once('error', error => stopChild(`taskkill could not run: ${error.message}`));
    killer.once('exit', (code, signal) => {
      if (code !== 0) stopChild(`taskkill failed (${signal || code})`);
    });
    // A stalled cleanup helper must not keep this wrapper alive after build exit.
    killer.unref();
  } catch (error) {
    stopChild(`taskkill could not start: ${error.message}`);
  }
}, 180_000) : undefined;

child.on('error', error => {
  console.error(error.message);
  if (!timedOut) {
    clearTimeout(timer);
    process.exitCode = 1;
  }
  // An error during cleanup is not proof of exit; retain the watchdog.
});
child.on('exit', (code, signal) => {
  childExited = true;
  clearTimeout(timer);
  clearTimeout(fallbackTimer);
  clearTimeout(watchdog);
  process.exitCode = timedOut ? 124 : code ?? (signal ? 1 : 0);
});
