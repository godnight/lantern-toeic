// Account-only native SQLite startup candidate; never imported by the App or
// enabled by default. It requires a root-controlled pinned Worker/config,
// private existing DB, cooperative lock, and the protected HTTPS gateway.
// Node 24.13.1 node:sqlite is experimental and synchronous: this is not a
// production readiness or crash-recovery claim.
import { DatabaseSync } from 'node:sqlite';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createSqliteD1Core } from './sqlite-d1-core.candidate.mjs';
import { verifyAccountDatabase } from './account-db-preflight.candidate.mjs';
import { readNativeAccountConfig, loadNativeAccountWorker, loadNativeHuaweiBindings } from './native-account-config.candidate.mjs';
import { createNativeHuaweiOutbound } from './native-huawei-outbound.candidate.mjs';
import { openLockedD1 } from './d1-lock.candidate.mjs';
import { prepareCloudService } from './service.candidate.mjs';
import { startProductionGateway } from './https-gateway.candidate.mjs';

export function isPrivateAccountStat(st, uid, gid, directory) {
  return !!st && Number.isInteger(uid) && uid > 0 && Number.isInteger(gid) && gid > 0 &&
    st.uid === uid && st.gid === gid && (st.mode & 0o7777) === (directory ? 0o700 : 0o600) && (directory || st.nlink === 1);
}

// No migrations or repairs. Caller owns connection, data directory and lock.
export async function verifyNativeAccountDatabase(database) {
  if (!(database instanceof DatabaseSync) || !database.isOpen) throw Error('account database unavailable');
  const foreignKeys = database.prepare('PRAGMA foreign_keys').get();
  const mode = database.prepare('PRAGMA journal_mode').get();
  if (foreignKeys?.foreign_keys !== 1 || String(mode?.journal_mode).toLowerCase() !== 'wal') throw Error('unsafe account database mode');
  const integrity = database.prepare('PRAGMA quick_check').all();
  if (integrity.length !== 1 || integrity[0]?.quick_check !== 'ok' || database.prepare('PRAGMA foreign_key_check').get()) throw Error('account integrity check failed');
  const db = createSqliteD1Core({ enabled: true, database });
  await verifyAccountDatabase(db);
  return db;
}

async function privateDirectory(dir) {
  if (process.platform !== 'linux' || process.versions.node !== '24.13.1' || typeof process.geteuid !== 'function' || process.geteuid() === 0 ||
      typeof dir !== 'string' || !path.isAbsolute(dir) || path.resolve(dir) !== dir || await realpath(dir) !== dir) throw Error('private non-root Linux account runtime required');
  const uid = process.geteuid(), gid = process.getgid(), st = await lstat(dir);
  if (!st.isDirectory() || st.isSymbolicLink() || !isPrivateAccountStat(st, uid, gid, true)) throw Error('unsafe account directory');
  let parent = path.dirname(dir);
  for (;;) {
    const item = await lstat(parent);
    if (!item.isDirectory() || item.isSymbolicLink() || (item.uid !== 0 && item.uid !== uid) || (item.mode & 0o022)) throw Error('unsafe account directory ancestor');
    const next = path.dirname(parent); if (next === parent) break; parent = next;
  }
  return st;
}

async function privateFile(file, optional = false) {
  let st;
  try { st = await lstat(file); } catch (error) { if (optional && error?.code === 'ENOENT') return null; throw error; }
  if (!st.isFile() || st.isSymbolicLink() || !isPrivateAccountStat(st, process.geteuid(), process.getgid(), false) || await realpath(file) !== file) throw Error('unsafe account database file');
  return st;
}
async function inspectFiles(file) {
  const main = await privateFile(file);
  if (main.size === 0) throw Error('existing account database required');
  for (const suffix of ['-wal', '-shm', '-journal']) await privateFile(file + suffix, true);
  return main;
}
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.uid === b.uid && a.gid === b.gid && a.mode === b.mode && a.nlink === b.nlink;

async function openVerifiedAccountDatabase(dir) {
  await privateDirectory(dir);
  const file = path.join(dir, 'account.sqlite'), before = await inspectFiles(file);
  let readonly;
  try {
    readonly = new DatabaseSync(file, { readOnly: true, timeout: 0, allowExtension: false, defensive: true });
    readonly.exec('PRAGMA foreign_keys=ON');
    await verifyNativeAccountDatabase(readonly);
  } finally { readonly?.close(); }
  const checked = await inspectFiles(file);
  if (!sameFile(before, checked) || before.size !== checked.size || before.mtimeMs !== checked.mtimeMs) throw Error('account database changed during preflight');
  const writable = new DatabaseSync(file, { timeout: 0, allowExtension: false, defensive: true });
  try {
    writable.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL');
    const d1 = await verifyNativeAccountDatabase(writable), current = await inspectFiles(file);
    if (!sameFile(checked, current)) throw Error('account database changed during opening');
    return { d1, close() { writable.close(); } };
  } catch (error) { writable.close(); throw error; }
}

export async function startNativeAccountGateway({ enabled = false, file } = {}) {
  if (enabled !== true) throw Error('native account candidate disabled');
  const config = await readNativeAccountConfig({ enabled: true, file });
  const directory = await privateDirectory(config.lockDir);
  const locked = await openLockedD1({ lockDir: config.lockDir,
    // Return the owner before any database work so failed preflight can be
    // safely closed and the cooperative lock released.
    openRuntime: async () => {
      let connection;
      return {
        async open() {
          const current = await privateDirectory(config.lockDir);
          if (current.dev !== directory.dev || current.ino !== directory.ino) throw Error('account directory changed');
          connection = await openVerifiedAccountDatabase(config.lockDir);
          return connection.d1;
        },
        async dispose() { if (connection) { connection.close(); connection = undefined; } },
      };
    },
    prepareService: async runtime => {
      const huawei = await loadNativeHuaweiBindings(config);
      const db = await runtime.open(), worker = await loadNativeAccountWorker(config);
      const env = { DB: db, LANTERN_AUTH_ENABLED: 'true', LANTERN_AUTH_ORIGIN: config.origin,
        ...(huawei ? { ...huawei, LANTERN_HUAWEI_OUTBOUND: createNativeHuaweiOutbound({ enabled: true, clientId: huawei.LANTERN_HUAWEI_CLIENT_ID }) } : {}) };
      const mf = { dispatchFetch(url, init) { return worker.fetch(new Request(url, init), env); } };
      return prepareCloudService({ enabled: true, mf, origin: config.origin, directCredentialPolicy: config.directCredentialPolicy });
    },
  });
  let gateway;
  try { gateway = await startProductionGateway({ enabled: true, origin: config.origin, certRoot: config.certRoot, slot: config.slot, bindAddress: config.bindAddress, service: locked.service }); }
  catch (error) { await locked.close(); throw error; }
  let closing;
  return Object.freeze({ close() { if (!closing) closing = (async () => { await gateway.close(); await locked.close(); })(); return closing; } });
}
