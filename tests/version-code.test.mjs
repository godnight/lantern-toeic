import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const {publishRelease} = await import('../scripts/publish-source-release.mjs');
const hash = value => createHash('sha256').update(value).digest('hex');
const source = version => hash(version).slice(0, 40);

function fixture(version = '0.3.1', versionCode = 20007) {
  const names = [`lantern-v${version}-web-build.zip`, `lantern-v${version}-harmony-unsigned.hap`,
    `lantern-v${version}-source.zip`, 'QA.md', 'package-verification.json', 'build-info.json', 'SHA256SUMS.txt'];
  const sourceCommit = source(version), sourceTree = source(version + 'tree');
  const blobs = new Map(names.map(name => [name, Buffer.from(name)]));
  const native = names[1];
  const info = {schemaVersion:1, version, versionCode, sourceCommit, sourceTree,
    hapSigning:'unsigned', signatureBlockAbsent:true,
    artifacts:[{name:native, bytes:blobs.get(native).length, sha256:hash(blobs.get(native))}]};
  blobs.set('build-info.json', Buffer.from(JSON.stringify(info)));
  const plan = {schemaVersion:1, version, sourceCommit, sourceTree,
    assets:names.map(name => ({name, bytes:blobs.get(name).length, sha256:hash(blobs.get(name))}))};
  return {plan, blobs, info, notes:'Synthetic release gate QA only'};
}

function server(candidate, entries = []) {
  const state = {releases:[], files:new Map(), sources:new Map(), tags:new Map(), calls:[], nextId:10, beforePublish:null};
  function add(input, options = {}) {
    const id = state.nextId++;
    const assets = input ? input.plan.assets.map(a => {
      const item = {id:state.nextId++, name:a.name, size:a.bytes, digest:'sha256:' + a.sha256, state:'uploaded'};
      state.files.set(item.id, input.blobs.get(a.name));
      return item;
    }) : [];
    const release = {id, tag_name:input ? 'v' + input.plan.version : 'web-' + id,
      target_commitish:input?.plan.sourceCommit, body:input ? `<!-- lantern-release:${input.plan.sourceCommit}:${input.plan.sourceTree} -->` : 'Old Web/source only',
      draft:false, prerelease:true, assets,
      upload_url:`https://uploads.github.com/repos/godnight/lantern-toeic/releases/${id}/assets{?name,label}`,
      ...options};
    state.releases.push(release);
    if (input) {
      state.tags.set(release.tag_name, input.plan.sourceCommit);
      const raw = JSON.stringify({app:{bundleName:'com.lantern.toeic', versionName:input.plan.version, versionCode:input.info.versionCode}});
      state.sources.set(input.plan.sourceCommit, {encoding:'base64', content:Buffer.from(raw).toString('base64'), size:Buffer.byteLength(raw)});
    }
    return release;
  }
  for (const item of entries) add(item.input ?? item, item.options);
  const api = async (path, opts = {}) => {
    const method = opts.method || 'GET';
    state.calls.push({path, method});
    if (method === 'GET' && path.startsWith('/git/ref/tags/')) {
      const sha = state.tags.get(path.slice('/git/ref/tags/'.length));
      return sha ? {object:{type:'commit', sha}} : null;
    }
    if (method === 'GET' && path.startsWith('/releases/tags/'))
      return structuredClone(state.releases.find(r => r.tag_name === path.slice('/releases/tags/'.length)) || null);
    if (method === 'GET' && path.startsWith('/releases?')) {
      const page = Number(new URL('https://local.invalid' + path).searchParams.get('page'));
      return structuredClone(state.releases.slice((page - 1) * 100, page * 100));
    }
    if (method === 'GET' && path.startsWith('/contents/')) return state.sources.get(new URL('https://local.invalid' + path).searchParams.get('ref'));
    if (method === 'GET' && opts.binary) return state.files.get(Number(path.split('/').at(-1)));
    const assetList = /^\/releases\/(\d+)\/assets\?/.exec(path);
    if (method === 'GET' && assetList) return structuredClone(state.releases.find(r => r.id === Number(assetList[1])).assets);
    if (method === 'GET' && /^\/releases\/\d+$/.test(path)) return structuredClone(state.releases.find(r => r.id === Number(path.split('/').at(-1))));
    if (method === 'POST' && path === '/releases') {
      const release = add(null, {...opts.json, assets:[]});
      return structuredClone(release);
    }
    if (method === 'POST' && path.startsWith('https://uploads.github.com/')) {
      const url = new URL(path), id = Number(url.pathname.split('/').at(-2));
      const release = state.releases.find(r => r.id === id);
      const item = {id:state.nextId++, name:url.searchParams.get('name'), size:opts.bytes.length,
        digest:'sha256:' + hash(opts.bytes), state:'uploaded'};
      state.files.set(item.id, opts.bytes); release.assets.push(item);
      if (release.assets.length === 7 && state.beforePublish) {const fn = state.beforePublish; state.beforePublish = null; fn(add);}
      return structuredClone(item);
    }
    if (method === 'PATCH') {
      const release = state.releases.find(r => r.id === Number(path.split('/').at(-1)));
      Object.assign(release, opts.json);
      state.tags.set(release.tag_name, release.target_commitish);
      return structuredClone(release);
    }
    throw Error('Unexpected mock request: ' + method + ' ' + path);
  };
  return {state, api, add};
}
const writes = state => state.calls.filter(c => c.method !== 'GET');

