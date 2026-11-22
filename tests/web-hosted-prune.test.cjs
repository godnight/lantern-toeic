const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {spawnSync} = require('node:child_process');

const site = path.resolve(__dirname, '..');
const load = () => import(pathToFileURL(path.join(site, 'scripts/prune-web-natural-media.mjs')).href);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function put(filename, value) {
  await fs.mkdir(path.dirname(filename), {recursive: true});
  await fs.writeFile(filename, value);
}

async function fixture(t) {
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-hosted-prune-')));
  const root = path.join(temporary, 'site');
  t.after(() => fs.rm(temporary, {recursive: true, force: true}));
  const {UPSTREAM_COMMIT, UPSTREAM_BASE, PRIVATE_PACK_ID, pruneWebNaturalMedia} = await load();
  const entries = [Buffer.from('old short audio'), Buffer.from('new conversation audio')].map((bytes, index) => ({
    path: `/audio/natural/v040-natural-${index}/${hash(bytes)}.mp3`,
    bytes: bytes.length, sha256: hash(bytes), contentType: 'audio/mpeg', data: bytes,
  }));
  const metadata = Buffer.from('{"schemaVersion":1,"accepted":true}\n');
  entries.push({path: '/audio/natural/v040-natural-1/manifest.json', bytes: metadata.length, sha256: hash(metadata), contentType: 'application/json', data: metadata});
  const manifest = {
    schemaVersion: 1, upstreamCommit: UPSTREAM_COMMIT, upstreamBase: UPSTREAM_BASE,
    entries: entries.map(({data, ...entry}) => entry),
  };
  const manifestPath = path.join(root, 'worker/natural-media-manifest.json'),manifestBytes=Buffer.from(JSON.stringify(manifest));
  await put(manifestPath, manifestBytes);
  const privateAudio = Array.from({length:12},(_,i)=>{
    const data=Buffer.from(`private candidate audio ${i}`);
    return {path:`/audio/natural/${PRIVATE_PACK_ID}/${hash(data)}.mp3`,bytes:data.length,sha256:hash(data),contentType:'audio/mpeg',data};
  });
  for(const name of ['manifest.json','admission.json']){
    const data=Buffer.from(`private candidate ${name}`);
    privateAudio.push({path:`/audio/natural/${PRIVATE_PACK_ID}/${name}`,bytes:data.length,sha256:hash(data),contentType:'application/json',data});
  }
  const privateImages=Array.from({length:12},(_,i)=>{
    const data=Buffer.from(`private candidate picture ${i}`);
    return {path:`/listening12/${hash(data)}.png`,bytes:data.length,sha256:hash(data),contentType:'image/png',data};
  });
  const privateEntries=[...privateAudio,...privateImages];
  const privateAudioManifest={schemaVersion:1,status:'PRIVATE_LOCAL_ONLY',packId:PRIVATE_PACK_ID,entries:privateAudio.map(({data,...entry})=>entry)};
  const privateImageManifest={schemaVersion:1,status:'PRIVATE_LOCAL_ONLY',entries:privateImages.map(({data,...entry})=>entry)};
  const privateAudioBytes=Buffer.from(JSON.stringify(privateAudioManifest)),privateImageBytes=Buffer.from(JSON.stringify(privateImageManifest));
  const privateAudioManifestPath=path.join(root,'worker/local-candidate-media-manifest.json');
  const privateImageManifestPath=path.join(root,'scripts/local-candidate-images-manifest.json');
  await put(privateAudioManifestPath,privateAudioBytes);await put(privateImageManifestPath,privateImageBytes);
  for (const base of ['public', 'dist/client']) {
    for (const entry of [...entries,...privateEntries]) await put(path.join(root, base, entry.path.slice(1)), entry.data);
  }
  for (const filename of ['dist/client/build-identity.json', 'dist/client/assets/app.js', 'dist/client/listening200-r1/image.png', 'dist/server/index.js', 'dist/.openai/keep.txt', 'public/source.txt']) {
    await put(path.join(root, filename), `keep:${filename}`);
  }
  const source = entry => path.join(root, 'public', entry.path.slice(1));
  const built = entry => path.join(root, 'dist/client', entry.path.slice(1));
  const invoke = (checkOnly = false) => pruneWebNaturalMedia({root, expectedCount: entries.length,expectedManifestSha256:hash(manifestBytes), privateAudioManifestSha256:hash(privateAudioBytes),privateImageManifestSha256:hash(privateImageBytes),checkOnly});
  return {root, temporary, entries, privateAudio,privateImages,privateEntries,privateAudioManifest,privateImageManifest,privateAudioManifestPath,privateImageManifestPath, manifest, manifestPath, source, built, invoke};
}

