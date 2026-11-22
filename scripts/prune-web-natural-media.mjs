import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat, mkdir, readFile, readdir, realpath, rename, rmdir, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const UPSTREAM_COMMIT = 'ea3b729174763ac5a63e86bcb729a5ff865e3cbb';
export const UPSTREAM_BASE = `https://raw.githubusercontent.com/godnight/lantern-toeic/${UPSTREAM_COMMIT}/public`;
export const PRODUCTION_ENTRY_COUNT = 12556;
export const PRODUCTION_MANIFEST_SHA256 = 'a788a60f4d9d7ab08d813bfbc5f943dc28721638b2f498a7eca8e057ab3bc220';
export const PRIVATE_PACK_ID = 'v040-natural-572f7490ce71';
export const PRIVATE_AUDIO_MANIFEST_SHA256 = '8f86060947f912ac65d80f4899c6c14cf72ab521870a15b7c5c89ee776832773';
export const PRIVATE_IMAGE_MANIFEST_SHA256 = 'a61ea0ec2613828312982101a68f2ef4bb968a7a03d91a32740e6d4eefd48f7b';
export const PRIVATE_AUDIO_COUNT = 14;
export const PRIVATE_IMAGE_COUNT = 12;
const PREFIX = '/audio/natural/';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(`Hosted natural-media prune: ${message}`); };
const normalized = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const keysAre = (object, names) => object && typeof object === 'object' && !Array.isArray(object)
  && equal(Object.keys(object).sort(), [...names].sort());

export function parseManifest(bytes, expectedCount = PRODUCTION_ENTRY_COUNT) {
  const manifest = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  if (!keysAre(manifest, ['schemaVersion', 'upstreamCommit', 'upstreamBase', 'entries'])
    || manifest.schemaVersion !== 1 || manifest.upstreamCommit !== UPSTREAM_COMMIT
    || manifest.upstreamBase !== UPSTREAM_BASE) fail('manifest schema or fixed upstream differs');
  if (!Number.isSafeInteger(expectedCount) || expectedCount <= 0
    || !Array.isArray(manifest.entries) || manifest.entries.length !== expectedCount) fail('manifest entry count differs');
  const seen = new Set();
  for (const entry of manifest.entries) {
    if (!keysAre(entry, ['path', 'bytes', 'sha256', 'contentType'])
      || typeof entry.path !== 'string'
      || !/^\/audio\/natural\/[a-z0-9][a-z0-9-]*\/(?:[a-f0-9]{64}\.mp3|admission\.json|manifest\.json)$/.test(entry.path)
      || path.posix.normalize(entry.path) !== entry.path || seen.has(entry.path)
      || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0
      || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || entry.contentType !== (entry.path.endsWith('.mp3') ? 'audio/mpeg' : 'application/json')) {
      fail('unsafe, duplicate, or malformed manifest entry');
    }
    seen.add(entry.path);
  }
  return manifest;
}

/** A separate local-only list. These entries are never added to the public
 * upstream/proxy manifest and are not approved for public distribution. */
