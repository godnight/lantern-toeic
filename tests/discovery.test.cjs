const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const root=path.resolve(__dirname,'..'),loader=createSourceLoader({root});
const catalog=loader.load('lib/discovery-catalog.ts'),favorites=loader.load('lib/discovery-favorites.ts'),back=loader.load('lib/discovery-return.ts');
const plain=value=>JSON.parse(JSON.stringify(value));
const A='usr_aaaaaaaa-1111-4111-8111-111111111111',B='usr_bbbbbbbb-2222-4222-8222-222222222222';
function storage(){const map=new Map();return {map,getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};}

test('runtime directory contains only reviewed external references with separate closed media permissions',()=>{
 assert.equal(catalog.discoveryEntries.length,3);
 assert.deepEqual(catalog.discoveryEntries.map(entry=>entry.kind),['talk','person','film']);
 for(const entry of catalog.discoveryEntries){
  assert(catalog.isDiscoveryEntry(entry));assert.equal(entry.rights.status,'link-only');assert.equal(entry.availability.network,'not-verified');
  assert(Object.values(entry.rights.capabilities).every(value=>value===false));assert(entry.rights.evidenceUrls.length>0);
  assert(!entry.sourceUrl.includes('ted.com'));assert.equal(entry.durationSeconds,null);assert.equal(entry.difficulty,null);
 }
 const altered=plain(catalog.discoveryEntries[0]);altered.rights.capabilities.embed=true;assert.equal(catalog.isDiscoveryEntry(altered),false);
 delete altered.rights.capabilities.embed;assert.equal(catalog.isDiscoveryEntry(altered),false);
});

test('directory URLs reject executable, opaque, credential-bearing and control-character destinations',()=>{
 for(const bad of ['javascript:alert(1)','data:text/html,test','file:///private','https://user:pass@example.com/','https://example.com\\evil','https://exa\nmple.com/','not a URL'])assert.equal(catalog.safeDiscoveryUrl(bad),false,bad);
 for(const good of ['https://ntrs.nasa.gov/citations/19940010921','http://example.com/source'])assert(catalog.safeDiscoveryUrl(good));
});

test('real search combines normalized title, author and tags with category and saved filters',()=>{
 const entries=catalog.discoveryEntries;
 assert.equal(catalog.filterDiscoveryEntries(entries,{query:'nasa SPACE'}).length,1);
 assert.equal(catalog.filterDiscoveryEntries(entries,{query:'乔布斯'}).at(0).id,'stanford-jobs-2005');
 assert.equal(catalog.filterDiscoveryEntries(entries,{query:'ｊｏｂｓ'}).length,1);
 assert.equal(catalog.filterDiscoveryEntries(entries,{kind:'film'}).at(0).id,'blender-tears-of-steel');
 assert.equal(catalog.filterDiscoveryEntries(entries,{kind:'talk',query:'Blender'}).length,0);
 assert.equal(catalog.filterDiscoveryEntries(entries,{query:'not-in-curated-directory'}).length,0);
 assert.deepEqual(plain(catalog.filterDiscoveryEntries(entries,{favoritesOnly:true,savedIds:['stanford-jobs-2005']}).map(entry=>entry.id)),['stanford-jobs-2005']);
 assert.equal(catalog.discoveryDuration(null),'时长以原站为准');assert.equal(catalog.discoveryDuration(125),'2:05');
});

test('favorites survive reopen and separate owners/device while preserving all other storage',()=>{
 const data=storage();data.setItem('lantern-study-existing','unchanged');
 const forOwner=owner=>favorites.createDiscoveryFavoritesStore({owner,storage:data,canAccess:()=>true});
 const first=forOwner(A);assert.equal(first.toggle('stanford-jobs-2005').status,'ready');
 assert.deepEqual(plain(forOwner(A).read().ids),['stanford-jobs-2005']);
 assert.deepEqual(plain(forOwner(B).read().ids),[]);assert.deepEqual(plain(forOwner(null).read().ids),[]);
 forOwner(B).toggle('blender-tears-of-steel');assert.deepEqual(plain(forOwner(A).read().ids),['stanford-jobs-2005']);
 assert.equal(data.getItem('lantern-study-existing'),'unchanged');
});

test('favorite toggles fresh-read current state rather than resurrecting a stale snapshot',()=>{
 const data=storage(),options={owner:A,storage:data,canAccess:()=>true};
 const first=favorites.createDiscoveryFavoritesStore(options),second=favorites.createDiscoveryFavoritesStore(options);
 first.toggle('stanford-jobs-2005');second.toggle('blender-tears-of-steel');first.toggle('stanford-jobs-2005');
 assert.deepEqual(plain(second.read().ids),['blender-tears-of-steel']);
});

test('corrupt, wrong-owner or future-schema favorite bytes are protected without writes',()=>{
 for(const raw of ['{broken',JSON.stringify({kind:'lantern-discovery-favorites',schemaVersion:2,owner:A,ids:[]}),
  JSON.stringify({kind:'lantern-discovery-favorites',schemaVersion:1,owner:B,ids:[]}),
  JSON.stringify({kind:'lantern-discovery-favorites',schemaVersion:1,owner:A,ids:['same','same']})]){
  const data=storage(),value=favorites.createDiscoveryFavoritesStore({owner:A,storage:data,canAccess:()=>true});data.setItem(value.key,raw);
  assert.equal(value.read().status,'blocked');assert.equal(value.toggle('nasa-kennedy-rice-1962').status,'blocked');assert.equal(data.getItem(value.key),raw);
 }
});

