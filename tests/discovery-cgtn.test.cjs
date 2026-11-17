'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), path=require('node:path');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const root=path.resolve(__dirname,'..'), loader=createSourceLoader({root});
const feed=loader.load('lib/discovery-feed.ts'), favorites=loader.load('lib/discovery-favorites.ts');
const programs=[
 ['https://cgtn-radio-data.cgtn.com/rss/program/11','cgtn-roundtable','cgtn-rt-', 'https://radio.cgtn.com/podcast/column/ezfm/Round-Table-China/11'],
 ['https://cgtn-radio-data.cgtn.com/rss/program/5','cgtn-beijing-hour','cgtn-bh-', 'https://radio.cgtn.com/podcast/column/ezfm/The-Beijing-Hour/5'],
 ['https://cgtn-radio-data.cgtn.com/rss/program/46','cgtn-world-today','cgtn-wt-', 'https://radio.cgtn.com/podcast/column/ezfm/World-Today/46'],
];
const entry=(id,title='English original', extra='', date='Tue, 17 Nov 2026 08:58:00 GMT')=>`<item><guid>1_${id}</guid><title>${title}</title><pubDate>${date}</pubDate><description>English original episode.</description>${extra}</item>`;
const rss=(items,channel='<language>en</language>')=>`<rss><channel>${channel}${items}</channel></rss>`;
const memory=()=>{const map=new Map();return {map,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v))};};
const request=(rows)=>async url=>new Response(rows[String(url)]??'offline',{status:Object.hasOwn(rows,String(url))?200:503});
const open=(owner,storage)=>favorites.createDiscoveryFavoritesStore({owner,storage,canAccess:()=>true});

test('three official programs use distinct stable IDs despite sharing a program URL, preserve publication time and favorites',async()=>{
 const storage=memory(), rows=Object.fromEntries(programs.map(([url],i)=>[url,rss(entry(i+1)+entry(i+100,'Another episode'))]));
 const result=await feed.refreshDiscoveryFeed({storage,fetchImpl:request(rows)});
 assert.equal(result.refresh.outcome,'partial');assert.equal(result.refresh.added,6);
 for(const [,sourceId,prefix,url] of programs){
  const list=result.entries.filter(x=>x.sourceId===sourceId);assert.equal(list.length,2);assert.equal(list[0].sourceUrl,url);assert.equal(list[1].sourceUrl,url);assert(list[0].id.startsWith(prefix));
  assert.equal(list[0].publishedAt,'2026-11-17T08:58:00.000Z');assert.equal(list[0].originalLanguage,'en');
 }
 const saved=result.entries.find(x=>x.id==='cgtn-rt-1');assert(saved);
 assert.equal(open('owner-a',storage).toggle(saved.id,saved).status,'ready');
 const other=open('owner-b',storage).read();assert.equal(other.status,'ready');assert.equal(other.entries.length,0);
 const recovered=open('owner-a',storage).read();assert.equal(recovered.status,'ready');assert.equal(recovered.entries[0].id,saved.id);assert.equal(recovered.entries[0].publishedAt,saved.publishedAt);
 const reload=feed.readDiscoveryFeedCache(storage);assert.equal(reload.entries.filter(x=>x.sourceId==='cgtn-roundtable').length,2);
 const changed=await feed.refreshDiscoveryFeed({storage,fetchImpl:request({...rows,[programs[0][0]]:rss(entry(1,'Changed title')+entry(100,'Another episode'))})});
 assert.equal(changed.refresh.added,0,'title change is not a new episode');
 assert.equal(changed.entries.find(x=>x.id==='cgtn-rt-1').title,'Changed title');
});

test('language, dubbing, invalid identifiers, dates and incomplete RSS never replace the last good program cache',async()=>{
 const storage=memory(), url=programs[0][0];
 const first=await feed.refreshDiscoveryFeed({storage,fetchImpl:request({[url]:rss(entry(1))})});assert(first.entries.some(x=>x.id==='cgtn-rt-1'));
 const bad=[rss(entry(2),'<language>zh-CN</language>'),rss(entry(2),''),rss(entry(2,'Dubbed into English')),
  rss(entry(2,'Another','<language>zh-CN</language>')),rss(entry('2abc')),rss(entry(2,'No date','','not-a-date')),
  rss(entry(2)).replace('</rss>','')];
 for(const body of bad){
  const next=await feed.refreshDiscoveryFeed({storage,fetchImpl:request({[url]:body})});
  assert(next.entries.some(x=>x.id==='cgtn-rt-1'));assert(!next.entries.some(x=>x.id==='cgtn-rt-2'));
  assert(next.sources.some(x=>x.id==='cgtn-roundtable'&&x.mode==='cached'));
 }
 const captions=await feed.refreshDiscoveryFeed({storage,fetchImpl:request({[url]:rss(entry(2,'Subtitles translated into Chinese'))})});
 assert(captions.entries.some(x=>x.id==='cgtn-rt-2'));
});