export function parsePrivateManifest(audioBytes, imageBytes, expectedAudioSha = PRIVATE_AUDIO_MANIFEST_SHA256, expectedImageSha = PRIVATE_IMAGE_MANIFEST_SHA256) {
  if (![expectedAudioSha,expectedImageSha].every(sha=>/^[a-f0-9]{64}$/.test(sha)) ||
      sha256(audioBytes) !== expectedAudioSha || sha256(imageBytes) !== expectedImageSha) fail('private manifest identity differs');
  const audio = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(audioBytes));
  const images = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(imageBytes));
  if (!keysAre(audio, ['schemaVersion','status','packId','entries']) || audio.schemaVersion !== 1 ||
      audio.status !== 'PRIVATE_LOCAL_ONLY' || audio.packId !== PRIVATE_PACK_ID ||
      !Array.isArray(audio.entries) || audio.entries.length !== PRIVATE_AUDIO_COUNT ||
      !keysAre(images,['schemaVersion','status','entries']) || images.schemaVersion !== 1 || images.status !== 'PRIVATE_LOCAL_ONLY' ||
      !Array.isArray(images.entries) || images.entries.length !== PRIVATE_IMAGE_COUNT) fail('private manifest schema or count differs');
  const seen = new Set();
  for (const entry of [...audio.entries, ...images.entries]) {
    if (!keysAre(entry, ['path','bytes','sha256','contentType']) || typeof entry.path !== 'string' ||
        path.posix.normalize(entry.path) !== entry.path || seen.has(entry.path) ||
        !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || typeof entry.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(entry.sha256)) fail('unsafe, duplicate, or malformed private entry');
    const isAudio = new RegExp(`^/audio/natural/${PRIVATE_PACK_ID}/(?:[a-f0-9]{64}\\.mp3|admission\\.json|manifest\\.json)$`).test(entry.path);
    const image = /^\/listening12\/[a-f0-9]{64}\.png$/.test(entry.path);
    if ((!isAudio && !image) || entry.contentType !== (image?'image/png':entry.path.endsWith('.mp3')?'audio/mpeg':'application/json') ||
        (entry.path.endsWith('.mp3') || image) && path.posix.basename(entry.path).split('.')[0] !== entry.sha256)
      fail('private entry path or content identity differs');
    seen.add(entry.path);
  }
  if (audio.entries.some(e=>!e.path.startsWith(`${PREFIX}${PRIVATE_PACK_ID}/`)) ||
      images.entries.some(e=>!e.path.startsWith('/listening12/')) ||
      audio.entries.filter(e=>e.path.endsWith('.mp3')).length !== 12 ||
      !audio.entries.some(e=>e.path.endsWith('/manifest.json')) || !audio.entries.some(e=>e.path.endsWith('/admission.json')))
    fail('private manifest members differ');
  return {audio:audio.entries,images:images.entries};
}

async function safeNode(target, directory) {
  const stat = await lstat(target);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) fail(`link or non-${directory ? 'directory' : 'file'}: ${target}`);
  if (normalized(await realpath(target)) !== normalized(target)) fail(`redirected filesystem path: ${target}`);
  return stat;
}

async function safeAncestors(target) {
  const absolute = path.resolve(target);
  const base = path.parse(absolute).root;
  let current = base;
  await safeNode(current, true);
  for (const segment of path.relative(base, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    await safeNode(current, true);
  }
}

// lstat detects ordinary symlinks/junctions; Windows also has other reparse tags.
// Inspect FileAttributes without following a reparse point before traversing it.
function windowsReparseCheck(roots) {
  if (process.platform !== 'win32') return;
  const script = `$ErrorActionPreference='Stop'; $paths=ConvertFrom-Json $env:LANTERN_PRUNE_CHECK_ROOTS; foreach($root in $paths) { $p=[IO.Path]::GetFullPath($root); while($p) { if(([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point rejected' }; $parent=[IO.Directory]::GetParent($p); if($null -eq $parent) { break }; $p=$parent.FullName }; $todo=New-Object 'System.Collections.Generic.Stack[string]'; $todo.Push($root); while($todo.Count -gt 0) { $p=$todo.Pop(); $attrs=[IO.File]::GetAttributes($p); if(($attrs -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point rejected' }; if(($attrs -band [IO.FileAttributes]::Directory) -ne 0) { foreach($child in [IO.Directory]::EnumerateFileSystemEntries($p)) { $todo.Push($child) } } } }`;
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = spawnSync(executable, ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, encoding: 'utf8', timeout: 120_000,
    env: {...process.env, LANTERN_PRUNE_CHECK_ROOTS: JSON.stringify(roots)},
  });
  if (result.error || result.status !== 0) fail('Windows reparse-point preflight failed');
}

async function walk(directory) {
  await safeNode(directory, true);
  const files = [], directories = [];
  async function visit(current) {
    for (const name of (await readdir(current)).sort()) {
      const target = path.join(current, name);
      const stat = await lstat(target);
      if (stat.isSymbolicLink()) fail(`link in tree: ${target}`);
      if (stat.isDirectory()) {
        await safeNode(target, true);
        directories.push(path.relative(directory, target).split(path.sep).join('/'));
        await visit(target);
      } else {
        await safeNode(target, false);
        files.push(path.relative(directory, target).split(path.sep).join('/'));
      }
    }
  }
  await visit(directory);
  return {files: files.sort(), directories: directories.sort()};
}