async function assertTargetsIntact(f, omitted = new Set()) {
  for (const entry of f.entries) {
    if (!omitted.has(entry.path)) assert.deepEqual(await fs.readFile(f.built(entry)), entry.data);
  }
}

test('actual production manifest has all 12556 canonical files at the one fixed public commit', async () => {
  const {parseManifest, PRODUCTION_ENTRY_COUNT,PRODUCTION_MANIFEST_SHA256} = await load();
  const raw=await fs.readFile(path.join(site, 'worker/natural-media-manifest.json'));
  assert.equal(hash(raw),PRODUCTION_MANIFEST_SHA256);
  const actual = parseManifest(raw);
  assert.equal(PRODUCTION_ENTRY_COUNT, 12556);
  assert.equal(actual.entries.length, 12556);
  assert.equal(actual.entries.filter(entry => entry.contentType === 'audio/mpeg').length, 12510);
  assert.equal(actual.entries.filter(entry => entry.contentType === 'application/json').length, 46);
});

test('actual private pins identify exactly 14 local audio files and 12 local images', async()=>{
 const {parsePrivateManifest,PRIVATE_AUDIO_MANIFEST_SHA256,PRIVATE_IMAGE_MANIFEST_SHA256}=await load();
 const audio=await fs.readFile(path.join(site,'worker/local-candidate-media-manifest.json'));
 const images=await fs.readFile(path.join(site,'scripts/local-candidate-images-manifest.json'));
 assert.equal(hash(audio),PRIVATE_AUDIO_MANIFEST_SHA256);assert.equal(hash(images),PRIVATE_IMAGE_MANIFEST_SHA256);
 const m=parsePrivateManifest(audio,images);
 assert.equal(m.audio.length,14);assert.equal(m.images.length,12);
 for(const entry of [...m.audio,...m.images]){
  const bytes=await fs.readFile(path.join(site,'public',entry.path.slice(1)));
  assert.equal(bytes.length,entry.bytes);assert.equal(hash(bytes),entry.sha256);
 }
});

test('full preflight removes only exact built media; check binds receipt, source and every other built file', async t => {
  const f = await fixture(t);
  const result = await f.invoke();
  assert.equal(result.status, 'PASS_WEB_HOSTED_NATURAL_MEDIA_PRUNED');
  assert.equal(result.scope,'PRIVATE_LOCAL_ONLY');
  assert.equal(result.removedMembers, 3);
  assert.equal(result.removedBytes, f.entries.reduce((sum, entry) => sum + entry.bytes, 0));
  const {PRIVATE_PACK_ID}=await load();
  assert.deepEqual(await fs.readdir(path.join(f.root, 'dist/client/audio/natural')), [PRIVATE_PACK_ID]);
  for (const entry of [...f.entries,...f.privateEntries]) assert.deepEqual(await fs.readFile(f.source(entry)), entry.data);
  for (const entry of f.privateEntries) assert.deepEqual(await fs.readFile(f.built(entry)), entry.data);
  const receipt = JSON.parse(await fs.readFile(result.receiptPath));
  assert.equal(receipt.scope,'PRIVATE_LOCAL_ONLY');assert.equal(receipt.retainedPrivateImages,12);
  assert.equal(receipt.afterMembers,14);assert.equal(receipt.nonTargetFiles.length, 31);
  assert.equal(receipt.nonTargetFiles.find(row => row.path === 'server/index.js').sha256, hash('keep:dist/server/index.js'));
  assert.ok(!result.receiptPath.startsWith(path.join(f.root, 'dist')));
  const checked=await f.invoke(true);assert.equal(checked.status,'PASS_WEB_HOSTED_NATURAL_MEDIA_PRUNE_CHECK');assert.equal(checked.scope,'PRIVATE_LOCAL_ONLY');
  await assert.rejects(f.invoke(), /unknown or missing/);
});