test('retry once after incomplete stream and preserve valid prior schema while protecting future cache bytes',async()=>{
 const url=programs[0][0], store=memory(),cacheKey='lantern-discovery-public-feed-v1';let calls=0;
 const fetcher=async target=>String(target)!==url?new Response('offline',{status:503}):new Response(++calls===1?rss(entry(1)).replace('</rss>',''):rss(entry(2)),{status:200});
 const result=await feed.refreshDiscoveryFeed({storage:store,fetchImpl:fetcher});assert.equal(calls,2);assert(result.entries.some(x=>x.id==='cgtn-rt-2'));assert(!result.entries.some(x=>x.id==='cgtn-rt-1'));
 const cache=JSON.parse(store.map.get(cacheKey));assert.equal(cache.schemaVersion,2);assert.equal(cache.sources['cgtn-roundtable'].items.length,1);
 const legacy=memory(), legacyBytes=JSON.stringify({schemaVersion:1,sources:{'99pi':{fetchedAt:123,items:[{guid:'12345678-1111-4111-8111-111111111111',link:'https://99percentinvisible.org/episode/old/',title:'Old episode',publishedAt:null,language:null,description:null,descriptionTruncated:false}]}}});
 legacy.setItem(cacheKey,legacyBytes);assert(feed.readDiscoveryFeedCache(legacy).entries.some(x=>x.title==='Old episode'));
 const migrated=await feed.refreshDiscoveryFeed({storage:legacy,fetchImpl:request({[url]:rss(entry(3))})});assert(migrated.entries.some(x=>x.title==='Old episode'));assert.equal(JSON.parse(legacy.map.get(cacheKey)).schemaVersion,2);
 const future=memory(),bytes=JSON.stringify({schemaVersion:999,sources:{}});future.setItem(cacheKey,bytes);
 await feed.refreshDiscoveryFeed({storage:future,fetchImpl:request({[url]:rss(entry(4))})});assert.equal(future.map.get(cacheKey),bytes);
});

test('a saved CGTN reference cannot redirect to another program, audio host or forged ID',async()=>{
 const store=memory(),url=programs[0][0], result=await feed.refreshDiscoveryFeed({storage:store,fetchImpl:request({[url]:rss(entry(1))})});
 const item=result.entries.find(x=>x.id==='cgtn-rt-1');assert(item);
 for(const forged of [{...item,sourceUrl:programs[1][3]},{...item,sourceUrl:'https://radio-res.cgtn.com/audio.mp3'},{...item,id:'cgtn-rt-2abc'},{...item,publishedAt:'2026-11-17'}]){
  assert.equal(open('owner-a',store).toggle(forged.id,forged).status,'blocked');
 }
 assert.equal(open('owner-a',store).read().entries.length,0);
});

test('all four automatic feeds succeed without treating curated NASA as an update failure',async()=>{
 const store=memory(),rows=Object.fromEntries(programs.map(([url],i)=>[url,rss(entry(i+1))]));
 rows['https://feeds.simplecast.com/BqbsxVfO']=rss('<item><guid>12345678-1111-4111-8111-111111111111</guid><title>Original podcast</title><link>https://99percentinvisible.org/episode/example/</link></item>');
 const calls=[];const fetcher=async(url,options)=>{calls.push(String(url));return request(rows)(url,options);};
 const first=await feed.refreshDiscoveryFeed({storage:store,fetchImpl:fetcher});assert.equal(first.refresh.outcome,'updated');assert.equal(first.refresh.added,4);
 assert(!calls.includes('https://www.nasa.gov/feed/'));assert(first.sources.some(x=>x.id==='nasa'&&x.mode==='curated'));
 const same=await feed.refreshDiscoveryFeed({storage:store,fetchImpl:fetcher});assert.equal(same.refresh.outcome,'unchanged');assert.equal(same.refresh.added,0);
 const offline=await feed.refreshDiscoveryFeed({storage:store,fetchImpl:request({})});assert.equal(offline.refresh.outcome,'failed');assert.equal(offline.entries.filter(x=>x.sourceId.startsWith('cgtn-')).length,3);
});

test('same-source concurrent refresh respects request order regardless of completion order and storage availability',async()=>{
 for(const order of ['older-first','newer-first'])for(const writable of [true,false]){
  const localFeed=createSourceLoader({root}).load('lib/discovery-feed.ts');
  const map=new Map(), bytes=JSON.stringify({schemaVersion:999,sources:{}});
  const storage=writable?memory():{getItem:()=>bytes,setItem(){throw Error('protected');}};
  const pending=[],url=programs[0][0];
  const fetcher=async target=>String(target)===url?new Promise(resolve=>pending.push(resolve)):new Response('offline',{status:503});
  const older=localFeed.refreshDiscoveryFeed({storage,fetchImpl:fetcher}), newer=localFeed.refreshDiscoveryFeed({storage,fetchImpl:fetcher});
  assert.equal(pending.length,2);
  await new Promise(resolve=>setTimeout(resolve,8));
  if(order==='older-first'){
   pending[0](new Response(rss(entry(1,'Older')), {status:200}));await older;
   pending[1](new Response(rss(entry(2,'Newer')), {status:200}));await newer;
  } else {
   pending[1](new Response(rss(entry(2,'Newer')), {status:200}));await newer;
   pending[0](new Response(rss(entry(1,'Older')), {status:200}));await older;
  }
  const final=localFeed.readDiscoveryFeedCache(storage);assert(final.entries.some(x=>x.id==='cgtn-rt-2'),`${order} writable=${writable}`);
  assert(!final.entries.some(x=>x.id==='cgtn-rt-1'),`${order} writable=${writable}`);
  if(!writable)assert.equal(storage.getItem(),bytes);
 }
});
