import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {publishRelease, githubClient, loadArtifacts} from '../scripts/publish-source-release.mjs';

const hash = b => createHash('sha256').update(b).digest('hex');
function fixture() {
  const names = ['lantern-v0.1.0-web-build.zip', 'lantern-v0.1.0-harmony-unsigned.hap',
    'lantern-v0.1.0-source.zip', 'QA.md', 'package-verification.json', 'build-info.json', 'SHA256SUMS.txt'];
  const sourceCommit = 'a'.repeat(40), sourceTree = 'b'.repeat(40);
  const blobs = new Map(names.map(name => [name, Buffer.from(name)]));
  blobs.set('build-info.json', Buffer.from(JSON.stringify({version:'0.1.0', sourceCommit, sourceTree, hapSigning:'unsigned', signatureBlockAbsent:true})));
  const plan = {schemaVersion:1, version:'0.1.0', sourceCommit, sourceTree,
    assets:names.map(name => ({name, bytes:blobs.get(name).length, sha256:hash(blobs.get(name))}))};
  return {plan, blobs, notes:'# Public QA prerelease'};
}

function server(input) {
  const state = {release:null, assets:[], calls:[], tag:null, nextId:10, uploads:0, failUpload:0,
    hideDraft:true, tamperFinal:false, lists:0, ...input};
  const api = async (path, options = {}) => {
    const {method = 'GET', json, bytes, binary} = options;
    state.calls.push({path, method, json});
    if (method === 'GET' && path.startsWith('/git/ref/tags/')) return state.tag && {object:state.tag};
    if (method === 'GET' && path.startsWith('/git/tags/')) return {object:{type:'commit', sha:state.annotatedCommit}};
    if (method === 'GET' && path.startsWith('/releases/tags/')) return state.hideDraft && state.release?.draft ? null : structuredClone(state.release);
    if (method === 'GET' && path.startsWith('/releases?')) return state.release ? [structuredClone(state.release)] : [];
    if (method === 'POST' && path === '/releases') {
      state.release = {...json, id:1, upload_url:'https://uploads.github.com/repos/godnight/lantern-toeic/releases/1/assets{?name,label}', html_url:'https://github.com/godnight/lantern-toeic/releases/tag/v0.1.0'};
      return structuredClone(state.release);
    }
    if (method === 'GET' && path.startsWith('/releases/1/assets?')) {
      state.lists++;
      const result = structuredClone(state.assets);
      if (state.tamperFinal && state.lists === 2 && result.length) result[0].digest = 'sha256:' + '0'.repeat(64);
      return result;
    }
    if (method === 'GET' && path === '/releases/1') return structuredClone(state.release);
    if (method === 'GET' && binary) return Buffer.from(state.assets.find(a => path.endsWith('/' + a.id)).content);
    if (method === 'DELETE') {state.assets = state.assets.filter(a => !path.endsWith('/' + a.id)); return null;}
    if (method === 'POST' && path.startsWith('https://uploads.github.com/')) {
      state.uploads++;
      if (state.uploads === state.failUpload) throw Error('simulated interrupted upload');
      const asset = {id:state.nextId++, name:new URL(path).searchParams.get('name'), size:bytes.length,
        state:'uploaded', digest:'sha256:' + hash(bytes), content:bytes};
      state.assets.push(asset);
      return asset;
    }
    if (method === 'PATCH' && path === '/releases/1') {
      assert.equal(state.assets.length, 7, 'Never publish before every attachment exists');
      Object.assign(state.release, json);
      state.tag = {type:'commit', sha:state.release.target_commitish};
      return structuredClone(state.release);
    }
    throw Error(`Unexpected mock request ${method} ${path}`);
  };
  return {state, api};
}
const writes = s => s.calls.filter(x => x.method !== 'GET');

test('new release stays draft until all seven attachments are verified', async () => {
  const input = fixture(), {state, api} = server();
  const release = await publishRelease({...input, api});
  assert.equal(release.draft, false);
  assert.equal(state.uploads, 7);
  assert.equal(writes(state)[0].json.draft, true);
  assert.equal(writes(state).at(-1).method, 'PATCH');
  assert.equal(state.tag.sha, input.plan.sourceCommit);
});

test('upload interruption leaves a draft and rerun resumes matching attachments', async () => {
  const input = fixture(), {state, api} = server({failUpload:3});
  await assert.rejects(publishRelease({...input, api}), /interrupted/);
  assert.equal(state.release.draft, true);
  assert.equal(state.assets.length, 2);
  assert(!state.calls.some(c => c.method === 'PATCH'));
  const savedIds = state.assets.map(a => a.id);
  state.failUpload = 0;
  await publishRelease({...input, api});
  assert.deepEqual(state.assets.slice(0, 2).map(a => a.id), savedIds);
  assert.equal(state.uploads, 8); // one failed attempt, seven successful uploads total
  assert.equal(state.calls.filter(c => c.method === 'POST' && c.path === '/releases').length, 1);
});

