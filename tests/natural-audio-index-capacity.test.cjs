'use strict';
// Schema/byte-boundary unit tests against the actual module. Padding is only a
// byte-boundary fixture; it is not a worst-case row-count or device benchmark.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const root=path.resolve(process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..')),req=createRequire(path.join(root,'package.json'));
const ts=req('typescript'),{createSourceLoader}=require(path.join(root,'tests/helpers/actual-source-loader.cjs'));
const baseline=JSON.parse(fs.readFileSync(path.join(root,'content/natural-audio-catalog-v1.json'),'utf8'));
const clone=value=>JSON.parse(JSON.stringify(value)),bytes=value=>Buffer.byteLength(JSON.stringify(value),'utf8');
function load(payload){return createSourceLoader({root,imports:{'../content/natural-audio-catalog-v1.json':{__esModule:true,default:payload}}}).load('lib/natural-audio-catalog-index.ts');}
function padded(size,template=baseline){const input=clone(template);input.catalogId='';const overhead=bytes(input);assert(size>=overhead,'Actual baseline already exceeds requested boundary');input.catalogId='x'.repeat(size-overhead);assert.equal(bytes(input),size);return input;}
function accepted(input){const result=load(input);assert.equal(result.compiledNaturalAudioCatalogError,null);assert.ok(result.compiledNaturalAudioCatalog);assert.equal(Object.isFrozen(result.compiledNaturalAudioCatalog),true);return result.compiledNaturalAudioCatalog;}
function rejected(input,pattern){const result=load(input);assert.equal(result.compiledNaturalAudioCatalog,null);assert.match(result.compiledNaturalAudioCatalogError,pattern);}

test('actual current baseline remains detached, frozen and byte-equivalent with all held contexts',()=>{
 const before=JSON.stringify(baseline),index=accepted(baseline);assert.equal(JSON.stringify(index),before);assert.equal(JSON.stringify(baseline),before);assert.notEqual(index,baseline);
 assert.equal(Object.isFrozen(index.routes),true);assert.deepEqual(clone(index.blockedContexts),baseline.blockedContexts);assert.deepEqual(clone(index.blockedAssetSha256),baseline.blockedAssetSha256);
});
test('actual module accepts exactly5MiB serialized UTF8',()=>{const input=padded(5*1024*1024),index=accepted(input);assert.equal(bytes(index),5*1024*1024);assert.deepEqual(clone(index.routes),baseline.routes);});
test('actual module rejects5MiB plus1 before admitting a catalog',()=>{rejected(padded(5*1024*1024+1),/超过5MiB/);});
test('the former4MiB plus1 is accepted only by the revised locator domain',()=>{const synthetic={...clone(baseline),routes:{},bindings:{},wordExceptions:[]};accepted(padded(4*1024*1024+1,synthetic));});
test('a malformed required route hash still fails inside the new byte bound',()=>{const input=clone(baseline);input.routes[Object.keys(input.routes)[0]][0][2]='not-a-sha';rejected(input,/定位行无效/);});
test('a duplicate selector role remains rejected instead of replacing the original row',()=>{const input=clone(baseline),rows=input.routes[Object.keys(input.routes)[0]];rows.push(clone(rows[0]));rejected(input,/定位角色重复/);});
test('invalid pack ordinal remains rejected',()=>{const input=clone(baseline);input.routes[Object.keys(input.routes)[0]][0][0]=input.packs.length;rejected(input,/定位行无效/);});
function packCount(count){const input=clone(baseline),template=input.packs.find(p=>p.packId!==input.basePackId);assert.ok(template);while(input.packs.length<count){const hash=crypto.createHash('sha256').update('synthetic-capacity-descriptor-'+input.packs.length).digest('hex'),p={...clone(template),packId:'v040-natural-'+hash.slice(0,12),manifestSha256:hash};p.manifestPath='/audio/natural/'+p.packId+'/manifest.json';p.admissionPath='/audio/natural/'+p.packId+'/admission.json';assert(!input.packs.some(row=>row.packId===p.packId));input.packs.push(p);}return input;}
test('synthetic descriptor-count fixture64 remains accepted',()=>{const input=packCount(64);assert.equal(input.packs.length,64);accepted(input);});
test('synthetic descriptor-count fixture65 remains rejected',()=>{rejected(packCount(65),/定位索引格式不正确/);});
test('non-base pack declared16MiB remains accepted and plus1 remains rejected',()=>{const input=clone(baseline),p=input.packs.find(p=>p.packId!==input.basePackId);p.declaredBytes=16*1024*1024;accepted(input);p.declaredBytes++;rejected(input,/分包描述超限/);});
for(const field of ['manifestBytes','admissionBytes'])test(field+' keeps its separate16MiB descriptor bound',()=>{const input=clone(baseline),p=input.packs.find(p=>p.packId!==input.basePackId);p[field]=16*1024*1024;accepted(input);p[field]++;rejected(input,/分包描述超限/);});
test('malformed held context remains rejected',()=>{const input=clone(baseline);input.blockedContexts.push(['synthetic-held-context','invalid-sha']);rejected(input,/隔离语境无效/);});
test('malformed blocked asset remains rejected',()=>{const input=clone(baseline);input.blockedAssetSha256.push('invalid-sha');rejected(input,/隔离哈希无效/);});
test('schema version remains1',()=>{const input=clone(baseline);input.schemaVersion=2;rejected(input,/定位索引格式不正确/);});
test('actual separate cache metadata store keeps exactly4MiB and rejects plus1 without overwriting it',async()=>{
 const {IDBFactory}=req('fake-indexeddb');
 const {createNaturalAudioBudgetMetadataStore}=createSourceLoader({root}).load('lib/natural-audio-cache-budget.ts');
 const store=createNaturalAudioBudgetMetadataStore(new IDBFactory()),input={schema:1,recency:{},offline:{},offlineEpoch:{}},target=4*1024*1024;
 let ordinal=0,current=bytes(input);while(current+1100<target){const key='row-'+ordinal+'-'+ 'x'.repeat(1000);input.recency[key]=0;current+=key.length+(ordinal===0?4:5);ordinal++;}
 input.recency.tail=0;const finalKey='tail'+'x'.repeat(target-bytes(input));delete input.recency.tail;input.recency[finalKey]=0;
 assert(finalKey.length<=2048);assert(Object.keys(input.recency).length<=32768);assert.equal(bytes(input),target);
 await store.save(input);assert.deepEqual(clone(await store.load()),input);
 const oversized=clone(input);delete oversized.recency[finalKey];oversized.recency[finalKey+'x']=0;assert.equal(bytes(oversized),target+1);
 await assert.rejects(store.save(oversized),/natural audio metadata exceeds bound/);assert.deepEqual(clone(await store.load()),input);
});

// Multi-byte boundary regression: JSON string length cannot substitute for UTF8 bytes.
function unicodePadded(size){const input=clone(baseline);input.catalogId='';const remaining=size-bytes(input);assert(remaining>=7);input.catalogId='汉🙂'.repeat(Math.floor(remaining/7))+'x'.repeat(remaining%7);assert.equal(bytes(input),size);assert(Buffer.byteLength(input.catalogId,'utf8')>input.catalogId.length);return input;}
test('actual locator accepts exactly5MiB UTF8 with Chinese and emoji padding',()=>{const input=unicodePadded(5*1024*1024),index=accepted(input);assert.equal(bytes(index),5*1024*1024);assert.deepEqual(clone(index.routes),baseline.routes);});
test('actual locator rejects UTF8 Chinese and emoji5MiB plus1 byte',()=>{rejected(unicodePadded(5*1024*1024+1),/超过5MiB/);});
