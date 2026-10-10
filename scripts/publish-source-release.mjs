import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, lstat} from 'node:fs/promises';
import {resolve, basename} from 'node:path';
import {pathToFileURL} from 'node:url';

const REPOSITORY = 'godnight/lantern-toeic';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const marker = plan => `<!-- lantern-release:${plan.sourceCommit}:${plan.sourceTree} -->`;

export function validatePlan(plan) {
  assert.equal(plan.schemaVersion, 1);
  assert(/^\d+\.\d+\.\d+$/.test(plan.version));
  assert(/^[a-f0-9]{40}$/.test(plan.sourceCommit));
  assert(/^[a-f0-9]{40}$/.test(plan.sourceTree));
  const expected = [
    `lantern-v${plan.version}-web-build.zip`, `lantern-v${plan.version}-harmony-unsigned.hap`,
    `lantern-v${plan.version}-source.zip`, 'QA.md', 'package-verification.json', 'build-info.json', 'SHA256SUMS.txt'
  ];
  assert.equal(plan.assets.length, expected.length, 'Incomplete release artifact set');
  assert.deepEqual(plan.assets.map(x => x.name).sort(), expected.sort(), 'Unexpected release artifacts');
  for (const asset of plan.assets) {
    assert.equal(basename(asset.name), asset.name);
    assert(!asset.name.includes('\\'));
    assert(Number.isSafeInteger(asset.bytes) && asset.bytes > 0);
    assert(/^[a-f0-9]{64}$/.test(asset.sha256));
  }
}

export async function loadArtifacts(directory) {
  const plan = JSON.parse(await readFile(resolve(directory, 'release-assets.json'), 'utf8'));
  validatePlan(plan);
  const blobs = new Map();
  for (const asset of plan.assets) {
    const path = resolve(directory, asset.name), stat = await lstat(path);
    assert(stat.isFile() && !stat.isSymbolicLink(), 'Artifact must be a regular file');
    const bytes = await readFile(path);
    assert.equal(bytes.length, asset.bytes, `Artifact size changed: ${asset.name}`);
    assert.equal(hash(bytes), asset.sha256, `Artifact bytes changed: ${asset.name}`);
    blobs.set(asset.name, bytes);
  }
  const info = JSON.parse(blobs.get('build-info.json').toString('utf8'));
  assert.equal(info.sourceCommit, plan.sourceCommit);
  assert.equal(info.sourceTree, plan.sourceTree);
  assert.equal(info.version, plan.version);
  assert.equal(info.hapSigning, 'unsigned');
  assert.equal(info.signatureBlockAbsent, true);
  return {plan, blobs};
}