test('rerun replaces corrupted attachment only while release is a draft', async () => {
  const input = fixture(), {state, api} = server({failUpload:2});
  await assert.rejects(publishRelease({...input, api}));
  state.assets[0].digest = 'sha256:' + '0'.repeat(64);
  state.failUpload = 0;
  await publishRelease({...input, api});
  assert.equal(state.calls.filter(c => c.method === 'DELETE').length, 1);
});

test('published identical release is read-only, including fallback digest downloads', async () => {
  const input = fixture(), {state, api} = server();
  await publishRelease({...input, api});
  state.calls = [];
  for (const asset of state.assets) delete asset.digest;
  await publishRelease({...input, api});
  assert.deepEqual(writes(state), []);
});

test('published same source but different bytes cannot be overwritten', async () => {
  const input = fixture(), {state, api} = server();
  await publishRelease({...input, api});
  state.assets[0].digest = 'sha256:' + '0'.repeat(64);
  state.calls = [];
  await assert.rejects(publishRelease({...input, api}), /Published artifact differs/);
  assert.deepEqual(writes(state), []);
});

test('existing lightweight or annotated version tags are immutable', async () => {
  for (const type of ['commit', 'tag']) {
    const {state, api} = server({tag:{type, sha:'c'.repeat(40)}, annotatedCommit:'d'.repeat(40)});
    await assert.rejects(publishRelease({...fixture(), api}), /never move/);
    assert.deepEqual(writes(state), []);
  }
});

test('final remote digest mismatch leaves an unpublished draft', async () => {
  const {state, api} = server({tamperFinal:true});
  await assert.rejects(publishRelease({...fixture(), api}), /Final artifact check/);
  assert.equal(state.release.draft, true);
  assert(!state.calls.some(c => c.method === 'PATCH'));
});

test('changed local bytes are rejected before contacting GitHub', async () => {
  const input = fixture(), {state, api} = server();
  input.blobs.set('QA.md', Buffer.from('corrupt'));
  await assert.rejects(publishRelease({...input, api}));
  assert.deepEqual(state.calls, []);
});

test('unknown attachment prevents draft publication', async () => {
  const input = fixture(), {state, api} = server({failUpload:2});
  await assert.rejects(publishRelease({...input, api}));
  state.assets.push({id:999,name:'device-authorized.hap'});
  state.calls = [];
  await assert.rejects(publishRelease({...input, api}), /Unexpected existing attachment/);
  assert.deepEqual(writes(state), []);
});

test('human publication between reads stops replacement', async () => {
  const input = fixture(), mock = server({failUpload:2});
  await assert.rejects(publishRelease({...input, api:mock.api}));
  mock.state.failUpload = 0;
  mock.state.calls = [];
  const api = async (path, options) => {
    if (path === '/releases/1') mock.state.release.draft = false;
    return mock.api(path, options);
  };
  await assert.rejects(publishRelease({...input, api}), /published; stop/);
  assert.deepEqual(writes(mock.state), []);
});

test('asset redirects never receive the GitHub authentication header', async () => {
  const calls = [];
  const api = githubClient('test-secret', async (url, options) => {
    calls.push({url, options});
    return calls.length === 1 ? new Response(null, {status:302, headers:{location:'https://release-assets.githubusercontent.com/fake'}})
      : new Response('artifact');
  });
  assert.equal((await api('/releases/assets/1', {binary:true})).toString(), 'artifact');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-secret');
  assert.equal(calls[1].options.headers, undefined);
  await assert.rejects(api('https://untrusted.example/upload', {method:'POST', bytes:Buffer.from('x')}), /Unexpected GitHub/);
});

test('prepared file reader rejects artifact tampering and validates build identity', async () => {
  const input = fixture(), directory = await mkdtemp(join(tmpdir(), 'lantern-release-'));
  try {
    await writeFile(join(directory, 'release-assets.json'), JSON.stringify(input.plan));
    for (const [name, bytes] of input.blobs) await writeFile(join(directory, name), bytes);
    assert.equal((await loadArtifacts(directory)).plan.sourceCommit, input.plan.sourceCommit);
    await writeFile(join(directory, 'QA.md'), 'tampered');
    await assert.rejects(loadArtifacts(directory), /Artifact size changed|Artifact bytes changed/);
  } finally {await rm(directory, {recursive:true, force:true});}
});
