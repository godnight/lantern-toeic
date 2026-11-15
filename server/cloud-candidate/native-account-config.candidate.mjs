// Disabled-by-default account-only Node/SQLite candidate configuration.
// Root owns configuration and Worker bytes; the service account cannot edit
// either. This module neither creates files nor starts a service.
import { open, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { validateRunnerConfig } from './runner-config.candidate.mjs';

const absolute = p => typeof p === 'string' && path.isAbsolute(p) && path.resolve(p) === p;
const inside = (a, b) => { const relative = path.relative(a, b); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
export function validateNativeAccountConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'bindAddress,certRoot,enabled,lockDir,origin,slot,workerRoot,workerSha256') throw Error('invalid native account configuration');
  const { workerRoot, workerSha256, ...base } = value;
  const account = validateRunnerConfig(base);
  if (!absolute(workerRoot) || typeof workerSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(workerSha256)) throw Error('invalid native account configuration');
  const roots = [account.lockDir, account.certRoot, workerRoot];
  for (let i = 0; i < roots.length; i++) for (let j = i + 1; j < roots.length; j++)
    if (inside(roots[i], roots[j]) || inside(roots[j], roots[i])) throw Error('overlapping protected paths');
  return Object.freeze({ ...account, workerRoot, workerSha256 });
}

export function isRootControlledStat(st, gid, directory) {
  return !!st && Number.isInteger(gid) && gid > 0 && st.uid === 0 && st.gid === gid &&
    (st.mode & 0o7777) === (directory ? 0o750 : 0o640) && (directory || st.nlink === 1);
}

async function readRootControlled(file, maxBytes) {
  if (process.platform !== 'linux' || typeof process.geteuid !== 'function' || process.geteuid() === 0 || !absolute(file) || await realpath(file) !== file) throw Error('root controlled file required');
  const dir = path.dirname(file), gid = process.getgid(), parent = await lstat(dir);
  if (!parent.isDirectory() || parent.isSymbolicLink() || await realpath(dir) !== dir || !isRootControlledStat(parent, gid, true)) throw Error('unsafe protected directory');
  let ancestor = path.dirname(dir);
  for (;;) {
    const st = await lstat(ancestor);
    if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== 0 || (st.mode & 0o022)) throw Error('unsafe protected ancestor');
    const next = path.dirname(ancestor); if (next === ancestor) break; ancestor = next;
  }
  const valid = st => st.isFile() && !st.isSymbolicLink() && isRootControlledStat(st, gid, false) && st.size > 0 && st.size <= maxBytes;
  const before = await lstat(file); if (!valid(before)) throw Error('unsafe protected file');
  const fd = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await fd.stat(), current = await lstat(file);
    if (!valid(opened) || !valid(current) || before.dev !== opened.dev || before.ino !== opened.ino || current.dev !== opened.dev || current.ino !== opened.ino) throw Error('protected file changed');
    const bytes = await fd.readFile(), after = await fd.stat();
    if (bytes.length !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw Error('protected file changed');
    return bytes;
  } finally { await fd.close(); }
}

export async function readNativeAccountConfig({ enabled = false, file } = {}) {
  if (enabled !== true) throw Error('native account candidate disabled');
  const bytes = await readRootControlled(file, 4096);
  return validateNativeAccountConfig(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}

// Only the exact SHA256 selected by root-owned configuration may be evaluated.
export async function loadNativeAccountWorker(config) {
  const approved = validateNativeAccountConfig(config);
  const bytes = await readRootControlled(path.join(approved.workerRoot, 'account-worker.mjs'), 2 * 1024 * 1024);
  if (createHash('sha256').update(bytes).digest('hex') !== approved.workerSha256) throw Error('account worker digest mismatch');
  const module = await import('data:text/javascript;base64,' + bytes.toString('base64'));
  if (!module.default || typeof module.default.fetch !== 'function') throw Error('invalid account worker');
  return module.default;
}