test('unknown built file, directory, or missing file rejects before any deletion', async t => {
  for (const scenario of ['extra-file', 'extra-directory', 'missing-file']) {
    await t.test(scenario, async t => {
      const f = await fixture(t);
      const omitted = new Set();
      if (scenario === 'extra-file') await put(path.join(f.root, 'dist/client/audio/natural/unknown.txt'), 'unknown');
      if (scenario === 'extra-directory') await fs.mkdir(path.join(f.root, 'dist/client/audio/natural/unknown'));
      if (scenario === 'missing-file') { await fs.unlink(f.built(f.entries[1])); omitted.add(f.entries[1].path); }
      await assert.rejects(f.invoke(), /unknown or missing/);
      await assertTargetsIntact(f, omitted);
    });
  }
});

test('changed built bytes and source mismatch each reject before deleting any target', async t => {
  for (const side of ['built', 'source']) {
    await t.test(side, async t => {
      const f = await fixture(t);
      const target = f[side](f.entries[2]);
      await fs.writeFile(target, 'tampered bytes');
      await assert.rejects(f.invoke(), /bytes differ/);
      for (const entry of f.entries.slice(0, 2)) assert.deepEqual(await fs.readFile(f.built(entry)), entry.data);
      if (side === 'source') await assertTargetsIntact(f);
      else assert.equal(await fs.readFile(target, 'utf8'), 'tampered bytes');
    });
  }
});

test('unknown source file and source missing member reject with all built files intact', async t => {
  for (const scenario of ['unknown', 'missing']) {
    await t.test(scenario, async t => {
      const f = await fixture(t);
      if (scenario === 'unknown') await put(path.join(f.root, 'public/audio/natural/unknown.json'), '{}');
      else await fs.unlink(f.source(f.entries[0]));
      await assert.rejects(f.invoke(), /unknown or missing/);
      await assertTargetsIntact(f);
    });
  }
});

test('private candidate source and build must match all 14 audio files and 12 images before any removal',async t=>{
 for(const scenario of ['missing-source-audio','bad-source-audio','missing-built-audio','bad-built-audio',
   'unknown-source-audio','unknown-built-audio','missing-source-image','bad-source-image','missing-built-image',
   'bad-built-image','unknown-source-image','unknown-built-image','bad-private-manifest']){
  await t.test(scenario,async t=>{
   const f=await fixture(t),audio=f.privateAudio[0],image=f.privateImages[0];
   switch(scenario){
    case 'missing-source-audio':await fs.unlink(f.source(audio));break;
    case 'bad-source-audio':await fs.writeFile(f.source(audio),'altered');break;
    case 'missing-built-audio':await fs.unlink(f.built(audio));break;
    case 'bad-built-audio':await fs.writeFile(f.built(audio),'altered');break;
    case 'unknown-source-audio':await put(path.join(f.root,'public/audio/natural/extra.bin'),'unknown');break;
    case 'unknown-built-audio':await put(path.join(f.root,'dist/client/audio/natural/extra.bin'),'unknown');break;
    case 'missing-source-image':await fs.unlink(f.source(image));break;
    case 'bad-source-image':await fs.writeFile(f.source(image),'altered');break;
    case 'missing-built-image':await fs.unlink(f.built(image));break;
    case 'bad-built-image':await fs.writeFile(f.built(image),'altered');break;
    case 'unknown-source-image':await put(path.join(f.root,'public/listening12/extra.png'),'unknown');break;
    case 'unknown-built-image':await put(path.join(f.root,'dist/client/listening12/extra.png'),'unknown');break;
    case 'bad-private-manifest':await fs.writeFile(f.privateAudioManifestPath,'{}');break;
   }
   await assert.rejects(f.invoke());
   await assertTargetsIntact(f);
  });
 }
});

