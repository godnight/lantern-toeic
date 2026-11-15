// Configuration contains no secrets and is read only after an explicit enable.
import { open, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { validDomainOrigin } from './domain-policy.candidate.mjs';

function privateAddress(value) {
  if (typeof value !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return false;
  const parts = value.split('.'); if (parts.some(p => (p.length > 1 && p[0] === '0') || Number(p) > 255)) return false;
  const [a, b] = parts.map(Number); return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
export function validateRunnerConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'bindAddress,certRoot,enabled,lockDir,origin,slot' || value.enabled !== true ||
      !validDomainOrigin(value.origin) || !privateAddress(value.bindAddress) || typeof value.slot !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(value.slot) ||
      ![value.certRoot, value.lockDir].every(p => typeof p === 'string' && path.isAbsolute(p) && path.resolve(p) === p) || value.certRoot === value.lockDir) throw Error('invalid runner configuration');
  return Object.freeze({ enabled: true, origin: value.origin, bindAddress: value.bindAddress, certRoot: value.certRoot, lockDir: value.lockDir, slot: value.slot });
}
export async function readRunnerConfig({ enabled = false, file } = {}) {
  if (enabled !== true) throw Error('runner disabled');
  if (process.platform !== 'linux' || typeof process.geteuid !== 'function' || process.geteuid() === 0 || typeof file !== 'string' || !path.isAbsolute(file) || await realpath(file) !== file) throw Error('protected configuration required');
  const dir = path.dirname(file), gid = process.getgid(), parent = await lstat(dir);
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== 0 || parent.gid !== gid || (parent.mode & 0o777) !== 0o750) throw Error('unsafe configuration directory');
  let ancestor = path.dirname(dir);
  for (;;) { const st = await lstat(ancestor); if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== 0 || (st.mode & 0o022)) throw Error('unsafe configuration ancestor'); const next = path.dirname(ancestor); if (next === ancestor) break; ancestor = next; }
  const valid = st => st.isFile() && !st.isSymbolicLink() && st.uid === 0 && st.gid === gid && (st.mode & 0o777) === 0o640 && st.nlink === 1 && st.size > 0 && st.size <= 4096;
  const before = await lstat(file); if (!valid(before)) throw Error('unsafe configuration file');
  const fd = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await fd.stat(), current = await lstat(file);
    if (!valid(opened) || !valid(current) || opened.dev !== before.dev || opened.ino !== before.ino || current.dev !== opened.dev || current.ino !== opened.ino) throw Error('configuration changed');
    const bytes = await fd.readFile(), after = await fd.stat();
    if (bytes.length !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw Error('configuration changed');
    return validateRunnerConfig(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } finally { await fd.close(); }
}