test('rejected writes and stale owner/access callbacks cannot report a successful favorite',()=>{
 const data=storage();let allowed=true,current=true,writes=0;
 const value=favorites.createDiscoveryFavoritesStore({owner:A,canAccess:()=>allowed,isCurrent:()=>current,storage:{getItem:data.getItem,setItem(){writes++;throw Error('quota');}}});
 assert.equal(value.toggle('nasa-kennedy-rice-1962').status,'blocked');assert.equal(writes,1);assert.equal(data.map.size,0);
 current=false;assert.equal(value.toggle('nasa-kennedy-rice-1962').reason,'access');assert.equal(writes,1);
 current=true;allowed=false;assert.equal(value.read().reason,'access');assert.equal(value.toggle('nasa-kennedy-rice-1962').reason,'access');assert.equal(writes,1);
});

test('external return restores only the same owner within its short lifetime and does not touch learning storage',()=>{
 const data=storage(),state={category:'article',query:'Jobs',savedOnly:true,scroll:460,entryId:'stanford-jobs-2005'};
 data.setItem('existing-learning-records','keep');assert.equal(back.rememberDiscoveryReturn(A,state,data,1000),true);
 assert.deepEqual(plain(back.readDiscoveryReturn(A,data,2000)),state);assert.equal(back.readDiscoveryReturn(B,data,2000),null);
 assert.equal(back.readDiscoveryReturn(A,data,1000+30*60*1000+1),null);assert.equal(back.readDiscoveryReturn(A,data,999),null);
 back.clearDiscoveryReturn(B,data);assert(back.readDiscoveryReturn(A,data,2000));back.clearDiscoveryReturn(A,data);assert.equal(back.readDiscoveryReturn(A,data,2000),null);
 assert.equal(data.getItem('existing-learning-records'),'keep');
});

test('return records validate actual shape, library state and write failure without false preservation',()=>{
 const data=storage(),base={category:'library',query:'',savedOnly:false,scroll:312,entryId:null,library:{category:'listening',query:'team',selectedId:'bc-new-team-member',listPosition:{scroll:640,id:'bc-new-team-member'},scroll:312}};
 assert(back.rememberDiscoveryReturn(A,base,data,1000));assert.deepEqual(plain(back.readDiscoveryReturn(A,data,1100)),base);
 for(const altered of [{...base,scroll:-1},{...base,category:'injected'},{...base,query:'x'.repeat(201)},{...base,library:{...base.library,selectedId:{}}}])assert.equal(back.rememberDiscoveryReturn(A,altered,data,1000),false);
 assert.equal(back.rememberDiscoveryReturn(A,base,{...data,setItem(){throw Error('denied');}},1000),false);
});


test('old v1 return categories retain their intended content type and owner isolation',()=>{
 const data=storage(),key='lantern-discovery-return-v1:'+JSON.stringify(A);
 for(const [oldCategory,category] of [['talk','video'],['person','article'],['film','video']]){
  const state={category:oldCategory,query:'original',savedOnly:false,scroll:123,entryId:'stanford-jobs-2005'};
  data.setItem(key,JSON.stringify({schemaVersion:1,owner:A,savedAt:1000,state}));
  assert.deepEqual(plain(back.readDiscoveryReturn(A,data,1100)),{...state,category});
  assert.equal(back.readDiscoveryReturn(B,data,1100),null);
 }
});

test('return restores source selection including none and protects prior state on malformed filters',()=>{
 const data=storage(),base={category:'podcast',query:'space',savedOnly:true,scroll:345,entryId:'nasa-curious-mars-alpha'};
 for(const sourceIds of [['nasa','ted-bilibili'],[]]){
  const state={...base,sourceIds};assert(back.rememberDiscoveryReturn(A,state,data,1000));
  assert.deepEqual(plain(back.readDiscoveryReturn(A,data,1100)),state);
  assert.equal(back.readDiscoveryReturn(B,data,1100),null);
 }
 const key='lantern-discovery-return-v1:'+JSON.stringify(A),before=data.getItem(key);
 for(const sourceIds of [['nasa','nasa'],['unsafe/id'],['x'.repeat(81)],Array(51).fill('nasa'),null]){
  assert.equal(back.rememberDiscoveryReturn(A,{...base,sourceIds},data,1200),false);assert.equal(data.getItem(key),before);
 }
});

test('external returns preserve the actual triggering control and reject malformed values',()=>{
 const data=storage(),base={category:'video',query:'',savedOnly:false,scroll:420,entryId:'nasa-kennedy-rice-1962'};
 for(const entryControl of ['cover','title','source']){
  const state={...base,entryControl};assert(back.rememberDiscoveryReturn(A,state,data,1000));
  assert.deepEqual(plain(back.readDiscoveryReturn(A,data,1100)),state);
 }
 const key='lantern-discovery-return-v1:'+JSON.stringify(A),before=data.getItem(key);
 assert.equal(back.rememberDiscoveryReturn(A,{...base,entryControl:'other'},data,1200),false);
 assert.equal(data.getItem(key),before);
});