async function filePin(target) {
  const before = await safeNode(target, false);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(target)) hash.update(chunk);
  const after = await safeNode(target, false);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) fail(`file changed while hashing: ${target}`);
  return {bytes: after.size, sha256: hash.digest('hex')};
}

async function mapLimit(values, fn) {
  const results = new Array(values.length);
  let cursor = 0;
  let failure;
  await Promise.all(Array.from({length: Math.min(8, values.length)}, async () => {
    while (!failure) {
      const index = cursor++;
      if (index >= values.length) return;
      try { results[index] = await fn(values[index]); }
      catch (error) { failure ??= error; }
    }
  }));
  if (failure) throw failure;
  return results;
}

function exactMembers(actual, expected, label) {
  if (!equal(actual.files, expected.files) || !equal(actual.directories, expected.directories)) fail(`${label} has unknown or missing members`);
}

function targetPath(base, entry) {
  const target = path.resolve(base, ...entry.path.slice(1).split('/'));
  const expectedRoot = path.resolve(base, entry.path.startsWith('/listening12/') ? 'listening12' : 'audio/natural');
  if (!target.startsWith(`${expectedRoot}${path.sep}`)) fail('target escaped exact natural-media directory');
  return target;
}

async function verifyEntries(base, entries, label) {
  await mapLimit(entries, async entry => {
    if (!equal(await filePin(targetPath(base, entry)), {bytes: entry.bytes, sha256: entry.sha256})) fail(`${label} bytes differ: ${entry.path}`);
  });
}

async function nonTargetPins(dist, removedPaths) {
  const tree = await walk(dist);
  const members = tree.files.filter(name => !removedPaths.has(name));
  return mapLimit(members, async name => ({path: name, ...await filePin(path.join(dist, ...name.split('/')))}));
}