test('private pin parsing rejects re-pinned unsafe paths, duplicates, MIME and false scope',async t=>{
 const {parsePrivateManifest}=await load(),f=await fixture(t);
 const mutations=[
  (a,i)=>{a.entries[0].path='/audio/natural/../escape.mp3';},
  (a,i)=>{a.entries[0].path+='?query=1';},
  (a,i)=>{a.entries[1].path=a.entries[0].path;},
  (a,i)=>{a.entries[0].contentType='text/html';},
  (a,i)=>{a.entries[0].sha256='0'.repeat(64);},
  (a,i)=>{a.packId='v040-natural-000000000000';},
  (a,i)=>{a.status='PUBLIC';},
  (a,i)=>{i.entries[0].path='/listening12/../other.png';},
  (a,i)=>{i.entries[1].path=i.entries[0].path;},
  (a,i)=>{i.entries[0].contentType='text/html';},
  (a,i)=>{i.entries[0].sha256='f'.repeat(64);},
  (a,i)=>{i.entries.pop();},
 ];
 for(const mutate of mutations){
  const a=structuredClone(f.privateAudioManifest),i=structuredClone(f.privateImageManifest);mutate(a,i);
  const audio=Buffer.from(JSON.stringify(a)),images=Buffer.from(JSON.stringify(i));
  assert.throws(()=>parsePrivateManifest(audio,images,hash(audio),hash(images)));
 }
 await assertTargetsIntact(f);
});

test('private image directory links on either side reject before deletion',async t=>{
 for(const side of ['public','dist/client'])await t.test(side,async t=>{
  const f=await fixture(t),directory=path.join(f.root,side,'listening12'),outside=path.join(f.temporary,`external-private-${side.replace('/','-')}`);
  await fs.rename(directory,outside);
  await fs.symlink(outside,directory,process.platform==='win32'?'junction':'dir');
  await assert.rejects(f.invoke(),/reparse|link|redirected/i);await assertTargetsIntact(f);
  assert.deepEqual(await fs.readFile(path.join(outside,path.basename(f.privateImages[0].path))),f.privateImages[0].data);
 });
});

test('check rejects retained private media drift or private manifest changes',async t=>{
 for(const scenario of ['audio','image','manifest'])await t.test(scenario,async t=>{
  const f=await fixture(t);await f.invoke();
  if(scenario==='audio')await fs.writeFile(f.built(f.privateAudio[0]),'altered');
  if(scenario==='image')await fs.writeFile(f.built(f.privateImages[0]),'altered');
  if(scenario==='manifest')await fs.writeFile(f.privateImageManifestPath,'{}');
  await assert.rejects(f.invoke(true));
 });
});

test('weak paths, duplicate paths, incorrect schema/upstream/MIME and malformed bytes never enter deletion', async t => {
  const {parseManifest} = await load();
  const f = await fixture(t);
  const cases = [
    value => { value.entries[0].path = '/audio/natural/../outside.mp3'; },
    value => { value.entries[0].path = '/audio/natural/x/%2e%2e/file.mp3'; },
    value => { value.entries[0].path = '/audio/natural/x\\escape/file.mp3'; },
    value => { value.entries[0].path += '?url=https://evil.invalid'; },
    value => { value.entries[0].path = '//audio/natural/x/a.mp3'; },
    value => { value.entries[0].path = '/audio/natural/./x/file.mp3'; },
    value => { value.entries[0].bytes = 0; },
    value => { value.entries[0].sha256 = 'g'.repeat(64); },
    value => { value.entries[0].contentType = 'text/html'; },
    value => { value.entries[1].path = value.entries[0].path; },
    value => { value.upstreamCommit = '0'.repeat(40); },
    value => { value.upstreamBase = 'https://evil.invalid'; },
    value => { value.schemaVersion = 2; },
    value => { value.extra = true; },
  ];
  for (const change of cases) {
    const value = structuredClone(f.manifest);
    change(value);
    assert.throws(() => parseManifest(Buffer.from(JSON.stringify(value)), 3));
  }
  assert.throws(() => parseManifest(Buffer.from([0xff]), 3));
  await fs.writeFile(f.manifestPath, JSON.stringify({...f.manifest, upstreamCommit: '0'.repeat(40)}));
  await assert.rejects(f.invoke(), /fixed upstream/);
  await assertTargetsIntact(f);
});

