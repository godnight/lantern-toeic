// A stale lock is deliberately never stolen. The directory must already be a
// trusted, private canonical directory; production validates it separately.
import { open, lstat, realpath, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

async function syncDirectory(dir) {
  if (process.platform !== 'linux') return;
  const fd = await open(dir, 'r'); try { await fd.sync(); } finally { await fd.close(); }
}
export async function acquireD1Lock(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir) || await realpath(dir) !== dir) throw Error('invalid lock directory');
  const before = await lstat(dir); if (!before.isDirectory() || before.isSymbolicLink()) throw Error('invalid lock directory');
  const file = path.join(dir, 'lantern-d1.lock'), token = randomBytes(32).toString('hex');
  const fd = await open(file, 'wx', 0o600); let stat;
  try { await fd.writeFile(token); await fd.sync(); stat = await fd.stat(); await syncDirectory(dir); }
  finally { await fd.close(); }
  let released = false;
  return async () => {
    if (released) return;
    const root = await lstat(dir), current = await lstat(file);
    if (!root.isDirectory() || root.isSymbolicLink() || root.dev !== before.dev || root.ino !== before.ino ||
        !current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || current.dev !== stat.dev || current.ino !== stat.ino) throw Error('lock ownership changed');
    const locked = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try { const opened = await locked.stat(); if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.nlink !== 1 || await locked.readFile('utf8') !== token) throw Error('lock ownership changed'); }
    finally { await locked.close(); }
    await unlink(file); await syncDirectory(dir); released = true;
  };
}

// Internal trusted lifecycle: callbacks are fixed by the owning launcher, not
// by HTTP or settings. Failed startup without an obtained runtime keeps lock.
export async function openLockedD1({ lockDir, openRuntime, prepareService } = {}) {
  if (typeof openRuntime !== 'function' || typeof prepareService !== 'function') throw Error('invalid runtime factory');
  const release = await acquireD1Lock(lockDir); let runtime, service, closing;
  try {
    runtime = await openRuntime();
    if (!runtime || typeof runtime.dispose !== 'function') throw Error('invalid runtime');
    service = await prepareService(runtime);
    if (!service || typeof service.close !== 'function') throw Error('invalid service');
    return Object.freeze({ service, close() { if (!closing) closing = (async () => { await service.close(); await runtime.dispose(); await release(); })(); return closing; } });
  } catch (error) {
    if (runtime && typeof runtime.dispose === 'function') { try { if (service?.close) await service.close(); await runtime.dispose(); await release(); } catch { throw Error('startup cleanup failed; lock retained'); } }
    throw error;
  }
}