// No credentials are written to disk or included in failure messages.
export function githubClient(token, fetchImpl = fetch) {
  assert(token, 'Missing workflow authentication');
  const prefix = `https://api.github.com/repos/${REPOSITORY}`;
  return async function request(path, {method = 'GET', json, bytes, binary = false} = {}) {
    const url = path.startsWith('https:') ? new URL(path) : new URL(prefix + path);
    const normal = url.origin === 'https://api.github.com' && url.pathname.startsWith(`/repos/${REPOSITORY}/`);
    const upload = url.origin === 'https://uploads.github.com' && new RegExp(`^/repos/${REPOSITORY}/releases/\\d+/assets$`).test(url.pathname);
    assert(normal || upload, 'Unexpected GitHub request destination');
    const headers = {Authorization: `Bearer ${token}`, Accept: binary ? 'application/octet-stream' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'};
    if (json !== undefined) headers['Content-Type'] = 'application/json';
    if (bytes) headers['Content-Type'] = 'application/octet-stream';
    const response = await fetchImpl(url, {method, headers, redirect: 'manual', body: bytes || (json === undefined ? undefined : JSON.stringify(json)), signal: AbortSignal.timeout(bytes ? 120_000 : 30_000)});
    if (method === 'GET' && response.status === 404) return null;
    if (binary && response.status >= 300 && response.status < 400) {
      const target = new URL(response.headers.get('location'));
      assert(target.protocol === 'https:' && (target.hostname === 'release-assets.githubusercontent.com' || target.hostname.endsWith('.githubusercontent.com')), 'Unexpected asset redirect');
      const download = await fetchImpl(target, {signal: AbortSignal.timeout(120_000)});
      assert(download.ok, `Asset download failed (${download.status})`);
      return Buffer.from(await download.arrayBuffer());
    }
    assert(response.ok, `GitHub ${method} ${url.pathname} failed (${response.status})`);
    if (response.status === 204) return null;
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
  };
}

async function tagCommit(api, tag) {
  const ref = await api('/git/ref/tags/' + tag);
  if (!ref) return null;
  let object = ref.object;
  for (let depth = 0; depth < 6; depth++) {
    if (object.type === 'commit') return object.sha;
    assert.equal(object.type, 'tag', 'Unsupported tag target');
    const annotated = await api('/git/tags/' + object.sha);
    assert(annotated?.object, 'Missing annotated tag');
    object = annotated.object;
  }
  throw Error('Annotated tag nesting is too deep');
}

async function findRelease(api, tag) {
  const release = await api('/releases/tags/' + tag);
  if (release) return release;
  // The tag lookup can omit unpublished drafts. Authenticated release lists include them.
  for (let page = 1; page <= 20; page++) {
    const releases = await api(`/releases?per_page=100&page=${page}`);
    const matches = releases.filter(x => x.tag_name === tag);
    assert(matches.length <= 1, 'Duplicate draft releases');
    if (matches.length) return matches[0];
    if (releases.length < 100) return null;
  }
  throw Error('Release listing exceeded its bounded search');
}

async function assetsFor(api, release) {
  const assets = [];
  for (let page = 1; page <= 20; page++) {
    const items = await api(`/releases/${release.id}/assets?per_page=100&page=${page}`);
    assets.push(...items);
    if (items.length < 100) return assets;
  }
  throw Error('Too many release attachments');
}

async function matchesAsset(api, actual, expected) {
  if (!actual || actual.state !== 'uploaded' || actual.size !== expected.bytes) return false;
  if (actual.digest) return actual.digest === 'sha256:' + expected.sha256;
  const bytes = await api(`/releases/assets/${actual.id}`, {binary: true});
  return bytes && bytes.length === expected.bytes && hash(bytes) === expected.sha256;
}

export async function publishRelease({plan, blobs, notes, api}) {
  validatePlan(plan);
  // Validate all local bytes before any remote mutation, including callers used by tests.
  for (const item of plan.assets) {
    assert(blobs.has(item.name), `Missing local artifact ${item.name}`);
    assert.equal(blobs.get(item.name).length, item.bytes);
    assert.equal(hash(blobs.get(item.name)), item.sha256);
  }
  const tag = 'v' + plan.version;
  const checkTag = async () => {
    const sha = await tagCommit(api, tag);
    assert(sha === null || sha === plan.sourceCommit, 'Existing version tag points elsewhere; never move it');
    return sha;
  };
  await checkTag();
  let release = await findRelease(api, tag);
  const body = notes + `\n\nSource: ${plan.sourceCommit}\nTree: ${plan.sourceTree}\n${marker(plan)}\n`;
  if (!release) {
    release = await api('/releases', {method: 'POST', json: {tag_name: tag, target_commitish: plan.sourceCommit, name: `${tag} · 鸿蒙离线测试版`, body, draft: true, prerelease: true, make_latest: 'false'}});
    assert(release?.draft, 'Release was not created as a draft');
  }
  assert.equal(release.tag_name, tag);
  assert.equal(release.target_commitish, plan.sourceCommit, 'Release was created for a different source');
  assert(release.body?.includes(marker(plan)), 'Existing release does not match this prepared source tree');
  const assertDraft = async () => {
    const current = await api('/releases/' + release.id);
    assert(current?.draft && current.target_commitish === plan.sourceCommit && current.body?.includes(marker(plan)), 'Release changed or was published; stop without overwriting');
  };
  let assets = await assetsFor(api, release);
  const expectedNames = new Set(plan.assets.map(x => x.name));
  assert(assets.every(x => expectedNames.has(x.name)), 'Unexpected existing attachment; inspect before publishing');
  assert.equal(new Set(assets.map(x => x.name)).size, assets.length, 'Duplicate attachment names');
  for (const item of plan.assets) {
    const actual = assets.find(x => x.name === item.name);
    if (await matchesAsset(api, actual, item)) continue;
    assert(release.draft, `Published artifact differs or is missing: ${item.name}; use a new version`);
    await assertDraft();
    if (actual) await api('/releases/assets/' + actual.id, {method: 'DELETE'});
    // Only an unpublished draft may replace incomplete/different bytes from an interrupted build.
    const upload = new URL(release.upload_url.replace(/\{.*\}$/, ''));
    assert.equal(upload.origin, 'https://uploads.github.com');
    assert.equal(upload.pathname, `/repos/${REPOSITORY}/releases/${release.id}/assets`);
    upload.searchParams.set('name', item.name);
    const uploaded = await api(upload.href, {method: 'POST', bytes: blobs.get(item.name)});
    assert(await matchesAsset(api, uploaded, item), `Uploaded artifact verification failed: ${item.name}`);
  }
  assets = await assetsFor(api, release);
  assert.equal(assets.length, plan.assets.length, 'Release artifact set is incomplete');
  for (const item of plan.assets) assert(await matchesAsset(api, assets.find(x => x.name === item.name), item), `Final artifact check failed: ${item.name}`);
  await checkTag();
  if (release.draft) {
    await assertDraft();
    release = await api('/releases/' + release.id, {method: 'PATCH', json: {body, draft: false, prerelease: true, make_latest: 'false'}});
  }
  assert.equal(release.draft, false);
  assert.equal(release.prerelease, true);
  assert.equal(await tagCommit(api, tag), plan.sourceCommit, 'Published tag is not the verified source');
  return release;
}

async function main() {
  assert.equal(process.env.GITHUB_REPOSITORY, REPOSITORY);
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
  assert(['push', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME));
  const {plan, blobs} = await loadArtifacts(process.argv[2] || 'release-assets');
  assert.equal(plan.sourceCommit, process.env.GITHUB_SHA);
  const manifest = JSON.parse(await readFile('release-manifest.json', 'utf8'));
  assert.equal(manifest.version, plan.version);
  assert.equal(manifest.prerelease, true);
  assert.equal(manifest.nativeHapAvailable, true);
  assert.equal(manifest.notes, `docs/releases/v${plan.version}.md`);
  const notes = await readFile(manifest.notes, 'utf8');
  const release = await publishRelease({plan, blobs, notes, api: githubClient(process.env.GH_TOKEN)});
  console.log(release.html_url);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {console.error(error.message); process.exitCode = 1;});
}