test('a schema-valid but changed fixed upstream manifest cannot redefine its own pins',async t=>{
 const f=await fixture(t),changed=structuredClone(f.manifest);
 changed.entries.reverse();
 await fs.writeFile(f.manifestPath,JSON.stringify(changed));
 await assert.rejects(f.invoke(),/fixed upstream manifest identity/);
 await assertTargetsIntact(f);
});

test('directory junction/symlink in either target tree rejects before deletion and leaves external files intact', async t => {
  for (const side of ['built', 'source']) {
    await t.test(side, async t => {
      const f = await fixture(t);
      const directory = path.dirname(f[side](f.entries[0]));
      const outside = path.join(f.temporary, `external-${side}`);
      await fs.rename(directory, outside);
      await fs.symlink(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
      await assert.rejects(f.invoke(), /reparse|link|redirected/i);
      assert.deepEqual(await fs.readFile(path.join(outside, path.basename(f[side](f.entries[0])))), f.entries[0].data);
      await assertTargetsIntact(f);
    });
  }
});

test('non-target built link also rejects before any deletion', async t => {
  const f = await fixture(t);
  const outside = path.join(f.temporary, 'external-server');
  await fs.rename(path.join(f.root, 'dist/server'), outside);
  await fs.symlink(outside, path.join(f.root, 'dist/server'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.invoke(), /reparse|link|redirected/i);
  await assertTargetsIntact(f);
});

test('check refuses half-pruned state, absent receipt, source drift, and non-target drift', async t => {
  for (const scenario of ['partial', 'no-receipt', 'source', 'non-target']) {
    await t.test(scenario, async t => {
      const f = await fixture(t);
      if (scenario === 'partial') await fs.unlink(f.built(f.entries[0]));
      else {
        const result = await f.invoke();
        if (scenario === 'no-receipt') await fs.unlink(result.receiptPath);
        if (scenario === 'source') await fs.writeFile(f.source(f.entries[0]), 'source drift');
        if (scenario === 'non-target') await fs.writeFile(path.join(f.root, 'dist/server/index.js'), 'build drift');
      }
      await assert.rejects(f.invoke(true));
    });
  }
});

test('build entry runs verified build before prune; either child failure stops and propagates', async t => {
  const script = await fs.readFile(path.join(site, 'scripts/build-hosted-web.mjs'), 'utf8');
  for (const [buildExit, workerCheckExit, pruneExit, expected, stages] of [[0, 0, 0, 0, 'build\nworker-check\nprune\n'], [17, 0, 0, 17, 'build\n'], [0, 19, 0, 19, 'build\nworker-check\n'], [0, 0, 23, 23, 'build\nworker-check\nprune\n']]) {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-hosted-build-'));
    t.after(() => fs.rm(temporary, {recursive: true, force: true}));
    await put(path.join(temporary, 'scripts/build-hosted-web.mjs'), script);
    await put(path.join(temporary, 'scripts/build-verified.mjs'), `import {appendFileSync} from 'node:fs'; appendFileSync('stages.txt', 'build\\n'); process.exit(${buildExit});`);
    await put(path.join(temporary, 'scripts/check-local-candidate-worker-first.mjs'), `import {appendFileSync} from 'node:fs'; appendFileSync('stages.txt', 'worker-check\\n'); process.exit(${workerCheckExit});`);
    await put(path.join(temporary, 'scripts/prune-web-natural-media.mjs'), `import {appendFileSync} from 'node:fs'; if (process.argv[2] !== '--apply') process.exit(99); appendFileSync('stages.txt', 'prune\\n'); process.exit(${pruneExit});`);
    const child = spawnSync(process.execPath, ['scripts/build-hosted-web.mjs'], {cwd: temporary, encoding: 'utf8', windowsHide: true});
    assert.ifError(child.error);
    assert.equal(child.status, expected, child.stderr);
    assert.equal(await fs.readFile(path.join(temporary, 'stages.txt'), 'utf8'), stages);
  }
  const pkg = JSON.parse(await fs.readFile(path.join(site, 'package.json')));
  assert.equal(pkg.scripts.build, 'node scripts/build-hosted-web.mjs');
});