test('new native code exceeds both stable/prerelease despite release ordering and version labels', async () => {
  const input = fixture(), mock = server(input, [
    {input:fixture('0.3.0', 20006), options:{prerelease:false}}, fixture('0.1.0', 20005)]);
  const result = await publishRelease({...input, api:mock.api});
  assert.equal(result.draft, false);
});

for (const code of [20005, 20006]) test('new release rejects reused/older versionCode ' + code + ' before any write', async () => {
  const input = fixture('0.3.1', code), mock = server(input, [fixture('0.3.0', 20006)]);
  await assert.rejects(publishRelease({...input, api:mock.api}), /must exceed/);
  assert.deepEqual(writes(mock.state), []);
});

test('unpublished high-code drafts do not reserve a code', async () => {
  const input = fixture(), mock = server(input, [{input:fixture('9.0.0', 90000), options:{draft:true}}]);
  assert.equal((await publishRelease({...input, api:mock.api})).draft, false);
});

test('first native release allows existing source-only releases', async () => {
  const input = fixture('0.1.0', 20005), mock = server(input); mock.add(null);
  assert.equal((await publishRelease({...input, api:mock.api})).draft, false);
});

for (const missing of ['build-info.json', 'lantern-v0.3.0-harmony-unsigned.hap']) test('historical missing native evidence is blocked: ' + missing, async () => {
  const input = fixture(), mock = server(input, [fixture('0.3.0', 20006)]);
  mock.state.releases[0].assets = mock.state.releases[0].assets.filter(a => a.name !== missing);
  await assert.rejects(publishRelease({...input, api:mock.api}), /missing or duplicate/);
  assert.deepEqual(writes(mock.state), []);
});

test('duplicate build-info metadata is rejected', async () => {
  const input = fixture(), mock = server(input, [fixture('0.3.0', 20006)]);
  const release = mock.state.releases[0]; release.assets.push({...release.assets.find(a => a.name === 'build-info.json')});
  await assert.rejects(publishRelease({...input, api:mock.api}), /missing or duplicate/);
  assert.deepEqual(writes(mock.state), []);
});

test('historical build-info digest tampering is rejected', async () => {
  const input = fixture(), mock = server(input, [fixture('0.3.0', 20006)]);
  mock.state.releases[0].assets.find(a => a.name === 'build-info.json').digest = 'sha256:' + '0'.repeat(64);
  await assert.rejects(publishRelease({...input, api:mock.api}), /digest mismatch/);
  assert.deepEqual(writes(mock.state), []);
});

test('historical versionCode must equal tagged source config, not just a valid JSON integer', async () => {
  const input = fixture(), prior = fixture('0.3.0', 20006), mock = server(input, [prior]);
  const app = JSON.stringify({app:{bundleName:'com.lantern.toeic', versionName:'0.3.0', versionCode:20009}});
  mock.state.sources.set(prior.plan.sourceCommit, {encoding:'base64', content:Buffer.from(app).toString('base64'), size:app.length});
  await assert.rejects(publishRelease({...input, api:mock.api}), /source versionCode mismatch/);
  assert.deepEqual(writes(mock.state), []);
});

test('historical native artifact is bound to build-info digest', async () => {
  const input = fixture(), mock = server(input, [fixture('0.3.0', 20006)]);
  mock.state.releases[0].assets.find(a => a.name.endsWith('.hap')).digest = 'sha256:' + '0'.repeat(64);
  await assert.rejects(publishRelease({...input, api:mock.api}), /HAP differs/);
  assert.deepEqual(writes(mock.state), []);
});

test('identical published tag remains read-only even after a newer release', async () => {
  const input = fixture('0.1.0', 20005), mock = server(input, [input, fixture('0.3.0', 20006)]);
  assert.equal((await publishRelease({...input, api:mock.api})).draft, false);
  assert.deepEqual(writes(mock.state), []);
});

test('same published tag with changed code is never overwritten', async () => {
  const original = fixture(), changed = fixture('0.3.1', 20008), mock = server(changed, [original]);
  await assert.rejects(publishRelease({...changed, api:mock.api}), /Published artifact differs/);
  assert.deepEqual(writes(mock.state), []);
});

test('native release published during upload stops final publication and leaves draft', async () => {
  const input = fixture(), mock = server(input, [fixture('0.3.0', 20006)]);
  mock.state.beforePublish = add => add(fixture('0.3.2', 20007));
  await assert.rejects(publishRelease({...input, api:mock.api}), /must exceed/);
  assert.equal(mock.state.releases.find(r => r.tag_name === 'v0.3.1').draft, true);
  assert(!mock.state.calls.some(c => c.method === 'PATCH'));
});

test('history on a second page cannot be silently omitted', async () => {
  const input = fixture(), mock = server(input);
  for (let i = 0; i < 100; i++) mock.add(null);
  mock.add(fixture('0.3.2', 20008));
  await assert.rejects(publishRelease({...input, api:mock.api}), /must exceed/);
  assert(mock.state.calls.some(c => c.path === '/releases?per_page=100&page=2'));
  assert.deepEqual(writes(mock.state), []);
});

test('no digest API fallback still checks HAP bytes and source identity', async () => {
  const input = fixture(), mock = server(input, [fixture('0.3.0', 20006)]);
  for (const a of mock.state.releases[0].assets) delete a.digest;
  assert.equal((await publishRelease({...input, api:mock.api})).draft, false);
  assert(mock.state.calls.some(c => /^\/releases\/assets\//.test(c.path)));
});

test('non-integer candidate code fails before network', async () => {
  const input = fixture('0.3.1', true), mock = server(input);
  await assert.rejects(publishRelease({...input, api:mock.api}), /Invalid native versionCode/);
  assert.deepEqual(mock.state.calls, []);
});
