// Test-only HTTPS process. Never starts without a specifically marked test
// directory directly under the OS temporary directory and an IPC parent.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { pathToFileURL } from 'node:url';
import { createSyntheticSqliteD1 } from './synthetic-sqlite-d1.candidate.mjs';
import { openLockedD1 } from './d1-lock.candidate.mjs';
import { verifyAccountDatabase } from './account-db-preflight.candidate.mjs';
import { prepareCloudService } from './service.candidate.mjs';

const origin = 'https://synthetic.invalid';
const dir = process.argv[2] && realpathSync.native(process.argv[2]);
if (!process.send || !dir || path.dirname(dir) !== realpathSync.native(os.tmpdir()) ||
    !path.basename(dir).startsWith('lantern-node-runtime-') ||
    readFileSync(path.join(dir, 'SYNTHETIC-ONLY'), 'utf8') !== 'lantern-node-runtime-v1\n') throw Error('synthetic runtime fixture required');

async function main() {
  const filename = path.join(dir, 'synthetic-only.sqlite');
  const st = lstatSync(filename);
  if (!st.isFile() || st.isSymbolicLink() || realpathSync.native(filename) !== filename) throw Error('synthetic database required');
  const worker = (await import(pathToFileURL(path.join(dir, 'synthetic-worker.mjs')).href)).default;
  const locked = await openLockedD1({ lockDir: dir,
    openRuntime: async () => {
      const sqlite = new DatabaseSync(filename, { timeout: 3000 });
      try {
        sqlite.exec('PRAGMA foreign_keys=ON');
        const db = createSyntheticSqliteD1({ enabled: true, database: sqlite });
        return { db, async dispose() { sqlite.close(); } };
      } catch (error) { sqlite.close(); throw error; }
    },
    prepareService: async runtime => {
      await verifyAccountDatabase(runtime.db);
      const env = { DB: runtime.db, LANTERN_AUTH_ENABLED: 'true', LANTERN_AUTH_ORIGIN: origin };
      const mf = { dispatchFetch(url, init) { return worker.fetch(new Request(url, init), env); } };
      return prepareCloudService({ enabled: true, mf, origin });
    },
  });
  let server;
  try {
    server = https.createServer({ key: readFileSync(path.join(dir, 'synthetic-key.pem')), cert: readFileSync(path.join(dir, 'synthetic-cert.pem')), minVersion: 'TLSv1.2' }, locked.service.handler);
    server.on('tlsClientError', () => {});
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  } catch (error) { await locked.close(); throw error; }
  const address = server.address();
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
    await new Promise(resolve => server.close(resolve));
    await locked.close();
    throw Error('loopback required');
  }
  process.send({ ready: true, address: address.address, port: address.port });
  let stopping;
  process.on('message', message => {
    if (message !== 'stop' || stopping) return;
    stopping = (async () => {
      await new Promise(resolve => server.close(resolve));
      await locked.close();
      process.send({ stopped: true });
      process.disconnect();
    })().catch(() => { process.exitCode = 1; process.disconnect(); });
  });
}
main().catch(() => { if (process.connected) { process.send({ ready: false }); process.disconnect(); } process.exitCode = 1; });
