// Production-only socket activation path. No implicit listener, CA or key.
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import tls from 'node:tls';
import os from 'node:os';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { validDomainOrigin, isRootManagedCertificateStat } from './domain-policy.candidate.mjs';

function readProtectedFile(dir, name, gid) {
  const file = path.join(dir, name), before = fs.lstatSync(file);
  const valid = st => st.isFile() && !st.isSymbolicLink() && st.size > 0 && st.size <= 131072 && isRootManagedCertificateStat(st, gid, false);
  if (!valid(before)) throw Error('unsafe certificate file');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd), current = fs.lstatSync(file);
    if (!valid(opened) || !valid(current) || opened.dev !== before.dev || opened.ino !== before.ino || current.dev !== opened.dev || current.ino !== opened.ino) throw Error('certificate file changed');
    const data = fs.readFileSync(fd), after = fs.fstatSync(fd);
    if (data.length !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw Error('certificate file changed');
    return data;
  } finally { fs.closeSync(fd); }
}
export function validateCertificateMaterial({ cert, key, origin } = {}) {
  if (!validDomainOrigin(origin)) throw Error('invalid certificate origin');
  const leaf = new X509Certificate(cert), host = new URL(origin).hostname;
  if (leaf.checkHost(host, { subject: 'never', wildcards: false }) !== host || !leaf.checkPrivateKey(createPrivateKey(key)) || Date.now() < Date.parse(leaf.validFrom) || Date.now() >= Date.parse(leaf.validTo)) throw Error('certificate mismatch or expired');
  tls.createSecureContext({ cert, key, minVersion: 'TLSv1.2' });
}
export function readProductionCertificate({ origin, certRoot, slot } = {}) {
  if (process.platform !== 'linux' || typeof process.geteuid !== 'function' || process.geteuid() === 0) throw Error('non-root Linux required');
  if (!validDomainOrigin(origin) || typeof certRoot !== 'string' || !path.isAbsolute(certRoot) || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(slot)) throw Error('invalid certificate configuration');
  const gid = process.getgid(), root = path.resolve(certRoot), dir = path.join(root, slot);
  for (const value of [root, dir]) {
    const st = fs.lstatSync(value);
    if (!st.isDirectory() || st.isSymbolicLink() || fs.realpathSync(value) !== value || !isRootManagedCertificateStat(st, gid, true)) throw Error('unsafe certificate directory');
  }
  let parent = path.dirname(root);
  for (;;) { const st = fs.lstatSync(parent); if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== 0 || (st.mode & 0o022)) throw Error('unsafe certificate ancestor'); const next = path.dirname(parent); if (next === parent) break; parent = next; }
  const cert = readProtectedFile(dir, 'cert.pem', gid), key = readProtectedFile(dir, 'key.pem', gid);
  validateCertificateMaterial({ cert, key, origin });
  return { cert, key };
}
async function verifyPublicChain({ cert, key }, hostname) {
  const server = tls.createServer({ cert, key, minVersion: 'TLSv1.2' }, socket => socket.end());
  server.on('tlsClientError', () => {}); let client;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    await new Promise((resolve, reject) => {
      client = tls.connect({ host: '127.0.0.1', port: server.address().port, servername: hostname, ca: tls.rootCertificates, rejectUnauthorized: true });
      client.setTimeout(5000, () => client.destroy(Error('certificate verification timed out')));
      client.once('secureConnect', resolve); client.once('error', reject);
    });
  } finally { client?.destroy(); await new Promise(resolve => server.close(resolve)); }
}
function privateAddress(value) {
  if (typeof value !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return false;
  const parts = value.split('.'); if (parts.some(p => (p.length > 1 && p[0] === '0') || Number(p) > 255)) return false;
  const [a, b] = parts.map(Number); return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
export async function startProductionGateway({ enabled = false, origin, certRoot, slot, bindAddress, service } = {}) {
  if (enabled !== true) throw Error('gateway disabled');
  if (!service || typeof service.handler !== 'function' || typeof service.close !== 'function') throw Error('invalid service');
  let server, armed = false;
  try {
    if (!privateAddress(bindAddress) || process.env.LISTEN_PID !== String(process.pid) || process.env.LISTEN_FDS !== '1' || process.env.LISTEN_FDNAMES !== 'lantern-https') throw Error('invalid socket activation');
    const material = readProductionCertificate({ origin, certRoot, slot });
    await verifyPublicChain(material, new URL(origin).hostname);
    server = https.createServer({ ...material, minVersion: 'TLSv1.2' }, (req, res) => {
      if (!armed) { res.writeHead(503, { connection: 'close' }); res.end(); return; }
      service.handler(req, res);
    });
    server.headersTimeout = 10000;
    server.requestTimeout = 20000;
    server.keepAliveTimeout = 5000;
    server.maxHeadersCount = 64;
    server.on('tlsClientError', () => {});
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ fd: 3 }, resolve); });
    const address = server.address(), local = Object.values(os.networkInterfaces()).flat().filter(Boolean).map(item => item.address);
    if (!address || typeof address === 'string' || address.family !== 'IPv4' || address.address !== bindAddress || address.port !== 443 || !local.includes(bindAddress)) throw Error('unexpected listener');
    armed = true;
    let closing;
    return Object.freeze({ close() { if (!closing) { armed = false; closing = (async () => { await new Promise(resolve => server.close(resolve)); await service.close(); })(); } return closing; } });
  } catch (error) { if (server?.listening) await new Promise(resolve => server.close(resolve)); await service.close(); throw error; }
}