async function ensureReceiptDirectory(receipt) {
  const directory = path.dirname(receipt);
  await safeAncestors(path.dirname(directory));
  try { await safeNode(directory, true); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(directory);
    await safeAncestors(directory);
  }
  try { await safeNode(receipt, false); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

// root/expectedCount are injectable only through this module API for isolated tests.
// The production command below fixes both its repository root and 12,556 members.
export async function pruneWebNaturalMedia({root = path.resolve(HERE, '..'), checkOnly = false, expectedCount = PRODUCTION_ENTRY_COUNT, expectedManifestSha256 = PRODUCTION_MANIFEST_SHA256,
  privateAudioManifestSha256 = PRIVATE_AUDIO_MANIFEST_SHA256, privateImageManifestSha256 = PRIVATE_IMAGE_MANIFEST_SHA256} = {}) {
  root = path.resolve(root);
  const manifestPath = path.join(root, 'worker/natural-media-manifest.json');
  const privateAudioManifestPath = path.join(root, 'worker/local-candidate-media-manifest.json');
  const privateImageManifestPath = path.join(root, 'scripts/local-candidate-images-manifest.json');
  const publicRoot = path.join(root, 'public');
  const dist = path.join(root, 'dist');
  const client = path.join(dist, 'client');
  const sourceNatural = path.join(publicRoot, 'audio/natural');
  const builtNatural = path.join(client, 'audio/natural');
  const sourceImages = path.join(publicRoot, 'listening12');
  const builtImages = path.join(client, 'listening12');
  const receiptPath = path.join(path.dirname(root), 'build-runs/prune-current.json');
  await safeAncestors(path.dirname(manifestPath));
  await safeNode(manifestPath, false);
  const manifestBytes = await readFile(manifestPath);
  const manifestPin = {bytes: manifestBytes.length, sha256: sha256(manifestBytes)};
  const manifest = parseManifest(manifestBytes, expectedCount);
  if (!/^[a-f0-9]{64}$/.test(expectedManifestSha256) || manifestPin.sha256 !== expectedManifestSha256) fail('fixed upstream manifest identity differs');
  await safeAncestors(path.dirname(privateAudioManifestPath));
  await safeAncestors(path.dirname(privateImageManifestPath));
  await safeNode(privateAudioManifestPath, false);await safeNode(privateImageManifestPath, false);
  const privateAudioBytes = await readFile(privateAudioManifestPath), privateImageBytes = await readFile(privateImageManifestPath);
  const privateAudioPin = {bytes: privateAudioBytes.length, sha256: sha256(privateAudioBytes)};
  const privateImagePin = {bytes: privateImageBytes.length, sha256: sha256(privateImageBytes)};
  const privateManifest = parsePrivateManifest(privateAudioBytes, privateImageBytes, privateAudioManifestSha256, privateImageManifestSha256);
  const expected = {
    files: manifest.entries.map(entry => entry.path.slice(PREFIX.length)).sort(),
    directories: [...new Set(manifest.entries.map(entry => entry.path.slice(PREFIX.length).split('/')[0]))].sort(),
  };
  const retainedNatural = {
    files: privateManifest.audio.map(entry=>entry.path.slice(PREFIX.length)).sort(),
    directories: [PRIVATE_PACK_ID],
  };
  if (expected.directories.includes(PRIVATE_PACK_ID) || privateManifest.audio.some(entry=>manifest.entries.some(old=>old.path===entry.path)))
    fail('private pack overlaps fixed upstream');
  const sourceExpected = {files:[...expected.files,...retainedNatural.files].sort(),directories:[...expected.directories,...retainedNatural.directories].sort()};
  const expectedImages = {files:privateManifest.images.map(entry=>entry.path.slice('/listening12/'.length)).sort(),directories:[]};
  const removedPaths = new Set(manifest.entries.map(entry=>`client${entry.path}`));
  await safeAncestors(sourceNatural);
  await safeAncestors(builtNatural);
  await safeAncestors(sourceImages);
  await safeAncestors(builtImages);
  windowsReparseCheck([sourceNatural, sourceImages, dist, manifestPath, privateAudioManifestPath, privateImageManifestPath]);
  exactMembers(await walk(sourceNatural), sourceExpected, 'source natural-media tree');
  exactMembers(await walk(sourceImages), expectedImages, 'source private-image tree');
  await verifyEntries(publicRoot, manifest.entries, 'source');
  await verifyEntries(publicRoot, [...privateManifest.audio,...privateManifest.images], 'source private');
  exactMembers(await walk(builtImages), expectedImages, 'built private-image tree');
  await verifyEntries(client, [...privateManifest.audio,...privateManifest.images], 'built private');
  const builtTree = await walk(builtNatural);
  const nonTargets = await nonTargetPins(dist, removedPaths);
  await ensureReceiptDirectory(receiptPath);
  const totalBytes = manifest.entries.reduce((sum, entry) => sum + entry.bytes, 0);

  if (checkOnly) {
    exactMembers(builtTree, retainedNatural, 'pruned natural-media tree');
    await safeNode(receiptPath, false);
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    if (receipt.schemaVersion !== 2 || receipt.status !== 'PASS_WEB_HOSTED_NATURAL_MEDIA_PRUNED' || receipt.scope !== 'PRIVATE_LOCAL_ONLY'
      || receipt.root !== root || receipt.upstreamCommit !== UPSTREAM_COMMIT
      || !equal(receipt.manifest, manifestPin) || !equal(receipt.privateAudioManifest, privateAudioPin) || !equal(receipt.privateImageManifest, privateImagePin) || receipt.sourceMembers !== sourceExpected.files.length
      || receipt.beforeMembers !== sourceExpected.files.length || receipt.removedMembers !== expectedCount
      || receipt.afterMembers !== PRIVATE_AUDIO_COUNT || receipt.retainedPrivateImages !== PRIVATE_IMAGE_COUNT || receipt.removedBytes !== totalBytes
      || !equal(receipt.nonTargetFiles, nonTargets)) fail('completed prune receipt does not bind this exact build');
    if (sha256(await readFile(manifestPath)) !== manifestPin.sha256 || sha256(await readFile(privateAudioManifestPath)) !== privateAudioPin.sha256 || sha256(await readFile(privateImageManifestPath)) !== privateImagePin.sha256) fail('manifest changed during verification');
    return {status: 'PASS_WEB_HOSTED_NATURAL_MEDIA_PRUNE_CHECK', scope:'PRIVATE_LOCAL_ONLY', receiptPath, removedMembers: expectedCount, removedBytes: totalBytes};
  }

  exactMembers(builtTree, sourceExpected, 'built natural-media tree');
  await verifyEntries(client, manifest.entries, 'built');
  if (sha256(await readFile(manifestPath)) !== manifestPin.sha256 || sha256(await readFile(privateAudioManifestPath)) !== privateAudioPin.sha256 || sha256(await readFile(privateImageManifestPath)) !== privateImagePin.sha256) fail('manifest changed before deletion');
  // All targets and all source bytes have now passed; invalidate any older receipt.
  try { await unlink(receiptPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const entry of manifest.entries) {
    const target = targetPath(client, entry);
    // Fail closed on concurrent edits; a partial run never receives a PASS receipt.
    await safeAncestors(path.dirname(target));
    if (!equal(await filePin(target), {bytes: entry.bytes, sha256: entry.sha256})) fail(`target changed after preflight: ${entry.path}`);
    await unlink(target);
  }
  for (const name of expected.directories) {
    const directory = path.join(builtNatural, name);
    await safeNode(directory, true);
    await rmdir(directory); // Empty exact manifest directory only; never recursive removal.
  }
  exactMembers(await walk(builtNatural), retainedNatural, 'pruned natural-media tree');
  exactMembers(await walk(builtImages), expectedImages, 'retained private-image tree');
  await verifyEntries(client, [...privateManifest.audio,...privateManifest.images], 'retained private');
  exactMembers(await walk(sourceNatural), sourceExpected, 'source natural-media tree');
  exactMembers(await walk(sourceImages), expectedImages, 'source private-image tree');
  await verifyEntries(publicRoot, manifest.entries, 'source after prune');
  await verifyEntries(publicRoot, [...privateManifest.audio,...privateManifest.images], 'source private after prune');
  const after = await nonTargetPins(dist, removedPaths);
  if (!equal(nonTargets, after)) fail('non-target built files changed');
  if (sha256(await readFile(manifestPath)) !== manifestPin.sha256 || sha256(await readFile(privateAudioManifestPath)) !== privateAudioPin.sha256 || sha256(await readFile(privateImageManifestPath)) !== privateImagePin.sha256) fail('manifest changed during deletion');
  const receipt = {
    schemaVersion: 2, status: 'PASS_WEB_HOSTED_NATURAL_MEDIA_PRUNED', scope:'PRIVATE_LOCAL_ONLY', root,
    createdAt: new Date().toISOString(), upstreamCommit: UPSTREAM_COMMIT, manifest: manifestPin, privateAudioManifest:privateAudioPin, privateImageManifest:privateImagePin,
    sourceMembers: sourceExpected.files.length, beforeMembers: sourceExpected.files.length, removedMembers: expectedCount,
    afterMembers: PRIVATE_AUDIO_COUNT, retainedPrivateImages:PRIVATE_IMAGE_COUNT, removedBytes: totalBytes, sourcePreserved: true,
    nonTargetFiles: after,
  };
  const temporary = `${receiptPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, {flag: 'wx'});
  await rename(temporary, receiptPath);
  return {status: receipt.status, scope:receipt.scope, receiptPath, removedMembers: expectedCount, removedBytes: totalBytes, nonTargetFiles: after.length};
}

if (process.argv[1] && normalized(process.argv[1]) === normalized(fileURLToPath(import.meta.url))) {
  if (process.argv.length !== 3 || !['--apply', '--check'].includes(process.argv[2])) {
    console.error('Usage: node scripts/prune-web-natural-media.mjs --apply|--check');
    process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(await pruneWebNaturalMedia({checkOnly: process.argv[2] === '--check'}))); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
